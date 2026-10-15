#!/usr/bin/env node
/** Read-only D97 identity/list attribution probe. Never saves or resets assessments.
 * Usage: node --import ./scripts/lib/use-extensionless.mjs scripts/probe-ranking-test-save-isolation.cjs
 *   --env-file /path/to/dedicated-preview.env --local-env /path/to/local.env
 * Prints bounded metadata, not credentials or individual assessment content.
 */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 4 && args[0] === '--env-file' && args[2] === '--local-env', 'Explicit Preview and local env files required');
  const preview = parseEnv(fs.readFileSync(args[1], 'utf8'));
  const local = parseEnv(fs.readFileSync(args[3], 'utf8'));
  const target = 'https://orgd9e66399.crm.dynamics.com';
  assert(preview.DYNAMICS_URL === target, 'Only the registered sandbox is allowed');
  const dbUrl = new URL(preview.POSTGRES_URL);
  assert(dbUrl.hostname === 'ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech'
    && dbUrl.pathname === '/neondb' && ['postgres:', 'postgresql:'].includes(dbUrl.protocol)
    && [...dbUrl.searchParams.keys()].every(key => ['sslmode', 'channel_binding'].includes(key)), 'Only the dedicated test database is allowed');
  for (const key of ['DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_TENANT_ID']) process.env[key] = local[key];
  Object.assign(process.env, { DYNAMICS_URL: target, DYNAMICS_SANDBOX_URL: target,
    DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'no' });
  const { Client } = require('pg');
  const db = new Client({ connectionString: preview.POSTGRES_URL });
  await db.connect();
  let profiles;
  try {
    profiles = (await db.query('SELECT id, display_name, azure_id, dynamics_systemuser_id, is_active, needs_linking FROM user_profiles ORDER BY id')).rows;
  } finally { await db.end(); }
  const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
  const client = createClient({ resourceUrl: target, token: await getAccessToken(target) });
  async function get(path) {
    const result = await client.get(path);
    assert(result.ok && !result.body['@odata.nextLink'], 'Read failed or incomplete');
    return result.body.value || result.body;
  }
  const cycles = await get("/wmkf_proposalrankingcycles?$filter=wmkf_cyclecode eq 'D97'");
  assert(cycles.length === 1, 'Expected exactly one D97 cycle');
  const roundId = cycles[0].wmkf_activeroundid;
  assert(/^[0-9a-f-]{36}$/i.test(roundId), 'Invalid round pointer');
  const round = await get(`/wmkf_proposalrankingrounds(${roundId})`);
  const snapshot = JSON.parse(round.wmkf_snapshotjson);
  const workflow = JSON.parse(round.wmkf_workflowjson);
  assert(snapshot.cycleCode === 'D97' && snapshot.version === 2, 'Expected D97 v2');
  const rows = await get(`/wmkf_proposalrankinglists?$filter=wmkf_roundid eq '${roundId}'&$select=wmkf_listkey,wmkf_participantsystemuserid,wmkf_updatedbyactorsystemuserid,wmkf_updatedat,wmkf_assessmentjson`);
  const assessments = rows.filter(row => row.wmkf_listkey.startsWith(`p:${workflow.preparationVersion}:`));
  const result = {
    checkedAt: new Date().toISOString(), roundId, stage: workflow.stage,
    identities: snapshot.roster.map(person => {
      const matches = profiles.filter(p => p.dynamics_systemuser_id === person.systemUserId);
      return { name: person.name, matchingProfiles: matches.length,
        active: matches.length === 1 && matches[0].is_active && !matches[0].needs_linking,
        uniqueAzureIdentity: matches.length === 1 && profiles.filter(p => p.azure_id === matches[0].azure_id).length === 1 };
    }),
    assessments: assessments.map(row => {
      const value = JSON.parse(row.wmkf_assessmentjson);
      return { name: snapshot.roster.find(p => p.systemUserId === row.wmkf_participantsystemuserid)?.name,
        program: row.wmkf_listkey.split(':')[2], version: value?.version ?? null,
        answered: Object.keys(value?.confidence || {}).length,
        writerMatchesOwner: row.wmkf_updatedbyactorsystemuserid === row.wmkf_participantsystemuserid,
        updatedAt: row.wmkf_updatedat,
        contentHash: createHash('sha256').update(row.wmkf_assessmentjson).digest('hex') };
    }),
    limitation: 'Latest writer only; initial rows are created by the facilitator. Does not prove historical absence of overwrites or independent SSO behavior.',
  };
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => { console.error('Read-only ranking isolation probe failed; inspect target/configuration without printing secrets.'); process.exitCode = 1; });
