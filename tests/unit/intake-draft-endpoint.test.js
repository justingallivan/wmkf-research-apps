/**
 * Tests for POST /api/intake/draft (autosave endpoint).
 *
 * Strategy: mock the four dependency modules (session, bridge, membership,
 * draft service, audit) and exercise each guard + the happy paths.
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
    getByKey: jest.fn(),
    upsertDraftJson: jest.fn(),
  },
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => Promise.resolve(null)),
  },
}));

import { getServerSession } from 'next-auth/next';
import { resolveContactForSession } from '../../lib/services/contact-bridge-service';
import { hasLiveMembership } from '../../lib/services/membership-service';
import IntakeDraftService from '../../lib/services/intake-draft-service';
import IntakeAuditService from '../../lib/services/intake-audit-service';
import handler from '../../pages/api/intake/draft';

const CONTACT_OID = 'oid-applicant-1';
const CONTACT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DRAFT_ROW = {
  id: 42,
  contact_oid: CONTACT_OID,
  account_id: ACCOUNT_ID,
  form_key: 'phase-ii-2026-06',
  draft_json: { idempotency_key: 'existing-uuid', projectTitle: 'X' },
  attachments: [{ filename: 'a.pdf', scan_result: 'clean' }],
  updated_at: '2026-05-24T22:00:00Z',
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
  accountId: ACCOUNT_ID,
  formKey: 'phase-ii-2026-06',
  draftJson: { projectTitle: 'My Project', narrative: 'in progress…' },
  ...overrides,
});

function mockApplicantSession() {
  getServerSession.mockResolvedValue({
    user: {
      userType: 'applicant',
      contactOid: CONTACT_OID,
      contactEmail: 'jane@example.org',
      contactName: 'Jane Doe',
    },
  });
}

function mockBridgeOk() {
  resolveContactForSession.mockResolvedValue({ ok: true, contactId: CONTACT_ID });
}

beforeEach(() => {
  jest.clearAllMocks();
  IntakeDraftService.upsertDraftJson.mockResolvedValue({
    id: 42,
    updated_at: '2026-05-24T22:00:00Z',
  });
  IntakeDraftService.getByKey.mockResolvedValue(null);
});

describe('intake/draft — method gate', () => {
  test('GET returns 405', async () => {
    const { req, res } = makeReqRes({}, 'GET');
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
  });
});

describe('intake/draft — auth guards', () => {
  test('no session → 401', async () => {
    getServerSession.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('non-applicant session → 401', async () => {
    getServerSession.mockResolvedValue({ user: { userType: 'staff' } });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('applicant session missing contactOid → 401', async () => {
    getServerSession.mockResolvedValue({ user: { userType: 'applicant' } });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe('intake/draft — body validation', () => {
  beforeEach(() => mockApplicantSession());

  test('missing accountId → 400', async () => {
    const { req, res } = makeReqRes(validBody({ accountId: undefined }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/accountId/);
  });

  test('missing formKey → 400', async () => {
    const { req, res } = makeReqRes(validBody({ formKey: undefined }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/formKey/);
  });

  test('draftJson is null → 400', async () => {
    const { req, res } = makeReqRes(validBody({ draftJson: null }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('draftJson is an array → 400', async () => {
    const { req, res } = makeReqRes(validBody({ draftJson: [] }));
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('any non-null requestId is rejected → 400 (Codex S183-round-8 BLOCKER)', async () => {
    // The with-request branch is out of v1 scope and was an ownership-takeover
    // vector. Endpoint MUST reject any requestId — even a syntactically valid
    // UUID string — to prevent another Contributor at the same institution
    // from overwriting/reassigning a request-bound draft.
    const cases = [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'any-string',
      123,
      true,
      [],
      {},
    ];
    for (const requestId of cases) {
      const { req, res } = makeReqRes(validBody({ requestId }));
      await handler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/requestId is not accepted/);
    }
  });

  test('requestId: null is fine (explicit null is allowed alongside the default-null contract)', async () => {
    // The endpoint signature drops requestId entirely; an explicit null in the
    // body should be treated as "not set" and proceed normally. Mocking the
    // happy path here just so this test reaches handler completion.
    getServerSession.mockResolvedValue({
      user: {
        userType: 'applicant',
        contactOid: CONTACT_OID,
        contactEmail: 'jane@example.org',
        contactName: 'Jane Doe',
      },
    });
    resolveContactForSession.mockResolvedValue({ ok: true, contactId: CONTACT_ID });
    hasLiveMembership.mockResolvedValue(true);
    const { req, res } = makeReqRes(validBody({ requestId: null }));
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });
});

describe('intake/draft — bridge paths', () => {
  beforeEach(() => mockApplicantSession());

  test('altKeyNotActive throw → 503 + Retry-After', async () => {
    const err = new Error('alt key pending');
    err.altKeyNotActive = true;
    resolveContactForSession.mockRejectedValue(err);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body.error).toBe('identity_service_initializing');
  });

  test('bridge generic throw → 502', async () => {
    resolveContactForSession.mockRejectedValue(new Error('Dataverse down'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(502);
  });

  test('bridge.conflict → 409 + audit row', async () => {
    resolveContactForSession.mockResolvedValue({
      ok: false,
      reason: 'conflict',
      existingContactId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      existingOid: 'other-oid',
      message: 'oid mismatch',
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('identity_conflict');
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'bridge.conflict',
        actorOid: CONTACT_OID,
      }),
    );
  });

  test('bridge other-failure → 401', async () => {
    resolveContactForSession.mockResolvedValue({ ok: false, reason: 'malformed', message: 'bad' });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe('intake/draft — membership guards', () => {
  beforeEach(() => {
    mockApplicantSession();
    mockBridgeOk();
  });

  test('membership lookup throws → 502', async () => {
    hasLiveMembership.mockRejectedValue(new Error('Dataverse down'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(502);
  });

  test('no live membership → 403', async () => {
    hasLiveMembership.mockResolvedValue(false);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('intake/draft — happy paths', () => {
  beforeEach(() => {
    mockApplicantSession();
    mockBridgeOk();
    hasLiveMembership.mockResolvedValue(true);
  });

  test('new draft: mints idempotency_key, writes audit with isNew=true', async () => {
    IntakeDraftService.getByKey.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ draftId: 42, updatedAt: '2026-05-24T22:00:00Z' });

    const upsertArgs = IntakeDraftService.upsertDraftJson.mock.calls[0][0];
    expect(upsertArgs.contactOid).toBe(CONTACT_OID);
    expect(upsertArgs.accountId).toBe(ACCOUNT_ID);
    expect(upsertArgs.formKey).toBe('phase-ii-2026-06');
    expect(upsertArgs.requestId).toBeNull();
    // Idempotency key minted (UUIDv4 pattern)
    expect(upsertArgs.draftJson.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(upsertArgs.draftJson.projectTitle).toBe('My Project');
    expect(upsertArgs.draftJson.narrative).toBe('in progress…');

    const auditArgs = IntakeAuditService.log.mock.calls[0][0];
    expect(auditArgs.action).toBe('draft.upsert');
    expect(auditArgs.targetId).toBe(42);
    expect(auditArgs.metadata.isNew).toBe(true);
  });

  test('existing draft: preserves idempotency_key, isNew=false', async () => {
    IntakeDraftService.getByKey.mockResolvedValue(DRAFT_ROW);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const upsertArgs = IntakeDraftService.upsertDraftJson.mock.calls[0][0];
    expect(upsertArgs.draftJson.idempotency_key).toBe('existing-uuid');

    expect(IntakeAuditService.log.mock.calls[0][0].metadata.isNew).toBe(false);
  });

  test('caller-supplied idempotency_key in body is IGNORED (server owns lifecycle)', async () => {
    IntakeDraftService.getByKey.mockResolvedValue(DRAFT_ROW);
    const { req, res } = makeReqRes(validBody({
      draftJson: { idempotency_key: 'attacker-chosen-uuid', projectTitle: 'X' },
    }));
    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const upsertArgs = IntakeDraftService.upsertDraftJson.mock.calls[0][0];
    // Existing value preserved, NOT the attacker-supplied one
    expect(upsertArgs.draftJson.idempotency_key).toBe('existing-uuid');
    expect(upsertArgs.draftJson.projectTitle).toBe('X');
  });

  test('caller-supplied idempotency_key on a NEW draft is IGNORED (fresh UUID minted)', async () => {
    IntakeDraftService.getByKey.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody({
      draftJson: { idempotency_key: 'attacker-chosen-uuid', projectTitle: 'X' },
    }));
    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const upsertArgs = IntakeDraftService.upsertDraftJson.mock.calls[0][0];
    expect(upsertArgs.draftJson.idempotency_key).not.toBe('attacker-chosen-uuid');
    expect(upsertArgs.draftJson.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('upsertDraftJson is called (NOT the full upsert) — proves attachments are untouched', async () => {
    // The full IntakeDraftService.upsert is intentionally NOT in our mock surface.
    // If the handler ever switched to it, this test would fail with "is not a function."
    IntakeDraftService.getByKey.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(IntakeDraftService.upsertDraftJson).toHaveBeenCalledTimes(1);
  });

  test('audit metadata is restricted to safe keys only (no draft content leak)', async () => {
    // Codex S183-round-8 LOW: metadata is stored verbatim by IntakeAuditService
    // (only `payload` is hashed). Lock the contract so future edits can't
    // sneak applicant-content fields into metadata. Allowed keys:
    //   accountId   — Dataverse GUID, not PII
    //   formKey     — static identifier (e.g. 'phase-ii-2026-06')
    //   isNew       — boolean
    IntakeDraftService.getByKey.mockResolvedValue(null);
    const { req, res } = makeReqRes(validBody({
      draftJson: { projectTitle: 'Sensitive Title', narrative: 'Sensitive content' },
    }));
    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const auditArgs = IntakeAuditService.log.mock.calls[0][0];
    expect(Object.keys(auditArgs.metadata).sort()).toEqual(['accountId', 'formKey', 'isNew']);
    // Belt-and-suspenders: assert no draft-content values appear in metadata.
    const metaJson = JSON.stringify(auditArgs.metadata);
    expect(metaJson).not.toMatch(/Sensitive/);
  });

  test('audit failure does NOT block the response', async () => {
    IntakeDraftService.getByKey.mockResolvedValue(null);
    IntakeAuditService.log.mockRejectedValue(new Error('audit blew up'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });
});

describe('intake/draft — service failure paths', () => {
  beforeEach(() => {
    mockApplicantSession();
    mockBridgeOk();
    hasLiveMembership.mockResolvedValue(true);
  });

  test('getByKey throw → 500', async () => {
    IntakeDraftService.getByKey.mockRejectedValue(new Error('pg down'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
  });

  test('upsertDraftJson throw → 500', async () => {
    IntakeDraftService.getByKey.mockResolvedValue(null);
    IntakeDraftService.upsertDraftJson.mockRejectedValue(new Error('pg constraint'));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(500);
  });
});
