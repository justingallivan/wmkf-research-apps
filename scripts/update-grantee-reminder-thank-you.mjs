#!/usr/bin/env node

/**
 * One-purpose production update: restore the tracked "Thank you," closing in
 * `email.grantee_reminder.body`.
 *
 * Safety:
 * - refuses to run without an explicit `--execute` flag;
 * - accepts only a hostname in the tracked production Dataverse registry;
 * - resolves exactly one Dataverse setting row by key;
 * - accepts only the exact body observed by the 2026-07-27 read-only probe;
 * - no-ops if the tracked target body is already present;
 * - uses the row ETag with If-Match so a concurrent edit aborts; and
 * - re-reads and verifies the exact target hash after PATCH.
 *
 * This does not invoke the reminder cron or send email.
 *
 * Usage: node scripts/update-grantee-reminder-thank-you.mjs --execute
 */

import fs from 'fs';
import { createHash } from 'crypto';
import { GRANTEE_REMINDER_SEED_BODY } from '../lib/seed/email-defaults/grantee-reminder.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';

if (!process.argv.includes('--execute')) {
  console.error('Refusing write without --execute.');
  console.error('Usage: node scripts/update-grantee-reminder-thank-you.mjs --execute');
  process.exit(2);
}

const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2]
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');
  }
}

const {
  DYNAMICS_URL,
  DYNAMICS_TENANT_ID,
  DYNAMICS_CLIENT_ID,
  DYNAMICS_CLIENT_SECRET,
} = process.env;
if (!DYNAMICS_URL || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  console.error('Missing production Dynamics credentials in .env.local.');
  process.exit(2);
}
const targetUrl = new URL(DYNAMICS_URL);
const targetHost = targetUrl.hostname.toLowerCase();
if (targetUrl.protocol !== 'https:' || !PRODUCTION_HOSTS.includes(targetHost)) {
  throw new Error(
    `Refusing write to untracked/non-production Dataverse target: ${targetUrl.origin}`,
  );
}

const KEY = 'email.grantee_reminder.body';
const EXPECTED_BEFORE_SHA256 = '4779ac3bbfd42f4453592e105468c3d10f5babd5dd144485218fc3a4a62226ce';
const EXPECTED_TARGET_SHA256 = '6bc31823750af6477e3764505c568b9c92db84358b84f58eeb020fe92c8d6dfa';
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const TARGET_SHA256 = sha256(GRANTEE_REMINDER_SEED_BODY);
if (TARGET_SHA256 !== EXPECTED_TARGET_SHA256) {
  throw new Error(
    `Tracked seed changed since this one-purpose updater was approved: expected ${EXPECTED_TARGET_SHA256}, got ${TARGET_SHA256}.`,
  );
}

async function getToken() {
  const response = await fetch(
    `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: DYNAMICS_CLIENT_ID,
        client_secret: DYNAMICS_CLIENT_SECRET,
        scope: `${DYNAMICS_URL}/.default`,
      }),
    },
  );
  if (!response.ok) throw new Error(`OAuth token request failed: ${response.status}`);
  return (await response.json()).access_token;
}

async function readRows(token) {
  const filter = encodeURIComponent(`wmkf_settingkey eq '${KEY}'`);
  const response = await fetch(
    `${DYNAMICS_URL}/api/data/v9.2/wmkf_appsystemsettings` +
      `?$select=wmkf_appsystemsettingid,wmkf_settingkey,wmkf_settingvalue,modifiedon&$filter=${filter}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-Version': '4.0',
        Prefer: 'odata.include-annotations="*"',
      },
    },
  );
  if (!response.ok) throw new Error(`Setting read failed: ${response.status} ${await response.text()}`);
  return (await response.json()).value || [];
}

const token = await getToken();
console.log(`target production host=${targetHost}`);
const beforeRows = await readRows(token);
if (beforeRows.length !== 1) {
  throw new Error(`Expected exactly one ${KEY} row; found ${beforeRows.length}. No write performed.`);
}

const before = beforeRows[0];
const beforeValue = String(before.wmkf_settingvalue ?? '');
const beforeHash = sha256(beforeValue);
console.log(`before id=${before.wmkf_appsystemsettingid} modifiedon=${before.modifiedon}`);
console.log(`before sha256=${beforeHash}`);
console.log(`target sha256=${TARGET_SHA256}`);

if (beforeHash === TARGET_SHA256) {
  console.log('NO-OP: tracked target body is already live.');
  process.exit(0);
}
if (beforeHash !== EXPECTED_BEFORE_SHA256) {
  throw new Error(
    `Live body changed since the approved probe: expected ${EXPECTED_BEFORE_SHA256}, got ${beforeHash}. ` +
      'No write performed.',
  );
}

const etag = before['@odata.etag'];
if (!etag) throw new Error('Setting row has no @odata.etag. No write performed.');

const patchResponse = await fetch(
  `${DYNAMICS_URL}/api/data/v9.2/wmkf_appsystemsettings(${before.wmkf_appsystemsettingid})`,
  {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'OData-Version': '4.0',
      'If-Match': etag,
    },
    body: JSON.stringify({ wmkf_settingvalue: GRANTEE_REMINDER_SEED_BODY }),
  },
);
if (!patchResponse.ok) {
  throw new Error(`Conditional setting PATCH failed: ${patchResponse.status} ${await patchResponse.text()}`);
}

const afterRows = await readRows(token);
if (afterRows.length !== 1) {
  throw new Error(`Post-write verification found ${afterRows.length} rows; expected exactly one.`);
}
const afterValue = String(afterRows[0].wmkf_settingvalue ?? '');
const afterHash = sha256(afterValue);
console.log(`after modifiedon=${afterRows[0].modifiedon}`);
console.log(`after sha256=${afterHash}`);
if (afterHash !== TARGET_SHA256) {
  throw new Error(`Post-write hash mismatch: expected ${TARGET_SHA256}, got ${afterHash}.`);
}

console.log('UPDATED: production grantee reminder body now matches the tracked seed with "Thank you,".');
