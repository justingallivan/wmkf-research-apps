jest.mock('pg', () => ({ Client: jest.fn() }));

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { EXPECTED_TRANSCRIPTION_COLUMNS, EXPECTED_TRANSCRIPTION_CONSTRAINTS, EXPECTED_TRANSCRIPTION_INDEXES } = require('../../scripts/bootstrap-transcription-preview');
const { RETIRED_MIGRATIONS } = require('../../scripts/lib/fresh-database-bootstrap');
const manifest = require('../../lib/db/migrations-manifest.json').files;
const {
  EXPECTED_HOST,
  OUTBOX_COLUMNS,
  OUTBOX_CONSTRAINTS,
  OUTBOX_INDEXES,
  TARGET_MIGRATION,
  compareMigrationTracker,
  connectionStringForRunner,
  createTargetClient,
  executeCanonicalApply,
  inspectPreviewTarget,
  readTargetUrl,
  runOperator,
} = require('../../scripts/migrate-transcription-preview');

const TARGET_TEXT = `POSTGRES_URL=postgres://preview:nonproduction-test-secret@${EXPECTED_HOST}:5432/neondb?sslmode=require`;
const PRODUCTION_TEXT = 'POSTGRES_URL=postgres://prod:other-test-secret@ep-production.us-east-2.aws.neon.tech:5432/neondb?sslmode=require';
const TARGET_URL = new URL(`postgres://preview:nonproduction-test-secret@${EXPECTED_HOST}:5432/neondb?sslmode=require`);
const TRACKED_BEFORE_061 = manifest.filter((name) => name !== TARGET_MIGRATION).map((name) => ({
  name,
  applied_by: RETIRED_MIGRATIONS[name] ? 'setup-database.js (retired targets verified absent)' : 'setup-database.js (migration SQL executed)',
}));

function expectedConstraintRows(names, table) {
  if (table === 'jobs') return names.map((conname) => ({ conname, definition: 'CHECK (expected)' }));
  const definitions = {
    transcription_workflow_dispatches_pkey: 'PRIMARY KEY (job_id)',
    transcription_workflow_dispatches_job_id_fkey: 'FOREIGN KEY (job_id) REFERENCES transcription_jobs(id) ON DELETE CASCADE',
    transcription_workflow_dispatches_state_check: "CHECK (state IN ('pending', 'dispatching', 'running', 'completed'))",
    transcription_workflow_dispatches_attempt_no_check: 'CHECK (attempt_no >= 0)',
    transcription_workflow_dispatches_last_error_code_check: "CHECK (last_error_code ~ '^[a-z0-9_]{1,64}$')",
    transcription_workflow_dispatch_lease_shape: "CHECK ((state = 'dispatching' AND dispatch_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state <> 'dispatching' AND dispatch_token IS NULL AND lease_expires_at IS NULL))",
    transcription_workflow_dispatch_run_shape: "CHECK (state <> 'running' OR workflow_run_id IS NOT NULL)",
  };
  return names.map((conname) => ({ conname, definition: definitions[conname] }));
}

