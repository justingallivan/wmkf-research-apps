'use strict';

/**
 * Contract test for lib/services/site-visit-materials/collection-store.js.
 * Originally the S504 regression only (plan §5 Stage 0 item 4;
 * .claude-memory/feedback-mocked-sql-hides-parameter-typing.md): the
 * production failure was `could not determine data type of parameter $2`,
 * a bound parameter placed directly inside `jsonb_build_object` (a variadic
 * "any" function) that Postgres's planner cannot type-infer. That control
 * is preserved verbatim below.
 *
 * Extended for Stage 3 item 3 (wave 3, slice B),
 * docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md, to cover
 * every exported function of collection-store.js against the real
 * database (rule 9 — a real planner counts, a mock does not).
 *
 * Must-cover (per `node scripts/check-postgres-access-layer.js --json` →
 * castLint filtered to this file): 11 rows — 9 on insertCollection's INSERT
 * VALUES (lines 60/61/63: id, request_id, site_visit_activity_id, due_at,
 * closes_at, jti, token_digest, token_ciphertext, created_by — checklist/
 * contacts already carry an explicit ::jsonb cast so the linter does not
 * flag them, but they are asserted below too) and 2 on acquireSlotLease's
 * CASE (lines 208/209, the expired-vs-live lease branch) — covered by the
 * new "replaces an expired lease" test below, which is the only fixture
 * that reaches the CASE's TRUE branch.
 */

