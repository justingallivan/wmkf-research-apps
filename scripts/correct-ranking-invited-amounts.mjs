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
 *       Decides from the stored round, not the local log: already corrected -> done;
 *       original with the planned ETag -> one If-Match PATCH of wmkf_snapshotjson +
 *       wmkf_administrationlogjson (adapter patchRound); anything else -> refuse.
 *       After a lost response or crash, run it again.
 *   --verify --dir=<folder>
 *       READ-ONLY. Reports whether the round holds the original or corrected state,
 *       and any app activity since the plan.
 *   --rollback --dir=<folder>
 *       Restores the original snapshot and log byte-for-byte. Refuses unless the round
 *       holds the corrected state AND shows no app write since the plan (last
 *       operation stamp, workflow and list rows all as planned). Re-runnable.
 * ranking-invited-applied.jsonl in --dir is a journal only; no decision reads it.
 *
 * Write modes need DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>"; every mode
 * that reaches production needs DATAVERSE_ALLOW_PROD_READS=yes.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { correctSnapshot, appendCorrectionEvent, sha, roundStateVs, activitySincePlan, decideApply, decideRollback } from './lib/ranking-invited-correction.mjs';

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
const loadPlan = () => {
  if (!fs.existsSync(PLAN)) fail(`no plan at ${PLAN}; run --plan first.`);
  const text = fs.readFileSync(PLAN, 'utf8');
  return { plan: JSON.parse(text), hash: sha(text).slice(0, 8) };
};
const listsOf = async () => (await listRoundRows(ROUND_ID)).map((row) => ({ key: row.wmkf_listkey, etag: row['@odata.etag'], status: row.wmkf_status, version: row.wmkf_version }));
const baselineOf = async (round) => ({
  lastOperationId: round.wmkf_lastoperationid ?? null,
  workflowSha: sha(round.wmkf_workflowjson || ''),
  lists: await listsOf(),
});
// A PATCH whose response was lost may still have committed; the next run reads the round to decide.
async function patchAndReport(round, patch, label) {
  try {
    await patchRound(round, patch);
  } catch (error) {
    appendLog({ outcome: `${label}_unconfirmed`, error: String(error?.message || error).slice(0, 300) });
    fail(`${label} PATCH did not confirm (${error?.message || error}). It may or may not have committed; run --verify, then re-run --${label}.`);
  }
  try {
    return await readAssessmentRound(ROUND_ID);
  } catch (error) {
    appendLog({ outcome: `${label}_unconfirmed`, error: `readback: ${String(error?.message || error).slice(0, 280)}` });
    fail(`${label} PATCH returned but readback failed; run --verify, then re-run --${label} if needed.`);
  }
}

async function plan() {
  const approver = arg('approver');
  if (!approver) fail('--approver="<name>" is required; it is recorded in the round log.');
  const coordinator = await findCycleCoordinator(CYCLE);
  if (coordinator?.wmkf_activeroundid?.toLowerCase() !== ROUND_ID) fail(`${CYCLE} active round is ${coordinator?.wmkf_activeroundid || 'none'}, not ${ROUND_ID}.`);
  const round = await readAssessmentRound(ROUND_ID);
  // Never overwrite the only copy of an original snapshot that is still needed for rollback.
  if (fs.existsSync(PLAN) && roundStateVs(round, JSON.parse(fs.readFileSync(PLAN, 'utf8'))) === 'corrected') {
    fail(`the round already holds the correction from ${PLAN}; run --verify or --rollback.`);
  }
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
  const round = await readAssessmentRound(ROUND_ID);
  const decision = decideApply(round, p);
  if (decision.action === 'done') {
    appendLog({ outcome: 'applied_confirmed', planHash: hash, etag: round['@odata.etag'] });
    console.log('The round already holds the correction. Nothing to do; run --verify.');
    return;
  }
  if (decision.action === 'refuse') fail(decision.reason);
  appendLog({ outcome: 'apply_intent', planHash: hash, etag: p.etag });
  const after = await patchAndReport(round, { wmkf_snapshotjson: p.corrected.snapshotJson, wmkf_administrationlogjson: p.corrected.logJson }, 'apply');
  const state = roundStateVs(after, p);
  appendLog({ outcome: state === 'corrected' ? 'applied' : `apply_readback_${state}`, planHash: hash, etag: after['@odata.etag'] });
  if (state !== 'corrected') fail(`PATCH returned, but the round reads back as '${state}'. Run --verify and stop.`);
  console.log('Applied. Run --verify.');
}

async function verify() {
  const { plan: p } = loadPlan();
  const round = await readAssessmentRound(ROUND_ID);
  const state = roundStateVs(round, p);
  console.log(`Round holds: ${state === 'corrected' ? 'the correction' : state === 'original' ? 'the ORIGINAL (not applied, or rolled back)' : 'NEITHER planned state'}`);
  const stored = JSON.parse(round.wmkf_snapshotjson);
  for (const c of p.changes) {
    const proposal = stored.proposals.find((x) => x.requestId === c.requestId);
    console.log(`  #${c.requestNumber}: stored ${money(proposal.amountMinorUnits)} (${proposal.amountSource || 'no source'})`);
  }
  const coordinator = await findCycleCoordinator(CYCLE);
  const pointerOk = coordinator?.wmkf_activeroundid?.toLowerCase() === ROUND_ID;
  console.log(`${CYCLE} active round is still ${ROUND_ID}: ${pointerOk ? 'yes' : 'NO'}`);
  const activity = activitySincePlan(round, await listsOf(), p);
  console.log(`App activity since the plan: ${activity.length ? activity.join('; ') : 'none'}`);
  if (state !== 'corrected' || !pointerOk) process.exit(1);
}

async function rollback() {
  const { plan: p } = loadPlan();
  const round = await readAssessmentRound(ROUND_ID);
  const decision = decideRollback(round, await listsOf(), p);
  if (decision.action === 'done') {
    appendLog({ outcome: 'rolled_back_confirmed', etag: round['@odata.etag'] });
    console.log('The round already holds the original snapshot and log. Nothing to do.');
    return;
  }
  if (decision.action === 'refuse') fail(decision.reason);
  appendLog({ outcome: 'rollback_intent', etag: round['@odata.etag'] });
  const after = await patchAndReport(round, { wmkf_snapshotjson: p.original.snapshotJson, wmkf_administrationlogjson: p.original.logJson }, 'rollback');
  const state = roundStateVs(after, p);
  appendLog({ outcome: state === 'original' ? 'rolled_back' : `rollback_readback_${state}`, etag: after['@odata.etag'] });
  if (state !== 'original') fail(`PATCH returned, but the round reads back as '${state}'. Run --verify and stop.`);
  console.log('Rolled back to the original snapshot and log.');
}

await bypassDynamicsRestrictions(`ranking-invited-amounts-${MODE}`, async () => {
  console.log(`host: ${new URL(process.env.DYNAMICS_URL).host}`);
  await { plan, apply, verify, rollback }[MODE]();
});