function fakeClient({ applied = false, outboxExists = applied, jobs = '0', readOnly = 'on', database = 'neondb', brokenOutbox = false } = {}) {
  const queries = [];
  const trackerRows = applied
    ? manifest.map((name) => ({
      name,
      applied_by: RETIRED_MIGRATIONS[name] ? 'setup-database.js (retired targets verified absent)' : 'setup-database.js (migration SQL executed)',
    }))
    : TRACKED_BEFORE_061;
  return {
    queries,
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      if (normalized === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: readOnly }] };
      if (normalized === 'SELECT current_database() AS database_name') return { rows: [{ database_name: database }] };
      if (normalized.includes("to_regclass('public.schema_migrations')")) {
        return { rows: [{ tracker: 'schema_migrations', outbox: outboxExists ? 'transcription_workflow_dispatches' : null }] };
      }
      if (normalized.includes("to_regclass('public.transcription_jobs')")) return { rows: [{ table_name: 'transcription_jobs' }] };
      if (normalized.includes("FROM information_schema.columns") && normalized.includes("table_name = 'transcription_jobs'")) {
        return { rows: EXPECTED_TRANSCRIPTION_COLUMNS.map((column_name) => ({ column_name })) };
      }
      if (normalized.includes('FROM information_schema.tables')) return { rows: [] };
      if (normalized.includes("FROM pg_catalog.pg_constraint") && normalized.includes("'public.transcription_jobs'::regclass")) {
        return { rows: EXPECTED_TRANSCRIPTION_CONSTRAINTS.map((conname) => ({ conname })) };
      }
      if (normalized.includes("FROM pg_catalog.pg_indexes") && normalized.includes("tablename = 'transcription_jobs'")) {
        return { rows: EXPECTED_TRANSCRIPTION_INDEXES.map((indexname) => ({ indexname })) };
      }
      if (normalized === 'SELECT COUNT(*)::text AS count FROM public.transcription_jobs') return { rows: [{ count: jobs }] };
      if (normalized === 'SELECT name, applied_by FROM public.schema_migrations ORDER BY name') return { rows: trackerRows };
      if (normalized.includes("table_name = 'transcription_workflow_dispatches'")) {
        const columns = brokenOutbox ? OUTBOX_COLUMNS.slice(1) : OUTBOX_COLUMNS;
        return { rows: columns.map((column_name) => ({ column_name })) };
      }
      if (normalized.includes("'public.transcription_workflow_dispatches'::regclass")) {
        return { rows: expectedConstraintRows(OUTBOX_CONSTRAINTS, 'outbox') };
      }
      if (normalized.includes("tablename = 'transcription_workflow_dispatches'")) {
        return { rows: OUTBOX_INDEXES.map((indexname) => ({
          indexname,
          indexdef: indexname === 'transcription_workflow_dispatches_pkey'
            ? 'CREATE UNIQUE INDEX transcription_workflow_dispatches_pkey ON public.transcription_workflow_dispatches USING btree (job_id)'
            : "CREATE INDEX idx_transcription_workflow_dispatch_due ON public.transcription_workflow_dispatches USING btree (next_attempt_at, created_at, job_id) WHERE (state = ANY (ARRAY['pending'::text, 'dispatching'::text]))",
        })) };
      }
      if (normalized === 'SELECT COUNT(*)::text AS count FROM public.transcription_workflow_dispatches') return { rows: [{ count: '0' }] };
      return { rows: [] };
    },
  };
}

