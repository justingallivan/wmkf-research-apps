/**
 * lib/services/consultant-feedback-service.js
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3, §4, §7)
 *
 * @jest-environment node
 */
jest.mock('@vercel/postgres', () => ({ db: { connect: jest.fn() }, sql: { query: jest.fn() } }));
import { db, sql } from '@vercel/postgres';
import {
  listConsultantFeedback,
  listEligibleConsultants,
  writeFeedbackEntry,
  updateFeedbackEntry,
  deleteFeedbackEntry,
  loadSharedConsultantFeedbackForBriefing,
  isSharedActiveFeedbackAttachment,
  downloadConsultantFeedbackAttachment,
} from '../../lib/services/consultant-feedback-service';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const MUTATION_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = 7;

let client;
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  db.connect.mockResolvedValue(client);
  sql.query.mockResolvedValue({ rows: [] });
});

afterEach(() => jest.restoreAllMocks());

describe('writeFeedbackEntry', () => {
  test('creates an entry with a roster consultant after checking eligibility', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.includes('FROM expertise_roster WHERE id')) return { rows: [{ id: 5 }] };
      if (q.startsWith('INSERT INTO consultant_feedback')) return { rows: [] };
      if (q.includes('SELECT cf.id')) {
        return { rows: [{ id: 1, received_on: '2026-09-01', body_html: '<p>Good.</p>', shared: true, consultant_roster_id: 5, one_off_name: null, one_off_affiliation: null, updated_at: new Date('2026-09-01T00:00:00Z'), roster_name: 'Ada Lovelace', roster_affiliation: 'Analytical Engines' }] };
      }
      return { rows: [] };
    });
    const row = await writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      consultantRosterId: 5, bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01', shared: true,
    });
    expect(row.consultant).toEqual({ rosterId: 5, name: 'Ada Lovelace', affiliation: 'Analytical Engines' });
    expect(row.oneOff).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query.mock.calls.some(([q]) => q.includes('FROM expertise_roster WHERE id'))).toBe(true);
  });

  test('creates an entry with a one-off name and never writes expertise_roster', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('INSERT INTO consultant_feedback')) return { rows: [] };
      if (q.includes('SELECT cf.id')) {
        return { rows: [{ id: 2, received_on: '2026-09-01', body_html: '<p>Good.</p>', shared: true, consultant_roster_id: null, one_off_name: 'Jane Doe', one_off_affiliation: null, updated_at: new Date('2026-09-01T00:00:00Z') }] };
      }
      return { rows: [] };
    });
    const row = await writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      oneOff: { name: 'Jane Doe' }, bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01',
    });
    expect(row.oneOff).toBe(true);
    expect(row.consultant).toEqual({ rosterId: null, name: 'Jane Doe', affiliation: null });
    expect(client.query.mock.calls.some(([q]) => /INSERT INTO expertise_roster|UPDATE expertise_roster/.test(q))).toBe(false);
  });

  // Keyed by roster id so each case exercises the REAL eligibility predicate
  // (is_active AND role_type='Consultant') instead of a blanket `rows: []`
  // that would stay green even if that predicate were deleted from the
  // service.
  const ROSTER = {
    20: { id: 20, role_type: 'Board', is_active: true },
    30: { id: 30, role_type: 'Consultant', is_active: false },
    // 40: intentionally absent (missing roster id).
  };

  test.each([
    ['a Board roster row', 20],
    ['an inactive roster row', 30],
    ['a missing roster id', 40],
  ])('rejects %s with consultant_not_eligible', async (_label, rosterId) => {
    client.query.mockImplementation(async (q, params) => {
      if (q.includes('FROM expertise_roster WHERE id')) {
        const row = ROSTER[params[0]];
        const eligible = !!row && row.is_active === true && row.role_type === 'Consultant';
        return { rows: eligible ? [{ id: row.id }] : [] };
      }
      return { rows: [] };
    });
    await expect(writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      consultantRosterId: rosterId, bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01',
    })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'consultant_not_eligible' } });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([q]) => q.startsWith('INSERT INTO consultant_feedback'))).toBe(false);
    const eligibilityCall = client.query.mock.calls.find(([q]) => q.includes('FROM expertise_roster WHERE id'));
    expect(eligibilityCall[0]).toContain('is_active = true');
    expect(eligibilityCall[0]).toContain("role_type = 'Consultant'");
    expect(eligibilityCall[1]).toEqual([rosterId]);
  });

  test('replays the original row when the same mutation id is submitted twice (lost-response retry)', async () => {
    const stored = { id: 3, received_on: '2026-09-01', body_html: '<p>Original.</p>', shared: true, consultant_roster_id: null, one_off_name: 'Jane Doe', one_off_affiliation: null, updated_at: new Date('2026-09-01T00:00:00Z') };
    client.query.mockImplementation(async (q) => {
      // The conflicting second INSERT does nothing (ON CONFLICT DO NOTHING); the
      // follow-up SELECT always returns the row that already carries the id.
      if (q.startsWith('INSERT INTO consultant_feedback')) return { rows: [] };
      if (q.includes('SELECT cf.id')) return { rows: [stored] };
      return { rows: [] };
    });
    const params = {
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      oneOff: { name: 'Jane Doe' }, bodyHtml: '<p>Original.</p>', receivedOn: '2026-09-01',
    };
    const first = await writeFeedbackEntry(params);
    const second = await writeFeedbackEntry(params);
    expect(first.id).toBe('3');
    expect(second.id).toBe('3');

    const insertCall = client.query.mock.calls.find(([q]) => q.startsWith('INSERT INTO consultant_feedback'));
    expect(insertCall[0]).toContain('ON CONFLICT (request_id, mutation_id) DO NOTHING');
    const selectCalls = client.query.mock.calls.filter(([q]) => q.includes('SELECT cf.id'));
    for (const [, selectParams] of selectCalls) {
      expect(selectParams).toEqual([REQUEST_ID, MUTATION_ID]);
    }
  });

  test('a different mutation id on the same request creates a distinct row', async () => {
    const rowFor = (mutationId) => ({
      id: mutationId === MUTATION_ID ? 3 : 6,
      received_on: '2026-09-01', body_html: '<p>Original.</p>', shared: true,
      consultant_roster_id: null, one_off_name: 'Jane Doe', one_off_affiliation: null,
      updated_at: new Date('2026-09-01T00:00:00Z'),
    });
    let lastSelectMutationId = null;
    client.query.mockImplementation(async (q, params) => {
      if (q.startsWith('INSERT INTO consultant_feedback')) return { rows: [] };
      if (q.includes('SELECT cf.id')) {
        lastSelectMutationId = params[1];
        return { rows: [rowFor(lastSelectMutationId)] };
      }
      return { rows: [] };
    });
    const base = {
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID,
      oneOff: { name: 'Jane Doe' }, bodyHtml: '<p>Original.</p>', receivedOn: '2026-09-01',
    };
    const first = await writeFeedbackEntry({ ...base, mutationId: MUTATION_ID });
    const OTHER_MUTATION_ID = '33333333-3333-4333-8333-333333333333';
    const second = await writeFeedbackEntry({ ...base, mutationId: OTHER_MUTATION_ID });
    expect(first.id).toBe('3');
    expect(second.id).toBe('6');
    expect(first.id).not.toBe(second.id);
  });

  test('rejects a request with neither a roster id nor a one-off name', async () => {
    await expect(writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01',
    })).rejects.toMatchObject({ httpStatus: 400 });
  });

  test('rejects an empty body (slice 1 has no attachments)', async () => {
    await expect(writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      oneOff: { name: 'Jane Doe' }, bodyHtml: '<p></p>', receivedOn: '2026-09-01',
    })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'body_required' } });
  });

  test('rejects a body over 200,000 characters before sanitizing, on both create and update', async () => {
    const oversized = '<p>' + 'a'.repeat(200_001) + '</p>';
    await expect(writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      oneOff: { name: 'Jane Doe' }, bodyHtml: oversized, receivedOn: '2026-09-01',
    })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'body_too_long' } });
    expect(db.connect).not.toHaveBeenCalled();

    client.query.mockImplementation(async (q) => {
      if (q.includes('FOR UPDATE')) {
        return { rows: [{ id: 4, request_id: REQUEST_ID, consultant_roster_id: 5, one_off_name: null, one_off_affiliation: null, body_html: '<p>Original.</p>', received_on: '2026-09-01', shared: true, requestdocument_id: null }] };
      }
      return { rows: [] };
    });
    await expect(updateFeedbackEntry({
      id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID, patch: { bodyHtml: oversized },
    })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'body_too_long' } });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('rejects a non-boolean shared value instead of failing open to true', async () => {
    await expect(writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      oneOff: { name: 'Jane Doe' }, bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01', shared: 'false',
    })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'invalid_shared' } });
  });

  test('rejects `true` as consultantRosterId instead of coercing it to 1', async () => {
    await expect(writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      consultantRosterId: true, bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01',
    })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'invalid_author' } });
  });

  test("rejects '' as consultantRosterId instead of coercing it to 0", async () => {
    await expect(writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      consultantRosterId: '', bodyHtml: '<p>Good.</p>', receivedOn: '2026-09-01',
    })).rejects.toMatchObject({ httpStatus: 400, body: { reason: 'invalid_author' } });
  });
});

