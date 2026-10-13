#!/usr/bin/env node
/** Read-only probe of the exact hosted rehearsal's source, identity and grants.
 * Uses real sandbox identities at the trusted service boundary; not an SSO test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { RANKING_TEST_DATAVERSE, RANKING_TEST_PROJECT, RANKING_TEST_ORIGIN, RANKING_TEST_CYCLE, getRankingTestPolicy } from '../lib/services/proposal-ranking/test-policy.js';
assert(process.argv.length === 4 && process.argv[2] === '--env-file', 'Use --env-file PATH');
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
await withDalContext('ranking-test-preview-probe', async () => {
  const result = await buildProposalRankingPreview(RANKING_TEST_CYCLE);
  console.log(JSON.stringify({ cycleCode: result.cycleCode, canOpen: result.canOpen, warnings: result.warnings,
    roster: result.roster, facilitator: result.facilitator, seedOrders: result.seedOrders,
    scores: result.proposals.map(p => ({ requestId: p.requestId, mean: p.score.mean, received: p.score.receivedCount })) }, null, 2));
  assert(result.canOpen && result.proposals.length === 6 && result.roster.length === 4);
  assert(result.proposals.every(p => p.score.receivedCount === 1 && p.score.mean > 0));
});
