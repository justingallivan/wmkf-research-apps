/** @jest-environment node */
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createMachineAuthenticator } from '../../lib/services/prompt-jobs/machine-auth.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AUDIENCE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CLIENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SERVICE_PRINCIPAL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ROLE = 'PromptJobs.Admit';
const NOW = 1_800_000_000;
const POLICY = {
  enabled: true, tenantId: TENANT, audience: AUDIENCE, clientId: CLIENT,
  servicePrincipalId: SERVICE_PRINCIPAL, role: ROLE,
};
const issuer = tenant => `https://login.microsoftonline.com/${tenant}/v2.0`;
const keysUrl = tenant => `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;

let privateKey;
let foreignKey;
let localKeys;
let foreignKeys;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const foreignPair = await generateKeyPair('RS256');
  foreignKey = foreignPair.privateKey;
  localKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'fixture-rsa' }] });
  foreignKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(foreignPair.publicKey)), kid: 'fixture-rsa' }] });
});

async function signedHeader(overrides = {}, { alg = 'RS256', key = privateKey, kid = 'fixture-rsa' } = {}) {
  const payload = {
    iss: issuer(TENANT), aud: AUDIENCE, tid: TENANT, ver: '2.0',
    azp: CLIENT, oid: SERVICE_PRINCIPAL, idtyp: 'app', roles: [ROLE],
    iat: NOW - 10, nbf: NOW - 10, exp: NOW + 120,
    ...overrides,
  };
  const token = await new SignJWT(payload).setProtectedHeader({ alg, kid }).sign(key);
  return `Bearer ${token}`;
}

function fixture({ initialPolicy = POLICY, resolver = localKeys } = {}) {
  let config = initialPolicy;
  let seconds = NOW;
  const createKeySet = jest.fn(() => resolver);
  const authenticate = createMachineAuthenticator({
    readPolicy: () => {
      if (config instanceof Error) throw config;
      return config;
    },
    createKeySet, now: () => seconds * 1000,
  });
  return {
    authenticate, createKeySet,
    setPolicy: value => { config = value; },
    setTime: value => { seconds = value; },
  };
}

const ERRORS = {
  401: 'machine_auth_invalid', 403: 'machine_access_denied', 503: 'machine_auth_unavailable',
};

async function expectFailure(attempt, status) {
  const expected = { httpStatus: status, code: ERRORS[status], body: { error: ERRORS[status] } };
  await expect(attempt).rejects.toBeInstanceOf(ServiceHttpError);
  await expect(attempt).rejects.toMatchObject(expected);
  await expect(attempt).rejects.toHaveProperty('body', expected.body);
}

test('verifies an app token using the pinned tenant keys and returns only its normalized identity', async () => {
  const uppercase = Object.fromEntries(Object.entries(POLICY).map(([name, value]) =>
    [name, name.endsWith('Id') || name === 'audience' ? value.toUpperCase() : value]));
  const { authenticate, createKeySet, setPolicy } = fixture({ initialPolicy: uppercase });
  const authorization = await signedHeader({ unrelated: 'private-claim' });
  const identity = await authenticate(authorization.replace('Bearer', 'bearer'));

  expect(identity).toEqual({
    tenantId: TENANT, clientId: CLIENT, servicePrincipalId: SERVICE_PRINCIPAL,
    principalKey: `app:entra-v2:${TENANT}:${CLIENT}:${SERVICE_PRINCIPAL}`, assertCurrent: expect.any(Function),
  });
  expect(Object.isFrozen(identity)).toBe(true);
  expect(JSON.stringify(identity)).not.toContain(authorization.slice(7));
  setPolicy(POLICY);
  expect(identity.assertCurrent()).toBeUndefined();
  await authenticate(authorization);
  expect(createKeySet).toHaveBeenCalledTimes(1);
  expect(createKeySet.mock.calls[0][0].href).toBe(keysUrl(TENANT));
});

test.each([
  ['absent', null],
  ['disabled', { ...POLICY, enabled: false }],
  ['truthy enable', { ...POLICY, enabled: 'true' }],
  ['invalid tenant', { ...POLICY, tenantId: 'common' }],
  ['invalid audience', { ...POLICY, audience: `api://${AUDIENCE}` }],
  ['invalid client', { ...POLICY, clientId: ` ${CLIENT}` }],
  ['missing service principal', { ...POLICY, servicePrincipalId: undefined }],
  ['invalid role', { ...POLICY, role: 'PromptJobs Admit' }],
  ['unrecognized setting', { ...POLICY, jwksUrl: 'https://example.invalid' }],
  ['unreadable', new Error('private config detail')],
])('returns 503 before resolver creation for %s configuration', async (_name, initialPolicy) => {
  const { authenticate, createKeySet } = fixture({ initialPolicy });
  await expectFailure(authenticate(await signedHeader()), 503);
  expect(createKeySet).not.toHaveBeenCalled();
});

test.each([
  ['missing', undefined], ['array', ['Bearer a.b.c']], ['Basic', 'Basic a.b.c'],
  ['extra space', 'Bearer  a.b.c'], ['two parts', 'Bearer a.b'],
  ['multiple headers', 'Bearer a.b.c, Bearer d.e.f'],
  ['oversize', `Bearer ${'a'.repeat(16384)}.b.c`],
])('rejects %s authorization before resolver creation', async (_name, value) => {
  const { authenticate, createKeySet } = fixture();
  await expectFailure(authenticate(value), 401);
  expect(createKeySet).not.toHaveBeenCalled();
});

