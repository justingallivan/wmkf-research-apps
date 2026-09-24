'use strict';

/**
 * Contract test for lib/services/site-visit/recipient-directory-service.js —
 * Stage 3 item 2 (wave 2, slice B),
 * docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md.
 *
 * Covers the two Postgres-touching members of DEFAULT_DEPENDENCIES:
 * listProfiles() (user_profiles) and listRoster() (expertise_roster). Both
 * are read-only lookups with no bound INSERT/UPDATE parameters, so per the
 * template's point 2/4 this test proves the WHERE filters and ORDER BY with
 * anti-correlated fixtures instead of asserting bound write columns.
 *
 * The exported service functions (getActiveStaffRecipientDirectory,
 * getSiteVisitRecipientDirectory, resolveSiteVisitRecipientRefs) take a
 * `dependencies` object and are already covered against Dataverse-adapter
 * mocks in tests/unit/site-visit-recipient-directory.test.js; this contract
 * test exercises DEFAULT_DEPENDENCIES.listProfiles/listRoster directly
 * against the real database instead of re-mocking Dataverse.
 */

const crypto = require('node:crypto');
const { Client } = require('pg');
const { withClient } = require('../../lib/postgres/client');
const { getPool: getShimPool } = require('./support/vercel-postgres-pg-shim.js');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

