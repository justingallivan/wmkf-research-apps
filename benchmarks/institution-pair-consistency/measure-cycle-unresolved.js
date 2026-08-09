#!/usr/bin/env node
/**
 * measure-cycle-unresolved.js — READ-ONLY measurement of how the staged
 * institution pair-consistency checker (segmentComparison: true) would
 * perform against the incumbent default checker, replayed over THIS
 * CYCLE'S actual identity-unresolved candidate reviewers, instead of the
 * hand-authored fixtures in cases/.
 *
 * Owner question: "We have a rich dataset of unresolved candidate reviewers
 * in this cycle. Develop a tool to measure how our new system would perform
 * on those."
 *
 * Population (verified 2026-08-09 against the live data model):
 *   - Suggestions: wmkf_appreviewersuggestions, filtered to
 *     wmkf_grantcyclecode = --cycle. This is the candidate-reviewer roster
 *     for the cycle; no acceptance/decline filter (unlike
 *     scripts/probe-reviewer-affiliation-account-match.js's populations —
 *     this tool's population is deliberately different).
 *   - Joined via _wmkf_potentialreviewer_value to the person record
 *     (wmkf_potentialreviewerses), in scope when wmkf_identitystatus is
 *     'unresolved', 'ambiguous', or NULL (counted separately per the task
 *     spec — a null status is not the same claim as an explicit
 *     'unresolved' decision).
 *
 * Claimed institution: the person's wmkf_primaryaffiliation (canonical,
 * 500-char field) — NOT the suggestion's wmkf_revieweraffiliation, which is
 * a per-suggestion reported string that can differ across requests for the
 * same person. A person with a blank primaryaffiliation but a non-blank
 * suggestion-level reported affiliation is counted ("found, not measured")
 * but never substituted in as the claimed institution — that would silently
 * widen scope past what the canonical field says.
 *
 * Evidence institution: THE unknown this tool exists to answer empirically.
 * wmkf_identityverifiedanchorsjson is written only by
 * lib/dataverse/adapters/researcher.js's writeIdentityDecision, as a COMPACT
 * projection: `{ type, canonicalKey, sourceUrl, verifier }` per anchor —
 * `value`/`parserOutput` are dropped at persistence. Reading
 * lib/services/reviewer-identity-evidence.js's anchor-building code shows
 * the institution-bearing anchor type is `affiliation_match`, built as
 * `anchor('affiliation_match', weight, record.lastKnownInstitution, {...})`
 * whose canonicalKey is `${type}:${value}` — so the evidence institution
 * string survives compaction ONLY inside that canonicalKey, recoverable by
 * stripping the `affiliation_match:` prefix (not split-on-colon, since an
 * institution name can itself contain a colon). This is a code-reading
 * HYPOTHESIS until checked against real rows; this script tallies observed
 * anchor `type` values and null/empty/unparseable-JSON counts across every
 * in-scope person so the finding is empirical, not just inferred, and prints
 * it plainly if the hypothesis doesn't hold.
 *
 * Checker replay reuses the hardened pattern from run-pair-gates.js: shared
 * resolver instance across both checker configs with
 * propagateProviderErrors: true, concurrency-4 mapper, per-pair
 * AbortController timeout, resolver-metrics provider-failure gate, and the
 * git-sha/dirty/script-sha256/node-version/openAlexApiKeyPresent provenance
 * block (pure helpers imported directly from run-pair-gates.js, not
 * duplicated).
 *
 * NO Dataverse writes. The only POST anywhere in this script is the OAuth
 * client-credentials token request. No person names or emails are ever
 * written to console or to the output artifact — GUIDs and institution
 * strings only. wmkf_identityevidencesummary (free text, routinely contains
 * names) is read only to record its length/presence, never its content.
 *
 * Usage:
 *   node measure-cycle-unresolved.js --cycle <code> --slug <name> [--limit N]
 *   node measure-cycle-unresolved.js --case <suggestionId>
 *   node measure-cycle-unresolved.js            # lists cycles, exits 1
 *   node measure-cycle-unresolved.js --help
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 4;
const PERSON_ID_CHUNK_SIZE = 20;

const { buildProvenance } = require('./run-pair-gates.js');

// ---------------------------------------------------------------------------
// .env.local loader — identical contract to run-pair-gates.js's loadEnvLocal
// (not exported by that module, so faithfully copied rather than reached
// into a sibling script's internals).
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '../../.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...parts] = trimmed.split('=');
    if (!key || parts.length === 0 || key in process.env) continue;
    let value = parts.join('=').trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Dataverse read-only access (pattern from
// scripts/probe-reviewer-affiliation-account-match.js). NO writes.
// ---------------------------------------------------------------------------
async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

async function getAll(token, urlPath) {
  let next = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`;
  const rows = [];
  while (next) {
    // eslint-disable-next-line no-await-in-loop -- sequential pagination by design
    const r = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' },
    });
    // eslint-disable-next-line no-await-in-loop
    const t = await r.text();
    let body;
    try { body = JSON.parse(t); } catch { body = t; }
    if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240)}`);
    for (const v of (body.value || [])) rows.push(v);
    next = body['@odata.nextLink'] || null;
  }
  return rows;
}

// OData string-literal escaping: single quotes double up.
function odataString(value) {
  return String(value).replace(/'/g, "''");
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchPersonsByIds(token, ids) {
  const select = 'wmkf_potentialreviewersid,wmkf_identitystatus,wmkf_primaryaffiliation,'
    + 'wmkf_identityverifiedanchorsjson,wmkf_identityevidencesummary';
  const results = [];
  for (const idChunk of chunk(ids, PERSON_ID_CHUNK_SIZE)) {
    const filter = idChunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    // eslint-disable-next-line no-await-in-loop -- sequential chunk fetch by design
    const rows = await getAll(token, `/wmkf_potentialreviewerses?$select=${select}&$filter=${encodeURIComponent(filter)}`);
    results.push(...rows);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Pure logic: identity-status bucketing, evidence extraction, funnel,
// pair building. No network. Exported for the offline test.
// ---------------------------------------------------------------------------

const AFFILIATION_MATCH_PREFIX = 'affiliation_match:';

function identityStatusBucket(status) {
  if (status === null || status === undefined || status === '') return 'null';
  if (status === 'unresolved') return 'unresolved';
  if (status === 'ambiguous') return 'ambiguous';
  return 'other'; // confirmed/probable/anything unexpected — out of scope
}

function isInScopeBucket(bucket) {
  return bucket === 'unresolved' || bucket === 'ambiguous' || bucket === 'null';
}

/**
 * Parses wmkf_identityverifiedanchorsjson defensively. Returns
 * { anchors: Array, parseOk: boolean } — parseOk=false covers both a
 * missing/blank value and unparseable JSON, distinguished in the caller's
 * tally by checking the raw value first.
 */
