/**
 * Cutover marker for the legacy Postgres roster. Once the Production roster has moved to
 * Dataverse (a binding row exists for the Production host), legacy roster writers refuse.
 * Before the bridge migration exists the table is absent and writes stay allowed.
 * Keyed to the Production host so a stray sandbox row cannot freeze Production.
 * `query(text, params)` must return `{ rows }` (pg client, @vercel/postgres sql.query).
 * Plan: docs/plans/EXPERTISE_ROSTER_PRODUCTION_MIGRATION_PLAN_2026-11-19.md.
 */
const PRODUCTION_ROSTER_HOST = 'wmkf.crm.dynamics.com';
const ROSTER_MOVED = 'The roster has moved to Dynamics. Edit it in Admin → People & Access → Expertise Roster.';

async function legacyRosterMoved(query) {
  const present = await query("SELECT to_regclass('public.expertise_roster_binding') IS NOT NULL AS present", []);
  if (!present.rows[0] || present.rows[0].present !== true) return false;
  const moved = await query('SELECT 1 FROM expertise_roster_binding WHERE target_host = $1 LIMIT 1', [PRODUCTION_ROSTER_HOST]);
  return moved.rows.length > 0;
}

async function assertLegacyRosterWritable(query) {
  if (await legacyRosterMoved(query)) {
    throw Object.assign(new Error(ROSTER_MOVED), { status: 409, code: 'roster_moved' });
  }
}

module.exports = { PRODUCTION_ROSTER_HOST, ROSTER_MOVED, legacyRosterMoved, assertLegacyRosterWritable };