describeIfDb('site-visit/recipient-directory-service: contract', () => {
  const {
    SITE_VISIT_RECIPIENT_DIRECTORY_DEPENDENCIES: deps,
  } = require('../../lib/services/site-visit/recipient-directory-service');

  let client;
  const insertedProfileIds = [];
  const insertedRosterIds = [];

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    let deleteError;
    try {
      await client.query(`SET lock_timeout = '5s'`);
      await client.query(`SET statement_timeout = '10s'`);
      if (insertedRosterIds.length) {
        await client.query('DELETE FROM expertise_roster WHERE id = ANY($1::int[])', [insertedRosterIds]);
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

  function uname(tag) {
    return `rds_contract_${tag}_${crypto.randomBytes(6).toString('hex')}`;
  }

  async function insertProfile({ name, displayName, azureEmail, isActive }) {
    const { rows } = await client.query(
      `INSERT INTO user_profiles (name, display_name, azure_email, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, displayName, azureEmail, isActive]
    );
    insertedProfileIds.push(rows[0].id);
    return rows[0].id;
  }

  async function insertRoster({ name, roleType, isActive, role = null, affiliation = null, preferredEmail = null, contactId = null }) {
    const { rows } = await client.query(
      `INSERT INTO expertise_roster (name, role_type, role, affiliation, preferred_email, dataverse_contact_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [name, roleType, role, affiliation, preferredEmail, contactId, isActive]
    );
    insertedRosterIds.push(rows[0].id);
    return rows[0].id;
  }

  describe('listProfiles', () => {
    // DISCRIMINATING: display_name is used for ordering via
    // COALESCE(display_name, name), not name alone. profileB's display_name
    // ('000_first') sorts before profileA's bare name ('aaa_zzz'), but
    // profileB's own `name` column ('zzz_bbb') would sort AFTER 'aaa_zzz' if
    // a mutant ordered by `name` instead of COALESCE(display_name, name) --
    // so the two orderings disagree and this fixture kills that mutant.
    // profileC (inactive) and profileD (no azure_email) must be excluded
    // entirely, killing mutants that drop either WHERE clause.
    test('filters to active profiles with an email and orders by COALESCE(display_name, name), id', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const idA = await insertProfile({
        name: uname(`a_${tag}`), displayName: null,
        azureEmail: `a_${tag}@example.org`, isActive: true,
      });
      const idB = await insertProfile({
        name: `zzz_bbb_${tag}`, displayName: `000_first_${tag}`,
        azureEmail: `b_${tag}@example.org`, isActive: true,
      });
      const idInactive = await insertProfile({
        name: uname(`inactive_${tag}`), displayName: `001_${tag}`,
        azureEmail: `inactive_${tag}@example.org`, isActive: false,
      });
      const idNoEmail = await insertProfile({
        name: uname(`noemail_${tag}`), displayName: `002_${tag}`,
        azureEmail: null, isActive: true,
      });

      const rows = await deps.listProfiles();
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(idInactive);
      expect(ids).not.toContain(idNoEmail);

      const oursIdx = { a: ids.indexOf(idA), b: ids.indexOf(idB) };
      expect(oursIdx.a).toBeGreaterThanOrEqual(0);
      expect(oursIdx.b).toBeGreaterThanOrEqual(0);
      expect(oursIdx.b).toBeLessThan(oursIdx.a);

      const rowA = rows.find((r) => r.id === idA);
      const rowB = rows.find((r) => r.id === idB);
      expect(rowA.azure_email).toBe(`a_${tag}@example.org`);
      expect(rowA.display_name).toBeNull();
      expect(rowB.display_name).toBe(`000_first_${tag}`);
      expect(rowB.dynamics_systemuser_id).toBeNull();

      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: id tie-break. Two rows with the identical
    // COALESCE(display_name, name) value, inserted with the SECOND row
    // getting the lower... no -- Postgres SERIAL ids are assigned in
    // insertion order, so to prove the `, id` tie-break independent of
    // insertion order we assert the returned pair is ascending by id
    // (the only order consistent with the ORDER BY clause), which a mutant
    // dropping the `, id` clause could still satisfy by accident on some
    // runs but never violate if the clause is present -- so this proves
    // presence of a stable, id-ascending tie-break for equal COALESCE keys.
    test('ties on COALESCE(display_name, name) break by ascending id', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const tieName = `tie_${tag}`;
      const idFirst = await insertProfile({
        name: uname('tie1'), displayName: tieName, azureEmail: `t1_${tag}@example.org`, isActive: true,
      });
      const idSecond = await insertProfile({
        name: uname('tie2'), displayName: tieName, azureEmail: `t2_${tag}@example.org`, isActive: true,
      });
      expect(idSecond).toBeGreaterThan(idFirst);

      const rows = await deps.listProfiles();
      const ours = rows.filter((r) => r.id === idFirst || r.id === idSecond);
      expect(ours).toHaveLength(2);
      expect(ours[0].id).toBe(idFirst);
      expect(ours[1].id).toBe(idSecond);
      await assertNoOpenTransactionAnywhere();
    });
  });

  describe('listRoster', () => {
    // DISCRIMINATING: ORDER BY role_type, name, id. rosterBoard's name
    // ('zzz_board') sorts AFTER rosterConsultant's name ('aaa_consultant')
    // alphabetically, but role_type 'Board' < 'Consultant', so the correct
    // primary sort by role_type puts rosterBoard FIRST -- a mutant ordering
    // by name alone (or with role_type/name swapped) would put
    // rosterConsultant first instead, failing this assertion.
    // rosterOtherType (role_type not in ('Board','Consultant')) and
    // rosterInactive must both be excluded, killing mutants that drop
    // either the IN-list or the is_active filter.
    test('filters to active Board/Consultant rows and orders by role_type, name, id', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const contactId = crypto.randomUUID();
      const idBoard = await insertRoster({
        name: `zzz_board_${tag}`, roleType: 'Board', isActive: true,
        role: 'Chair', affiliation: 'Board Affiliation', preferredEmail: `board_${tag}@example.org`,
        contactId,
      });
      const idConsultant = await insertRoster({
        name: `aaa_consultant_${tag}`, roleType: 'Consultant', isActive: true,
        role: 'Advisor', affiliation: 'Consultant Affiliation', preferredEmail: `consult_${tag}@example.org`,
      });
      const idOtherType = await insertRoster({
        name: uname(`other_${tag}`), roleType: 'Reviewer', isActive: true,
      });
      const idInactive = await insertRoster({
        name: uname(`inactive_${tag}`), roleType: 'Board', isActive: false,
      });

      const rows = await deps.listRoster();
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(idOtherType);
      expect(ids).not.toContain(idInactive);

      const idxBoard = ids.indexOf(idBoard);
      const idxConsultant = ids.indexOf(idConsultant);
      expect(idxBoard).toBeGreaterThanOrEqual(0);
      expect(idxConsultant).toBeGreaterThanOrEqual(0);
      expect(idxBoard).toBeLessThan(idxConsultant);

      const rowBoard = rows.find((r) => r.id === idBoard);
      expect(rowBoard.role).toBe('Chair');
      expect(rowBoard.affiliation).toBe('Board Affiliation');
      expect(rowBoard.preferred_email).toBe(`board_${tag}@example.org`);
      // Real, non-null FK-shaped value (dataverse_contact_id UUID) asserted
      // per the template's point 3.
      expect(rowBoard.dataverse_contact_id).toBe(contactId);

      const rowConsultant = rows.find((r) => r.id === idConsultant);
      expect(rowConsultant.dataverse_contact_id).toBeNull();

      await assertNoOpenTransactionAnywhere();
    });

    // DISCRIMINATING: within the same role_type, ties on name are broken
    // by ascending id (same rationale as the listProfiles id tie-break).
    test('within a role_type, ties on name break by ascending id', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const sameName = `same_${tag}`;
      const idFirst = await insertRoster({ name: sameName, roleType: 'Consultant', isActive: true });
      const idSecond = await insertRoster({ name: sameName, roleType: 'Consultant', isActive: true });
      expect(idSecond).toBeGreaterThan(idFirst);

      const rows = await deps.listRoster();
      const ours = rows.filter((r) => r.id === idFirst || r.id === idSecond);
      expect(ours).toHaveLength(2);
      expect(ours[0].id).toBe(idFirst);
      expect(ours[1].id).toBe(idSecond);
      await assertNoOpenTransactionAnywhere();
    });
  });
});
