jest.mock('pg', () => ({ Client: jest.fn() }));
jest.mock('@vercel/blob', () => ({ del: jest.fn(), get: jest.fn(), put: jest.fn() }));
jest.mock('../../scripts/bootstrap-transcription-preview', () => ({
  validateTarget: jest.fn(),
  verifyBootstrapReadback: jest.fn(async () => undefined),
  verifySeedReadback: jest.fn(async () => undefined),
}));

const fs = require('node:fs');
const path = require('node:path');
const { ReadableStream } = require('node:stream/web');
const {
  EXPECTED_STORE_TOKEN_PREFIX,
  parseTargetEnvironment,
  runStorageCheck,
} = require('../../scripts/check-transcription-preview-storage');
const { verifyBootstrapReadback, verifySeedReadback } = require('../../scripts/bootstrap-transcription-preview');

const TOKEN = `${EXPECTED_STORE_TOKEN_PREFIX}test-secret`;
const FIXTURE = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/transcription/synthetic-aac.m4a'));
const HASH = 'aaaabbbb';

function fakeClient({ jobs = '0', readOnly = 'on', database = 'neondb', events = [] } = {}) {
  const queries = [];
  return {
    queries,
    ended: false,
    async connect() { queries.push('CONNECT'); events.push('pg:CONNECT'); },
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      events.push(`pg:${normalized}`);
      if (normalized === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: readOnly }] };
      if (normalized === 'SELECT current_database() AS database_name') return { rows: [{ database_name: database }] };
      if (normalized.startsWith('SELECT COUNT(*)::text AS count FROM public.transcription_jobs')) return { rows: [{ count: jobs }] };
      return { rows: [] };
    },
    async end() { this.ended = true; queries.push('END'); events.push('pg:END'); },
  };
}