describe('updateFeedbackEntry', () => {
  const EXISTING = {
    id: 4, request_id: REQUEST_ID, consultant_roster_id: 5, one_off_name: null, one_off_affiliation: null,
    body_html: '<p>Original.</p>', received_on: '2026-09-01', shared: true, requestdocument_id: null,
  };

  test('a body-only edit does not re-run eligibility', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.includes('FOR UPDATE')) return { rows: [EXISTING] };
      if (q.startsWith('UPDATE consultant_feedback')) {
        return { rows: [{ id: 4, received_on: '2026-09-01', body_html: '<p>Edited.</p>', shared: true, consultant_roster_id: 5, one_off_name: null, one_off_affiliation: null, updated_at: new Date() }] };
      }
      return { rows: [] };
    });
    await updateFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID, patch: { bodyHtml: '<p>Edited.</p>' } });
    expect(client.query.mock.calls.some(([q]) => q.includes('FROM expertise_roster WHERE id'))).toBe(false);
  });

  test('resubmitting the SAME author fields (the client always includes them) never re-runs eligibility, even for a now-deactivated consultant', async () => {
    const deactivated = { ...EXISTING, consultant_roster_id: 5, one_off_name: null, one_off_affiliation: null };
    client.query.mockImplementation(async (q) => {
      if (q.includes('FOR UPDATE')) return { rows: [deactivated] };
      // If the service (incorrectly) queried eligibility, id 5 is no longer
      // active, so returning "ineligible" here would fail the test loudly
      // instead of silently passing.
      if (q.includes('FROM expertise_roster WHERE id')) return { rows: [] };
      if (q.startsWith('UPDATE consultant_feedback')) {
        return { rows: [{ id: 4, received_on: '2026-09-01', body_html: '<p>Edited.</p>', shared: true, consultant_roster_id: 5, one_off_name: null, one_off_affiliation: null, updated_at: new Date() }] };
      }
      return { rows: [] };
    });
    const row = await updateFeedbackEntry({
      id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID,
      // Key present with the SAME value already on the row — a body-only save
      // from a client that always resubmits the current author fields.
      patch: { consultantRosterId: 5, bodyHtml: '<p>Edited.</p>' },
    });
    expect(row.id).toBe('4');
    expect(client.query.mock.calls.some(([q]) => q.includes('FROM expertise_roster WHERE id'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('an author change re-runs eligibility and rejects an ineligible roster id', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.includes('FOR UPDATE')) return { rows: [EXISTING] };
      if (q.includes('FROM expertise_roster WHERE id')) return { rows: [] };
      return { rows: [] };
    });
    await expect(updateFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID, patch: { consultantRosterId: 999 } }))
      .rejects.toMatchObject({ httpStatus: 400, body: { reason: 'consultant_not_eligible' } });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  describe('attachment bind (slice 2 finalize step 7, Codex R3 finding: committed-bind replay)', () => {
    const DOC_ID = '55555555-5555-4555-8555-555555555555';
    const ALREADY_BOUND = { ...EXISTING, requestdocument_id: DOC_ID };

    test('binding the IDENTICAL id the row already holds is an idempotent success — no conflict, COMMIT runs', async () => {
      client.query.mockImplementation(async (q) => {
        if (q.includes('FOR UPDATE')) return { rows: [ALREADY_BOUND] };
        if (q.startsWith('UPDATE consultant_feedback')) {
          return { rows: [{ id: 4, received_on: '2026-09-01', body_html: '<p>Original.</p>', shared: true, consultant_roster_id: 5, one_off_name: null, one_off_affiliation: null, requestdocument_id: DOC_ID, updated_at: new Date() }] };
        }
        return { rows: [] };
      });
      const row = await updateFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID, patch: { requestdocumentId: DOC_ID } });
      expect(row.attachment?.requestdocumentId ?? DOC_ID).toBeTruthy(); // no throw is the primary assertion
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.query.mock.calls.some(([q]) => q === 'ROLLBACK')).toBe(false);
    });

    test('binding a DIFFERENT id than the one already held is a 409 attachment_conflict', async () => {
      client.query.mockImplementation(async (q) => {
        if (q.includes('FOR UPDATE')) return { rows: [ALREADY_BOUND] };
        return { rows: [] };
      });
      const OTHER_DOC_ID = '66666666-6666-4666-8666-666666666666';
      await expect(updateFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID, patch: { requestdocumentId: OTHER_DOC_ID } }))
        .rejects.toMatchObject({ httpStatus: 409, body: { reason: 'attachment_conflict' } });
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test('a finalize losing a real race against a delete (row gone/deleting) gets a distinct, PERMANENT attachment_target_gone — not a generic 404', async () => {
      client.query.mockImplementation(async (q) => {
        if (q.includes('FOR UPDATE')) return { rows: [] }; // status='active' filter excludes the now-deleting/gone row
        return { rows: [] };
      });
      await expect(updateFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID, patch: { requestdocumentId: DOC_ID } }))
        .rejects.toMatchObject({ httpStatus: 409, body: { reason: 'attachment_target_gone' } });
    });

    test('a plain edit (no requestdocumentId in the patch) against a gone/deleting row still gets the ordinary 404, not attachment_target_gone', async () => {
      client.query.mockImplementation(async (q) => {
        if (q.includes('FOR UPDATE')) return { rows: [] };
        return { rows: [] };
      });
      await expect(updateFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID, patch: { shared: false } }))
        .rejects.toMatchObject({ httpStatus: 404, body: { reason: 'not_found' } });
    });
  });
});

