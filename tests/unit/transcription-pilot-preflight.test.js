jest.mock('../../lib/utils/cron-auth', () => ({ verifyTranscriptionCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/transcription-pilot/worker', () => ({
  drainTranscriptionPilot: jest.fn(), drainTranscriptionCleanup: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/store', () => ({
  requeueExpiredPreIntentTranscriptionSubmissions: jest.fn(),
  markExpiredTranscriptionSubmissionsUncertain: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/workflow-dispatch', () => ({
  drainTranscriptionWorkflowDispatches: jest.fn(),
}));

import handler from '../../pages/api/cron/drain-transcriptions';
import { verifyTranscriptionCronSecret } from '../../lib/utils/cron-auth';
import { drainTranscriptionCleanup, drainTranscriptionPilot } from '../../lib/services/transcription-pilot/worker';
import { requeueExpiredPreIntentTranscriptionSubmissions, markExpiredTranscriptionSubmissionsUncertain } from '../../lib/services/transcription-pilot/store';
import { drainTranscriptionWorkflowDispatches } from '../../lib/services/transcription-pilot/workflow-dispatch';
import { runTranscriptionPreflight, validateTranscriptionPreflightEnv } from '../../lib/services/transcription-pilot/preflight';

const endpoint = 'ep-gentle-smoke-b77a6d90-pooler.c-13.us-east-1.aws.neon.tech';
const url = `postgres://preview-user:preview-password@${endpoint}:5432/neondb?sslmode=require`;
const token = 'vercel_blob_rw_Qri02A1kj96tQYR9_fixture';
const goodEnv = {
  VERCEL_ENV: 'preview',
  TRANSCRIPTION_PILOT_ENABLED: 'false',
  TRANSCRIPTION_SUBMISSIONS_ENABLED: 'false',
  POSTGRES_URL: url,
  DATABASE_URL: url,
  UPLOADS_BLOB_RW_TOKEN: token,
  DATAVERSE_TARGET_INTERLOCK: 'on',
  DATAVERSE_ALLOW_PROD_READS: 'no',
  DATAVERSE_DAL_ENFORCEMENT: 'on',
  NEXTAUTH_URL: 'https://wmkf-transcription-pilot.vercel.app',
  ASSEMBLYAI_API_KEY: 'assemblyai-fixture-key',
  ASSEMBLYAI_WEBHOOK_SECRET: 'w'.repeat(32),
  TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY: 'r'.repeat(32),
};

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
  };
}

function readOnlyClient({ readOnly = 'on', database = 'neondb', jobs = '0' } = {}) {
  const calls = [];
  return {
    calls,
    async connect() { calls.push('connect'); },
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: readOnly }] };
      if (normalized === 'SELECT current_database() AS database_name') return { rows: [{ database_name: database }] };
      if (normalized.startsWith('SELECT COUNT(*)::text AS count FROM public.transcription_jobs')) return { rows: [{ count: jobs }] };
      return { rows: [] };
    },
    async end() { calls.push('end'); },
  };
}

