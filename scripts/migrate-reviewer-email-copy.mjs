#!/usr/bin/env node
/**
 * Replace the live reviewer email bodies with the current seed copy.
 *
 * Why this exists: the seed constants in lib/seed/email-defaults/ are init data,
 * NOT a runtime fallback — readRequiredEmailDefaults reads the live
 * wmkf_appsystemsettings row and SKIPS the send (with an ops alert) when it is
 * blank. So a code-only copy change never reaches a recipient. This script is the
 * only supported way to push seed copy onto the live settings.
 *
 * Owner-authorized 2026-07-27 to overwrite staff-edited wording wholesale; PDs
 * were to be alerted to re-check their settings afterward.
 *
 * SCOPE: the four GLOBAL admin bodies below (wmkf_appsystemsettings). It does NOT
 * touch per-PD reviewer invitation/materials templates, which live in
 * wmkf_appuserpreferences and the per-PD template store — those keep their own
 * wording and are unaffected.
 *
 * Idempotent by comparison, not by flag: each key is compared to the desired text
 * and skipped when already equal, so a repeat run writes nothing.
 *
 * Reversibility: a dry run prints each key's CURRENT value in full. Capture it
 * (`node scripts/migrate-reviewer-email-copy.mjs > before.txt`) before executing —
 * that transcript is the restore path.
 *
 *   node scripts/migrate-reviewer-email-copy.mjs             # dry run (default)
 *   node scripts/migrate-reviewer-email-copy.mjs --execute   # write
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  REVIEWER_ACCEPTANCE_SEED_BODY,
  REVIEWER_WITHDRAW_SEED_BODY,
} from '../lib/seed/email-defaults/reviewer-actions.js';
import {
  REVIEWER_REMINDER_RESPOND_BY_SEED_BODY,
  REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY,
} from '../lib/seed/email-defaults/reviewer-reminders.js';

/** Setting key → the seed constant that is now canonical for it. */
export const REVIEWER_BODY_TARGETS = Object.freeze([
  { key: 'email.reviewer_withdraw.body', desired: REVIEWER_WITHDRAW_SEED_BODY },
  { key: 'email.reviewer_acceptance.body', desired: REVIEWER_ACCEPTANCE_SEED_BODY },
  { key: 'email.reviewer_reminder_respond_by.body', desired: REVIEWER_REMINDER_RESPOND_BY_SEED_BODY },
  { key: 'email.reviewer_reminder_review_due.body', desired: REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY },
]);

/**
 * Build the change plan. Pure — no writes, no env, fully unit-testable.
 *
 * A key whose live row is missing or blank is reported as `missing`, NOT written:
 * a blank row means the send is already failing loudly via the ops alert, and
 * silently populating it here would hide a misconfiguration this script did not
 * diagnose. Fix those in /admin deliberately.
 *
 * @param {{ getSettingStrict: Function, targets?: Array }} args
 */
export async function planReviewerCopyMigration({ getSettingStrict, targets = REVIEWER_BODY_TARGETS }) {
  const rows = [];
  for (const { key, desired } of targets) {
    let before = null;
    let status;
    try {
      const result = await getSettingStrict(key);
      before = result?.found ? String(result.value ?? '') : null;
    } catch (error) {
      rows.push({ key, status: 'error', before: null, desired, error: String(error?.message || error) });
      continue;
    }
    if (before === null || before.trim() === '') status = 'missing';
    else if (before === desired) status = 'no-change';
    else status = 'change';
    rows.push({ key, status, before, desired });
  }
  return rows;
}

/**
 * Apply the plan. Only `change` rows are written.
 *
 * @param {{ setSetting: Function, plan: Array, dryRun?: boolean, logger?: Console }} args
 */
export async function executeReviewerCopyMigration({ setSetting, plan, dryRun = true, logger = console }) {
  if (dryRun) return { updated: 0, failed: 0 };
  if (typeof setSetting !== 'function') throw new Error('setSetting is required for execute mode');
  let updated = 0;
  let failed = 0;
  for (const row of plan) {
    if (row.status !== 'change') continue;
    const ok = await setSetting(row.key, row.desired, null);
    if (ok === false) {
      failed++;
      logger.error(`FAILED ${row.key}`);
    } else {
      updated++;
      logger.log(`WROTE ${row.key}`);
    }
  }
  return { updated, failed };
}

function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, name, raw] = match;
      if (process.env[name] !== undefined) continue;
      process.env[name] = raw.trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // env may already be supplied by the shell
  }
}

function report(plan, logger = console) {
  for (const row of plan) {
    logger.log(`\n=== ${row.key} — ${row.status.toUpperCase()} ===`);
    if (row.status === 'error') {
      logger.log(`  read failed: ${row.error}`);
      continue;
    }
    logger.log('--- CURRENT (save this to restore) ---');
    logger.log(row.before === null ? '(not set)' : row.before);
    if (row.status === 'change') {
      logger.log('--- REPLACED BY ---');
      logger.log(row.desired);
    }
  }
}

async function main() {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute;
  loadEnvLocal();

  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const settings = await import('../lib/services/settings-service.js');
  enterDynamicsBypassForScript('migrate-reviewer-email-copy');

  console.log(`migrate-reviewer-email-copy: ${dryRun ? 'DRY RUN (pass --execute to write)' : 'EXECUTE'}`);
  const plan = await planReviewerCopyMigration({
    getSettingStrict: settings.getSettingStrict || settings.default?.getSettingStrict,
  });
  report(plan);

  const result = await executeReviewerCopyMigration({
    setSetting: settings.setSetting || settings.default?.setSetting,
    plan,
    dryRun,
    logger: console,
  });

  const counts = plan.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  console.log(`\ndone: ${JSON.stringify(counts)} updated=${result.updated} failed=${result.failed}`);
  if (dryRun) console.log('No writes were made. Re-run with --execute to apply.');
  if (result.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
