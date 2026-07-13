#!/usr/bin/env node
/**
 * Lone-ORCID + Scholar corroboration backfill (S219 — the S215 residual).
 *
 * The S215 ORCID backfill (scripts/backfill-orcid-identity.js) only PERSISTED the
 * institution-corroborated ORCIDs (strong anchor → `probable` from ORCID alone),
 * deliberately leaving the 454 LONE-ORCID rows (name-only match → lone weak anchor
 * → `unresolved`) for the normal enrichment flow. This finishes that residual: it
 * runs Google Scholar over exactly those lone rows and, when a CLEAN Scholar profile
 * is found (name- AND institution-OK), feeds BOTH weak anchors (lone public ORCID +
 * clean Scholar) through the SAME resolver the live code uses. Two corroborating weak
 * anchors → `probable` → persist-eligible → the authoritative ORCID gets written.
 *
 * The ORCID anchor is reconstructed from the S215 resolve checkpoint
 * (scripts/.orcid-backfill.jsonl) — an ORCID iD is stable, so we do NOT re-call ORCID.
 * Only Scholar is fetched (the missing second anchor). Scholar is used PURELY as
 * corroborating evidence: we write the ORCID + the identity decision, but NOT the
 * Scholar id/url/metrics (conservative — matches the S215 ORCID-only write).
 *
 * The Scholar fetch is done locally (mirroring SerpContactService.findScholarProfileViaGoogle's
 * query + result loop) but THROWS on a non-OK / rate-limited SerpAPI response so a
 * transient blip RETRIES instead of being silently recorded as "no Scholar profile"
 * (which would permanently suppress yield on rerun). The identity-critical classifiers
 * (scholarNameMismatch / institutionConflicts / extractScholarDisplayName) are reused
 * verbatim from SerpContactService — no drift on the part that matters.
 *
 * Writes go through the SAME safety-gated adapters as the live code (no bypass):
 *   - upsertByPotentialReviewer is FILL-IF-EMPTY on wmkf_orcid → never clobbers a
 *     self-reported / pre-existing ORCID (PR4 sticky-`confirmed` invariant preserved).
 *   - writeIdentityDecision returns early when stored status is `confirmed` → never
 *     downgrades a human attestation.
 *   - --apply ALSO re-reads the live row first: if it already carries a DIFFERENT
 *     non-empty ORCID, both writes are skipped + logged (the decision's evidence must
 *     never reference an ORCID the record doesn't hold).
 *
 * Three phases, each RESUMABLE + idempotent:
 *   node scripts/backfill-lone-orcid-scholar.js --resolve   # READ-ONLY: Scholar over the 454 lone rows → .lone-orcid-scholar.jsonl (~1 SerpAPI Google call each; sch_error rows retry on rerun)
 *   node scripts/backfill-lone-orcid-scholar.js --summary    # print what --apply would write (no calls)
 *   node scripts/backfill-lone-orcid-scholar.js --apply      # WRITES persist-eligible verdicts to Dataverse
 *
 * Checkpoints: scripts/.lone-orcid-scholar.jsonl (resolve, last-entry-per-id wins) +
 * scripts/.lone-orcid-scholar-applied.jsonl (apply) + scripts/.lone-orcid-scholar-conflicts.jsonl. All gitignored.
 */
import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue; let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const MODE = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--summary') ? 'summary'
  : process.argv.includes('--resolve') ? 'resolve' : null;
if (!MODE) { console.error('Pass one of: --resolve | --summary | --apply'); process.exit(1); }
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const SOURCE_LOG = join(__dirname, '.orcid-backfill.jsonl');          // S215 ORCID resolve checkpoint (read-only input)
const RESOLVE_LOG = join(__dirname, '.lone-orcid-scholar.jsonl');     // this script's Scholar resolve checkpoint
const APPLIED_LOG = join(__dirname, '.lone-orcid-scholar-applied.jsonl');
const CONFLICT_LOG = join(__dirname, '.lone-orcid-scholar-conflicts.jsonl');

const SERP = process.env.SERP_API_KEY;
const SERP_URL = 'https://serpapi.com/search.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

