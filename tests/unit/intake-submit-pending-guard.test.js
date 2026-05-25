/**
 * Focused tests for the S184 chunk-6 A1 guard on /api/intake/submit.
 *
 * Scope: ONLY the pending_attachments rejection. Full /submit endpoint
 * test coverage (auth, bridge, membership, attachment-shape validation,
 * idempotency-key collision handling, etc.) is intentionally not in
 * scope of this chunk — it would be a much larger test file. This test
 * file verifies the A1 guard fires correctly and is non-regressive on
 * the happy path.
 *
 * @jest-environment node
 */

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('../../lib/services/contact-bridge-service', () => ({
  resolveContactForSession: jest.fn(),
}));
jest.mock('../../lib/services/membership-service', () => ({
  hasSubmitterRole: jest.fn(),
}));
jest.mock('../../lib/services/intake-draft-service', () => ({
  __esModule: true,
  default: {
    getByKey: jest.fn(),
  },
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  __esModule: true,
  default: {
    log: jest.fn(() => Promise.resolve(null)),
  },
}));
// /submit's deep dependencies (DB transaction, GUID gen, etc.) — stub
// out to no-ops since we're only exercising the early A1 guard.
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { getServerSession } from 'next-auth/next';
import { resolveContactForSession } from '../../lib/services/contact-bridge-service';
import { hasSubmitterRole } from '../../lib/services/membership-service';
import IntakeDraftService from '../../lib/services/intake-draft-service';
import handler from '../../pages/api/intake/submit';

const CONTACT_OID = 'oid-applicant-1';
const CONTACT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeReqRes(body = {}) {
  const req = { method: 'POST', body, headers: {} };
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

const validBody = () => ({
  accountId: ACCOUNT_ID,
  formKey: 'phase-ii-research-2026-06',
  idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
});

function makeDraft(overrides = {}) {
  return {
    id: 42,
    contact_oid: CONTACT_OID,
    account_id: ACCOUNT_ID,
    form_key: 'phase-ii-research-2026-06',
    request_id: null,
    draft_json: {
      idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
      // budget lines + form fields — required by validators downstream
      // but irrelevant for the A1 guard (rejected before this point on
      // pending-non-empty).
    },
    attachments: [],
    pending_attachments: [],
    ...overrides,
  };
}

const ORIGINAL_POSTGRES_URL = process.env.POSTGRES_URL;
beforeEach(() => {
  jest.clearAllMocks();
  // Dummy POSTGRES_URL so newPool() doesn't throw module-level. We
  // never reach actual DB code in this focused test (the A1 guard
  // either short-circuits at 409 or the non-A1 tests catch a downstream
  // error and assert only on whether the A1 code fired).
  process.env.POSTGRES_URL = 'postgresql://fake:fake@localhost:5432/fake';
  getServerSession.mockResolvedValue({
    user: {
      userType: 'applicant',
      contactOid: CONTACT_OID,
      contactEmail: 'jane@example.org',
      contactName: 'Jane Doe',
    },
  });
  resolveContactForSession.mockResolvedValue({ ok: true, contactId: CONTACT_ID });
  hasSubmitterRole.mockResolvedValue(true);
});

afterEach(() => {
  if (ORIGINAL_POSTGRES_URL === undefined) {
    delete process.env.POSTGRES_URL;
  } else {
    process.env.POSTGRES_URL = ORIGINAL_POSTGRES_URL;
  }
});

describe('S184 A1 guard: /api/intake/submit + pending_attachments', () => {
  test('non-empty pending_attachments → 409 pending_attachments_present', async () => {
    IntakeDraftService.getByKey.mockResolvedValue(makeDraft({
      pending_attachments: [
        {
          attachmentId: '660e8400-e29b-41d4-a716-446655440001',
          fieldKey: 'pi_biosketch',
          filename: 'in-flight.pdf',
          pathname: 'drafts/42/660e8400-e29b-41d4-a716-446655440001',
          createdAt: '2026-05-24T20:00:00.000Z',
        },
      ],
    }));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('pending_attachments_present');
    expect(res.body.pendingCount).toBe(1);
    expect(res.body.message).toMatch(/in progress/);
  });

  test('multiple pending entries → 409 with accurate pendingCount', async () => {
    IntakeDraftService.getByKey.mockResolvedValue(makeDraft({
      pending_attachments: [
        { attachmentId: 'a', fieldKey: 'pi_biosketch', filename: 'x.pdf', pathname: 'drafts/42/a' },
        { attachmentId: 'b', fieldKey: 'co_investigator_biosketches', filename: 'y.pdf', pathname: 'drafts/42/b' },
        { attachmentId: 'c', fieldKey: 'letters_of_support', filename: 'z.pdf', pathname: 'drafts/42/c' },
      ],
    }));
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.pendingCount).toBe(3);
  });

  test('empty pending_attachments → guard does NOT fire (regression guard)', async () => {
    // The draft has attachments=[] (no clean ones either) — submit
    // will fail later with 422 unclean-attachments-shape, NOT with
    // 409 pending_attachments_present. Asserting it's not the A1 guard.
    IntakeDraftService.getByKey.mockResolvedValue(makeDraft({ pending_attachments: [] }));
    const { req, res } = makeReqRes(validBody());
    // The endpoint continues past A1 and hits real DB code; we don't
    // care about that failure — only that A1 didn't fire.
    try { await handler(req, res); } catch (_) { /* downstream failure expected */ }
    expect(res.body?.error).not.toBe('pending_attachments_present');
  });

  test('pending_attachments missing entirely (legacy drafts) → guard does NOT fire', async () => {
    const draft = makeDraft();
    delete draft.pending_attachments;
    IntakeDraftService.getByKey.mockResolvedValue(draft);
    const { req, res } = makeReqRes(validBody());
    // The endpoint continues past A1 and hits real DB code; we don't
    // care about that failure — only that A1 didn't fire.
    try { await handler(req, res); } catch (_) { /* downstream failure expected */ }
    expect(res.body?.error).not.toBe('pending_attachments_present');
  });
});
