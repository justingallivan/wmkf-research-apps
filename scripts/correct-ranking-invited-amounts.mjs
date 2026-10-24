/**
 * correct-ranking-invited-amounts.mjs — owner-run correction of an OPEN Proposal
 * Ranking round's frozen amounts from requested (akoya_request) to invited
 * (wmkf_invitedamount), without touching assessments, readiness or workflow.
 * Plan: docs/plans/PROPOSAL_RANKING_D26_INVITED_AMOUNT_CORRECTION_2026-10-23.md.
 *
 *   --plan --dir=<folder outside the repo> --approver="<name>"
 *       READ-ONLY. Checks the D26 active round, reads each frozen proposal's live
 *       request, builds the corrected snapshot and one administration-log event,
 *       and writes ranking-invited-plan.json (also kept as -<hash>.json). Prints
 *       the before/after table and the plan hash. No reviewer scores or PD orders.
 *   --apply --dir=<folder> --confirm=<plan hash>
 *       Re-reads the round; refuses unless its ETag and snapshot are exactly as
 *       planned. One If-Match PATCH of wmkf_snapshotjson + wmkf_administrationlogjson
 *       (lib/dataverse/adapters/proposal-ranking.js patchRound). Logs to
 *       ranking-invited-applied.jsonl.
 *   --verify --dir=<folder>
 *       READ-ONLY. Confirms the stored snapshot and log are the planned ones, and
 *       reports whether workflow and list rows are unchanged since the plan.
 *   --rollback --dir=<folder>
 *       Restores the original snapshot and log byte-for-byte, If-Match on the
 *       post-apply ETag. Refuses if the round changed after apply.
 *
 * Write modes need DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>"; every mode
 * that reaches production needs DATAVERSE_ALLOW_PROD_READS=yes.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { correctSnapshot, appendCorrectionEvent, sha } from './lib/ranking-invited-correction.mjs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const CYCLE = 'D26';
const ROUND_ID = '49279ac7-3ab9-41d8-b2d6-5aaf4085e642';
const PROPOSAL_COUNT = 23;
const EXPECTED_CHANGES = ['1002821', '1003000'];
const ROUND_ACTIVE = 100000000;

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const flag = (name) => process.argv.includes(`--${name}`);
const MODE = flag('apply') ? 'apply' : flag('verify') ? 'verify' : flag('rollback') ? 'rollback' : flag('plan') ? 'plan' : null;
const DIR = arg('dir');
if (!MODE || !DIR) { console.error('Usage: --plan|--apply|--verify|--rollback --dir=<folder outside the repo>'); process.exit(2); }
const dirAbs = path.resolve(DIR);
if (dirAbs.startsWith(`${path.resolve('.')}${path.sep}`)) { console.error('--dir must be outside the repository.'); process.exit(2); }
fs.mkdirSync(dirAbs, { recursive: true });
const PLAN = path.join(dirAbs, 'ranking-invited-plan.json');
const LOG = path.join(dirAbs, 'ranking-invited-applied.jsonl');
if ((MODE === 'apply' || MODE === 'rollback') && !process.env.DATAVERSE_PROD_WRITE_ACK) {
  console.error(`Write mode needs DATAVERSE_PROD_WRITE_ACK, e.g. DATAVERSE_PROD_WRITE_ACK="ranking invited amounts ${new Date().toISOString().slice(0, 10)}"`);
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { findCycleCoordinator, readAssessmentRound, listRoundRows, patchRound } = await import('../lib/dataverse/adapters/proposal-ranking.js');

const fail = (message) => { console.error(`Refused: ${message}`); process.exit(1); };
const money = (minor) => `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const appendLog = (entry) => fs.appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
const readLog = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const loadPlan = () => {
  if (!fs.existsSync(PLAN)) fail(`no plan at ${PLAN}; run --plan first.`);
  const text = fs.readFileSync(PLAN, 'utf8');
  return { plan: JSON.parse(text), hash: sha(text).slice(0, 8) };
};
const baselineOf = async (round) => ({
  workflowSha: sha(round.wmkf_workflowjson || ''),
  lists: (await listRoundRows(ROUND_ID)).map((row) => ({ key: row.wmkf_listkey, etag: row['@odata.etag'], status: row.wmkf_status, version: row.wmkf_version })),
});
const sameLists = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function plan() {
  const approver = arg('approver');
  if (!approver) fail('--approver="<name>" is required; it is recorded in the round log.');
  const outcomes = readLog().map((e) => e.outcome);
  if (outcomes.lastIndexOf('applied') > outcomes.lastIndexOf('rolled_back')) fail(`${LOG} records an applied run; verify or roll it back first.`);
  const coordinator = await findCycleCoordinator(CYCLE);
  if (coordinator?.wmkf_activeroundid?.toLowerCase() !== ROUND_ID) fail(`${CYCLE} active round is ${coordinator?.wmkf_activeroundid || 'none'}, not ${ROUND_ID}.`);
  const round = await readAssessmentRound(ROUND_ID);
  if (round.wmkf_state !== ROUND_ACTIVE) fail(`round state is ${round.wmkf_state}, not active.`);
  if (!round['@odata.etag']) fail('round has no ETag.');
  const snapshot = JSON.parse(round.wmkf_snapshotjson);
  if (snapshot.proposals?.length !== PROPOSAL_COUNT) fail(`snapshot has ${snapshot.proposals?.length} proposals, expected ${PROPOSAL_COUNT}.`);

  const liveById = new Map();
  for (const { requestId } of snapshot.proposals) {
    const row = await DynamicsService.getRecord('akoya_requests', requestId, {
      select: 'akoya_requestid,akoya_requestnum,akoya_request,wmkf_invitedamount,wmkf_istestrequest,wmkf_testcreationrunid',
    });
    liveById.set(String(row.akoya_requestid).toLowerCase(), row);
  }
  let corrected;
  try { corrected = correctSnapshot(round.wmkf_snapshotjson, liveById); } catch (error) { fail(error.message); }
  const changed = corrected.changes.map((c) => c.requestNumber).sort();
  if (JSON.stringify(changed) !== JSON.stringify([...EXPECTED_CHANGES].sort())) fail(`changes are [${changed.join(', ')}], expected [${EXPECTED_CHANGES.join(', ')}].`);

  const operationId = crypto.randomUUID();
  const at = new Date().toISOString();
  const logJson = appendCorrectionEvent(round.wmkf_administrationlogjson, {
    operationId, at, approver, script: 'scripts/correct-ranking-invited-amounts.mjs',
    reason: 'Frozen amounts corrected from requested to invited amount.',
    changes: corrected.changes.map(({ requestNumber, fromMinorUnits, toMinorUnits }) => ({ requestNumber, fromMinorUnits, toMinorUnits })),
  });
  const workflow = JSON.parse(round.wmkf_workflowjson || '{}');
  const doc = {
    cycle: CYCLE, roundId: ROUND_ID, createdAt: at, approver, operationId,
    etag: round['@odata.etag'],
    original: { snapshotSha: sha(round.wmkf_snapshotjson), snapshotJson: round.wmkf_snapshotjson, logJson: round.wmkf_administrationlogjson ?? null },
    corrected: { snapshotSha: sha(corrected.snapshotJson), snapshotJson: corrected.snapshotJson, logJson },
    changes: corrected.changes,
    baseline: await baselineOf(round),
    workflowStage: { stage: workflow.stage ?? null, preparationVersion: workflow.preparationVersion ?? null, revealId: workflow.revealId ?? null },
  };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  fs.writeFileSync(PLAN, text);
  fs.writeFileSync(path.join(dirAbs, `ranking-invited-plan-${sha(text).slice(0, 8)}.json`), text);

  console.log(`Round ${ROUND_ID} (${CYCLE}): active, ${snapshot.proposals.length} proposals, stage ${doc.workflowStage.stage}, reveal ${doc.workflowStage.revealId ? 'done' : 'not yet'}.`);
  console.log(`List rows: ${doc.baseline.lists.length}.`);
  console.log('\nChanges:');
  for (const c of corrected.changes) console.log(`  #${c.requestNumber}: ${money(c.fromMinorUnits)} -> ${money(c.toMinorUnits)}`);
  console.log(`Unchanged amounts: ${snapshot.proposals.length - corrected.changes.length}; all ${snapshot.proposals.length} tagged amountSource 'invited'.`);
  console.log(`\nWrote ${PLAN}\nPlan hash (pass to --apply --confirm=): ${sha(text).slice(0, 8)}`);
}

async function apply() {
  const { plan: p, hash } = loadPlan();
  if (arg('confirm') !== hash) fail(`--confirm must be the current plan hash ${hash}.`);
  if (readLog().some((e) => e.outcome === 'applied' && e.planHash === hash)) fail('this plan was already applied; run --verify.');
  const round = await readAssessmentRound(ROUND_ID);
  if (round['@odata.etag'] !== p.etag) fail('the round changed since the plan (ETag moved); re-run --plan.');
  if (sha(round.wmkf_snapshotjson) !== p.original.snapshotSha) fail('stored snapshot differs from the plan; re-run --plan.');
  appendLog({ outcome: 'intent', planHash: hash, etag: p.etag });
  try {
    await patchRound(round, { wmkf_snapshotjson: p.corrected.snapshotJson, wmkf_administrationlogjson: p.corrected.logJson });
  } catch (error) {
    appendLog({ outcome: 'failed', planHash: hash, error: String(error?.message || error).slice(0, 300) });
    fail(`PATCH failed: ${error?.message || error}`);
  }
  const after = await readAssessmentRound(ROUND_ID);
  const ok = sha(after.wmkf_snapshotjson) === p.corrected.snapshotSha;
  appendLog({ outcome: ok ? 'applied' : 'applied_mismatch', planHash: hash, postEtag: after['@odata.etag'] });
  console.log(ok ? `Applied. New ETag ${after['@odata.etag']}. Run --verify.` : 'PATCH returned, but readback differs from the plan. Run --verify and stop.');
  if (!ok) process.exit(1);
}

async function verify() {
  const { plan: p } = loadPlan();
  const round = await readAssessmentRound(ROUND_ID);
  const snapshotOk = sha(round.wmkf_snapshotjson) === p.corrected.snapshotSha;
  const logOk = (round.wmkf_administrationlogjson ?? null) === p.corrected.logJson;
  console.log(`Snapshot is the corrected one: ${snapshotOk ? 'yes' : 'NO'}`);
  console.log(`Administration log has the correction event: ${logOk ? 'yes' : 'NO'}`);
  const stored = JSON.parse(round.wmkf_snapshotjson);
  for (const c of p.changes) {
    const proposal = stored.proposals.find((x) => x.requestId === c.requestId);
    console.log(`  #${c.requestNumber}: stored ${money(proposal.amountMinorUnits)} (${proposal.amountSource || 'no source'})`);
  }
  const now = await baselineOf(round);
  console.log(`Workflow unchanged since plan: ${now.workflowSha === p.baseline.workflowSha ? 'yes' : 'no (PD activity since the plan)'}`);
  console.log(`List rows unchanged since plan: ${sameLists(now.lists, p.baseline.lists) ? 'yes' : 'no (PD activity since the plan)'}`);
  if (!snapshotOk || !logOk) process.exit(1);
}

async function rollback() {
  const { plan: p } = loadPlan();
  const applied = readLog().filter((e) => e.outcome === 'applied').pop();
  if (!applied) fail('no applied run in the log.');
  const round = await readAssessmentRound(ROUND_ID);
  if (round['@odata.etag'] !== applied.postEtag) fail('the round changed after apply (ETag moved); plan a reverse edit from current state instead.');
  if (sha(round.wmkf_snapshotjson) !== p.corrected.snapshotSha) fail('stored snapshot is not the corrected one.');
  try {
    await patchRound(round, { wmkf_snapshotjson: p.original.snapshotJson, wmkf_administrationlogjson: p.original.logJson });
  } catch (error) {
    appendLog({ outcome: 'rollback_failed', error: String(error?.message || error).slice(0, 300) });
    fail(`PATCH failed: ${error?.message || error}`);
  }
  const after = await readAssessmentRound(ROUND_ID);
  const ok = sha(after.wmkf_snapshotjson) === p.original.snapshotSha;
  appendLog({ outcome: ok ? 'rolled_back' : 'rollback_mismatch', postEtag: after['@odata.etag'] });
  console.log(ok ? 'Rolled back to the original snapshot and log.' : 'PATCH returned, but readback differs from the original.');
  if (!ok) process.exit(1);
}

await bypassDynamicsRestrictions(`ranking-invited-amounts-${MODE}`, async () => {
  console.log(`host: ${new URL(process.env.DYNAMICS_URL).host}`);
  await { plan, apply, verify, rollback }[MODE]();
});