test.each([
  ['foreign issuer', { iss: issuer(FOREIGN_TENANT) }],
  ['wrong audience', { aud: CLIENT }],
  ['multiple audiences', { aud: [AUDIENCE, CLIENT] }],
  ['foreign tenant claim', { tid: FOREIGN_TENANT }],
  ['wrong token version', { ver: '1.0' }],
  ['delegated identity', { idtyp: 'user' }],
  ['missing identity type', { idtyp: undefined }],
  ['delegated scopes', { scp: 'PromptJobs.Admit' }],
  ['empty delegated scopes', { scp: '' }],
  ['missing roles', { roles: undefined }],
  ['empty roles', { roles: [] }],
  ['string roles', { roles: ROLE }],
  ['non-string role', { roles: [ROLE, 1] }],
  ['missing client', { azp: undefined }],
  ['missing service principal', { oid: undefined }],
  ['missing expiry', { exp: undefined }],
  ['missing not-before', { nbf: undefined }],
  ['missing issued-at', { iat: undefined }],
  ['expired', { exp: NOW }],
  ['future not-before', { nbf: NOW + 1 }],
  ['future issued-at', { iat: NOW + 1 }],
  ['fractional issued-at', { iat: NOW - 0.5 }],
  ['fractional not-before', { nbf: NOW - 0.5 }],
  ['fractional expiry', { exp: NOW + 0.5 }],
  ['string expiry', { exp: String(NOW + 10) }],
  ['negative issued-at', { iat: -1 }],
  ['lifetime over 7200 seconds', { exp: NOW - 10 + 7201 }],
])('returns the same 401 for %s', async (_name, claims) => {
  const { authenticate } = fixture();
  await expectFailure(authenticate(await signedHeader(claims)), 401);
});

test.each([
  ['wrong role', { roles: ['PromptJobs.Read'] }],
  ['role case mismatch', { roles: [ROLE.toLowerCase()] }],
  ['unapproved client', { azp: AUDIENCE }],
  ['unapproved service principal', { oid: CLIENT }],
])('returns the same 403 for %s', async (_name, claims) => {
  const { authenticate } = fixture();
  await expectFailure(authenticate(await signedHeader(claims)), 403);
});

test('rejects a forbidden algorithm, an invalid signature and an unknown key', async () => {
  const { authenticate } = fixture();
  for (const options of [
    { alg: 'RS512' }, { key: foreignKey }, { kid: 'unrecognized' },
  ]) {
    await expectFailure(authenticate(await signedHeader({}, options)), 401);
  }
});

test('accepts an exact 7200-second lifetime', async () => {
  const { authenticate } = fixture();
  await expect(authenticate(await signedHeader({ exp: NOW - 10 + 7200 }))).resolves.toMatchObject({ clientId: CLIENT });
});

test.each([
  ['timeout', new errors.JWKSTimeout()],
  ['malformed remote JSON', new errors.JOSEError('Failed to parse the JSON Web Key Set HTTP response as JSON')],
  ['unreachable host', Object.assign(new Error('private network detail'), { code: 'EHOSTUNREACH' })],
  ['TLS failure', Object.assign(new Error('private certificate detail'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })],
  ['wrapped network failure', new Error('private wrapper detail', {
    cause: Object.assign(new Error('private socket detail'), { code: 'ENETUNREACH' }),
  })],
  ['unexpected resolver failure', new Error('private dependency detail')],
])('reports a JWKS %s as a safe 503', async (_name, failure) => {
  const { authenticate } = fixture({ resolver: async () => { throw failure; } });
  await expectFailure(authenticate(await signedHeader()), 503);
});

test('reports a resolver factory failure as a safe 503 and retries initialization on the next request', async () => {
  const { authenticate, createKeySet } = fixture();
  createKeySet.mockImplementationOnce(() => { throw new Error('private resolver detail'); });
  const authorization = await signedHeader();
  await expectFailure(authenticate(authorization), 503);
  await expect(authenticate(authorization)).resolves.toMatchObject({ clientId: CLIENT });
  expect(createKeySet).toHaveBeenCalledTimes(2);
});

test.each([
  ['disabled policy', f => f.setPolicy({ ...POLICY, enabled: false }), 503],
  ['changed enabled policy', f => f.setPolicy({ ...POLICY, role: 'PromptJobs.Other' }), 503],
  ['expired token', f => f.setTime(NOW + 120), 401],
])('checks %s after waiting for signature keys', async (_name, change, status) => {
  let release;
  let entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const f = fixture({ resolver: async (...args) => {
    entered();
    await waiting;
    return localKeys(...args);
  } });
  const attempt = f.authenticate(await signedHeader());
  await started;
  change(f);
  release();
  await expectFailure(attempt, status);
});

test('a tenant change replaces the resolver and invalidates the prior identity', async () => {
  const f = fixture();
  f.createKeySet.mockImplementation(url => url.href === keysUrl(TENANT) ? localKeys : foreignKeys);
  const previous = await f.authenticate(await signedHeader());
  f.setPolicy({ ...POLICY, tenantId: FOREIGN_TENANT });
  await expectFailure(Promise.resolve().then(previous.assertCurrent), 503);
  const foreignClaims = { tid: FOREIGN_TENANT, iss: issuer(FOREIGN_TENANT) };
  await expectFailure(f.authenticate(await signedHeader(foreignClaims)), 401);
  const current = await f.authenticate(await signedHeader(foreignClaims, { key: foreignKey }));
  expect(current.tenantId).toBe(FOREIGN_TENANT);
  expect(f.createKeySet.mock.calls.map(([url]) => url.href)).toEqual([keysUrl(TENANT), keysUrl(FOREIGN_TENANT)]);
  f.setTime(NOW + 120);
  await expectFailure(Promise.resolve().then(current.assertCurrent), 401);
});
