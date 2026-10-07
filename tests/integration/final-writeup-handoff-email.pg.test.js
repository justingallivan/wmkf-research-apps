/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';

/**
 * Live-Postgres proof for the group-review handoff email ledger
 * (migration 072, lib/services/final-writeup/handoff-email-store.js): intent
 * insert and reopen rules, lease exclusivity, the sent/skip CHECK shapes, and
 * the one-row-per-Final unique index run against real SQL.
 *
 * SKIPPED by default. Set TEST_REQUEST_LEDGER_TEST_URL to a scratch/local
 * Postgres database (NEVER the shared Production/Preview POSTGRES_URL). The
 * test works in its own schema and drops it afterwards.
 */
const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the handoff email proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;

const mockPg = { client: null };
jest.mock('@vercel/postgres', () => ({
  sql: (strings, ...values) => mockPg.client.query(
    strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''),
    values,
  ),
}));

const MIGRATION = fs.readFileSync(
  path.join(process.cwd(), 'lib/db/migrations/072_final_writeup_handoff_emails.sql'),
  'utf8',
);

const SOURCE = '11111111-1111-4111-8111-111111111111';
const OTHER_SOURCE = '11111111-1111-4111-8111-111111111112';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const PROGRAM = '33333333-3333-4333-8333-333333333333';
const LEAD = '44444444-4444-4444-8444-444444444444';
const FINAL = '55555555-5555-4555-8555-555555555555';
const EMAIL = '66666666-6666-4666-8666-666666666666';

const intent = (overrides = {}) => ({
  sourceDocumentId: SOURCE, requestId: REQUEST, grantProgramId: PROGRAM, leadSystemUserId: LEAD, ...overrides,
});