describe('writeFeedbackEntry — unique violation on requestdocument_id (a prior replay already created the row)', () => {
  test('a 23505 unique violation selects and returns the existing row instead of throwing', async () => {
    const DOC_ID = '77777777-7777-4777-8777-777777777777';
    const existingRow = {
      id: 8, received_on: '2026-09-01', body_html: null, shared: true, consultant_roster_id: null,
      one_off_name: 'Jane Doe', one_off_affiliation: null, requestdocument_id: DOC_ID, updated_at: new Date('2026-09-01T00:00:00Z'),
    };
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('INSERT INTO consultant_feedback')) {
        const error = new Error('duplicate key value violates unique constraint "consultant_feedback_requestdocument_id_key"');
        error.code = '23505';
        throw error;
      }
      return { rows: [] };
    });
    sql.query.mockResolvedValueOnce({ rows: [existingRow] });
    const row = await writeFeedbackEntry({
      requestId: REQUEST_ID, actorProfileId: ACTOR_ID, mutationId: MUTATION_ID,
      oneOff: { name: 'Jane Doe' }, receivedOn: '2026-09-01', requestdocumentId: DOC_ID,
    });
    expect(row.id).toBe('8');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(sql.query).toHaveBeenCalledWith(expect.stringContaining('WHERE cf.request_id = $1 AND cf.requestdocument_id = $2'), [REQUEST_ID, DOC_ID]);
  });
});

