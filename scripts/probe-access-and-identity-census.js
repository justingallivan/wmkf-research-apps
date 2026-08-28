#!/usr/bin/env node
/**
 * READ-ONLY census of who can act in the apps and how their writes attribute:
 *   1. Postgres `user_profiles` — every profile, active flag, azure email,
 *      linked `dynamics_systemuser_id`, reconciliation age, last login.
 *   2. Postgres `dynamics_user_roles` — app-side role per profile
 *      (superuser gates the guarded actions).
 *   3. Dataverse `wmkf_appuserappaccess` — per-app access grants, keyed on
 *      the Dataverse systemuser (so access requires a linked identity).
 *
 * Together these answer, per person: can they sign in, which apps can they
 * open (and therefore which writes can they trigger), and will an
 * impersonated write attribute to them (linked identity present; table
 * privileges are the separate CRM-side question — see
 * docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md §Status).
 *
 * SAFETY: no write path — Postgres SELECTs and one Dataverse GET.
 * Production Dataverse reads are owner-run behind the interlock override.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-access-and-identity-census.js
 */

require('./../lib/dataverse/client').loadEnvLocal();

(async () => {
  const { sql } = require('@vercel/postgres');
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

  const profiles = (await sql`
    SELECT id, name, display_name, azure_email, is_active,
           dynamics_systemuser_id, dynamics_reconciled_at, last_login_at
    FROM user_profiles
    ORDER BY is_active DESC, last_login_at DESC NULLS LAST
  `).rows;

  const roles = (await sql`
    SELECT user_profile_id, role FROM dynamics_user_roles
  `).rows;
  const roleByProfile = new Map(roles.map((r) => [r.user_profile_id, r.role]));

  const accessBySystemuser = new Map();
  await bypassDynamicsRestrictions('probe-access-and-identity-census', async () => {
    // queryAllRecords refuses unfiltered dumps; access rows without a linked
    // systemuser are meaningless for this census, so this filter loses nothing.
    const result = await DynamicsService.queryAllRecords('wmkf_appuserappaccesses', {
      select: 'wmkf_appkey,_wmkf_user_value',
      filter: '_wmkf_user_value ne null',
    });
    if (result.capped || (result.totalCount && result.records.length < result.totalCount)) {
      throw new Error('app-access scan incomplete — refusing to report a partial census.');
    }
    for (const row of result.records) {
      const sid = (row._wmkf_user_value || '').toLowerCase();
      if (!sid) continue;
      if (!accessBySystemuser.has(sid)) accessBySystemuser.set(sid, []);
      accessBySystemuser.get(sid).push(row.wmkf_appkey);
    }
  });

  console.log(`Access & identity census — ${profiles.length} profile(s), ${roles.length} role row(s), ${accessBySystemuser.size} systemuser(s) with app access\n`);

  const seenSystemusers = new Set();
  for (const p of profiles) {
    const sid = (p.dynamics_systemuser_id || '').toLowerCase() || null;
    if (sid) seenSystemusers.add(sid);
    const apps = sid ? (accessBySystemuser.get(sid) || []).sort() : [];
    const reconciled = p.dynamics_reconciled_at
      ? String(p.dynamics_reconciled_at).slice(0, 10)
      : null;
    const lastLogin = p.last_login_at ? String(p.last_login_at).slice(0, 10) : 'never';
    console.log(`${p.display_name || p.name}  <${p.azure_email || 'no azure email'}>`);
    console.log(`  active: ${p.is_active}   role: ${roleByProfile.get(p.id) || '(none — read_only default)'}   last login: ${lastLogin}`);
    console.log(`  linked systemuser: ${sid ? `yes (reconciled ${reconciled || 'unknown'})` : 'NO — writes cannot attribute to them; Dataverse-backed app access unresolvable'}`);
    console.log(`  app access (${apps.length}): ${apps.join(', ') || '(none found for linked systemuser)'}`);
    console.log('');
  }

  const orphaned = [...accessBySystemuser.keys()].filter((sid) => !seenSystemusers.has(sid));
  if (orphaned.length > 0) {
    console.log(`NOTE: ${orphaned.length} systemuser(s) hold app-access rows but match no profile's linked identity:`);
    for (const sid of orphaned) {
      console.log(`  [${sid}] apps: ${accessBySystemuser.get(sid).sort().join(', ')}`);
    }
  }

  process.exit(0);
})().catch((error) => {
  console.error('Probe failed:', error.message);
  process.exit(1);
});
