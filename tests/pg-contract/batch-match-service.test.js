/**
 * Contract test for lib/services/expertise-finder/batch-match-service.js —
 * Stage 3 item 5 (wave 2 slice A, last file), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * Only two statements in this file touch the database (the rest is
 * SharePoint/Graph/Claude orchestration): the `expertise_roster` read and
 * the `expertise_matches` insert. Everything else is mocked exactly as
 * tests/unit/batch-match-service.test.js already mocks it (pdf-parse, the
 * SharePoint location adapter, GraphService, LLMClient, usage-logger) so
 * `batchMatch` runs its real pipeline end-to-end against the REAL database
 * for those two statements, without needing live SharePoint/Graph/Claude.
 * `getModelForApp`/`getFallbackModelForApp` (shared/config/baseConfig) are
 * NOT mocked -- `modelUsed` in the source comes from those, never from the
 * mocked LLMClient's `.model` field, so this test reads the real resolved
 * model name back instead of asserting a value it does not control.
 *
 * `@vercel/postgres` itself is intentionally left unmocked here (unlike the
 * unit test) so `sql` resolves through jest.pg-contract.config.js's
 * moduleNameMapper to the pg shim and reaches the real container -- both
 * before and after the driver-import -> lib/postgres/client swap (the seam
 * requires '@vercel/postgres' internally, which the same mapper intercepts).
 *
 * expertise_roster has no per-request scoping column, so an `is_active =
 * true` row inserted by one test would otherwise leak into the next test's
 * roster read; afterEach deletes every roster/match row this file created
 * so far and re-tracks nothing across tests.
 *
 * Copies the template shape (tests/pg-contract/explorer-store.test.js):
 * PG_CONTRACT_URL gating, a direct pg Client for setup/verification/cleanup,
 * assertNoOpenTransactionAnywhere, bounded lock_timeout/statement_timeout,
 * child-first deletes in try/finally, and a Promise.allSettled close of
 * both the direct client and the shim pool.
 *
 * @jest-environment node
 */

jest.mock('pdf-parse', () => jest.fn());
jest.mock('../../lib/dataverse/adapters/sharepoint-document-location.js', () => ({
  findByRegardingObject: jest.fn(),
  findByParentIds: jest.fn(),
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { listFiles: jest.fn(), downloadFileByPath: jest.fn() },
}));
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: jest.fn(),
}));
jest.mock('../../lib/utils/usage-logger', () => ({
  logUsage: jest.fn(),
  estimateCostCents: jest.fn(),
}));

