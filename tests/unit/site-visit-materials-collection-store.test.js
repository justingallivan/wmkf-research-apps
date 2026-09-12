/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { sql } from '@vercel/postgres';
import {
  SLOT_LEASE_TTL_MS,
  acquireSlotLease,
  attachReminderEmailId,
  claimAutomaticReminder,
  claimManualReminder,
  closeExpiredCollections,
  listCollectionsDueForAutomaticReminder,
  listLatestCollectionsForRequests,
  releaseSlotLease,
} from '../../lib/services/site-visit-materials/collection-store';

const COLLECTION_ID = '11111111-1111-4111-8111-111111111111';

function queryText(callIndex = 0) {
  return sql.mock.calls[callIndex][0].join('?').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('acquire uses one conditional UPDATE and records a five-minute lease for the canonical slot', async () => {
  const now = 1_800_000_000_000;
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  sql.mockResolvedValueOnce({ rows: [{ id: COLLECTION_ID }] });

  const lease = await acquireSlotLease({ collectionId: COLLECTION_ID, slotKey: 'presentation_pdf' });

  expect(sql).toHaveBeenCalledTimes(1);
  expect(queryText()).toContain('UPDATE site_visit_material_collections');
  expect(queryText()).toContain('jsonb_set');
  // jsonb_build_object is variadic "any": bound parameters there must be cast
  // or Postgres rejects the statement at plan time (production 2026-09-10).
  expect(queryText()).toContain("jsonb_build_object('token', ?::text, 'expiresAt', ?::double precision)");
  expect(queryText()).toContain('IS NULL OR CASE');
  expect(queryText()).toContain('< EXTRACT(EPOCH FROM NOW()) * 1000');
  expect(sql.mock.calls[0]).toContain(now + SLOT_LEASE_TTL_MS);
  expect(lease.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
  expect(lease.expiresAt.toISOString()).toBe(new Date(now + SLOT_LEASE_TTL_MS).toISOString());
  clock.mockRestore();
});

test('contention returns null; the same conditional permits only a numeric expired lease to be replaced', async () => {
  sql.mockResolvedValueOnce({ rows: [] });
  await expect(acquireSlotLease({ collectionId: COLLECTION_ID, slotKey: 'participant_bios' })).resolves.toBeNull();
  expect(sql).toHaveBeenCalledTimes(1);
  expect(queryText()).toContain("jsonb_typeof(COALESCE(slot_leases, '{}'::jsonb) -> ? -> 'expiresAt') = 'number'");
  expect(queryText()).toContain("THEN (COALESCE(slot_leases, '{}'::jsonb) -> ? ->> 'expiresAt')::double precision");
  expect(queryText()).toContain('ELSE FALSE');
});

test('release removes only the matching slot token and reports contention/lost ownership', async () => {
  sql.mockResolvedValueOnce({ rows: [{ id: COLLECTION_ID }] });
  await expect(releaseSlotLease({ collectionId: COLLECTION_ID, slotKey: 'other', leaseToken: 'mine' })).resolves.toBe(true);
  expect(queryText()).toContain("slot_leases = COALESCE(slot_leases, '{}'::jsonb) - ?");
  expect(queryText()).toContain("->> 'token' = ?");
  expect(sql.mock.calls[0].slice(1)).toEqual(['other', COLLECTION_ID, 'other', 'mine']);

  sql.mockResolvedValueOnce({ rows: [] });
  await expect(releaseSlotLease({ collectionId: COLLECTION_ID, slotKey: 'other', leaseToken: 'stale' })).resolves.toBe(false);
});

test('batch read is one DISTINCT ON query with an explicit uuid[] cast on the bound array; empty input never queries', async () => {
  expect(await listLatestCollectionsForRequests([])).toEqual([]);
  expect(sql).not.toHaveBeenCalled();
  sql.mockResolvedValueOnce({ rows: [{ id: 'c1' }] });
  const rows = await listLatestCollectionsForRequests(['AAAAAAAA-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002']);
  expect(rows).toEqual([{ id: 'c1' }]);
  expect(queryText()).toContain('SELECT DISTINCT ON (request_id) *');
  expect(queryText()).toContain('WHERE request_id = ANY(?::uuid[])');
  expect(queryText()).toContain('ORDER BY request_id, created_at DESC');
  expect(sql.mock.calls[0][1]).toEqual(['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002']);
});

test('automatic reminder: the candidate read and the claim share one predicate (open, invited, past due, inside the window, no reminder since due); claim increments and clears the email id', async () => {
  const now = new Date('2026-10-06T15:00:00Z');
  sql.mockResolvedValueOnce({ rows: [] });
  await listCollectionsDueForAutomaticReminder(now);
  const predicate = "status = 'open' AND invited_at IS NOT NULL AND due_at <= ? AND closes_at > ? AND (last_reminder_at IS NULL OR last_reminder_at < due_at)";
  expect(queryText(0)).toContain(predicate);
  expect(sql.mock.calls[0].slice(1)).toEqual([now.toISOString(), now.toISOString()]);

  sql.mockResolvedValueOnce({ rows: [{ id: 'c1', reminder_count: 1 }] });
  expect(await claimAutomaticReminder('c1', now)).toEqual({ id: 'c1', reminder_count: 1 });
  expect(queryText(1)).toContain('UPDATE site_visit_material_collections SET last_reminder_at = NOW(), last_reminder_email_id = NULL, reminder_count = reminder_count + 1');
  expect(queryText(1)).toContain(`WHERE id = ? AND ${predicate}`);
  sql.mockResolvedValueOnce({ rows: [] });
  expect(await claimAutomaticReminder('c1', now)).toBeNull();

  sql.mockResolvedValueOnce({ rows: [{ id: 'c1' }] });
  await attachReminderEmailId('c1', 'email-1');
  expect(queryText(3)).toContain('SET last_reminder_email_id = ?, updated_at = NOW() WHERE id = ?');
  expect(sql.mock.calls[3].slice(1)).toEqual(['email-1', 'c1']);
});

test('manual reminder claim (S507): a single conditional UPDATE, open + a 60s window since the last reminder; null when claimed recently or not open', async () => {
  const at = new Date('2026-10-06T15:00:00Z');

  sql.mockResolvedValueOnce({ rows: [{ id: 'c1', reminder_count: 2 }] });
  expect(await claimManualReminder('c1', at)).toEqual({ id: 'c1', reminder_count: 2 });
  expect(queryText(0)).toContain('UPDATE site_visit_material_collections SET last_reminder_at = NOW(), updated_at = NOW(), reminder_count = reminder_count + 1');
  expect(queryText(0)).toContain("WHERE id = ? AND status = 'open' AND (last_reminder_at IS NULL OR last_reminder_at < ?::timestamptz - interval '60 seconds')");
  expect(sql.mock.calls[0].slice(1)).toEqual(['c1', at.toISOString()]);

  // A reminder (manual or automatic) was stamped within the last 60 seconds: claim lost.
  sql.mockResolvedValueOnce({ rows: [] });
  expect(await claimManualReminder('c1', at)).toBeNull();

  // Not open (e.g. closed or ready): the WHERE clause excludes it, claim lost.
  sql.mockResolvedValueOnce({ rows: [] });
  expect(await claimManualReminder('c2', at)).toBeNull();
});

test('auto-close sweeps every non-closed row past closes_at (ready included) and returns the count', async () => {
  sql.mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'a' }, { id: 'b' }] });
  expect(await closeExpiredCollections(new Date('2026-10-20T00:00:00Z'))).toBe(2);
  expect(queryText()).toContain("SET status = 'closed'");
  expect(queryText()).toContain("WHERE status <> 'closed' AND closes_at <= ?");
});
