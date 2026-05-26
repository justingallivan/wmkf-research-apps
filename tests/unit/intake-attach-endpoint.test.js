/**
 * Tests for POST /api/intake/draft/attach (S184 chunk 5).
 *
 * Mocks the full dependency surface: session, bridge, membership,
 * draft service, audit, @vercel/blob (get + del), cloudmersive-scan,
 * virus-scan-config, intake-blob token helper, form-schema loader.
 *
 * Design: docs/INTAKE_ATTACH_CHUNK5_DESIGN.md
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
    promoteToClean: jest.fn(),
    removePending: jest.fn(),
  },
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => Promise.resolve(null)),
  },
}));
jest.mock('@vercel/blob', () => ({
  get: jest.fn(),
  del: jest.fn(),
}));
jest.mock('../../lib/services/cloudmersive-scan', () => ({
  scanBytes: jest.fn(),
}));
jest.mock('../../lib/utils/virus-scan-config', () => ({
  isVirusScanEnabled: jest.fn(() => true),
  VIRUS_DETECTION_ALERT_EMAIL: 'alerts@wmkeck.org',
}));
jest.mock('../../lib/utils/intake-blob', () => ({
  getIntakeBlobToken: jest.fn(() => 'vercel_blob_rw_fake_token'),
}));
jest.mock('../../lib/utils/form-schema', () => ({
  getFormSchema: jest.fn(),
  findFileField: jest.fn(),
  countFieldEntries: jest.fn(() => 0),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: {
    notify: jest.fn(() => Promise.resolve(null)),
  },
}));

import { getServerSession } from 'next-auth/next';
import { resolveContactForSession } from '../../lib/services/contact-bridge-service';
import { hasLiveMembership } from '../../lib/services/membership-service';
import IntakeDraftService from '../../lib/services/intake-draft-service';
import IntakeAuditService from '../../lib/services/intake-audit-service';
import { get as blobGet, del as blobDel } from '@vercel/blob';
import { scanBytes } from '../../lib/services/cloudmersive-scan';
import { isVirusScanEnabled } from '../../lib/utils/virus-scan-config';
import { getIntakeBlobToken } from '../../lib/utils/intake-blob';
import { getFormSchema, findFileField, countFieldEntries } from '../../lib/utils/form-schema';
import NotificationService from '../../lib/services/notification-service';
import handler from '../../pages/api/intake/draft/attach';

const CONTACT_OID = 'oid-applicant-1';
const OTHER_CONTACT_OID = 'oid-applicant-2';
const CONTACT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DRAFT_ID = 42;
const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const FORM_KEY = 'phase-ii-research-2026-06';

// Valid PDF magic bytes for happy path
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

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

const PENDING_ENTRY = {
  attachmentId: ATTACHMENT_ID,
  fieldKey: 'pi_biosketch',
  filename: 'biosketch.pdf',
  pathname: `drafts/${DRAFT_ID}/${ATTACHMENT_ID}`,
  contentType: 'application/pdf',
  maxBytes: 10 * 1024 * 1024,
  createdAt: '2026-05-24T20:00:00.000Z',
  validUntil: '2026-05-24T21:00:00.000Z',
};

const DRAFT_ROW = {
  id: DRAFT_ID,
  contact_oid: CONTACT_OID,
  account_id: ACCOUNT_ID,
  form_key: FORM_KEY,
  request_id: null,
  draft_json: {},
  attachments: [],
  pending_attachments: [PENDING_ENTRY],
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
  attachmentId: ATTACHMENT_ID,
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

function mockBlobStream(buf = PDF_MAGIC) {
  // Mock a ReadableStream-like object. Response()'s constructor accepts
  // a Blob, ArrayBuffer, or stream; node-fetch / undici accept Uint8Array.
  // Simpler: stub the Response wrapper by returning a fake stream that
  // our code wraps in Response().arrayBuffer().
  return {
    blob: { url: 'https://blob.vercel-storage.com/test-blob' },
    stream: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(buf)); controller.close(); },
    }),
  };
}

function setHappyDefaults() {
  mockApplicantSession();
  IntakeDraftService.getById.mockResolvedValue(DRAFT_ROW);
  getFormSchema.mockReturnValue({ sections: [] });
  findFileField.mockReturnValue(SINGLE_FILE_FIELD);
  countFieldEntries.mockReturnValue(0);
  blobGet.mockResolvedValue(mockBlobStream(PDF_MAGIC));
  blobDel.mockResolvedValue(undefined);
  isVirusScanEnabled.mockReturnValue(true);
  scanBytes.mockResolvedValue({
    scan_result: 'clean',
    foundViruses: [],
    scannedAt: '2026-05-24T20:00:30.000Z',
    scanner: 'cloudmersive',
  });
  IntakeDraftService.promoteToClean.mockResolvedValue({ promoted: true });
  IntakeDraftService.removePending.mockResolvedValue({ removed: true });
  resolveContactForSession.mockResolvedValue({ ok: true, contactId: CONTACT_ID });
  hasLiveMembership.mockResolvedValue(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  getIntakeBlobToken.mockReturnValue('vercel_blob_rw_fake_token');
  isVirusScanEnabled.mockReturnValue(true);
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

  test('staff session → 401', async () => {
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

  test('missing draftId → 400', async () => {
    const { req, res } = makeReqRes({ attachmentId: ATTACHMENT_ID });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('unsafe-integer draftId → 400', async () => {
    const { req, res } = makeReqRes(validBody({ draftId: Number.MAX_SAFE_INTEGER + 1 }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('missing attachmentId → 400', async () => {
    const { req, res } = makeReqRes({ draftId: DRAFT_ID });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('attachmentId not a UUID → 400', async () => {
    const { req, res } = makeReqRes(validBody({ attachmentId: 'not-a-uuid' }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('extra field → 400', async () => {
    const { req, res } = makeReqRes({ ...validBody(), bogus: 'x' });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test.each([
    'pathname', 'filename', 'contentType', 'fieldKey',
    'accountId', 'formKey', 'requestId', 'contactOid', 'draftJson',
  ])('forbidden field %s → 400', async (forbidden) => {
    const { req, res } = makeReqRes({ ...validBody(), [forbidden]: 'sneaky' });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(forbidden);
  });
});

describe('draft load + ownership', () => {
  beforeEach(setHappyDefaults);

  test('getById null → 404 draft_not_found', async () => {
    IntakeDraftService.getById.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('draft_not_found');
  });

  test('getById throws → 500', async () => {
    IntakeDraftService.getById.mockRejectedValue(new Error('pg down'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('direct owner skips bridge + membership', async () => {
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(resolveContactForSession).not.toHaveBeenCalled();
    expect(hasLiveMembership).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test('non-owner with membership succeeds', async () => {
    mockApplicantSession(OTHER_CONTACT_OID);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });

  test('non-owner without membership → 403 + ownership_denied audit', async () => {
    mockApplicantSession(OTHER_CONTACT_OID);
    hasLiveMembership.mockResolvedValue(false);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach.ownership_denied' }),
    );
  });

  test('bridge altKey → 503 + Retry-After', async () => {
    mockApplicantSession(OTHER_CONTACT_OID);
    const err = new Error('alt-key not active');
    err.altKeyNotActive = true;
    resolveContactForSession.mockRejectedValue(err);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
  });

  test('bridge conflict → 409 identity_conflict', async () => {
    mockApplicantSession(OTHER_CONTACT_OID);
    resolveContactForSession.mockResolvedValue({ ok: false, reason: 'conflict' });
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

describe('A2 dual-lookup', () => {
  beforeEach(setHappyDefaults);

  test('attachmentId in attachments[] → 200 already_attached, NO blob/scan calls', async () => {
    IntakeDraftService.getById.mockResolvedValue({
      ...DRAFT_ROW,
      attachments: [{ attachmentId: ATTACHMENT_ID, filename: 'x.pdf', scan_result: 'clean' }],
      pending_attachments: [],
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'already_attached', attachmentId: ATTACHMENT_ID });
    expect(blobGet).not.toHaveBeenCalled();
    expect(scanBytes).not.toHaveBeenCalled();
  });

  test('attachmentId in neither array → 404 pending_not_found', async () => {
    IntakeDraftService.getById.mockResolvedValue({
      ...DRAFT_ROW,
      attachments: [],
      pending_attachments: [],
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('pending_not_found');
  });

  test('attachmentId in pending → proceeds to scan path', async () => {
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(blobGet).toHaveBeenCalled();
    expect(scanBytes).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});

describe('schema lookup', () => {
  beforeEach(setHappyDefaults);

  test('schema gone → 500 form_schema_unknown', async () => {
    getFormSchema.mockReturnValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('form_schema_unknown');
  });

  test('field gone → 500 field_not_uploadable', async () => {
    findFileField.mockReturnValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('field_not_uploadable');
  });
});

describe('Blob download', () => {
  beforeEach(setHappyDefaults);

  test('result null → 409 bytes_not_uploaded, pending intact', async () => {
    blobGet.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('bytes_not_uploaded');
    expect(IntakeDraftService.removePending).not.toHaveBeenCalled();
  });

  test('blobGet transient throw → 503 blob_unavailable', async () => {
    blobGet.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('blob_unavailable');
  });

  test('blobGet non-transient throw → 500 + audit blob_misconfigured', async () => {
    const err = Object.assign(new Error('auth'), {
      serviceName: 'blob',
      status: 403,
      isTransient: false,
    });
    blobGet.mockRejectedValue(err);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach_blob_misconfigured' }),
    );
  });

  test('INTAKE_BLOB_RW_TOKEN missing → 500 blob_misconfigured', async () => {
    getIntakeBlobToken.mockImplementation(() => { throw new Error('not set'); });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('blob_misconfigured');
  });
});

describe('magic-byte + cardinality + size', () => {
  beforeEach(setHappyDefaults);

  test('magic mismatch → 422 + Blob NOT deleted + removePending + audit', async () => {
    blobGet.mockResolvedValue(mockBlobStream(Buffer.from('not a pdf')));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('magic_mismatch');
    expect(blobDel).not.toHaveBeenCalled();
    expect(IntakeDraftService.removePending).toHaveBeenCalled();
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach_magic_mismatch' }),
    );
  });

  test('single-valued field already at 1 (race) → 422 + del + removePending', async () => {
    countFieldEntries.mockReturnValue(1);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('field_already_has_attachment');
    expect(blobDel).toHaveBeenCalled();
    expect(IntakeDraftService.removePending).toHaveBeenCalled();
  });

  test('multi-valued at maxFiles (race) → 422 + del + removePending', async () => {
    findFileField.mockReturnValue(MULTI_FILE_FIELD);
    countFieldEntries.mockReturnValue(15);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('field_max_files_exceeded');
    expect(blobDel).toHaveBeenCalled();
  });

  test('size exceeds maxBytes → 413 + del + removePending + audit size_exceeded', async () => {
    const huge = Buffer.alloc(11 * 1024 * 1024); // 11MB > 10MB max
    PDF_MAGIC.copy(huge, 0); // pass magic check
    blobGet.mockResolvedValue(mockBlobStream(huge));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(413);
    expect(res.body.error).toBe('size_exceeds_field_max');
    expect(blobDel).toHaveBeenCalled();
    expect(IntakeDraftService.removePending).toHaveBeenCalled();
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach_size_exceeded' }),
    );
  });
});

describe('scanner posture (A7)', () => {
  beforeEach(setHappyDefaults);

  test('scan disabled → scanner:skipped + 200 attached', async () => {
    isVirusScanEnabled.mockReturnValue(false);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('attached');
    expect(scanBytes).not.toHaveBeenCalled();
    expect(IntakeDraftService.promoteToClean).toHaveBeenCalledWith(
      DRAFT_ID,
      ATTACHMENT_ID,
      expect.objectContaining({ scanner: 'skipped', scan_result: 'clean' }),
      expect.objectContaining({ fieldKey: 'pi_biosketch', cap: 1 }),
    );
  });

  test('scan clean → 200 attached', async () => {
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('attached');
  });

  test('scan infected → 422 + del + removePending + audit infected + NotificationService.notify', async () => {
    scanBytes.mockResolvedValue({
      scan_result: 'infected',
      foundViruses: [{ virusName: 'Eicar-Test', fileName: 'biosketch.pdf' }],
      scannedAt: '2026-05-24T20:00:30.000Z',
      scanner: 'cloudmersive',
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('infected');
    expect(blobDel).toHaveBeenCalled();
    expect(IntakeDraftService.removePending).toHaveBeenCalled();
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'draft.attach_infected',
        metadata: expect.objectContaining({ virusName: 'Eicar-Test' }),
      }),
    );

    // B2 detection alert: system_alerts + admin email via virus-detection category.
    // Yield microtasks so the fire-and-forget notify settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(NotificationService.notify).toHaveBeenCalledTimes(1);
    const call = NotificationService.notify.mock.calls[0][0];
    expect(call.type).toBe('virus_detection_intake');
    expect(call.severity).toBe('error');
    expect(call.source).toBe('intake-attach');
    expect(call.explicitRecipients).toEqual(['alerts@wmkeck.org']);
    expect(call.metadata).toEqual(expect.objectContaining({
      draftId: DRAFT_ID,
      attachmentId: ATTACHMENT_ID,
      filename: 'biosketch.pdf',
      formKey: FORM_KEY,
      contactOid: CONTACT_OID,
      virusName: 'Eicar-Test',
    }));
  });

  test('scan infected + del() throws → 422 + audit infected_del_failed (Q3)', async () => {
    scanBytes.mockResolvedValue({
      scan_result: 'infected',
      foundViruses: [{ virusName: 'BadThing' }],
      scannedAt: '2026-05-24T20:00:30.000Z',
      scanner: 'cloudmersive',
    });
    blobDel.mockRejectedValue(Object.assign(new Error('blob 5xx'), {
      serviceName: 'blob', status: 503, isTransient: true,
    }));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach_infected_del_failed' }),
    );
    // Original infected audit also fired
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach_infected' }),
    );
  });

  test('scan transient throw → 503 + audit scan_unavailable + pending intact', async () => {
    scanBytes.mockRejectedValue(Object.assign(new Error('5xx'), {
      serviceName: 'cloudmersive', status: 503, isTransient: true,
    }));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('scan_unavailable');
    expect(IntakeDraftService.removePending).not.toHaveBeenCalled();
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach_scan_unavailable' }),
    );
  });

  test('scan non-transient throw → 500 + audit scan_misconfigured + pending intact', async () => {
    scanBytes.mockRejectedValue(Object.assign(new Error('missing key'), {
      serviceName: 'cloudmersive', status: 500, isTransient: false,
    }));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('scan_misconfigured');
    expect(IntakeDraftService.removePending).not.toHaveBeenCalled();
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach_scan_misconfigured' }),
    );
  });
});

describe('promoteToClean result mapping', () => {
  beforeEach(setHappyDefaults);

  test('promoted: true → 200 attached + audit draft.attach + passes cardinality', async () => {
    IntakeDraftService.promoteToClean.mockResolvedValue({ promoted: true });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'attached', attachmentId: ATTACHMENT_ID });
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach' }),
    );
    // Verify cardinality opts were passed (post-impl real fix)
    expect(IntakeDraftService.promoteToClean).toHaveBeenCalledWith(
      DRAFT_ID,
      ATTACHMENT_ID,
      expect.any(Object),
      { fieldKey: 'pi_biosketch', cap: 1 },
    );
  });

  test('cap_exceeded_race → 422 + del + removePending + cap reason + response carries {cap, current} (Codex Q4)', async () => {
    IntakeDraftService.promoteToClean.mockResolvedValue({
      promoted: false, reason: 'cap_exceeded_race', fieldCount: 1, cap: 1,
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('field_already_has_attachment');
    expect(res.body.cap).toBe(1);
    expect(res.body.current).toBe(1);
    expect(blobDel).toHaveBeenCalled();
    expect(IntakeDraftService.removePending).toHaveBeenCalled();
  });

  test('cap_exceeded_race + del() throws → 422 + audit cap_race_del_failed (Codex Q6)', async () => {
    IntakeDraftService.promoteToClean.mockResolvedValue({
      promoted: false, reason: 'cap_exceeded_race', fieldCount: 1, cap: 1,
    });
    blobDel.mockRejectedValue(Object.assign(new Error('blob 5xx'), {
      serviceName: 'blob', status: 503, isTransient: true,
    }));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft.attach_cap_race_del_failed' }),
    );
  });

  test('multi-valued field with missing maxFiles → endpoint falls back to cap:1 (Codex Q4)', async () => {
    findFileField.mockReturnValue({
      key: 'co_investigator_biosketches',
      type: 'file',
      accept: ['application/pdf'],
      maxSizeMb: 10,
      multiple: true,
      // maxFiles intentionally missing
    });
    IntakeDraftService.promoteToClean.mockResolvedValue({ promoted: true });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(IntakeDraftService.promoteToClean).toHaveBeenCalledWith(
      DRAFT_ID,
      ATTACHMENT_ID,
      expect.any(Object),
      expect.objectContaining({ cap: 1 }), // fallback
    );
  });

  test('multi-valued cap_exceeded_race → 422 field_max_files_exceeded', async () => {
    findFileField.mockReturnValue(MULTI_FILE_FIELD);
    IntakeDraftService.promoteToClean.mockResolvedValue({
      promoted: false, reason: 'cap_exceeded_race', fieldCount: 15, cap: 15,
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('field_max_files_exceeded');
    // Verify cap=15 was passed for the multi-valued field
    expect(IntakeDraftService.promoteToClean).toHaveBeenCalledWith(
      DRAFT_ID,
      ATTACHMENT_ID,
      expect.any(Object),
      { fieldKey: 'pi_biosketch', cap: 15 },
    );
  });

  test('promoteToClean throws → 500 promote_failed', async () => {
    IntakeDraftService.promoteToClean.mockRejectedValue(new Error('pg down'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('promote_failed');
  });

  test('race_already_promoted → 200 already_attached, NO audit', async () => {
    IntakeDraftService.promoteToClean.mockResolvedValue({
      promoted: false, reason: 'race_already_promoted',
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'already_attached', attachmentId: ATTACHMENT_ID });
    // No draft.attach audit row for the racing-call short-circuit.
    const draftAttachCalls = IntakeAuditService.log.mock.calls.filter(
      ([row]) => row.action === 'draft.attach',
    );
    expect(draftAttachCalls).toHaveLength(0);
  });

  test('pending_not_found from promote → 404', async () => {
    IntakeDraftService.promoteToClean.mockResolvedValue({
      promoted: false, reason: 'pending_not_found',
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('pending_not_found');
  });

  test('draft_not_found from promote → 404', async () => {
    IntakeDraftService.promoteToClean.mockResolvedValue({
      promoted: false, reason: 'draft_not_found',
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('draft_not_found');
  });
});

describe('A3 audit shape on happy path', () => {
  beforeEach(setHappyDefaults);

  test('draft.attach metadata has all required fields (incl. draftId per MOD-5 carryover)', async () => {
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'draft.attach',
        actorOid: CONTACT_OID,
        targetId: DRAFT_ID,
        payload: expect.objectContaining({ filename: 'biosketch.pdf' }),
        metadata: expect.objectContaining({
          draftId: DRAFT_ID,
          attachmentId: ATTACHMENT_ID,
          fieldKey: 'pi_biosketch',
          pathname: PENDING_ENTRY.pathname,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          size: PDF_MAGIC.length,
          scanner: 'cloudmersive',
          scan_result: 'clean',
          contentType: 'application/pdf',
        }),
      }),
    );
  });

  test('magic_mismatch audit includes sniffedType (chunk-5 post-impl drift fix)', async () => {
    blobGet.mockResolvedValue(mockBlobStream(Buffer.from('not a pdf — plain text')));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'draft.attach_magic_mismatch',
        metadata: expect.objectContaining({
          sniffedType: 'unknown',
          declaredContentType: 'application/pdf',
        }),
      }),
    );
  });
});

describe('chunk-5 post-impl fixes', () => {
  beforeEach(setHappyDefaults);

  test('blob_url missing → 500 blob_url_missing (no promote, no delete)', async () => {
    blobGet.mockResolvedValue({
      // blob.url omitted
      blob: {},
      stream: new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(PDF_MAGIC)); controller.close(); },
      }),
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('blob_url_missing');
    expect(IntakeDraftService.promoteToClean).not.toHaveBeenCalled();
    expect(blobDel).not.toHaveBeenCalled();
  });

  test('scanned_at missing in scanner result → falls back to ISO now()', async () => {
    scanBytes.mockResolvedValue({
      scan_result: 'clean',
      foundViruses: [],
      // scannedAt missing
      scanner: 'cloudmersive',
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const cleanRow = IntakeDraftService.promoteToClean.mock.calls[0][2];
    expect(typeof cleanRow.scanned_at).toBe('string');
    expect(cleanRow.scanned_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('removePending throws → swallowed silently (does not propagate)', async () => {
    scanBytes.mockResolvedValue({
      scan_result: 'infected',
      foundViruses: [{ virusName: 'X' }],
      scannedAt: '2026-05-24T20:00:30.000Z',
      scanner: 'cloudmersive',
    });
    IntakeDraftService.removePending.mockRejectedValue(new Error('pg blip'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('infected');
  });

  test('Response(stream).arrayBuffer() throws → 503 blob_unavailable', async () => {
    blobGet.mockResolvedValue({
      blob: { url: 'https://x' },
      stream: new ReadableStream({
        start(controller) { controller.error(new Error('stream broken')); },
      }),
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('blob_unavailable');
  });
});
