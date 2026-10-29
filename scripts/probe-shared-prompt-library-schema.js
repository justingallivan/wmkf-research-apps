#!/usr/bin/env node
/**
 * Read-only shared prompt-library planning probe. No Dataverse writes or model calls.
 * The sole POST is the OAuth client-credentials token exchange; all Dataverse
 * requests are GET metadata or prompt identity/lifecycle inventory. Never emits
 * tokens, secrets, prompt bodies, variable values, or output schemas.
 *
 * node scripts/probe-shared-prompt-library-schema.js --env-file /absolute/.env.local \
 *   --allow-production-read --output /absolute/evidence.json
 * --sandbox selects DYNAMICS_SANDBOX_URL and does not require the production flag.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}
function loadEnv(file) {
  if (!file) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}
const label = value => value?.UserLocalizedLabel?.Label || value?.LocalizedLabels?.[0]?.Label || null;
async function main() {
  const known = new Set(['--env-file', '--output', '--sandbox', '--allow-production-read']);
  for (let index = 0; index < args.length; index++) {
    if (!known.has(args[index])) throw new Error(`Unknown option ${args[index]}`);
    if (['--env-file', '--output'].includes(args[index])) index++;
  }
  loadEnv(option('--env-file'));
  const target = new URL(process.env[args.includes('--sandbox') ? 'DYNAMICS_SANDBOX_URL' : 'DYNAMICS_URL']);
  const registry = await import(pathToFileURL(path.resolve(__dirname, '../lib/dataverse/core/target-registry.js')).href);
  const production = registry.PRODUCTION_HOSTS.includes(target.hostname);
  if (target.protocol !== 'https:' || target.username || target.password || (!production && !registry.SANDBOX_HOSTS.includes(target.hostname))) throw new Error('Unregistered or invalid Dataverse target');
  if (production && !args.includes('--allow-production-read')) throw new Error('Production read requires explicit --allow-production-read authorization');
  for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET']) if (!process.env[key]) throw new Error(`Missing ${key}`);
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID, client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${target.origin}/.default` }),
    signal: AbortSignal.timeout(30000),
  });
  if (!tokenResponse.ok) throw new Error(`OAuth HTTP ${tokenResponse.status}`);
  const { access_token: token } = await tokenResponse.json();
  const api = `${target.origin}/api/data/v9.2/`;
  const requests = [];
  async function get(relative) {
    const url = new URL(relative, api);
    if (url.origin !== target.origin || !url.pathname.startsWith('/api/data/v9.2/')) throw new Error('Unexpected metadata paging origin/path');
    requests.push(url.pathname + url.search);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Dataverse HTTP ${response.status} at ${url.pathname}`);
    return response.json();
  }
  async function all(relative) {
    const rows = []; let next = relative;
    while (next) { const data = await get(next); rows.push(...(data.value || [])); next = data['@odata.nextLink']; }
    return rows;
  }
  async function entity(name) {
    const prefix = `EntityDefinitions(LogicalName='${name}')`;
    const [definition, attrs, keys, strings, memos, picklists] = await Promise.all([
      get(`${prefix}?$select=LogicalName,SchemaName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,DisplayName,IsOptimisticConcurrencyEnabled`),
      all(`${prefix}/Attributes?$select=LogicalName,SchemaName,AttributeType,IsCustomAttribute,IsValidForCreate,IsValidForUpdate,RequiredLevel,DisplayName`),
      all(`${prefix}/Keys?$select=LogicalName,KeyAttributes,EntityKeyIndexStatus`),
      all(`${prefix}/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=LogicalName,MaxLength`),
      all(`${prefix}/Attributes/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=LogicalName,MaxLength`),
      all(`${prefix}/Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet`),
    ]);
    const lengths = new Map([...strings, ...memos].map(attr => [attr.LogicalName, attr.MaxLength]));
    return {
      logicalName: definition.LogicalName, schemaName: definition.SchemaName, entitySet: definition.EntitySetName,
      primaryId: definition.PrimaryIdAttribute, primaryName: definition.PrimaryNameAttribute, label: label(definition.DisplayName), optimisticConcurrency: definition.IsOptimisticConcurrencyEnabled,
      keys: keys.map(key => ({ name: key.LogicalName, fields: key.KeyAttributes, status: key.EntityKeyIndexStatus })),
      attributes: attrs.map(attr => ({ name: attr.LogicalName, schemaName: attr.SchemaName, type: attr.AttributeType, custom: attr.IsCustomAttribute, create: attr.IsValidForCreate, update: attr.IsValidForUpdate, required: attr.RequiredLevel?.Value, label: label(attr.DisplayName), ...(lengths.has(attr.LogicalName) ? { maxLength: lengths.get(attr.LogicalName) } : {}) })).sort((a,b) => a.name.localeCompare(b.name)),
      choices: picklists.map(attr => ({ name: attr.LogicalName, options: (attr.OptionSet?.Options || []).map(item => ({ value: item.Value, label: label(item.Label) })) })),
    };
  }
  const [prompt, settings, customEntities] = await Promise.all([
    entity('wmkf_ai_prompt'), entity('wmkf_appsystemsetting'),
    all('EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName&$filter=IsCustomEntity eq true'),
  ]);
  const groupSettings = await all(`${settings.entitySet}?$select=wmkf_settingkey&$filter=wmkf_settingkey eq 'prompt-library.groups'`);
  const rows = await all(`${prompt.entitySet}?$select=wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent,wmkf_ai_promptstatus&$orderby=wmkf_ai_promptname asc`);
  const snapshot = { observedAt: new Date().toISOString(), targetHost: target.hostname, targetClass: production ? 'production' : 'sandbox', readOnly: true, entities: [prompt, settings], customEntityCount: customEntities.length,
    candidateCatalogEntities: customEntities.filter(item => /prompt|catalog|group/i.test(item.LogicalName)).map(item => ({ name:item.LogicalName, entitySet:item.EntitySetName, label:label(item.DisplayName) })),
    groupCatalogKey: { key: 'prompt-library.groups', exists: groupSettings.length > 0 },
    promptRows: rows.map(row => ({ name: row.wmkf_ai_promptname, version:row.wmkf_promptversion, current:row.wmkf_ai_iscurrent, status:row.wmkf_ai_promptstatus })), requests };
  const output = option('--output');
  if (output) fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n');
  else console.log(JSON.stringify(snapshot, null, 2));
  if (output) console.log(JSON.stringify({ output, observedAt:snapshot.observedAt, target:snapshot.targetHost, customPromptAttributes:prompt.attributes.filter(attr=>attr.custom).length, promptRows:rows.length }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
