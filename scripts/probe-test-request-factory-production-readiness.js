#!/usr/bin/env node
/**
 * READ-ONLY production readiness probe for the Test Request Factory
 * (docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md, phase P0).
 *
 * Reports, for production Dataverse:
 *   1. Whether the Factory marker columns exist (wave29 on akoya_request,
 *      wave30 on wmkf_potentialreviewers).
 *   2. The app-suite application user (systemuser whose applicationid is this
 *      app registration's client id): id, enabled state, security roles.
 *   3. Whether the given staff sign-in name is an enabled systemuser (the
 *      source Request's program director).
 *   4. Everything registered to run on akoya_request create or update:
 *      activated classic workflows and business rules, plug-in steps, and
 *      activated cloud flows whose definition mentions akoya_request.
 *
 * SAFETY: GET requests only, through the interlocked raw client. Production
 * reads are owner-run behind the interlock override; nothing is written.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-test-request-factory-production-readiness.js --director=<sign-in name>
 *   Add --detail to also print what each create-triggered workflow writes and
 *   each matching cloud flow's triggers and record actions (names only).
 */

const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

loadEnvLocal();

const PRODUCTION_URL = 'https://wmkf.crm.dynamics.com';
const MARKERS = [
  { entity: 'akoya_request', attribute: 'wmkf_istestrequest', wave: 'wave29' },
  { entity: 'akoya_request', attribute: 'wmkf_testcreationrunid', wave: 'wave29' },
  { entity: 'wmkf_potentialreviewers', attribute: 'wmkf_issyntheticreviewer', wave: 'wave30' },
];
const WORKFLOW_CATEGORY = { 0: 'workflow', 1: 'dialog', 2: 'business rule', 3: 'action', 4: 'process flow', 5: 'cloud flow' };

function parseDirector(argv) {
  const arg = argv.find((a) => a.startsWith('--director='));
  const value = arg ? arg.slice('--director='.length).trim().toLowerCase() : '';
  if (!/^[^@\s']+@[^@\s']+$/.test(value)) {
    throw new Error('Pass --director=<sign-in name>, e.g. --director=someone@wmkeck.org.');
  }
  return value;
}

/** Labelled steps, `entity.attribute` targets set, entities created, and whether the workflow sends email. */
function summarizeWorkflowXaml(xaml) {
  const uniq = (values) => [...new Set(values)].sort();
  const steps = [...xaml.matchAll(/DisplayName="([^"]*Step\d+: [^"]*)"/g)].map((m) => m[1]);
  const sets = [...xaml.matchAll(/<mxswa:SetEntityProperty Attribute="([a-z0-9_]+)"[^>]*EntityName="([a-z0-9_]+)"/g)]
    .map((m) => `${m[2]}.${m[1]}`);
  const creates = [...xaml.matchAll(/<mxswa:CreateEntity[^>]*EntityName="([a-z0-9_]+)"/g)].map((m) => m[1]);
  return { steps: uniq(steps), sets: uniq(sets), creates: uniq(creates), sendsEmail: /SendEmail/.test(xaml) };
}

const FLOW_MESSAGE = { 1: 'create', 2: 'delete', 3: 'update', 4: 'create or update', 5: 'create or delete', 6: 'update or delete', 7: 'create, update or delete' };

/** A flow's Dataverse triggers and the record operations its actions perform (entity names only, no values). */
function summarizeFlow(clientdata) {
  let definition;
  try {
    definition = JSON.parse(clientdata || '{}')?.properties?.definition || {};
  } catch {
    return { triggers: ['(clientdata did not parse)'], actions: [] };
  }
  const triggers = Object.entries(definition.triggers || {}).map(([name, t]) => {
    const p = t?.inputs?.parameters || {};
    const entity = p['subscriptionRequest/entityname'];
    const message = FLOW_MESSAGE[p['subscriptionRequest/message']] || p['subscriptionRequest/message'];
    const filter = p['subscriptionRequest/filteringattributes'] ? ` on ${p['subscriptionRequest/filteringattributes']}` : '';
    const recurrence = t?.recurrence ? ` every ${t.recurrence.interval} ${t.recurrence.frequency}` : '';
    return `${name} [${t?.type || '?'}${entity ? ` ${entity} ${message}${filter}` : ''}${recurrence}]`;
  });
  const actions = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const op = node?.inputs?.host?.operationId;
    const entity = node?.inputs?.parameters?.entityName;
    if (op && entity) actions.push(`${op} ${entity}`);
    for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value);
  };
  walk(definition.actions);
  return { triggers, actions: [...new Set(actions)].sort() };
}

async function getAll(client, path) {
  const rows = [];
  let next = path;
  while (next) {
    const resp = await client.get(next);
    if (!resp.ok) throw new Error(`GET failed (${resp.status}): ${String(resp.text).slice(0, 300)}`);
    rows.push(...(resp.body?.value || []));
    next = resp.body?.['@odata.nextLink'] || null;
  }
  return rows;
}

