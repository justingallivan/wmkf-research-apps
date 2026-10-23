/** @jest-environment node */

const {
  ARTIFACT_PATH,
  MAX_PAGES_PER_STORE,
  PAGE_LIMIT,
  STORE,
  collectPrivateStoreMetadata,
  createPlan,
  extractTokenStoreId,
  fingerprintStoreId,
  main,
  parseArgs,
  requireExecutionAuthorization,
  validatePrivateCredential,
} = require('../../scripts/probe-memory-private-blob-retention.cjs');

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const privateTestToken = 'vercel_blob_rw_privatealpha_testsecret';
const fingerprintFor = (fingerprint) => () => fingerprint;

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

function fakeFs({ exists = false } = {}) {
  const writes = [];
  return {
    writes,
    existsSync: () => exists,
    mkdirSync: jest.fn(),
    writeFileSync: (...args) => writes.push(args),
  };
}

test('defaults to a private-only plan and requires both execution flags', () => {
  expect(parseArgs([])).toMatchObject({ execute: false, authorizeMeteredList: false });
  expect(createPlan()).toMatchObject({
    mode: 'plan-only',
    listingAuthorized: false,
    store: STORE.name,
    authorizationMeaning: '--authorize-metered-list acknowledges existing named human approval; it creates no new approval',
  });
  expect(() => requireExecutionAuthorization({ execute: true, authorizeMeteredList: false }))
    .toThrow('metered_list_authorization_required');
  expect(() => requireExecutionAuthorization({ execute: false, authorizeMeteredList: true }))
    .toThrow('metered_list_authorization_required');
  expect(() => requireExecutionAuthorization({ execute: true, authorizeMeteredList: true })).not.toThrow();
});

test.each([
  ['without execution authorization', ['--execute'], { DVX_BLOB_RW_TOKEN: privateTestToken }],
  ['without the private token', ['--execute', '--authorize-metered-list'], {}],
  ['when the artifact already exists', ['--execute', '--authorize-metered-list'], { DVX_BLOB_RW_TOKEN: privateTestToken }, true],
])('does not load the SDK %s', async (_label, argv, env, exists = false) => {
  const fs = fakeFs({ exists });
  const loadList = jest.fn();
  const errors = [];
  await main(argv, {
    env,
    fs,
    runtime: { env: {} },
    loadList,
    log: jest.fn(),
    errorLog: (message) => errors.push(message),
  });
  expect(loadList).not.toHaveBeenCalled();
  expect(fs.writes).toHaveLength(0);
  expect(errors).toHaveLength(1);
});

test('accepts only a candidate fingerprint match and rejects public or unknown bindings', () => {
  expect(validatePrivateCredential(
    { DVX_BLOB_RW_TOKEN: privateTestToken },
    { fingerprintFn: fingerprintFor('ffb75e44e30e') },
  )).toEqual({ token: privateTestToken, candidateFingerprintMatches: true });
  expect(() => validatePrivateCredential(
    { DVX_BLOB_RW_TOKEN: privateTestToken },
    { fingerprintFn: fingerprintFor('6060259031fd') },
  )).toThrow('private_blob_token_matches_known_public_store');
  expect(() => validatePrivateCredential(
    { DVX_BLOB_RW_TOKEN: privateTestToken },
    { fingerprintFn: fingerprintFor('000000000000') },
  )).toThrow('private_blob_store_fingerprint_unrecognized');
});

test('parses the token store-ID segment and applies the SHA-256 fingerprint algorithm', () => {
  expect(extractTokenStoreId(privateTestToken)).toBe('privatealpha');
  expect(fingerprintStoreId('privatealpha')).toBe('a7b06b10f0b4');
});

test('rejects matching shared credentials and malformed token shapes', () => {
  expect(() => validatePrivateCredential({
    DVX_BLOB_RW_TOKEN: privateTestToken,
    BLOB_READ_WRITE_TOKEN: privateTestToken,
  }, { fingerprintFn: fingerprintFor('ffb75e44e30e') }))
    .toThrow('private_blob_credential_matches_shared_token');
  expect(() => validatePrivateCredential({ DVX_BLOB_RW_TOKEN: 'not-a-vercel-token' }))
    .toThrow('private_blob_token_shape_invalid');
});

