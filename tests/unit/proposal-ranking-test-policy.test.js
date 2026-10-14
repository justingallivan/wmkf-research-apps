/** @jest-environment node */
import { decideMeetingTranscriptionTestRequest } from '../../lib/services/meeting-tracker-transcription/test-deployment-policy';
import { getRankingTestPolicy, RANKING_TEST_DATABASE, RANKING_TEST_DATAVERSE, RANKING_TEST_ORIGIN, RANKING_TEST_PROJECT } from '../../lib/services/proposal-ranking/test-policy';

const validEnv = () => ({
  PROPOSAL_RANKING_TEST_ENABLED: 'on', PROPOSAL_RANKING_WORKFLOW_V2: 'on',
  MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE: 'meeting-transcription-test',
  VERCEL_PROJECT_ID: RANKING_TEST_PROJECT, VERCEL_ENV: 'preview', NODE_ENV: 'production',
  AUTH_REQUIRED: 'true', EMERGENCY_AUTH_BYPASS: 'false', NEXTAUTH_URL: RANKING_TEST_ORIGIN,
  AZURE_AD_CLIENT_ID: 'test', AZURE_AD_CLIENT_SECRET: 'test', AZURE_AD_TENANT_ID: 'test',
  NEXTAUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  DYNAMICS_URL: RANKING_TEST_DATAVERSE,
  POSTGRES_URL: `postgres://test:test@${RANKING_TEST_DATABASE}/neondb?sslmode=require`,
  DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'no',
});

test('requires explicit opt-in and exact isolated targets', () => {
  expect(getRankingTestPolicy({})).toEqual({ requested: false, enabled: false });
  expect(getRankingTestPolicy(validEnv())).toEqual({ requested: true, enabled: true });
});
test.each([
  ['VERCEL_PROJECT_ID', 'other'], ['VERCEL_ENV', 'production'], ['NODE_ENV', 'development'],
  ['AUTH_REQUIRED', 'false'], ['EMERGENCY_AUTH_BYPASS', 'true'], ['NEXTAUTH_SECRET', 'short'],
  ['NEXTAUTH_URL', 'https://applications.wmkeck.org'], ['DYNAMICS_URL', 'https://wmkf.crm.dynamics.com'],
  ['DYNAMICS_SANDBOX_URL', 'https://other.crm.dynamics.com'], ['DYNAMICS_URL', `${RANKING_TEST_DATAVERSE}/extra`],
  ['POSTGRES_URL', 'postgres://test:test@other.example/neondb?sslmode=require'],
  ['DATABASE_URL', 'postgres://test:test@other.example/neondb?sslmode=require'],
  ['POSTGRES_URL', `postgres://test:test@${RANKING_TEST_DATABASE}/neondb?sslmode=disable`],
  ['DATAVERSE_TARGET_INTERLOCK', 'off'], ['DATAVERSE_DAL_ENFORCEMENT', 'off'], ['DATAVERSE_ALLOW_PROD_READS', 'yes'],
  ['MEETING_TRANSCRIPTION_REHEARSAL_ENABLED', 'on'], ['MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED', 'on'],
  ['TRANSCRIPTION_PILOT_ENABLED', 'true'], ['TRANSCRIPTION_SUBMISSIONS_ENABLED', 'true'],
  ['PROPOSAL_RANKING_TEST_ENABLED', ''], ['PROPOSAL_RANKING_WORKFLOW_V2', 'off'],
])('fails closed for %s=%s', (key, value) => {
  expect(getRankingTestPolicy({ ...validEnv(), [key]: value })).toEqual({ requested: true, enabled: false });
});


test.each([
  ['/proposal-ranking','GET',true], ['/api/proposal-ranking','GET',true], ['/api/proposal-ranking','POST',true],
  ['/api/proposal-ranking','DELETE',false], ['/api/user-profiles','POST',false],
  ['/api/meeting-tracker','GET',false], ['/api/cron/drain-transcriptions','GET',false],
  ['/.well-known/workflow/v1/flow','POST',false], ['/api/admin/proposal-ranking','POST',false],
])('dedicated route %s %s allowed=%s', (pathname, method, allowed) => {
  expect(decideMeetingTranscriptionTestRequest({ pathname, method, env: validEnv(), origin: RANKING_TEST_ORIGIN }).allowed).toBe(allowed);
});

import { RANKING_TEST_REQUESTS, RANKING_TEST_LEGACY_REQUESTS, isRankingRehearsalRound } from '../../lib/services/proposal-ranking/test-policy';
import { RANKING_REHEARSAL_PROPOSALS, rehearsalPresentation } from '../../lib/services/proposal-ranking/test-fixtures';
test('only the complete legacy or expanded rehearsal sets are in scope', () => {
  expect(isRankingRehearsalRound(RANKING_TEST_LEGACY_REQUESTS)).toBe(true);
  expect(isRankingRehearsalRound(RANKING_TEST_REQUESTS)).toBe(true);
  expect(isRankingRehearsalRound(RANKING_TEST_REQUESTS.slice(0, 8))).toBe(false);
  expect(isRankingRehearsalRound([...RANKING_TEST_LEGACY_REQUESTS.slice(1), RANKING_TEST_LEGACY_REQUESTS[1]])).toBe(false);
  expect(RANKING_TEST_REQUESTS.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))).toBe(true);
});
test('sample history and discussion require exact enabled preview policy and owned ID', () => {
  const id = RANKING_TEST_REQUESTS[0];
  expect(rehearsalPresentation(id, validEnv()).researchFunding.sample).toBe(true);
  expect(rehearsalPresentation(id, {})).toBeNull();
  expect(rehearsalPresentation(id, {...validEnv(), VERCEL_ENV: 'production'})).toBeNull();
  expect(rehearsalPresentation(id, {...validEnv(), AUTH_REQUIRED: 'false'})).toBeNull();
  expect(rehearsalPresentation('unrelated', validEnv())).toBeNull();
  expect(RANKING_REHEARSAL_PROPOSALS.filter(p => p.programKey === 'mr')).toHaveLength(6);
  expect(RANKING_REHEARSAL_PROPOSALS.filter(p => p.programKey === 'se')).toHaveLength(6);
  expect(RANKING_REHEARSAL_PROPOSALS.every(p => p.ratings.length === 3)).toBe(true);
});
