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
jest.mock('../../lib/services/transcription-pilot/workflow-probe', () => ({
  startSyntheticWorkflowProbe: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/preflight', () => {
  const actual = jest.requireActual('../../lib/services/transcription-pilot/preflight');
  return { ...actual, runTranscriptionPreflight: jest.fn(actual.runTranscriptionPreflight) };
});
jest.mock('../../lib/services/alert-service', () => ({
  autoResolve: jest.fn(async () => 0),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 1 })) },
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));

import handler from '../../pages/api/cron/drain-transcriptions';
import { verifyTranscriptionCronSecret } from '../../lib/utils/cron-auth';
import { drainTranscriptionCleanup, drainTranscriptionPilot } from '../../lib/services/transcription-pilot/worker';
import { requeueExpiredPreIntentTranscriptionSubmissions, markExpiredTranscriptionSubmissionsUncertain } from '../../lib/services/transcription-pilot/store';
import { drainTranscriptionWorkflowDispatches } from '../../lib/services/transcription-pilot/workflow-dispatch';
import { startSyntheticWorkflowProbe } from '../../lib/services/transcription-pilot/workflow-probe';
import { runTranscriptionPreflight, validateTranscriptionPreflightEnv } from '../../lib/services/transcription-pilot/preflight';
import AlertService from '../../lib/services/alert-service';
import NotificationService from '../../lib/services/notification-service';
import { withDalContext } from '../../lib/dataverse/core/context';

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

function readOnlyClient({ readOnly = 'on', database = 'neondb', jobs = '0', dispatches = '0', migration = true, shape = true,
  speakerNamesMigration = true, speakerNamesShape = true, zoomMigration = true, zoomShape = true } = {}) {
  const calls = [];
  return {
    calls,
    async connect() { calls.push('connect'); },
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: readOnly }] };
      if (normalized === 'SELECT current_database() AS database_name') return { rows: [{ database_name: database }] };
      if (normalized.startsWith('SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name = $1)')) return { rows: [{ applied: migration }] };
      if (normalized.includes('062_transcription_speaker_names.sql')) return { rows: [{
        migration_applied: speakerNamesMigration, column_present: speakerNamesShape, constraint_present: speakerNamesShape,
      }] };
      if (normalized.includes('065_transcription_zoom_transcript.sql')) return { rows: [{
        migration_applied: zoomMigration, columns_present: zoomShape, constraints_present: zoomShape,
      }] };
      if (normalized.startsWith('SELECT to_regclass(')) return { rows: [{
        table_present: shape, columns_match: shape, constraints_match: shape,
        primary_key_match: shape, foreign_key_match: shape, due_index_present: shape,
      }] };
      if (normalized.startsWith('SELECT COUNT(*)::text AS count FROM public.transcription_jobs')) return { rows: [{ count: jobs }] };
      if (normalized.startsWith('SELECT COUNT(*)::text AS count FROM public.transcription_workflow_dispatches')) return { rows: [{ count: dispatches }] };
      return { rows: [] };
    },
    async end() { calls.push('end'); },
  };
}

