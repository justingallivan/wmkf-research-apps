/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';
import { SITE_VISIT_MATERIALS_CHECKLIST } from '../../shared/config/siteVisitMaterials';

/**
 * Live-Postgres proof that the automatic materials reminder's claim is a
 * compare-and-swap on the contacts snapshot
 * (docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md reader 5): a
 * contacts-only concurrent update between the sweep's read and its claim, with
 * `last_reminder_at` unchanged and every other eligibility predicate still
 * true, loses the claim and sends nothing. Removing only the
 * `contacts = expectedContacts` predicate makes this test fail.
 *
 * SKIPPED by default. Set TEST_REQUEST_LEDGER_TEST_URL to a scratch/local
 * Postgres database (NEVER the shared Production/Preview POSTGRES_URL). The
 * test works in its own schema and drops it afterwards.
 */
const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  // CI runs this suite against a PostgreSQL service and must never skip it.
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the materials claim proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;

// The store's `sql` tag, executed as a parameterized query on the scratch client.
const mockPg = { client: null };
jest.mock('@vercel/postgres', () => ({
  sql: (strings, ...values) => mockPg.client.query(
    strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''),
    values,
  ),
}));

const MIGRATIONS = ['042_site_visit_material_collections.sql', '044_site_visit_material_slot_leases.sql']
  .map((file) => fs.readFileSync(path.join(process.cwd(), 'lib/db/migrations', file), 'utf8'));

describeIf('automatic reminder claim (live Postgres)', () => {
  const schema = `svm_claim_${crypto.randomBytes(4).toString('hex')}`;
  let store;
  let sweepMaterialsReminders;

  beforeAll(async () => {
    mockPg.client = new Client({ connectionString: TEST_URL });
    await mockPg.client.connect();
    await mockPg.client.query(`CREATE SCHEMA ${schema}`);
    await mockPg.client.query(`SET search_path TO ${schema}`);
    for (const migration of MIGRATIONS) await mockPg.client.query(migration);
    store = await import('../../lib/services/site-visit-materials/collection-store.js');
    ({ sweepMaterialsReminders } = await import('../../lib/services/site-visit-materials/reminder-sweep.js'));
  });

  afterAll(async () => {
    if (!mockPg.client) return;
    await mockPg.client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await mockPg.client.end();
  });

  const NOW = new Date('2026-10-06T15:00:00Z');
  const A = { pi: { role: 'pi', name: 'Pat', email: 'pi@example.edu' }, liaison: { role: 'liaison', name: 'Former', email: 'former@example.edu' } };
  const B = { ...A, liaison: { role: 'liaison', name: 'Edited', email: 'edited@example.edu' }, liaisonStatus: 'found' };
  const C = { ...A, liaison: { role: 'liaison', name: 'Current', email: 'current@example.edu' }, liaisonStatus: 'found' };

  async function insertDueCollection() {
    const id = crypto.randomUUID();
    await mockPg.client.query(
      `INSERT INTO site_visit_material_collections
         (id, request_id, site_visit_activity_id, status, due_at, closes_at, checklist, contacts,
          jti, token_digest, token_ciphertext, created_by, invited_at)
       VALUES ($1, $2, $3, 'open', '2026-10-05T19:00:00Z', '2026-10-14T19:00:00Z', $8::jsonb, $4::jsonb,
               $5, $6, 'sealed', $7, '2026-09-20T00:00:00Z')`,
      [id, crypto.randomUUID(), crypto.randomUUID(), JSON.stringify(A), crypto.randomUUID(),
        crypto.randomBytes(32).toString('hex'), crypto.randomUUID(),
        JSON.stringify(SITE_VISIT_MATERIALS_CHECKLIST.map((item) => ({ ...item, waived: false })))],
    );
    return id;
  }

  async function readRow(id) {
    const { rows } = await mockPg.client.query('SELECT * FROM site_visit_material_collections WHERE id = $1', [id]);
    return rows[0];
  }

  function sweepDeps({ id, onResolveContacts }) {
    const sendReminder = jest.fn(async () => 'email-1');
    return {
      sendReminder,
      deps: {
        schemaReady: () => true,
        listDue: async (now) => (await store.listCollectionsDueForAutomaticReminder(now)).filter((row) => row.id === id),
        claim: store.claimAutomaticReminder,
        attachEmailId: store.attachReminderEmailId,
        getRequest: async (requestId) => ({ akoya_requestid: requestId, akoya_requestnum: '1003222' }),
        resolveContacts: async () => {
          await onResolveContacts?.();
          return C;
        },
        findDocumentsByRequest: async () => ({ records: [] }),
        findActiveSiteVisit: async () => null,
        getSender: async () => ({ email: 'pc@wmkeck.org', systemUserId: 'pc' }),
        canReadLink: () => true,
        prepareReminder: async () => ({ subject: 's', bodyText: 'b', url: 'https://apps.test/m' }),
        sendReminder,
        now: () => NOW,
      },
    };
  }

  test('a contacts-only update between the read and the claim loses the claim; nothing is sent', async () => {
    const id = await insertDueCollection();
    const { deps, sendReminder } = sweepDeps({
      id,
      // A concurrent writer changes only the contacts; last_reminder_at stays null.
      onResolveContacts: async () => expect(await store.updateContacts(id, A, B)).not.toBeNull(),
    });

    const result = await sweepMaterialsReminders({}, deps);

    expect(result).toMatchObject({ eligible: 1, claimLost: 1, sent: 0 });
    expect(sendReminder).not.toHaveBeenCalled();
    const row = await readRow(id);
    expect(row.contacts).toEqual(B);
    expect(row.last_reminder_at).toBeNull();
    expect(row.reminder_count).toBe(0);
  });

  test('an unchanged snapshot claims, persists the refreshed contacts with the claim, and sends from them', async () => {
    const id = await insertDueCollection();
    const { deps, sendReminder } = sweepDeps({ id });

    const result = await sweepMaterialsReminders({}, deps);

    expect(result).toMatchObject({ claimLost: 0, sent: 1 });
    expect(sendReminder.mock.calls[0][0].row.contacts).toEqual(C);
    const row = await readRow(id);
    expect(row.contacts).toEqual(C);
    expect(row.reminder_count).toBe(1);
    expect(row.last_reminder_at).not.toBeNull();
  });
});