test('lists only the private prefix, aggregates metadata, and omits every blob identifier', async () => {
  let call = 0;
  const result = await collectPrivateStoreMetadata({
    token: 'private-token-not-for-output',
    nowMs: NOW,
    listFn: async (options) => {
      call += 1;
      expect(options).toMatchObject({ prefix: 'dataverse-export/', limit: PAGE_LIMIT, mode: 'expanded' });
      expect(options.token).toBe('private-token-not-for-output');
      return {
        blobs: call === 1 ? [blob('dataverse-export/one.xlsx', 5, 11), blob('dataverse-export/two.xlsx', 400, 13)] : [blob('dataverse-export/three.xlsx', 45, 17)],
        hasMore: call === 1,
        ...(call === 1 ? { cursor: 'private-opaque-cursor' } : {}),
      };
    },
  });

  expect(result).toMatchObject({
    complete: true,
    pages: 2,
    rowsSeen: 3,
    validRows: 3,
    bytes: 41,
    oldestAgeDays: 400,
    newestAgeDays: 5,
    ageBuckets: { under30Days: 1, '30To89Days': 1, '365DaysOrMore': 1 },
  });
  const serialized = JSON.stringify(result);
  for (const secret of [
    'private-token-not-for-output',
    'dataverse-export/one.xlsx',
    'private-opaque-cursor',
    'private.example',
    'private-etag',
  ]) expect(serialized).not.toContain(secret);
});

test('caps metadata listing at five pages and reports an incomplete result', async () => {
  let calls = 0;
  const result = await collectPrivateStoreMetadata({
    token: 'private-token',
    nowMs: NOW,
    listFn: async () => {
      calls += 1;
      return { blobs: [], hasMore: true, cursor: `opaque-cursor-${calls}` };
    },
  });
  expect(calls).toBe(MAX_PAGES_PER_STORE);
  expect(result).toMatchObject({ complete: false, pages: 5, failure: 'page_limit_reached' });
  expect(JSON.stringify(result)).not.toContain('opaque-cursor');
});

test('contains list errors without serializing URLs, token values, or raw errors', async () => {
  const result = await collectPrivateStoreMetadata({
    token: 'never-serialize-token',
    nowMs: NOW,
    listFn: async () => { throw new Error('https://secret.example/path?token=raw-secret'); },
  });
  expect(result).toMatchObject({ complete: false, pages: 1, failure: 'list_request_failed' });
  const serialized = JSON.stringify(result);
  for (const secret of ['secret.example', 'raw-secret', 'never-serialize-token']) {
    expect(serialized).not.toContain(secret);
  }
});

test('writes a create-only aggregate with candidate status and runtime binding left unverified', async () => {
  const fs = fakeFs();
  const runtime = { env: {} };
  const loadList = jest.fn(() => async (options) => {
    expect(options.prefix).toBe(STORE.prefix);
    return { blobs: [], hasMore: false };
  });
  const logs = [];
  const status = await main(['--execute', '--authorize-metered-list'], {
    env: { DVX_BLOB_RW_TOKEN: privateTestToken },
    fs,
    runtime,
    loadList,
    nowMs: NOW,
    credentialValidationOptions: { fingerprintFn: fingerprintFor('ffb75e44e30e') },
    log: (message) => logs.push(message),
    errorLog: jest.fn(),
  });

  expect(status).toBe(0);
  expect(runtime.env.VERCEL_BLOB_RETRIES).toBe('0');
  expect(loadList).toHaveBeenCalledTimes(1);
  expect(fs.mkdirSync).toHaveBeenCalled();
  expect(fs.writes).toHaveLength(1);
  expect(fs.writes[0][0]).toBe(ARTIFACT_PATH);
  expect(fs.writes[0][2]).toMatchObject({ mode: 0o600, flag: 'wx' });
  const summary = JSON.parse(fs.writes[0][1]);
  expect(summary).toMatchObject({
    credentialSource: 'process.env',
    runtimeBinding: 'unverified',
    candidateFingerprintMatches: true,
    bindingBasis: 'candidate-name fingerprint only; not runtime or Production proof',
    complete: true,
  });
  expect(JSON.stringify(summary)).not.toContain(privateTestToken);
  expect(logs).toHaveLength(1);
});
