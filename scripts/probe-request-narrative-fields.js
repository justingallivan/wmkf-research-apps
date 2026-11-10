#!/usr/bin/env node
/** Read-only metadata probe; never reads request content or changes schema. */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
const { parseTargetArg, resolveTargetResource } = require('./lib/dataverse-script-target.cjs');
async function main() {
  loadEnvLocal();
  const target = parseTargetArg(process.argv.slice(2));
  const resourceUrl = resolveTargetResource({ target, write: false });
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const result = await client.get("/EntityDefinitions(LogicalName='akoya_request')/Attributes/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=LogicalName,SchemaName,DisplayName,MaxLength,RequiredLevel,IsValidForRead,IsValidForUpdate");
  if (!result.ok || !Array.isArray(result.body?.value) || result.body['@odata.nextLink']) {
    throw new Error(`Metadata census incomplete (HTTP ${result.status}).`);
  }
  const fields = result.body.value.filter(a => /lay|initial.*assess/i.test(a.LogicalName)
    || /lay abstract|initial assessment/i.test(a.DisplayName?.UserLocalizedLabel?.Label || ''));
  console.log(JSON.stringify({ target, host: new URL(resourceUrl).hostname, fields }, null, 2));
}
main().catch(error => { console.error(error.message.startsWith('Metadata census') ? error.message : 'Probe failed; check target configuration, credentials and connectivity.'); process.exitCode = 1; });