test('deleteFeedbackEntry hard-deletes an active row with no attachment in one transaction', async () => {
  client.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
  client.query.mockResolvedValueOnce({ rows: [{ id: 4, requestdocument_id: null }] }); // SELECT ... FOR UPDATE
  const result = await deleteFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID });
  expect(result).toEqual({ id: '4' });
  expect(client.query.mock.calls.some(([q]) => /DELETE FROM consultant_feedback/.test(q))).toBe(true);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});

test('deleteFeedbackEntry 404s when the row is missing or already gone', async () => {
  client.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
  client.query.mockResolvedValueOnce({ rows: [] }); // SELECT ... FOR UPDATE finds nothing
  await expect(deleteFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID })).rejects.toMatchObject({ httpStatus: 404 });
});

test('deleteFeedbackEntry three-step ordering: an attached row supersedes the registry BEFORE the final PG delete', async () => {
  const REQUESTDOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
  client.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
  client.query.mockResolvedValueOnce({ rows: [{ id: 4, requestdocument_id: REQUESTDOCUMENT_ID }] }); // SELECT ... FOR UPDATE
  const callOrder = [];
  sql.query.mockImplementation(async (q) => {
    if (/DELETE FROM consultant_feedback/.test(q)) callOrder.push('pg-delete');
    return { rows: [] };
  });
  const dependencies = {
    supersedeDocument: jest.fn().mockImplementation(async () => { callOrder.push('supersede'); }),
  };
  const result = await deleteFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID }, dependencies);
  expect(result).toEqual({ id: '4' });
  expect(callOrder).toEqual(['supersede', 'pg-delete']);
  expect(dependencies.supersedeDocument).toHaveBeenCalledWith(REQUESTDOCUMENT_ID);
  // Step 1 (mark deleting) ran in the same client transaction and committed
  // before steps 2-3 touched the registry.
  expect(client.query.mock.calls.some(([q]) => /SET status = 'deleting'/.test(q))).toBe(true);
});

