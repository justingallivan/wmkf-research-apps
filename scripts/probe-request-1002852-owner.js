#!/usr/bin/env node

/**
 * Read-only ownership and creation attribution for production Request 1002852.
 * Pins the production target and request number; prints no GUIDs or credentials.
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-request-1002852-owner.js
 */

const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const PRODUCTION_URL = 'https://wmkf.crm.dynamics.com';
const REQUEST_NUMBER = '1002852';

async function readUser(client, id) {
  if (!id) return null;
  const response = await client.get(`/systemusers(${id})?$select=systemuserid,fullname,applicationid`);
  if (!response.ok) throw new Error(`SystemUser GET returned HTTP ${response.status}.`);
  return response.body;
}

async function main() {
  loadEnvLocal();
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes.');
  }
  if (process.env.DYNAMICS_URL !== PRODUCTION_URL) {
    throw new Error('DYNAMICS_URL does not match the pinned production target.');
  }
  const client = createClient({
    resourceUrl: PRODUCTION_URL,
    token: await getAccessToken(PRODUCTION_URL),
  });
  const fields = [
    'akoya_requestid', 'akoya_requestnum', '_ownerid_value', '_createdby_value',
    '_owninguser_value', '_owningteam_value', 'createdon',
  ];
  const filter = encodeURIComponent(`akoya_requestnum eq '${REQUEST_NUMBER}'`);
  const response = await client.get(
    `/akoya_requests?$select=${fields.join(',')}&$filter=${filter}&$top=2`,
    { Prefer: 'odata.include-annotations="Microsoft.Dynamics.CRM.lookuplogicalname"' },
  );
  if (!response.ok) throw new Error(`Production Request GET returned HTTP ${response.status}.`);
  const rows = response.body?.value || [];
  if (rows.length !== 1 || rows[0].akoya_requestnum !== REQUEST_NUMBER) {
    throw new Error(`Expected exactly one Request ${REQUEST_NUMBER}; found ${rows.length}.`);
  }
  const row = rows[0];
  const ownerType = row['_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname'] ?? null;
  const owner = ownerType === 'systemuser' ? await readUser(client, row._ownerid_value) : null;
  const creator = await readUser(client, row._createdby_value);
  console.log(JSON.stringify({
    mode: 'READ_ONLY_PRODUCTION_REQUEST_ATTRIBUTION',
    checkedAt: new Date().toISOString(),
    requestNumber: REQUEST_NUMBER,
    createdOn: row.createdon ?? null,
    ownerType,
    ownerName: owner?.fullname ?? null,
    ownerIsApplicationUser: owner?.applicationid ? true : owner ? false : null,
    ownerMatchesAuthenticatedApplication: owner?.applicationid
      ? owner.applicationid.toLowerCase() === process.env.DYNAMICS_CLIENT_ID?.toLowerCase()
      : null,
    creatorName: creator?.fullname ?? null,
    creatorIsApplicationUser: creator?.applicationid ? true : creator ? false : null,
    ownerEqualsCreator: Boolean(row._ownerid_value && row._ownerid_value === row._createdby_value),
    ownerEqualsOwningUser: Boolean(row._ownerid_value && row._ownerid_value === row._owninguser_value),
    owningTeamPresent: Boolean(row._owningteam_value),
  }, null, 2));
}

main().catch((error) => {
  console.error(`FATAL: ${error.message}`);
  process.exitCode = 1;
});
