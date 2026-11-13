#!/usr/bin/env node
/** Apply only the existing Lay Abstract definition from wave36 to the pinned Sandbox. No records or Production writes. */
const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
const { ensureAttribute } = require('../lib/dataverse/schema-apply.js');
const spec = require('../lib/dataverse/schema/wave36-request-narratives/akoya_request-narratives.json');
const solution = require('../lib/dataverse/schema/solution.json');
const ORIGIN = 'https://orgd9e66399.crm.dynamics.com';
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--execute') || args.length > 1 || process.env.DYNAMICS_URL !== ORIGIN
    || process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') throw Error('Pinned Sandbox and interlock required');
  const attribute = spec.attributes.find(a => a.schemaName === 'wmkf_LayAbstract');
  if (spec.entityLogicalName !== 'akoya_request' || !attribute || attribute.type !== 'Memo' || attribute.maxLength !== 100000) throw Error('Unexpected schema');
  const client = createClient({ resourceUrl: ORIGIN, token: await getAccessToken(ORIGIN),
    solutionUniqueName: solution.uniqueName, dryRun: !args.includes('--execute') });
  // No publisher/solution creation or second-column provisioning.
  const result = await ensureAttribute(client, 'akoya_request', attribute);
  console.log(JSON.stringify({ at: new Date().toISOString(), origin: ORIGIN, execute: args.includes('--execute'), field: 'wmkf_layabstract', result }));
}
main().catch(() => { console.error('Sandbox Executive Summary schema operation failed; inspect metadata before retry.'); process.exitCode = 1; });