test('deleteFeedbackEntry step-3 failure leaves the row `deleting`; the list sweep completes it', async () => {
  const REQUESTDOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
  client.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
  client.query.mockResolvedValueOnce({ rows: [{ id: 9, requestdocument_id: REQUESTDOCUMENT_ID }] }); // SELECT ... FOR UPDATE
  sql.query.mockImplementation(async (q) => {
    if (/DELETE FROM consultant_feedback/.test(q)) throw new Error('connection reset');
    return { rows: [] };
  });
  const dependencies = { supersedeDocument: jest.fn().mockResolvedValue({}) };
  await expect(deleteFeedbackEntry({ id: 9, requestId: REQUEST_ID, actorProfileId: ACTOR_ID }, dependencies))
    .rejects.toMatchObject({ httpStatus: 502, body: expect.objectContaining({ reason: 'attachment_removal_pending' }) });
  // Simulate a lost DELETE (step 3 never ran) — the next list-sweep for this
  // request finds the row still `deleting` and finishes it.
  sql.query.mockReset();
  sql.query.mockResolvedValueOnce({ rows: [{ id: 9, requestdocument_id: REQUESTDOCUMENT_ID }] }); // sweep SELECT deleting rows
  sql.query.mockResolvedValue({ rows: [] });
  await listConsultantFeedback({ requestId: REQUEST_ID }, { ...dependencies, findDocumentsByIds: jest.fn().mockResolvedValue({ records: [] }) });
  expect(dependencies.supersedeDocument).toHaveBeenCalledTimes(2);
});

