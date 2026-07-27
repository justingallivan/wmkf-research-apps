#!/usr/bin/env node
/**
 * READ-ONLY probe for the Power Automate side of the prompt Executor design.
 *
 * Reads Dataverse cloud-flow definition metadata and reports flows whose
 * definitions mention the live prompt/run tables, the Vercel Executor routes,
 * or the historical Claude/Anthropic/Phase-I design terms.
 *
 * SAFETY: the only POST is the OAuth token request. Every Dataverse request is
 * a GET against the workflow system table. The script does not run, enable,
 * disable, create, update, or delete a flow or Dataverse row.
 *
 * Usage:
 *   node scripts/probe-power-automate-prompt-executor.js
 *   node scripts/probe-power-automate-prompt-executor.js --sandbox
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let [, key, value] = match;
    value = value.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!process.env[key]) process.env[key] = value;
  }
}

const NEEDLES = [
  'wmkf_ai_',
  'wmkf_ai_prompt',
  'wmkf_ai_prompts',
  'wmkf_ai_run',
  'wmkf_ai_runs',
  'phase-i',
  'phase i',
  'execute-prompt',
  'executor',
  'anthropic',
  'claude',
  '/api/phase-i-dynamics/',
  '/api/admin/prompts',
  'wmkfresearchapps',
];
const RUN_SOURCE = {
  682090000: 'PowerAutomate Auto',
  682090001: 'Vercel User',
  682090002: 'Vercel Test',
  682090003: 'Vercel Interactive',
  682090004: 'PowerAutomate Test',
  682090005: 'PowerAutomate Manual',
};
const useSandbox = process.argv.includes('--sandbox');
const targetUrl = useSandbox ? process.env.DYNAMICS_SANDBOX_URL : process.env.DYNAMICS_URL;

function stateOf(statecode) {
  return statecode === 1 ? 'Activated' : statecode === 0 ? 'Draft' : `state ${statecode}`;
}

async function getToken() {
  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.DYNAMICS_CLIENT_ID,
        client_secret: process.env.DYNAMICS_CLIENT_SECRET,
        scope: `${targetUrl}/.default`,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()).access_token;
}

async function getAll(token, pathAndQuery) {
  let url = `${targetUrl}/api/data/v9.2${pathAndQuery}`;
  const rows = [];
  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-Version': '4.0',
        Prefer: 'odata.maxpagesize=500',
      },
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!response.ok) {
      const message = typeof body === 'string'
        ? body.slice(0, 300)
        : body?.error?.message || JSON.stringify(body).slice(0, 300);
      throw new Error(`${response.status} ${message}`);
    }
    rows.push(...(body.value || []));
    url = body['@odata.nextLink'] || null;
  }
  return rows;
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(dynamic or non-URL value)';
  }
}

function collectDefinitionFacts(definition) {
  const triggers = Object.entries(definition?.triggers || {}).map(([name, trigger]) => ({
    name,
    type: trigger?.type || null,
    operationId: trigger?.inputs?.host?.operationId || null,
    entity: trigger?.inputs?.parameters?.entityName
      || trigger?.inputs?.parameters?.subscriptionRequest?.entityname
      || null,
    message: trigger?.inputs?.parameters?.subscriptionRequest?.message || null,
    recurrence: trigger?.recurrence || null,
  }));

  const actions = [];
  const retryPolicies = [];
  const urls = [];
  const visit = (value, pathParts = []) => {
    if (!value || typeof value !== 'object') return;
    if (value.retryPolicy) {
      retryPolicies.push({ path: pathParts.join('.'), policy: value.retryPolicy });
    }
    if (typeof value.uri === 'string') {
      urls.push({ path: pathParts.join('.'), url: safeUrl(value.uri) });
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'actions' && child && typeof child === 'object') {
        for (const [actionName, action] of Object.entries(child)) {
          actions.push({
            name: actionName,
            type: action?.type || null,
            operationId: action?.inputs?.host?.operationId || null,
          });
        }
      }
      visit(child, [...pathParts, key]);
    }
  };
  visit(definition);
  return { triggers, actions, retryPolicies, urls };
}

(async () => {
  const required = [
    'DYNAMICS_TENANT_ID',
    'DYNAMICS_CLIENT_ID',
    'DYNAMICS_CLIENT_SECRET',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (!targetUrl) missing.push(useSandbox ? 'DYNAMICS_SANDBOX_URL' : 'DYNAMICS_URL');
  if (missing.length) throw new Error(`Missing ${missing.join(', ')} in .env.local`);

  console.log('Power Automate prompt-executor probe (READ-ONLY)');
  console.log(`Environment: ${targetUrl}`);

  const token = await getToken();
  const flows = await getAll(
    token,
    '/workflows?$select=workflowid,name,statecode,statuscode,modifiedon,clientdata'
      + '&$filter=type eq 1 and category eq 5',
  );

  const matches = [];
  let unparsable = 0;
  let definitionsWithClientData = 0;
  let parseableDefinitions = 0;
  for (const flow of flows) {
    if (!flow.clientdata) continue;
    definitionsWithClientData++;
    const raw = flow.clientdata.toLowerCase();
    const matchedTerms = NEEDLES.filter((needle) => raw.includes(needle));
    let parsed;
    try {
      parsed = JSON.parse(flow.clientdata);
      parseableDefinitions++;
    } catch {
      parsed = null;
    }
    if (!matchedTerms.length) continue;
    if (!parsed) unparsable++;
    const definition = parsed?.properties?.definition || null;
    matches.push({
      id: flow.workflowid,
      name: flow.name,
      state: stateOf(flow.statecode),
      modifiedOn: flow.modifiedon,
      matchedTerms,
      definitionReadable: Boolean(definition),
      facts: definition ? collectDefinitionFacts(definition) : null,
    });
  }

  console.log(`Cloud-flow definitions scanned: ${flows.length}`);
  console.log(`Definitions with clientdata: ${definitionsWithClientData}`);
  console.log(`Definitions parseable as JSON: ${parseableDefinitions}`);
  console.log(`Relevant definitions matched: ${matches.length}`);
  console.log(`Relevant definitions not parseable as JSON: ${unparsable}`);
  console.log(JSON.stringify(matches, null, 2));

  const runs = await getAll(
    token,
    '/wmkf_ai_runs?$select=createdon,wmkf_ai_runsource,_wmkf_ai_prompt_value'
      + '&$orderby=createdon asc',
  );
  const prompts = await getAll(
    token,
    '/wmkf_ai_prompts?$select=wmkf_ai_promptid,wmkf_ai_promptname',
  );
  const promptNames = new Map(
    prompts.map((prompt) => [prompt.wmkf_ai_promptid, prompt.wmkf_ai_promptname]),
  );
  const runSources = new Map();
  const powerAutomateRunsByPrompt = new Map();
  for (const run of runs) {
    const key = run.wmkf_ai_runsource;
    const bucket = runSources.get(key) || {
      value: key,
      label: RUN_SOURCE[key] || `Unknown (${key})`,
      count: 0,
      first: null,
      last: null,
    };
    bucket.count++;
    bucket.first ||= run.createdon || null;
    bucket.last = run.createdon || bucket.last;
    runSources.set(key, bucket);

    if ([682090000, 682090004, 682090005].includes(key)) {
      const promptId = run._wmkf_ai_prompt_value || null;
      const groupKey = `${key}:${promptId || 'none'}`;
      const promptBucket = powerAutomateRunsByPrompt.get(groupKey) || {
        source: RUN_SOURCE[key],
        promptId,
        promptName: promptNames.get(promptId) || '(no current prompt lookup/name)',
        count: 0,
        first: null,
        last: null,
      };
      promptBucket.count++;
      promptBucket.first ||= run.createdon || null;
      promptBucket.last = run.createdon || promptBucket.last;
      powerAutomateRunsByPrompt.set(groupKey, promptBucket);
    }
  }
  console.log('');
  console.log(`AI run rows scanned: ${runs.length}`);
  console.log('Run-source census:');
  console.log(JSON.stringify([...runSources.values()], null, 2));
  console.log('PowerAutomate-labeled rows by prompt:');
  console.log(JSON.stringify([...powerAutomateRunsByPrompt.values()], null, 2));
  console.log('Caveat: current Vercel title-generation cron writes the historical');
  console.log('"PowerAutomate Auto" option, so that label alone cannot prove a PA caller.');
  console.log('');
  console.log('Interpretation boundary: absence here rules out only definitions visible to');
  console.log('this Dataverse application user and containing one of the printed design terms.');
  console.log('Connection health, environment variables, hidden child flows, and run history');
  console.log('still require Power Automate/API access if not represented in workflow metadata.');
})().catch((error) => {
  console.error(`Probe failed: ${error.message}`);
  process.exit(1);
});
