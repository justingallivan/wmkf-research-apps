/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';

/**
 * Live-Postgres proof for the leadership daily digest ledger (migration 073,
 * lib/services/final-writeup/leadership-digest-store.js): one row per
 * (recipient, day), membership frozen at insert, lease exclusivity and token
 * fencing, "already told" only from accepted rows, and the CHECK shapes.
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
  throw new Error('Refusing to run the leadership digest proof against the shared Production/Preview database.');
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
  path.join(process.cwd(), 'lib/db/migrations/073_final_writeup_leadership_digests.sql'),
  'utf8',
);

const RECIPIENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '11111111-1111-4111-8111-111111111112';
const DAY = '2026-10-08';
const FINAL_A = '55555555-5555-4555-8555-55555555555a';
const FINAL_B = '55555555-5555-4555-8555-55555555555b';
const EMAIL = '66666666-6666-4666-8666-666666666666';
const item = (finalDocumentId) => ({ finalDocumentId, requestNumber: '1003001' });
const claimInput = (overrides = {}) => ({
  recipientSystemUserId: RECIPIENT, digestDay: DAY, recipientAddress: 'cso@wmkeck.org',
  membership: [item(FINAL_A)], ...overrides,
});

describeIf('final_writeup_leadership_digests ledger (live Postgres, migration 073)', () => {
  const schema = `leadership_digest_${crypto.randomBytes(4).toString('hex')}`;
  let store;

  beforeAll(async () => {
    mockPg.client = new Client({ connectionString: TEST_URL });
    await mockPg.client.connect();
    await mockPg.client.query(`CREATE SCHEMA ${schema}`);
    await mockPg.client.query(`SET search_path TO ${schema}`);
    await mockPg.client.query(MIGRATION);
    store = await import('../../lib/services/final-writeup/leadership-digest-store.js');
  });

  afterAll(async () => {
    if (!mockPg.client) return;
    await mockPg.client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await mockPg.client.end();
  });

  beforeEach(async () => {
    await mockPg.client.query('DELETE FROM final_writeup_leadership_digests');
  });

  test('a live lease admits one claimant; a re-claim keeps the frozen membership and fences the old token', async () => {
    const first = await store.claimLeadershipDigest(claimInput());
    expect(first.claimed).toBe(true);
    expect(first.row).toMatchObject({ attempt_count: 1, recipient_address: 'cso@wmkeck.org' });
    const blocked = await store.claimLeadershipDigest(claimInput({ membership: [item(FINAL_B)] }));
    expect(blocked.claimed).toBe(false);

    await mockPg.client.query("UPDATE final_writeup_leadership_digests SET locked_until = NOW() - interval '1 minute'");
    const second = await store.claimLeadershipDigest(claimInput({ membership: [item(FINAL_B)] }));
    expect(second.claimed).toBe(true);
    expect(second.row.attempt_count).toBe(2);
    expect(second.row.membership).toEqual([item(FINAL_A)]);
    expect(second.row.lease_token).not.toBe(first.row.lease_token);

    expect(await store.renewLeadershipDigestLease(RECIPIENT, DAY, first.row.lease_token)).toBe(0);
    expect(await store.recordLeadershipDigestActivity(RECIPIENT, DAY, first.row.lease_token, EMAIL)).toBe(0);
    expect(await store.markLeadershipDigestAccepted(RECIPIENT, DAY, second.row.lease_token)).toBe(0);
    expect(await store.recordLeadershipDigestActivity(RECIPIENT, DAY, second.row.lease_token, EMAIL)).toBe(1);
    expect(await store.recordLeadershipDigestActivity(RECIPIENT, DAY, second.row.lease_token, EMAIL)).toBe(0);
    expect(await store.markLeadershipDigestAccepted(RECIPIENT, DAY, second.row.lease_token)).toBe(1);

    const accepted = await store.getLeadershipDigest(RECIPIENT, DAY);
    expect(accepted).toMatchObject({ lease_token: null, locked_until: null });
    expect(accepted.accepted_at).toBeTruthy();
    expect((await store.claimLeadershipDigest(claimInput())).claimed).toBe(false);
  });

  test('only accepted digests count as told, per recipient and since the given day', async () => {
    const accepted = await store.claimLeadershipDigest(claimInput({ membership: [item(FINAL_A)] }));
    await store.recordLeadershipDigestActivity(RECIPIENT, DAY, accepted.row.lease_token, EMAIL);
    await store.markLeadershipDigestAccepted(RECIPIENT, DAY, accepted.row.lease_token);
    const failed = await store.claimLeadershipDigest(claimInput({ digestDay: '2026-10-09', membership: [item(FINAL_B)] }));
    expect(await store.recordLeadershipDigestFailure(RECIPIENT, '2026-10-09', failed.row.lease_token, 'x')).toBe(1);
    await store.claimLeadershipDigest(claimInput({ recipientSystemUserId: OTHER, membership: [item(FINAL_B)] }));

    expect(await store.listToldFinalDocumentIds(RECIPIENT, '2026-10-01')).toEqual([FINAL_A]);
    expect(await store.listToldFinalDocumentIds(RECIPIENT, '2026-10-09')).toEqual([]);
    expect(await store.listToldFinalDocumentIds(OTHER, '2026-10-01')).toEqual([]);
  });

  test('a failure releases the lease; the retry reclaims with the row\'s own frozen membership', async () => {
    const first = await store.claimLeadershipDigest(claimInput());
    expect(await store.recordLeadershipDigestFailure(RECIPIENT, DAY, first.row.lease_token, 'leadership_digest_send_failed')).toBe(1);
    const row = await store.getLeadershipDigest(RECIPIENT, DAY);
    expect(row).toMatchObject({ lease_token: null, last_error_code: 'leadership_digest_send_failed', accepted_at: null });
    // The service's retry input: the stored row's membership and address (Codex review, 2026-10-07).
    const retry = await store.claimLeadershipDigest(claimInput({
      membership: row.membership, recipientAddress: row.recipient_address,
    }));
    expect(retry).toMatchObject({ claimed: true, row: { attempt_count: 2, membership: [item(FINAL_A)] } });
    // A null membership is refused before ON CONFLICT can reclaim the row.
    await mockPg.client.query("UPDATE final_writeup_leadership_digests SET lease_token = NULL, locked_until = NULL");
    await expect(store.claimLeadershipDigest(claimInput({ membership: null }))).rejects.toThrow(/membership_shape/);
  });

  test('CHECK shapes refuse an empty membership and an accepted row without an activity', async () => {
    await expect(store.claimLeadershipDigest(claimInput({ membership: [] }))).rejects.toThrow(/membership_shape/);
    await store.claimLeadershipDigest(claimInput());
    await expect(mockPg.client.query(
      'UPDATE final_writeup_leadership_digests SET accepted_at = NOW(), lease_token = NULL, locked_until = NULL',
    )).rejects.toThrow(/accepted_shape/);
  });
});