/** Read a resumable jsonl checkpoint keeping the LAST entry per id (so retried rows supersede earlier errors). */
function readJsonlLastById(f) {
  const m = new Map();
  for (const e of readJsonl(f)) m.set(e.id, e);
  return m;
}

async function withRetry(fn, label, max = 4) {
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      const transient = e?.isTransient || e?.status === 429 || /429|timeout|ETIMEDOUT|socket/i.test(e?.message || '');
      if (!transient || attempt >= max) throw e;
      console.log(`  retry ${attempt}/${max - 1} after transient error on ${label}: ${e.message?.slice(0, 80)} (backoff ${delay}ms)`);
      await sleep(delay); delay *= 2;
    }
  }
}

/** The lone-ORCID rows from the S215 checkpoint: name-resolved ORCID, NOT institution-corroborated, left unresolved. */
function loneRows() {
  return readJsonl(SOURCE_LOG).filter((e) =>
    e.orcidStatus === 'resolved' && e.corroborated === false && e.orcidId && e.verdict === 'unresolved');
}

/** Reconstruct the ORCID evidence object the resolver expects (findContact result shape) from a checkpoint row. */
function orcidEvidence(e) {
  return {
    status: 'resolved',
    orcidId: e.orcidId,
    orcidUrl: e.orcidUrl || (e.orcidId ? `https://orcid.org/${e.orcidId}` : null),
    institutionCorroborated: false, // lone by definition
    name: e.name || null,
    matchedInstitution: null,
  };
}

/**
 * Fetch + classify a Google Scholar profile for one reviewer. Mirrors
 * SerpContactService.findScholarProfileViaGoogle's query + result loop, but THROWS
 * on a non-OK / rate-limited response (so withRetry can retry transient failures
 * rather than letting a 429 masquerade as "no profile"). Returns the scholar
 * evidence object, or null for a genuine no-profile (real 200 with no citations hit).
 */
async function fetchScholar(SerpContactService, ContactParser, name, affiliation, apiKey) {
  const cleanName = ContactParser.stripHonorifics(name);
  const institution = SerpContactService.extractInstitution(affiliation);
  const query = institution
    ? `"${cleanName}" ${institution} site:scholar.google.com`
    : `"${cleanName}" site:scholar.google.com`;
  const params = new URLSearchParams({ engine: 'google', q: query, num: '5', api_key: apiKey });

  const res = await fetch(`${SERP_URL}?${params}`);
  if (!res.ok) {
    const err = new Error(`SerpAPI HTTP ${res.status}`);
    err.status = res.status;
    err.isTransient = res.status === 429 || res.status >= 500;
    throw err;
  }
  const data = await res.json();
  // SerpAPI 200s with a JSON `error` body in two very different cases:
  //   - genuine zero results ("Google hasn't returned any results for this query.") → NOT an error;
  //     fall through so organic_results is empty → return null (a real `sch_none`), matching the
  //     live findScholarProfileViaGoogle which never inspects data.error.
  //   - throttling/quota → a TRANSIENT error we must retry, never record as terminal.
  if (data.error && /rate|limit|throttl|temporarily|quota|too many requests/i.test(data.error)) {
    const err = new Error(`SerpAPI throttled: ${data.error}`);
    err.isTransient = true;
    throw err;
  }

  for (const result of data.organic_results || []) {
    if (result.link && result.link.includes('scholar.google.com/citations')) {
      const userMatch = result.link.match(/user=([^&]+)/);
      const scholarId = userMatch ? userMatch[1] : null;
      if (!scholarId) continue;
      return {
        scholarId,
        googleScholarUrl: result.link,
        displayName: SerpContactService.extractScholarDisplayName(result.title),
        nameMismatch: SerpContactService.scholarNameMismatch(name, result.title),
        institutionMismatch: SerpContactService.institutionConflicts(affiliation, result.snippet),
        skipped: null,
      };
    }
  }
  return null; // genuine no Scholar profile
}

