#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  EDITABLE_TEXT_DEFAULTS,
} from '../shared/config/editableTextDefaults.js';
import {
  GRANTEE_INVITE_SEED_BODY,
  GRANTEE_INVITE_SEED_SUBJECT,
} from '../lib/seed/email-defaults/grantee-invite.js';

export const EMAIL_DEFAULT_SEED_TEXT = Object.freeze({
  'email.grantee_invite.subject': GRANTEE_INVITE_SEED_SUBJECT,
  'email.grantee_invite.body': GRANTEE_INVITE_SEED_BODY,
});

export function loadEnvLocal() {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
}

export async function seedEmailDefaults({
  getSettingStrict,
  setSetting,
  dryRun = true,
  logger = console,
} = {}) {
  if (typeof getSettingStrict !== 'function') {
    throw new Error('seedEmailDefaults requires getSettingStrict');
  }
  if (typeof setSetting !== 'function') {
    throw new Error('seedEmailDefaults requires setSetting');
  }

  const results = [];
  for (const entry of EDITABLE_TEXT_DEFAULTS) {
    const seedText = EMAIL_DEFAULT_SEED_TEXT[entry.key];
    if (typeof seedText !== 'string') {
      throw new Error(`No seed text registered for ${entry.key}`);
    }

    const current = await getSettingStrict(entry.key);
    const value = current?.found ? String(current.value ?? '') : '';
    if (value.trim() !== '') {
      logger.log(`SKIP ${entry.key}: existing non-empty value (${value.length} chars)`);
      results.push({ key: entry.key, action: 'skip-existing', currentLength: value.length });
      continue;
    }

    if (dryRun) {
      logger.log(`DRY ${entry.key}: would create seed value (${seedText.length} chars)`);
      results.push({ key: entry.key, action: 'dry-create', seedLength: seedText.length });
      continue;
    }

    const ok = await setSetting(entry.key, seedText, null);
    if (!ok) {
      throw new Error(`Failed to write ${entry.key}`);
    }
    logger.log(`CREATE ${entry.key}: wrote seed value (${seedText.length} chars)`);
    results.push({ key: entry.key, action: 'created', seedLength: seedText.length });
  }
  return results;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute;

  try {
    loadEnvLocal();
  } catch {
    console.error('Could not read .env.local — run from the repo root.');
    process.exit(2);
  }

  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const settings = await import('../lib/services/settings-service.js');
  enterDynamicsBypassForScript('seed-email-defaults');

  console.log(`seed-email-defaults: ${dryRun ? 'DRY RUN (pass --execute to write)' : 'EXECUTE'}`);
  const results = await seedEmailDefaults({
    getSettingStrict: settings.getSettingStrict || settings.default?.getSettingStrict,
    setSetting: settings.setSetting || settings.default?.setSetting,
    dryRun,
    logger: console,
  });
  const created = results.filter((r) => r.action === 'created').length;
  const planned = results.filter((r) => r.action === 'dry-create').length;
  const skipped = results.filter((r) => r.action === 'skip-existing').length;
  console.log(`done: created=${created} dryCreate=${planned} skippedExisting=${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
