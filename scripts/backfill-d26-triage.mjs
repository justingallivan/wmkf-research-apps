/**
 * backfill-d26-triage.mjs — One-time 3-bucket backfill of the Workbench triage
 * field (`akoya_request.wmkf_triagestatus`) for the D26 cycle.
 *
 * Seeds the new triage field from the throwaway allowlist (shared/config/
 * d26Allowlist.js) so the dashboard can switch off the allowlist branch. Runs
 * AFTER the field is deployed (staging order: deploy field -> dry-run this ->
 * --execute -> switch dashboard -> retire allowlist).
 *
 * THREE BUCKETS (Codex r2 — membership-keyed, NOT status-keyed):
 *   A. Advancing  (100000000): every number in D26_ALLOWLIST_REQUEST_NUMS
 *                  EXCEPT the test request 1002788, regardless of current
 *                  akoya_requeststatus (an allowlisted row already at 'Phase II
 *                  Pending' must STILL be Advancing or the new query hides it).
 *   B. Set aside  (100000001): D26-cycle proposals at akoya_requeststatus =
 *                  'Phase I Pending' that are NOT in the Advancing set. The test
 *                  request 1002788 lands here -> hidden.
 *   (untriaged/null): everything else — left untouched.
 *
 * ABORT THRESHOLDS [DEFAULT — confirm at impl, Codex r2 RISK B]:
 *   - expected Bucket A = advancing-allowlist length (computed from the array).
 *   - ABORT if any advancing-allowlist number is unresolved in Dataverse, OR
 *     resolved Bucket A != expected.
 *   - Bucket B is variable: require --force if Bucket B is 0 or > 400 (sanity
 *     band around the scoping doc's ~200 D26 long-list; the dry-run proves it).
 *
 * SAFETY: dry-run by DEFAULT — prints exactly what it WOULD write and the abort
 * checks. Pass --execute to write. Idempotent (skips rows already at target).
 * Restriction-bypassed. Acts against whatever .env.local points at (prod
 * Dataverse) — confirm the dry-run before --execute.
 *
 * Usage:
 *   node scripts/backfill-d26-triage.mjs            # dry-run (default)
 *   node scripts/backfill-d26-triage.mjs --execute  # write
 *   node scripts/backfill-d26-triage.mjs --force    # override Bucket-B sanity band
 *   node scripts/backfill-d26-triage.mjs --help
 */

import fs from 'fs';
import { D26_ALLOWLIST_CYCLE_CODE, D26_ALLOWLIST_REQUEST_NUMS } from '../shared/config/d26Allowlist.js';
import { TRIAGE_STATUS, TRIAGE_LABEL } from '../shared/config/triageStatus.js';
import { cycleCodeToOdataFilter } from '../lib/utils/cycle-code.js';

// --- env: load .env.local (same pattern as the other scripts) -----------------
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {
  console.error('Could not read .env.local — run from the repo root.');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 52).join('\n').replace(/^ \*?/gm, ''));
  process.exit(0);
}
const EXECUTE = args.includes('--execute');
const FORCE = args.includes('--force');

const TEST_REQ = '1002788';
const ENTITY_SET = 'akoya_requests';
const FIELD = 'wmkf_triagestatus';
const SELECT = `akoya_requestid,akoya_requestnum,akoya_requeststatus,${FIELD}`;
const PHASE_I = 'Phase I Pending';
const BUCKET_B_MAX = 400; // sanity ceiling; > this needs --force

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('backfill-d26-triage');

const advancingNums = D26_ALLOWLIST_REQUEST_NUMS.map(String).filter((n) => n !== TEST_REQ);
const expectedBucketA = advancingNums.length;