// ── RESOLVE: Scholar over the lone rows, re-run the resolver with both anchors ──
async function runResolve() {
  if (!SERP) { console.error('SERP_API_KEY missing — aborting.'); process.exit(1); }
  const { SerpContactService } = await import('../lib/services/serp-contact-service.js');
  const { ContactParser } = await import('../lib/utils/contact-parser.js');
  const { resolveIdentity, mayPersistIdentity } = await import('../lib/services/reviewer-identity-resolver.js');

  const lone = loneRows();
  const prior = readJsonlLastById(RESOLVE_LOG);
  // A row is "done" only if its latest entry is a NON-error terminal state; sch_error rows retry.
  const done = new Set([...prior.values()].filter((e) => e.schStatus !== 'sch_error').map((e) => e.id));
  const todo = lone.filter((r) => !done.has(r.id));
  console.log(`lone-ORCID rows=${lone.length}  done(non-error)=${done.size}  to-score=${todo.length}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}\n`);

  let i = 0, eligible = 0, errors = 0;
  for (const r of todo) {
    if (i >= LIMIT) break;
    i++;
    const { id, name, aff } = r;

    let scholar = null, schStatus;
    try {
      scholar = await withRetry(() => fetchScholar(SerpContactService, ContactParser, name, aff, SERP), `scholar ${name}`);
      if (scholar && scholar.scholarId) {
        schStatus = (scholar.nameMismatch || scholar.institutionMismatch) ? 'sch_rejected' : 'sch_clean';
      } else {
        scholar = null;
        schStatus = 'sch_none';
      }
    } catch (e) {
      schStatus = 'sch_error';
      errors++;
      console.log(`  sch_error ${name}: ${e.message?.slice(0, 80)} (will retry on rerun)`);
    }
    await sleep(700); // stay comfortably under the 3000/hr account rate limit

    let decision = null, elig = false;
    if (schStatus === 'sch_clean') {
      decision = resolveIdentity(
        { name, claimedInstitution: aff },
        { scholar, orcid: orcidEvidence(r), affiliation: aff },
      );
      elig = mayPersistIdentity(decision.status);
    }
    if (elig) eligible++;

    appendFileSync(RESOLVE_LOG, JSON.stringify({
      id, name, aff,
      orcidId: r.orcidId,
      orcidUrl: orcidEvidence(r).orcidUrl,
      schStatus,
      scholarId: scholar?.scholarId || null,
      verdict: decision?.status || 'unresolved',
      eligible: elig,
      decision, // full ResolvedIdentity for writeIdentityDecision in --apply
    }) + '\n');
    if (i % 25 === 0) console.log(`  …${i}/${todo.length}  (eligible: ${eligible}, errors: ${errors})`);
  }
  console.log(`\nResolve pass done. Processed ${i} this run; ${eligible} newly eligible, ${errors} transient errors (re-run to retry). Then --summary / --apply.`);
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────
function runSummary() {
  const entries = [...readJsonlLastById(RESOLVE_LOG).values()];
  if (!entries.length) { console.log('No Scholar resolve checkpoint yet — run --resolve first.'); return; }
  const applied = new Set(readJsonl(APPLIED_LOG).map((e) => e.id));
  const conflicts = new Set(readJsonl(CONFLICT_LOG).map((e) => e.id));
  const tally = {};
  for (const e of entries) tally[e.schStatus] = (tally[e.schStatus] || 0) + 1;
  const eligible = entries.filter((e) => e.eligible);
  const pending = eligible.filter((e) => !applied.has(e.id) && !conflicts.has(e.id));
  console.log(`lone-ORCID candidates in source: ${loneRows().length}`);
  console.log(`Scholar resolve checkpoint (deduped by id): ${entries.length} rows`);
  console.log('by Scholar status:', tally);
  console.log(`ELIGIBLE to persist (lone ORCID + clean Scholar → probable): ${eligible.length}  (applied: ${applied.size}, conflicts: ${conflicts.size}, pending: ${pending.length})`);
  if (entries.some((e) => e.schStatus === 'sch_error')) console.log(`⚠ ${tally.sch_error} sch_error rows remain — re-run --resolve to retry before --apply.`);
  console.log('\nsample of pending writes:');
  for (const e of pending.slice(0, 10)) console.log(`  ${e.name}  ${e.orcidId}  scholar=${e.scholarId}`);
}

// ── APPLY: write persist-eligible verdicts (ORCID + identity decision only) ─────
async function runApply() {
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const researcherAdapter = await import('../lib/dataverse/adapters/researcher.js');
  const { normalizeName } = await import('../lib/utils/name-normalization.js');
  const ENTITY_SET = 'wmkf_potentialreviewerses';

  const entries = [...readJsonlLastById(RESOLVE_LOG).values()].filter((e) => e.eligible && e.orcidId && e.decision);
  const applied = new Set(readJsonl(APPLIED_LOG).map((e) => e.id));
  const conflicts = new Set(readJsonl(CONFLICT_LOG).map((e) => e.id));
  const pending = entries.filter((e) => !applied.has(e.id) && !conflicts.has(e.id));
  console.log(`eligible=${entries.length}  already-applied=${applied.size}  prior-conflicts=${conflicts.size}  pending=${pending.length}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}\n`);

  await bypassDynamicsRestrictions('backfill-lone-orcid-scholar-apply', async () => {
    let i = 0, ok = 0, failed = 0, conflict = 0;
    for (const e of pending) {
      if (i >= LIMIT) break;
      i++;
      try {
        // Re-read live: never write a decision whose evidence references an ORCID the record won't hold.
        // Direct getRecord (NOT getByPotentialReviewer, which swallows read errors → null) so an
        // unverifiable read THROWS → lands in the catch below as FAILED, fail-closed — never a silent proceed.
        // (A vanishing TOCTOU window remains between this read and the writes; acceptable for a single-operator
        // one-shot backfill — upsert is still fill-if-empty and writeIdentityDecision still skips `confirmed`.)
        const live = await withRetry(
          () => DynamicsService.getRecord(ENTITY_SET, e.id, { select: 'wmkf_potentialreviewersid,wmkf_orcid' }),
          `read ${e.name}`);
        if (!live) throw new Error('live row read returned empty — cannot verify ORCID, skipping write');
        const liveOrcid = (live.wmkf_orcid || '').trim();
        if (liveOrcid && liveOrcid !== e.orcidId) {
          appendFileSync(CONFLICT_LOG, JSON.stringify({ id: e.id, name: e.name, checkpointOrcid: e.orcidId, liveOrcid }) + '\n');
          console.log(`  CONFLICT ${e.name} (${e.id}): live ORCID ${liveOrcid} ≠ checkpoint ${e.orcidId} — skipped`);
          conflict++;
          continue;
        }
        // fill-if-empty orcid (never clobbers a pre-existing/self-reported ORCID)
        await withRetry(() => researcherAdapter.upsertByPotentialReviewer(e.id, {
          name: e.name, normalizedName: normalizeName(e.name), orcid: e.orcidId, orcidUrl: e.orcidUrl,
        }), `upsert ${e.name}`);
        await sleep(120);
        // returns early if stored status is `confirmed` (sticky human attestation)
        await withRetry(
          () => researcherAdapter.writeIdentityDecision(e.id, e.decision, { identityOrigin: 'automated' }),
          `decision ${e.name}`,
        );
        await sleep(120);
        appendFileSync(APPLIED_LOG, JSON.stringify({ id: e.id, orcidId: e.orcidId }) + '\n');
        ok++;
      } catch (err) {
        failed++;
        console.log(`  FAILED ${e.name} (${e.id}): ${err.message?.slice(0, 120)}`);
      }
      if (i % 50 === 0) console.log(`  …${i}/${pending.length}  ok=${ok} conflict=${conflict} failed=${failed}`);
    }
    console.log(`\nApply done. ${ok} persisted, ${conflict} ORCID-conflict skips, ${failed} failed this run. Re-run --apply to resume failures.`);
  });
}

if (MODE === 'resolve') await runResolve();
else if (MODE === 'summary') runSummary();
else if (MODE === 'apply') await runApply();
