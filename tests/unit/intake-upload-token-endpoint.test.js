/**
 * Tests for POST /api/intake/draft/upload-token (S184 chunk 4).
 *
 * Strategy: mock session + bridge + membership + draft service + audit
 * + form-schema loader + @vercel/blob + intake-blob token helper.
 * Exercise each guard, the direct-owner short-circuit, the cardinality
 * gates, the Blob-mint failure path, and the happy path.
 *
 * Design: docs/INTAKE_ATTACH_CHUNK4_DESIGN.md
 *
 * @jest-environment node
 */

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('../../lib/services/contact-bridge-service', () => ({
  resolveContactForSession: jest.fn(),
}));
jest.mock('../../lib/services/membership-service', () => ({
  hasLiveMembership: jest.fn(),
}));
jest.mock('../../lib/services/intake-draft-service', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
    appendPending: jest.fn(),
  },
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => Promise.resolve(null)),
  },
}));
jest.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: jest.fn(),
}));
jest.mock('../../lib/utils/intake-blob', () => ({
  getIntakeBlobToken: jest.fn(() => 'vercel_blob_rw_fake_token'),
}));
jest.mock('../../lib/utils/form-schema', () => ({
  getFormSchema: jest.fn(),
  findFileField: jest.fn(),
  countFieldEntries: jest.fn(() => 0),
}));

import { getServerSession } from 'next-auth/next';
import { resolveContactForSession } from '../../lib/services/contact-bridge-service';
import { hasLiveMembership } from '../../lib/services/membership-service';
import IntakeDraftService from '../../lib/services/intake-draft-service';
import IntakeAuditService from '../../lib/services/intake-audit-service';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { getIntakeBlobToken } from '../../lib/utils/intake-blob';
import { getFormSchema, findFileField, countFieldEntries } from '../../lib/utils/form-schema';
import handler from '../../pages/api/intake/draft/upload-token';

const CONTACT_OID = 'oid-applicant-1';
const OTHER_CONTACT_OID = 'oid-applicant-2';
const CONTACT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DRAFT_ID = 42;
const FORM_KEY = 'phase-ii-research-2026-06';

const DRAFT_ROW = {
  id: DRAFT_ID,
  contact_oid: CONTACT_OID,
  account_id: ACCOUNT_ID,
  form_key: FORM_KEY,
  request_id: null,
  draft_json: {},
  attachments: [],
  pending_attachments: [],
};

const SINGLE_FILE_FIELD = {
  key: 'pi_biosketch',
  type: 'file',
  accept: ['application/pdf'],
  maxSizeMb: 10,
};

const MULTI_FILE_FIELD = {
  key: 'co_investigator_biosketches',
  type: 'file',
  accept: ['application/pdf'],
  maxSizeMb: 10,
  multiple: true,
  maxFiles: 15,
};

function makeReqRes(body = {}, method = 'POST') {
  const req = { method, body, headers: {} };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
  };
  return { req, res };
}

const validBody = (overrides = {}) => ({
  draftId: DRAFT_ID,
  fieldKey: 'pi_biosketch',
  filename: 'biosketch.pdf',
  contentType: 'application/pdf',
  ...overrides,
});

function mockApplicantSession(oid = CONTACT_OID) {
  getServerSession.mockResolvedValue({
    user: {
      userType: 'applicant',
      contactOid: oid,
      contactEmail: 'jane@example.org',
      contactName: 'Jane Doe',
    },
  });
}

function setHappyDefaults() {
  mockApplicantSession();
  IntakeDraftService.getById.mockResolvedValue(DRAFT_ROW);
  getFormSchema.mockReturnValue({ sections: [] });
  findFileField.mockReturnValue(SINGLE_FILE_FIELD);
  countFieldEntries.mockReturnValue(0);
  // Echo the entry back in `pending` so the LOW-4 invariant check (the
  // endpoint verifies its minted attachmentId appears in the helper's
  // returned array) passes for happy-path tests.
  IntakeDraftService.appendPending.mockImplementation((_id, entry) =>
    Promise.resolve({ pending: [entry] })
  );
  generateClientTokenFromReadWriteToken.mockResolvedValue('mock-blob-token-xyz');
  resolveContactForSession.mockResolvedValue({ ok: true, contactId: CONTACT_ID });
  hasLiveMembership.mockResolvedValue(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  getIntakeBlobToken.mockReturnValue('vercel_blob_rw_fake_token');
});