function streamOf(bytes) {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

function blobDouble({ initialPresent = false, failPutAfterPersist = false, events = [] } = {}) {
  const objects = new Map();
  const calls = [];
  return {
    calls,
    objects,
    async get(pathname, options) {
      calls.push(['get', pathname, options]);
      events.push('blob:get');
      if (objects.has(pathname)) {
        const bytes = objects.get(pathname);
        return { statusCode: 200, blob: { pathname, size: bytes.length }, stream: streamOf(bytes) };
      }
      if (initialPresent && calls.filter(([name]) => name === 'get').length === 1) {
        const bytes = Buffer.from('preexisting');
        objects.set(pathname, bytes);
        return { statusCode: 200, blob: { pathname, size: bytes.length }, stream: streamOf(bytes) };
      }
      return { statusCode: 404 };
    },
    async put(pathname, bytes, options) {
      calls.push(['put', pathname, options]);
      events.push('blob:put');
      objects.set(pathname, Buffer.from(bytes));
      if (failPutAfterPersist) throw new Error('ambiguous provider detail must not escape');
      return { pathname, url: `https://store_Qri02A1kj96tQYR9.private.blob.vercel-storage.com/${pathname}` };
    },
    async del(pathname, options) {
      calls.push(['del', pathname, options]);
      events.push('blob:del');
      objects.delete(pathname);
    },
  };
}

describe('transcription Preview storage operator check', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts only the dedicated database and private Blob credentials', () => {
    expect(parseTargetEnvironment(`POSTGRES_URL=postgres://x:y@ep-gentle-smoke-b77a6d90-pooler.us-east-2.aws.neon.tech:5432/neondb?sslmode=require\nBLOB_READ_WRITE_TOKEN=${TOKEN}`))
      .toEqual(expect.objectContaining({ BLOB_READ_WRITE_TOKEN: TOKEN }));
    expect(() => parseTargetEnvironment(`POSTGRES_URL=postgres://x:y@host/neondb\nBLOB_READ_WRITE_TOKEN=wrong`))
      .toThrow('preview_blob_store_token_mismatch');
    expect(parseTargetEnvironment(`POSTGRES_URL=postgres://x:y@host/neondb\nBLOB_READ_WRITE_TOKEN=${TOKEN}\nASSEMBLYAI_API_KEY=ignored-secret\nCRON_SECRET=ignored-secret`))
      .toEqual({ POSTGRES_URL: 'postgres://x:y@host/neondb', BLOB_READ_WRITE_TOKEN: TOKEN });
  });

  it('checks isolated read-only Postgres first, then verifies a real bounded Blob round-trip and exact cleanup', async () => {
    const events = [];
    const client = fakeClient({ events });
    const blobs = blobDouble({ events });
    const inspected = { container: 'M4A', codec: 'AAC', durationSeconds: 0.5 };
    const output = await runStorageCheck({
      client, token: TOKEN, fixture: FIXTURE, blobApi: blobs, timeoutMs: 1000,
      audioInspector: jest.fn(async () => inspected),
      makeId: () => '11111111-1111-4111-8111-111111111111',
    });
    const pathname = 'transcription-pilot/preflight/11111111-1111-4111-8111-111111111111/synthetic-aac.m4a';
    expect(output).toEqual(expect.objectContaining({
      completed: true, database: 'neondb', transcriptionJobs: 0,
      blobStoreTokenPrefixMatched: true, blobRoundTripVerified: true,
      exactPathCleanupVerified: true, fixtureBytes: FIXTURE.length,
      media: inspected,
    }));
    expect(output.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(client.queries).toContain('BEGIN READ ONLY');
    expect(client.queries).toContain('SHOW transaction_read_only');
    expect(client.queries).toContain('COMMIT');
    expect(events.indexOf('pg:END')).toBeLessThan(events.indexOf('blob:put'));
    expect(verifyBootstrapReadback).toHaveBeenCalledWith(client);
    expect(verifySeedReadback).toHaveBeenCalledWith(client);
    expect(blobs.calls.filter(([name]) => name === 'put')).toHaveLength(1);
    expect(blobs.calls.find(([name]) => name === 'put')[1]).toBe(pathname);
    expect(blobs.calls.find(([name]) => name === 'put')[2]).toEqual(expect.objectContaining({
      access: 'private', token: TOKEN, addRandomSuffix: false, allowOverwrite: false,
      abortSignal: expect.any(AbortSignal),
    }));
    expect(blobs.calls.filter(([name]) => name === 'del').map(([, name]) => name)).toEqual([pathname]);
    expect(blobs.objects.size).toBe(0);
    expect(JSON.stringify(output)).not.toContain(TOKEN);
  });

  it('fails before Blob access unless DB is exactly read-only, schema/admin verified, and jobs are zero', async () => {
    const client = fakeClient({ jobs: '1' });
    const blobs = blobDouble();
    await expect(runStorageCheck({ client, token: TOKEN, fixture: FIXTURE, blobApi: blobs, audioInspector: jest.fn() }))
      .rejects.toThrow('transcription_preview_storage_check_failed:transcription_jobs_not_empty');
    expect(blobs.calls).toHaveLength(0);

    const notReadOnly = fakeClient({ readOnly: 'off' });
    await expect(runStorageCheck({ client: notReadOnly, token: TOKEN, fixture: FIXTURE, blobApi: blobs, audioInspector: jest.fn() }))
      .rejects.toThrow('transcription_preview_storage_check_failed:readonly_transaction_not_confirmed');
    expect(blobs.calls).toHaveLength(0);

    const schemaFailure = fakeClient();
    await expect(runStorageCheck({
      client: schemaFailure, token: TOKEN, fixture: FIXTURE, blobApi: blobs, audioInspector: jest.fn(),
      schemaVerifier: async () => { throw new Error('schema unsafe'); },
    })).rejects.toThrow('transcription_preview_storage_check_failed:unexpected_error');
    expect(blobs.calls).toHaveLength(0);
  });

  it('does not overwrite or delete a pre-existing object at the generated path', async () => {
    const client = fakeClient();
    const blobs = blobDouble({ initialPresent: true });
    await expect(runStorageCheck({ client, token: TOKEN, fixture: FIXTURE, blobApi: blobs, audioInspector: jest.fn() }))
      .rejects.toThrow('transcription_preview_storage_check_failed:blob_path_still_present');
    expect(blobs.calls.some(([name]) => name === 'put')).toBe(false);
    expect(blobs.calls.some(([name]) => name === 'del')).toBe(false);
    expect(blobs.objects.size).toBe(1);
  });

  it('deletes and verifies the exact path after an ambiguous upload failure', async () => {
    const client = fakeClient();
    const blobs = blobDouble({ failPutAfterPersist: true });
    let failure;
    try {
      await runStorageCheck({ client, token: TOKEN, fixture: FIXTURE, blobApi: blobs, audioInspector: jest.fn() });
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({ cleanupVerified: false, cleanupAbsentObserved: true, cleanupOutcomeAmbiguous: true });
    expect(failure.message).toBe('transcription_preview_storage_check_failed:unexpected_error:blob_cleanup_unverified');
    const putPath = blobs.calls.find(([name]) => name === 'put')[1];
    expect(blobs.calls.find(([name]) => name === 'del')[1]).toBe(putPath);
    expect(failure.cleanupPath).toBe(putPath);
    expect(blobs.calls.filter(([name]) => name === 'get')).toHaveLength(2);
    expect(blobs.objects.size).toBe(0);
  });

  it('reports the opaque cleanup path when exact-path deletion cannot be verified', async () => {
    const client = fakeClient();
    const blobs = blobDouble();
    const originalDelete = blobs.del;
    blobs.del = async (pathname, options) => {
      blobs.calls.push(['del', pathname, options]);
      throw new Error('remote detail must not escape');
    };
    let failure;
    try {
      await runStorageCheck({ client, token: TOKEN, fixture: FIXTURE, blobApi: blobs, audioInspector: async () => ({ durationSeconds: 1 }) });
    } catch (error) { failure = error; }
    expect(failure.message).toBe('transcription_preview_storage_check_failed:unexpected_error:blob_cleanup_unverified');
    expect(failure.cleanupPath).toMatch(/^transcription-pilot\/preflight\/[0-9a-f-]{36}\/synthetic-aac\.m4a$/);
    expect(blobs.objects.size).toBe(1);
    blobs.del = originalDelete;
  });

  it('runs cleanup even when local media validation rejects the fetched fixture', async () => {
    const client = fakeClient();
    const blobs = blobDouble();
    await expect(runStorageCheck({
      client, token: TOKEN, fixture: FIXTURE, blobApi: blobs,
      audioInspector: async () => { throw new Error('parser details must not escape'); },
    })).rejects.toThrow('transcription_preview_storage_check_failed:unexpected_error');
    expect(blobs.calls.some(([name]) => name === 'del')).toBe(true);
    expect(blobs.objects.size).toBe(0);
  });
});