describe('loadSharedConsultantFeedbackForBriefing', () => {
  test('returns unavailable, not empty, when the query throws', async () => {
    // The query rejects before any row is read, so no items — real or
    // fabricated — could leak through regardless of what the table holds;
    // the companion test right below this one proves the success path
    // returns real shared items from an equivalent query shape.
    sql.query.mockRejectedValueOnce(new Error('connection reset'));
    const result = await loadSharedConsultantFeedbackForBriefing(REQUEST_ID);
    expect(result).toEqual({ status: 'unavailable', items: [] });
    expect(console.error).toHaveBeenCalledWith('[consultant-feedback] briefing read failed', expect.objectContaining({ requestId: REQUEST_ID }));
  });

  test('the external privacy boundary: only the shared row reaches items, proven against a fixture that also contains an unshared row', async () => {
    const ALL_ROWS = [
      { received_on: '2026-09-01', body_html: '<p>Shared.</p>', consultant_roster_id: null, one_off_name: 'Jane Doe', one_off_affiliation: 'Acme', shared: true, status: 'active' },
      { received_on: '2026-09-02', body_html: '<p>Not shared.</p>', consultant_roster_id: null, one_off_name: 'John Smith', one_off_affiliation: 'Other Co', shared: false, status: 'active' },
    ];
    sql.query.mockImplementationOnce(async (queryText) => {
      expect(queryText).toContain('cf.shared = true');
      expect(queryText).toContain("cf.status = 'active'");
      // Simulate the WHERE clause the real database would apply. The mock
      // only filters on a predicate substring it actually finds in the query
      // text, so deleting `AND cf.shared = true` from the production query
      // makes this mock stop filtering AND makes the assertion below (only
      // the shared row reaches items) fail — it does not merely echo back
      // whatever rows the test hands it.
      const rows = ALL_ROWS.filter((r) => (!queryText.includes('cf.shared = true') || r.shared)
        && (!queryText.includes("cf.status = 'active'") || r.status === 'active'));
      return { rows };
    });
    const result = await loadSharedConsultantFeedbackForBriefing(REQUEST_ID);
    expect(result.status).toBe('ok');
    expect(result.items).toEqual([{ name: 'Jane Doe', affiliation: 'Acme', receivedOn: '2026-09-01', bodyHtml: '<p>Shared.</p>', attachment: null }]);
  });
});

test('listEligibleConsultants queries only active Consultant rows', async () => {
  sql.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Ada', affiliation: 'Acme' }] });
  const result = await listEligibleConsultants();
  expect(result).toEqual([{ id: 1, name: 'Ada', affiliation: 'Acme' }]);
  expect(sql.query.mock.calls[0][0]).toContain("role_type = 'Consultant'");
});

test('listConsultantFeedback rejects a non-GUID requestId before any query', async () => {
  await expect(listConsultantFeedback({ requestId: 'not-a-guid' })).rejects.toMatchObject({ httpStatus: 400 });
  expect(sql.query).not.toHaveBeenCalled();
});

describe('listConsultantFeedback — attachment registry chunking (Codex R3: 26+ attachments)', () => {
  function attachedRow(i) {
    const docId = `doc-${String(i).padStart(2, '0')}`;
    return {
      id: i, received_on: '2026-09-01', body_html: null, shared: true,
      consultant_roster_id: null, one_off_name: `Person ${i}`, one_off_affiliation: null,
      requestdocument_id: docId, updated_at: new Date('2026-09-01T00:00:00Z'),
    };
  }

  test('26 attached entries all resolve their attachment across two chunked batches (the adapter refuses >25 ids in one call)', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => attachedRow(i + 1));
    sql.query.mockImplementation(async (q) => {
      if (q.includes("status = 'deleting'")) return { rows: [] }; // sweep
      if (q.includes('SELECT cf.id')) return { rows };
      return { rows: [] };
    });
    const findDocumentsByIds = jest.fn(async (ids) => ({
      records: ids.map((id) => ({ wmkf_requestdocumentid: id, wmkf_filename: `${id}.pdf` })),
    }));
    const result = await listConsultantFeedback({ requestId: REQUEST_ID }, { findDocumentsByIds });
    expect(findDocumentsByIds).toHaveBeenCalledTimes(2); // 25 + 1, never all 26 in one call
    expect(result).toHaveLength(26);
    expect(result.every((item) => item.attachment && item.attachment.filename)).toBe(true);
  });

  test('a failing middle batch yields attachment: { status: "unavailable" } for ITS ids only, not the whole page', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => attachedRow(i + 1));
    sql.query.mockImplementation(async (q) => {
      if (q.includes("status = 'deleting'")) return { rows: [] };
      if (q.includes('SELECT cf.id')) return { rows };
      return { rows: [] };
    });
    let call = 0;
    const findDocumentsByIds = jest.fn(async (ids) => {
      call += 1;
      if (call === 1) throw new Error('dataverse down'); // first chunk fails
      return { records: ids.map((id) => ({ wmkf_requestdocumentid: id, wmkf_filename: `${id}.pdf` })) };
    });
    const result = await listConsultantFeedback({ requestId: REQUEST_ID }, { findDocumentsByIds });
    expect(findDocumentsByIds).toHaveBeenCalledTimes(2);
    const failedChunkItems = result.filter((item) => Number(item.id) >= 1 && Number(item.id) <= 25);
    const okChunkItems = result.filter((item) => Number(item.id) === 26);
    expect(failedChunkItems).toHaveLength(25);
    expect(failedChunkItems.every((item) => item.attachment.status === 'unavailable')).toBe(true);
    expect(okChunkItems[0].attachment.filename).toBeTruthy();
  });
});

