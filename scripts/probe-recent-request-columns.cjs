#!/usr/bin/env node
/** Read-only creation-date census for Request and Request Document columns. No record content or writes. */
const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
const TARGETS = { sandbox: 'https://orgd9e66399.crm.dynamics.com', production: 'https://wmkf.crm.dynamics.com' };
async function main() {
  const target = process.argv[2] || 'sandbox';
  const ORIGIN = TARGETS[target];
  if (process.argv.length > 3 || !ORIGIN || process.env.DYNAMICS_URL !== ORIGIN
    || (target === 'production' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes')) throw new Error('Explicit pinned target and read authorization required');
  const client = createClient({ resourceUrl: ORIGIN, token: await getAccessToken(ORIGIN) });
  const report = { at: new Date().toISOString(), origin: ORIGIN, entities: {} };
  for (const entity of ['akoya_request', 'wmkf_requestdocument']) {
    const base = `/EntityDefinitions(LogicalName='${entity}')/Attributes`;
    const response = await client.get(`${base}?$select=LogicalName,AttributeType,DisplayName,CreatedOn,IsCustomAttribute,AttributeOf`);
    if (!response.ok || response.body['@odata.nextLink']) throw new Error(`Incomplete metadata ${entity}`);
    report.entities[entity] = response.body.value.map(a => ({field:a.LogicalName,label:a.DisplayName?.UserLocalizedLabel?.Label||null,type:a.AttributeType,created:a.CreatedOn,custom:a.IsCustomAttribute,attributeOf:a.AttributeOf}));
  }
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Metadata probe failed; no writes attempted.'); process.exitCode = 1; });
