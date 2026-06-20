/**
 * Grantee token + request verifier. Covers the audience guard (the security-
 * critical reviewer-token-replay rejection), expiry, not-found, and happy path.
 *
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import { mintToken } from '../../lib/services/external-token.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { mintForRequest } from '../../lib/external/grantee-token-lifecycle.js';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token.js';

const SECRET = 'test-secret-32-chars-min-aaaaaaaaaaaa';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';

let originalSecret;
let originalGetRecord;
let originalQueryRecords;

function requestRow(override = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002794',
    akoya_title: 'Test grant',
    wmkf_meetingdate: '2026-06-01',
    wmkf_abstract: 'applicant source abstract',
    wmkf_abstractformatted: 'formatted abstract',
    wmkf_abstractapproved: null,
    ...override,
  };
}

function deliverableRow(override = {}) {
  return {
    wmkf_granteedeliverableid: 'deliv-1',
    wmkf_deliverablestatus: 100000001,
    wmkf_imagefileref: null,
    wmkf_imagecaption: null,
    ...override,
  };
}

beforeEach(() => {
  originalSecret = process.env.EXTERNAL_LINK_SECRET;
  process.env.EXTERNAL_LINK_SECRET = SECRET;
  originalGetRecord = DynamicsService.getRecord;
  originalQueryRecords = DynamicsService.queryRecords;
  DynamicsService.getRecord = jest.fn();
  DynamicsService.queryRecords = jest.fn().mockResolvedValue({ records: [deliverableRow()] });
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.EXTERNAL_LINK_SECRET;
  else process.env.EXTERNAL_LINK_SECRET = originalSecret;
  DynamicsService.getRecord = originalGetRecord;
  DynamicsService.queryRecords = originalQueryRecords;
});

test('happy path: valid grantee token loads the akoya_request and deliverable row', async () => {
  DynamicsService.getRecord.mockResolvedValue(requestRow());
  const { jwt } = await mintForRequest({ requestId: REQUEST_ID });

  const r = await verifyGranteeToken(jwt);
  expect(r.ok).toBe(true);
  expect(r.requestId).toBe(REQUEST_ID);
  expect(r.request.akoya_requestnum).toBe('1002794');
  expect(r.deliverable.wmkf_deliverablestatus).toBe(100000001);
  // loaded against the request entity set
  expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, expect.any(Object));
  expect(DynamicsService.queryRecords).toHaveBeenCalledWith('wmkf_granteedeliverables', expect.objectContaining({
    filter: `_wmkf_request_value eq ${REQUEST_ID}`,
  }));
});

test('SECURITY: a reviewer token (no aud) is rejected with invalid_claim', async () => {
  const { jwt } = await mintToken({
    suggestionId: '11111111-1111-1111-1111-111111111111',
    requestId: REQUEST_ID,
    ops: ['download_proposal'],
    expiresAt: new Date(Date.now() + 60_000),
  });
  const r = await verifyGranteeToken(jwt);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('invalid_claim');
  // must reject BEFORE any Dataverse lookup
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('expired token → expired (no Dataverse lookup)', async () => {
  // Deterministic: sign a grantee token whose exp is already in the past
  // (mintScopedToken refuses past expiry, so go direct via jose). At/after the
  // exp boundary jose throws JWTExpired → reason 'expired'.
  const { SignJWT } = await import('jose');
  const jwt = await new SignJWT({ sub: REQUEST_ID, ops: ['edit_abstract'] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(Math.floor((Date.now() - 120_000) / 1000))
    .setAudience('grantee')
    .setExpirationTime(Math.floor((Date.now() - 1000) / 1000)) // 1s in the past
    .sign(new TextEncoder().encode(SECRET));
  const result = await verifyGranteeToken(jwt);
  expect(result.ok).toBe(false);
  expect(result.reason).toBe('expired');
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('garbage token → malformed', async () => {
  const r = await verifyGranteeToken('not-a-jwt');
  expect(r.ok).toBe(false);
  expect(['malformed', 'invalid_signature']).toContain(r.reason);
});

test('SECURITY: array-form aud (["grantee"]) is rejected with invalid_claim', async () => {
  // A token whose aud is the array ['grantee'] must NOT satisfy the strict
  // `=== 'grantee'` string guard. Mint one directly via jose to force array aud.
  const { SignJWT } = await import('jose');
  const jwt = await new SignJWT({ sub: REQUEST_ID, ops: ['edit_abstract'] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setAudience(['grantee']) // array form
    .setExpirationTime(Math.floor((Date.now() + 60_000) / 1000))
    .sign(new TextEncoder().encode(SECRET));
  const r = await verifyGranteeToken(jwt);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('invalid_claim');
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('SECURITY: valid signature + aud:grantee but missing sub → malformed', async () => {
  const { SignJWT } = await import('jose');
  const jwt = await new SignJWT({ ops: ['edit_abstract'] }) // no sub
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setAudience('grantee')
    .setExpirationTime(Math.floor((Date.now() + 60_000) / 1000))
    .sign(new TextEncoder().encode(SECRET));
  const r = await verifyGranteeToken(jwt);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('malformed');
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('request not found (404) → not_found', async () => {
  DynamicsService.getRecord.mockRejectedValue(Object.assign(new Error('Get record failed (404)'), { status: 404 }));
  const { jwt } = await mintForRequest({ requestId: REQUEST_ID });
  const r = await verifyGranteeToken(jwt);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('not_found');
});

test('request row missing required keys → not_found', async () => {
  DynamicsService.getRecord.mockResolvedValue({ akoya_requestid: null });
  const { jwt } = await mintForRequest({ requestId: REQUEST_ID });
  const r = await verifyGranteeToken(jwt);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('not_found');
});
