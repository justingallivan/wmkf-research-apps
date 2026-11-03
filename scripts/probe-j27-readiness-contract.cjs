#!/usr/bin/env node
/** Read-only Production probe: readiness metadata + requests 1003391/1003384.
 * Authorized by Justin 2026-11-02. No Dataverse writes; no flow execution.
 * Run: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-j27-readiness-contract.cjs
 * Emits only field metadata and the named requests' readiness/status/cycle data.
 */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
async function main() {
  loadEnvLocal();
  const { PRODUCTION_HOSTS } = await import('../lib/dataverse/core/target-registry.js');
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!PRODUCTION_HOSTS.includes(new URL(resourceUrl).hostname.toLowerCase())) throw new Error('Registered Production target required.');
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Explicit Production read authorization required.');
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const get = async (path) => {
    const r = await client.get(path);
    if (!r.ok) throw new Error(`Read failed: HTTP ${r.status}`);
    return r.body;
  };
  const path = "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='wmkf_readyforreview')";
  const metadata = await get(`${path}?$select=LogicalName,AttributeType,DisplayName,Description,IsValidForRead,IsValidForCreate,IsValidForUpdate`);
  let options = null;
  if (['Picklist', 'Boolean'].includes(metadata.AttributeType)) {
    options = await get(`${path}/Microsoft.Dynamics.CRM.${metadata.AttributeType}AttributeMetadata?$select=LogicalName&$expand=OptionSet`);
  }
  const select = 'akoya_requestid,akoya_requestnum,wmkf_readyforreview,akoya_requeststatus,wmkf_phaseistatus,wmkf_phaseiistatus,_wmkf_grantcycle_value,wmkf_istestrequest';
  const filter = encodeURIComponent("akoya_requestnum eq '1003391' or akoya_requestnum eq '1003384'");
  const requests = await get(`/akoya_requests?$select=${select}&$filter=${filter}&$expand=wmkf_GrantCycle($select=wmkf_cyclecode)&$top=3`);
  if (requests['@odata.nextLink']) throw new Error('Unexpected paging; evidence incomplete.');
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), target: 'production', methods: ['GET'], metadata, options, requests: requests.value }, null, 2));
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