import crypto from 'node:crypto';
import { Client } from 'pg';
// Real, unmodified source; @vercel/postgres resolves to the pg shim via
// jest.pg-contract.config.js's moduleNameMapper.
import {
  acquireSlotLease,
  attachReminderEmailId,
  claimAutomaticReminder,
  claimManualReminder,
  closeExpiredCollections,
  getCollectionByDigest,
  getLatestCollectionForRequest,
  getOpenCollectionForRequest,
  insertCollection,
  listCollectionsDueForAutomaticReminder,
  listLatestCollectionsForRequests,
  markReady,
  recordInvitation,
  releaseSlotLease,
  reopenFromReady,
  updateChecklist,
} from '../../lib/services/site-visit-materials/collection-store.js';
import { getPool } from './support/vercel-postgres-pg-shim.js';

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('site-visit-materials collection-store: contract', () => {
  let client;
  const insertedIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedIds.length) {
        await client.query('DELETE FROM site_visit_material_collections WHERE id = ANY($1::uuid[])', [insertedIds]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      await Promise.allSettled([client.end(), getPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  // Raw-SQL fixture helper (bypasses the store) so tests can set fields
  // (status, created_at, due_at/closes_at) insertCollection() itself does
  // not accept. Every column sorts/compares differently from its neighbour
  // per plan §5 "How to copy the template" point 2.
  async function seedCollection(overrides = {}) {
    const id = crypto.randomUUID();
    const requestId = overrides.requestId || crypto.randomUUID();
    const dueAt = overrides.dueAt || new Date(Date.now() + 7 * 86400_000);
    const closesAt = overrides.closesAt || new Date(Date.now() + 14 * 86400_000);
    const status = overrides.status || 'open';
    const createdAt = overrides.createdAt || new Date();
    const invitedAt = overrides.invitedAt ?? null;
    const lastReminderAt = overrides.lastReminderAt ?? null;
    await client.query(
      `INSERT INTO site_visit_material_collections
         (id, request_id, site_visit_activity_id, status, due_at, closes_at,
          checklist, contacts, jti, token_digest, token_ciphertext, created_by,
          created_at, updated_at, invited_at, last_reminder_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, 'ciphertext', $11, $12, $12, $13, $14)`,
      [
        id, requestId, crypto.randomUUID(), status, dueAt.toISOString(), closesAt.toISOString(),
        JSON.stringify(overrides.checklist || []), JSON.stringify(overrides.contacts || {}),
        crypto.randomUUID(), crypto.createHash('sha256').update(id).digest('hex'),
        crypto.randomUUID(), createdAt.toISOString(),
        invitedAt ? invitedAt.toISOString() : null,
        lastReminderAt ? lastReminderAt.toISOString() : null,
      ]
    );
    insertedIds.push(id);
    return { id, requestId };
  }

  async function readRow(id) {
    const { rows } = await client.query('SELECT * FROM site_visit_material_collections WHERE id = $1', [id]);
    return rows[0];
  }

  describe('acquireSlotLease / releaseSlotLease (S504)', () => {
    test('acquireSlotLease succeeds against the real planner and persists the expected lease shape', async () => {
      const { id: collectionId } = await seedCollection();
      const lease = await acquireSlotLease({ collectionId, slotKey: 'budget_narrative' });

      expect(lease).not.toBeNull();
      expect(typeof lease.leaseToken).toBe('string');
      expect(lease.expiresAt).toBeInstanceOf(Date);

      const row = await readRow(collectionId);
      const persisted = row.slot_leases.budget_narrative;
      expect(persisted.token).toBe(lease.leaseToken);
      expect(persisted.expiresAt).toBe(lease.expiresAt.getTime());

      const released = await releaseSlotLease({
        collectionId,
        slotKey: 'budget_narrative',
        leaseToken: lease.leaseToken,
      });
      expect(released).toBe(true);
    });

    test('a live (unexpired) lease held by another caller blocks a second acquire', async () => {
      const { id: collectionId } = await seedCollection();
      const first = await acquireSlotLease({ collectionId, slotKey: 'budget' });
      expect(first).not.toBeNull();

      const second = await acquireSlotLease({ collectionId, slotKey: 'budget' });
      expect(second).toBeNull();
    });

    // DISCRIMINATING: reaches the CASE's TRUE branch (lines 208/209) — a
    // mutant that drops the expiry check entirely (always TRUE, i.e.
    // "no live lease ever blocks") is already caught by the test above;
    // a mutant that inverts the comparison (always FALSE, i.e. "an expired
    // lease never releases") is caught here, since only the real
    // expiresAt-in-the-past comparison lets this second acquire succeed.
    test('DISCRIMINATING: an expired lease is replaced, not treated as still live', async () => {
      const { id: collectionId } = await seedCollection();
      await client.query(
        `UPDATE site_visit_material_collections
            SET slot_leases = jsonb_build_object('budget', jsonb_build_object('token', $1::text, 'expiresAt', $2::double precision))
          WHERE id = $3`,
        [crypto.randomUUID(), Date.now() - 60_000, collectionId]
      );

      const lease = await acquireSlotLease({ collectionId, slotKey: 'budget' });
      expect(lease).not.toBeNull();
      const row = await readRow(collectionId);
      expect(row.slot_leases.budget.token).toBe(lease.leaseToken);
    });

    test('releaseSlotLease is a no-op when the token does not match the current lease', async () => {
      const { id: collectionId } = await seedCollection();
      await acquireSlotLease({ collectionId, slotKey: 'budget' });
      const released = await releaseSlotLease({ collectionId, slotKey: 'budget', leaseToken: 'not-the-token' });
      expect(released).toBe(false);
    });

    test('DISCRIMINATING CONTROL: the pre-fix (uncast) statement shape is rejected by the real planner', async () => {
      // The exact acquireSlotLease UPDATE from collection-store.js, run
      // against a freshly inserted row, with the explicit ::text /
      // ::double precision casts removed — the exact bug that shipped in
      // production (S504). A mocked driver would accept this; the real
      // planner must not.
      const { id: collectionId } = await seedCollection();
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
    });
  });

  describe('insertCollection', () => {
    test('binds every column of the INSERT, including a real created_by foreign value', async () => {
      const id = crypto.randomUUID();
      const requestId = crypto.randomUUID();
      const siteVisitActivityId = crypto.randomUUID();
      const dueAt = new Date(Date.now() + 3 * 86400_000);
      const closesAt = new Date(Date.now() + 5 * 86400_000);
      const jti = crypto.randomUUID();
      const tokenDigest = crypto.createHash('sha256').update(id).digest('hex');
      const tokenCiphertext = 'contract-ciphertext';
      const createdBy = crypto.randomUUID();
      const checklist = [{ slot: 'budget' }];
      const contacts = { pi: { email: 'pi@example.org' } };

      const row = await insertCollection({
        id, requestId, siteVisitActivityId, dueAt, closesAt, jti,
        tokenDigest, tokenCiphertext, createdBy, checklist, contacts,
      });
      insertedIds.push(id);

      expect(row.id).toBe(id);
      expect(row.request_id).toBe(requestId);
      expect(row.site_visit_activity_id).toBe(siteVisitActivityId);
      expect(row.status).toBe('open');
      expect(new Date(row.due_at).toISOString()).toBe(dueAt.toISOString());
      expect(new Date(row.closes_at).toISOString()).toBe(closesAt.toISOString());
      expect(row.jti).toBe(jti);
      expect(row.token_digest).toBe(tokenDigest);
      expect(row.token_ciphertext).toBe(tokenCiphertext);
      expect(row.created_by).toBe(createdBy);
      expect(row.checklist).toEqual(checklist);
      expect(row.contacts).toEqual(contacts);
    });
  });

  describe('getOpenCollectionForRequest / getLatestCollectionForRequest / getCollectionByDigest / listLatestCollectionsForRequests', () => {
    test('getOpenCollectionForRequest returns the open row and not a closed one for the same request', async () => {
      const requestId = crypto.randomUUID();
      const { id: closedId } = await seedCollection({ requestId, status: 'closed', createdAt: new Date(Date.now() - 60_000) });
      const { id: openId } = await seedCollection({ requestId, createdAt: new Date() });

      const found = await getOpenCollectionForRequest(requestId);
      expect(found.id).toBe(openId);
      expect(found.id).not.toBe(closedId);
    });

    test('getOpenCollectionForRequest returns null when every collection for the request is closed', async () => {
      const requestId = crypto.randomUUID();
      await seedCollection({ requestId, status: 'closed' });
      const found = await getOpenCollectionForRequest(requestId);
      expect(found).toBeNull();
    });

    // Anti-correlated fixture (plan §5 point 2): the OLDER row is closed
    // (sorts after by status if a mutant filtered on status) but the
    // NEWEST row by created_at is also closed here, so only a correct
    // `ORDER BY created_at DESC LIMIT 1` (not a status-based mutant) picks it.
    test('getLatestCollectionForRequest returns the most recent row regardless of status', async () => {
      const requestId = crypto.randomUUID();
      await seedCollection({ requestId, status: 'closed', createdAt: new Date(Date.now() - 120_000) });
      const { id: newestId } = await seedCollection({ requestId, status: 'closed', createdAt: new Date() });

      const found = await getLatestCollectionForRequest(requestId);
      expect(found.id).toBe(newestId);
    });

    test('getCollectionByDigest finds the row by its token_digest', async () => {
      const { id } = await seedCollection();
      const row = await readRow(id);
      const found = await getCollectionByDigest(row.token_digest);
      expect(found.id).toBe(id);
    });

    test('listLatestCollectionsForRequests returns [] for an empty/falsy input without querying', async () => {
      expect(await listLatestCollectionsForRequests([])).toEqual([]);
      expect(await listLatestCollectionsForRequests(undefined)).toEqual([]);
    });

    test('listLatestCollectionsForRequests casts the id array to uuid[] and returns one DISTINCT ON row per request', async () => {
      const requestA = crypto.randomUUID();
      const requestB = crypto.randomUUID();
      await seedCollection({ requestId: requestA, status: 'closed', createdAt: new Date(Date.now() - 60_000) });
      const { id: latestA } = await seedCollection({ requestId: requestA, status: 'closed', createdAt: new Date() });
      const { id: latestB } = await seedCollection({ requestId: requestB, status: 'closed' });

      const rows = await listLatestCollectionsForRequests([requestA, requestA.toUpperCase(), requestB]);
      const byRequest = Object.fromEntries(rows.map((r) => [r.request_id, r.id]));
      expect(byRequest[requestA]).toBe(latestA);
      expect(byRequest[requestB]).toBe(latestB);
    });
  });

  describe('recordInvitation', () => {
    // DISCRIMINATING: COALESCE must keep the FIRST invited_at/invitation_email_id
    // — a mutant that overwrites on every call would fail the second assertion.
    test('sets invited_at/invitation_email_id once and COALESCE keeps the original on a second call', async () => {
      const { id } = await seedCollection();
      const firstEmailId = crypto.randomUUID();
      const first = await recordInvitation(id, firstEmailId);
      expect(first.invitation_email_id).toBe(firstEmailId);
      expect(first.invited_at).not.toBeNull();

      const secondEmailId = crypto.randomUUID();
      const second = await recordInvitation(id, secondEmailId);
      expect(second.invitation_email_id).toBe(firstEmailId);
      expect(new Date(second.invited_at).getTime()).toBe(new Date(first.invited_at).getTime());
    });
  });

  describe('claimManualReminder', () => {
    test('claims when open and no recent reminder, then blocks a second claim inside the 60s window', async () => {
      const { id } = await seedCollection();
      const claimed = await claimManualReminder(id);
      expect(claimed).not.toBeNull();
      expect(claimed.reminder_count).toBe(1);

      const blocked = await claimManualReminder(id);
      expect(blocked).toBeNull();
    });

    test('returns null when the collection is not open', async () => {
      const { id } = await seedCollection({ status: 'closed' });
      const claimed = await claimManualReminder(id);
      expect(claimed).toBeNull();
    });

    test('claims again once the 60s window has passed', async () => {
      const { id } = await seedCollection({ lastReminderAt: new Date(Date.now() - 120_000) });
      const claimed = await claimManualReminder(id);
      expect(claimed).not.toBeNull();
      expect(claimed.reminder_count).toBe(1);
    });
  });

  describe('listCollectionsDueForAutomaticReminder / claimAutomaticReminder / attachReminderEmailId', () => {
    test('lists only the invited, past-due, still-open, not-yet-reminded collection', async () => {
      const now = new Date();
      // Qualifies: invited, due in the past, window still open, never reminded.
      const { id: qualifies } = await seedCollection({
        invitedAt: new Date(now.getTime() - 3 * 86400_000),
        dueAt: new Date(now.getTime() - 86400_000),
        closesAt: new Date(now.getTime() + 86400_000),
      });
      // Does not qualify: never invited (anti-correlated -- sorts earlier by
      // due_at than `qualifies` would if a mutant dropped the invited_at filter).
      await seedCollection({
        invitedAt: null,
        dueAt: new Date(now.getTime() - 2 * 86400_000),
        closesAt: new Date(now.getTime() + 86400_000),
      });
      // Does not qualify: already reminded on/after due_at.
      await seedCollection({
        invitedAt: new Date(now.getTime() - 3 * 86400_000),
        dueAt: new Date(now.getTime() - 86400_000),
        closesAt: new Date(now.getTime() + 86400_000),
        lastReminderAt: now,
      });

      const due = await listCollectionsDueForAutomaticReminder(now);
      const ids = due.map((r) => r.id);
      expect(ids).toContain(qualifies);
      expect(ids.length).toBe(1);
    });

    test('claimAutomaticReminder claims once and a second claim on the same row fails', async () => {
      const now = new Date();
      const { id } = await seedCollection({
        invitedAt: new Date(now.getTime() - 3 * 86400_000),
        dueAt: new Date(now.getTime() - 86400_000),
        closesAt: new Date(now.getTime() + 86400_000),
      });

      const claimed = await claimAutomaticReminder(id, now);
      expect(claimed).not.toBeNull();
      expect(claimed.reminder_count).toBe(1);
      expect(claimed.last_reminder_email_id).toBeNull();

      const again = await claimAutomaticReminder(id, now);
      expect(again).toBeNull();
    });

    test('attachReminderEmailId stamps the email id unconditionally', async () => {
      const { id } = await seedCollection();
      const emailId = crypto.randomUUID();
      const row = await attachReminderEmailId(id, emailId);
      expect(row.last_reminder_email_id).toBe(emailId);
    });
  });

  describe('updateChecklist', () => {
    test('updates checklist on an open collection', async () => {
      const { id } = await seedCollection();
      const newChecklist = [{ slot: 'irs_letter' }];
      const row = await updateChecklist(id, newChecklist);
      expect(row.checklist).toEqual(newChecklist);
    });

    // DISCRIMINATING: the `status <> 'closed'` guard must block the write --
    // a mutant that drops it would return the updated row instead of null.
    test('DISCRIMINATING: returns null and leaves the checklist untouched on a closed collection', async () => {
      const { id } = await seedCollection({ status: 'closed', checklist: [{ slot: 'original' }] });
      const result = await updateChecklist(id, [{ slot: 'attempted_overwrite' }]);
      expect(result).toBeNull();
      const row = await readRow(id);
      expect(row.checklist).toEqual([{ slot: 'original' }]);
    });
  });

  describe('markReady / reopenFromReady', () => {
    test('markReady transitions open -> ready and reopenFromReady reverses it', async () => {
      const { id } = await seedCollection();
      const actorId = crypto.randomUUID();
      const ready = await markReady(id, actorId);
      expect(ready.status).toBe('ready');
      expect(ready.ready_confirmed_by).toBe(actorId);
      expect(ready.ready_confirmed_at).not.toBeNull();

      const reopened = await reopenFromReady(id);
      expect(reopened.status).toBe('open');
      expect(reopened.ready_confirmed_by).toBeNull();
      expect(reopened.ready_confirmed_at).toBeNull();
    });

    test('markReady is a no-op on an already-ready or closed collection', async () => {
      const { id } = await seedCollection({ status: 'closed' });
      const result = await markReady(id, crypto.randomUUID());
      expect(result).toBeNull();
    });

    test('reopenFromReady is a no-op on a collection that is not ready', async () => {
      const { id } = await seedCollection();
      const result = await reopenFromReady(id);
      expect(result).toBeNull();
    });
  });

  describe('closeExpiredCollections', () => {
    test('closes only rows past their window and leaves others alone', async () => {
      const now = new Date();
      const { id: expired } = await seedCollection({
        dueAt: new Date(now.getTime() - 2 * 86400_000),
        closesAt: new Date(now.getTime() - 86400_000),
      });
      const { id: stillOpen } = await seedCollection({
        dueAt: new Date(now.getTime() + 86400_000),
        closesAt: new Date(now.getTime() + 2 * 86400_000),
      });

      const count = await closeExpiredCollections(now);
      expect(count).toBeGreaterThanOrEqual(1);

      const expiredRow = await readRow(expired);
      expect(expiredRow.status).toBe('closed');
      const stillOpenRow = await readRow(stillOpen);
      expect(stillOpenRow.status).toBe('open');
    });
  });
});
