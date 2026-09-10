/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { sql } from '@vercel/postgres';
import {
  SLOT_LEASE_TTL_MS,
  acquireSlotLease,
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
  expect(queryText()).toContain("jsonb_build_object('token', ?, 'expiresAt', ?)");
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