describe('isSharedActiveFeedbackAttachment', () => {
  const DOC_ID = '55555555-5555-4555-8555-555555555555';

  test('the SQL filter itself excludes shared=false and status=\'deleting\' rows even when they are present in the fixture', async () => {
    // Mirrors the "external privacy boundary" test above: the mock only
    // filters on predicate substrings it finds in the query text, so
    // deleting a `shared = true` or `status = 'active'` clause from the
    // production query makes this mock stop filtering and fails the
    // assertion below — it does not merely echo back whatever the fixture holds.
    const FIXTURE_ROWS = [
      { request_id: REQUEST_ID, requestdocument_id: DOC_ID, shared: false, status: 'active' }, // excluded: not shared
      { request_id: REQUEST_ID, requestdocument_id: DOC_ID, shared: true, status: 'deleting' }, // excluded: deleting
      { request_id: REQUEST_ID, requestdocument_id: DOC_ID, shared: true, status: 'active' }, // the one eligible row
    ];
    sql.query.mockImplementationOnce(async (queryText, params) => {
      expect(queryText).toContain('shared = true');
      expect(queryText).toContain("status = 'active'");
      expect(params).toEqual([REQUEST_ID, DOC_ID]);
      const matches = FIXTURE_ROWS.filter((row) => row.request_id === params[0]
        && row.requestdocument_id === params[1]
        && (!queryText.includes('shared = true') || row.shared)
        && (!queryText.includes("status = 'active'") || row.status === 'active'));
      return { rows: matches.length ? [{ '?column?': 1 }] : [] };
    });
    const result = await isSharedActiveFeedbackAttachment(REQUEST_ID, DOC_ID);
    expect(result).toBe(true);
  });

  test('returns false with no query when either id is not a GUID', async () => {
    expect(await isSharedActiveFeedbackAttachment('not-a-guid', DOC_ID)).toBe(false);
    expect(await isSharedActiveFeedbackAttachment(REQUEST_ID, 'not-a-guid')).toBe(false);
    expect(sql.query).not.toHaveBeenCalled();
  });

  test('returns false when no row matches (e.g. only excluded rows exist)', async () => {
    sql.query.mockResolvedValueOnce({ rows: [] });
    expect(await isSharedActiveFeedbackAttachment(REQUEST_ID, DOC_ID)).toBe(false);
  });
});