import crypto from 'node:crypto';
import { Client } from 'pg';
import { getPool as getShimPool } from './support/vercel-postgres-pg-shim.js';
import pdf from 'pdf-parse';
import * as locAdapter from '../../lib/dataverse/adapters/sharepoint-document-location.js';
import { GraphService } from '../../lib/services/graph-service';
import { LLMClient } from '../../lib/services/llm-client';
import { estimateCostCents } from '../../lib/utils/usage-logger';
import { getModelForApp } from '../../shared/config/baseConfig';
import { batchMatch } from '../../lib/services/expertise-finder/batch-match-service';

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('expertise-finder/batch-match-service: contract', () => {
  let client;
  const insertedUserProfileIds = [];
  let rosterIdsThisTest = [];
  let matchIdsThisTest = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLAUDE_API_KEY = 'contract-test-key';
    rosterIdsThisTest = [];
    matchIdsThisTest = [];
  });

  afterEach(async () => {
    // expertise_roster has no per-run scoping column: clean it (and any
    // match row this test produced) after every test so the next test's
    // unfiltered `is_active = true` read never sees a prior test's rows.
    if (matchIdsThisTest.length) {
      await client.query('DELETE FROM expertise_matches WHERE id = ANY($1::int[])', [matchIdsThisTest]);
    }
    if (rosterIdsThisTest.length) {
      await client.query('DELETE FROM expertise_roster WHERE id = ANY($1::int[])', [rosterIdsThisTest]);
    }
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedUserProfileIds.length) {
        // Safety net: delete any expertise_matches row a failed assertion
        // left un-tracked before deleting the user_profiles rows they FK
        // to, so a mid-test failure never blocks this cleanup.
        await client.query('DELETE FROM expertise_matches WHERE user_profile_id = ANY($1::int[])', [insertedUserProfileIds]);
        await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedUserProfileIds]);
      }
    } catch (err) {
      deleteError = err;
    } finally {
      await Promise.allSettled([client.end(), getShimPool().end()]);
    }
    if (deleteError) throw deleteError;
  });

  async function assertNoOpenTransactionAnywhere() {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
    );
    expect(rows[0].n).toBe(0);
  }

  async function insertUserProfile() {
    const name = `batch_match_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(`INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`, [name]);
    const id = rows[0].id;
    insertedUserProfileIds.push(id);
    return id;
  }

  async function insertRosterMember({ name, isActive }) {
    const { rows } = await client.query(
      `INSERT INTO expertise_roster (name, role_type, is_active) VALUES ($1, 'reviewer', $2) RETURNING id`,
      [name, isActive]
    );
    const id = rows[0].id;
    rosterIdsThisTest.push(id);
    return id;
  }

  function primeExternalMocks({ proposalText = 'A'.repeat(150), staffFileName = 'Phase_I_Staff_Version.pdf' } = {}) {
    locAdapter.findByRegardingObject.mockResolvedValue({
      records: [{ relativeurl: '/sites/x/folder', _parentsiteorlocation_value: 'parent-1' }],
    });
    locAdapter.findByParentIds.mockResolvedValue({ records: [{ relativeurl: 'akoya_request' }] });
    GraphService.listFiles.mockResolvedValue([{ name: staffFileName }]);
    GraphService.downloadFileByPath.mockResolvedValue({ buffer: Buffer.from('pdf-bytes') });
    pdf.mockResolvedValue({ text: proposalText });
  }

  function primeClaude(responseText) {
    LLMClient.mockImplementation(() => ({
      complete: jest.fn().mockResolvedValue({
        content: [{ text: responseText }],
        usage: { inputTokens: 111, outputTokens: 222 },
        model: 'claude-contract-model-unused-by-source',
      }),
    }));
  }

  test('batchMatch persists to expertise_matches with every bound column, reading only is_active roster rows', async () => {
    const profileId = await insertUserProfile();
    // Anti-correlated: the ACTIVE row sorts LAST alphabetically by name
    // ("zz_active...") and the INACTIVE row sorts FIRST ("aa_inactive...")
    // -- a mutant that drops the `is_active = true` filter would pull in
    // the inactive row too, changing rosterSize below in a way the
    // assertion would not miss by coincidence.
    await insertRosterMember({ name: 'aa_inactive_contract', isActive: false });
    await insertRosterMember({ name: 'zz_active_contract', isActive: true });

    primeExternalMocks();
    primeClaude('```json\n{"proposal_summary":{"title":"Contract Proposal Title"}}\n```');
    estimateCostCents.mockReturnValue(12.3456);

    const args = { requestId: 'req-contract-1', requestNumber: 'R-CONTRACT-1', profileId };
    const result = await batchMatch(args);

    expect(result.success).toBe(true);
    // rosterSize must reflect ONLY the active row (kills the dropped-filter
    // mutant described above).
    expect(result.metadata.rosterSize).toBe(1);
    matchIdsThisTest.push(result.matchId);

    const { rows } = await client.query('SELECT * FROM expertise_matches WHERE id = $1', [result.matchId]);
    const row = rows[0];
    const expectedModel = getModelForApp('expertise-finder');
    expect(row.user_profile_id).toBe(profileId);
    expect(row.proposal_title).toBe('Contract Proposal Title');
    expect(row.proposal_filename).toBe('Phase_I_Staff_Version.pdf');
    expect(row.proposal_text_hash).toBe(
      crypto.createHash('sha256').update('A'.repeat(150)).digest('hex').substring(0, 64)
    );
    expect(row.match_results).toMatchObject({ proposal_summary: { title: 'Contract Proposal Title' } });
    // modelUsed comes from getModelForApp/getFallbackModelForApp, never
    // from the mocked LLMClient response's `.model` field -- asserting the
    // REAL resolved value (not a value this test controls) is itself part
    // of the contract: a mutant that swapped in result.model instead would
    // pass a naive assertion of 'claude-contract-model-unused-by-source'
    // but fail this one.
    expect(row.model_used).toBe(expectedModel);
    expect(row.input_tokens).toBe(111);
    expect(row.output_tokens).toBe(222);
    expect(Number(row.estimated_cost_cents)).toBeCloseTo(12.3456, 4);
    await assertNoOpenTransactionAnywhere();
  });

  // DISCRIMINATING: proposal_summary.title is intentionally OMITTED from
  // the Claude response here, so buildRow's `matchResults.proposal_summary?.title
  // || requestNumber || 'Untitled'` fallback chain must store requestNumber,
  // not 'Untitled' and not undefined/null. requestNumber below
  // ('R-FALLBACK-CONTRACT') is distinct from both other candidates in the
  // chain, so a mutant that picks the wrong operand (e.g. always
  // 'Untitled', or drops the requestNumber fallback entirely) is caught by
  // stored VALUE, not by accidental agreement between candidates.
  test('DISCRIMINATING: a title-less Claude response falls back to requestNumber, never "Untitled"', async () => {
    const profileId = await insertUserProfile();
    await insertRosterMember({ name: 'active_for_fallback_test', isActive: true });

    primeExternalMocks({ proposalText: 'B'.repeat(150) });
    primeClaude('{}');
    estimateCostCents.mockReturnValue(0);

    const args = { requestId: 'req-contract-2', requestNumber: 'R-FALLBACK-CONTRACT', profileId };
    const result = await batchMatch(args);
    expect(result.success).toBe(true);
    matchIdsThisTest.push(result.matchId);

    const { rows } = await client.query('SELECT proposal_title FROM expertise_matches WHERE id = $1', [result.matchId]);
    expect(rows[0].proposal_title).toBe('R-FALLBACK-CONTRACT');
    await assertNoOpenTransactionAnywhere();
  });

  test('batchMatch throws ServiceHttpError(400) and writes no row when the active roster is empty', async () => {
    const profileId = await insertUserProfile();
    // Only an INACTIVE roster row exists for this test's run -- the real
    // `is_active = true` filter must yield zero rows.
    await insertRosterMember({ name: 'contract_only_inactive', isActive: false });

    primeExternalMocks();

    await expect(batchMatch({ requestId: 'req-contract-3', requestNumber: 'R-3', profileId }))
      .rejects.toMatchObject({ httpStatus: 400 });

    const { rows } = await client.query(
      `SELECT * FROM expertise_matches WHERE user_profile_id = $1`,
      [profileId]
    );
    expect(rows).toHaveLength(0);
    await assertNoOpenTransactionAnywhere();
  });
});
