/** @jest-environment node */

const {
  MAX_PAGES_PER_STORE,
  PAGE_LIMIT,
  STORES,
  collectStoreMetadata,
  createPlan,
  parseArgs,
  requireExecutionAuthorization,
  runProbe,
  validateCredentials,
} = require('../../scripts/probe-memory-blob-retention.cjs');

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const credentials = {
  BLOB_READ_WRITE_TOKEN: 'shared-test-token',
  DVX_BLOB_RW_TOKEN: 'private-test-token',
};

function blob(pathname, ageDays, size = 10) {
  return {
    pathname,
    size,
    uploadedAt: new Date(NOW - ageDays * 86_400_000),
    url: 'https://private.example/blob-url',
    downloadUrl: 'https://private.example/download-url',
    etag: 'private-etag',
  };
}

test('defaults to a safe plan and refuses execution without both explicit flags', () => {
  expect(parseArgs([])).toMatchObject({ execute: false, authorizeMeteredList: false });
  expect(createPlan()).toMatchObject({ mode: 'plan-only', listingAuthorized: false, sdkOperation: 'list' });
  expect(() => requireExecutionAuthorization({ execute: true, authorizeMeteredList: false }))
    .toThrow('metered_list_authorization_required');
  expect(() => requireExecutionAuthorization({ execute: false, authorizeMeteredList: true }))
    .toThrow('metered_list_authorization_required');
  expect(() => requireExecutionAuthorization({ execute: true, authorizeMeteredList: true })).not.toThrow();
});

test('requires both distinct credentials and never includes them in a summary', async () => {
  expect(() => validateCredentials({})).toThrow('required_blob_credentials_missing');
  expect(() => validateCredentials({
    BLOB_READ_WRITE_TOKEN: 'same',
    DVX_BLOB_RW_TOKEN: 'same',
  })).toThrow('blob_credentials_must_be_distinct');

  const result = await runProbe({
    env: credentials,
    nowMs: NOW,
    listFn: async () => ({ blobs: [], hasMore: false }),
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(credentials.BLOB_READ_WRITE_TOKEN);
  expect(serialized).not.toContain(credentials.DVX_BLOB_RW_TOKEN);
});

test('maps each allowlisted prefix to its own explicit credential', async () => {
  const calls = [];
  const result = await runProbe({
    env: credentials,
    nowMs: NOW,
    listFn: async (options) => {
      calls.push({ prefix: options.prefix, token: options.token, limit: options.limit });
      return { blobs: [], hasMore: false };
    },
  });
  expect(calls).toEqual([
    { prefix: 'reviewer-finder/', token: credentials.BLOB_READ_WRITE_TOKEN, limit: PAGE_LIMIT },
    { prefix: 'dataverse-export/', token: credentials.DVX_BLOB_RW_TOKEN, limit: PAGE_LIMIT },
  ]);
  expect(result).toMatchObject({ complete: true, aggregationBasis: expect.any(String) });
  expect(result.stores).toHaveLength(2);
});

test('aggregates safe age and size metadata and omits all blob-level identifiers', async () => {
  let call = 0;
  const result = await collectStoreMetadata({
    store: STORES[0],
    token: 'never-return-this-token',
    nowMs: NOW,
    listFn: async (options) => {
      call += 1;
      expect(options).toMatchObject({ prefix: 'reviewer-finder/', limit: PAGE_LIMIT });
      expect(options.token).toBe('never-return-this-token');
      return {
        blobs: call === 1
          ? [blob('reviewer-finder/one.pdf', 5, 11), blob('reviewer-finder/two.pdf', 400, 13)]
          : [blob('reviewer-finder/three.pdf', 45, 17)],
        hasMore: call === 1,
        ...(call === 1 ? { cursor: 'opaque-cursor-value' } : {}),
      };
    },
  });

  expect(result).toMatchObject({
    complete: true,
    pages: 2,
    rowsSeen: 3,
    validRows: 3,
    invalidRows: 0,
    bytes: 41,
    oldestAgeDays: 400,
    newestAgeDays: 5,
    ageBuckets: {
      under30Days: 1,
      '30To89Days': 1,
      '365DaysOrMore': 1,
    },
  });
  const serialized = JSON.stringify(result);
  for (const secret of [
    'never-return-this-token',
    'reviewer-finder/one.pdf',
    'opaque-cursor-value',
    'private.example',
    'private-etag',
  ]) expect(serialized).not.toContain(secret);
});

test.each([
  ['missing cursor', { blobs: [], hasMore: true }, 'missing_cursor'],
  ['repeated cursor', (store) => ({ blobs: [], hasMore: true, cursor: store }), 'repeated_cursor'],
])('marks %s as incomplete without exposing the cursor', async (_label, pageFactory, failure) => {
  let calls = 0;
  const result = await collectStoreMetadata({
    store: STORES[0],
    token: 'opaque-token',
    nowMs: NOW,
    listFn: async (options) => {
      calls += 1;
      return typeof pageFactory === 'function'
        ? pageFactory(options.cursor || 'repeated-cursor')
        : pageFactory;
    },
  });
  expect(result).toMatchObject({ complete: false, failure });
  expect(JSON.stringify(result)).not.toContain('repeated-cursor');
  expect(calls).toBe(failure === 'repeated_cursor' ? 2 : 1);
});

test('caps each store at five pages and marks the aggregate incomplete', async () => {
  let calls = 0;
  const result = await collectStoreMetadata({
    store: STORES[1],
    token: 'private-token',
    nowMs: NOW,
    listFn: async () => {
      calls += 1;
      return { blobs: [], hasMore: true, cursor: `cursor-${calls}` };
    },
  });
  expect(calls).toBe(MAX_PAGES_PER_STORE);
  expect(result).toMatchObject({ complete: false, pages: MAX_PAGES_PER_STORE, failure: 'page_limit_reached' });
});

test('counts malformed size, date, and wrong-prefix rows as invalid and incomplete', async () => {
  const result = await collectStoreMetadata({
    store: STORES[0],
    token: 'token',
    nowMs: NOW,
    listFn: async () => ({
      blobs: [
        blob('reviewer-finder/bad-size.pdf', 1, Infinity),
        { ...blob('reviewer-finder/bad-date.pdf', 1), uploadedAt: new Date(NaN) },
        blob('other-prefix/wrong.pdf', 1, 7),
        blob('reviewer-finder/future.pdf', -1, 9),
      ],
      hasMore: false,
    }),
  });
  expect(result).toMatchObject({
    complete: false,
    rowsSeen: 4,
    validRows: 0,
    invalidRows: 4,
    bytes: 0,
    oldestAgeDays: null,
    newestAgeDays: null,
    failure: 'invalid_metadata_rows',
  });
});

test('contains SDK failures to a safe store status without serializing the raw error', async () => {
  const result = await collectStoreMetadata({
    store: STORES[1],
    token: 'token',
    nowMs: NOW,
    listFn: async () => { throw new Error('https://secret.example/path?token=raw-secret'); },
  });
  expect(result).toMatchObject({ complete: false, pages: 1, failure: 'list_request_failed' });
  expect(JSON.stringify(result)).not.toContain('secret.example');
  expect(JSON.stringify(result)).not.toContain('raw-secret');
});
