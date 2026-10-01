jest.mock('../../lib/services/transcription-pilot/deployment-policy', () => {
  const actual = jest.requireActual('../../lib/services/transcription-pilot/deployment-policy');
  return { ...actual, getTranscriptionPilotDeploymentProfile: (env) => actual.getTranscriptionPilotDeploymentProfile(env, [
    { projectId: 'prj_fixture_only', authOrigin: 'https://pilot.example.test' },
  ]) };
});
import { validateTranscriptionPreflightEnv, runTranscriptionPreflight } from '../../lib/services/transcription-pilot/preflight';

const url = 'postgres://fixture:fixture@ep-gentle-smoke-b77a6d90-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require';
const env = {
  NODE_ENV: 'production', VERCEL_ENV: 'production', VERCEL_PROJECT_ID: 'prj_fixture_only',
  TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE: 'transcription-pilot',
  AUTH_REQUIRED: 'true', AZURE_AD_CLIENT_ID: 'fixture', AZURE_AD_CLIENT_SECRET: 'fixture', AZURE_AD_TENANT_ID: 'fixture',
  NEXTAUTH_SECRET: 'fixture-only-'.repeat(4), NEXTAUTH_URL: 'https://pilot.example.test',
  POSTGRES_URL: url, DATABASE_URL: url, UPLOADS_BLOB_RW_TOKEN: 'vercel_blob_rw_Qri02A1kj96tQYR9_fixture',
  TRANSCRIPTION_PILOT_ENABLED: 'false', TRANSCRIPTION_SUBMISSIONS_ENABLED: 'false',
  DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_ALLOW_PROD_READS: 'no', DATAVERSE_DAL_ENFORCEMENT: 'on',
  ASSEMBLYAI_API_KEY: 'fixture', ASSEMBLYAI_WEBHOOK_SECRET: 'fixture-only-'.repeat(4), TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY: 'fixture-only-'.repeat(4),
};
test('registered test fixture accepts only dedicated Production with pinned resources and disabled gates', () => {
  const result = validateTranscriptionPreflightEnv(env);
  expect(result.mode).toBe('dedicated-project');
  expect(Object.values(result.checks).every(Boolean)).toBe(true);
});
test.each([
  { VERCEL_ENV: 'preview' }, { VERCEL_PROJECT_ID: 'prj_other' },
  { TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE: undefined }, { EMERGENCY_AUTH_BYPASS: 'true' },
  { NEXTAUTH_URL: 'https://unrelated.example.test' }, { TRANSCRIPTION_PILOT_ENABLED: 'true' },
  { DATABASE_URL: 'postgres://fixture:fixture@other.example.test/db' },
])('unsafe dedicated binding never constructs a database client: %j', async (override) => {
  const createClient = jest.fn();
  expect((await runTranscriptionPreflight({ env: { ...env, ...override }, createClient })).ok).toBe(false);
  expect(createClient).not.toHaveBeenCalled();
});