describeIf('final_writeup_handoff_emails ledger (live Postgres, migration 072)', () => {
  const schema = `handoff_email_${crypto.randomBytes(4).toString('hex')}`;
  let store;

  beforeAll(async () => {
    mockPg.client = new Client({ connectionString: TEST_URL });
    await mockPg.client.connect();
    await mockPg.client.query(`CREATE SCHEMA ${schema}`);
    await mockPg.client.query(`SET search_path TO ${schema}`);
    await mockPg.client.query(MIGRATION);
    store = await import('../../lib/services/final-writeup/handoff-email-store.js');
  });

  afterAll(async () => {
    if (!mockPg.client) return;
    await mockPg.client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await mockPg.client.end();
  });

  beforeEach(async () => {
    await mockPg.client.query('DELETE FROM final_writeup_handoff_emails');
  });

  test('insert is idempotent; a lease admits one claimant; a stale token cannot write', async () => {
    expect(await store.insertHandoffEmailIntent(intent())).toEqual({ inserted: true, refreshed: true });
    await mockPg.client.query("UPDATE final_writeup_handoff_emails SET created_at = NOW() - interval '20 days'");
    expect(await store.insertHandoffEmailIntent(intent())).toEqual({ inserted: false, refreshed: true });
    expect(Date.now() - new Date((await store.getHandoffEmail(SOURCE)).created_at).getTime()).toBeLessThan(60_000);
    const first = await store.claimHandoffEmail(SOURCE);
    expect(first).toMatchObject({ source_document_id: SOURCE, attempt_count: 1, state: 'pending' });
    expect(first.lease_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.claimHandoffEmail(SOURCE)).toBeNull();
    expect(await store.renewHandoffEmailLease(SOURCE, first.lease_token)).toMatchObject({ source_document_id: SOURCE });

    // The lease expires and a second worker takes over.
    await mockPg.client.query("UPDATE final_writeup_handoff_emails SET locked_until = NOW() - interval '1 minute'");
    expect(await store.renewHandoffEmailLease(SOURCE, first.lease_token)).toBeNull();
    const second = await store.claimHandoffEmail(SOURCE);
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(await store.recordHandoffEmailActivity(SOURCE, { emailId: EMAIL, toRecipients: ['a@wmkeck.org'], skippedRecipientCount: 0, grantProgramId: PROGRAM, leadSystemUserId: LEAD }, first.lease_token))
      .toEqual({ recorded: false });
    await store.markHandoffEmailSent(SOURCE, EMAIL, first.lease_token);
    expect(await store.getHandoffEmail(SOURCE)).toMatchObject({ state: 'pending', dynamics_email_id: null });

    expect(await store.recordHandoffEmailActivity(SOURCE, { emailId: EMAIL, toRecipients: ['a@wmkeck.org'], skippedRecipientCount: 0, grantProgramId: PROGRAM, leadSystemUserId: LEAD }, second.lease_token))
      .toEqual({ recorded: true });
    const OTHER_EMAIL = '77777777-7777-4777-8777-777777777777';
    expect(await store.recordHandoffEmailActivity(SOURCE, { emailId: OTHER_EMAIL, toRecipients: [], skippedRecipientCount: 0, grantProgramId: PROGRAM, leadSystemUserId: LEAD }, second.lease_token))
      .toEqual({ recorded: false });
    await store.releaseHandoffEmail(SOURCE, second.lease_token);
    expect(await store.getHandoffEmail(SOURCE)).toMatchObject({ lease_token: null, locked_until: null });
  });

  test('a failure keeps the row pending and claimable; sent is terminal', async () => {
    await store.insertHandoffEmailIntent(intent());
    const a = await store.claimHandoffEmail(SOURCE);
    await store.recordHandoffEmailFailure(SOURCE, 'dynamics_send_failed', a.lease_token);
    expect(await store.listPendingHandoffEmails()).toHaveLength(1);
    const b = await store.claimHandoffEmail(SOURCE);
    await store.recordHandoffEmailFinal(SOURCE, FINAL, b.lease_token);
    await store.recordHandoffEmailActivity(SOURCE, { emailId: EMAIL, toRecipients: ['a@wmkeck.org'], skippedRecipientCount: 1, grantProgramId: PROGRAM, leadSystemUserId: LEAD }, b.lease_token);
    await store.markHandoffEmailSent(SOURCE, EMAIL, b.lease_token);
    const row = await store.getHandoffEmail(SOURCE);
    expect(row).toMatchObject({
      state: 'sent', final_document_id: FINAL, dynamics_email_id: EMAIL, lease_token: null,
      to_recipients: ['a@wmkeck.org'], skipped_recipient_count: 1, locked_until: null, last_error_code: null,
    });
    expect(await store.claimHandoffEmail(SOURCE)).toBeNull();
    expect(await store.listPendingHandoffEmails()).toHaveLength(0);
  });

  test('a row that keeps failing rotates behind untried rows in recovery batches', async () => {
    const sources = ['a', 'b', 'c'].map((c, i) => `1111111${i}-1111-4111-8111-11111111111${i}`);
    for (const source of sources) {
      await store.insertHandoffEmailIntent(intent({ sourceDocumentId: source }));
      await mockPg.client.query('SELECT pg_sleep(0.01)');
    }
    // The oldest row is attempted and fails.
    const claim = await store.claimHandoffEmail(sources[0]);
    await store.recordHandoffEmailFailure(sources[0], 'handoff_email_recipient_lookup_failed', claim.lease_token);
    const batch = await store.listPendingHandoffEmails({ limit: 2 });
    expect(batch.map((row) => row.source_document_id)).toEqual([sources[1], sources[2]]);
  });

  test('only a transition_not_committed skip is reopened by a new intent', async () => {
    await store.insertHandoffEmailIntent(intent());
    await mockPg.client.query("UPDATE final_writeup_handoff_emails SET created_at = NOW() - interval '20 days'");
    const claim = await store.claimHandoffEmail(SOURCE);
    await store.markHandoffEmailSkipped(SOURCE, 'transition_not_committed', claim.lease_token);
    expect(await store.insertHandoffEmailIntent(intent({ leadSystemUserId: null }))).toEqual({ inserted: false, refreshed: true });
    const reopened = await store.getHandoffEmail(SOURCE);
    expect(reopened).toMatchObject({ state: 'pending', skip_reason: null });
    expect(Date.now() - new Date(reopened.created_at).getTime()).toBeLessThan(60_000);

    const again = await store.claimHandoffEmail(SOURCE);
    await store.markHandoffEmailSkipped(SOURCE, 'test_request_refused', again.lease_token);
    expect(await store.insertHandoffEmailIntent(intent())).toEqual({ inserted: false, refreshed: false });
    expect(await store.getHandoffEmail(SOURCE)).toMatchObject({ state: 'skipped', skip_reason: 'test_request_refused' });
    await store.reopenExpiredHandoffEmail(SOURCE);
    expect(await store.getHandoffEmail(SOURCE)).toMatchObject({ state: 'skipped' });
  });

  test('a commit reopens an intent expired as transition_not_committed', async () => {
    await store.insertHandoffEmailIntent(intent());
    const claim = await store.claimHandoffEmail(SOURCE);
    await store.markHandoffEmailSkipped(SOURCE, 'transition_not_committed', claim.lease_token);
    await store.reopenExpiredHandoffEmail(SOURCE);
    expect(await store.getHandoffEmail(SOURCE)).toMatchObject({ state: 'pending', skip_reason: null });
  });

  test('constraints: sent needs its email and Final; one row per Final; skip needs a reason; lease fields pair', async () => {
    await store.insertHandoffEmailIntent(intent());
    await expect(mockPg.client.query(
      "UPDATE final_writeup_handoff_emails SET state = 'sent', sent_at = NOW() WHERE source_document_id = $1", [SOURCE],
    )).rejects.toThrow(/final_writeup_handoff_email_sent_shape/);
    await expect(mockPg.client.query(
      "UPDATE final_writeup_handoff_emails SET state = 'skipped' WHERE source_document_id = $1", [SOURCE],
    )).rejects.toThrow(/final_writeup_handoff_email_skip_shape/);
    const claim = await store.claimHandoffEmail(SOURCE);
    await store.recordHandoffEmailFinal(SOURCE, FINAL, claim.lease_token);
    await store.insertHandoffEmailIntent(intent({ sourceDocumentId: OTHER_SOURCE }));
    await expect(mockPg.client.query(
      'UPDATE final_writeup_handoff_emails SET final_document_id = $1 WHERE source_document_id = $2', [FINAL, OTHER_SOURCE],
    )).rejects.toThrow(/uq_final_writeup_handoff_emails_final/);
    await expect(mockPg.client.query(
      'UPDATE final_writeup_handoff_emails SET lease_token = gen_random_uuid(), locked_until = NULL WHERE source_document_id = $1', [OTHER_SOURCE],
    )).rejects.toThrow(/final_writeup_handoff_email_lease_shape/);
  });
});
