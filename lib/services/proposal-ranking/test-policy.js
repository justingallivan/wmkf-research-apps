/** Explicit opt-in for the isolated, authenticated ranking Preview. Never enabled on Production. */
export const RANKING_TEST_PROJECT = 'prj_v9lOh6NdInOGxIPSmcX8IYiBPVQB';
export const RANKING_TEST_ORIGIN = 'https://wmkf-meeting-transcription-test.vercel.app';
export const RANKING_TEST_DATAVERSE = 'https://orgd9e66399.crm.dynamics.com';
export const RANKING_TEST_DATABASE = 'ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech';
export const RANKING_TEST_CYCLE = 'D97';
export const RANKING_TEST_RUN = 'c31bc841-e260-4a14-9041-8d765ddcc497';
export const RANKING_TEST_REQUESTS = Array.from({ length: 12 }, (_, i) =>
  `c31bc841-e260-4a14-9041-8d765ddcc${(0x401 + i).toString(16)}`);

export const RANKING_TEST_LEGACY_REQUESTS = RANKING_TEST_REQUESTS.slice(0, 6);

export function isRankingRehearsalRound(ids) {
  return Array.isArray(ids) && [RANKING_TEST_REQUESTS, RANKING_TEST_LEGACY_REQUESTS].some(expected =>
    ids.length === expected.length && new Set(ids).size === ids.length && ids.every(id => expected.includes(id)));
}

export function getRankingTestPolicy(env = process.env) {
  const requested = env.PROPOSAL_RANKING_TEST_ENABLED !== undefined
    && env.PROPOSAL_RANKING_TEST_ENABLED !== 'off';
  if (!requested) return { requested: false, enabled: false };
  const exactUrl = (value, expected) => {
    try {
      const url = new URL(value);
      return url.origin === expected && url.pathname === '/' && !url.search
        && !url.hash && !url.username && !url.password;
    } catch { return false; }
  };
  let databaseReady = false;
  try {
    const urls = [env.POSTGRES_URL, env.DATABASE_URL].filter(Boolean);
    databaseReady = Boolean(env.POSTGRES_URL) && urls.every((value) => {
      const url = new URL(value);
      return ['postgres:', 'postgresql:'].includes(url.protocol)
        && url.hostname === RANKING_TEST_DATABASE && url.pathname === '/neondb'
        && [...url.searchParams.keys()].every((key) => ['sslmode', 'channel_binding'].includes(key))
        && ['require', 'verify-full'].includes(url.searchParams.get('sslmode'));
    });
  } catch { /* A malformed database target denies the entire test mode. */ }
  const enabled = env.PROPOSAL_RANKING_TEST_ENABLED === 'on'
    && env.VERCEL_PROJECT_ID === RANKING_TEST_PROJECT
    && env.MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE === 'meeting-transcription-test'
    && env.PROPOSAL_RANKING_WORKFLOW_V2 === 'on'
    && env.VERCEL_ENV === 'preview' && env.NODE_ENV === 'production'
    && env.AUTH_REQUIRED === 'true' && env.EMERGENCY_AUTH_BYPASS !== 'true'
    && env.NEXTAUTH_URL === RANKING_TEST_ORIGIN
    && Boolean(env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET && env.AZURE_AD_TENANT_ID)
    && typeof env.NEXTAUTH_SECRET === 'string' && env.NEXTAUTH_SECRET.length >= 32
    && exactUrl(env.DYNAMICS_URL, RANKING_TEST_DATAVERSE)
    && (env.DYNAMICS_SANDBOX_URL === undefined || exactUrl(env.DYNAMICS_SANDBOX_URL, RANKING_TEST_DATAVERSE))
    && databaseReady && env.DATAVERSE_TARGET_INTERLOCK === 'on'
    && env.DATAVERSE_DAL_ENFORCEMENT === 'on' && env.DATAVERSE_ALLOW_PROD_READS === 'no'
    && env.MEETING_TRANSCRIPTION_REHEARSAL_ENABLED !== 'on'
    && env.MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED !== 'on'
    && env.TRANSCRIPTION_PILOT_ENABLED !== 'true'
    && env.TRANSCRIPTION_SUBMISSIONS_ENABLED !== 'true';
  return { requested, enabled };
}
