#!/usr/bin/env node
/**
 * Authorized read-only Dataverse prompt/flow discovery for PR #553.
 * Only OAuth token exchange uses POST; Dataverse calls are GET. Does not run
 * flows or models. Never emits raw clientdata, connections, headers, credentials,
 * prompt bodies or execution output by default. Explicit --inspect-text with
 * --prompt-id prints redacted bounded prompt fields only to stdout (not evidence).
 * Optional --flow-id inspects only structural
 * prompt candidates, character counts and hashes, not full definitions.
 * Usage: node scripts/probe-shared-prompt-authoring-example.cjs \
 *   --env-file /absolute/.env.local --allow-production-read --output /tmp/evidence.json
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const argv = process.argv.slice(2);
const switches = new Set(['--allow-production-read', '--sandbox', '--inspect-text']);
const valued = new Set(['--env-file', '--output', '--flow-id', '--prompt-id']);
const options = {};
for (let i = 0; i < argv.length; i++) {
  const key = argv[i];
  if (switches.has(key)) options[key] = true;
  else if (valued.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
  else throw new Error('Unknown or incomplete probe option');
}
const hash = value => createHash('sha256').update(value).digest('hex');
const label = value => value?.UserLocalizedLabel?.Label || value?.LocalizedLabels?.[0]?.Label || null;
const guid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '');
const executorTerms = ['wmkf_ai_', 'anthropic', 'claude', 'clerical_checks'];
const relevant = /anthropic|claude|wmkf_ai_|prompt|pre.?flight|check.?in|compliance|api\/.*summar|clerical_checks/i;
function inspectDefinition(raw) {
  const rawTerms = executorTerms.filter(term => String(raw || '').toLowerCase().includes(term));
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { parseable: false, definitionFound: false, executorTerms: rawTerms }; }
  const d = parsed?.properties?.definition || parsed?.definition;
  if (!d) return { parseable: true, definitionFound: false, executorTerms: rawTerms };
  const actions = [];
  const candidates = [];
  const tables = new Set();
  function visit(value, parts = []) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/authorization|authentication|headers|connectionreferences|securedata|password|secret|token/i.test(key)) continue;
      const next = [...parts, key];
      if (key === 'actions' && child && typeof child === 'object') {
        for (const [name, action] of Object.entries(child)) {
          const p = action?.inputs?.parameters || {};
          actions.push({ path: [...next, name].join('.'), type: action?.type || null, operationId: action?.inputs?.host?.operationId || null,
            entity: p.entityName || null,
            relevant: relevant.test(name) || relevant.test(JSON.stringify(action?.inputs?.body || {})) });
        }
      }
      if (typeof child === 'string') {
        if (/^(entityName|entityname)$/.test(key)) tables.add(child);
        if (child.length >= 160 && /prompt|instructions|system|text|content|inputs|value/i.test(key) && relevant.test(child)) {
          candidates.push({ path: next.join('.'), chars: child.length, sha256: hash(child),
            expressionReferences: [...new Set(child.match(/@\{[^}]{1,200}\}/g) || [])].length,
            placeholders: [...new Set((child.match(/\{\{\s*[\w.]+\s*\}\}/g) || []))].slice(0, 30),
            containsJsonOutputTerms: /json|output|schema/i.test(child) });
        }
      } else visit(child, next);
    }
  }
  visit(d);
  return { parseable: true, definitionFound: true, executorTerms: rawTerms, triggerTypes: Object.values(d.triggers || {}).map(t => t.type || null), actions, candidatePromptStrings: candidates, referencedTables: [...tables] };
}
async function main() {
  if (options['--env-file']) {
    for (const line of fs.readFileSync(options['--env-file'], 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const target = new URL(process.env[options['--sandbox'] ? 'DYNAMICS_SANDBOX_URL' : 'DYNAMICS_URL']);
  const registry = await import(pathToFileURL(path.resolve(__dirname, '../lib/dataverse/core/target-registry.js')).href);
  const production = registry.PRODUCTION_HOSTS.includes(target.hostname);
  if (target.protocol !== 'https:' || target.username || target.password || (!production && !registry.SANDBOX_HOSTS.includes(target.hostname))) throw new Error('Invalid/unregistered target');
  if (production && !options['--allow-production-read']) throw new Error('Explicit production-read authorization required');
  const credentials = ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET'];
  if (credentials.some(key => !process.env[key])) throw new Error('Required Dataverse credentials missing');
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID, client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${target.origin}/.default` }),
    signal: AbortSignal.timeout(30000),
  });
  if (!tokenResponse.ok) throw new Error(`OAuth HTTP ${tokenResponse.status}`);
  const { access_token: token } = await tokenResponse.json();
  const requests = [];
  const api = `${target.origin}/api/data/v9.2/`;
  async function get(relative) {
    const url = new URL(relative, api);
    if (url.origin !== target.origin || !url.pathname.startsWith('/api/data/v9.2/')) throw new Error('Unsafe paging origin/path');
    requests.push(url.pathname + url.search);
    const response = await fetch(url, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', Prefer: 'odata.maxpagesize=500', 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Dataverse HTTP ${response.status} at ${url.pathname}`);
    return response.json();
  }
  async function all(relative) {
    const rows = []; let next = relative; let pages = 0;
    while (next) {
      if (++pages > 100) throw new Error('Paging bound exceeded; inventory incomplete');
      const data = await get(next); rows.push(...(data.value || [])); next = data['@odata.nextLink'];
    }
    return rows;
  }
  const out = { observedAt: new Date().toISOString(), target: target.hostname, readOnly: true, requests };
  if (options['--prompt-id']) {
    if (!guid(options['--prompt-id'])) throw new Error('Invalid prompt GUID');
    const p = await get(`wmkf_ai_prompts(${options['--prompt-id']})?$select=wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent,wmkf_ai_promptstatus,wmkf_ai_systemprompt,wmkf_ai_promptbody,wmkf_ai_promptvariables,wmkf_ai_promptoutputschema,wmkf_ai_model,wmkf_ai_maxtokens,wmkf_ai_temperature`);
    const stringFacts = text => typeof text === 'string' ? { chars: text.length, sha256: hash(text), placeholders: [...new Set(text.match(/\{\{\s*[\w.]+\s*\}\}/g) || [])].slice(0, 40), expressionCount: (text.match(/@\{/g) || []).length, hasJsonInstruction: /json/i.test(text), hasClericalChecks: /clerical_checks/i.test(text) } : null;
    function jsonShape(text) {
      if (!text) return { present: false };
      try { const value = JSON.parse(text); return { present: true, validJson: true, rootType: Array.isArray(value) ? 'array' : typeof value, rootKeys: value && typeof value === 'object' ? Object.keys(value).slice(0, 30) : [], variableNames: Array.isArray(value?.variables) ? value.variables.map(v => v.name) : undefined, sourceKinds: Array.isArray(value?.variables) ? [...new Set(value.variables.map(v => v.source?.kind || null))] : undefined, outputNames: Array.isArray(value?.outputs) ? value.outputs.map(v => v.name) : undefined, targetKinds: Array.isArray(value?.outputs) ? [...new Set(value.outputs.map(v => v.target?.kind || null))] : undefined }; } catch { return { present: true, validJson: false, chars: text.length }; }
    }
    if (options['--inspect-text']) {
      const redact = value => String(value || '').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]').replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]').replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[redacted API key]').replace(/((?:api[_-]?key|client[_-]?secret|password)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]').slice(0, 12000);
      console.log(JSON.stringify({ inspectionOnlyNotRetained: true, name: p.wmkf_ai_promptname, system: redact(p.wmkf_ai_systemprompt), body: redact(p.wmkf_ai_promptbody), outputSchema: redact(p.wmkf_ai_promptoutputschema) }, null, 2));
    }
    out.prompt = { id: p.wmkf_ai_promptid, name: p.wmkf_ai_promptname, version: p.wmkf_promptversion, current: p.wmkf_ai_iscurrent, status: p.wmkf_ai_promptstatus, model: p.wmkf_ai_model, maxTokens: p.wmkf_ai_maxtokens, temperature: p.wmkf_ai_temperature, system: stringFacts(p.wmkf_ai_systemprompt), body: stringFacts(p.wmkf_ai_promptbody), variables: jsonShape(p.wmkf_ai_promptvariables), outputSchema: jsonShape(p.wmkf_ai_promptoutputschema) };
  } else if (options['--flow-id']) {
    if (!guid(options['--flow-id'])) throw new Error('Invalid flow GUID');
    const f = await get(`workflows(${options['--flow-id']})?$select=workflowid,name,category,type,statecode,modifiedon,clientdata`);
    out.flow = { id: f.workflowid, name: f.name, category: f.category, type: f.type, state: f.statecode, modifiedOn: f.modifiedon, facts: inspectDefinition(f.clientdata || '') };
  } else {
    const run = await get('wmkf_ai_runs(402fdf35-9b45-f111-88b5-000d3a306d45)?$select=wmkf_ai_runid,wmkf_ai_model,wmkf_ai_promptversion,wmkf_ai_runsource,_wmkf_ai_prompt_value,_ownerid_value,createdon');
    out.linkedRun = { id: run.wmkf_ai_runid, model: run.wmkf_ai_model, version: run.wmkf_ai_promptversion, promptId: run._wmkf_ai_prompt_value, runSource: run.wmkf_ai_runsource, createdOn: run.createdon };
    const [prompts, flows, custom] = await Promise.all([
      all('wmkf_ai_prompts?$select=wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_iscurrent,wmkf_ai_promptstatus,wmkf_ai_model,_createdby_value,_modifiedby_value,createdon,modifiedon'),
      all('workflows?$select=workflowid,name,category,type,statecode,modifiedon,clientdata,_ownerid_value&$filter=category eq 5'),
      all('EntityDefinitions?$select=LogicalName,EntitySetName,PrimaryNameAttribute,DisplayName&$filter=IsCustomEntity eq true'),
    ]);
    out.promptRows = prompts.map(p => ({ id: p.wmkf_ai_promptid, name: p.wmkf_ai_promptname, version: p.wmkf_promptversion, current: p.wmkf_ai_iscurrent, status: p.wmkf_ai_promptstatus, model: p.wmkf_ai_model, createdByLinkedRunOwner: p._createdby_value === run._ownerid_value, modifiedByLinkedRunOwner: p._modifiedby_value === run._ownerid_value }));
    let readable = 0, parseable = 0, definitionFound = 0;
    out.flowMatches = [];
    out.specificFlowTerms = executorTerms;
    out.specificFlowMatches = [];
    for (const f of flows) {
      if (f.clientdata) readable++;
      const facts = inspectDefinition(f.clientdata || '');
      if (facts.parseable) parseable++;
      if (facts.definitionFound) definitionFound++;
      if (facts.executorTerms.length) out.specificFlowMatches.push({ id: f.workflowid, name: f.name, terms: facts.executorTerms });
      if (!relevant.test(f.clientdata || '') && !relevant.test(f.name || '')) continue;
      out.flowMatches.push({ id: f.workflowid, name: f.name, type: f.type, state: f.statecode, modifiedOn: f.modifiedon, sameOwnerAsLinkedRun: f._ownerid_value === run._ownerid_value, facts });
    }
    out.flowInventory = { totalVisible: flows.length, withClientdata: readable, parseableClientdata: parseable, definitionFound, matched: out.flowMatches.length, specificTermMatches: out.specificFlowMatches.length };
    out.candidateTables = custom.filter(e => /^(wmkf|akoya)_/.test(e.LogicalName) && /prompt|ai_|config|setting|template/i.test(`${e.LogicalName} ${label(e.DisplayName) || ''}`)).map(e => ({ name: e.LogicalName, entitySet: e.EntitySetName, label: label(e.DisplayName) }));
    out.boundary = 'Only definitions visible to this application identity in this Dataverse environment were scanned. Absence is not proof of no Power Automate flow. Run-source labels do not prove caller identity. No raw prompt/flow body, output, credentials or connection values retained.';
  }
  if (options['--output']) fs.writeFileSync(options['--output'], JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(options['--output'] ? { output: options['--output'], observedAt: out.observedAt, target: out.target, flowInventory: out.flowInventory, promptRows: out.promptRows?.length, prompt: out.prompt, flow: out.flow ? { id: out.flow.id, name: out.flow.name, facts: out.flow.facts } : undefined } : out, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
