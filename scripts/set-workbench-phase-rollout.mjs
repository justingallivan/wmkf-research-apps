#!/usr/bin/env node
/**
 * Operator command for the request page's phase rollout setting
 * (`workbench.phase_rollout`; lib/services/workbench/phase-admission.js).
 * The only sanctioned writer of that one key. Owner-run.
 *
 *   node scripts/set-workbench-phase-rollout.mjs                       # show current value
 *   node scripts/set-workbench-phase-rollout.mjs off|on                # dry run of a change
 *   node scripts/set-workbench-phase-rollout.mjs pilot <guid>,<guid>   # dry run of a change
 *   ... --execute --expected-revision=<etag|none> --actor-email=<staff email>
 *
 * Dry run is the default: it reads and prints the current value and revision
 * and the value that would be written. Execute writes only when the stored
 * revision still equals --expected-revision (`none` when no row exists yet),
 * records the editor in `wmkf_UpdatedBy` (refused if the email does not map
 * to an active staff profile with a Dynamics user), and reads the value back
 * through the same parser the app uses.
 *
 * Uses .env.local (DYNAMICS_*, POSTGRES_URL for the editor lookup). Against
 * Production it needs DATAVERSE_TARGET_INTERLOCK=on and
 * DATAVERSE_ALLOW_PROD_READS=yes, and --execute also a same-UTC-day
 * DATAVERSE_PROD_WRITE_ACK.
 */
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);

export function parseArgs(argv) {
  const options = { mode: null, requestIds: [], execute: false, expectedRevision: undefined, actorEmail: null };
  const positional = [];
  for (const value of argv.slice(2)) {
    if (value === '--execute') options.execute = true;
    else if (value.startsWith('--expected-revision=')) options.expectedRevision = value.slice('--expected-revision='.length);
    else if (value.startsWith('--actor-email=')) options.actorEmail = value.slice('--actor-email='.length).trim();
    else if (value === '--help' || value === '-h') options.help = true;
    else if (value.startsWith('--')) throw new Error(`Unknown flag: ${value}`);
    else positional.push(value);
  }
  if (positional.length) {
    options.mode = positional[0];
    if (!['off', 'on', 'pilot'].includes(options.mode)) throw new Error(`Unknown mode: ${options.mode} (use off, on or pilot)`);
    if (options.mode === 'pilot') {
      if (positional.length !== 2) throw new Error('pilot needs one comma-separated list of request GUIDs');
      options.requestIds = positional[1].split(',').map((id) => id.trim()).filter(Boolean);
    } else if (positional.length !== 1) throw new Error(`${options.mode} takes no further arguments`);
  }
  if (options.execute) {
    if (!options.mode) throw new Error('--execute needs a mode (off, on or pilot)');
    if (!options.expectedRevision) throw new Error('--execute needs --expected-revision=<etag from the dry run, or none>');
    if (!options.actorEmail) throw new Error('--execute needs --actor-email=<your staff email>');
  }
  return options;
}

/** The exact JSON the app accepts, validated by the app's own parser. */
export function buildValue(options, parsePhaseRollout) {
  const value = JSON.stringify(options.mode === 'pilot'
    ? { mode: 'pilot', requestIds: options.requestIds.map((id) => id.toLowerCase()) }
    : { mode: options.mode });
  if (!parsePhaseRollout(value)) throw new Error('That value would be read as off by the app (pilot needs 1 to 200 valid request GUIDs).');
  return value;
}

async function resolveActorProfileId(email) {
  const path = require('path');
  const { Client } = require('pg');
  const { withVerifyFullSslmode } = require(path.join(process.cwd(), 'lib/db/pg-connection-string'));
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is not set');
  const client = new Client({ connectionString: withVerifyFullSslmode(process.env.POSTGRES_URL) });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(
      'SELECT id FROM user_profiles WHERE lower(azure_email) = lower($1) AND is_active = true',
      [email],
    );
    await client.query('ROLLBACK');
    if (rows.length !== 1) throw new Error('That email does not match exactly one active staff profile.');
    return Number(rows[0].id);
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log('Usage: node scripts/set-workbench-phase-rollout.mjs [off|on|pilot <guid,...>] [--execute --expected-revision=<etag|none> --actor-email=<email>]');
    return;
  }
  if (process.env.VERCEL_ENV) throw new Error('Run locally, not inside a deployment.');

  const { loadEnvLocal } = await import('../lib/dataverse/client.js');
  loadEnvLocal();
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('set-workbench-phase-rollout');
  const settingsModule = await import('../lib/services/settings-service.js');
  const settings = settingsModule.default || settingsModule;
  const { PHASE_ROLLOUT_KEY, parsePhaseRollout } = await import('../lib/services/workbench/phase-admission.js');

  console.log(`Dataverse: ${new URL(process.env.DYNAMICS_URL).hostname}`);
  const current = await settings.getSettingStrict(PHASE_ROLLOUT_KEY);
  const currentRevision = current.found ? current.revision : 'none';
  console.log(`Current value: ${current.found ? current.value : '(no row)'}`);
  console.log(`Current revision: ${currentRevision}`);
  if (current.found) {
    const parsed = parsePhaseRollout(current.value);
    console.log(`The app reads it as: ${parsed ? parsed.mode : 'off (not a recognised form)'}`);
  } else {
    console.log('The app reads it as: off in Production, on elsewhere (no row)');
  }
  if (!options.mode) return;

  const value = buildValue(options, parsePhaseRollout);
  console.log(`New value: ${value}`);
  if (!options.execute) {
    console.log(`Dry run; nothing written. To apply, add: --execute --expected-revision=${currentRevision} --actor-email=<your staff email>`);
    return;
  }
  if (options.expectedRevision !== currentRevision) {
    throw new Error('The stored revision changed since your dry run. Run the dry run again.');
  }

  const profileId = await resolveActorProfileId(options.actorEmail);
  const { resolveProfileToSystemUser } = await import('../lib/services/dataverse-identity-map.js');
  const actor = await resolveProfileToSystemUser(profileId);
  if (!actor?.systemuserid) throw new Error('That staff profile has no active Dynamics user to record as the editor.');

  await settings.setSettingIfUnchanged(PHASE_ROLLOUT_KEY, value, current.found ? current.revision : null, profileId);
  const after = await settings.getSettingStrict(PHASE_ROLLOUT_KEY);
  const readBack = after.found ? parsePhaseRollout(after.value) : null;
  if (!readBack || after.value !== value) throw new Error('Written, but the read-back does not match. Check the setting before relying on it.');
  console.log(`Written and read back: the app now reads ${readBack.mode}${readBack.mode === 'pilot' ? ` (${readBack.requestIds.length} requests)` : ''}. Editor: ${actor.fullname || 'recorded'}.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