describe('method + auth', () => {
  test('non-POST → 405', async () => {
    const { req, res } = makeReqRes({}, 'GET');
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  test('no applicant session → 401', async () => {
    getServerSession.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('session missing contactOid → 401', async () => {
    getServerSession.mockResolvedValue({ user: { userType: 'applicant' } });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('staff session (wrong userType) → 401', async () => {
    getServerSession.mockResolvedValue({ user: { userType: 'staff', azureId: 'x' } });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe('body validation', () => {
  beforeEach(() => mockApplicantSession());

  test('null body → 400', async () => {
    const { req, res } = makeReqRes(null);
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('array body → 400', async () => {
    const { req, res } = makeReqRes([]);
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('missing draftId → 400', async () => {
    const { req, res } = makeReqRes(validBody({ draftId: undefined }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('non-integer draftId → 400', async () => {
    const { req, res } = makeReqRes(validBody({ draftId: 'forty-two' }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('zero draftId → 400 (boundary)', async () => {
    const { req, res } = makeReqRes(validBody({ draftId: 0 }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('negative draftId → 400', async () => {
    const { req, res } = makeReqRes(validBody({ draftId: -1 }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('float draftId → 400', async () => {
    const { req, res } = makeReqRes(validBody({ draftId: 1.5 }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('unsafe-integer draftId → 400 (MOD-2)', async () => {
    // Number.MAX_SAFE_INTEGER + 1 — beyond safe-integer range
    const { req, res } = makeReqRes(validBody({ draftId: Number.MAX_SAFE_INTEGER + 1 }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('unexpected extra field → 400 (LOW-2)', async () => {
    const { req, res } = makeReqRes({ ...validBody(), bogus: 'value' });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/bogus/);
  });

  test.each([
    ['fieldKey', ''],
    ['filename', ''],
    ['contentType', ''],
  ])('missing %s → 400', async (key, val) => {
    const { req, res } = makeReqRes(validBody({ [key]: val }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test.each([
    'attachmentId',
    'pathname',
    'accountId',
    'formKey',
    'requestId',
    'contactOid',
    'draftJson',
  ])('forbidden field %s → 400', async (forbidden) => {
    const { req, res } = makeReqRes({ ...validBody(), [forbidden]: 'snuck-in-value' });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(forbidden);
  });
});

describe('draft load + ownership', () => {
  beforeEach(setHappyDefaults);

  test('getById returns null → 404', async () => {
    IntakeDraftService.getById.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  test('getById throws → 500 Draft lookup failed (MOD-3)', async () => {
    IntakeDraftService.getById.mockRejectedValue(new Error('pg down'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('direct owner skips bridge + membership entirely', async () => {
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(resolveContactForSession).not.toHaveBeenCalled();
    expect(hasLiveMembership).not.toHaveBeenCalled();
  });

  test('non-owner with valid membership succeeds', async () => {
    mockApplicantSession(OTHER_CONTACT_OID);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(resolveContactForSession).toHaveBeenCalled();
    expect(hasLiveMembership).toHaveBeenCalledWith(CONTACT_ID, ACCOUNT_ID);
  });

  test('non-owner without membership → 403 + audit emitted', async () => {
    mockApplicantSession(OTHER_CONTACT_OID);
    hasLiveMembership.mockResolvedValue(false);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'draft.upload_token.ownership_denied',
        targetId: DRAFT_ID,
      }),
    );
  });

  test('bridge altKeyNotActive → 503 with Retry-After', async () => {
    mockApplicantSession(OTHER_CONTACT_OID);
    const err = new Error('alt key not yet active');
    err.altKeyNotActive = true;
    resolveContactForSession.mockRejectedValue(err);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
  });

  test('bridge conflict → 409 identity_conflict', async () => {
    mockApplicantSession(OTHER_CONTACT_OID);
    resolveContactForSession.mockResolvedValue({ ok: false, reason: 'conflict', message: 'mismatch' });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('identity_conflict');
  });

  test('draft.request_id set → 409 draft_submitted', async () => {
    IntakeDraftService.getById.mockResolvedValue({ ...DRAFT_ROW, request_id: 'some-guid' });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('draft_submitted');
  });
});

describe('schema + fieldKey resolution', () => {
  beforeEach(setHappyDefaults);

  test('unknown form_key → 500 form_schema_unknown', async () => {
    getFormSchema.mockReturnValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('form_schema_unknown');
  });

  test('fieldKey not in schema → 422 unknown_field_key', async () => {
    findFileField.mockReturnValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('unknown_field_key');
  });

  test('field is not uploadable → 422 field_not_uploadable', async () => {
    findFileField.mockReturnValue({ _notUploadable: true, _found: { type: 'text' } });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('field_not_uploadable');
  });

  test('contentType not in field accept[] → 422 content_type_not_allowed', async () => {
    const { req, res } = makeReqRes(validBody({ contentType: 'image/png' }));
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('content_type_not_allowed');
  });
});

describe('cardinality gate', () => {
  beforeEach(setHappyDefaults);

  test('single-valued field with 1 existing → 422 field_already_has_attachment', async () => {
    countFieldEntries.mockReturnValue(1);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('field_already_has_attachment');
  });

  test('multi-valued field at maxFiles → 422 field_max_files_exceeded', async () => {
    findFileField.mockReturnValue(MULTI_FILE_FIELD);
    countFieldEntries.mockReturnValue(15);
    const { req, res } = makeReqRes(validBody({ fieldKey: 'co_investigator_biosketches' }));
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('field_max_files_exceeded');
  });

  test('multi-valued field under cap → 200', async () => {
    findFileField.mockReturnValue(MULTI_FILE_FIELD);
    countFieldEntries.mockReturnValue(3);
    const { req, res } = makeReqRes(validBody({ fieldKey: 'co_investigator_biosketches' }));
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });
});

describe('filename sanitizer + Blob mint + pending append', () => {
  beforeEach(setHappyDefaults);

  test('filename with `..` → 422 filename_invalid', async () => {
    const { req, res } = makeReqRes(validBody({ filename: '../etc/passwd.pdf' }));
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('filename_invalid');
  });

  test('Blob token mint throws → 500 + audit mint_failed', async () => {
    generateClientTokenFromReadWriteToken.mockRejectedValue(new Error('blob api down'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.upload_token.mint_failed' }),
    );
    expect(IntakeDraftService.appendPending).not.toHaveBeenCalled();
  });

  test('INTAKE_BLOB_RW_TOKEN missing → 500', async () => {
    getIntakeBlobToken.mockImplementation(() => {
      throw new Error('INTAKE_BLOB_RW_TOKEN not configured');
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('appendPending returns null (draft deleted in race) → 404', async () => {
    IntakeDraftService.appendPending.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  test('appendPending throws → 500 pending_append_failed (MOD-4)', async () => {
    IntakeDraftService.appendPending.mockRejectedValue(new Error('pg down'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('pending_append_failed');
  });

  test('appendPending returns array WITHOUT the minted attachmentId → 500 invariant (LOW-4)', async () => {
    // Helper regression / collision: caller contract violated.
    IntakeDraftService.appendPending.mockResolvedValue({ pending: [] });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('pending_append_invariant_violated');
  });
});

describe('schema completeness guards (MOD-1)', () => {
  beforeEach(setHappyDefaults);

  test('schema field missing maxSizeMb → 500 form_schema_field_invalid', async () => {
    findFileField.mockReturnValue({
      key: 'pi_biosketch',
      type: 'file',
      accept: ['application/pdf'],
      // maxSizeMb intentionally missing
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('form_schema_field_invalid');
  });

  test('schema field maxSizeMb <= 0 → 500 form_schema_field_invalid', async () => {
    findFileField.mockReturnValue({ ...SINGLE_FILE_FIELD, maxSizeMb: 0 });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('happy path', () => {
  beforeEach(setHappyDefaults);

  test('200 returns attachmentId, token, pathname, filename, validUntil', async () => {
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('attachmentId');
    expect(res.body).toHaveProperty('token', 'mock-blob-token-xyz');
    expect(res.body).toHaveProperty('pathname');
    expect(res.body.pathname).toMatch(/^drafts\/42\/[0-9a-f-]+$/);
    expect(res.body).toHaveProperty('filename', 'biosketch.pdf');
    expect(res.body).toHaveProperty('validUntil');
    expect(typeof res.body.validUntil).toBe('number');
  });

  test('mint audit row has A3 metadata/payload split (incl. draftId per MOD-5)', async () => {
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'draft.upload_token.mint',
        actorOid: CONTACT_OID,
        targetId: DRAFT_ID,
        payload: expect.objectContaining({ filename: 'biosketch.pdf' }),
        metadata: expect.objectContaining({
          draftId: DRAFT_ID,
          fieldKey: 'pi_biosketch',
          contentType: 'application/pdf',
          maxBytes: 10 * 1024 * 1024,
        }),
      }),
    );
  });

  test('Blob token mint called with tightened content type + max bytes + 1h validUntil (LOW-3)', async () => {
    const before = Date.now();
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    const after = Date.now();
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: expect.stringMatching(/^drafts\/42\//),
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: 10 * 1024 * 1024,
        addRandomSuffix: false,
        allowOverwrite: false,
        token: 'vercel_blob_rw_fake_token',
      }),
    );
    // validUntil is now + 1h, accommodating clock drift across the test
    // call window.
    const callArgs = generateClientTokenFromReadWriteToken.mock.calls[0][0];
    expect(callArgs.validUntil).toBeGreaterThanOrEqual(before + 3600_000);
    expect(callArgs.validUntil).toBeLessThanOrEqual(after + 3600_000);
  });

  test('appendPending called with full entry shape', async () => {
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(IntakeDraftService.appendPending).toHaveBeenCalledWith(
      DRAFT_ID,
      expect.objectContaining({
        attachmentId: expect.any(String),
        fieldKey: 'pi_biosketch',
        filename: 'biosketch.pdf',
        pathname: expect.stringMatching(/^drafts\/42\//),
        contentType: 'application/pdf',
        maxBytes: 10 * 1024 * 1024,
        createdAt: expect.any(String),
        validUntil: expect.any(String),
      }),
    );
  });
});
