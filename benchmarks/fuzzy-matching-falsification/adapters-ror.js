#!/usr/bin/env node
/**
 * ROR affiliation-matching adapter set — comparator #1 (consensus §1 step 0
 * completion; SESSION_PROMPT S406 Verified Open #1). Owner authorized the
 * comparator runs 2026-08-07.
 *
 * Run against the SAME 166 frozen cases as the incumbent baseline
 * (baseline/incumbent-2026-08-06.md) with the SAME unmodified run.js/judge() —
 * including its exact-string target-name comparison. Naming-artifact fails are
 * separated in the report, NOT normalized away in the harness: changing judge()
 * would break comparability with the frozen baseline (README "Executing later").
 *
 * Pure ROR. This adapter never consults the incumbent resolver, OpenAlex, or any
 * repo matching code for any sub-decision — the point is two independent systems
 * scored against one case set.
 *
 * ============================================================================
 * MAPPING DECISIONS (this section IS part of the comparator record)
 * ============================================================================
 *
 * The system under test is `GET /v2/organizations?affiliation=<string>`, taking
 * ONLY the `chosen:true` item as a resolution. That is ROR's own documented
 * guidance, not a strawman weakening: "we do not recommend using the confidence
 * score to select matches; use the chosen:true indicator instead", and "don't
 * automatically select the first result in the list" (ror.readme.io
 * /v2/docs/api-affiliation, read 2026-08-07). At most ONE item per query carries
 * chosen:true; when none does, ROR's documented advice is human review — which
 * maps exactly onto this suite's treatment of abstention as a first-class
 * correct answer.
 *
 * institutionResolve (case kind "resolve"):
 *   - item with chosen:true -> outcome 'resolved', target { name, ror_id }.
 *     `name` is the names[] entry whose `types` includes 'ror_display' — NOT
 *     names[0], which is frequently an alias or acronym (probed: for
 *     ror.org/01an7q238 the first two names are 'Cal Berkeley' and 'UC
 *     Berkeley'). ror_id is the real ROR URI; the cases carry ror_id: null by
 *     design (populating them belongs to the pinned-dump work), so this is
 *     recorded as free provenance, never judged.
 *   - no chosen item (including number_of_results: 0) -> outcome 'review',
 *     target null. Same abstention→'review' mapping the incumbent adapter used,
 *     so the two runs' outcome vocabularies are comparable.
 *   - `domain_evidence` (the uc-sibling-domain family) is DISCARDED: the
 *     affiliation endpoint accepts a single string and has no parameter for
 *     domain evidence. As with the incumbent, that is itself a finding about
 *     what an off-the-shelf resolver can consume, not an adapter bug.
 *   - A multi-org string (inst-hier-003, "Dana-Farber ... and Harvard Medical
 *     School ...") is sent as ONE opaque query and scored as-is — incumbent
 *     precedent. ROR has no multi-org output shape either.
 *
 * institutionPairConsistent (case kind "pair-consistency"):
 *   ROR has no pair-consistency endpoint, so the pair decision is DERIVED —
 *   this is the one real design choice in this adapter. Both sides are resolved
 *   independently via chosen:true and compared by ROR id:
 *     - both resolve AND same ror_id -> consistent true,  outcome 'resolved'
 *     - both resolve AND different    -> consistent false, outcome 'review'
 *     - either side abstains          -> consistent false, outcome 'review'
 *   Same-ROR-id-ONLY is deliberate. Consulting each record's `relationships`
 *   graph (parent/child/related) would resolve hierarchy pairs like
 *   HMS↔Harvard and VUMC↔Vanderbilt, but that is a different system than
 *   "chosen:true only" and would confound the comparison. EXPECTED CONSEQUENCE,
 *   recorded in advance so the numbers read as designed rather than missed: the
 *   institution-hierarchy family should fail on same-id comparison wherever the
 *   correct answer is consistent:true across two distinct ROR records. What the
 *   run then measures is whether ROR's *matching* fixes the S400 byline defect,
 *   not whether ROR models hierarchy.
 *
 *   The "either side abstains -> consistent:false" arm is a keep-honest choice:
 *   the alternative (reporting consistent:null) would dodge the assertion
 *   entirely and let unresolvable strings score as neither right nor wrong.
 *
 * personMatch / contactAttribute / affiliationCurrent:
 *   NOT WIRED, deliberately. ROR is an organization registry — it has no person,
 *   contact, or dated-affiliation semantics whatsoever. Those adapters are
 *   absent rather than faked, so runSuite reports the 25 person/contact/
 *   affiliation cases as skipped and the institution denominator (141) stays
 *   honest. This is a scope statement about ROR, not a gap in the run.
 *
 * Politeness / reliability: ROR documents "a maximum of 2000 requests in a
 * 5-minute period per IP address" (ror.readme.io/v2/docs/rest-api, read
 * 2026-08-07) = 6.67 rps. This adapter paces at 250ms (4 rps, ~60% of the
 * ceiling) and retries 429/5xx with exponential backoff, honoring Retry-After.
 * A pair-consistency case costs TWO calls. Per the baseline's hard-won lesson: a
 * *uniformly* abstaining resolver is a broken transport, not a result — this
 * adapter therefore THROWS on exhausted retries so the case records as `error`
 * rather than silently scoring as a well-behaved abstention.
 * ============================================================================
 */