describe('transcription Preview readiness preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    runTranscriptionPreflight.mockImplementation(
      jest.requireActual('../../lib/services/transcription-pilot/preflight').runTranscriptionPreflight
    );
    requeueExpiredPreIntentTranscriptionSubmissions.mockResolvedValue([]);
    markExpiredTranscriptionSubmissionsUncertain.mockResolvedValue([]);
    drainTranscriptionCleanup.mockResolvedValue({ expiredContent: 0, cleanup: 0, incomplete: false });
    drainTranscriptionWorkflowDispatches.mockResolvedValue({ recovered: 0, started: 0, failed: 0, incomplete: false });
    AlertService.autoResolve.mockClear().mockResolvedValue(0);
    NotificationService.notify.mockClear().mockResolvedValue({ id: 1 });
    withDalContext.mockClear().mockImplementation((_label, fn) => fn());
  });

  it.each([
    ['not Preview', { VERCEL_ENV: 'production' }],
    ['dedicated profile has no registered project identity', { VERCEL_ENV: 'production', TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE: 'transcription-pilot', VERCEL_PROJECT_ID: 'prj_unregistered' }],
    ['invalid profile cannot fall back to Preview', { TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE: '' }],
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
      "SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name = $1) AS applied",
      expect.stringContaining('to_regclass'),
      expect.stringContaining('062_transcription_speaker_names.sql'),
      expect.stringContaining('065_transcription_zoom_transcript.sql'),
      'SELECT COUNT(*)::text AS count FROM public.transcription_jobs',
      'SELECT COUNT(*)::text AS count FROM public.transcription_workflow_dispatches', 'COMMIT', 'end',
    ]);
    expect(result).toEqual({
      ok: true,
      checks: {
        previewDeployment: true, disabledFlags: true, dedicatedDatabase: true, dedicatedBlobStore: true,
        safeDataverseControls: true, dedicatedAuthOrigin: true, applicationSecretsPresent: true,
        readOnlyDatabase: true, expectedDatabase: true,
        workflowDispatchMigration: true, workflowDispatchShape: true,
        speakerNamesMigration: true, speakerNamesShape: true,
        zoomTranscriptMigration: true, zoomTranscriptShape: true,
        zeroJobs: true, zeroWorkflowDispatches: true,
      },
      jobs: 0,
      workflowDispatches: 0,
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

    const untracked = readOnlyClient({ migration: false });
    const untrackedResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => untracked });
    expect(untrackedResult.ok).toBe(false);
    expect(untrackedResult.checks.workflowDispatchMigration).toBe(false);
    expect(untracked.calls).toContain('ROLLBACK');

    const missingSpeakerNamesMigration = readOnlyClient({ speakerNamesMigration: false });
    const missingSpeakerNamesMigrationResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => missingSpeakerNamesMigration });
    expect(missingSpeakerNamesMigrationResult.ok).toBe(false);
    expect(missingSpeakerNamesMigrationResult.checks.speakerNamesMigration).toBe(false);
    expect(missingSpeakerNamesMigration.calls).toContain('ROLLBACK');

    const malformedSpeakerNamesShape = readOnlyClient({ speakerNamesShape: false });
    const malformedSpeakerNamesResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => malformedSpeakerNamesShape });
    expect(malformedSpeakerNamesResult.ok).toBe(false);
    expect(malformedSpeakerNamesResult.checks.speakerNamesShape).toBe(false);
    expect(malformedSpeakerNamesShape.calls).toContain('ROLLBACK');

    const missingZoomMigration = readOnlyClient({ zoomMigration: false });
    const missingZoomMigrationResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => missingZoomMigration });
    expect(missingZoomMigrationResult.ok).toBe(false);
    expect(missingZoomMigrationResult.checks.zoomTranscriptMigration).toBe(false);
    expect(missingZoomMigration.calls).toContain('ROLLBACK');

    const malformedZoomShape = readOnlyClient({ zoomShape: false });
    const malformedZoomResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => malformedZoomShape });
    expect(malformedZoomResult.ok).toBe(false);
    expect(malformedZoomResult.checks.zoomTranscriptShape).toBe(false);
    expect(malformedZoomShape.calls).toContain('ROLLBACK');

    const malformed = readOnlyClient({ shape: false });
    const malformedResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => malformed });
    expect(malformedResult.ok).toBe(false);
    expect(malformedResult.checks.workflowDispatchShape).toBe(false);
    expect(malformed.calls).toContain('ROLLBACK');

    const nonemptyDispatches = readOnlyClient({ dispatches: '1' });
    const dispatchResult = await runTranscriptionPreflight({ env: goodEnv, createClient: () => nonemptyDispatches });
    expect(dispatchResult.ok).toBe(false);
    expect(dispatchResult.checks.zeroWorkflowDispatches).toBe(false);
    expect(nonemptyDispatches.calls).toContain('ROLLBACK');
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

  it('allows only secret-authenticated POST workflow probes after the full read-only preflight', async () => {
    runTranscriptionPreflight.mockResolvedValue({
      ok: true, checks: { previewDeployment: true, workflowDispatchMigration: true, workflowDispatchShape: true,
        zeroJobs: true, zeroWorkflowDispatches: true },
    });
    startSyntheticWorkflowProbe.mockResolvedValue({
      started: true, completed: true, timedOut: false, runId: 'run_safe_id',
      proof: { retryResumed: true, retryAttempts: 2, sleepResumed: true, syntheticMediaAccepted: true,
        syntheticAudioBytes: 16863, syntheticAudioDurationSeconds: 3.065 },
    });
    const res = response();
    await handler({ method: 'POST', query: { workflow_probe: '1' } }, res);
    expect(runTranscriptionPreflight).toHaveBeenCalledTimes(1);
    expect(startSyntheticWorkflowProbe).toHaveBeenCalledWith({ timeoutMs: 90_000 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, runId: 'run_safe_id', status: 'completed', proof: { retryResumed: true } });
    expect(JSON.stringify(res.body)).not.toMatch(/transcript|provider|pathname|password|token/i);
    expect(drainTranscriptionPilot).not.toHaveBeenCalled();
  });

  it('does not start a workflow when the strict secret or read-only preflight fails', async () => {
    verifyTranscriptionCronSecret.mockReturnValueOnce(false);
    const denied = response();
    await handler({ method: 'POST', query: { workflow_probe: '1' } }, denied);
    expect(startSyntheticWorkflowProbe).not.toHaveBeenCalled();

    runTranscriptionPreflight.mockResolvedValueOnce({
      ok: false, checks: { dedicatedDatabase: false, workflowDispatchMigration: false },
    });
    const unavailable = response();
    await handler({ method: 'POST', query: { workflow_probe: '1' } }, unavailable);
    expect(unavailable.statusCode).toBe(503);
    expect(startSyntheticWorkflowProbe).not.toHaveBeenCalled();
  });

  it('rejects GET, malformed, and mixed probe requests without starting a run', async () => {
    const get = response();
    await handler({ method: 'GET', query: { workflow_probe: '1' } }, get);
    expect(get.statusCode).toBe(405);
    expect(get.headers.Allow).toBe('POST');
    const mixed = response();
    await handler({ method: 'POST', query: { workflow_probe: '1', preflight: '1' } }, mixed);
    expect(mixed.statusCode).toBe(400);
    const malformed = response();
    await handler({ method: 'POST', query: { workflow_probe: ['1', '1'] } }, malformed);
    expect(malformed.statusCode).toBe(400);
    expect(startSyntheticWorkflowProbe).not.toHaveBeenCalled();
  });

  it('runs only the dispatch recovery sweep, without cleanup or media worker work', async () => {
    drainTranscriptionWorkflowDispatches.mockResolvedValue({ recovered: 2, started: 0, failed: 0, incomplete: false });
    const res = response();
    await handler({ method: 'GET', query: { recovery: '1' } }, res);
    expect(res.statusCode).toBe(200);
    expect(drainTranscriptionWorkflowDispatches).toHaveBeenCalledWith({ maxRuns: 20, deadline: expect.any(Number) });
    expect(drainTranscriptionCleanup).not.toHaveBeenCalled();
    expect(drainTranscriptionPilot).not.toHaveBeenCalled();
    expect(requeueExpiredPreIntentTranscriptionSubmissions).not.toHaveBeenCalled();
    expect(markExpiredTranscriptionSubmissionsUncertain).not.toHaveBeenCalled();
    expect(startSyntheticWorkflowProbe).not.toHaveBeenCalled();
  });

  it('rejects unknown or mixed cron modes before starting recovery or normal work', async () => {
    const unknown = response();
    await handler({ method: 'GET', query: { debug: '1' } }, unknown);
    expect(unknown.statusCode).toBe(400);
    const mixed = response();
    await handler({ method: 'POST', query: { recovery: '1', workflow_probe: '1' } }, mixed);
    expect(mixed.statusCode).toBe(400);
    expect(drainTranscriptionWorkflowDispatches).not.toHaveBeenCalled();
    expect(drainTranscriptionCleanup).not.toHaveBeenCalled();
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

  it('alerts on daily incomplete cleanup while preserving the successful aggregate response', async () => {
    drainTranscriptionCleanup.mockResolvedValue({ expiredContent: 3, cleanup: 2, incomplete: true });
    const res = response();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.summary.incomplete).toBe(true);
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'transcription_cron_incomplete', severity: 'warning', emailAdmins: true,
      autoResolveKey: 'transcription:daily-drain:incomplete', category: 'ops',
      message: expect.not.stringMatching(/audio|transcript|https?:\/\//i),
    }));
    expect(withDalContext).toHaveBeenCalledWith('notification-email', expect.any(Function));
    expect(AlertService.autoResolve).not.toHaveBeenCalledWith('transcription:daily-drain:incomplete');
  });

  it('auto-resolves an incomplete warning only after a clean bounded daily pass', async () => {
    const res = response();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(AlertService.autoResolve).toHaveBeenCalledWith('transcription:daily-drain:incomplete');
    expect(AlertService.autoResolve).toHaveBeenCalledWith('transcription:daily-workflow:incomplete');
    expect(AlertService.autoResolve).not.toHaveBeenCalledWith('transcription:daily-drain:failed');
  });

  it('alerts on hourly recovery incompleteness and auto-resolves that condition after a clean sweep', async () => {
    drainTranscriptionWorkflowDispatches.mockResolvedValueOnce({ recovered: 0, started: 0, failed: 0, incomplete: true });
    const incomplete = response();
    await handler({ method: 'GET', query: { recovery: '1' } }, incomplete);
    expect(incomplete.statusCode).toBe(200);
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'transcription_cron_incomplete', severity: 'warning', emailAdmins: true,
      autoResolveKey: 'transcription:hourly-recovery:incomplete',
    }));

    drainTranscriptionWorkflowDispatches.mockResolvedValueOnce({ recovered: 0, started: 0, failed: 0, incomplete: false });
    const clean = response();
    await handler({ method: 'GET', query: { recovery: '1' } }, clean);
    expect(clean.statusCode).toBe(200);
    expect(AlertService.autoResolve).toHaveBeenCalledWith('transcription:hourly-recovery:incomplete');
    expect(AlertService.autoResolve).not.toHaveBeenCalledWith('transcription:workflow-recovery:failed');
  });

  it('records hard cron failures without exposing provider or job details and returns 500', async () => {
    requeueExpiredPreIntentTranscriptionSubmissions.mockRejectedValueOnce(new Error('sensitive details must not enter the alert'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = response();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'transcription_daily_drain_failed', severity: 'error',
      autoResolveKey: 'transcription:daily-drain:failed', category: 'ops',
      message: expect.not.stringContaining('sensitive details'),
    }));
    expect(NotificationService.notify.mock.calls[0][0].message).not.toMatch(/\b(?:audio|transcript)\b|https?:\/\//i);
    errorSpy.mockRestore();
  });

  it('keeps hourly recovery failure as an HTTP failure and raises an ops alert', async () => {
    drainTranscriptionWorkflowDispatches.mockRejectedValueOnce(new Error('sensitive details must not enter the alert'));
    const res = response();
    await handler({ method: 'GET', query: { recovery: '1' } }, res);
    expect(res.statusCode).toBe(500);
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'transcription_workflow_recovery_failed', severity: 'error',
      autoResolveKey: 'transcription:workflow-recovery:failed', category: 'ops',
    }));
  });

  it('does not turn a successful cron response into a failure when alert delivery is unavailable', async () => {
    drainTranscriptionCleanup.mockResolvedValue({ expiredContent: 0, cleanup: 0, incomplete: true });
    NotificationService.notify.mockRejectedValueOnce(new Error('email unavailable'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = response();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    errorSpy.mockRestore();
  });
});
