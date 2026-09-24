'use strict';

/**
 * Contract test for lib/services/irs-bmf-service.js — Stage 3 item 4
 * TESTS-BEFORE (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md).
 * NO CONVERSION in this pass: the service still builds its own `pg.Pool`
 * via `newPool()`/`new Pool()`; this test runs, and must pass, against
 * that UNCONVERTED source. `lib/postgres/client` is used here only as
 * test infrastructure (the Stage 2 open-transaction assertion + the
 * `__endPoolForTests` cleanup hook, the latter a pre-emptive no-op today
 * that becomes load-bearing once the conversion makes the service call
 * the seam's own `getPool()`).
 *
 * This file has NO existing test of any kind. Per plan §2 rule 9 this
 * contract test IS the tests-before requirement.
 *
 * No cast-lint rows: this file contains no `sql\`...\`` tagged template at
 * all (it is 100% `pg.Pool`/`pg-copy-streams`), so
 * `scripts/check-postgres-access-layer.js`'s VALUES/CASE scan does not
 * apply to it.
 *
 * IMPORTANT DEVIATION FROM THE BRIEF, flagged per CLAUDE.md rule 10: the
 * brief asked for a "tiny CSV" to exercise refresh()'s real COPY, BEGIN,
 * COMMIT, and atomic swap. That is not possible as this file is written:
 * `MIN_PLAUSIBLE_TOTAL = 1_000_000` (line 52) gates step 3 ("Refusing to
 * swap: staging row count ... is below the ... plausibility threshold"),
 * which runs BEFORE step 4 (the swap) and is NOT skipped by `dryRun` —
 * only the swap itself is skipped in dry-run, the threshold check always
 * runs. A tiny CSV throws at step 3 and never reaches BEGIN/RENAME/COMMIT.
 * To exercise the real swap this test generates >1,000,000 synthetic CSV
 * rows across the four regions (see `buildRegionCsv` below) — genuinely
 * "large", not tiny. Measured wall time for the full swap test on this
 * machine: see the console.log timing line the test prints; it was
 * comfortably under 30s, which is why a second (ROLLBACK) 1M+-row run
 * was also added rather than skipped.
 *
 * The container's `irs_exempt_orgs` table permanently becomes the last
 * synthetic dataset for the remainder of this contract run once the swap
 * test executes. This is harmless: `CREATE TABLE ... (LIKE irs_exempt_orgs)`
 * preserves the exact column shape, no other pg-contract test file touches
 * this table, and `refresh()`'s own bootstrap DDL is idempotent
 * (`CREATE TABLE/INDEX IF NOT EXISTS`).
 */