function esc(n) { return String(n).replace(/'/g, "''"); }

// Resolve the advancing allowlist numbers -> rows (chunked OR over the string
// akoya_requestnum). Returns a Map<num, row>.
async function resolveAdvancing() {
  const byNum = new Map();
  const CHUNK = 20;
  for (let i = 0; i < advancingNums.length; i += CHUNK) {
    const chunk = advancingNums.slice(i, i + CHUNK);
    const orChain = chunk.map((n) => `akoya_requestnum eq '${esc(n)}'`).join(' or ');
    const { records } = await DynamicsService.queryAllRecords(ENTITY_SET, {
      select: SELECT,
      filter: `(${orChain})`,
    });
    for (const r of records) byNum.set(String(r.akoya_requestnum), r);
  }
  return byNum;
}

// D26-cycle Phase-I-Pending rows (the Bucket B candidate pool, before excluding
// the Advancing set). Defensive cycle (meeting-date) filter mirrors the dashboard.
async function fetchPhaseIPendingInCycle() {
  const cycleFilter = cycleCodeToOdataFilter(D26_ALLOWLIST_CYCLE_CODE);
  if (!cycleFilter) throw new Error(`Could not build cycle filter for ${D26_ALLOWLIST_CYCLE_CODE}`);
  const { records } = await DynamicsService.queryAllRecords(ENTITY_SET, {
    select: SELECT,
    filter: `(${cycleFilter}) and akoya_requeststatus eq '${PHASE_I}'`,
  });
  return records;
}

async function main() {
  console.log(`\n=== D26 triage backfill — ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}${FORCE ? ' (--force)' : ''} ===\n`);

  // --- Bucket A: resolve + abort checks -------------------------------------
  const advRows = await resolveAdvancing();
  const unresolved = advancingNums.filter((n) => !advRows.has(n));
  const resolvedCount = advRows.size;

  // Split reporting: Phase-I-Pending vs already-Phase-II vs other.
  let aPhaseI = 0, aPhaseII = 0, aOther = 0;
  for (const r of advRows.values()) {
    const s = r.akoya_requeststatus;
    if (s === PHASE_I) aPhaseI++;
    else if (s === 'Phase II Pending') aPhaseII++;
    else aOther++;
  }

  console.log(`Bucket A (Advancing): expected ${expectedBucketA}, resolved ${resolvedCount}`);
  console.log(`  status split — Phase I Pending: ${aPhaseI}, already Phase II Pending: ${aPhaseII}, other: ${aOther}`);
  if (unresolved.length) console.log(`  UNRESOLVED in Dataverse: ${unresolved.join(', ')}`);

  const bucketAAbort = unresolved.length > 0 || resolvedCount !== expectedBucketA;
  console.log(`  abort check: ${bucketAAbort ? 'FAIL' : 'PASS'}` +
    (bucketAAbort ? ` (unresolved=${unresolved.length}, resolved!=expected=${resolvedCount !== expectedBucketA})` : ''));

  // --- Bucket B: D26 Phase-I-Pending minus the Advancing set -----------------
  const advIds = new Set([...advRows.values()].map((r) => r.akoya_requestid));
  const phaseIRows = await fetchPhaseIPendingInCycle();
  const bucketB = phaseIRows.filter((r) => !advIds.has(r.akoya_requestid));
  const test788InB = bucketB.some((r) => String(r.akoya_requestnum) === TEST_REQ);

  console.log(`\nBucket B (Set aside): ${bucketB.length} D26 Phase-I-Pending row(s) not in Advancing` +
    ` (test request ${TEST_REQ} included: ${test788InB})`);
  const bucketBSanity = bucketB.length === 0 || bucketB.length > BUCKET_B_MAX;
  if (bucketBSanity) {
    console.log(`  sanity band: OUT OF RANGE (0 or > ${BUCKET_B_MAX}) — requires --force${FORCE ? ' (provided)' : ''}`);
  } else {
    console.log(`  sanity band: OK (1..${BUCKET_B_MAX})`);
  }

  // --- Gate ------------------------------------------------------------------
  if (bucketAAbort) {
    console.error('\nABORT: Bucket A failed its abort check. No writes performed.');
    process.exit(1);
  }
  // The plan makes "1002788 -> Set aside (hidden)" a firm contract (decision #4).
  // It only lands in Bucket B if it's still D26 Phase I Pending. If it isn't
  // (status changed / deleted), the backfill would silently leave it untriaged
  // (= visible), violating the contract — so hard-abort. This is a correctness
  // contract, NOT a sanity band, so --force does not override it.
  if (!test788InB) {
    console.error(`\nABORT: test request ${TEST_REQ} is not in Bucket B — its "Set aside" contract cannot be met by this run (it may no longer be D26 Phase I Pending). Investigate before proceeding. No writes performed.`);
    process.exit(1);
  }
  if (bucketBSanity && !FORCE) {
    console.error(`\nABORT: Bucket B size ${bucketB.length} is outside the sanity band — re-run with --force if intended. No writes performed.`);
    process.exit(1);
  }

  // --- Plan writes (idempotent: skip rows already at target) -----------------
  const aToWrite = [...advRows.values()].filter((r) => r[FIELD] !== TRIAGE_STATUS.ADVANCING);
  const bToWrite = bucketB.filter((r) => r[FIELD] !== TRIAGE_STATUS.SET_ASIDE);
  const aSkip = resolvedCount - aToWrite.length;
  const bSkip = bucketB.length - bToWrite.length;

  console.log(`\nPlanned writes:`);
  console.log(`  A -> ${TRIAGE_LABEL[TRIAGE_STATUS.ADVANCING]}: ${aToWrite.length} (skip ${aSkip} already at target)`);
  console.log(`  B -> ${TRIAGE_LABEL[TRIAGE_STATUS.SET_ASIDE]}: ${bToWrite.length} (skip ${bSkip} already at target)`);

  if (!EXECUTE) {
    console.log('\nDRY-RUN — no writes performed. Re-run with --execute to apply.');
    return;
  }

  let ok = 0, fail = 0;
  for (const [label, rows, value] of [
    ['Advancing', aToWrite, TRIAGE_STATUS.ADVANCING],
    ['Set aside', bToWrite, TRIAGE_STATUS.SET_ASIDE],
  ]) {
    for (const r of rows) {
      try {
        await DynamicsService.updateRecord(ENTITY_SET, r.akoya_requestid, { [FIELD]: value });
        ok++;
      } catch (e) {
        fail++;
        console.error(`  FAILED ${label} ${r.akoya_requestnum} (${r.akoya_requestid}): ${e?.message || e}`);
      }
    }
  }
  console.log(`\nDone. ${ok} written, ${fail} failed.`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', e?.message || e);
  process.exit(2);
});
