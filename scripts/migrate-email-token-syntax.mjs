#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

export const SYSTEM_B_EMAIL_KEYS = Object.freeze([
  'email.grantee_invite.subject',
  'email.grantee_invite.body',
  'email.grantee_reminder.subject',
  'email.grantee_reminder.body',
  'email.reviewer_acceptance.subject',
  'email.reviewer_acceptance.body',
  'email.reviewer_withdraw.subject',
  'email.reviewer_withdraw.body',
  'email.reviewer_reminder_respond_by.subject',
  'email.reviewer_reminder_respond_by.body',
  'email.reviewer_reminder_review_due.subject',
  'email.reviewer_reminder_review_due.body',
]);

export const GRANTEE_INVITE_BODY_PREFERENCE_KEY = 'grantee_invite_body';
export const EXPECTED_GRANTEE_INVITE_BODY_ROWS = 2;

export const TOKEN_MAP = Object.freeze([
  ['[Program Director signature]', '{{signature}}'],
  ['[proposal title clause]', '{{proposalClause}}'],
  ['[review due date]', '{{reviewDueDate}}'],
  ['[Reviewer Name]', '{{reviewerName}}'],
  ['[reviewerName]', '{{reviewerName}}'],
  ['[reviewDueDate]', '{{reviewDueDate}}'],
  ['[requestNumber]', '{{requestNumber}}'],
  ['COB [date]', 'COB {{dueDate}}'],
  ['[signature]', '{{signature}}'],
  ['[greeting]', '{{greeting}}'],
  ['[proposal]', '{{proposalClause}}'],
  ['[Name]', '{{granteeName}}'],
]);

export const TITLE_TOKEN_MAPS = Object.freeze({
  proposalTitle: Object.freeze([['[title]', '{{proposalTitle}}']]),
  proposalClause: Object.freeze([['[title]', '{{proposalClause}}']]),
});

function sortedTokenMap(extraMap = TITLE_TOKEN_MAPS.proposalTitle) {
  return Object.freeze([...TOKEN_MAP, ...extraMap].sort((a, b) => b[0].length - a[0].length));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(text, token) {
  return (String(text).match(new RegExp(escapeRegExp(token), 'g')) || []).length;
}

export function inventoryTokens(value) {
  const text = String(value ?? '');
  const legacy = Array.from(new Set(text.match(/\[[^\]]+\]/g) || [])).sort();
  const mustache = Array.from(new Set(text.match(/{{[^}]+}}/g) || [])).sort();
  return { legacy, mustache };
}

export function migrateText(value, { tokenMap = sortedTokenMap() } = {}) {
  let next = String(value ?? '');
  const replacements = [];
  for (const [legacy, mustache] of tokenMap) {
    const count = countOccurrences(next, legacy);
    if (count === 0) continue;
    next = next.split(legacy).join(mustache);
    replacements.push({ legacy, mustache, count });
  }

  const unknownLegacyTokens = inventoryTokens(next).legacy;
  if (unknownLegacyTokens.length) {
    throw new Error(`Unknown bracket token(s): ${unknownLegacyTokens.join(', ')}`);
  }

  let reversed = next;
  for (const { legacy, mustache, count } of replacements) {
    let remaining = count;
    reversed = reversed.replace(new RegExp(escapeRegExp(mustache), 'g'), (match) => {
      if (remaining <= 0) return match;
      remaining -= 1;
      return legacy;
    });
  }
  if (reversed !== String(value ?? '')) {
    throw new Error('Copy-preservation reverse-substitution assertion failed');
  }

  return {
    before: String(value ?? ''),
    after: next,
    changed: next !== String(value ?? ''),
    replacements,
    beforeInventory: inventoryTokens(value),
    afterInventory: inventoryTokens(next),
  };
}

export function tokenMapForAdminKey(key) {
  return sortedTokenMap(
    key === 'email.reviewer_withdraw.body'
      ? TITLE_TOKEN_MAPS.proposalClause
      : TITLE_TOKEN_MAPS.proposalTitle,
  );
}

export function assertExpectedPreferenceCount(rows, {
  expectedCount = EXPECTED_GRANTEE_INVITE_BODY_ROWS,
  allowCountDrift = false,
} = {}) {
  if (!allowCountDrift && rows.length !== expectedCount) {
    throw new Error(
      `Expected exactly ${expectedCount} ${GRANTEE_INVITE_BODY_PREFERENCE_KEY} row(s), found ${rows.length}; run a fresh read-only probe before execution.`,
    );
  }
}

