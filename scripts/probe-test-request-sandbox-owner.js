#!/usr/bin/env node

/**
 * Read-only ownership readback for the one retained Test Request rehearsal row.
 * Pins the sandbox target and fixture; prints no user IDs or credentials.
 * The original POST omitted ownerid and owneridtype. This probe observes the
 * resulting row, but cannot prove the same defaults in another environment.
 * Usage: DYNAMICS_SANDBOX_URL=https://orgd9e66399.crm.dynamics.com \
 *   node scripts/probe-test-request-sandbox-owner.js
 */

const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
const REQUEST_ID = '46ff3ea9-8933-4f5d-91a9-3ee8ac54dad5';
const REQUEST_NUMBER = '1000338';
const RUN_ID = 'a62e6ed6-d794-4539-89c1-9723732d1d8d';

async function main() {
  loadEnvLocal();
  if (process.env.DYNAMICS_SANDBOX_URL !== SANDBOX_URL) {
    throw new Error('DYNAMICS_SANDBOX_URL does not match the pinned sandbox target.');
  }
  const client = createClient({
    resourceUrl: SANDBOX_URL,
    token: await getAccessToken(SANDBOX_URL),
  });
  const fields = [
    'akoya_requestid', 'akoya_requestnum', '_ownerid_value', '_createdby_value',
    '_owninguser_value', '_owningteam_value', 'wmkf_istestrequest',
    'wmkf_testcreationrunid',
  ];
  const response = await client.get(
    `/akoya_requests(${REQUEST_ID})?$select=${fields.join(',')}`,
    { Prefer: 'odata.include-annotations="Microsoft.Dynamics.CRM.lookuplogicalname"' },
  );
  if (!response.ok) throw new Error(`Sandbox Request GET returned HTTP ${response.status}.`);
  const row = response.body || {};
  if (row.akoya_requestid?.toLowerCase() !== REQUEST_ID
      || row.akoya_requestnum !== REQUEST_NUMBER
      || row.wmkf_istestrequest !== true
      || row.wmkf_testcreationrunid?.toLowerCase() !== RUN_ID) {
    throw new Error('The sandbox Request did not match the pinned rehearsal fixture.');
  }
  const ownerResponse = row._ownerid_value
    ? await client.get(`/systemusers(${row._ownerid_value})?$select=systemuserid,applicationid`)
    : null;
  const ownerApplicationId = ownerResponse?.ok ? ownerResponse.body?.applicationid : null;
  console.log(JSON.stringify({
    mode: 'READ_ONLY_SANDBOX_OWNER_READBACK',
    checkedAt: new Date().toISOString(),
    requestNumber: REQUEST_NUMBER,
    ownerPresent: Boolean(row._ownerid_value),
    ownerLookupType: row['_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname'] ?? null,
    createdByPresent: Boolean(row._createdby_value),
    ownerEqualsCreatedBy: Boolean(row._ownerid_value && row._ownerid_value === row._createdby_value),
    ownerEqualsOwningUser: Boolean(row._ownerid_value && row._ownerid_value === row._owninguser_value),
    ownerUserReadStatus: ownerResponse?.status ?? null,
    ownerMatchesAuthenticatedApplication: ownerApplicationId
      ? ownerApplicationId.toLowerCase() === process.env.DYNAMICS_CLIENT_ID?.toLowerCase()
      : null,
    owningTeamPresent: Boolean(row._owningteam_value),
  }, null, 2));
}

main().catch((error) => {
  console.error(`FATAL: ${error.message}`);
  process.exitCode = 1;
});
