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
 *      activated classic workflows and business rules, plug-in steps (with
 *      each update step's filtering columns), and activated cloud flows whose
 *      definition mentions akoya_request.
 *   9. Rollup columns on account and contact whose definition aggregates
 *      akoya_request (a Request create or update can recalculate them).
 *  10. With --foundation-since=<ISO UTC>: the Foundation account's columns
 *      that change without an audit row (MVP item 5 verify diagnosis): every
 *      rollup column's `_date`/`_state` (flagged when recalculated after the
 *      given time), every calculated column and the columns its formula
 *      reads, and the names of non-audited columns. Timestamps, states and
 *      names only; no rollup, calculated or other column values.
 *
 * SAFETY: GET requests only, through the interlocked raw client. Production
 * reads are owner-run behind the interlock override; nothing is written.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-test-request-factory-production-readiness.js --director=<sign-in name>
 *   Add --detail to also print what each create-triggered workflow writes and
 *   each matching cloud flow's triggers and record actions (names only).
 *   Add --export-xaml=<dir> to also save each create-triggered workflow's
 *   definition (process logic only, no record data) for local review.
 *   Add --history[=N] (default 10, max 50) to print what happened around the
 *   creation of the N most recent Foundation-applicant (test) Requests: jobs,
 *   emails, and audited field names on the Request and the Foundation account.
 *   Add --foundation-since=<ISO UTC> for section 10 (run it with the time just
 *   before a production run's fence_source).
 *   Add --meeting-date[=N] (default 50, max 200) to report whether the meeting
 *   date is written by an update after create on the N most recent Requests
 *   that carry one, by whom, and every audited meeting-date update on a
 *   Foundation-applicant Request with what followed it (plan open question 5).
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

const FOUNDATION_NAME = 'W. M. Keck Foundation';
const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000;
const MEETING_DATE = 'wmkf_meetingdate';
const ROLLUP_ATTRIBUTE_TYPES = ['IntegerAttributeMetadata', 'DecimalAttributeMetadata', 'MoneyAttributeMetadata', 'DateTimeAttributeMetadata'];

/** Changed attribute names from an audit row's `changedata` (values are never printed). */
function changedAttributeNames(changedata) {
  try {
    return (JSON.parse(changedata || '{}').changedAttributes || []).map((a) => a.logicalName).filter(Boolean);
  } catch {
    return ['(changedata did not parse)'];
  }
}

function countBy(rows, keyOf) {
  const counts = new Map();
  for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1);
  return [...counts.entries()].map(([key, n]) => `${key} x${n}`).sort();
}

/**
 * What happened around the creation of existing Foundation-applicant test
 * Requests (the legacy test-record convention the Factory's clones follow):
 * background jobs and emails regarding each, audit rows on it within two
 * hours of its creation, and audit rows on the Foundation account in the same
 * window. Names, users, statuses and counts only.
 */