const ROR_ENDPOINT = 'https://api.ror.org/v2/organizations';
const PACE_MS = 250;
const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Serialized pacing: one in-flight request at a time, >=PACE_MS apart, so a
// pair-consistency case's two calls don't burst past the documented ceiling.
let queue = Promise.resolve();
let nextAt = 0;

// Cache identical affiliation strings within a run. The UC matrix repeats the
// same campus strings across substitution families, and ROR's answer for a given
// string is stable for the duration of one run — this cuts calls without
// changing any result. Keyed by the exact query string.
const cache = new Map();

async function rorFetchOnce(affiliation) {
  const url = `${ROR_ENDPOINT}?affiliation=${encodeURIComponent(affiliation)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'WMKF-falsification-suite/1.0 (comparator run)' },
  });
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const err = new Error(`ROR ${res.status}`);
    err.retryable = true;
    err.retryAfterMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : null;
    throw err;
  }
  if (!res.ok) throw new Error(`ROR ${res.status} (non-retryable)`);
  return res.json();
}

async function rorAffiliation(affiliation) {
  const key = String(affiliation ?? '');
  if (cache.has(key)) return cache.get(key);

  const run = async () => {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await sleep(Math.max(0, nextAt - Date.now()));
      nextAt = Date.now() + PACE_MS;
      try {
        return await rorFetchOnce(key);
      } catch (err) {
        lastError = err;
        if (!err.retryable || attempt === MAX_ATTEMPTS - 1) throw err;
        await sleep(err.retryAfterMs ?? BACKOFF_BASE_MS * (2 ** attempt));
      }
    }
    throw lastError;
  };

  // Keep the queue usable after a failure; the caller still sees the rejection.
  const queued = queue.then(run, run);
  queue = queued.then(() => undefined, () => undefined);
  cache.set(key, queued);
  return queued;
}

// ROR v2 display name: the names[] entry typed 'ror_display'. Falls back to a
// 'label' then the first name only if the record somehow lacks a display name —
// recorded rather than silently guessed (see pickDisplayName usage in results).
function displayName(org) {
  const names = Array.isArray(org?.names) ? org.names : [];
  const byType = (t) => names.find((n) => Array.isArray(n.types) && n.types.includes(t));
  return (byType('ror_display') || byType('label') || names[0])?.value ?? null;
}

// The chosen record for an affiliation string, or null when ROR declines to
// choose (its documented "send to a human" signal).
async function chosenOrg(affiliation) {
  const body = await rorAffiliation(affiliation);
  const items = Array.isArray(body?.items) ? body.items : [];
  const chosen = items.find((i) => i.chosen === true);
  if (!chosen?.organization) return null;
  return {
    name: displayName(chosen.organization),
    ror_id: chosen.organization.id ?? null,
    score: chosen.score ?? null,
    matching_type: chosen.matching_type ?? null,
  };
}

async function institutionResolve(input) {
  const chosen = await chosenOrg(input.affiliation_string);
  if (!chosen) return { outcome: 'review', target: null };
  return {
    outcome: 'resolved',
    target: { name: chosen.name, ror_id: chosen.ror_id },
    // Provenance only — never judged. Kept so the report can distinguish a
    // confident chosen match from a marginal one after the fact.
    ror_score: chosen.score,
    ror_matching_type: chosen.matching_type,
  };
}

async function institutionPairConsistent(input) {
  const [listed, evidence] = [await chosenOrg(input.listed), await chosenOrg(input.evidence)];
  const consistent = !!(listed && evidence && listed.ror_id && listed.ror_id === evidence.ror_id);
  return {
    outcome: consistent ? 'resolved' : 'review',
    consistent,
    // Provenance: which side (if either) ROR declined to choose, so the report
    // can separate "resolved both, genuinely different orgs" from "couldn't
    // resolve one side at all".
    ror_listed: listed ? { name: listed.name, ror_id: listed.ror_id } : null,
    ror_evidence: evidence ? { name: evidence.name, ror_id: evidence.ror_id } : null,
  };
}

module.exports = {
  institutionResolve,
  institutionPairConsistent,
  // personMatch / contactAttribute / affiliationCurrent intentionally absent —
  // see the header. runSuite records those cases as skipped.
};