function parseAnchorsJson(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { anchors: [], parseOk: true, blank: true };
  }
  try {
    const parsed = JSON.parse(raw);
    return { anchors: Array.isArray(parsed) ? parsed : [], parseOk: true, blank: false };
  } catch {
    return { anchors: [], parseOk: false, blank: false };
  }
}

/**
 * Extracts evidence-institution strings from a parsed anchors array: every
 * `affiliation_match` anchor's canonicalKey with the type prefix stripped
 * (prefix-slice, not split-on-colon — an institution name can itself
 * contain a colon). Deduped within the person. Anchors with a null
 * canonicalKey (the source anchor had no value) are skipped.
 */
function affiliationMatchInstitutions(anchors) {
  const out = new Set();
  for (const a of anchors) {
    if (!a || a.type !== 'affiliation_match') continue;
    const key = a.canonicalKey;
    if (typeof key !== 'string' || !key.startsWith(AFFILIATION_MATCH_PREFIX)) continue;
    const inst = key.slice(AFFILIATION_MATCH_PREFIX.length).trim();
    if (inst) out.add(inst);
  }
  return [...out];
}

function tallyAnchorTypes(personsWithAnchors) {
  const typeCounts = {};
  let blankCount = 0;
  let unparseableCount = 0;
  let totalAnchors = 0;
  for (const p of personsWithAnchors) {
    const { anchors, parseOk, blank } = parseAnchorsJson(p.wmkf_identityverifiedanchorsjson);
    if (blank) blankCount += 1;
    else if (!parseOk) unparseableCount += 1;
    for (const a of anchors) {
      totalAnchors += 1;
      const t = a && a.type ? a.type : '(missing type)';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
  }
  return {
    personsInspected: personsWithAnchors.length, blankCount, unparseableCount, totalAnchors, typeCounts,
  };
}

/**
 * Builds the full funnel object from the raw fetched rows. `limit`, if set,
 * caps the in-scope person list BEFORE claimed/evidence extraction (bounds
 * both the person-detail fetch and downstream OpenAlex traffic) — the
 * caller is expected to have already applied it to the id list passed to
 * fetchPersonsByIds; this function just re-states the post-limit count for
 * the funnel line.
 */
function buildFunnel({
  suggestions, distinctPersonIds, persons, limit,
}) {
  const byBucket = { unresolved: [], ambiguous: [], null: [], other: [] };
  for (const p of persons) {
    byBucket[identityStatusBucket(p.wmkf_identitystatus)].push(p);
  }
  const inScope = [...byBucket.unresolved, ...byBucket.ambiguous, ...byBucket.null];
  const inScopeAfterLimit = typeof limit === 'number' && limit > 0 ? inScope.slice(0, limit) : inScope;

  const suggestionAffiliationById = new Map();
  for (const s of suggestions) {
    const pid = s._wmkf_potentialreviewer_value;
    if (pid && s.wmkf_revieweraffiliation && !suggestionAffiliationById.has(pid)) {
      suggestionAffiliationById.set(pid, s.wmkf_revieweraffiliation);
    }
  }

  const withClaimed = [];
  const claimedBlankButSuggestionHas = [];
  for (const p of inScopeAfterLimit) {
    const claimed = (p.wmkf_primaryaffiliation || '').trim();
    if (claimed) {
      withClaimed.push(p);
    } else if ((suggestionAffiliationById.get(p.wmkf_potentialreviewersid) || '').trim()) {
      claimedBlankButSuggestionHas.push(p);
    }
  }

  const anchorTally = tallyAnchorTypes(inScopeAfterLimit);

  const withEvidence = [];
  for (const p of withClaimed) {
    const { anchors } = parseAnchorsJson(p.wmkf_identityverifiedanchorsjson);
    const insts = affiliationMatchInstitutions(anchors);
    if (insts.length > 0) withEvidence.push({ person: p, evidenceInstitutions: insts });
  }

  return {
    suggestionsInCycle: suggestions.length,
    distinctPersonsInCycle: distinctPersonIds.length,
    personsFetched: persons.length,
    byIdentityStatus: {
      unresolved: byBucket.unresolved.length,
      ambiguous: byBucket.ambiguous.length,
      null: byBucket.null.length,
      other_excluded: byBucket.other.length,
    },
    inScopeTotal: inScope.length,
    limitApplied: typeof limit === 'number' && limit > 0 ? limit : null,
    inScopeAfterLimit: inScopeAfterLimit.length,
    withClaimedInstitution: withClaimed.length,
    claimedBlankButSuggestionAffiliationPresent_foundNotMeasured: claimedBlankButSuggestionHas.length,
    anchorTally,
    withEvidenceInstitution: withEvidence.length,
    measurablePersons: withEvidence.length,
  };
}

/**
 * Builds deduped (claimedInstitution, evidenceInstitution) pairs from the
 * withEvidence list. Deduped on the exact trimmed string pair — the
 * resolver caches by name anyway, but deduping keeps the report and the
 * live-provider call count from being inflated by persons sharing the same
 * claimed+evidence pair. Each pair record retains the contributing person
 * GUIDs (never names).
 */
function buildMeasurablePairs(withEvidence) {
  const byKey = new Map();
  for (const { person, evidenceInstitutions } of withEvidence) {
    const claimed = person.wmkf_primaryaffiliation.trim();
    for (const evidence of evidenceInstitutions) {
      const key = `${claimed}|||${evidence}`;
      if (!byKey.has(key)) {
        byKey.set(key, { claimedInstitution: claimed, evidenceInstitution: evidence, personIds: [] });
      }
      byKey.get(key).personIds.push(person.wmkf_potentialreviewersid);
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Checker replay — same shape as run-pair-gates.js's runOnePair, adapted to
// a claimed/evidence pair record instead of a case-file row.
// ---------------------------------------------------------------------------
async function withTimeout(fn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const err = new Error(`timed out after ${timeoutMs}ms`);
    err.code = 'PAIR_TIMEOUT';
    controller.abort(err);
  }, timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function replayOnePair(pair, { incumbentChecker, stagedChecker, timeoutMs }) {
  try {
    const [incumbentConsistent, stagedConsistent] = await withTimeout(
      (signal) => Promise.all([
        incumbentChecker.areConsistent(pair.claimedInstitution, pair.evidenceInstitution, { signal }),
        stagedChecker.areConsistent(pair.claimedInstitution, pair.evidenceInstitution, { signal }),
      ]),
      timeoutMs,
    );
    return {
      ...pair,
      status: 'ok',
      incumbentVerdict: incumbentConsistent,
      stagedVerdict: stagedConsistent,
      agree: incumbentConsistent === stagedConsistent,
    };
  } catch (err) {
    return {
      ...pair, status: 'error', error: err?.message || String(err),
    };
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
function printFunnel(funnel) {
  console.log('\n=== Funnel (all denominators) ===');
  console.log(`  suggestions this cycle:                          ${funnel.suggestionsInCycle}`);
  console.log(`  distinct persons among those suggestions:        ${funnel.distinctPersonsInCycle}`);
  console.log(`  persons fetched:                                 ${funnel.personsFetched}`);
  console.log(`  identity status: unresolved=${funnel.byIdentityStatus.unresolved}  ambiguous=${funnel.byIdentityStatus.ambiguous}  null=${funnel.byIdentityStatus.null}  (other/excluded=${funnel.byIdentityStatus.other_excluded})`);
  console.log(`  in-scope total (unresolved+ambiguous+null):      ${funnel.inScopeTotal}`);
  if (funnel.limitApplied) {
    console.log(`  --limit applied (${funnel.limitApplied}) -> in-scope after limit: ${funnel.inScopeAfterLimit}`);
  }
  console.log(`  with non-blank claimed institution (primaryaffiliation): ${funnel.withClaimedInstitution}`);
  console.log(`  found-not-measured (blank primaryaffiliation, but suggestion has reported affiliation): ${funnel.claimedBlankButSuggestionAffiliationPresent_foundNotMeasured}`);
  console.log(`  anchor JSON: blank=${funnel.anchorTally.blankCount}  unparseable=${funnel.anchorTally.unparseableCount}  total anchors seen=${funnel.anchorTally.totalAnchors}  (across ${funnel.anchorTally.personsInspected} in-scope persons)`);
  console.log(`  anchor type tally: ${JSON.stringify(funnel.anchorTally.typeCounts)}`);
  console.log(`  with >=1 affiliation_match evidence institution: ${funnel.withEvidenceInstitution}`);
  console.log(`  MEASURABLE PERSONS: ${funnel.measurablePersons}`);
}

function printHeadline(pairResults, resolverMetrics) {
  const ok = pairResults.filter((r) => r.status === 'ok');
  const errors = pairResults.filter((r) => r.status === 'error');
  const stagedClear = ok.filter((r) => r.stagedVerdict === true).length;
  const stagedSurface = ok.filter((r) => r.stagedVerdict === false).length;
  const disagreements = ok.filter((r) => !r.agree);

  console.log('\n=== Headline (product action, not verdict taxonomy) ===');
  console.log(`  measurable pairs: ${pairResults.length}  (ok=${ok.length}, errors=${errors.length})`);
  console.log(`  NOTE: this checker's areConsistent() is strictly boolean (verified by reading`);
  console.log(`  lib/services/institution-affiliation-consistency.js) — there is no 'insufficient'/`);
  console.log(`  null abstain verdict at Stage 1, only true/false, so no third bucket is reported.`);
  console.log(`  staged would auto-clear (true):  ${stagedClear}  (staff clicks saved)`);
  console.log(`  staged would surface (false):    ${stagedSurface}`);
  console.log(`  DELTA vs incumbent (arms disagree): ${disagreements.length}`);
  for (const d of disagreements) {
    console.log(`    - claimed="${d.claimedInstitution}" evidence="${d.evidenceInstitution}" incumbent=${d.incumbentVerdict} staged=${d.stagedVerdict} (persons: ${d.personIds.length})`);
  }
  if (errors.length > 0) {
    console.log(`  ERRORS (${errors.length}):`);
    for (const e of errors) console.log(`    - claimed="${e.claimedInstitution}" evidence="${e.evidenceInstitution}" -> ${e.error}`);
  }
  console.log(`\n  providerFailures: ${resolverMetrics.providerFailures}`);
  const overallOk = errors.length === 0 && resolverMetrics.providerFailures === 0;
  console.log(`  ok: ${overallOk}`);
  return overallOk;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function printUsage() {
  console.log(`Usage:
  node measure-cycle-unresolved.js --cycle <code> --slug <name> [--limit N] [--timeout-ms N]
  node measure-cycle-unresolved.js --case <suggestionId>
  node measure-cycle-unresolved.js                 # lists cycles with counts, exits 1
  node measure-cycle-unresolved.js --help

READ-ONLY against Dataverse. Writes benchmarks/institution-pair-consistency/results/cycle-measure-<slug>.json
and refuses to overwrite an existing slug file.`);
}

function parseArgs(argv) {
  const args = {
    cycle: null, slug: null, limit: null, timeoutMs: DEFAULT_TIMEOUT_MS, caseId: null, help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--cycle') { args.cycle = argv[i + 1] || null; i += 1; }
    else if (arg === '--slug') { args.slug = argv[i + 1] || null; i += 1; }
    else if (arg === '--case') { args.caseId = argv[i + 1] || null; i += 1; }
    else if (arg === '--limit') { const v = Number(argv[i + 1]); if (Number.isFinite(v) && v > 0) args.limit = v; i += 1; }
    else if (arg === '--timeout-ms') { const v = Number(argv[i + 1]); if (Number.isFinite(v) && v > 0) args.timeoutMs = v; i += 1; }
  }
  return args;
}

function buildCheckers() {
  // eslint-disable-next-line global-require
  const { createInstitutionConsistencyChecker } = require('../../lib/services/institution-affiliation-consistency');
  // eslint-disable-next-line global-require
  const { createInstitutionIdentityResolver } = require('../../lib/services/institution-identity-resolver');
  const sharedResolver = createInstitutionIdentityResolver({ propagateProviderErrors: true });
  const incumbentChecker = createInstitutionConsistencyChecker({ resolver: sharedResolver, segmentComparison: false });
  const stagedChecker = createInstitutionConsistencyChecker({ resolver: sharedResolver, segmentComparison: true });
  return { sharedResolver, incumbentChecker, stagedChecker };
}

async function runCaseDebug(caseId) {
  loadEnvLocal();
  const token = await getToken();
  const [suggestion] = await getAll(
    token,
    `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,wmkf_grantcyclecode,wmkf_revieweraffiliation&$filter=wmkf_appreviewersuggestionid eq ${odataString(caseId)}`,
  );
  if (!suggestion) {
    console.error(`No suggestion found for id ${caseId}`);
    process.exit(1);
    return;
  }
  const pid = suggestion._wmkf_potentialreviewer_value;
  console.log(`suggestion ${caseId}: cycle=${suggestion.wmkf_grantcyclecode || '(none)'} personId=${pid || '(none)'}`);
  if (!pid) { console.log('No linked person; nothing to measure.'); process.exit(1); return; }

  const [person] = await fetchPersonsByIds(token, [pid]);
  if (!person) { console.log('Linked person not found.'); process.exit(1); return; }

  console.log(`person ${pid}: identityStatus=${person.wmkf_identitystatus || '(null)'}`);
  console.log(`  claimed (wmkf_primaryaffiliation): ${JSON.stringify(person.wmkf_primaryaffiliation || null)}`);
  const { anchors, parseOk, blank } = parseAnchorsJson(person.wmkf_identityverifiedanchorsjson);
  console.log(`  anchors: blank=${blank} parseOk=${parseOk} count=${anchors.length} types=${JSON.stringify(anchors.map((a) => a && a.type))}`);
  console.log(`  evidenceSummary present=${Boolean(person.wmkf_identityevidencesummary)} length=${(person.wmkf_identityevidencesummary || '').length}`);
  const evidenceInsts = affiliationMatchInstitutions(anchors);
  console.log(`  evidence institutions (affiliation_match): ${JSON.stringify(evidenceInsts)}`);

  if (!person.wmkf_primaryaffiliation || evidenceInsts.length === 0) {
    console.log('Not measurable (missing claimed institution or evidence institution).');
    process.exit(0);
    return;
  }

  const { incumbentChecker, stagedChecker } = buildCheckers();
  for (const evidence of evidenceInsts) {
    // eslint-disable-next-line no-await-in-loop -- single-case debug, sequential is fine
    const result = await replayOnePair(
      { claimedInstitution: person.wmkf_primaryaffiliation.trim(), evidenceInstitution: evidence, personIds: [pid] },
      { incumbentChecker, stagedChecker, timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    console.log(JSON.stringify(result, null, 2));
  }
  process.exit(0);
}

async function listCyclesAndExit(token) {
  console.log('No --cycle given. Distinct wmkf_grantcyclecode values in wmkf_appreviewersuggestions:');
  const rows = await getAll(token, '/wmkf_appreviewersuggestions?$select=wmkf_grantcyclecode');
  const counts = new Map();
  for (const r of rows) {
    const code = r.wmkf_grantcyclecode || '(blank)';
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  for (const [code, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code}: ${count}`);
  }
  console.error('\nPass --cycle <code> to measure a specific cycle.');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printUsage(); process.exit(0); return; }

  if (args.caseId) {
    await runCaseDebug(args.caseId);
    return;
  }

  loadEnvLocal();
  const token = await getToken();

  if (!args.cycle) {
    await listCyclesAndExit(token);
    return;
  }

  if (!args.slug || !/^[\w.-]+$/.test(args.slug)) {
    console.error('Error: --slug <name> is required (bare filename fragment, no path separators).');
    printUsage();
    process.exit(2);
    return;
  }
  const outPath = path.join(RESULTS_DIR, `cycle-measure-${args.slug}.json`);
  if (fs.existsSync(outPath)) {
    console.error(`Refusing to overwrite existing results: ${outPath}`);
    console.error('Frozen result files are the record — pick a new slug.');
    process.exit(2);
    return;
  }

  console.log(`Cycle-unresolved pair-consistency measurement — cycle=${args.cycle} — ${new Date().toISOString()} (READ-ONLY)`);

  const suggestions = await getAll(
    token,
    `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,wmkf_revieweraffiliation&$filter=wmkf_grantcyclecode eq '${odataString(args.cycle)}'`,
  );
  const distinctPersonIds = [...new Set(suggestions.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];

  if (distinctPersonIds.length === 0) {
    console.log('No suggestions with a linked person found for this cycle. Nothing to measure.');
    const funnel = buildFunnel({
      suggestions, distinctPersonIds, persons: [], limit: args.limit,
    });
    printFunnel(funnel);
    process.exit(1);
    return;
  }

  const persons = await fetchPersonsByIds(token, distinctPersonIds);
  const funnel = buildFunnel({
    suggestions, distinctPersonIds, persons, limit: args.limit,
  });
  printFunnel(funnel);

  if (funnel.measurablePersons === 0) {
    console.log('\nNo measurable pairs (evidence too sparse). This IS the finding — see funnel above for denominators.');
    console.log('Per scope: this tool does not perform live ORCID/OpenAlex re-discovery to manufacture evidence.');
    const artifact = {
      ranAt: new Date().toISOString(),
      cycle: args.cycle,
      slug: args.slug,
      limit: args.limit,
      funnel,
      pairs: [],
      resolverMetrics: null,
      ok: false,
      note: 'No measurable pairs; see funnel for denominators. No checker replay was run.',
      provenance: buildProvenance({ scriptPath: __filename, caseFiles: [] }),
    };
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`\nWrote results to ${outPath}`);
    process.exit(1);
    return;
  }

  // Rebuild the withEvidence list the same way buildFunnel did internally,
  // so buildMeasurablePairs sees the exact same (post-limit) person set.
  const inScope = persons.filter((p) => isInScopeBucket(identityStatusBucket(p.wmkf_identitystatus)));
  const inScopeAfterLimit = args.limit ? inScope.slice(0, args.limit) : inScope;
  const withEvidence = [];
  for (const p of inScopeAfterLimit) {
    const claimed = (p.wmkf_primaryaffiliation || '').trim();
    if (!claimed) continue;
    const { anchors } = parseAnchorsJson(p.wmkf_identityverifiedanchorsjson);
    const insts = affiliationMatchInstitutions(anchors);
    if (insts.length > 0) withEvidence.push({ person: p, evidenceInstitutions: insts });
  }
  const pairs = buildMeasurablePairs(withEvidence);

  console.log(`\nReplaying ${pairs.length} deduped (claimed, evidence) pairs through both checker arms...`);
  const { sharedResolver, incumbentChecker, stagedChecker } = buildCheckers();
  const pairResults = await mapWithConcurrency(
    pairs,
    DEFAULT_CONCURRENCY,
    (pair) => replayOnePair(pair, { incumbentChecker, stagedChecker, timeoutMs: args.timeoutMs }),
  );

  const resolverMetrics = sharedResolver.metrics;
  console.log('\nResolver metrics (shared across both checker configs):', JSON.stringify(resolverMetrics));
  const overallOk = printHeadline(pairResults, resolverMetrics);

  const provenance = buildProvenance({ scriptPath: __filename, caseFiles: [] });
  const artifact = {
    ranAt: new Date().toISOString(),
    cycle: args.cycle,
    slug: args.slug,
    limit: args.limit,
    timeoutMs: args.timeoutMs,
    concurrency: DEFAULT_CONCURRENCY,
    ok: overallOk,
    funnel,
    pairs: pairResults,
    resolverMetrics,
    provenance,
  };
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\nWrote results to ${outPath}`);
  process.exit(overallOk ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err?.stack || err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  identityStatusBucket,
  isInScopeBucket,
  parseAnchorsJson,
  affiliationMatchInstitutions,
  tallyAnchorTypes,
  buildFunnel,
  buildMeasurablePairs,
  replayOnePair,
  odataString,
  chunk,
};
