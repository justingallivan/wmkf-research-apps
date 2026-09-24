'use strict';

/**
 * S504 regression as a contract test (plan §5 Stage 0 item 4;
 * .claude-memory/feedback-mocked-sql-hides-parameter-typing.md). The
 * production failure was `could not determine data type of parameter $2`:
 * a bound parameter placed directly inside `jsonb_build_object` (a
 * variadic "any" function), which Postgres's planner cannot type-infer.
 * Every existing test mocks the driver, so nothing ever reached a real
 * planner. This test does, against the real container from global-setup.js.
 *
 * Template for later store contract tests: exercise the real exported
 * function against a freshly inserted row, then, as a discriminating
 * control, execute the pre-fix (uncast) form of the same statement shape
 * directly and assert the real planner rejects it.
 */

import crypto from 'node:crypto';
import { Client } from 'pg';
// Real, unmodified source; @vercel/postgres resolves to the pg shim via
// jest.pg-contract.config.js's moduleNameMapper.
import { acquireSlotLease, releaseSlotLease } from '../../lib/services/site-visit-materials/collection-store.js';
import { getPool } from './support/vercel-postgres-pg-shim.js';

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('site-visit-materials collection-store: acquireSlotLease (S504)', () => {
  let client;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await getPool().end();
  });

  async function insertCollection() {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO site_visit_material_collections
         (id, request_id, site_visit_activity_id, status, due_at, closes_at,
          checklist, contacts, jti, token_digest, token_ciphertext, created_by)
       VALUES ($1, $2, $3, 'open', NOW() + INTERVAL '7 days', NOW() + INTERVAL '14 days',
               '[]'::jsonb, '{}'::jsonb, $4, $5, 'ciphertext', $6)`,
      [
        id,
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.createHash('sha256').update(id).digest('hex'),
        crypto.randomUUID(),
      ]
    );
    return id;
  }

  async function deleteCollection(id) {
    await client.query('DELETE FROM site_visit_material_collections WHERE id = $1', [id]);
  }

  test('acquireSlotLease succeeds against the real planner and persists the expected lease shape', async () => {
    const collectionId = await insertCollection();
    try {
      const lease = await acquireSlotLease({ collectionId, slotKey: 'budget_narrative' });

      expect(lease).not.toBeNull();
      expect(typeof lease.leaseToken).toBe('string');
      expect(lease.expiresAt).toBeInstanceOf(Date);

      const { rows } = await client.query(
        'SELECT slot_leases FROM site_visit_material_collections WHERE id = $1',
        [collectionId]
      );
      const persisted = rows[0].slot_leases.budget_narrative;
      expect(persisted.token).toBe(lease.leaseToken);
      expect(persisted.expiresAt).toBe(lease.expiresAt.getTime());

      const released = await releaseSlotLease({
        collectionId,
        slotKey: 'budget_narrative',
        leaseToken: lease.leaseToken,
      });
      expect(released).toBe(true);
    } finally {
      await deleteCollection(collectionId);
    }
  });

  test('DISCRIMINATING CONTROL: the pre-fix (uncast) statement shape is rejected by the real planner', async () => {
    // The exact acquireSlotLease UPDATE from collection-store.js, run
    // against a freshly inserted row, with the explicit ::text /
    // ::double precision casts removed — the exact bug that shipped in
    // production (S504). A mocked driver would accept this; the real
    // planner must not.
    const collectionId = await insertCollection();
    try {
      await expect(
        client.query(
          `UPDATE site_visit_material_collections
              SET slot_leases = jsonb_set(
                    COALESCE(slot_leases, '{}'::jsonb),
                    ARRAY[$1]::text[],
                    jsonb_build_object('token', $2, 'expiresAt', $3),
                    true
                  ),
                  updated_at = NOW()
            WHERE id = $4
          RETURNING id`,
          ['budget_narrative', crypto.randomUUID(), Date.now(), collectionId]
        )
      ).rejects.toThrow(/could not determine data type of parameter/);
    } finally {
      await deleteCollection(collectionId);
    }
  });
});
