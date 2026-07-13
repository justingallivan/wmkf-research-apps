#!/usr/bin/env node
/**
 * ORCID identity backfill (S215). The family-names fix + corroborated-ORCID
 * strong-anchor rule made ORCID capture work, but the existing reviewer pool was
 * populated while ORCID was dead (only ~1 of 4,269 rows has an ORCID). This
 * backfills authoritative ORCID iDs for reviewers whose ORCID resolves to a
 * PERSIST-ELIGIBLE verdict, writing through the SAME resolver gate + adapter the
 * live code uses (no bypass of the safety logic).
 *
 * ORCID-only evidence: a reviewer is persisted iff resolveIdentity() reaches a
 * mayPersistIdentity() status from ORCID alone — i.e. an institution-corroborated
 * ORCID (strong anchor → probable). Lone/uncorroborated/ambiguous/none → skipped
 * (the lone-ORCID+clean-Scholar cases are left to the normal enrichment flow).
 *
 * Two phases, each RESUMABLE and idempotent (skip rows already in the checkpoint):
 *   node scripts/backfill-orcid-identity.js --resolve   # READ-ONLY: ORCID over the pool → .orcid-backfill.jsonl
 *   node scripts/backfill-orcid-identity.js --summary    # print what --apply would write (no calls)
 *   node scripts/backfill-orcid-identity.js --apply      # WRITES persist-eligible verdicts to Dataverse
 *
 * Rows that already carry a wmkf_orcid are skipped (never overwritten). Writes use
 * upsertByPotentialReviewer (fill-if-empty orcid) + writeIdentityDecision, with
 * 429/transient retry+backoff. Checkpoints: scripts/.orcid-backfill.jsonl (resolve)
 * + scripts/.orcid-backfill-applied.jsonl (apply). Both gitignored.
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

const RESOLVE_LOG = join(__dirname, '.orcid-backfill.jsonl');
const APPLIED_LOG = join(__dirname, '.orcid-backfill-applied.jsonl');

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { ORCIDService } = await import('../lib/services/orcid-service.js');
const { resolveIdentity, mayPersistIdentity } = await import('../lib/services/reviewer-identity-resolver.js');
const researcherAdapter = await import('../lib/dataverse/adapters/researcher.js');
const { normalizeName } = await import('../lib/utils/name-normalization.js');

const cid = process.env.ORCID_CLIENT_ID, cs = process.env.ORCID_CLIENT_SECRET;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

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

const PERSON_SET = 'wmkf_potentialreviewerses';
const SELECT = 'wmkf_potentialreviewersid,wmkf_name,wmkf_primaryaffiliation,wmkf_organizationname,wmkf_orcid';

// ── RESOLVE: read-only ORCID over the pool ────────────────────────────────────
async function runResolve() {
  if (!cid || !cs) { console.error('ORCID creds missing — aborting.'); process.exit(1); }
  await bypassDynamicsRestrictions('backfill-orcid-resolve', async () => {
    const { records } = await DynamicsService.queryAllRecords(PERSON_SET, { select: SELECT, filter: 'wmkf_name ne null' });
    const pool = records.filter((r) => (r.wmkf_name || '').trim());
    const done = new Set(readJsonl(RESOLVE_LOG).map((e) => e.id));
    const todo = pool.filter((r) => !done.has(r.wmkf_potentialreviewersid));
    console.log(`pool=${pool.length}  already-resolved=${done.size}  to-resolve=${todo.length}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}\n`);

    let i = 0, eligible = 0;
    for (const p of todo) {
      if (i >= LIMIT) break;
      i++;
      const id = p.wmkf_potentialreviewersid;
      const name = p.wmkf_name.trim();
      const aff = (p.wmkf_primaryaffiliation || p.wmkf_organizationname || '').trim() || null;
      let entry;
      if ((p.wmkf_orcid || '').trim()) {
        entry = { id, name, status: 'skip_has_orcid', eligible: false };
      } else {
        let result = null;
        try { result = await ORCIDService.findContact({ name, affiliation: aff, clientId: cid, clientSecret: cs }); }
        catch (e) { result = { error: e.message }; }
        await sleep(220);
        const orcidStatus = result?.error ? 'error' : (result?.status || 'none');
        let decision = null, elig = false;
        if (result && !result.error && result.orcidId) {
          decision = resolveIdentity({ name, claimedInstitution: aff }, { scholar: null, orcid: result, affiliation: aff });
          elig = mayPersistIdentity(decision.status);
        }
        if (elig) eligible++;
        entry = {
          id, name, aff, orcidStatus,
          corroborated: !!result?.institutionCorroborated,
          orcidId: result?.orcidId || null,
          orcidUrl: result?.orcidUrl || (result?.orcidId ? `https://orcid.org/${result.orcidId}` : null),
          matchedInstitution: result?.matchedInstitution || null,
          verdict: decision?.status || 'unresolved',
          eligible: elig,
          decision, // full ResolvedIdentity for writeIdentityDecision in --apply
        };
      }
      appendFileSync(RESOLVE_LOG, JSON.stringify(entry) + '\n');
      if (i % 50 === 0) console.log(`  …${i}/${todo.length}  (eligible so far this run: ${eligible})`);
    }
    console.log(`\nResolve pass done. Processed ${i} this run; ${eligible} newly eligible. Re-run to resume; then --summary / --apply.`);
  });
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────
function runSummary() {
  const entries = readJsonl(RESOLVE_LOG);
  if (!entries.length) { console.log('No resolve checkpoint yet — run --resolve first.'); return; }
  const applied = new Set(readJsonl(APPLIED_LOG).map((e) => e.id));
  const tally = {};
  for (const e of entries) tally[e.status || e.verdict] = (tally[e.status || e.verdict] || 0) + 1;
  const eligible = entries.filter((e) => e.eligible);
  const pending = eligible.filter((e) => !applied.has(e.id));
  console.log(`resolve checkpoint: ${entries.length} rows`);
  console.log('by status/verdict:', tally);
  console.log(`ELIGIBLE to persist: ${eligible.length}  (already applied: ${applied.size}, pending: ${pending.length})`);
  console.log('\nsample of pending writes:');
  for (const e of pending.slice(0, 10)) console.log(`  ${e.name}  ${e.orcidId}  inst=${JSON.stringify(e.matchedInstitution)}`);
}

// ── APPLY: write persist-eligible verdicts ────────────────────────────────────
async function runApply() {
  const entries = readJsonl(RESOLVE_LOG).filter((e) => e.eligible && e.orcidId && e.decision);
  const applied = new Set(readJsonl(APPLIED_LOG).map((e) => e.id));
  const pending = entries.filter((e) => !applied.has(e.id));
  console.log(`eligible=${entries.length}  already-applied=${applied.size}  pending=${pending.length}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}\n`);

  await bypassDynamicsRestrictions('backfill-orcid-apply', async () => {
    let i = 0, ok = 0, failed = 0;
    for (const e of pending) {
      if (i >= LIMIT) break;
      i++;
      try {
        await withRetry(() => researcherAdapter.upsertByPotentialReviewer(e.id, {
          name: e.name, normalizedName: normalizeName(e.name), orcid: e.orcidId, orcidUrl: e.orcidUrl,
        }), `upsert ${e.name}`);
        await sleep(120);
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
      if (i % 50 === 0) console.log(`  …${i}/${pending.length}  ok=${ok} failed=${failed}`);
    }
    console.log(`\nApply done. ${ok} persisted, ${failed} failed this run. Re-run --apply to resume failures.`);
  });
}

if (MODE === 'resolve') await runResolve();
else if (MODE === 'summary') runSummary();
else if (MODE === 'apply') await runApply();