describe('downloadConsultantFeedbackAttachment', () => {
  const DOC_ID = '55555555-5555-4555-8555-555555555555';
  const registryRow = (overrides = {}) => ({
    wmkf_requestdocumentid: DOC_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: 100000008,
    wmkf_operationstatus: 100000001,
    wmkf_lifecyclestate: 100000000,
    wmkf_sharepointdriveid: 'drive-1',
    wmkf_sharepointitemid: 'item-1',
    wmkf_filename: 'Consultant Feedback-1000-Ada-2026-09-01.pdf',
    ...overrides,
  });

  function dependencies(records = [registryRow()]) {
    return {
      findDocumentsByIds: jest.fn().mockResolvedValue({ records }),
      downloadFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-file'),
        mimeType: 'application/pdf',
        filename: 'fallback.pdf',
        size: 999,
      }),
    };
  }

  test('an active request-owned entry resolves its typed live registry row and streams an unshared PDF inline', async () => {
    sql.query.mockImplementationOnce(async (queryText, params) => {
      expect(queryText).toContain("status = 'active'");
      expect(queryText).not.toContain('shared = true');
      expect(params).toEqual([9, REQUEST_ID]);
      return { rows: [{ id: 9, requestdocument_id: DOC_ID, shared: false }] };
    });
    const deps = dependencies();
    const result = await downloadConsultantFeedbackAttachment({ requestId: REQUEST_ID, entryId: '9' }, deps);
    expect(deps.findDocumentsByIds).toHaveBeenCalledWith([DOC_ID]);
    expect(deps.downloadFile).toHaveBeenCalledWith('drive-1', 'item-1');
    expect(result).toEqual({
      buffer: Buffer.from('%PDF-file'),
      mimeType: 'application/pdf',
      filename: 'Consultant Feedback-1000-Ada-2026-09-01.pdf',
      size: 9,
      inline: true,
    });
  });

  test.each([
    ['another registry identity', { wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666' }],
    ['another request', { _wmkf_request_value: '99999999-9999-4999-8999-999999999999' }],
    ['another artifact type', { wmkf_artifacttype: 100000000 }],
    ['a non-Ready row', { wmkf_operationstatus: 100000000 }],
    ['a Superseded row', { wmkf_lifecyclestate: 100000003 }],
    ['a row without file pointers', { wmkf_sharepointitemid: null }],
  ])('fails closed before Graph when the tempting registry fixture is %s', async (_label, override) => {
    sql.query.mockResolvedValueOnce({ rows: [{ id: 9, requestdocument_id: DOC_ID }] });
    const deps = dependencies([registryRow(override)]);
    await expect(downloadConsultantFeedbackAttachment({ requestId: REQUEST_ID, entryId: 9 }, deps))
      .rejects.toMatchObject({ httpStatus: 404, body: { reason: 'not_found' } });
    expect(deps.downloadFile).not.toHaveBeenCalled();
  });

  test('fails closed on missing/ambiguous entry or registry state before Graph', async () => {
    const noEntry = dependencies();
    sql.query.mockResolvedValueOnce({ rows: [] });
    await expect(downloadConsultantFeedbackAttachment({ requestId: REQUEST_ID, entryId: 9 }, noEntry))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(noEntry.findDocumentsByIds).not.toHaveBeenCalled();

    const noAttachment = dependencies();
    sql.query.mockResolvedValueOnce({ rows: [{ id: 9, requestdocument_id: null }] });
    await expect(downloadConsultantFeedbackAttachment({ requestId: REQUEST_ID, entryId: 9 }, noAttachment))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(noAttachment.findDocumentsByIds).not.toHaveBeenCalled();

    const ambiguous = dependencies([registryRow(), registryRow({ wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666' })]);
    sql.query.mockResolvedValueOnce({ rows: [{ id: 9, requestdocument_id: DOC_ID }] });
    await expect(downloadConsultantFeedbackAttachment({ requestId: REQUEST_ID, entryId: 9 }, ambiguous))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(ambiguous.downloadFile).not.toHaveBeenCalled();
  });

  test('rejects invalid ids before any persistence read', async () => {
    const deps = dependencies();
    await expect(downloadConsultantFeedbackAttachment({ requestId: 'not-a-guid', entryId: 9 }, deps))
      .rejects.toMatchObject({ httpStatus: 400, body: { reason: 'invalid_request_id' } });
    await expect(downloadConsultantFeedbackAttachment({ requestId: REQUEST_ID, entryId: true }, deps))
      .rejects.toMatchObject({ httpStatus: 400, body: { reason: 'invalid_entry_id' } });
    expect(sql.query).not.toHaveBeenCalled();
  });

  test('forces an unexpected downloaded content type closed and translates Graph failure', async () => {
    sql.query.mockResolvedValue({ rows: [{ id: 9, requestdocument_id: DOC_ID }] });
    const wrongType = dependencies();
    wrongType.downloadFile.mockResolvedValueOnce({ buffer: Buffer.from('<html>'), mimeType: 'text/html', filename: 'x.html', size: 6 });
    await expect(downloadConsultantFeedbackAttachment({ requestId: REQUEST_ID, entryId: 9 }, wrongType))
      .rejects.toMatchObject({ httpStatus: 404 });

    const failed = dependencies();
    failed.downloadFile.mockRejectedValueOnce(new Error('Graph timeout'));
    await expect(downloadConsultantFeedbackAttachment({ requestId: REQUEST_ID, entryId: 9 }, failed))
      .rejects.toMatchObject({ httpStatus: 502, body: { reason: 'download_failed' } });
  });
});
