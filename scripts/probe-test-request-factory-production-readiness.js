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
})().catch((error) => {
  console.error(`Probe failed: ${error.message}`);
  process.exit(1);
});
