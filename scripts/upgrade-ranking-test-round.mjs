#!/usr/bin/env node
/** One-off atomic replacement of the exact six-card D97 rehearsal with the
 * twelve-card source. Default read-only. Preserves frozen old snapshot/lists,
 * links previous/replacement history, and keeps Justin as facilitator.
 * Receipt is written before commit; uncertain outcomes stop for inspection.
 * Never changes source data, grants, production or global facilitator settings.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { RANKING_TEST_DATAVERSE, RANKING_TEST_PROJECT, RANKING_TEST_ORIGIN, RANKING_TEST_CYCLE, getRankingTestPolicy } from '../lib/services/proposal-ranking/test-policy.js';
const execute = process.argv[4] === '--execute';
assert(process.argv[2] === '--env-file' && process.argv.length === (execute ? 5 : 4), 'Use --env-file PATH [--execute]');
const local = parseEnv(fs.readFileSync('.env.local', 'utf8'));
const preview = parseEnv(fs.readFileSync(process.argv[3], 'utf8'));
Object.assign(process.env, local, { POSTGRES_URL: preview.POSTGRES_URL, DATABASE_URL: preview.POSTGRES_URL,
  DYNAMICS_URL: RANKING_TEST_DATAVERSE, DYNAMICS_SANDBOX_URL: RANKING_TEST_DATAVERSE,
  VERCEL_PROJECT_ID: RANKING_TEST_PROJECT, VERCEL_ENV: 'preview', NODE_ENV: 'production',
  NEXTAUTH_URL: RANKING_TEST_ORIGIN, AUTH_REQUIRED: 'true', EMERGENCY_AUTH_BYPASS: 'false',
  MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE: 'meeting-transcription-test',
  PROPOSAL_RANKING_TEST_ENABLED: 'on', PROPOSAL_RANKING_ENABLED: 'on', PROPOSAL_RANKING_SCHEMA_READY: 'on',
  PROPOSAL_RANKING_WORKFLOW_V2: 'on', TEST_REQUEST_ISOLATION: 'on', SYNTHETIC_REVIEWER_ISOLATION: 'on',
  DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'no',
  MEETING_TRANSCRIPTION_REHEARSAL_ENABLED: 'off', MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED: 'off',
  TRANSCRIPTION_PILOT_ENABLED: 'false', TRANSCRIPTION_SUBMISSIONS_ENABLED: 'false' });
assert(getRankingTestPolicy().enabled, 'Local rehearsal policy is not ready');
const { withDalContext } = await import('../lib/dataverse/core/context.js');
const { buildProposalRankingPreview } = await import('../lib/services/proposal-ranking/preview-service.js');

const { randomUUID, createHash } = await import('node:crypto');
const adapter = await import('../lib/dataverse/adapters/proposal-ranking.js');
const { makeInitialWorkflowRecords, readWorkflowRound } = await import('../lib/services/proposal-ranking/workflow-service.js');
const OLD = 'f48741f0-4560-471d-b51f-ef93db48c152';
const ACTOR = '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7';
const RECEIPT = '/private/tmp/ranking-rich-round-receipt.json';
const hash = text => createHash('sha256').update(text).digest('hex');
assert(preview.PROPOSAL_RANKING_V2_SCHEMA_READY === 'on');
process.env.PROPOSAL_RANKING_V2_SCHEMA_READY = 'on';
await withDalContext('ranking-test-rich-round-upgrade', async () => {
  const source = await buildProposalRankingPreview(RANKING_TEST_CYCLE);
  assert(source.canOpen && source.proposals.length === 12 && source.roster.length === 4);
  assert(source.proposals.every(p => p.score.receivedCount === 3 && p.score.ratedCount === 3 && p.researchFunding?.sample));
  assert(source.seedOrders.mr.length === 6 && source.seedOrders.se.length === 6);
  const coordinator = await adapter.findCycleCoordinator(RANKING_TEST_CYCLE);
  if (fs.existsSync(RECEIPT)) {
    const saved = JSON.parse(fs.readFileSync(RECEIPT, 'utf8'));
    assert(saved.complete && saved.target === RANKING_TEST_DATAVERSE && saved.oldRoundId === OLD,
      'Prior upgrade receipt is incomplete; inspect its exact IDs before retry');
    assert(coordinator.wmkf_activeroundid === saved.newRoundId, 'Active round moved after upgrade');
    const current = await adapter.readAssessmentRound(saved.newRoundId);
    assert(hash(current.wmkf_snapshotjson) === saved.snapshotHash, 'Upgraded snapshot changed');
    console.log(JSON.stringify({alreadyComplete:true, newRoundId:saved.newRoundId})); return;
  }
  assert(coordinator?.wmkf_activeroundid === OLD, 'The expected six-card rehearsal is no longer active');
  const old = await adapter.readAssessmentRound(OLD);
  const oldSnapshot = JSON.parse(old.wmkf_snapshotjson);
  const oldWorkflow = JSON.parse(old.wmkf_workflowjson);
  const { RANKING_TEST_LEGACY_REQUESTS } = await import('../lib/services/proposal-ranking/test-policy.js');
  assert(old.wmkf_state === 100000000 && old.wmkf_facilitatorsystemuserid === ACTOR
    && oldSnapshot.version === 2 && oldSnapshot.cycleCode === RANKING_TEST_CYCLE
    && oldSnapshot.proposals.length === 6 && new Set(oldSnapshot.proposals.map(p=>p.requestId)).size === 6
    && oldSnapshot.proposals.every(p=>RANKING_TEST_LEGACY_REQUESTS.includes(p.requestId))
    && old.wmkf_cyclecode === RANKING_TEST_CYCLE && oldWorkflow.version === 2 && oldWorkflow.stage === 'private' && !oldWorkflow.supersededBy, 'Original rehearsal differs');
  assert(source.roster.some(p=>p.systemUserId === ACTOR && p.active && p.hasAppAccess));
  const rosterIds = oldSnapshot.roster.map(p=>p.systemUserId).sort();
  assert.deepEqual(source.roster.map(p=>p.systemUserId).sort(), rosterIds, 'Roster changed');
  console.log(JSON.stringify({target:RANKING_TEST_DATAVERSE, oldRoundId:OLD, proposals:12, reviews:36, execute}));
  if (!execute) return;
  const newRoundId = randomUUID(), operationId = randomUUID(), now = new Date().toISOString();
  const snapshot = {...source.snapshot,version:2,facilitatorSystemUserId:ACTOR,openedAt:now,excusedSystemUserIds:[]};
  const initial = makeInitialWorkflowRecords(snapshot,newRoundId,ACTOR,operationId,now);
  const stamp = {wmkf_lastoperationid:operationId,wmkf_lastoperationkind:'fixture-upgrade',wmkf_updatedbyactorsystemuserid:ACTOR,wmkf_updatedat:now};
  const newRound = {wmkf_proposalrankingroundid:newRoundId,wmkf_name:'D97 Fictional research proposal rehearsal',wmkf_cyclecode:RANKING_TEST_CYCLE,
    wmkf_creationoperationid:operationId,wmkf_snapshotjson:JSON.stringify(snapshot),
    wmkf_workflowjson:JSON.stringify({...initial.workflow,previousRoundId:OLD}),
    wmkf_facilitatorsystemuserid:ACTOR,wmkf_policyrevision:1,wmkf_state:100000000,wmkf_administrationlogjson:'[]',
    wmkf_createdbyactorsystemuserid:ACTOR,wmkf_createdat:now,...stamp};
  const receipt = {target:RANKING_TEST_DATAVERSE,oldRoundId:OLD,newRoundId,operationId,oldSnapshotHash:hash(old.wmkf_snapshotjson),snapshotHash:hash(newRound.wmkf_snapshotjson),attemptedAt:now};
  fs.writeFileSync(RECEIPT,JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});
  await adapter.commitAssessmentChanges({round:old,
    roundPatch:{wmkf_state:100000001,wmkf_workflowjson:JSON.stringify({...oldWorkflow,supersededBy:newRoundId}),...stamp},
    newRound,creates:initial.lists,coordinator,
    coordinatorPatch:{wmkf_activeroundid:newRoundId,wmkf_version:Number(coordinator.wmkf_version)+1}});
  const readback = await adapter.readAssessmentRound(newRoundId);
  const oldReadback = await adapter.readAssessmentRound(OLD);
  assert(hash(readback.wmkf_snapshotjson)===receipt.snapshotHash && hash(oldReadback.wmkf_snapshotjson)===receipt.oldSnapshotHash);
  assert((await adapter.findCycleCoordinator(RANKING_TEST_CYCLE)).wmkf_activeroundid===newRoundId);
  const view = await readWorkflowRound({roundId:newRoundId,actor:ACTOR});
  assert(view.snapshot.proposals.length===12 && view.workflow.stage==='private');
  receipt.complete=true;receipt.verifiedAt=new Date().toISOString();
  fs.writeFileSync(RECEIPT,JSON.stringify(receipt,null,2),{mode:0o600});
  console.log(JSON.stringify({complete:true,newRoundId,proposals:12,reviews:36}));
});
