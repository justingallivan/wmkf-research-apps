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
});

test('deleteFeedbackEntry hard-deletes an active row', async () => {
  sql.query.mockResolvedValueOnce({ rows: [{ id: 4 }] });
  const result = await deleteFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID });
  expect(result).toEqual({ id: '4' });
  expect(sql.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM consultant_feedback'), [4, REQUEST_ID]);
});

test('deleteFeedbackEntry 404s when the row is missing or already gone', async () => {
  sql.query.mockResolvedValueOnce({ rows: [] });
  await expect(deleteFeedbackEntry({ id: 4, requestId: REQUEST_ID, actorProfileId: ACTOR_ID })).rejects.toMatchObject({ httpStatus: 404 });
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
    expect(result.items).toEqual([{ name: 'Jane Doe', affiliation: 'Acme', receivedOn: '2026-09-01', bodyHtml: '<p>Shared.</p>' }]);
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