(async () => {
  const director = parseDirector(process.argv.slice(2));
  const detail = process.argv.includes('--detail');
  const clientId = process.env.DYNAMICS_CLIENT_ID;
  if (!clientId) throw new Error('DYNAMICS_CLIENT_ID is not set.');
  const token = await getAccessToken(PRODUCTION_URL);
  const client = createClient({ resourceUrl: PRODUCTION_URL, token });
  console.log(`Target: ${PRODUCTION_URL} (read-only)\n`);

  console.log('1. Factory marker columns');
  for (const m of MARKERS) {
    const rows = await getAll(client,
      `/EntityDefinitions(LogicalName='${m.entity}')/Attributes?$select=LogicalName&$filter=LogicalName eq '${m.attribute}'`);
    console.log(`   ${m.wave} ${m.entity}.${m.attribute}: ${rows.length ? 'PRESENT' : 'absent'}`);
  }

  console.log('\n2. App-suite application user');
  const appUsers = await getAll(client,
    `/systemusers?$select=systemuserid,fullname,isdisabled,accessmode&$filter=applicationid eq ${clientId}`);
  if (appUsers.length !== 1) console.log(`   expected exactly one, found ${appUsers.length}`);
  for (const u of appUsers) {
    const roles = await getAll(client, `/systemusers(${u.systemuserid})/systemuserroles_association?$select=name`);
    console.log(`   ${u.systemuserid}  ${u.fullname}  disabled=${u.isdisabled} accessmode=${u.accessmode}`);
    console.log(`   roles: ${roles.map((r) => r.name).sort().join(', ') || '(none)'}`);
  }

  console.log('\n3. Program director sign-in');
  const people = await getAll(client,
    `/systemusers?$select=systemuserid,fullname,isdisabled,accessmode&$filter=domainname eq '${director}'`);
  if (!people.length) console.log('   NOT FOUND');
  for (const u of people) console.log(`   ${u.systemuserid}  ${u.fullname}  disabled=${u.isdisabled} accessmode=${u.accessmode}`);

  console.log('\n4. Registered on akoya_request create/update');
  const workflows = await getAll(client,
    "/workflows?$select=name,category,mode,triggeroncreate,triggeronupdateattributelist,workflowid" +
    "&$filter=primaryentity eq 'akoya_request' and type eq 1 and statecode eq 1");
  console.log(`   classic workflows / business rules (activated): ${workflows.length}`);
  for (const w of workflows) {
    const kind = WORKFLOW_CATEGORY[w.category] ?? `category ${w.category}`;
    const mode = w.category === 0 ? (w.mode === 1 ? 'real-time' : 'background') : '-';
    const update = w.triggeronupdateattributelist ? `update(${w.triggeronupdateattributelist})` : '';
    console.log(`   - [${kind}, ${mode}] ${w.name}  create=${w.triggeroncreate === true} ${update}`);
  }

  const steps = await getAll(client,
    '/sdkmessageprocessingsteps?$select=name,stage,mode,statecode' +
    '&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)' +
    "&$filter=sdkmessagefilterid/primaryobjecttypecode eq 'akoya_request' and statecode eq 0");
  const relevant = steps.filter((s) => ['Create', 'Update'].includes(s.sdkmessageid?.name));
  console.log(`   plug-in steps (enabled, Create/Update): ${relevant.length}`);
  for (const s of relevant) {
    console.log(`   - [${s.sdkmessageid.name}, stage ${s.stage}, ${s.mode === 0 ? 'sync' : 'async'}] ${s.name || '(unnamed)'}  type=${s.plugintypeid?.typename || '?'}`);
  }

  const flows = await getAll(client, '/workflows?$select=name,clientdata&$filter=category eq 5 and statecode eq 1');
  const matching = flows.filter((f) => String(f.clientdata || '').includes('akoya_request'));
  console.log(`   cloud flows (activated) mentioning akoya_request: ${matching.length} of ${flows.length}`);
  for (const f of matching) console.log(`   - ${f.name}`);

  if (!detail) return;

  console.log('\n5. Detail: what each create-triggered workflow writes');
  for (const w of workflows.filter((row) => row.triggeroncreate === true)) {
    const resp = await client.get(`/workflows(${w.workflowid})?$select=xaml`);
    if (!resp.ok) throw new Error(`GET workflow xaml failed (${resp.status})`);
    const summary = summarizeWorkflowXaml(resp.body?.xaml || '');
    console.log(`   - ${w.name}`);
    console.log(`     steps: ${summary.steps.join(' | ') || '(none labelled)'}`);
    console.log(`     sets: ${summary.sets.join(', ') || '(none)'}`);
    console.log(`     creates: ${summary.creates.join(', ') || '(none)'}  sends email: ${summary.sendsEmail}`);
  }

  console.log('\n6. Detail: cloud flows mentioning akoya_request');
  for (const f of matching) {
    const summary = summarizeFlow(f.clientdata);
    console.log(`   - ${f.name}`);
    for (const t of summary.triggers) console.log(`     trigger: ${t}`);
    console.log(`     record actions: ${summary.actions.join(', ') || '(none found)'}`);
  }
})().catch((error) => {
  console.error(`Probe failed: ${error.message}`);
  process.exit(1);
});
