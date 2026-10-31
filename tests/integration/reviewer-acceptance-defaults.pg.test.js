/** @jest-environment node */
// Explicit fixture URL only. Never discovers application/Claude database credentials.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Pool } from 'pg';
import * as store from '../../lib/services/reviewer-acceptance-job-service';
import { processReviewerAcceptanceJob, drainReviewerAcceptanceJobs } from '../../lib/services/reviewer-acceptance-drain';
let mockSql;
jest.mock('@vercel/postgres', () => ({ sql: (...args) => mockSql(...args) }));
jest.mock('../../lib/services/alert-service', () => ({ __esModule: true, default: { autoResolve: jest.fn(async () => 0) } }));
jest.mock('../../lib/services/operational-event-service', () => ({ __esModule: true, default: { markRecovered: jest.fn(async () => 0), markSuperseded: jest.fn(async () => 0) } }));
const URL = process.env.TEST_REQUEST_LEDGER_TEST_URL;
const suite = URL ? describe : describe.skip;
const REQUEST = '22222222-2222-4222-8222-222222222222', SUGGESTION = '11111111-1111-4111-8111-111111111111';
const suggestion = { wmkf_appreviewersuggestionid: SUGGESTION, _wmkf_request_value: REQUEST, wmkf_accepted: true, wmkf_declined: false, wmkf_honorariumoptout: true, wmkf_revieweremail: 'reviewer@example.org' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
suite('acceptance preparation recovery and concurrent leases (real Postgres)', () => {
  let pool;
  const schema = `acceptance_${crypto.randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    const parsed = new global.URL(URL); if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/ledger') throw new Error('An isolated local ledger fixture is required');
    pool = new Pool({ connectionString: URL, max: 8, options: `-c search_path=${schema}` }); await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(fs.readFileSync('lib/db/migrations/024_reviewer_acceptance_jobs.sql', 'utf8'));
    mockSql = (strings, ...values) => pool.query(strings.reduce((s, part, i) => s + part + (i < values.length ? `$${i + 1}` : ''), ''), values);
  });
  beforeEach(async () => { await pool.query('TRUNCATE reviewer_acceptance_jobs RESTART IDENTITY'); });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); } });
  async function seed() {
    const { rows } = await pool.query("INSERT INTO reviewer_acceptance_jobs (acceptance_key,suggestion_id,request_id,accepted_at,status,payload) VALUES ($1,$2,$3,NOW(),'queued',$4) RETURNING *", [crypto.randomUUID(), SUGGESTION, REQUEST, JSON.stringify({ suggestion, request: { akoya_requestid: REQUEST }, reviewer: { wmkf_name: 'Reviewer' }, optedOut: true })]); return rows[0];
  }
  function deps() {
    return { jobs: store, switchesReady: () => true, isolationEnabled: () => false,
      suggestions: { getForAcceptanceDrain: jest.fn(async () => ({ ...suggestion })) },
      potentialReviewers: { getById: jest.fn(async () => ({ wmkf_name: 'Reviewer' })) },
      // No proposal PDF: materials are held and the confirmation path under test runs (D49).
      materials: { get: jest.fn(async () => null), preflight: jest.fn(async () => ({ ok: true, fileCount: 0 })) },
      listStuckMaterialsReleases: jest.fn(async () => []), ensureAcceptedContact: jest.fn(async () => ({ contactId: 'fixture' })),
      captureOrcid: jest.fn(async () => ({ persisted: true })), captureIdentity: jest.fn(), syncNameTitle: jest.fn(),
      alertEmail: jest.fn(), alertAffiliation: jest.fn(), resolveAffiliation: jest.fn(), autoLinkAccount: jest.fn(),
      readConfirmationRequest: jest.fn(async () => ({ akoya_requestid: REQUEST })),
      prepareAcceptanceEmail: jest.fn(async () => ({ ok: true, message: { subject: 'Subject A', body: 'Body A' } })),
      sendPreparedAcceptanceEmail: jest.fn(async () => ({ sent: true })), notify: jest.fn(), quota: jest.fn() };
  }
  test('preparation refusal persists without claim; repaired next drain sends once and completes', async () => {
    await seed(); const d = deps(); d.prepareAcceptanceEmail.mockResolvedValueOnce({ ok: false, reason: 'preference_unavailable' });
    expect((await drainReviewerAcceptanceJobs({ deps: d })).retried).toBe(1);
    let row = (await pool.query('SELECT * FROM reviewer_acceptance_jobs')).rows[0]; expect(row.steps.acceptance_confirmation).not.toHaveProperty('claimedAt'); expect(row.attempts).toBe(1);
    expect(d.sendPreparedAcceptanceEmail).not.toHaveBeenCalled(); await pool.query('UPDATE reviewer_acceptance_jobs SET next_attempt_at=NOW()');
    expect((await drainReviewerAcceptanceJobs({ deps: d })).completed).toBe(1); row = (await pool.query('SELECT * FROM reviewer_acceptance_jobs')).rows[0]; expect(row.steps.acceptance_confirmation.sentAt).toEqual(expect.any(String));
    expect((await drainReviewerAcceptanceJobs({ deps: d })).claimed).toBe(0); expect(d.sendPreparedAcceptanceEmail).toHaveBeenCalledTimes(1);
  });
  test('expired worker prepares A; replacement lease prepares B; old token cannot claim or send', async () => {
    await seed(); const [a] = await store.claimReviewerAcceptanceJobs(); const gate = deferred(), arrived = deferred();
    const dA = deps(); dA.prepareAcceptanceEmail.mockImplementation(async () => { arrived.resolve(); await gate.promise; return { ok: true, message: { subject: 'Subject A', body: 'Body A' } }; });
    const running = processReviewerAcceptanceJob(a, dA).then(() => null, error => error); await arrived.promise;
    await pool.query("UPDATE reviewer_acceptance_jobs SET locked_until=NOW()-INTERVAL '1 second'"); const [b] = await store.claimReviewerAcceptanceJobs(); expect(b.lease_token).not.toBe(a.lease_token);
    const dB = deps(); dB.prepareAcceptanceEmail.mockResolvedValue({ ok: true, message: { subject: 'Subject B', body: 'Body B' } }); await processReviewerAcceptanceJob(b, dB); gate.resolve();
    expect((await running).code).toBe('reviewer_acceptance_lease_lost'); expect(dA.sendPreparedAcceptanceEmail).not.toHaveBeenCalled(); expect(dB.sendPreparedAcceptanceEmail).toHaveBeenCalledTimes(1);
    expect(dB.sendPreparedAcceptanceEmail.mock.calls[0][0].message).toEqual({ subject: 'Subject B', body: 'Body B' });
  });
  test('eight preclaim failures exhaust finite attempts and emit one terminal warning; no claim lands', async () => {
    await seed(); const d = deps(); d.prepareAcceptanceEmail.mockResolvedValue({ ok: false, reason: 'sender_unavailable' });
    for (let i = 0; i < 8; i++) { await drainReviewerAcceptanceJobs({ deps: d }); await pool.query('UPDATE reviewer_acceptance_jobs SET next_attempt_at=NOW()'); }
    const row = (await pool.query('SELECT * FROM reviewer_acceptance_jobs')).rows[0]; expect(row.status).toBe('failed'); expect(row.attempts).toBe(8); expect(row.steps.acceptance_confirmation).not.toHaveProperty('claimedAt'); expect(d.sendPreparedAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.notify.mock.calls.filter(([n]) => n.autoResolveKey?.endsWith(':terminal'))).toHaveLength(1);
  });
});
