#!/usr/bin/env node

/**
 * Read-only Dataverse probe for retired reviewer standalone app grants.
 *
 * Reports users who hold legacy reviewer-finder/review-manager grants without
 * the consolidated reviewers grant. Does not grant, revoke, or patch anything.
 */

const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

loadEnvLocal();

const APP_KEYS = ['reviewer-finder', 'review-manager', 'reviewers'];
const LEGACY_KEYS = new Set(['reviewer-finder', 'review-manager']);
const CONSOLIDATED_KEY = 'reviewers';

function escapeODataString(value) {
  return String(value).replace(/'/g, "''");
}

async function getClient() {
  const url = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_SANDBOX_URL / DYNAMICS_URL not set');
  const token = await getAccessToken(url);
  return createClient({ resourceUrl: url, token });
}

async function getAllGrants(client) {
  const filter = APP_KEYS.map((key) => `wmkf_appkey eq '${escapeODataString(key)}'`).join(' or ');
  let pathOrUrl = `/wmkf_appuserappaccesses?$filter=${encodeURIComponent(filter)}&$select=wmkf_appkey,_wmkf_user_value&$top=5000`;
  const rows = [];

  while (pathOrUrl) {
    const response = await client.get(pathOrUrl);
    if (!response.ok) {
      throw new Error(`list grants failed: ${response.status} ${response.text?.slice(0, 300)}`);
    }
    rows.push(...(response.body?.value || []));
    pathOrUrl = response.body?.['@odata.nextLink'] || null;
  }

  return rows;
}

async function main() {
  const client = await getClient();
  const grants = await getAllGrants(client);
  const keysByUser = new Map();

  for (const row of grants) {
    const userId = row._wmkf_user_value;
    const appKey = row.wmkf_appkey;
    if (!userId || !appKey) continue;
    if (!keysByUser.has(userId)) keysByUser.set(userId, new Set());
    keysByUser.get(userId).add(appKey);
  }

  const legacyOnlyUsers = [...keysByUser.entries()]
    .filter(([, keys]) => [...keys].some((key) => LEGACY_KEYS.has(key)) && !keys.has(CONSOLIDATED_KEY))
    .sort(([a], [b]) => a.localeCompare(b));

  if (legacyOnlyUsers.length === 0) {
    console.log('No legacy-only reviewer app grants found.');
    return;
  }

  console.log('Legacy reviewer app grants without reviewers grant:');
  for (const [userId, keys] of legacyOnlyUsers) {
    console.log(`  - ${userId}: ${[...keys].sort().join(', ')}`);
  }
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