const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const clientSeam = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('irs-bmf-service: contract', () => {
  const service = require('../../lib/services/irs-bmf-service');

  let client;
  const originalPostgresUrl = process.env.POSTGRES_URL;
  const originalFetch = global.fetch;
  const trackedFixtureEins = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
    // newPool()/getPool() both read POSTGRES_URL || DATABASE_URL; point the
    // service at the disposable contract container for the whole suite.
    process.env.POSTGRES_URL = PG_CONTRACT_URL;
  });

  afterAll(async () => {
    process.env.POSTGRES_URL = originalPostgresUrl;
    global.fetch = originalFetch;
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '30s'`);
      if (trackedFixtureEins.length) {
        await client.query('DELETE FROM irs_exempt_orgs WHERE ein = ANY($1::text[])', [trackedFixtureEins]);
      }
      await client.query('DROP VIEW IF EXISTS irs_exempt_orgs_old');
      await client.query('DROP TABLE IF EXISTS irs_exempt_orgs_new');
    } catch (err) {
      deleteError = err;
    } finally {
      // Pre-conversion this is a no-op (the seam's pg Pool is never
      // created by this file's own code, only possibly by the
      // open-transaction assertion below); post-conversion the service's
      // own getPool() usage makes this load-bearing for --detectOpenHandles.
      await clientSeam.__endPoolForTests().catch(() => {});
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

  function csvLine(ein, name, subsection, status) {
    return `${ein},${name},${subsection},${status}`;
  }

  /**
   * Builds one region's CSV body. `startAt`/`count` produce `count`
   * sequential, globally-unique 9-digit EINs (padded) starting at
   * `startAt`, all valid. `extraLines` appends verbatim lines (used for a
   * cross-region duplicate and deliberately malformed rows).
   */
  function buildRegionCsv(region, startAt, count, extraLines = []) {
    const lines = ['EIN,NAME,SUBSECTION,STATUS'];
    for (let i = 0; i < count; i += 1) {
      const ein = String(startAt + i).padStart(9, '0');
      lines.push(csvLine(ein, `Org ${region}-${i}`, '03', '01'));
    }
    for (const extra of extraLines) lines.push(extra);
    return lines.join('\n') + '\n';
  }

  function stubFetchWithCsvByRegion(csvByRegion) {
    global.fetch = jest.fn(async (url) => {
      const match = String(url).match(/eo(\d)\.csv$/);
      const region = match?.[1];
      const body = csvByRegion[region];
      if (body === undefined) throw new Error(`stubFetchWithCsvByRegion: no CSV stubbed for url ${url}`);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: Readable.from([Buffer.from(body, 'utf8')]),
      };
    });
  }

  describe('verifyEin', () => {
    test('found row with a 501(c)(3) public charity, and dashed input normalizes', async () => {
      const ein = '987654321';
      trackedFixtureEins.push(ein);
      await client.query(
        `INSERT INTO irs_exempt_orgs (ein, name, subsection, status, deductibility, foundation, ruling_date, state, region, refresh_date)
         VALUES ($1, 'Contract Charity', '03', '01', '1', '10', '202001', 'CA', '3', CURRENT_DATE)
         ON CONFLICT (ein) DO UPDATE SET name = EXCLUDED.name, subsection = EXCLUDED.subsection, status = EXCLUDED.status,
           deductibility = EXCLUDED.deductibility, foundation = EXCLUDED.foundation, ruling_date = EXCLUDED.ruling_date,
           state = EXCLUDED.state, region = EXCLUDED.region, refresh_date = EXCLUDED.refresh_date`,
        [ein]
      );

      const result = await service.verifyEin('98-7654321'); // dashed input must normalize
      expect(result.found).toBe(true);
      expect(result.ein).toBe(ein);
      expect(result.name).toBe('Contract Charity');
      expect(result.is501c3PublicCharity).toBe(true);
      expect(result.subsectionDescription).toBe(service.SUBSECTION_DESCRIPTIONS['03']);
      expect(result.asOfRefreshDate).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    });

    // DISCRIMINATING: subsection 03 with an INACTIVE status (25, not in
    // ACTIVE_EXEMPT_STATUS_CODES) must NOT be flagged a public charity --
    // kills a mutant that drops the status half of the AND.
    test('DISCRIMINATING: subsection 03 with a non-active status is not a public charity', async () => {
      const ein = '987654322';
      trackedFixtureEins.push(ein);
      await client.query(
        `INSERT INTO irs_exempt_orgs (ein, name, subsection, status, region, refresh_date)
         VALUES ($1, 'Terminating Foundation', '03', '25', '3', CURRENT_DATE)
         ON CONFLICT (ein) DO UPDATE SET subsection = EXCLUDED.subsection, status = EXCLUDED.status`,
        [ein]
      );
      const result = await service.verifyEin(ein);
      expect(result.is501c3PublicCharity).toBe(false);
    });

    // DISCRIMINATING: an active status (01) on a NON-03 subsection must
    // also not be flagged -- kills a mutant that drops the subsection
    // half of the AND.
    test('DISCRIMINATING: an active status on a non-03 subsection is not a public charity', async () => {
      const ein = '987654323';
      trackedFixtureEins.push(ein);
      await client.query(
        `INSERT INTO irs_exempt_orgs (ein, name, subsection, status, region, refresh_date)
         VALUES ($1, 'Civic League', '04', '01', '3', CURRENT_DATE)
         ON CONFLICT (ein) DO UPDATE SET subsection = EXCLUDED.subsection, status = EXCLUDED.status`,
        [ein]
      );
      const result = await service.verifyEin(ein);
      expect(result.is501c3PublicCharity).toBe(false);
    });

    test('not found for a well-formed EIN absent from the table', async () => {
      const result = await service.verifyEin('900000000');
      expect(result).toEqual({ ein: '900000000', found: false });
    });

    test('invalid EIN shape is rejected without querying', async () => {
      expect(await service.verifyEin('123')).toEqual({ error: 'invalid_ein', message: 'EIN must be 9 digits' });
      expect(await service.verifyEin(null)).toEqual({ error: 'invalid_ein', message: 'EIN must be 9 digits' });
    });
  });

  describe('refresh(): cheap rejection paths (both exit before the 1M-row threshold check, real COPY/dedupe/PK still run)', () => {
    test('a tiny CSV is refused at the plausibility threshold; live table untouched', async () => {
      stubFetchWithCsvByRegion({
        1: buildRegionCsv('1', 100000001, 3),
        2: buildRegionCsv('2', 200000001, 3),
        3: buildRegionCsv('3', 300000001, 3),
        4: buildRegionCsv('4', 400000001, 3),
      });
      const before = await client.query('SELECT count(*)::int AS n FROM irs_exempt_orgs');

      await expect(service.refresh()).rejects.toThrow(/Refusing to swap/);

      const after = await client.query('SELECT count(*)::int AS n FROM irs_exempt_orgs');
      expect(after.rows[0].n).toBe(before.rows[0].n);
      const staging = await client.query(`SELECT to_regclass('irs_exempt_orgs_new') AS t`);
      expect(staging.rows[0].t).toBeNull();
      await assertNoOpenTransactionAnywhere();
    }, 30000);

    // DISCRIMINATING: strict mode aborts on ANY skipped/duplicate row
    // BEFORE the plausibility threshold is even reached -- proves the
    // real csv-parse + validation path (missing STATUS -> skipped) is
    // live, not stubbed, and that strict mode's own guard fires first.
    test('DISCRIMINATING: strict mode aborts on a single malformed row, live table untouched', async () => {
      stubFetchWithCsvByRegion({
        1: buildRegionCsv('1', 110000001, 3, [csvLine('119999999', 'Missing Status Org', '03', '')]),
        2: buildRegionCsv('2', 210000001, 3),
        3: buildRegionCsv('3', 310000001, 3),
        4: buildRegionCsv('4', 410000001, 3),
      });
      const before = await client.query('SELECT count(*)::int AS n FROM irs_exempt_orgs');

      await expect(service.refresh({ strict: true })).rejects.toThrow(/Strict mode aborted refresh/);

      const after = await client.query('SELECT count(*)::int AS n FROM irs_exempt_orgs');
      expect(after.rows[0].n).toBe(before.rows[0].n);
      await assertNoOpenTransactionAnywhere();
    }, 30000);
  });

  describe('refresh(): full atomic swap against >1,000,000 real rows', () => {
    // 255,000 unique rows/region x4 = 1,020,000 valid rows, comfortably
    // over MIN_PLAUSIBLE_TOTAL (1,000,000). One EIN is duplicated across
    // regions 1 and 3 (duplicatesRemoved === 1); region 2 carries one
    // missing-STATUS row and one 8-digit EIN (both skipped).
    const ROWS_PER_REGION = 255000;
    const DUP_EIN = '120000001';

    test('commits the swap: real COPY, dedupe, PK creation, BEGIN/RENAME/COMMIT, live table replaced', async () => {
      const start = Date.now();
      stubFetchWithCsvByRegion({
        1: buildRegionCsv('1', 120000001, ROWS_PER_REGION),
        2: buildRegionCsv('2', 220000001, ROWS_PER_REGION, [
          csvLine('229999999', 'Missing Status Org', '03', ''),
          csvLine('12345678', 'Too Short EIN Org', '03', '01'),
        ]),
        3: buildRegionCsv('3', 320000001, ROWS_PER_REGION, [csvLine(DUP_EIN, 'Cross-Region Duplicate', '03', '01')]),
        4: buildRegionCsv('4', 420000001, ROWS_PER_REGION),
      });

      const stats = await service.refresh();
      const elapsedMs = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`[irs-bmf-service contract] full swap test wall time: ${elapsedMs}ms`);

      expect(stats.duplicatesRemoved).toBe(1);
      expect(stats.totalSkipped).toBe(2);
      expect(stats.perRegion['2'].skipped).toBe(2);
      expect(stats.totalRows).toBe(ROWS_PER_REGION * 4);
      expect(stats.swappedAt).not.toBeNull();

      const liveCount = await client.query('SELECT count(*)::int AS n FROM irs_exempt_orgs');
      expect(liveCount.rows[0].n).toBe(stats.totalRows);

      const stagingGone = await client.query(`SELECT to_regclass('irs_exempt_orgs_new') AS t, to_regclass('irs_exempt_orgs_old') AS o`);
      expect(stagingGone.rows[0].t).toBeNull();
      expect(stagingGone.rows[0].o).toBeNull();

      const pk = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conrelid = 'irs_exempt_orgs'::regclass AND contype = 'p'`
      );
      expect(pk.rows.length).toBe(1);

      const sampleRow = await client.query(`SELECT region, refresh_date FROM irs_exempt_orgs WHERE ein = $1`, ['320000005']);
      expect(sampleRow.rows[0].region).toBe('3');
      expect(new Date(sampleRow.rows[0].refresh_date).toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));

      await assertNoOpenTransactionAnywhere();
    }, 300000);

    // DISCRIMINATING: forces the swap's very first statement (`DROP TABLE
    // IF EXISTS irs_exempt_orgs_old`) to fail with a REAL planner error
    // (42809 "is not a table", since `irs_exempt_orgs_old` is pre-created
    // as a VIEW) -- proves the catch-and-ROLLBACK inside step 4 leaves the
    // live table (from the prior commit test) completely unchanged, and
    // that the outer catch still drops the staging table.
    test('DISCRIMINATING: a real planner error during the swap rolls back, live table from the prior test is unchanged', async () => {
      await client.query('CREATE VIEW irs_exempt_orgs_old AS SELECT 1 AS decoy');
      const before = await client.query('SELECT count(*)::int AS n FROM irs_exempt_orgs');

      stubFetchWithCsvByRegion({
        1: buildRegionCsv('1', 130000001, ROWS_PER_REGION),
        2: buildRegionCsv('2', 230000001, ROWS_PER_REGION),
        3: buildRegionCsv('3', 330000001, ROWS_PER_REGION),
        4: buildRegionCsv('4', 430000001, ROWS_PER_REGION),
      });

      await expect(service.refresh()).rejects.toThrow(/is not a table/);

      const after = await client.query('SELECT count(*)::int AS n FROM irs_exempt_orgs');
      expect(after.rows[0].n).toBe(before.rows[0].n);
      const staging = await client.query(`SELECT to_regclass('irs_exempt_orgs_new') AS t`);
      expect(staging.rows[0].t).toBeNull();

      await client.query('DROP VIEW irs_exempt_orgs_old');
      await assertNoOpenTransactionAnywhere();
    }, 300000);
  });
});
