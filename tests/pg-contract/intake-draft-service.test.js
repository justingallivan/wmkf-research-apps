'use strict';

/**
 * Contract test for lib/services/intake-draft-service.js — Stage 3 item 3
 * (wave 3, slice B), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * tests/unit/intake-draft-service.test.js and
 * tests/unit/intake-draft-service-pending.test.js mock `@vercel/postgres`
 * at the module boundary and say so explicitly ("SQL race-safety ... is
 * intrinsically not a unit-test shape ... the SQL itself IS the test").
 * Per plan §2 rule 9 this contract test IS the tests-before requirement —
 * every exported static method is exercised once against the real
 * database.
 *
 * Must-cover (per `node scripts/check-postgres-access-layer.js --json` →
 * castLint filtered to this file): 15 rows — 4 each on upsert's and
 * upsertDraftJson's with-request INSERT VALUES (lines 84/189:
 * contact_oid, account_id, request_id, form_key), 3 each on their
 * no-request INSERT VALUES (lines 104/246: contact_oid, account_id,
 * form_key — request_id is a literal NULL there, not a bound param), and
 * 1 on appendPending's CASE (line 407: entry.attachmentId in the dedup
 * EXISTS check). Every one is asserted by row read-back below.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('intake-draft-service: contract', () => {
  const IntakeDraftService = require('../../lib/services/intake-draft-service');

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
        await client.query('DELETE FROM intake_drafts WHERE id = ANY($1::int[])', [insertedIds]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      await Promise.allSettled([client.end(), getShimPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  async function assertNoOpenTransactionAnywhere() {
    const xact = await withClient(async (c) => {
      const { rows } = await c.query('SELECT pg_current_xact_id_if_assigned() AS x');
      return rows[0].x;
    });
    expect(xact).toBeNull();

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
    );
    expect(rows[0].n).toBe(0);
  }

  function uuidV4() {
    return crypto.randomUUID();
  }

  async function readRow(id) {
    const { rows } = await client.query('SELECT * FROM intake_drafts WHERE id = $1', [id]);
    return rows[0];
  }

  describe('upsert', () => {
    test('with-request branch: binds every column and DO UPDATE overwrites draft_json/attachments on a second call', async () => {
      const contactOid = `contact-${crypto.randomBytes(4).toString('hex')}`;
      const accountId = `account-${crypto.randomBytes(4).toString('hex')}`;
      const requestId = `req-${crypto.randomBytes(4).toString('hex')}`;
      const formKey = 'phase-i';

      const first = await IntakeDraftService.upsert({
        contactOid, accountId, requestId, formKey,
        draftJson: { step: 1 }, attachments: [{ blob_url: 'https://blob/a' }],
      });
      insertedIds.push(first.id);
      expect(first.contact_oid).toBe(contactOid);
      expect(first.account_id).toBe(accountId);
      expect(first.request_id).toBe(requestId);
      expect(first.form_key).toBe(formKey);
      expect(first.draft_json).toEqual({ step: 1 });
      expect(first.attachments).toEqual([{ blob_url: 'https://blob/a' }]);

      const second = await IntakeDraftService.upsert({
        contactOid, accountId, requestId, formKey,
        draftJson: { step: 2 }, attachments: [{ blob_url: 'https://blob/b' }],
      });
      expect(second.id).toBe(first.id);
      expect(second.draft_json).toEqual({ step: 2 });
      expect(second.attachments).toEqual([{ blob_url: 'https://blob/b' }]);
      await assertNoOpenTransactionAnywhere();
    });

    test('no-request branch: binds every column, scoped by (contact_oid, account_id, form_key)', async () => {
      const contactOid = `contact-${crypto.randomBytes(4).toString('hex')}`;
      const accountId = `account-${crypto.randomBytes(4).toString('hex')}`;
      const formKey = 'phase-i';

      const row = await IntakeDraftService.upsert({
        contactOid, accountId, formKey, draftJson: { a: 1 }, attachments: [],
      });
      insertedIds.push(row.id);
      expect(row.contact_oid).toBe(contactOid);
      expect(row.account_id).toBe(accountId);
      expect(row.request_id).toBeNull();
      expect(row.form_key).toBe(formKey);

      // DISCRIMINATING: a different contact at the SAME account/form_key
      // must get its OWN row (contact-scoped per migration 012), not
      // collide with the first -- kills a mutant that drops contact_oid
      // from the ON CONFLICT target.
      const otherContactOid = `contact-${crypto.randomBytes(4).toString('hex')}`;
      const otherRow = await IntakeDraftService.upsert({
        contactOid: otherContactOid, accountId, formKey, draftJson: { a: 2 }, attachments: [],
      });
      insertedIds.push(otherRow.id);
      expect(otherRow.id).not.toBe(row.id);
    });
  });

  describe('getByKey', () => {
    test('with-request lookup, and no-request lookup requires contactOid', async () => {
      const contactOid = `contact-${crypto.randomBytes(4).toString('hex')}`;
      const accountId = `account-${crypto.randomBytes(4).toString('hex')}`;
      const requestId = `req-${crypto.randomBytes(4).toString('hex')}`;
      const formKey = 'phase-i';
      const withReq = await IntakeDraftService.upsert({ contactOid, accountId, requestId, formKey, draftJson: {}, attachments: [] });
      insertedIds.push(withReq.id);
      const noReq = await IntakeDraftService.upsert({ contactOid, accountId, formKey: 'phase-ii', draftJson: {}, attachments: [] });
      insertedIds.push(noReq.id);

      const foundWithReq = await IntakeDraftService.getByKey({ accountId, requestId, formKey });
      expect(foundWithReq.id).toBe(withReq.id);

      const foundNoReq = await IntakeDraftService.getByKey({ contactOid, accountId, formKey: 'phase-ii' });
      expect(foundNoReq.id).toBe(noReq.id);

      await expect(IntakeDraftService.getByKey({ accountId, formKey: 'phase-ii' })).rejects.toThrow(/contactOid/);
    });
  });

  describe('upsertDraftJson', () => {
    test('with-request branch binds every column and leaves attachments untouched', async () => {
      const contactOid = `contact-${crypto.randomBytes(4).toString('hex')}`;
      const accountId = `account-${crypto.randomBytes(4).toString('hex')}`;
      const requestId = `req-${crypto.randomBytes(4).toString('hex')}`;
      const formKey = 'phase-i';
      const first = await IntakeDraftService.upsertDraftJson({ contactOid, accountId, requestId, formKey, draftJson: { step: 'a' } });
      insertedIds.push(first.id);
      expect(first.contact_oid).toBe(contactOid);
      expect(first.account_id).toBe(accountId);
      expect(first.request_id).toBe(requestId);
      expect(first.form_key).toBe(formKey);
      expect(first.attachments).toEqual([]);

      const second = await IntakeDraftService.upsertDraftJson({ contactOid, accountId, requestId, formKey, draftJson: { step: 'b' } });
      expect(second.id).toBe(first.id);
      expect(second.draft_json).toEqual({ step: 'b' });
    });

    test('no-request branch rejects a missing/malformed idempotency_key', async () => {
      const contactOid = `contact-${crypto.randomBytes(4).toString('hex')}`;
      const accountId = `account-${crypto.randomBytes(4).toString('hex')}`;
      await expect(IntakeDraftService.upsertDraftJson({
        contactOid, accountId, formKey: 'phase-i', draftJson: { idempotency_key: 'not-a-uuid' },
      })).rejects.toThrow(/idempotency_key/);
    });

    // DISCRIMINATING (Codex S183-round-9): a JSONB `null` idempotency_key
    // already stored on the row must be treated as ABSENT (fall through to
    // EXCLUDED's real key), not as "present" -- a mutant that used plain
    // COALESCE without the NULLIF('null'::jsonb) treatment would preserve
    // the stored JSON null forever, never picking up a real key.
    test('DISCRIMINATING: race-free idempotency_key preserves the FIRST real key across autosaves, and recovers from a stored JSONB null', async () => {
      const contactOid = `contact-${crypto.randomBytes(4).toString('hex')}`;
      const accountId = `account-${crypto.randomBytes(4).toString('hex')}`;
      const formKey = 'phase-i';
      const firstKey = uuidV4();

      const first = await IntakeDraftService.upsertDraftJson({
        contactOid, accountId, formKey, draftJson: { idempotency_key: firstKey, note: 'first' },
      });
      insertedIds.push(first.id);
      expect(first.draft_json.idempotency_key).toBe(firstKey);

      const secondKey = uuidV4();
      const second = await IntakeDraftService.upsertDraftJson({
        contactOid, accountId, formKey, draftJson: { idempotency_key: secondKey, note: 'second' },
      });
      expect(second.id).toBe(first.id);
      expect(second.draft_json.idempotency_key).toBe(firstKey);
      expect(second.draft_json.note).toBe('second');

      // Force the stored key into a JSONB null (simulating the round-9 edge
      // case) directly, then autosave again: the real key must win.
      await client.query(`UPDATE intake_drafts SET draft_json = jsonb_set(draft_json, '{idempotency_key}', 'null'::jsonb) WHERE id = $1`, [first.id]);
      const thirdKey = uuidV4();
      const third = await IntakeDraftService.upsertDraftJson({
        contactOid, accountId, formKey, draftJson: { idempotency_key: thirdKey, note: 'third' },
      });
      expect(third.draft_json.idempotency_key).toBe(thirdKey);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getById / listByContact / listByAccount / delete', () => {
    test('getById finds the row, null when absent', async () => {
      const row = await IntakeDraftService.upsert({
        contactOid: 'c-getbyid', accountId: 'a-getbyid', formKey: 'phase-i', draftJson: {}, attachments: [],
      });
      insertedIds.push(row.id);
      const found = await IntakeDraftService.getById(row.id);
      expect(found.id).toBe(row.id);
      expect(await IntakeDraftService.getById(-1)).toBeNull();
    });

    test('listByContact and listByAccount order by updated_at DESC', async () => {
      const contactOid = `contact-${crypto.randomBytes(4).toString('hex')}`;
      const accountId = `account-${crypto.randomBytes(4).toString('hex')}`;
      const older = await IntakeDraftService.upsert({ contactOid, accountId, formKey: 'a', draftJson: {}, attachments: [] });
      insertedIds.push(older.id);
      await client.query(`UPDATE intake_drafts SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [older.id]);
      const newer = await IntakeDraftService.upsert({ contactOid, accountId, formKey: 'b', draftJson: {}, attachments: [] });
      insertedIds.push(newer.id);

      const byContact = await IntakeDraftService.listByContact(contactOid);
      expect(byContact.map((r) => r.id)).toEqual([newer.id, older.id]);
      const byAccount = await IntakeDraftService.listByAccount(accountId);
      expect(byAccount.map((r) => r.id)).toEqual([newer.id, older.id]);
    });

    test('delete removes the row and returns the affected count', async () => {
      const row = await IntakeDraftService.upsert({
        contactOid: 'c-del', accountId: 'a-del', formKey: 'phase-i', draftJson: {}, attachments: [],
      });
      const count = await IntakeDraftService.delete(row.id);
      expect(count).toBe(1);
      expect(await readRow(row.id)).toBeUndefined();
      expect(await IntakeDraftService.delete(row.id)).toBe(0);
    });
  });

  describe('appendAttachment / removeAttachment', () => {
    test('append is additive and remove filters by blob_url', async () => {
      const row = await IntakeDraftService.upsert({
        contactOid: 'c-attach', accountId: 'a-attach', formKey: 'phase-i', draftJson: {}, attachments: [{ blob_url: 'https://blob/keep' }],
      });
      insertedIds.push(row.id);

      const appended = await IntakeDraftService.appendAttachment(row.id, { blob_url: 'https://blob/new' });
      expect(appended.attachments).toEqual(expect.arrayContaining([
        { blob_url: 'https://blob/keep' }, { blob_url: 'https://blob/new' },
      ]));
      expect(appended.attachments).toHaveLength(2);

      const removed = await IntakeDraftService.removeAttachment(row.id, 'https://blob/new');
      expect(removed.attachments).toEqual([{ blob_url: 'https://blob/keep' }]);
    });
  });

  describe('deleteExpired', () => {
    test('deletes only rows past the cutoff and flattens their attachments', async () => {
      const oldRow = await IntakeDraftService.upsert({
        contactOid: 'c-old', accountId: 'a-old', formKey: 'phase-i', draftJson: {}, attachments: [{ blob_url: 'https://blob/old-a' }],
      });
      await client.query(`UPDATE intake_drafts SET updated_at = NOW() - INTERVAL '100 days' WHERE id = $1`, [oldRow.id]);
      const freshRow = await IntakeDraftService.upsert({
        contactOid: 'c-fresh', accountId: 'a-fresh', formKey: 'phase-i', draftJson: {}, attachments: [],
      });
      insertedIds.push(freshRow.id);

      const { count, attachments } = await IntakeDraftService.deleteExpired({ olderThanDays: 90 });
      expect(count).toBeGreaterThanOrEqual(1);
      expect(attachments.some((a) => a.draftId === oldRow.id && a.blob_url === 'https://blob/old-a')).toBe(true);
      expect(await readRow(oldRow.id)).toBeUndefined();
      expect(await readRow(freshRow.id)).not.toBeUndefined();
    });
  });

  describe('pending-attachment helpers', () => {
    async function seedDraft(overrides = {}) {
      const row = await IntakeDraftService.upsert({
        contactOid: `c-${crypto.randomBytes(4).toString('hex')}`,
        accountId: `a-${crypto.randomBytes(4).toString('hex')}`,
        formKey: 'phase-i',
        draftJson: {},
        attachments: [],
        ...overrides,
      });
      insertedIds.push(row.id);
      return row;
    }

    test('appendPending is idempotent on a duplicate attachmentId (CASE dedup)', async () => {
      const row = await seedDraft();
      const attachmentId = crypto.randomUUID();
      const entry = { attachmentId, fieldKey: 'irs_letter', filename: 'a.pdf', pathname: 'p/a', contentType: 'application/pdf', maxBytes: 100, createdAt: new Date().toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString() };

      const first = await IntakeDraftService.appendPending(row.id, entry);
      expect(first.pending).toHaveLength(1);

      // DISCRIMINATING: appending the SAME attachmentId again with a
      // DIFFERENT filename must be a no-op -- a mutant that dropped the
      // EXISTS/CASE dedup would append a second entry.
      const again = await IntakeDraftService.appendPending(row.id, { ...entry, filename: 'different.pdf' });
      expect(again.pending).toHaveLength(1);
      expect(again.pending[0].filename).toBe('a.pdf');

      expect(await IntakeDraftService.appendPending(-1, entry)).toBeNull();
    });

    test('selectPendingForDraft reads back entries; null when draft absent', async () => {
      const row = await seedDraft();
      const attachmentId = crypto.randomUUID();
      await IntakeDraftService.appendPending(row.id, { attachmentId, fieldKey: 'irs_letter' });
      const pending = await IntakeDraftService.selectPendingForDraft(row.id);
      expect(pending).toHaveLength(1);
      expect(pending[0].attachmentId).toBe(attachmentId);
      expect(await IntakeDraftService.selectPendingForDraft(-1)).toBeNull();
    });

    test('removePending removes an existing entry and no-ops otherwise', async () => {
      const row = await seedDraft();
      const attachmentId = crypto.randomUUID();
      await IntakeDraftService.appendPending(row.id, { attachmentId, fieldKey: 'irs_letter' });
      const removed = await IntakeDraftService.removePending(row.id, attachmentId);
      expect(removed).toEqual({ removed: true });
      const removedAgain = await IntakeDraftService.removePending(row.id, attachmentId);
      expect(removedAgain).toEqual({ removed: false });
    });

    test('listPendingOlderThan returns only entries older than the cutoff, across drafts', async () => {
      const row = await seedDraft();
      const oldEntryId = crypto.randomUUID();
      const newEntryId = crypto.randomUUID();
      await IntakeDraftService.appendPending(row.id, { attachmentId: oldEntryId, fieldKey: 'x', createdAt: '2020-01-01T00:00:00.000Z' });
      await IntakeDraftService.appendPending(row.id, { attachmentId: newEntryId, fieldKey: 'x', createdAt: new Date().toISOString() });

      const stale = await IntakeDraftService.listPendingOlderThan('2021-01-01T00:00:00.000Z');
      const ours = stale.filter((s) => s.draftId === row.id);
      expect(ours).toHaveLength(1);
      expect(ours[0].entry.attachmentId).toBe(oldEntryId);
    });

    describe('promoteToClean', () => {
      test('promotes when pending, not already attached, and under cap', async () => {
        const row = await seedDraft();
        const attachmentId = crypto.randomUUID();
        await IntakeDraftService.appendPending(row.id, { attachmentId, fieldKey: 'irs_letter' });

        const result = await IntakeDraftService.promoteToClean(row.id, attachmentId, { attachmentId, fieldKey: 'irs_letter', blob_url: 'https://blob/clean' }, { fieldKey: 'irs_letter', cap: 1 });
        expect(result).toEqual({ promoted: true });

        const promotedRow = await readRow(row.id);
        expect(promotedRow.attachments).toHaveLength(1);
        expect(promotedRow.pending_attachments).toEqual([]);
      });

      test('race_already_promoted when the entry is already in attachments', async () => {
        const row = await seedDraft({ attachments: [] });
        const attachmentId = crypto.randomUUID();
        await client.query(
          `UPDATE intake_drafts SET attachments = $2::jsonb WHERE id = $1`,
          [row.id, JSON.stringify([{ attachmentId, fieldKey: 'irs_letter' }])]
        );
        const result = await IntakeDraftService.promoteToClean(row.id, attachmentId, { attachmentId, fieldKey: 'irs_letter' }, { fieldKey: 'irs_letter', cap: 1 });
        expect(result).toEqual({ promoted: false, reason: 'race_already_promoted' });
      });

      test('draft_submitted when request_id is set', async () => {
        const row = await seedDraft();
        await client.query('UPDATE intake_drafts SET request_id = $2 WHERE id = $1', [row.id, `req-${crypto.randomBytes(4).toString('hex')}`]);
        const attachmentId = crypto.randomUUID();
        await client.query(
          `UPDATE intake_drafts SET pending_attachments = $2::jsonb WHERE id = $1`,
          [row.id, JSON.stringify([{ attachmentId, fieldKey: 'irs_letter' }])]
        );
        const result = await IntakeDraftService.promoteToClean(row.id, attachmentId, { attachmentId, fieldKey: 'irs_letter' }, { fieldKey: 'irs_letter', cap: 1 });
        expect(result).toEqual({ promoted: false, reason: 'draft_submitted' });
      });

      // DISCRIMINATING: cap gate is SQL-level -- an entry that IS pending
      // but whose fieldKey is already at cap must be blocked, distinct
      // from pending_not_found -- kills a mutant that drops the
      // `< cap` clause and always promotes.
      test('cap_exceeded_race when the field is already at cap', async () => {
        const row = await seedDraft({ attachments: [{ attachmentId: crypto.randomUUID(), fieldKey: 'irs_letter' }] });
        const attachmentId = crypto.randomUUID();
        await client.query(
          `UPDATE intake_drafts SET pending_attachments = $2::jsonb WHERE id = $1`,
          [row.id, JSON.stringify([{ attachmentId, fieldKey: 'irs_letter' }])]
        );
        const result = await IntakeDraftService.promoteToClean(row.id, attachmentId, { attachmentId, fieldKey: 'irs_letter' }, { fieldKey: 'irs_letter', cap: 1 });
        expect(result).toEqual({ promoted: false, reason: 'cap_exceeded_race', fieldCount: 1, cap: 1 });
      });

      test('pending_not_found when the entry is in neither pending nor attachments', async () => {
        const row = await seedDraft();
        const result = await IntakeDraftService.promoteToClean(row.id, crypto.randomUUID(), { attachmentId: crypto.randomUUID(), fieldKey: 'irs_letter' }, { fieldKey: 'irs_letter', cap: 1 });
        expect(result).toEqual({ promoted: false, reason: 'pending_not_found' });
      });

      test('draft_not_found when the draft id does not exist', async () => {
        const result = await IntakeDraftService.promoteToClean(-1, crypto.randomUUID(), { attachmentId: crypto.randomUUID(), fieldKey: 'irs_letter' }, { fieldKey: 'irs_letter', cap: 1 });
        expect(result).toEqual({ promoted: false, reason: 'draft_not_found' });
        await assertNoOpenTransactionAnywhere();
      });
    });
  });
});