export async function planEmailTokenMigration({
  getSettingStrict,
  listGranteeInviteBodyPreferences,
  dryRun = true,
  allowCountDrift = false,
  logger = console,
} = {}) {
  if (typeof getSettingStrict !== 'function') throw new Error('getSettingStrict is required');
  if (typeof listGranteeInviteBodyPreferences !== 'function') {
    throw new Error('listGranteeInviteBodyPreferences is required');
  }

  const admin = [];
  for (const key of SYSTEM_B_EMAIL_KEYS) {
    const current = await getSettingStrict(key);
    const value = current?.found ? String(current.value ?? '') : '';
    const result = migrateText(value, { tokenMap: tokenMapForAdminKey(key) });
    logger.log(`${dryRun ? 'DRY' : 'PLAN'} admin ${key}: ${result.changed ? 'change' : 'no-change'}`);
    logger.log(`  before tokens: ${JSON.stringify(result.beforeInventory)}`);
    logger.log(`  after tokens: ${JSON.stringify(result.afterInventory)}`);
    logger.log(`  token diff: ${result.replacements.map((r) => `${r.legacy}->${r.mustache} x${r.count}`).join(', ') || 'none'}`);
    admin.push({ key, value, ...result });
  }

  const preferenceRows = await listGranteeInviteBodyPreferences();
  assertExpectedPreferenceCount(preferenceRows, { allowCountDrift });
  const preferences = [];
  for (const row of preferenceRows) {
    const value = String(row.value ?? row.wmkf_preferencevalue ?? '');
    const result = migrateText(value, { tokenMap: sortedTokenMap(TITLE_TOKEN_MAPS.proposalTitle) });
    logger.log(`${dryRun ? 'DRY' : 'PLAN'} user ${row.ownerId || row._ownerid_value || 'unknown-owner'}: ${result.changed ? 'change' : 'no-change'}`);
    logger.log(`  before tokens: ${JSON.stringify(result.beforeInventory)}`);
    logger.log(`  after tokens: ${JSON.stringify(result.afterInventory)}`);
    logger.log(`  token diff: ${result.replacements.map((r) => `${r.legacy}->${r.mustache} x${r.count}`).join(', ') || 'none'}`);
    preferences.push({ row, value, ...result });
  }

  return { admin, preferences };
}

export async function executeEmailTokenMigration({
  setSetting,
  patchPreference,
  plan,
  dryRun = true,
  logger = console,
} = {}) {
  if (dryRun) return { adminUpdated: 0, preferencesUpdated: 0 };
  if (typeof setSetting !== 'function') throw new Error('setSetting is required for execute mode');
  if (typeof patchPreference !== 'function') throw new Error('patchPreference is required for execute mode');

  let adminUpdated = 0;
  for (const item of plan.admin) {
    if (!item.changed) continue;
    const ok = await setSetting(item.key, item.after, null);
    if (!ok) throw new Error(`Failed to update setting ${item.key}`);
    adminUpdated += 1;
    logger.log(`UPDATE admin ${item.key}`);
  }

  let preferencesUpdated = 0;
  for (const item of plan.preferences) {
    if (!item.changed) continue;
    await patchPreference(item.row.id || item.row.wmkf_appuserpreferenceid, item.after);
    preferencesUpdated += 1;
    logger.log(`UPDATE user ${item.row.ownerId || item.row._ownerid_value || 'unknown-owner'}`);
  }

  return { adminUpdated, preferencesUpdated };
}

function loadEnvLocal() {
  for (const envFile of ['.env', '.env.local']) {
    try {
      const env = readFileSync(resolve(process.cwd(), envFile), 'utf8');
      for (const line of env.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i === -1) continue;
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    } catch {}
  }
}

async function getDataverseClient() {
  const { getAccessToken, createClient } = await import('../lib/dataverse/client.js');
  const url = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_SANDBOX_URL / DYNAMICS_URL not set');
  const token = await getAccessToken(url);
  return createClient({ resourceUrl: url, token });
}

async function listGranteeInviteBodyPreferences() {
  const client = await getDataverseClient();
  const filter = `wmkf_preferencekey eq '${GRANTEE_INVITE_BODY_PREFERENCE_KEY}'`;
  const r = await client.get(
    `/wmkf_appuserpreferences?$filter=${encodeURIComponent(filter)}&$select=wmkf_appuserpreferenceid,wmkf_preferencevalue,wmkf_isencrypted,_ownerid_value&$top=5000`,
  );
  if (!r.ok) throw new Error(`list grantee invite body preferences failed: ${r.status} ${r.text?.slice(0, 200)}`);
  return (r.body?.value || []).map((row) => ({
    id: row.wmkf_appuserpreferenceid,
    value: row.wmkf_preferencevalue,
    isEncrypted: row.wmkf_isencrypted,
    ownerId: row._ownerid_value,
  }));
}

async function patchPreference(id, value) {
  if (!id) throw new Error('Preference id is required');
  const client = await getDataverseClient();
  const r = await client.patch(`/wmkf_appuserpreferences(${id})`, { wmkf_preferencevalue: value });
  if (!r.ok) throw new Error(`patch preference failed: ${r.status} ${r.text?.slice(0, 200)}`);
}

async function main() {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute;
  const allowCountDrift = process.argv.includes('--allow-count-drift');
  loadEnvLocal();

  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const settings = await import('../lib/services/settings-service.js');
  enterDynamicsBypassForScript('migrate-email-token-syntax');

  console.log(`migrate-email-token-syntax: ${dryRun ? 'DRY RUN (pass --execute to write)' : 'EXECUTE'}`);
  const plan = await planEmailTokenMigration({
    getSettingStrict: settings.getSettingStrict || settings.default?.getSettingStrict,
    listGranteeInviteBodyPreferences,
    dryRun,
    allowCountDrift,
    logger: console,
  });
  const result = await executeEmailTokenMigration({
    setSetting: settings.setSetting || settings.default?.setSetting,
    patchPreference,
    plan,
    dryRun,
    logger: console,
  });
  console.log(`done: adminChanged=${plan.admin.filter((r) => r.changed).length} preferenceChanged=${plan.preferences.filter((r) => r.changed).length} adminUpdated=${result.adminUpdated} preferenceUpdated=${result.preferencesUpdated}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
