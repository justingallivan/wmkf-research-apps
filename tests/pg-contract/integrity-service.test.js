'use strict';

/**
 * Contract test for lib/services/integrity-service.js — Stage 3 item 3
 * (wave 3, slice B), docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * No existing unit test loads this module (`tests/unit/`, per the Stage 3
 * fresh-context review), so this contract test IS the tests-before
 * requirement (plan §2 rule 9). It covers every Postgres-touching static
 * method directly (searchRetractionWatch, saveScreening,
 * getScreeningHistory, getScreening, updateScreeningStatus, dismissMatch,
 * getDismissals, getRetractionStats) — all 11 sql-tag statements. The
 * generator `screenApplicants` orchestrates external SERP/Claude calls in
 * addition to these same two DB methods (searchRetractionWatch,
 * saveScreening); it is not separately exercised here since doing so would
 * require mocking network/AI boundaries this Postgres-focused contract test
 * has no business touching (the two DB methods it delegates to are already
 * covered directly).
 *
 * Must-cover (per `node scripts/check-postgres-access-layer.js --json` →
 * `j.castLint.filter(c => c.file === 'lib/services/integrity-service.js')`,
 * 11 rows): lines 586-590 (saveScreening's 5-column VALUES) and lines
 * 670-675 (dismissMatch's 6-column VALUES). Every one of those 11 bound
 * columns is asserted below.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('integrity-service: contract', () => {
  const { IntegrityService } = require('../../lib/services/integrity-service');

  let client;
  const insertedProfileIds = [];
  const insertedRetractionIds = [];
  const insertedScreeningIds = [];
  const insertedDismissalIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedDismissalIds.length) {
        await client.query('DELETE FROM screening_dismissals WHERE id = ANY($1::int[])', [insertedDismissalIds]);
      }
      if (insertedScreeningIds.length) {
        await client.query('DELETE FROM screening_dismissals WHERE screening_id = ANY($1::int[])', [insertedScreeningIds]);
        await client.query('DELETE FROM integrity_screenings WHERE id = ANY($1::int[])', [insertedScreeningIds]);
      }
      if (insertedRetractionIds.length) {
        await client.query('DELETE FROM retractions WHERE id = ANY($1::int[])', [insertedRetractionIds]);
      }
      if (insertedProfileIds.length) {
        await client.query('DELETE FROM user_profiles WHERE id = ANY($1::int[])', [insertedProfileIds]);
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

  // Name-matching normalization strips everything but [a-z\s] (see
  // IntegrityMatchingService.normalizeName), so a hex tag's digits would
  // silently vanish from the generated search terms/patterns and break the
  // term<->authors_normalized alignment below. Letters-only tags avoid that.
  function randomLetters(n) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let out = '';
    const bytes = crypto.randomBytes(n);
    for (let i = 0; i < n; i += 1) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  async function insertProfile() {
    const name = `integrity_contract_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await client.query(`INSERT INTO user_profiles (name) VALUES ($1) RETURNING id`, [name]);
    insertedProfileIds.push(rows[0].id);
    return rows[0].id;
  }

  async function insertRetraction({ recordId, authors, authorsNormalized, journal = 'Journal of Contract Testing', retractionDate = '2020-01-01' }) {
    const { rows } = await client.query(
      `INSERT INTO retractions (record_id, title, authors, authors_normalized, journal, retraction_date)
       VALUES ($1, $2, $3, $4::text[], $5, $6) RETURNING id`,
      [recordId, `Title for ${recordId}`, authors, authorsNormalized, journal, retractionDate]
    );
    insertedRetractionIds.push(rows[0].id);
    return rows[0].id;
  }

  describe('searchRetractionWatch', () => {
    // DISCRIMINATING: proves the `if (matches.length < 5) { ...LIKE fallback... }`
    // gate in both directions with a SHARED plant row. When phase-1 (array
    // containment) already finds >=5 matches, phase 2 (LIKE fallback) must
    // NOT run -- so a plant row that is invisible to phase 1 (its
    // authors_normalized array contains no generated search term) but
    // WOULD be found by phase 2's LIKE pattern must be ABSENT from the
    // "5-hit" name's results. Reusing the exact same plant author text
    // under a name that gets 0 phase-1 hits then proves phase 2 DOES run
    // and DOES find it. A mutant that drops the length gate (always runs
    // phase 2) fails test A (plant leaks in); a mutant that never runs
    // phase 2 fails test B (plant never appears).
    test('phase-1 array match: skips the LIKE fallback once 5 matches are already found', async () => {
      const tag = randomLetters(6);
      const name = `Fivehit Zqxvthorpe${tag}`;
      const term = `fivehit zqxvthorpe${tag}`; // buildDatabaseSearchTerms' normalized full-name term

      for (let i = 0; i < 5; i += 1) {
        await insertRetraction({
          recordId: `contract-5hit-${tag}-${i}`,
          authors: name,
          authorsNormalized: [term],
        });
      }
      // Plant: invisible to phase 1 (authors_normalized has no matching
      // term), but its `authors` text WOULD match phase 2's LIKE pattern
      // for this same name (`%fivehit%zqxvthorpe<tag>%`).
      await insertRetraction({
        recordId: `contract-5hit-plant-${tag}`,
        authors: name,
        authorsNormalized: ['unrelated_marker_no_term_match'],
      });

      const matches = await IntegrityService.searchRetractionWatch(name, null);
      const ids = matches.map((m) => m.recordId);
      expect(ids.filter((id) => id.startsWith(`contract-5hit-${tag}-`))).toHaveLength(5);
      expect(ids).not.toContain(`contract-5hit-plant-${tag}`);
      await assertNoOpenTransactionAnywhere();
    });

    test('phase-2 LIKE fallback: runs and finds a match when phase 1 finds none', async () => {
      const tag = randomLetters(6);
      const name = `Wobbleknacker Wandalina${tag}`;
      // authors_normalized deliberately contains NO term buildDatabaseSearchTerms
      // would generate for this name, so the phase-1 array-containment
      // query returns zero rows for it.
      await insertRetraction({
        recordId: `contract-phase2-${tag}`,
        authors: name,
        authorsNormalized: ['unrelated_marker_no_term_match_either'],
      });

      const matches = await IntegrityService.searchRetractionWatch(name, null);
      const ids = matches.map((m) => m.recordId);
      expect(ids).toContain(`contract-phase2-${tag}`);
      const hit = matches.find((m) => m.recordId === `contract-phase2-${tag}`);
      expect(hit.confidence).toBeGreaterThanOrEqual(50);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('saveScreening', () => {
    // Covers castLint lines 586-590 (all 5 bound VALUES columns).
    // DISCRIMINATING: match_count is `results.reduce((sum, r) => sum + r.matchCount, 0)`,
    // NOT `results.length` and not hardcoded 0 -- two results entries with
    // distinct, non-1 matchCounts (2 and 5, summing to 7, with length 2)
    // make all three candidates (0, length=2, sum=7) disagree, and the
    // assertion below only accepts the real sum.
    test('binds every VALUES column, computing match_count as the summed matchCount', async () => {
      const profileId = await insertProfile();
      const screenedNames = [{ name: 'Contract Applicant One' }, { name: 'Contract Applicant Two' }];
      const results = [
        { name: 'Contract Applicant One', matchCount: 2, hasConcerns: true },
        { name: 'Contract Applicant Two', matchCount: 5, hasConcerns: true },
      ];

      const screeningId = await IntegrityService.saveScreening(profileId, 'manual', screenedNames, results);
      insertedScreeningIds.push(screeningId);

      const { rows } = await client.query('SELECT * FROM integrity_screenings WHERE id = $1', [screeningId]);
      const row = rows[0];
      expect(row.user_profile_id).toBe(profileId);
      expect(row.screening_type).toBe('manual');
      expect(row.screened_names).toEqual(screenedNames);
      expect(row.results).toEqual(results);
      expect(row.match_count).toBe(7);
      expect(row.status).toBe('pending');
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getScreeningHistory', () => {
    // DISCRIMINATING: three rows with explicit, anti-correlated created_at
    // timestamps (insertion order deliberately does NOT match chronological
    // order), then limit=2 offset=1 -- the correct ORDER BY created_at DESC
    // + LIMIT 2 OFFSET 1 returns exactly [middle, oldest], proving ORDER,
    // LIMIT, and OFFSET are all bound correctly (any one wrong changes
    // which two ids come back or their order).
    test('orders by created_at DESC and respects limit/offset', async () => {
      const profileId = await insertProfile();
      const ids = {};
      for (const [label, offsetDays] of [['oldest', 3], ['newest', 1], ['middle', 2]]) {
        const { rows } = await client.query(
          `INSERT INTO integrity_screenings (user_profile_id, screening_type, screened_names, created_at)
           VALUES ($1, 'manual', '[]'::jsonb, NOW() - ($2 || ' days')::interval) RETURNING id`,
          [profileId, offsetDays]
        );
        ids[label] = rows[0].id;
        insertedScreeningIds.push(rows[0].id);
      }

      const page = await IntegrityService.getScreeningHistory(profileId, 2, 1);
      expect(page.map((r) => r.id)).toEqual([ids.middle, ids.oldest]);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getScreening', () => {
    test('with a matching userProfileId, returns the row plus its dismissals', async () => {
      const profileId = await insertProfile();
      const { rows } = await client.query(
        `INSERT INTO integrity_screenings (user_profile_id, screening_type, screened_names)
         VALUES ($1, 'manual', '[]'::jsonb) RETURNING id`,
        [profileId]
      );
      const screeningId = rows[0].id;
      insertedScreeningIds.push(screeningId);
      const dismissal = await client.query(
        `INSERT INTO screening_dismissals (screening_id, source, source_identifier, screened_name, dismissal_reason)
         VALUES ($1, 'pubpeer', 'src-1', 'Contract Name', 'false_positive') RETURNING id`,
        [screeningId]
      );
      insertedDismissalIds.push(dismissal.rows[0].id);

      const screening = await IntegrityService.getScreening(screeningId, profileId);
      expect(screening.id).toBe(screeningId);
      expect(screening.dismissals).toHaveLength(1);
      expect(screening.dismissals[0].source).toBe('pubpeer');

      // DISCRIMINATING: the ternary's OTHER branch -- a wrong userProfileId
      // must find nothing, proving the AND user_profile_id filter is real,
      // not decorative.
      const wrongProfile = await IntegrityService.getScreening(screeningId, profileId + 999999);
      expect(wrongProfile).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });

    test('without a userProfileId argument, returns the row regardless of owner', async () => {
      const profileId = await insertProfile();
      const { rows } = await client.query(
        `INSERT INTO integrity_screenings (user_profile_id, screening_type, screened_names)
         VALUES ($1, 'manual', '[]'::jsonb) RETURNING id`,
        [profileId]
      );
      insertedScreeningIds.push(rows[0].id);

      const screening = await IntegrityService.getScreening(rows[0].id);
      expect(screening.id).toBe(rows[0].id);
      expect(screening.dismissals).toEqual([]);
      await assertNoOpenTransactionAnywhere();
    });

    test('returns null for a non-existent screening id', async () => {
      const screening = await IntegrityService.getScreening(-1);
      expect(screening).toBeNull();
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('updateScreeningStatus', () => {
    // DISCRIMINATING: COALESCE(${notes}, notes) -- passing notes=null must
    // PRESERVE the existing notes, not overwrite with NULL. Kills a mutant
    // that drops COALESCE and writes the argument unconditionally.
    test('updates status/reviewed_at and preserves notes via COALESCE when notes is null', async () => {
      const profileId = await insertProfile();
      const { rows } = await client.query(
        `INSERT INTO integrity_screenings (user_profile_id, screening_type, screened_names, notes)
         VALUES ($1, 'manual', '[]'::jsonb, 'original notes') RETURNING id`,
        [profileId]
      );
      const screeningId = rows[0].id;
      insertedScreeningIds.push(screeningId);

      await IntegrityService.updateScreeningStatus(screeningId, 'reviewed', null);

      const { rows: after } = await client.query('SELECT status, notes, reviewed_at FROM integrity_screenings WHERE id = $1', [screeningId]);
      expect(after[0].status).toBe('reviewed');
      expect(after[0].notes).toBe('original notes');
      expect(after[0].reviewed_at).toBeInstanceOf(Date);

      await IntegrityService.updateScreeningStatus(screeningId, 'dismissed', 'new notes');
      const { rows: after2 } = await client.query('SELECT status, notes FROM integrity_screenings WHERE id = $1', [screeningId]);
      expect(after2[0].status).toBe('dismissed');
      expect(after2[0].notes).toBe('new notes');
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('dismissMatch', () => {
    // Covers castLint lines 670-675 (all 6 bound VALUES columns).
    test('binds every VALUES column', async () => {
      const profileId = await insertProfile();
      const { rows } = await client.query(
        `INSERT INTO integrity_screenings (user_profile_id, screening_type, screened_names)
         VALUES ($1, 'manual', '[]'::jsonb) RETURNING id`,
        [profileId]
      );
      const screeningId = rows[0].id;
      insertedScreeningIds.push(screeningId);

      await IntegrityService.dismissMatch(screeningId, 'news', 'src-identifier-1', 'Contract Screened Name', 'not_a_match', 'dismissal notes');

      const { rows: dismissals } = await client.query('SELECT * FROM screening_dismissals WHERE screening_id = $1', [screeningId]);
      expect(dismissals).toHaveLength(1);
      const d = dismissals[0];
      insertedDismissalIds.push(d.id);
      expect(d.screening_id).toBe(screeningId);
      expect(d.source).toBe('news');
      expect(d.source_identifier).toBe('src-identifier-1');
      expect(d.screened_name).toBe('Contract Screened Name');
      expect(d.dismissal_reason).toBe('not_a_match');
      expect(d.notes).toBe('dismissal notes');
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getDismissals', () => {
    // DISCRIMINATING: two screenings each with a dismissal -- proves the
    // WHERE screening_id filter isolates the right one, not both/neither.
    test('returns only the dismissals for the given screening_id', async () => {
      const profileId = await insertProfile();
      const mk = async () => {
        const { rows } = await client.query(
          `INSERT INTO integrity_screenings (user_profile_id, screening_type, screened_names)
           VALUES ($1, 'manual', '[]'::jsonb) RETURNING id`,
          [profileId]
        );
        insertedScreeningIds.push(rows[0].id);
        return rows[0].id;
      };
      const screeningA = await mk();
      const screeningB = await mk();
      const dA = await client.query(
        `INSERT INTO screening_dismissals (screening_id, source, screened_name, dismissal_reason)
         VALUES ($1, 'pubpeer', 'A Name', 'false_positive') RETURNING id`,
        [screeningA]
      );
      const dB = await client.query(
        `INSERT INTO screening_dismissals (screening_id, source, screened_name, dismissal_reason)
         VALUES ($1, 'pubpeer', 'B Name', 'false_positive') RETURNING id`,
        [screeningB]
      );
      insertedDismissalIds.push(dA.rows[0].id, dB.rows[0].id);

      const dismissalsA = await IntegrityService.getDismissals(screeningA);
      expect(dismissalsA).toHaveLength(1);
      expect(dismissalsA[0].screened_name).toBe('A Name');
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('getRetractionStats', () => {
    // DISCRIMINATING: seed one row at an extreme EARLY boundary date
    // (1900-01-01) and one at an extreme LATE boundary date (2099-12-31) --
    // dates no genuine Retraction Watch row would ever have -- so these are
    // guaranteed to become the table-wide MIN/MAX regardless of any other
    // rows already present (this query has no WHERE clause, so it can't be
    // scoped to just this test's rows). A mutant that swaps MIN/MAX for
    // earliest/latest reports the boundaries backwards, failing both
    // equality assertions. total/journals are checked as before/after
    // deltas since they too are table-wide counts.
    test('earliest/latest reflect true table-wide MIN/MAX; total/journals count real inserted rows', async () => {
      const before = await IntegrityService.getRetractionStats();
      const tag = crypto.randomBytes(4).toString('hex');

      await insertRetraction({
        recordId: `contract-stats-early-${tag}`, authors: 'Early Author', authorsNormalized: ['x'],
        journal: `Contract Journal Early ${tag}`, retractionDate: '1900-01-01',
      });
      await insertRetraction({
        recordId: `contract-stats-late-${tag}`, authors: 'Late Author', authorsNormalized: ['x'],
        journal: `Contract Journal Late ${tag}`, retractionDate: '2099-12-31',
      });

      const after = await IntegrityService.getRetractionStats();
      expect(Number(after.total)).toBe(Number(before.total) + 2);
      expect(Number(after.journals)).toBe(Number(before.journals) + 2);
      expect(new Date(after.earliest).toISOString().slice(0, 10)).toBe('1900-01-01');
      expect(new Date(after.latest).toISOString().slice(0, 10)).toBe('2099-12-31');
      await assertNoOpenTransactionAnywhere();
    });
  });
});