async function printCreationHistory(client, limit) {
  const F = '@OData.Community.Display.V1.FormattedValue';
  const foundation = await getAll(client,
    `/accounts?$select=accountid,name&$filter=name eq '${FOUNDATION_NAME}' and statecode eq 0`);
  if (foundation.length !== 1) throw new Error(`Expected one active ${FOUNDATION_NAME} account; found ${foundation.length}.`);
  const accountId = foundation[0].accountid;
  const resp = await client.get(
    '/akoya_requests?$select=akoya_requestid,akoya_requestnum,createdon,_createdby_value,_akoya_payee_value,_wmkf_grantprogram_value,akoya_requeststatus' +
    `&$filter=_akoya_applicantid_value eq ${accountId}&$orderby=createdon desc&$top=${limit}`,
    { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' },
  );
  if (!resp.ok) throw new Error(`GET test Requests failed (${resp.status})`);
  const requests = resp.body?.value || [];
  console.log(`\n7. Creation history of the ${requests.length} most recent Foundation-applicant Requests`);
  for (const r of requests) {
    const created = new Date(r.createdon);
    const until = new Date(created.getTime() + HISTORY_WINDOW_MS).toISOString();
    const from = new Date(created.getTime() - 10 * 60 * 1000).toISOString();
    console.log(`   - ${r.akoya_requestnum} created ${r.createdon} by ${r[`_createdby_value${F}`] || r._createdby_value}` +
      `  program=${r[`_wmkf_grantprogram_value${F}`] || 'none'} payee=${r._akoya_payee_value ? 'set' : 'none'} status=${r[`akoya_requeststatus${F}`] || r.akoya_requeststatus}`);
    const jobs = await getAll(client,
      `/asyncoperations?$select=name,statuscode&$filter=_regardingobjectid_value eq ${r.akoya_requestid}`);
    console.log(`     background jobs: ${countBy(jobs, (j) => `${j.name} [${j.statuscode}]`).join('; ') || 'none'}`);
    const emails = await getAll(client,
      `/emails?$select=statuscode,directioncode&$filter=_regardingobjectid_value eq ${r.akoya_requestid} and createdon le ${until}`);
    console.log(`     emails created within 2h: ${countBy(emails, (e) => `status ${e.statuscode} ${e.directioncode ? 'outgoing' : 'incoming'}`).join('; ') || 'none'}`);
    const audits = await getAllOrForbidden(client,
      '/audits?$select=createdon,_userid_value,operation,changedata' +
      `&$filter=objecttypecode eq 'akoya_request' and _objectid_value eq ${r.akoya_requestid} and createdon le ${until}&$orderby=createdon asc`);
    console.log(`     audit rows on the Request within 2h: ${audits ? audits.length : 'not readable (403, no audit privilege)'}`);
    for (const a of audits || []) {
      console.log(`       ${a.createdon} op=${a.operation} user=${a[`_userid_value${F}`] || a._userid_value}: ${changedAttributeNames(a.changedata).join(', ') || '-'}`);
    }
    const accountAudits = await getAllOrForbidden(client,
      '/audits?$select=createdon,_userid_value,changedata' +
      `&$filter=objecttypecode eq 'account' and _objectid_value eq ${accountId} and createdon ge ${from} and createdon le ${until}`);
    console.log(`     Foundation account audit rows in the window: ${accountAudits ? accountAudits.length : 'not readable (403, no audit privilege)'}`);
    for (const a of accountAudits || []) {
      console.log(`       ${a.createdon} user=${a[`_userid_value${F}`] || a._userid_value}: ${changedAttributeNames(a.changedata).join(', ') || '-'}`);
    }
  }
}

/** The meeting-date change in an audit row's `changedata`, or null (values are never printed). */
function meetingDateChange(changedata) {
  try {
    const change = (JSON.parse(changedata || '{}').changedAttributes || []).find((a) => a.logicalName === MEETING_DATE);
    if (!change) return null;
    return change.oldValue === undefined || change.oldValue === null || change.oldValue === '' ? 'first set' : 'changed';
  } catch {
    return null;
  }
}

/**
 * Plan open question 5: do staff set `wmkf_meetingdate` after a Request is
 * created, and has a Foundation-applicant Request already received that write
 * with nothing outside it changing? Part A reads update audits on the N most
 * recent Requests that carry a meeting date; part B lists every audited
 * meeting-date update on Foundation-applicant Requests with the jobs regarding
 * the Request and the Foundation account's audit rows in the two hours after.
 * Request numbers, users, timestamps, field names and counts only.
 */
async function printMeetingDateWrites(client, limit, appUserId) {
  const F = '@OData.Community.Display.V1.FormattedValue';
  const formatted = { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' };
  console.log(`\n8. Meeting-date writes after create (${MEETING_DATE})`);
  const attr = await client.get(
    `/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${MEETING_DATE}')?$select=IsAuditEnabled`);
  const entity = await client.get("/EntityDefinitions(LogicalName='akoya_request')?$select=IsAuditEnabled");
  if (!attr.ok || !entity.ok) throw new Error(`GET audit settings failed (${attr.status}/${entity.status})`);
  console.log(`   auditing: akoya_request=${entity.body?.IsAuditEnabled?.Value} ${MEETING_DATE}=${attr.body?.IsAuditEnabled?.Value}` +
    ' (if either is false, "no update seen" below means nothing)');

  const foundation = await getAll(client,
    `/accounts?$select=accountid&$filter=name eq '${FOUNDATION_NAME}' and statecode eq 0`);
  if (foundation.length !== 1) throw new Error(`Expected one active ${FOUNDATION_NAME} account; found ${foundation.length}.`);
  const accountId = foundation[0].accountid;

  const recent = await client.get(
    `/akoya_requests?$select=akoya_requestid,akoya_requestnum,createdon,_akoya_applicantid_value` +
    `&$filter=${MEETING_DATE} ne null&$orderby=createdon desc&$top=${limit}`, formatted);
  if (!recent.ok) throw new Error(`GET Requests with a meeting date failed (${recent.status})`);
  const rows = recent.body?.value || [];
  let laterUpdates = 0;
  let auditReadable = 0;
  const byUser = new Map();
  console.log(`   A. ${rows.length} most recent Requests with a meeting date:`);
  for (const r of rows) {
    const audits = await getAllOrForbidden(client,
      '/audits?$select=createdon,_userid_value,changedata' +
      `&$filter=objecttypecode eq 'akoya_request' and _objectid_value eq ${r.akoya_requestid} and operation eq 2&$orderby=createdon asc`);
    if (!audits) {
      console.log('      audit rows not readable (403, no audit privilege); stopping part A');
      break;
    }
    auditReadable += 1;
    const writes = audits.map((a) => ({ a, kind: meetingDateChange(a.changedata) })).filter((w) => w.kind);
    if (writes.length) laterUpdates += 1;
    const foundationTag = r._akoya_applicantid_value === accountId ? ' [Foundation applicant]' : '';
    const summary = writes.map(({ a, kind }) => {
      const user = a._userid_value === appUserId ? 'APP USER' : (a[`_userid_value${F}`] || a._userid_value);
      byUser.set(user, (byUser.get(user) || 0) + 1);
      return `${a.createdon} ${kind} by ${user}`;
    });
    console.log(`      ${r.akoya_requestnum}${foundationTag} created ${r.createdon}: ${summary.join('; ') || 'no audited update to the meeting date (set at create, or before auditing)'}`);
  }
  console.log(`      => ${laterUpdates} of ${auditReadable} audit-readable Requests had the meeting date written by a later update`);
  console.log(`      => writes by user: ${[...byUser.entries()].map(([u, n]) => `${u} x${n}`).sort().join('; ') || 'none'}`);

  const foundationRequests = await getAll(client,
    `/akoya_requests?$select=akoya_requestid,akoya_requestnum&$filter=_akoya_applicantid_value eq ${accountId}`);
  console.log(`   B. Audited meeting-date updates on the ${foundationRequests.length} Foundation-applicant Requests:`);
  let precedents = 0;
  for (const r of foundationRequests) {
    const audits = await getAllOrForbidden(client,
      '/audits?$select=createdon,_userid_value,changedata' +
      `&$filter=objecttypecode eq 'akoya_request' and _objectid_value eq ${r.akoya_requestid} and operation eq 2&$orderby=createdon asc`);
    if (!audits) {
      console.log('      audit rows not readable (403, no audit privilege); stopping part B');
      return;
    }
    for (const a of audits) {
      const kind = meetingDateChange(a.changedata);
      if (!kind) continue;
      precedents += 1;
      const at = new Date(a.createdon);
      const until = new Date(at.getTime() + HISTORY_WINDOW_MS).toISOString();
      const user = a._userid_value === appUserId ? 'APP USER' : (a[`_userid_value${F}`] || a._userid_value);
      const others = changedAttributeNames(a.changedata).filter((n) => n !== MEETING_DATE);
      console.log(`      ${r.akoya_requestnum} ${a.createdon} ${kind} by ${user}; same audit row also changed: ${others.join(', ') || 'nothing else'}`);
      const jobs = await getAll(client,
        `/asyncoperations?$select=name,statuscode&$filter=_regardingobjectid_value eq ${r.akoya_requestid}` +
        ` and createdon ge ${a.createdon} and createdon le ${until}`);
      console.log(`        background jobs regarding the Request in the next 2h: ${countBy(jobs, (j) => `${j.name} [${j.statuscode}]`).join('; ') || 'none'}`);
      const requestAudits = await getAll(client,
        '/audits?$select=createdon,_userid_value,changedata' +
        `&$filter=objecttypecode eq 'akoya_request' and _objectid_value eq ${r.akoya_requestid}` +
        ` and createdon gt ${a.createdon} and createdon le ${until}`);
      console.log(`        later audit rows on the Request in the next 2h: ${requestAudits.map((x) => changedAttributeNames(x.changedata).join('+') || '-').join('; ') || 'none'}`);
      const accountAudits = await getAll(client,
        '/audits?$select=createdon,_userid_value,changedata' +
        `&$filter=objecttypecode eq 'account' and _objectid_value eq ${accountId} and createdon ge ${a.createdon} and createdon le ${until}`);
      console.log(`        Foundation account audit rows in the next 2h: ${accountAudits.length}`);
      for (const x of accountAudits) {
        console.log(`          ${x.createdon} user=${x[`_userid_value${F}`] || x._userid_value}: ${changedAttributeNames(x.changedata).join(', ') || '-'}`);
      }
    }
  }
  console.log(`      => ${precedents} audited meeting-date update(s) on Foundation-applicant Requests`);
}

/** Like getAll, but a 403 (missing audit privilege) returns null instead of failing the probe. */
const SOURCE_TYPED_ATTRIBUTE_TYPES = [
  ...ROLLUP_ATTRIBUTE_TYPES, 'StringAttributeMetadata', 'MemoAttributeMetadata', 'BooleanAttributeMetadata', 'PicklistAttributeMetadata',
  'DoubleAttributeMetadata',
];

/** Section 10: Foundation columns that can change without an audit row. Names, timestamps and states only. */
async function printFoundationUnauditedChanges(client, since) {
  console.log(`\n10. Foundation account: columns that change without an audit row (since ${since.toISOString()})`);
  const foundation = await getAll(client,
    `/accounts?$select=accountid,modifiedon,versionnumber&$filter=name eq '${FOUNDATION_NAME}' and statecode eq 0`);
  if (foundation.length !== 1) throw new Error(`Expected one active ${FOUNDATION_NAME} account; found ${foundation.length}.`);
  const resp = await client.get(`/accounts(${foundation[0].accountid})`);
  if (!resp.ok) throw new Error(`GET Foundation account failed (${resp.status})`);
  const row = resp.body;
  console.log(`   modifiedon ${row.modifiedon}  versionnumber ${row.versionnumber}`);

  const sourced = [];
  for (const type of SOURCE_TYPED_ATTRIBUTE_TYPES) {
    const attrs = await getAll(client,
      `/EntityDefinitions(LogicalName='account')/Attributes/Microsoft.Dynamics.CRM.${type}?$select=LogicalName,SourceType,FormulaDefinition`);
    sourced.push(...attrs.filter((a) => a.SourceType === 1 || a.SourceType === 2));
  }
  const rollups = sourced.filter((a) => a.SourceType === 2).sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));
  console.log(`   rollup columns: ${rollups.length}`);
  for (const a of rollups) {
    const date = row[`${a.LogicalName}_date`] ?? null;
    const moved = date && Date.parse(date) > since.getTime();
    console.log(`   - ${a.LogicalName}  _date ${date ?? '(none)'}  _state ${row[`${a.LogicalName}_state`] ?? '(none)'}${moved ? '  RECALCULATED SINCE' : ''}`);
  }
  const calculated = sourced.filter((a) => a.SourceType === 1).sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));
  console.log(`   calculated columns: ${calculated.length}`);
  for (const a of calculated) {
    const reads = [...new Set(String(a.FormulaDefinition || '').match(/\b(?:akoya|wmkf|msdyn)_[a-z0-9_]+|\b(?:modifiedon|createdon|now)\b/gi) || [])]
      .filter((name) => name.toLowerCase() !== a.LogicalName.toLowerCase());
    console.log(`   - ${a.LogicalName}  reads: ${reads.join(', ') || '(none found)'}`);
  }

  const all = await getAll(client,
    "/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName,IsAuditEnabled,AttributeOf,IsValidForRead");
  const derived = new Set(sourced.flatMap((a) => [a.LogicalName, `${a.LogicalName}_date`, `${a.LogicalName}_state`]));
  const unaudited = all
    .filter((a) => a.IsValidForRead && !a.AttributeOf && a.IsAuditEnabled?.Value === false && !derived.has(a.LogicalName))
    .map((a) => a.LogicalName).sort();
  console.log(`   non-audited plain columns (a change to these leaves no audit row): ${unaudited.length}`);
  console.log(`   ${unaudited.join(', ')}`);
}

