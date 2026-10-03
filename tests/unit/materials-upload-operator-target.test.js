import {
  assertMaterialsOperatorDatabaseIdentity,
  productionMaterialsDatabaseConfig,
  productionMutationConfirmed,
} from '../../lib/services/site-visit-materials/materials-upload-operator-target.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  inspectMaterialsUploadJob,
  resolveMaterialsUploadJobFromOperator,
} from '../../lib/services/site-visit-materials/materials-upload-operator-runtime.js';

jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn(async () => { throw new Error('unexpected_default_connection'); }) },
  sql: jest.fn(async () => { throw new Error('unexpected_sql_helper'); }),
}));

const EXPECTED_HOST = 'ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech';
const SECRET = 'fakepassword-for-test-only';
const JOB_ID = '514a4377-e14a-448a-b44e-b203981e4f66';

function environment(url, extra = {}) {
  return { MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL: url, ...extra };
}

function url({ host = EXPECTED_HOST, database = 'neondb', sslmode = 'verify-full', suffix = '' } = {}) {
  return `postgresql://operator:${SECRET}@${host}:5432/${database}?sslmode=${sslmode}${suffix}`;
}

describe('materials production operator target', () => {
  function mockClient({ database = 'neondb', schema = 'public' } = {}) {
    const events = [];
    const client = {
      events,
      connect: jest.fn(async () => { events.push('CONNECT'); }),
      end: jest.fn(async () => { events.push('END'); }),
      query: jest.fn(async (query) => {
        const normalized = String(query).replace(/\s+/g, ' ').trim();
        events.push(normalized);
        if (normalized.startsWith('SELECT current_database()')) {
          return { rows: [{ database, schema }] };
        }
        if (normalized.includes('FROM materials_upload_jobs WHERE id = $1 FOR UPDATE')) {
          return { rows: [{
            id: JOB_ID, staging_id: 'stage-1', request_id: 'request-1', actor_binding: 'actor-1',
            status: 'needs_attention', error_code: 'uncertain_write', lease_active: false,
          }] };
        }
        if (normalized.includes('FROM portal_upload_staging WHERE id = $1 FOR UPDATE')) {
          return { rows: [{
            status: 'pending', background_job_id: JOB_ID, scope: 'site_visit_material',
            resource_id: 'request-1', actor_binding: 'actor-1', lease_active: false,
          }] };
        }
        if (normalized.startsWith('UPDATE materials_upload_jobs')) {
          return { rows: [{ id: JOB_ID, status: 'queued', attempt_count: 0 }] };
        }
        if (normalized.startsWith('SELECT j.id')) return { rows: [{ id: JOB_ID, status: 'needs_attention' }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    return client;
  }

  test('builds explicit verified-TLS client configuration without URL-based driver fallbacks', () => {
    const target = productionMaterialsDatabaseConfig({
      env: environment(url()),
      expectedHost: EXPECTED_HOST,
      expectedDatabase: 'neondb',
    });
    expect(target.clientConfig).toMatchObject({
      host: EXPECTED_HOST,
      port: 5432,
      database: 'neondb',
      user: 'operator',
      password: SECRET,
      ssl: { rejectUnauthorized: true },
      options: '',
    });
  });

  test.each([
    ['missing fixed environment variable', {}, 'production_database_url_missing'],
    ['wrong hostname', environment(url({ host: 'wrong.example' })), 'production_target_mismatch'],
    ['wrong database', environment(url({ database: 'otherdb' })), 'production_target_mismatch'],
    ['unverified TLS', environment(url({ sslmode: 'prefer' })), 'production_tls_verification_required'],
    ['query host override', environment(url({ suffix: '&host=other.example' })), 'production_database_url_override_refused'],
    ['query options override', environment(url({ suffix: '&options=-c%20search_path=other' })), 'production_database_url_override_refused'],
    ['certificate path query parameter', environment(url({ suffix: '&sslcert=%2Ftmp%2Fclient.crt' })), 'production_database_url_override_refused'],
    ['ambiguous duplicate SSL mode', environment(url({ suffix: '&sslmode=require' })), 'production_database_url_override_refused'],
    ['IP endpoint', environment(url({ host: '127.0.0.1' })), 'production_database_url_incomplete'],
    ['PGOPTIONS redirect', environment(url(), { PGOPTIONS: '-c search_path=other' }), 'postgres_options_environment_refused'],
    ['missing password', environment(`postgresql://operator@${EXPECTED_HOST}/neondb?sslmode=verify-full`), 'production_database_url_incomplete'],
    ['missing explicit port', environment(`postgresql://operator:${SECRET}@${EXPECTED_HOST}/neondb?sslmode=verify-full`), 'production_database_url_incomplete'],
  ])('refuses %s with a stable reason code', (_label, env, code) => {
    expect(() => productionMaterialsDatabaseConfig({
      env,
      expectedHost: EXPECTED_HOST,
      expectedDatabase: 'neondb',
    })).toThrow(code);
  });

  test('uses the explicit URL port even when PGPORT is set', () => {
    const target = productionMaterialsDatabaseConfig({
      env: environment(url(), { PGPORT: '6543' }),
      expectedHost: EXPECTED_HOST,
      expectedDatabase: 'neondb',
    });
    expect(target.clientConfig.port).toBe(5432);
  });

  test('requires an exact job and action confirmation for a mutation', () => {
    const jobId = '514a4377-e14a-448a-b44e-b203981e4f66';
    expect(productionMutationConfirmed({ jobId, action: 'retry', confirmJob: jobId, confirmAction: 'retry' })).toBe(true);
    expect(productionMutationConfirmed({ jobId, action: 'retry', confirmJob: jobId, confirmAction: 'cancel' })).toBe(false);
    expect(productionMutationConfirmed({ jobId, action: 'cancel', confirmJob: 'other', confirmAction: 'cancel' })).toBe(false);
  });

  test('checks database and public schema before protected queries', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ database: 'neondb', schema: 'public' }] }) };
    await expect(assertMaterialsOperatorDatabaseIdentity(client, 'neondb')).resolves.toBeUndefined();
    expect(client.query).toHaveBeenCalledWith('SELECT current_database() AS database, current_schema() AS schema');
    await expect(assertMaterialsOperatorDatabaseIdentity({
      query: jest.fn().mockResolvedValue({ rows: [{ database: 'wrong', schema: 'public' }] }),
    }, 'neondb')).rejects.toMatchObject({ code: 'production_connected_identity_mismatch' });
  });

  test('production mutation checks identity inside the guarded resolver transaction', async () => {
    const client = mockClient();
    const result = await resolveMaterialsUploadJobFromOperator({
      clientConfig: {}, jobId: JOB_ID, action: 'retry', production: true, expectedDatabase: 'neondb',
      createClient: () => client,
    });
    expect(result).toMatchObject({ status: 'queued', attempt_count: 0 });
    const begin = client.events.indexOf('BEGIN');
    const identity = client.events.findIndex((event) => event.startsWith('SELECT current_database()'));
    const selected = client.events.findIndex((event) => event.includes('FROM materials_upload_jobs WHERE id = $1 FOR UPDATE'));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(identity).toBeGreaterThan(begin);
    expect(selected).toBeGreaterThan(identity);
  });

  test.each([{ database: 'otherdb' }, { schema: 'other_schema' }])(
    'production identity mismatch %j rolls back before any guarded job query or mutation', async (identity) => {
    const client = mockClient(identity);
    await expect(resolveMaterialsUploadJobFromOperator({
      clientConfig: {}, jobId: JOB_ID, action: 'retry', production: true, expectedDatabase: 'neondb',
      createClient: () => client,
    })).rejects.toMatchObject({ code: 'production_connected_identity_mismatch' });
    expect(client.events).toContain('BEGIN');
    expect(client.events.some((event) => event === 'ROLLBACK')).toBe(true);
    expect(client.events.some((event) => event.includes('FROM materials_upload_jobs'))).toBe(false);
    expect(client.events.some((event) => event.startsWith('UPDATE '))).toBe(false);
  });

  test('production inspect checks identity before selecting and uses a read-only transaction', async () => {
    const client = mockClient();
    await inspectMaterialsUploadJob({
      clientConfig: {}, jobId: JOB_ID, production: true, expectedDatabase: 'neondb', createClient: () => client,
    });
    const begin = client.events.indexOf('BEGIN READ ONLY');
    const identity = client.events.findIndex((event) => event.startsWith('SELECT current_database()'));
    const selected = client.events.findIndex((event) => event.startsWith('SELECT j.id'));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(identity).toBeGreaterThan(begin);
    expect(selected).toBeGreaterThan(identity);
    expect(client.events).toContain('COMMIT');
  });

  test.each([{ database: 'otherdb' }, { schema: 'other_schema' }])(
    'production inspect rejects identity mismatch %j without reading a job', async (identity) => {
      const client = mockClient(identity);
      await expect(inspectMaterialsUploadJob({
        clientConfig: {}, jobId: JOB_ID, production: true, expectedDatabase: 'neondb', createClient: () => client,
      })).rejects.toMatchObject({ code: 'production_connected_identity_mismatch' });
      expect(client.events).toContain('BEGIN READ ONLY');
      expect(client.events).toContain('ROLLBACK');
      expect(client.events).not.toContain('COMMIT');
      expect(client.events.some((event) => event.startsWith('SELECT j.id'))).toBe(false);
      expect(client.events.at(-1)).toBe('END');
    },
  );

  test('the actual CLI refuses production mutations before opening a connection without exact confirmations', () => {
    const jobId = '514a4377-e14a-448a-b44e-b203981e4f66';
    const cli = spawnSync(process.execPath, [
      path.join(process.cwd(), 'scripts/materials-upload-job.js'),
      '--target', 'production', '--expected-host', EXPECTED_HOST, '--expected-database', 'neondb',
      '--job-id', jobId, '--action', 'retry',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL: url() },
      timeout: 10_000,
    });
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain('production_mutation_confirmation_required');
    expect(cli.stderr).not.toContain(SECRET);
  });

  test('the actual CLI rejects missing production destination confirmations without printing URL credentials', () => {
    const cli = spawnSync(process.execPath, [
      path.join(process.cwd(), 'scripts/materials-upload-job.js'),
      '--target', 'production', '--job-id', '514a4377-e14a-448a-b44e-b203981e4f66',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL: url() },
      timeout: 10_000,
    });
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain('production_target_confirmation_required');
    expect(cli.stderr).not.toContain(SECRET);
  });

  test('the actual CLI refuses a URL supplied on argv in production mode', () => {
    const cli = spawnSync(process.execPath, [
      path.join(process.cwd(), 'scripts/materials-upload-job.js'),
      '--target', 'production', '--database-url', url(), '--expected-host', EXPECTED_HOST,
      '--expected-database', 'neondb', '--job-id', '514a4377-e14a-448a-b44e-b203981e4f66',
    ], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 });
    expect(cli.status).toBe(2);
    expect(cli.stderr).not.toContain(SECRET);
  });

  test('the actual CLI rejects unknown and duplicate options', () => {
    for (const args of [
      ['--database-url', 'postgres://user:pass@127.0.0.1/db', '--job-id', '514a4377-e14a-448a-b44e-b203981e4f66', '--typo', 'x'],
      ['--database-url', 'postgres://user:pass@127.0.0.1/db', '--job-id', '514a4377-e14a-448a-b44e-b203981e4f66', '--action', 'inspect', '--action', 'retry'],
    ]) {
      const cli = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/materials-upload-job.js'), ...args], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
      });
      expect(cli.status).toBe(2);
      expect(cli.stderr).toContain('Usage:');
    }
  });
});