describe('transcription Preview readiness preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requeueExpiredPreIntentTranscriptionSubmissions.mockResolvedValue([]);
    markExpiredTranscriptionSubmissionsUncertain.mockResolvedValue([]);
    drainTranscriptionCleanup.mockResolvedValue({ expiredContent: 0, cleanup: 0, incomplete: false });
    drainTranscriptionWorkflowDispatches.mockResolvedValue({ recovered: 0, started: 0, failed: 0, incomplete: false });
  });

  it.each([
    ['not Preview', { VERCEL_ENV: 'production' }],
    ['pilot switch not literally false', { TRANSCRIPTION_PILOT_ENABLED: 'true' }],
    ['submission switch absent', { TRANSCRIPTION_SUBMISSIONS_ENABLED: undefined }],
    ['database alias not pinned', { DATABASE_URL: 'postgres://x:y@other.neon.tech/neondb?sslmode=require' }],
    ['Blob token from another store', { UPLOADS_BLOB_RW_TOKEN: 'vercel_blob_rw_otherstore_fixture' }],
    ['Dataverse target controls are unsafe', { DATAVERSE_TARGET_INTERLOCK: 'off' }],
    ['auth origin is not the dedicated alias', { NEXTAUTH_URL: 'https://example.invalid' }],
    ['provider key is absent', { ASSEMBLYAI_API_KEY: '' }],
    ['webhook secret is too short', { ASSEMBLYAI_WEBHOOK_SECRET: 'short' }],
    ['reference key is too short', { TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY: 'short' }],
  ])('does not construct a database client when %s', async (_label, override) => {
    const env = { ...goodEnv, ...override };
    const createClient = jest.fn();
    const result = await runTranscriptionPreflight({ env, createClient });
    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps connection secrets out of the validation result', () => {
    const result = validateTranscriptionPreflightEnv(goodEnv);
    expect(result.checks).toEqual({
      previewDeployment: true, disabledFlags: true, dedicatedDatabase: true, dedicatedBlobStore: true,
      safeDataverseControls: true, dedicatedAuthOrigin: true, applicationSecretsPresent: true,
    });
    expect(JSON.stringify(result.checks)).not.toContain('preview-password');
    expect(JSON.stringify(result.checks)).not.toContain(endpoint);
  });

  it('verifies read-only target identity and zero jobs before returning success', async () => {
    const client = readOnlyClient();
    const createClient = jest.fn(() => client);
    const result = await runTranscriptionPreflight({ env: goodEnv, createClient });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.calls).toEqual([
      'connect', 'BEGIN READ ONLY', 'SHOW transaction_read_only',
      'SELECT current_database() AS database_name', 'SET LOCAL row_security = off',
      'SELECT COUNT(*)::text AS count FROM public.transcription_jobs', 'COMMIT', 'end',
    ]);
    expect(result).toEqual({
      ok: true,
      checks: {
        previewDeployment: true, disabledFlags: true, dedicatedDatabase: true, dedicatedBlobStore: true,
        safeDataverseControls: true, dedicatedAuthOrigin: true, applicationSecretsPresent: true,
        readOnlyDatabase: true, expectedDatabase: true, zeroJobs: true,
      },
      jobs: 0,
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('rejects a non-read-only or populated target and rolls back without exposing details', async () => {
    const mutable = readOnlyClient({ readOnly: 'off' });
    const mutableResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => mutable });
    expect(mutableResult.ok).toBe(false);
    expect(mutable.calls).toContain('ROLLBACK');

    const populated = readOnlyClient({ jobs: '1' });
    const populatedResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => populated });
    expect(populatedResult.ok).toBe(false);
    expect(populatedResult.checks.zeroJobs).toBe(false);
    expect(populated.calls).toContain('ROLLBACK');
  });

  it('requires the strict cron secret before preflight, and preflight never enters the worker', async () => {
    const res = response();
    await handler({ method: 'GET', query: { preflight: '1' } }, res);
    expect(verifyTranscriptionCronSecret).toHaveBeenCalled();
    expect(drainTranscriptionPilot).not.toHaveBeenCalled();
  });

  it('does not let a POST preflight fall through to the worker', async () => {
    const res = response();
    await handler({ method: 'POST', query: { preflight: '1' } }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
    expect(drainTranscriptionPilot).not.toHaveBeenCalled();
  });

  it('rejects ambiguous or unsupported preflight query values without entering the worker', async () => {
    const res = response();
    await handler({ method: 'GET', query: { preflight: ['1', '1'] } }, res);
    expect(res.statusCode).toBe(400);
    expect(drainTranscriptionPilot).not.toHaveBeenCalled();
  });

  it('passes one shared route deadline into the dispatch sweep and preserves incomplete status', async () => {
    drainTranscriptionCleanup.mockResolvedValue({ expiredContent: 3, cleanup: 2, incomplete: true });
    const res = response();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(drainTranscriptionCleanup).toHaveBeenCalledWith({ maxJobs: 100 });
    const [{ deadline, maxRuns }] = drainTranscriptionWorkflowDispatches.mock.calls[0];
    expect(maxRuns).toBe(20);
    expect(deadline).toBeGreaterThan(Date.now());
    expect(deadline).toBeLessThanOrEqual(Date.now() + 270_000);
    expect(res.body.summary.incomplete).toBe(true);
  });
});