describe('guarded transcription Preview migration operator', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pins the exact dedicated TLS host and rejects connection-string host overrides', () => {
    expect(readTargetUrl({ targetText: TARGET_TEXT, productionText: PRODUCTION_TEXT }).hostname).toBe(EXPECTED_HOST);
    const bound = readTargetUrl({ targetText: `${TARGET_TEXT}&channel_binding=require`, productionText: PRODUCTION_TEXT });
    expect(bound.hostname).toBe(EXPECTED_HOST);
    expect(new URL(connectionStringForRunner(bound)).searchParams.has('channel_binding')).toBe(false);
    expect(() => readTargetUrl({ targetText: `${TARGET_TEXT}&channel_binding=disable`, productionText: PRODUCTION_TEXT }))
      .toThrow('target_url_override_rejected');
    expect(() => readTargetUrl({
      targetText: `${TARGET_TEXT}&host=ep-production.us-east-2.aws.neon.tech`,
      productionText: PRODUCTION_TEXT,
    })).toThrow('target_url_override_rejected');
    expect(() => readTargetUrl({
      targetText: `${TARGET_TEXT}&sslmode=disable`,
      productionText: PRODUCTION_TEXT,
    })).toThrow('target_tls_required');
    expect(() => readTargetUrl({
      targetText: TARGET_TEXT.replace(EXPECTED_HOST, 'ep-other.us-east-2.aws.neon.tech'),
      productionText: PRODUCTION_TEXT,
    })).toThrow('target_endpoint_mismatch');
    expect(() => readTargetUrl({
      targetText: TARGET_TEXT.replace(EXPECTED_HOST, 'ep-gentle-smoke-b77a6d90-pooler.us-east-2.aws.neon.tech'),
      productionText: PRODUCTION_TEXT,
    })).toThrow('target_host_mismatch');
    expect(() => readTargetUrl({
      targetText: TARGET_TEXT.replace('?sslmode=require', ''),
      productionText: PRODUCTION_TEXT,
    })).toThrow('target_url_tls_required');
  });

  it('configures the direct target client with pinned fields and verified TLS', () => {
    createTargetClient(TARGET_URL);
    expect(Client).toHaveBeenCalledWith(expect.objectContaining({
      host: EXPECTED_HOST,
      port: 5432,
      user: 'preview',
      password: 'nonproduction-test-secret',
      database: 'neondb',
      ssl: { rejectUnauthorized: true, servername: EXPECTED_HOST },
    }));
  });

  it('allows exactly migration 061 as the only pending disk/tracker difference', () => {
    expect(compareMigrationTracker(manifest, TRACKED_BEFORE_061)).toEqual({
      pendingMigrationFiles: [TARGET_MIGRATION],
      targetMigrationApplied: false,
    });
    const currentSqlFiles = manifest.filter((name) => !RETIRED_MIGRATIONS[name]);
    expect(compareMigrationTracker(currentSqlFiles, TRACKED_BEFORE_061)).toEqual({
      pendingMigrationFiles: [TARGET_MIGRATION],
      targetMigrationApplied: false,
    });
    expect(() => compareMigrationTracker(manifest, TRACKED_BEFORE_061.filter((row) => row.name !== '060_transcription_jobs.sql')))
      .toThrow('migration_drift_or_other_pending_migrations');
    expect(() => compareMigrationTracker(manifest, [...TRACKED_BEFORE_061, { name: '999_untracked.sql' }]))
      .toThrow('tracker_has_unknown_migration');
    expect(() => compareMigrationTracker(manifest, TRACKED_BEFORE_061.map((row) => (
      RETIRED_MIGRATIONS[row.name] ? { ...row, applied_by: 'apply-migrations.js' } : row
    )))).toThrow('retired_migration_provenance_mismatch');
  });

  it('probes only in a read-only transaction and verifies existing 060 before allowing 061', async () => {
    const client = fakeClient();
    await expect(inspectPreviewTarget({ client, migrationFiles: manifest })).resolves.toEqual({
      database: 'neondb',
      readOnlyVerified: true,
      transcriptionJobs: 0,
      migrationTrackerMatchesDisk: true,
      pendingMigrationFiles: [TARGET_MIGRATION],
      targetMigrationApplied: false,
      outboxExists: false,
      outboxSchemaVerified: false,
    });
    expect(client.queries[0]).toBe('BEGIN READ ONLY');
    expect(client.queries).toContain('SET LOCAL row_security = off');
    expect(client.queries.at(-1)).toBe('COMMIT');
    expect(client.queries.some((sql) => /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i.test(sql))).toBe(false);
  });

  it('refuses nonzero jobs, mismatched database, non-read-only connection, or an untracked preexisting outbox', async () => {
    await expect(inspectPreviewTarget({ client: fakeClient({ jobs: '1' }), migrationFiles: manifest }))
      .rejects.toThrow('transcription_jobs_not_empty');
    await expect(inspectPreviewTarget({ client: fakeClient({ database: 'otherdb' }), migrationFiles: manifest }))
      .rejects.toThrow('target_database_mismatch');
    await expect(inspectPreviewTarget({ client: fakeClient({ readOnly: 'off' }), migrationFiles: manifest }))
      .rejects.toThrow('readonly_transaction_not_confirmed');
    await expect(inspectPreviewTarget({ client: fakeClient({ outboxExists: true }), migrationFiles: manifest }))
      .rejects.toThrow('untracked_outbox_exists');
  });

  it('verifies the tracked 061 table shape and rejects a missing or inconsistent outbox', async () => {
    const applied = await inspectPreviewTarget({ client: fakeClient({ applied: true }), migrationFiles: manifest });
    expect(applied.targetMigrationApplied).toBe(true);
    expect(applied.outboxSchemaVerified).toBe(true);
    const catalogClient = fakeClient({ applied: true });
    await inspectPreviewTarget({ client: catalogClient, migrationFiles: manifest });
    expect(catalogClient.queries.some((sql) => sql.includes("contype <> 'n'"))).toBe(true);
    await expect(inspectPreviewTarget({ client: fakeClient({ applied: true, outboxExists: false }), migrationFiles: manifest }))
      .rejects.toThrow('tracked_outbox_missing');
    await expect(inspectPreviewTarget({ client: fakeClient({ applied: true, brokenOutbox: true }), migrationFiles: manifest }))
      .rejects.toThrow('outbox_columns_mismatch');
  });

  it('runs the canonical apply script once from an empty temp cwd with only explicit DB URLs', () => {
    const spawn = jest.fn((executable, args, options) => {
      expect(fs.readdirSync(options.cwd)).toEqual([]);
      return { status: 0, error: null };
    });
    const connectionString = TARGET_URL.toString();
    const verifiedConnectionString = connectionString.replace('sslmode=require', 'sslmode=verify-full');
    expect(connectionStringForRunner(TARGET_URL)).toBe(verifiedConnectionString);
    expect(executeCanonicalApply(verifiedConnectionString, { spawn })).toEqual({ exitAcknowledged: true });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [executable, args, options] = spawn.mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args).toEqual([path.resolve(__dirname, '../../scripts/apply-migrations.js')]);
    expect(options.env).toEqual({ POSTGRES_URL: verifiedConnectionString, DATABASE_URL: verifiedConnectionString });
    expect(options.env.POSTGRES_URL).not.toMatch(/nonproduction-test-secret.*argv/);
    expect(fs.existsSync(options.cwd)).toBe(false);
  });

  it('reconciles an ambiguous apply once via read-only probe and never retries it', async () => {
    Client.mockImplementation(() => {
      const client = fakeClient();
      client.connect = jest.fn().mockResolvedValue(undefined);
      client.end = jest.fn().mockResolvedValue(undefined);
      return client;
    });
    const apply = jest.fn(() => { throw new Error('do not expose credentials or SQL details'); });
    const result = await runOperator({ mode: 'apply', targetUrl: TARGET_URL, apply });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(Client).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({
      applyAttempted: true,
      applyExitAcknowledged: false,
      targetMigrationApplied: false,
      automaticRetry: false,
      pendingMigrationFiles: [TARGET_MIGRATION],
    }));
    expect(JSON.stringify(result)).not.toMatch(/credentials|SQL details|nonproduction-test-secret/);
  });

  it('supports idempotent verify-only after 061 is tracked and physically verified', async () => {
    Client.mockImplementation(() => {
      const client = fakeClient({ applied: true });
      client.connect = jest.fn().mockResolvedValue(undefined);
      client.end = jest.fn().mockResolvedValue(undefined);
      return client;
    });
    const apply = jest.fn();
    const result = await runOperator({ mode: 'verify-only', targetUrl: TARGET_URL, apply });
    expect(result).toEqual(expect.objectContaining({
      mode: 'verify-only',
      targetMigrationApplied: true,
      outboxSchemaVerified: true,
      appliedMigrationFile: TARGET_MIGRATION,
      verifiedOnly: true,
    }));
    expect(apply).not.toHaveBeenCalled();
  });
});
