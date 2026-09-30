#!/usr/bin/env node
/** Read-only field-discovery probe; no request rows or metadata are changed.
 * Usage: node scripts/probe-request-integrity-metadata.js --target=prod|sandbox
 * Reports metadata only. A keyword miss is not proof no equivalent field exists.
 */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

async function main() {
  const target = process.argv.find((arg) => arg.startsWith('--target='))?.slice(9);
  if (!['prod', 'sandbox'].includes(target)) throw new Error('Specify --target=prod or --target=sandbox');
  loadEnvLocal();
  const resourceUrl = target === 'prod' ? process.env.DYNAMICS_URL : process.env.DYNAMICS_SANDBOX_URL;
  if (!resourceUrl) throw new Error('Target URL is not configured');
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), dryRun: true });
  const entityPath = "/EntityDefinitions(LogicalName='akoya_request')";
  const entity = await client.get(`${entityPath}?$select=LogicalName,IsCustomizable,IsAuditEnabled,IsOptimisticConcurrencyEnabled`);
  if (!entity.ok) throw new Error(`Entity metadata HTTP ${entity.status}`);
  const fields = [];
  let next = `${entityPath}/Attributes?$select=LogicalName,SchemaName,DisplayName,Description,AttributeType,IsValidForUpdate,IsSecured,IsAuditEnabled`;
  while (next) {
    const result = await client.get(next);
    if (!result.ok) throw new Error(`Attribute metadata HTTP ${result.status}`);
    if (!Array.isArray(result.body?.value)) throw new Error('Unexpected attribute metadata response');
    fields.push(...result.body.value);
    next = result.body['@odata.nextLink'];
    if (next && new URL(next, resourceUrl).origin !== new URL(resourceUrl).origin) {
      throw new Error('Refusing cross-origin metadata pagination');
    }
  }
  const matches = fields.filter((field) => /integrity|retraction|pubpeer|screen|background.check/i.test(JSON.stringify(field)));
  console.log(JSON.stringify({ target, entity: entity.body, attributesExamined: fields.length,
    keywordMatches: matches, proposedNamesPresent: fields.filter((field) =>
      ['wmkf_integrityscreencompleted', 'wmkf_integrityreviewcomplete'].includes(field.LogicalName)) }, null, 2));
}

main().catch((error) => {
  // Do not print credentials, token-response bodies, or raw remote errors.
  console.error(`Metadata probe failed: ${error.message.startsWith('Specify') || error.message.startsWith('Target') || /metadata|pagination/.test(error.message) ? error.message : 'authentication or transport failure'}`);
  process.exitCode = 1;
});
