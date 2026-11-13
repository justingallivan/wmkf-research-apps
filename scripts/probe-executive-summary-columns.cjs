#!/usr/bin/env node
/** Read-only metadata census for Executive Summary field planning. No Request content or writes. */
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
    const response = await client.get(`${base}?$select=LogicalName,AttributeType,DisplayName,IsSecured,IsValidForUpdate,RequiredLevel,IsAuditEnabled`);
    if (!response.ok || response.body['@odata.nextLink']) throw new Error(`Incomplete metadata ${entity}`);
    const candidates = response.body.value.filter(a => /summary|abstract|initialassessment|narrative/i.test(a.LogicalName + ' ' + (a.DisplayName?.UserLocalizedLabel?.Label || '')));
    report.entities[entity] = [];
    for (const a of candidates) {
      let maxLength = null;
      if (['Memo', 'String'].includes(a.AttributeType)) {
        const r = await client.get(`${base}(LogicalName='${a.LogicalName}')/Microsoft.Dynamics.CRM.${a.AttributeType}AttributeMetadata?$select=MaxLength,Format`);
        if (!r.ok) throw new Error(`Typed metadata failed ${a.LogicalName}`);
        maxLength = r.body.MaxLength;
      }
      report.entities[entity].push({ field: a.LogicalName, label: a.DisplayName?.UserLocalizedLabel?.Label || null,
        type: a.AttributeType, maxLength, secured: a.IsSecured, updateable: a.IsValidForUpdate,
        required: a.RequiredLevel?.Value, audited: a.IsAuditEnabled?.Value });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Metadata probe failed; no writes attempted.'); process.exitCode = 1; });
