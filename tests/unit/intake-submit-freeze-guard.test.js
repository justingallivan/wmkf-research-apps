/**
 * Freeze-transaction optimistic-concurrency guard on /api/intake/submit.
 *
 * Codebase eval 2026-05-29 #2 (P1, Codex-confirmed): submit builds its frozen
 * `payload.attachments` from the load-time draft snapshot, then freezes the
 * draft (sets request_id) in a later transaction. A concurrent /attach that
 * promotes a file into the draft between those two points would be omitted
 * from the queued submission and orphaned. The freeze UPDATE now additionally
 * requires the draft to be unchanged since the snapshot (pending still empty +
 * attachments count unchanged); on a guard-tripped 0-row update with
 * request_id still NULL, submit rolls back and returns a retryable 409.
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
  default: { getByKey: jest.fn() },
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  __esModule: true,
  default: { log: jest.fn(() => Promise.resolve(null)) },
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

// pg transaction client — programmed per-test.
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockEnd = jest.fn(() => Promise.resolve());
const mockConnect = jest.fn(async () => ({ query: mockClientQuery, release: mockRelease }));
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ connect: mockConnect, end: mockEnd })) }));

import { getServerSession } from 'next-auth/next';
import { resolveContactForSession } from '../../lib/services/contact-bridge-service';
import { hasSubmitterRole } from '../../lib/services/membership-service';
import IntakeDraftService from '../../lib/services/intake-draft-service';
import handler from '../../pages/api/intake/submit';

const CONTACT_OID = 'oid-applicant-1';
const CONTACT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const IDEM = '550e8400-e29b-41d4-a716-446655440000';

function makeReqRes(body = {}) {
  const req = { method: 'POST', body, headers: {} };
  const res = {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
  };
  return { req, res };
}

const validBody = () => ({ accountId: ACCOUNT_ID, formKey: 'phase-ii-research-2026-06', idempotencyKey: IDEM });

function makeDraft(overrides = {}) {
  return {
    id: 42,
    contact_oid: CONTACT_OID,
    account_id: ACCOUNT_ID,
    form_key: 'phase-ii-research-2026-06',
    request_id: null,
    draft_json: { idempotency_key: IDEM },
    attachments: [],
    pending_attachments: [],
    ...overrides,
  };
}

// Program the transaction client. The handler issues, in order:
//   BEGIN → INSERT submission_jobs RETURNING → UPDATE intake_drafts (freeze)
//   → [if 0 rows] SELECT request_id FROM intake_drafts → COMMIT|ROLLBACK
function programClient({ freezeRowCount = 1, recheckRequestId = null, jobRow } = {}) {
  const row = jobRow || { id: 7, request_id: 'req-guid', status: 'queued', last_error: null };
  mockClientQuery.mockImplementation(async (text) => {
    const s = String(text);
    if (s.includes('INSERT INTO submission_jobs')) return { rows: [row] };
    if (s.includes('UPDATE intake_drafts')) return { rowCount: freezeRowCount };
    if (s.includes('SELECT request_id FROM intake_drafts')) return { rows: [{ request_id: recheckRequestId }] };
    return {}; // BEGIN / COMMIT / ROLLBACK
  });
}

const ORIGINAL_POSTGRES_URL = process.env.POSTGRES_URL;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.POSTGRES_URL = 'postgresql://fake:fake@localhost:5432/fake';
  getServerSession.mockResolvedValue({
    user: { userType: 'applicant', contactOid: CONTACT_OID, contactEmail: 'jane@example.org', contactName: 'Jane Doe' },
  });
  resolveContactForSession.mockResolvedValue({ ok: true, contactId: CONTACT_ID });
  hasSubmitterRole.mockResolvedValue(true);
  IntakeDraftService.getByKey.mockResolvedValue(makeDraft());
});
afterEach(() => {
  if (ORIGINAL_POSTGRES_URL === undefined) delete process.env.POSTGRES_URL;
  else process.env.POSTGRES_URL = ORIGINAL_POSTGRES_URL;
});

function queriesMatching(substr) {
  return mockClientQuery.mock.calls.filter(([t]) => String(t).includes(substr));
}

describe('/api/intake/submit — freeze optimistic-concurrency guard', () => {
  test('happy path: freeze applies (1 row) → COMMIT + 200', async () => {
    programClient({ freezeRowCount: 1 });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ jobId: 7, requestId: 'req-guid', status: 'queued' });
    expect(queriesMatching('COMMIT')).toHaveLength(1);
    expect(queriesMatching('ROLLBACK')).toHaveLength(0);

    // The freeze UPDATE binds the load-time attachments count ([] → 0) as the
    // optimistic guard parameter ($3).
    const freezeCall = queriesMatching('UPDATE intake_drafts')[0];
    expect(freezeCall[1][2]).toBe(0);
    expect(String(freezeCall[0])).toContain('jsonb_array_length');
  });

  test('freeze guard binds the actual load-time attachments count (not a hardcoded 0)', async () => {
    // A draft that already has one clean attachment at load-time: the freeze
    // guard must require the count to still be 1, i.e. bind $3 = 1.
    const cleanAttachment = {
      attachmentId: '770e8400-e29b-41d4-a716-446655440002',
      fieldKey: 'pi_biosketch',
      filename: 'biosketch.pdf',
      blob_url: 'https://blob.example/drafts/42/biosketch.pdf',
      pathname: 'drafts/42/770e8400-e29b-41d4-a716-446655440002',
      sha256: 'a'.repeat(64),
      size: 1234,
      scan_result: 'clean',
    };
    IntakeDraftService.getByKey.mockResolvedValue(makeDraft({ attachments: [cleanAttachment] }));
    programClient({ freezeRowCount: 1 });

    const { req, res } = makeReqRes(validBody());
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const freezeCall = queriesMatching('UPDATE intake_drafts')[0];
    expect(freezeCall[1][2]).toBe(1);
    // Both guard predicates are present in the SQL.
    expect(String(freezeCall[0])).toContain('request_id IS NULL');
    expect(String(freezeCall[0])).toContain('pending_attachments');
  });

  test('concurrent attach changed the draft (0 rows, request_id still NULL) → ROLLBACK + 409 draft_changed_retry', async () => {
    programClient({ freezeRowCount: 0, recheckRequestId: null });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('draft_changed_retry');
    expect(queriesMatching('ROLLBACK')).toHaveLength(1);
    expect(queriesMatching('COMMIT')).toHaveLength(0);
  });

  test('idempotent retry — draft already frozen (0 rows, request_id set) → COMMIT + 200, no spurious conflict', async () => {
    programClient({
      freezeRowCount: 0,
      recheckRequestId: 'already-frozen-guid',
      jobRow: { id: 7, request_id: 'already-frozen-guid', status: 'queued', last_error: null },
    });
    const { req, res } = makeReqRes(validBody());
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(queriesMatching('COMMIT')).toHaveLength(1);
    expect(queriesMatching('ROLLBACK')).toHaveLength(0);
  });
});