async function getAllOrForbidden(client, path) {
  try {
    return await getAll(client, path);
  } catch (error) {
    if (/\(403\)/.test(error.message)) return null;
    throw error;
  }
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
  const exportArg = process.argv.find((arg) => arg.startsWith('--export-xaml='));
  const exportDir = exportArg ? exportArg.slice('--export-xaml='.length) : null;
  const historyArg = process.argv.find((arg) => arg === '--history' || arg.startsWith('--history='));
  const historyLimit = historyArg ? Math.min(Math.max(parseInt(historyArg.split('=')[1] || '10', 10) || 10, 1), 50) : 0;
  const meetingArg = process.argv.find((arg) => arg === '--meeting-date' || arg.startsWith('--meeting-date='));
  const meetingLimit = meetingArg ? Math.min(Math.max(parseInt(meetingArg.split('=')[1] || '50', 10) || 50, 1), 200) : 0;
  const sinceArg = process.argv.find((arg) => arg.startsWith('--foundation-since='));
  const foundationSince = sinceArg ? new Date(sinceArg.slice('--foundation-since='.length)) : null;
  if (foundationSince && Number.isNaN(foundationSince.getTime())) throw new Error('--foundation-since must be an ISO timestamp.');
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
    '/sdkmessageprocessingsteps?$select=name,stage,mode,statecode,filteringattributes' +
    '&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)' +
    "&$filter=sdkmessagefilterid/primaryobjecttypecode eq 'akoya_request' and statecode eq 0");
  const relevant = steps.filter((s) => ['Create', 'Update'].includes(s.sdkmessageid?.name));
  console.log(`   plug-in steps (enabled, Create/Update): ${relevant.length}`);
  for (const s of relevant) {
    const filter = s.sdkmessageid.name === 'Update' ? `  fires on: ${s.filteringattributes || 'ANY column'}` : '';
    console.log(`   - [${s.sdkmessageid.name}, stage ${s.stage}, ${s.mode === 0 ? 'sync' : 'async'}] ${s.name || '(unnamed)'}  type=${s.plugintypeid?.typename || '?'}${filter}`);
  }

  const flows = await getAll(client, '/workflows?$select=name,clientdata&$filter=category eq 5 and statecode eq 1');
  const matching = flows.filter((f) => String(f.clientdata || '').includes('akoya_request'));
  console.log(`   cloud flows (activated) mentioning akoya_request: ${matching.length} of ${flows.length}`);
  for (const f of matching) console.log(`   - ${f.name}`);

  console.log('\n9. Rollup columns on account and contact (a Request create/update can trigger their recalculation)');
  for (const entityName of ['account', 'contact']) {
    const rollups = [];
    for (const type of ROLLUP_ATTRIBUTE_TYPES) {
      const attrs = await getAll(client,
        `/EntityDefinitions(LogicalName='${entityName}')/Attributes/Microsoft.Dynamics.CRM.${type}?$select=LogicalName,SourceType,FormulaDefinition`);
      rollups.push(...attrs.filter((a) => a.SourceType === 2));
    }
    const fromRequests = rollups.filter((a) => String(a.FormulaDefinition || '').includes('akoya_request'));
    console.log(`   ${entityName}: ${rollups.length} rollup column(s); ${fromRequests.length} aggregate akoya_request`);
    for (const a of fromRequests) console.log(`   - ${entityName}.${a.LogicalName} (with ${a.LogicalName}_state and ${a.LogicalName}_date)`);
  }

  if (foundationSince) await printFoundationUnauditedChanges(client, foundationSince);
  if (historyLimit) await printCreationHistory(client, historyLimit);
  if (meetingLimit) await printMeetingDateWrites(client, meetingLimit, appUsers.length === 1 ? appUsers[0].systemuserid : null);
  if (!detail && !exportDir) return;

  console.log('\n5. Detail: what each create-triggered workflow writes');
  for (const w of workflows.filter((row) => row.triggeroncreate === true)) {
    const resp = await client.get(`/workflows(${w.workflowid})?$select=xaml`);
    if (!resp.ok) throw new Error(`GET workflow xaml failed (${resp.status})`);
    const summary = summarizeWorkflowXaml(resp.body?.xaml || '');
    if (exportDir) {
      const file = require('path').join(exportDir, `${w.name.replace(/[^A-Za-z0-9]+/g, '_')}.xaml`);
      require('fs').mkdirSync(exportDir, { recursive: true });
      require('fs').writeFileSync(file, resp.body?.xaml || '');
      console.log(`     exported: ${file}`);
    }
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
