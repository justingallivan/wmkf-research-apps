#!/usr/bin/env node
/** Read-only field shape and literal prompt-output bindings; emits no prompt or Request content. */
const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
const TARGETS = { sandbox: 'https://orgd9e66399.crm.dynamics.com', production: 'https://wmkf.crm.dynamics.com' };
async function main() {
  const target = process.argv[2];
  const origin = TARGETS[target];
  if (!origin || process.env.DYNAMICS_URL !== origin || (target === 'production' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes')) throw Error('Pinned read target required');
  const client = createClient({ resourceUrl: origin, token: await getAccessToken(origin) });
  const metadata = await client.get("/EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName,SchemaName,DisplayName,Description,AttributeType,RequiredLevel,IsSecured,IsAuditEnabled,IsManaged,IsValidForRead,IsValidForUpdate&$filter=LogicalName eq 'wmkf_layabstract'");
  if (!metadata.ok || metadata.body['@odata.nextLink']) throw Error('Incomplete metadata');
  const field = metadata.body.value[0] || null;
  let shape = null;
  if (field) {
    const typed = await client.get("/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='wmkf_layabstract')/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=MaxLength,Format");
    if (!typed.ok) throw Error('Missing typed metadata');
    shape = { ...field, MaxLength: typed.body.MaxLength, Format: typed.body.Format };
  }
  // Only rows whose output declaration literally names the physical column.
  // This does not enumerate external flows, forms or dynamically constructed destinations.
  const prompts = await client.get("/wmkf_ai_prompts?$select=wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent&$filter=contains(wmkf_ai_promptoutputschema,'wmkf_layabstract')");
  if (!prompts.ok || prompts.body['@odata.nextLink']) throw Error('Incomplete prompt binding census');
  let runtimeProjectionAccepted = false;
  if (field) {
    const projection = await client.get('/akoya_requests?$select=akoya_requestid,wmkf_layabstract&$top=1&$filter=akoya_requestid eq 00000000-0000-0000-0000-000000000000');
    if (!projection.ok || !Array.isArray(projection.body.value) || projection.body.value.length) throw Error('Unexpected projection result');
    runtimeProjectionAccepted = true;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), origin, field: shape, runtimeProjectionAccepted, literalPromptBindings: prompts.body.value }, null, 2));
}
main().catch(() => { console.error('Read-only Executive Summary binding probe failed.'); process.exitCode = 1; });
