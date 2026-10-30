#!/usr/bin/env node
/** PR553 test-only GET inventory. OAuth exchange is the only POST. No writes,
 * prompt content, tokens or secrets emitted. Does not attest human/operator rights.
 * --env-file ABS --output NEW_ABS_JSON. Fixed tracked test host; no execute mode.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const HOST = 'orgd9e66399.crm.dynamics.com';
function options(args) {
  if (args.length !== 4 || args[0] !== '--env-file' || args[2] !== '--output'
    || !path.isAbsolute(args[1]) || !path.isAbsolute(args[3]) || !fs.existsSync(path.dirname(args[3])) || fs.existsSync(args[3])) {
    throw new Error('Use --env-file ABSOLUTE_FILE --output NEW_ABSOLUTE_JSON; no execute mode.');
  }
  return { envFile: args[1], output: args[3] };
}
function readCredentials(file) {
  const allowed = ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET'];
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.trim().match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (match && allowed.includes(match[1])) values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  for (const key of allowed) { if (!values[key]) throw new Error(`Missing ${key}`); }
  return values;
}
function checkedUrl(relative) {
  const url = new URL(relative, `https://${HOST}/api/data/v9.2/`);
  if (url.origin !== `https://${HOST}` || !url.pathname.startsWith('/api/data/v9.2/') || url.username || url.password || url.hash) throw new Error('Test-only GET boundary rejected.');
  return url;
}
async function main(args) {
  const { envFile, output } = options(args);
  const registry = await import(pathToFileURL(path.resolve(__dirname, '../lib/dataverse/core/target-registry.js')).href);
  if (!registry.SANDBOX_HOSTS.includes(HOST)) throw new Error('Test host not registered.');
  const credentials = readCredentials(envFile);
  if (!/^[0-9a-f-]{36}$/i.test(credentials.DYNAMICS_TENANT_ID)) throw new Error('Invalid tenant identity.');
  const response = await fetch(`https://login.microsoftonline.com/${credentials.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.DYNAMICS_CLIENT_ID, client_secret: credentials.DYNAMICS_CLIENT_SECRET, scope: `https://${HOST}/.default` }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`OAuth HTTP ${response.status}`);
  const { access_token: token } = await response.json();
  if (!token) throw new Error('OAuth token missing.');
  const requests = [];
  async function get(relative) {
    const url = checkedUrl(relative); requests.push(url.pathname + url.search);
    const result = await fetch(url, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' }, signal: AbortSignal.timeout(30000) });
    if (!result.ok) { const error = new Error(`GET HTTP ${result.status} at ${url.pathname}`); error.status = result.status; throw error; }
    return result.json();
  }
  async function all(relative) {
    const rows = []; const seen = new Set(); let next = relative;
    while (next) { const url = checkedUrl(next).href; if (seen.has(url)) throw new Error('Paging cycle.'); seen.add(url); const data = await get(next); if (!Array.isArray(data.value)) throw new Error('Incomplete inventory.'); rows.push(...data.value); next = data['@odata.nextLink']; }
    return rows;
  }
  const identity = await get('WhoAmI');
  for (const key of ['OrganizationId', 'UserId', 'BusinessUnitId']) if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity[key] || '')) throw new Error('Incomplete identity.');
  const organizationRows = await all('organizations?$select=organizationid,name');
  if (organizationRows.length !== 1 || String(organizationRows[0]?.organizationid || '').toLowerCase() !== identity.OrganizationId.toLowerCase()) throw new Error('Independent organization identity mismatch.');
  const inventory = {};
  const queries = {
    solutions: "solutions?$select=solutionid,uniquename,friendlyname,version,ismanaged,_publisherid_value&$filter=isvisible eq true",
    publishers: 'publishers?$select=publisherid,uniquename,friendlyname,customizationprefix',
    packages: "pluginpackages?$select=pluginpackageid,name,version&$filter=contains(name,'PromptPublication')",
    assemblies: "pluginassemblies?$select=pluginassemblyid,name,version,publickeytoken&$filter=contains(name,'PromptPublication')",
    api: "customapis?$select=customapiid,uniquename,isfunction,bindingtype,executeprivilegename,_plugintypeid_value&$filter=uniquename eq 'wmkf_PublishPrompt'",
    requiredTables: "EntityDefinitions?$select=LogicalName,EntitySetName,OwnershipType,IsOptimisticConcurrencyEnabled&$filter=LogicalName eq 'wmkf_promptpublicationhead' or LogicalName eq 'wmkf_promptpublicationreceipt'",
    humanCandidates: "systemusers?$select=systemuserid,fullname,isdisabled,accessmode&$filter=startswith(fullname,'Connor') or fullname eq 'Justin Gallivan'",
    callerRoles: `systemusers(${identity.UserId})/systemuserroles_association?$select=roleid,name`,
    settingsKeys: "wmkf_appsystemsettings?$select=wmkf_settingkey&$filter=wmkf_settingkey eq 'prompt-library.groups' or wmkf_settingkey eq 'prompt-library.budget-coordination'",
  };
  for (const [name, query] of Object.entries(queries)) {
    try { inventory[name] = { status: 'read-complete', rows: await all(query) }; }
    catch (error) { inventory[name] = { status: 'unverified', httpStatus: error.status || null, reason: error.status ? 'http_error' : ['Test-only GET boundary rejected.', 'Paging cycle.', 'Incomplete inventory.'].includes(error.message) ? error.message : error.name === 'TimeoutError' ? 'timeout' : 'request_or_json_failure' }; }
  }
  const result = { reportVersion: 1, observedAt: new Date().toISOString(), host: HOST, readOnly: true, authentication: 'existing-application-credentials-not-Connor-delegated', credentialSource: 'explicit-env-file-only', identity: { organizationId: identity.OrganizationId, userId: identity.UserId, businessUnitId: identity.BusinessUnitId }, organization: organizationRows[0], inventory, requests, limitations: ['Visibility is that of this application principal; human access and complete effective privilege depth are not attested.', 'Empty readable inventory is not proof that hidden registrations do not exist.', 'No writer freeze, registration, schema mutation, model execution or publication attempted.'] };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, host: HOST, organizationId: identity.OrganizationId, inventories: Object.fromEntries(Object.entries(inventory).map(([name, value]) => [name, { status: value.status, count: value.rows?.length, httpStatus: value.httpStatus }])) }));
}
module.exports = { options, checkedUrl, readCredentials };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
