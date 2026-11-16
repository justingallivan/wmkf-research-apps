#!/usr/bin/env node
/** Read-only metadata probe; never reads request content or changes schema. */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
const { parseTargetArg, resolveTargetResource } = require('./lib/dataverse-script-target.cjs');
async function main() {
  loadEnvLocal();
  const target = parseTargetArg(process.argv.slice(2));
  const resourceUrl = resolveTargetResource({ target, write: false });
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const result = await client.get("/EntityDefinitions(LogicalName='akoya_request')/Attributes/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=LogicalName,SchemaName,DisplayName,MaxLength,RequiredLevel,IsValidForRead,IsValidForUpdate,AttributeType");
  if (!result.ok || !Array.isArray(result.body?.value) || result.body['@odata.nextLink']) {
    throw new Error(`Metadata census incomplete (HTTP ${result.status}).`);
  }
  const fields = result.body.value.filter(a => /lay|initial.*assess/i.test(a.LogicalName)
    || /lay abstract|initial assessment/i.test(a.DisplayName?.UserLocalizedLabel?.Label || ''));
  let verified = false;
  if (process.argv.includes('--verify')) {
    const spec = require('../lib/dataverse/schema/wave36-request-narratives/akoya_request-narratives.json');
    for (const expected of spec.attributes) {
      const actual = fields.find(field => field.LogicalName === expected.schemaName.toLowerCase());
      const label = actual?.DisplayName?.LocalizedLabels?.find(entry => entry.LanguageCode === 1033)?.Label;
      if (!actual || actual.AttributeType !== 'Memo' || actual.SchemaName !== expected.schemaName
        || actual.MaxLength !== expected.maxLength || actual.RequiredLevel?.Value !== 'None'
        || label !== expected.displayName || actual.IsValidForRead !== true || actual.IsValidForUpdate !== true) {
        throw new Error(`Metadata verification failed for ${expected.schemaName}.`);
      }
    }
    // A primary key cannot be null: validate the runtime projection without
    // retrieving any business record or its narrative content.
    const select = spec.attributes.map(field => field.schemaName.toLowerCase()).join(',');
    const readable = await client.get(`/akoya_requests?$select=${select}&$filter=akoya_requestid%20eq%20null&$top=1`);
    if (!readable.ok || !Array.isArray(readable.body?.value) || readable.body.value.length !== 0) {
      throw new Error(`Metadata runtime projection failed (HTTP ${readable.status}).`);
    }
    verified = true;
  }
  console.log(JSON.stringify({ target, host: new URL(resourceUrl).hostname, fields, verified }, null, 2));
}
main().catch(error => { console.error(error.message.startsWith('Metadata ') ? error.message : 'Probe failed; check target configuration, credentials and connectivity.'); process.exitCode = 1; });
