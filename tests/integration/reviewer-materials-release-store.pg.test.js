/** @jest-environment node */
// Explicit fixture URL only. Never discovers application/Claude database credentials.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Pool } from 'pg';
import * as releases from '../../lib/services/reviewer-engagement/materials-release-store';
let mockSql;
jest.mock('@vercel/postgres', () => ({ sql: (...args) => mockSql(...args) }));
const URL = process.env.TEST_REQUEST_LEDGER_TEST_URL;
const suite = URL ? describe : describe.skip;
const SUGGESTION = '11111111-1111-4111-8111-111111111111', REQUEST = '22222222-2222-4222-8222-222222222222';
suite('materials release claim (real Postgres, migration 091)', () => {
  let pool, jobId, staffId;
  const schema = `materials_${crypto.randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    const parsed = new global.URL(URL); if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/ledger') throw new Error('An isolated local ledger fixture is required');
    pool = new Pool({ connectionString: URL, max: 8, options: `-c search_path=${schema}` }); await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query('CREATE TABLE user_profiles (id SERIAL PRIMARY KEY)');
    await pool.query(fs.readFileSync('lib/db/migrations/024_reviewer_acceptance_jobs.sql', 'utf8'));
    await pool.query(fs.readFileSync('lib/db/migrations/091_reviewer_materials_releases.sql', 'utf8'));
    mockSql = (strings, ...values) => pool.query(strings.reduce((s, part, i) => s + part + (i < values.length ? `$${i + 1}` : ''), ''), values);
    staffId = (await pool.query('INSERT INTO user_profiles DEFAULT VALUES RETURNING id')).rows[0].id;
    jobId = (await pool.query("INSERT INTO reviewer_acceptance_jobs (acceptance_key,suggestion_id,request_id,accepted_at,status,payload) VALUES ($1,$2,$3,NOW(),'queued','{}') RETURNING id", [crypto.randomUUID(), SUGGESTION, REQUEST])).rows[0].id;
  });
  beforeEach(async () => { await pool.query('TRUNCATE reviewer_materials_releases'); });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); } });
  const auto = () => releases.claimMaterialsRelease({ suggestionId: SUGGESTION, requestId: REQUEST, source: 'acceptance', jobId });
  const manual = () => releases.claimMaterialsRelease({ suggestionId: SUGGESTION, requestId: REQUEST, source: 'manual', actorProfileId: staffId });

  test('automatic and manual release at the same moment: exactly one owns it', async () => {
    const results = await Promise.all([auto(), manual(), auto(), manual()]);
    expect(results.filter(r => r.claimed)).toHaveLength(1);
    const owner = results.find(r => r.claimed).release;
    for (const refused of results.filter(r => !r.claimed)) expect(refused.release.lease_token).toBe(owner.lease_token);
  });

  test('the happy path walks claimed → link_minted → sent → recorded', async () => {
    const { release } = await auto();
    expect(await releases.markMaterialsLinkMinted(SUGGESTION, crypto.randomUUID())).toBeNull();
    expect((await releases.markMaterialsLinkMinted(SUGGESTION, release.lease_token)).state).toBe('link_minted');
    expect(await releases.recordMaterialsRelease(SUGGESTION)).toBeNull();
    expect((await releases.markMaterialsSent(SUGGESTION, release.lease_token)).state).toBe('sent');
    const recorded = await releases.recordMaterialsRelease(SUGGESTION);
    expect(recorded).toMatchObject({ state: 'recorded', lease_token: null });
    expect(await releases.recordMaterialsRelease(SUGGESTION)).toBeNull();
    expect(await releases.reclaimMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId })).toBeNull();
  });

  test('an expired lease cannot mint, and an abandoned or stopped release is only reclaimed by staff', async () => {
    const { release } = await releases.claimMaterialsRelease({ suggestionId: SUGGESTION, requestId: REQUEST, source: 'acceptance', jobId, leaseMs: -1000 });
    expect(await releases.markMaterialsLinkMinted(SUGGESTION, release.lease_token)).toBeNull();
    const again = await releases.reclaimMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId });
    expect(again).toMatchObject({ state: 'claimed', attempts: 2, source: 'acceptance', actor_profile_id: staffId });
    expect(again.lease_token).not.toBe(release.lease_token);
    expect(await releases.markMaterialsReleaseStopped(SUGGESTION, release.lease_token, 'failed', 'x')).toBeNull();
    expect((await releases.markMaterialsReleaseStopped(SUGGESTION, again.lease_token, 'uncertain', 'send_unconfirmed')).state).toBe('uncertain');
    expect(await releases.markMaterialsSent(SUGGESTION, again.lease_token)).toBeNull();
    expect((await releases.reclaimMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId })).attempts).toBe(3);
  });

  test('a normal send retakes only a failed release; staff close only a sent one', async () => {
    const { release } = await manual();
    expect(await releases.retakeFailedMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId })).toBeNull();
    await releases.markMaterialsReleaseStopped(SUGGESTION, release.lease_token, 'uncertain', 'send_unconfirmed');
    expect(await releases.retakeFailedMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId })).toBeNull();
    await pool.query("UPDATE reviewer_materials_releases SET state = 'failed'");
    const retaken = await releases.retakeFailedMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId });
    expect(retaken).toMatchObject({ state: 'claimed', attempts: 2, error_code: null });
    expect(await releases.closeSentMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId })).toBeNull();
    await releases.markMaterialsLinkMinted(SUGGESTION, retaken.lease_token);
    await releases.markMaterialsSent(SUGGESTION, retaken.lease_token);
    const closed = await releases.closeSentMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId });
    expect(closed).toMatchObject({ state: 'recorded', error_code: 'staff_marked_delivered', lease_token: null });
    expect(closed.recorded_at).not.toBeNull();
  });

  test('stuck releases: stopped, abandoned past the lease, or sent but unrecorded for 30 minutes', async () => {
    const other = '33333333-3333-4333-8333-333333333333', live = '44444444-4444-4444-8444-444444444444', sent = '55555555-5555-4555-8555-555555555555';
    const { release } = await auto();
    await releases.markMaterialsReleaseStopped(SUGGESTION, release.lease_token, 'failed', 'send_failed');
    await releases.claimMaterialsRelease({ suggestionId: other, requestId: REQUEST, source: 'manual', actorProfileId: staffId, leaseMs: -1000 });
    await releases.claimMaterialsRelease({ suggestionId: live, requestId: REQUEST, source: 'manual', actorProfileId: staffId });
    await pool.query("INSERT INTO reviewer_materials_releases (suggestion_id,request_id,source,actor_profile_id,state,sent_at) VALUES ($1,$2,'manual',$3,'sent',NOW() - INTERVAL '31 minutes')", [sent, REQUEST, staffId]);
    const stuck = (await releases.listStuckMaterialsReleases()).map(r => r.suggestion_id).sort();
    expect(stuck).toEqual([SUGGESTION, other, sent].sort());
  });

  test('a live claim is not reclaimable, and the table refuses inconsistent rows', async () => {
    await manual();
    expect(await releases.reclaimMaterialsRelease({ suggestionId: SUGGESTION, actorProfileId: staffId })).toBeNull();
    await expect(pool.query("INSERT INTO reviewer_materials_releases (suggestion_id,request_id,source) VALUES ($1,$2,'acceptance')", [crypto.randomUUID(), REQUEST])).rejects.toThrow();
    await expect(pool.query("INSERT INTO reviewer_materials_releases (suggestion_id,request_id,source) VALUES ($1,$2,'manual')", [crypto.randomUUID(), REQUEST])).rejects.toThrow();
    await expect(pool.query("INSERT INTO reviewer_materials_releases (suggestion_id,request_id,source,actor_profile_id,state) VALUES ($1,$2,'manual',$3,'sent')", [crypto.randomUUID(), REQUEST, staffId])).rejects.toThrow();
  });
});
