/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { sql } from '@vercel/postgres';
import {
  acquirePresentationSlotLease,
  getPresentationSlotLease,
  releasePresentationSlotLease,
  renewPresentationSlotLease,
} from '../../lib/services/post-presentation-materials/slot-lease-store.js';

const INPUT = {
  requestId: '11111111-1111-4111-8111-111111111111',
  artifactType: 100000005,
  leaseToken: '22222222-2222-4222-8222-222222222222',
  fenceVersion: 7,
};

function statement() {
  const [strings] = sql.mock.calls.at(-1);
  return strings.join('?').replace(/\s+/g, ' ');
}

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue({ rows: [{ fence_version: 7 }] });
});

test('acquisition is conditional, idempotent for the same token, monotonic for a new token, and bounded at Dataverse max', async () => {
  await expect(acquirePresentationSlotLease(INPUT)).resolves.toEqual({ fence_version: 7 });
  const text = statement();
  expect(text).toContain('ON CONFLICT (request_id, artifact_type) DO UPDATE');
  expect(text).toContain('lease_token = EXCLUDED.lease_token THEN presentation_material_slot_leases.fence_version');
  expect(text).toContain('ELSE presentation_material_slot_leases.fence_version + 1');
  expect(text).toContain('lease_expires_at <= NOW()');
  expect(text).not.toContain('OR presentation_material_slot_leases.lease_token = EXCLUDED.lease_token');
  expect(text).toContain('fence_version < ?');
  expect(sql.mock.calls[0].slice(1)).toContain(2147483647);
});

test('renew refuses an expired or mismatched token/fence and release expires only the matching holder while retaining retry identity', async () => {
  await renewPresentationSlotLease(INPUT);
  expect(statement()).toContain('lease_token = ? AND fence_version = ? AND lease_expires_at > NOW()');
  await releasePresentationSlotLease(INPUT);
  const text = statement();
  expect(text).toContain('SET lease_expires_at = NOW()');
  expect(text).not.toContain('lease_token = NULL');
  expect(text).toContain('lease_token = ? AND fence_version = ?');
});

test('slot inspection is bounded to the exact request/type primary key', async () => {
  await getPresentationSlotLease(INPUT);
  const text = statement();
  expect(text).toContain('WHERE request_id = ? AND artifact_type = ? LIMIT 1');
});
