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
 *  11. With --status-fields[=<dir>]: how the three status fields a test
 *      Request will need to move are defined and what reacts to them
 *      (akoya_requeststatus, wmkf_phaseistatus, wmkf_phaseiistatus): each
 *      field's type and, for picklists, its live options; the Request forms'
 *      control for akoya_requeststatus (where its dropdown comes from); and
 *      every activated classic workflow triggered by an update of one of them.
 *      With <dir>, each such workflow's definition (process logic, no record
 *      data) is saved there for review of its conditions.
 *  12. With --cast[=<dir>]: what the synthetic-cast plan needs
 *      (TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md): workflows,
 *      plug-in steps and cloud flows that run on contact, wmkf_potentialreviewers
 *      and wmkf_appreviewersuggestion create; whether wmkf_projectleader and
 *      akoya_primarycontactid are valid for create on akoya_request and what
 *      they look up; the count of contacts with no parent account (a count
 *      only); and each business rule on akoya_request whose name mentions
 *      Request Status, with its scope and labelled steps (definitions saved
 *      to <dir> when given). Flows are matched on their Dataverse triggers and
 *      record actions (a substring match is printed as a superset); enabled
 *      Create steps with no entity filter are counted (hidden Microsoft
 *      platform steps) or listed (everything else). If any activated flow's
 *      definition is unreadable, or the contact count cannot be read, section
 *      12 prints INCOMPLETE and the probe exits 1 after its other sections.
 *      Each create-triggered workflow's definition is summarized (records it
 *      creates, columns it sets, email, non-Microsoft code activities); counts
 *      of marketing lists, marketing list members and AkoyaGo custom marketing
 *      list items show whether a new contact could join a mailing list;
 *      each marketing list's name, static/dynamic type and member type, and
 *      the akoya_mailinglistmember count and lookups, show whether one could
 *      join without create-time automation.
 *      With <dir>, a dated create-only JSON receipt (names, labels, counts,
 *      booleans; no ids, no raw definitions) is written there.
 *  13. With --reviewer-slots[=<dir>]: read-only metadata for Potential Reviewer
 *      1–5 auditing and Request-update automation (enabled Update and
 *      UpdateMultiple, Upsert and UpsertMultiple steps, Request-filtered and
 *      all-entity). Unreadable or unrecognized definitions are hard blocks;
 *      dynamic trigger tables hard-block; manual API-connection triggers,
 *      action-only mentions and zero visible flows need distinct owner
 *      dispositions. The receipt summarizes every visible flow trigger.
 *      With <dir>, write a dated receipt containing the target, names, labels,
 *      counts and booleans (no record ids or raw definitions).
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
 *   Add --status-fields[=<dir>] for section 11; --cast[=<dir>] for section 12;
 *   --reviewer-slots[=<dir>] for section 13.
 *   Add --meeting-date[=N] (default 50, max 200) to report whether the meeting
 *   date is written by an update after create on the N most recent Requests
 *   that carry one, by whom, and every audited meeting-date update on a
 *   Foundation-applicant Request with what followed it (plan open question 5).
 */

const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');

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
  ...ROLLUP_ATTRIBUTE_TYPES, 'StringAttributeMetadata', 'BooleanAttributeMetadata', 'PicklistAttributeMetadata', 'DoubleAttributeMetadata',
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
    let attrs;
    try {
      attrs = await getAll(client,
        `/EntityDefinitions(LogicalName='account')/Attributes/Microsoft.Dynamics.CRM.${type}?$select=LogicalName,SourceType,FormulaDefinition`);
    } catch (error) {
      console.log(`   (skipped ${type}: ${String(error.message).slice(0, 120)})`);
      continue;
    }
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

const STATUS_FIELDS = ['akoya_requeststatus', 'wmkf_phaseistatus', 'wmkf_phaseiistatus'];
const CONTROL_CLASSES = {
  '{4273EDBD-AC1D-40D3-9FB2-095C621B552D}': 'text box',
  '{3EF39988-22BB-4F0B-BBBE-64B5A3748AEE}': 'option set',
};

/** Section 11: status field definitions, the requeststatus form control, and update-triggered workflows. Metadata only. */
async function printStatusFields(client, exportDir) {
  console.log('\n11. Status fields a test Request will need to move');
  for (const field of STATUS_FIELDS) {
    const rows = await getAll(client,
      `/EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName,AttributeType&$filter=LogicalName eq '${field}'`);
    const type = rows[0]?.AttributeType || '(absent)';
    console.log(`   ${field}: ${type}`);
    if (type === 'Picklist') {
      const resp = await client.get(
        `/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${field}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Name,Options)`);
      if (!resp.ok) throw new Error(`GET ${field} options failed (${resp.status})`);
      const set = resp.body?.OptionSet?.Options?.length ? resp.body.OptionSet : resp.body?.GlobalOptionSet;
      if (resp.body?.GlobalOptionSet?.Name) console.log(`     global option set: ${resp.body.GlobalOptionSet.Name}`);
      for (const o of set?.Options || []) console.log(`     ${o.Value}  ${o.Label?.UserLocalizedLabel?.Label ?? '(no label)'}`);
    }
  }

  const forms = await getAll(client,
    "/systemforms?$select=name,type,formxml&$filter=objecttypecode eq 'akoya_request' and type eq 2");
  console.log(`   Request main forms: ${forms.length}`);
  for (const form of forms) {
    const xml = String(form.formxml || '');
    const controls = [...xml.matchAll(/<control\b[^>]*datafieldname="akoya_requeststatus"[^>]*>/gi)].map((m) => m[0]);
    if (!controls.length) continue;
    console.log(`   - form "${form.name}": ${controls.length} akoya_requeststatus control(s)`);
    for (const control of controls) {
      const classid = (control.match(/classid="([^"]+)"/i)?.[1] || '').toUpperCase();
      const id = control.match(/\bid="([^"]+)"/i)?.[1];
      console.log(`     classid ${classid} (${CONTROL_CLASSES[classid] || 'custom or other'})  id ${id || '?'}`);
    }
    const custom = [...xml.matchAll(/<controlDescription\b[\s\S]*?<\/controlDescription>/gi)].map((m) => m[0])
      .filter((block) => /akoya_requeststatus/i.test(block));
    for (const block of custom) {
      const names = [...new Set([...block.matchAll(/<customControl\b[^>]*name="([^"]+)"/gi)].map((m) => m[1]))];
      console.log(`     custom control(s): ${names.join(', ') || '(unnamed)'}`);
      console.log(`     parameters: ${block.replace(/\s+/g, ' ').slice(0, 800)}`);
    }
  }

  const workflows = await getAll(client,
    "/workflows?$select=name,workflowid,mode,triggeronupdateattributelist&$filter=primaryentity eq 'akoya_request' and category eq 0 and statecode eq 1 and type eq 1");
  const triggered = workflows.filter((w) => STATUS_FIELDS.some((f) => String(w.triggeronupdateattributelist || '').split(',').includes(f)));
  console.log(`   classic workflows triggered by an update of a status field: ${triggered.length}`);
  for (const w of triggered) {
    const resp = await client.get(`/workflows(${w.workflowid})?$select=xaml`);
    if (!resp.ok) throw new Error(`GET workflow xaml failed (${resp.status})`);
    const xaml = resp.body?.xaml || '';
    const summary = summarizeWorkflowXaml(xaml);
    const reads = STATUS_FIELDS.filter((f) => xaml.includes(`"${f}"`));
    console.log(`   - ${w.name}  on update(${w.triggeronupdateattributelist})  ${w.mode === 1 ? 'real-time' : 'background'}`);
    console.log(`     reads: ${reads.join(', ') || '(none)'}  creates: ${summary.creates.join(', ') || '(none)'}  sends email: ${summary.sendsEmail}`);
    console.log(`     sets: ${summary.sets.join(', ') || '(none)'}`);
    if (exportDir) {
      const file = require('path').join(exportDir, `${w.name.replace(/[^A-Za-z0-9]+/g, '_')}.xaml`);
      require('fs').mkdirSync(exportDir, { recursive: true });
      require('fs').writeFileSync(file, xaml);
      console.log(`     exported: ${file}`);
    }
  }
}

const CAST_ENTITIES = ['contact', 'wmkf_potentialreviewers', 'wmkf_appreviewersuggestion'];
const CAST_REQUEST_LOOKUPS = ['wmkf_projectleader', 'akoya_primarycontactid'];

/**
 * Whether a cloud flow's definition can be read: `clientdata` present, valid
 * JSON, with a `properties.definition` object. Without one the flow's triggers
 * and actions are unknown, so section 12 cannot rule it out.
 */
function classifyFlowDefinition(clientdata) {
  if (clientdata == null || String(clientdata).trim() === '') return { readable: false, reason: 'no clientdata' };
  let parsed;
  try {
    parsed = JSON.parse(clientdata);
  } catch {
    return { readable: false, reason: 'clientdata did not parse' };
  }
  const definition = parsed?.properties?.definition;
  if (!definition || typeof definition !== 'object') return { readable: false, reason: 'no definition' };
  return { readable: true, definition };
}

/**
 * Whether a readable flow definition names the entity in a Dataverse trigger
 * (`subscriptionRequest/entityname`, a logical name) or a record action
 * (`entityName`, usually the entity set name).
 */
function flowNamesEntity(definition, names) {
  const wanted = new Set(names.filter(Boolean));
  for (const t of Object.values(definition.triggers || {})) {
    if (wanted.has(t?.inputs?.parameters?.['subscriptionRequest/entityname'])) return true;
  }
  let found = false;
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (wanted.has(node?.inputs?.parameters?.entityName)) { found = true; return; }
    for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value);
  };
  walk(definition.actions);
  return found;
}

/** Enabled Create steps with no entity filter: they run on every entity's create. */
function unfilteredCreateSteps(steps) {
  return steps.filter((st) => st.sdkmessageid?.name === 'Create'
    && (!st.sdkmessagefilterid || !st.sdkmessagefilterid.primaryobjecttypecode || st.sdkmessagefilterid.primaryobjecttypecode === 'none'));
}

/** A hidden step whose plug-in type is in the Microsoft namespace: platform plumbing, counted rather than listed. */
function isPlatformStep(st) {
  const hidden = typeof st.ishidden === 'object' ? st.ishidden?.Value : st.ishidden;
  return hidden === true && /^Microsoft\./.test(st.plugintypeid?.typename || '');
}

const MAILING_LIST_COUNTS = [
  ['marketing lists (list, all)', '/lists?$apply=aggregate($count as n)'],
  ['marketing lists (list, active)', '/lists?$apply=filter(statecode eq 0)/aggregate($count as n)'],
  ['marketing list members (listmember, contacts)', "/listmembers?$apply=filter(entitytype eq 'contact')/aggregate($count as n)"],
  ['AkoyaGo custom marketing list items (all)', '/akoya_custommarketinglistitems?$apply=aggregate($count as n)'],
  ['AkoyaGo custom marketing list items (active)', '/akoya_custommarketinglistitems?$apply=filter(statecode eq 0)/aggregate($count as n)'],
];

const LIST_MEMBER_TYPE = { 1: 'account', 2: 'contact', 4: 'lead' };
const OWNERSHIP_LOOKUPS = new Set(['createdby', 'createdonbehalfby', 'modifiedby', 'modifiedonbehalfby', 'ownerid', 'owninguser', 'owningteam', 'owningbusinessunit', 'organizationid']);

/** Non-Microsoft code activities a workflow calls (their writes are not visible in the XAML). */
function customWorkflowActivities(xaml) {
  const names = [...String(xaml).matchAll(/AssemblyQualifiedName="([^",]+)/g)].map((m) => m[1]);
  return [...new Set(names.filter((n) => !/^(Microsoft|System)\./.test(n)))].sort();
}

const stepLabel = (st) => `[stage ${st.stage}, ${st.mode === 0 ? 'sync' : 'async'}] ${st.name || '(unnamed)'}  type=${st.plugintypeid?.typename || '?'}`;

const REVIEWER_SLOTS = ['1', '2', '3', '4', '5'].map((n) => `wmkf_potentialreviewer${n}`);

function slotMentions(value) {
  return REVIEWER_SLOTS.filter((slot) => String(value || '').toLowerCase().includes(slot));
}

function mentionsRequestOrSlot(value) {
  const source = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return /\bakoya_requests?\b/i.test(source) || slotMentions(source).length > 0;
}

/** A subscription target must be a literal logical name to rule out Request. */
function subscriptionTarget(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return { kind: 'none', entity: null };
  const keys = Object.keys(parameters).filter((key) => key.startsWith('subscriptionRequest/'));
  if (!keys.length) return { kind: 'none', entity: null };
  const entity = parameters['subscriptionRequest/entityname'];
  if (typeof entity !== 'string' || !/^[a-z][a-z0-9_]*$/.test(entity)) return { kind: 'dynamic-or-unknown', entity: null };
  return { kind: 'literal', entity };
}

function tableTarget(parameters) {
  if (!parameters || typeof parameters !== 'object' || !Object.hasOwn(parameters, 'table')) return { kind: 'none', table: null };
  const table = parameters.table;
  if (typeof table !== 'string' || !/^[a-z][a-z0-9_]*$/.test(table)) return { kind: 'dynamic-or-unknown', table: null };
  return { kind: 'literal', table };
}

function hasTriggerExpression(value, path = []) {
  if (typeof value === 'string') {
    // Observed connection/auth wiring is not a table selector. Keep the
    // exemptions exact; expressions at every other input path hard-block.
    if (['host.connection.name', 'authentication'].includes(path.join('.'))) return false;
    return value.startsWith('@') || value.includes('@{');
  }
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => hasTriggerExpression(child, [...path, key]));
}

function safeIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(value) ? value : 'unknown';
}

function flowMessageNumber(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
}

function literalFilterColumns(value) {
  if (value == null || value === '') return [];
  if (typeof value !== 'string') return null;
  const fields = value.split(',').map((field) => field.trim().toLowerCase()).filter(Boolean);
  return fields.every((field) => /^[a-z][a-z0-9_]*$/.test(field)) ? fields : null;
}

/** Sanitized trigger evidence for every visible activated flow. */
function slotTriggerSummary(name, trigger, target) {
  const parameters = trigger?.inputs?.parameters;
  const rawMessage = parameters?.['subscriptionRequest/message'];
  const table = tableTarget(parameters);
  return {
    name, type: safeIdentifier(trigger?.type), kind: safeIdentifier(trigger?.kind),
    subscriptionTarget: target.kind, entity: target.entity,
    tableTarget: table.kind, table: table.table,
    message: rawMessage == null ? null : (flowMessageNumber(rawMessage) ?? 'dynamic-or-unknown'),
  };
}

function stepFilterCategory(step) {
  if (!step.sdkmessagefilterid) return 'absent lookup';
  const entity = step.sdkmessagefilterid.primaryobjecttypecode;
  return entity === 'none' ? 'none' : entity ? 'literal' : 'empty entity';
}

function probeSourceProvenance() {
  const { execFileSync } = require('child_process');
  const cwd = require('path').resolve(__dirname, '..');
  try {
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(),
      probeDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--', 'scripts/probe-test-request-factory-production-readiness.js'], { cwd, encoding: 'utf8' }).trim()),
      clientDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--', 'lib/dataverse/client.js'], { cwd, encoding: 'utf8' }).trim()),
      branch: execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim() || null,
    };
  } catch {
    return { commit: null, probeDirty: null, clientDirty: null, branch: null };
  }
}

/** The observed Power Automate manual API-connection shape has no Dataverse subscription. */
function isManualApiConnectionTrigger(name, trigger) {
  const parameters = trigger?.inputs?.parameters;
  return name === 'manual' && trigger?.type === 'Request' && trigger?.kind === 'ApiConnection'
    && parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    && Object.keys(parameters).length === 2
    && Object.hasOwn(parameters, 'dataset') && Object.hasOwn(parameters, 'table');
}

/** null means no Request Update trigger; otherwise classify the exact filter list. */
function classifySlotUpdateFlow(parameters) {
  if (parameters?.['subscriptionRequest/entityname'] !== 'akoya_request') return null;
  const message = flowMessageNumber(parameters?.['subscriptionRequest/message']);
  if (![3, 4, 6, 7].includes(message)) return null;
  const fields = literalFilterColumns(parameters?.['subscriptionRequest/filteringattributes']);
  if (fields === null) return { message: FLOW_MESSAGE[message], firesOn: 'dynamic-or-unknown filter' };
  const slots = fields.filter((field) => REVIEWER_SLOTS.includes(field));
  return { message: FLOW_MESSAGE[message], firesOn: !fields.length ? 'ANY column' : slots.length ? `a slot (${slots.join(',')})` : `other columns only (${fields.join(',')})` };
}

// A single Update also runs steps registered on UpdateMultiple (merged message
// pipelines): https://learn.microsoft.com/en-us/power-apps/developer/data-platform/bulk-operations#message-pipelines-merged
// Include Upsert messages conservatively: the concrete-ETag PATCH message is
// not established by the cited Web API conditional-update documentation.
const SLOT_WRITE_MESSAGES = new Set(['Update', 'UpdateMultiple', 'Upsert', 'UpsertMultiple']);

/** null means the step cannot fire on a reviewer-slot update. */
function classifySlotWriteStep(step) {
  if (!SLOT_WRITE_MESSAGES.has(step?.sdkmessageid?.name)) return null;
  const fields = literalFilterColumns(step.filteringattributes);
  if (fields === null) return 'dynamic-or-unknown filter';
  if (!fields.length) return 'ANY column';
  const slots = fields.filter((field) => REVIEWER_SLOTS.includes(field));
  return slots.length ? `a slot (${slots.join(',')})` : null;
}

function stepIsHidden(step) {
  return step?.ishidden === true || step?.ishidden?.Value === true;
}

/** Section 13: metadata only; every unreadable definition makes the receipt incomplete. */
async function printReviewerSlotReadiness(client, exportDir, source = probeSourceProvenance()) {
  console.log('\n13. Potential Reviewer slot update readiness (metadata only)');
  const receipt = {
    section: 13, target: PRODUCTION_URL, generatedAt: new Date().toISOString(), complete: false,
    source, incompleteReasons: [], dispositionRequired: [], auditing: {},
    workflows: [], steps: [], flows: [], flowMentions: [], flowTriggerSummaries: [], flowTriggerReviewEntries: [], counts: {},
  };
  if (!/^[0-9a-f]{40}$/.test(source?.commit || '') || source?.probeDirty !== false || source?.clientDirty !== false) {
    receipt.incompleteReasons.push('probe source not a committed clean tree');
  }
  const entity = await client.get("/EntityDefinitions(LogicalName='akoya_request')?$select=IsAuditEnabled");
  if (!entity.ok || typeof entity.body?.IsAuditEnabled?.Value !== 'boolean') receipt.incompleteReasons.push('Request entity auditing unreadable');
  receipt.auditing.entity = entity.body?.IsAuditEnabled?.Value ?? null;
  console.log(`   Request auditing: ${receipt.auditing.entity === null ? 'unreadable' : receipt.auditing.entity}`);
  for (const slot of REVIEWER_SLOTS) {
    const response = await client.get(`/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${slot}')?$select=LogicalName,IsAuditEnabled`);
    const audited = response.ok ? response.body?.IsAuditEnabled?.Value : null;
    if (typeof audited !== 'boolean') receipt.incompleteReasons.push(`${slot} auditing unreadable`);
    receipt.auditing[slot] = typeof audited === 'boolean' ? audited : null;
    console.log(`   ${slot}: audited=${receipt.auditing[slot] === null ? 'unreadable' : receipt.auditing[slot]}`);
  }

  const workflows = await getAll(client, "/workflows?$select=name,category,mode,triggeronupdateattributelist,xaml&$filter=primaryentity eq 'akoya_request' and type eq 1 and statecode eq 1");
  const classic = workflows.filter((row) => row.category === 0 && row.triggeronupdateattributelist);
  const triggered = classic.filter((row) => String(row.triggeronupdateattributelist).split(',').some((field) => REVIEWER_SLOTS.includes(field.trim().toLowerCase())));
  receipt.counts.activatedWorkflowsAndRules = workflows.length;
  receipt.counts.updateTriggeredWorkflows = classic.length;
  receipt.counts.slotTriggeredWorkflows = triggered.length;
  receipt.counts.unreadableWorkflowsAndRules = workflows.filter((row) => !row.xaml).length;
  console.log(`   activated Request workflows/rules: ${workflows.length}; update-triggered workflows: ${classic.length}; slot-triggered: ${triggered.length}`);
  for (const row of workflows) {
    const readable = Boolean(row.xaml);
    const mentions = readable ? slotMentions(row.xaml) : [];
    const updateAttributes = literalFilterColumns(row.triggeronupdateattributelist);
    const item = {
      name: row.name || '(unnamed)', kind: row.category === 2 ? 'business rule' : 'workflow',
      mode: row.category === 0 ? (row.mode === 1 ? 'real-time' : 'background') : null,
      triggered: triggered.includes(row), mentions, readable,
      updateAttributes: updateAttributes === null ? 'dynamic-or-unknown' : updateAttributes,
    };
    receipt.workflows.push(item);
    if (item.triggered || mentions.length || !readable) console.log(`   - ${item.kind} ${item.name}: ${item.triggered ? 'slot-triggered' : 'mentions'} ${mentions.join(',')} (${readable ? 'readable' : 'UNREADABLE'})`);
    if (updateAttributes === null) receipt.incompleteReasons.push(`Request workflow update filter dynamic or unknown: ${item.name}`);
    if (item.triggered) receipt.dispositionRequired.push(`Request workflow can fire on reviewer-slot update: ${item.name}`);
    if (!readable) receipt.incompleteReasons.push(`workflow definition unreadable: ${row.name || '(unnamed)'}`);
  }

  const steps = await getAll(client, '/sdkmessageprocessingsteps?$select=name,stage,mode,filteringattributes,ishidden' +
    '&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)' +
    "&$filter=(sdkmessageid/name eq 'Update' or sdkmessageid/name eq 'UpdateMultiple' or sdkmessageid/name eq 'Upsert' or sdkmessageid/name eq 'UpsertMultiple') and statecode eq 0");
  const requestSteps = steps.filter((row) => SLOT_WRITE_MESSAGES.has(row.sdkmessageid?.name) && row.sdkmessagefilterid?.primaryobjecttypecode === 'akoya_request');
  let stepDispositions = 0;
  receipt.counts.allEnabledSlotWriteSteps = steps.length;
  receipt.counts.allEnabledUpdateMultipleSteps = steps.filter((row) => row.sdkmessageid?.name === 'UpdateMultiple').length;
  receipt.counts.allEnabledUpsertSteps = steps.filter((row) => row.sdkmessageid?.name === 'Upsert').length;
  receipt.counts.allEnabledUpsertMultipleSteps = steps.filter((row) => row.sdkmessageid?.name === 'UpsertMultiple').length;
  receipt.counts.requestSlotWriteSteps = requestSteps.length;
  console.log(`   enabled Request Update/UpdateMultiple/Upsert/UpsertMultiple steps: ${requestSteps.length}`);
  for (const row of requestSteps) {
    const firesOn = classifySlotWriteStep(row);
    const name = row.name || '(unnamed)';
    const filteringColumns = literalFilterColumns(row.filteringattributes);
    receipt.steps.push({ name, message: row.sdkmessageid.name, type: row.plugintypeid?.typename || '?', stage: row.stage, mode: row.mode, hidden: stepIsHidden(row), entityFilter: stepFilterCategory(row), filteringColumns: filteringColumns === null ? 'dynamic-or-unknown' : filteringColumns, firesOn: firesOn || 'other columns only' });
    if (firesOn) console.log(`   - ${firesOn} (${row.sdkmessageid.name}): ${stepLabel(row)}`);
    if (filteringColumns === null) receipt.incompleteReasons.push(`Request step update filter dynamic or unknown: ${name}`);
    if (!isPlatformStep(row) && (firesOn === 'ANY column' || firesOn?.startsWith('a slot ('))) {
      receipt.dispositionRequired.push(`custom Request step can fire on reviewer-slot update: ${name}`);
      stepDispositions += 1;
    }
  }
  // Dataverse can represent an all-entity registration as no filter row, a
  // filter with no primary type, or a filter whose primary type is 'none'.
  const globalSteps = steps.filter((row) => SLOT_WRITE_MESSAGES.has(row.sdkmessageid?.name)
    && (!row.sdkmessagefilterid || !row.sdkmessagefilterid.primaryobjecttypecode || row.sdkmessagefilterid.primaryobjecttypecode === 'none'));
  receipt.counts.globalSlotWriteSteps = globalSteps.length;
  receipt.counts.hiddenGlobalSlotWriteSteps = globalSteps.filter(stepIsHidden).length;
  receipt.counts.hiddenMicrosoftPlatformSlotWriteSteps = globalSteps.filter(isPlatformStep).length;
  console.log(`   enabled Update/UpdateMultiple/Upsert/UpsertMultiple steps with no entity filter: ${globalSteps.length} (hidden: ${receipt.counts.hiddenGlobalSlotWriteSteps}; hidden Microsoft platform: ${receipt.counts.hiddenMicrosoftPlatformSlotWriteSteps})`);
  for (const row of globalSteps.filter((item) => !isPlatformStep(item))) {
    const filteringColumns = literalFilterColumns(row.filteringattributes);
    const firesOn = filteringColumns === null ? 'dynamic-or-unknown filter' : filteringColumns.length ? 'other columns only' : 'ANY entity/column';
    receipt.steps.push({ name: row.name || '(unnamed)', message: row.sdkmessageid.name, type: row.plugintypeid?.typename || '?', stage: row.stage, mode: row.mode, hidden: stepIsHidden(row), entityFilter: stepFilterCategory(row), filteringColumns: filteringColumns === null ? 'dynamic-or-unknown' : filteringColumns, firesOn });
    console.log(`   - ${firesOn} (${row.sdkmessageid.name}): ${stepLabel(row)}`);
    if (filteringColumns === null) receipt.incompleteReasons.push(`global step update filter dynamic or unknown: ${row.name || '(unnamed)'}`);
    if (filteringColumns?.length === 0) {
      receipt.dispositionRequired.push(`custom global step can fire on reviewer-slot update: ${row.name || '(unnamed)'}`);
      stepDispositions += 1;
    }
  }
  receipt.counts.stepDispositions = stepDispositions;

  const flows = await getAll(client, '/workflows?$select=name,clientdata&$filter=category eq 5 and statecode eq 1');
  let unreadable = 0;
  let requestUpdate = 0;
  let requestNonUpdate = 0;
  let manualApiConnectionTriggers = 0;
  let hardBlockedFlowTriggers = 0;
  let actionOnlyTriggerDispositions = 0;
  for (const flow of flows) {
    const name = flow.name || '(unnamed)';
    const rawMention = mentionsRequestOrSlot(flow.clientdata);
    const classified = classifyFlowDefinition(flow.clientdata);
    if (!classified.readable) {
      unreadable += 1;
      receipt.flowTriggerSummaries.push({ name, readable: false, triggers: [] });
      if (rawMention) receipt.flowMentions.push({ name, readable: false, recognizedRequestTriggers: 0, unclassifiedRequestTriggers: 0, manualApiConnectionTriggers: 0, actionOnlyTriggerDispositions: 0 });
      continue;
    }
    let recognizedRequestTriggers = 0;
    let unclassifiedRequestTriggers = 0;
    let manualTriggersInFlow = 0;
    let actionOnlyInFlow = 0;
    const triggers = classified.definition.triggers;
    if (!triggers || typeof triggers !== 'object' || Array.isArray(triggers) || !Object.keys(triggers).length) {
      unreadable += 1;
      receipt.incompleteReasons.push(`cloud-flow triggers missing or unreadable: ${name}`);
      receipt.flowTriggerSummaries.push({ name, readable: false, triggers: [] });
      if (rawMention) receipt.flowMentions.push({ name, readable: false, recognizedRequestTriggers: 0, unclassifiedRequestTriggers: 0, manualApiConnectionTriggers: 0, actionOnlyTriggerDispositions: 0 });
      continue;
    }
    const triggerSummaries = [];
    for (const [triggerName, trigger] of Object.entries(triggers)) {
      const parameters = trigger?.inputs?.parameters;
      const target = subscriptionTarget(parameters);
      const summary = slotTriggerSummary(triggerName, trigger, target);
      triggerSummaries.push(summary);
      const slotUpdate = target.entity === 'akoya_request' ? classifySlotUpdateFlow(parameters) : null;
      if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
        summary.classification = 'hard block: unreadable trigger shape';
        unclassifiedRequestTriggers += 1;
        receipt.flowTriggerReviewEntries.push({ name, trigger: triggerName, reason: 'unreadable trigger shape' });
        receipt.incompleteReasons.push(`cloud-flow trigger shape unreadable: ${name} / ${triggerName}`);
      } else if (slotUpdate?.firesOn === 'dynamic-or-unknown filter') {
        summary.classification = 'hard block: dynamic Request update filter';
        requestUpdate += 1;
        unclassifiedRequestTriggers += 1;
        receipt.flows.push({ name, trigger: triggerName, ...slotUpdate });
        receipt.flowTriggerReviewEntries.push({ name, trigger: triggerName, reason: 'dynamic Request update filter' });
        receipt.incompleteReasons.push(`Request update filter dynamic or unknown: ${name} / ${triggerName}`);
      } else if (target.kind === 'dynamic-or-unknown' || summary.tableTarget === 'dynamic-or-unknown' || hasTriggerExpression(trigger.inputs)) {
        summary.classification = 'hard block: dynamic or unknown trigger table';
        unclassifiedRequestTriggers += 1;
        receipt.flowTriggerReviewEntries.push({ name, trigger: triggerName, reason: 'dynamic or unknown trigger table' });
        receipt.incompleteReasons.push(`cloud-flow trigger table dynamic or unknown: ${name} / ${triggerName}`);
      } else if (target.entity === 'akoya_request') {
        const message = flowMessageNumber(parameters['subscriptionRequest/message']);
        if (Object.hasOwn(FLOW_MESSAGE, message)) {
          summary.classification = 'Request subscription';
          recognizedRequestTriggers += 1;
          const match = slotUpdate;
          if (match) {
            requestUpdate += 1;
            receipt.flows.push({ name, trigger: triggerName, ...match });
            if (match.firesOn === 'ANY column' || match.firesOn.startsWith('a slot (')) {
              receipt.dispositionRequired.push(`Request flow can fire on reviewer-slot update: ${name} / ${triggerName}`);
            }
            console.log(`   - cloud flow ${name} / ${triggerName}: ${match.message}, fires on ${match.firesOn}`);
          } else {
            requestNonUpdate += 1;
          }
        } else {
          summary.classification = 'hard block: unknown Request message';
          unclassifiedRequestTriggers += 1;
          receipt.flowTriggerReviewEntries.push({ name, trigger: triggerName, reason: 'unrecognized Request message' });
          receipt.incompleteReasons.push(`Request flow trigger message unrecognized: ${name} / ${triggerName}`);
        }
      } else if (rawMention && isManualApiConnectionTrigger(triggerName, trigger)) {
        summary.classification = 'manual API connection: owner disposition';
        manualApiConnectionTriggers += 1;
        manualTriggersInFlow += 1;
        receipt.flowTriggerReviewEntries.push({ name, trigger: triggerName, reason: 'manual API-connection trigger without Dataverse subscription' });
        receipt.dispositionRequired.push(`manual API-connection trigger in Request/slot-mentioning flow requires owner classification: ${name} / ${triggerName}`);
      } else if (mentionsRequestOrSlot(trigger)) {
        summary.classification = 'hard block: unknown Request trigger shape';
        unclassifiedRequestTriggers += 1;
        receipt.flowTriggerReviewEntries.push({ name, trigger: triggerName, reason: 'unclassified Request trigger shape' });
        receipt.incompleteReasons.push(`Request flow trigger shape unclassified: ${name} / ${triggerName}`);
      } else if (rawMention) {
        summary.classification = 'other trigger: owner disposition for Request/slot actions';
        actionOnlyTriggerDispositions += 1;
        actionOnlyInFlow += 1;
        receipt.flowTriggerReviewEntries.push({ name, trigger: triggerName, reason: 'Request/slot mention outside this trigger' });
        receipt.dispositionRequired.push(`flow mentions Request or slot without a classified Request trigger: ${name} / ${triggerName}`);
      } else {
        summary.classification = target.kind === 'literal' ? 'other literal Dataverse subscription' : 'no Request/slot mention';
      }
    }
    receipt.flowTriggerSummaries.push({ name, readable: true, triggers: triggerSummaries });
    hardBlockedFlowTriggers += unclassifiedRequestTriggers;
    if (rawMention) {
      receipt.flowMentions.push({ name, readable: true, recognizedRequestTriggers, unclassifiedRequestTriggers, manualApiConnectionTriggers: manualTriggersInFlow, actionOnlyTriggerDispositions: actionOnlyInFlow });
    }
  }
  receipt.counts.flowsRead = flows.length;
  receipt.counts.flowsMentioningRequestOrSlot = receipt.flowMentions.length;
  receipt.counts.requestUpdateTriggers = requestUpdate;
  receipt.counts.requestNonUpdateTriggers = requestNonUpdate;
  receipt.counts.manualApiConnectionTriggers = manualApiConnectionTriggers;
  receipt.counts.hardBlockedFlowTriggers = hardBlockedFlowTriggers;
  receipt.counts.actionOnlyTriggerDispositions = actionOnlyTriggerDispositions;
  receipt.counts.triggerReviewEntries = receipt.flowTriggerReviewEntries.length;
  receipt.counts.unreadableFlows = unreadable;
  if (flows.length === 0) receipt.dispositionRequired.push('no activated cloud flows visible to the probe identity; confirm zero against an admin inventory');
  if (unreadable) receipt.incompleteReasons.push(`${unreadable} cloud-flow definitions unreadable`);
  console.log(`   flows read: ${flows.length}; Request/slot mention superset: ${receipt.flowMentions.length}; Request update triggers: ${requestUpdate}; manual API-connection triggers for disposition: ${manualApiConnectionTriggers}; trigger/mention review entries: ${receipt.flowTriggerReviewEntries.length}; unreadable definitions: ${unreadable}`);
  for (const item of receipt.flowTriggerReviewEntries) console.log(`   - REVIEW ${item.name} / ${item.trigger}: ${item.reason}`);
  // Completeness covers the visible definitions only. The release gate separately
  // requires effective organization-wide Process read or an admin inventory.
  receipt.complete = receipt.incompleteReasons.length === 0 && receipt.dispositionRequired.length === 0;
  console.log(`   section 13: ${receipt.complete ? 'COMPLETE (visible metadata only)' : `INCOMPLETE (hard: ${receipt.incompleteReasons.join('; ') || 'none'}; owner disposition: ${receipt.dispositionRequired.join('; ') || 'none'})`}`);
  if (exportDir) {
    const fs = require('fs');
    fs.mkdirSync(exportDir, { recursive: true });
    const file = require('path').join(exportDir, `reviewer-slot-readiness-receipt-${receipt.generatedAt.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    console.log(`   receipt: ${file}`);
  }
  return receipt;
}

/**
 * Section 12: synthetic-cast readiness. Metadata, names and one count only.
 * Returns the receipt: names, labels, counts and booleans (no ids, no raw
 * definitions). `complete: false` with reasons when something it relies on
 * could not be read.
 */
async function printCastReadiness(client, exportDir) {
  console.log('\n12. Synthetic cast readiness (PI, Liaison, suggested reviewer)');
  const receipt = { section: 12, target: PRODUCTION_URL, generatedAt: new Date().toISOString(), complete: true, incompleteReasons: [], entities: {} };
  const flows = await getAll(client, '/workflows?$select=name,clientdata&$filter=category eq 5 and statecode eq 1');
  const classified = flows.map((f) => ({ name: f.name, clientdata: f.clientdata, ...classifyFlowDefinition(f.clientdata) }));
  const unreadable = classified.filter((f) => !f.readable);
  receipt.flows = { activated: flows.length, readable: flows.length - unreadable.length, unreadable: unreadable.map((f) => ({ name: f.name, reason: f.reason })) };
  console.log(`   activated cloud flows: ${flows.length}; readable definitions: ${flows.length - unreadable.length}; unreadable: ${unreadable.length}`);
  for (const f of unreadable) console.log(`   - UNREADABLE ${f.name} (${f.reason})`);
  if (!flows.length) console.log('   (no activated cloud flows visible to this user: flow coverage is empty, not proven absent)');
  if (unreadable.length) receipt.incompleteReasons.push(`${unreadable.length} activated cloud flow definition(s) unreadable`);

  const allCreate = await getAll(client,
    '/sdkmessageprocessingsteps?$select=name,stage,mode,statecode,ishidden' +
    '&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)' +
    "&$filter=sdkmessageid/name eq 'Create' and statecode eq 0");
  const unfiltered = unfilteredCreateSteps(allCreate);
  const listed = unfiltered.filter((st) => !isPlatformStep(st));
  receipt.createStepsForAllEntities = {
    enabledCreateSteps: allCreate.length,
    unfiltered: unfiltered.length,
    hiddenMicrosoftPlatformSteps: unfiltered.length - listed.length,
    otherUnfiltered: listed.map(stepLabel),
  };
  console.log(`   enabled Create steps (all entities): ${allCreate.length}; registered for every entity: ${unfiltered.length}` +
    ` (${unfiltered.length - listed.length} hidden Microsoft platform steps; ${listed.length} other, listed)`);
  for (const st of listed) console.log(`   - ${stepLabel(st)}`);

  for (const entity of CAST_ENTITIES) {
    console.log(`   ${entity}:`);
    const entry = {};
    receipt.entities[entity] = entry;
    const workflows = await getAll(client,
      "/workflows?$select=name,category,mode,triggeroncreate,triggeronupdateattributelist,workflowid" +
      `&$filter=primaryentity eq '${entity}' and type eq 1 and statecode eq 1`);
    const onCreate = workflows.filter((w) => w.triggeroncreate === true);
    entry.workflowsActivated = workflows.length;
    entry.workflowsOnCreate = [];
    console.log(`     classic workflows / business rules (activated): ${workflows.length}; on create: ${onCreate.length}`);
    for (const w of onCreate) {
      const label = `[${WORKFLOW_CATEGORY[w.category] || w.category}, ${w.mode === 1 ? 'real-time' : 'background'}] ${w.name}`;
      const resp = await client.get(`/workflows(${w.workflowid})?$select=xaml`);
      if (!resp.ok || !resp.body?.xaml) {
        entry.workflowsOnCreate.push({ label, readable: false });
        receipt.incompleteReasons.push(`${entity} create workflow "${w.name}" definition unreadable`);
        console.log(`     - ${label}  (definition UNREADABLE)`);
        continue;
      }
      const summary = summarizeWorkflowXaml(resp.body.xaml);
      const customActivities = customWorkflowActivities(resp.body.xaml);
      entry.workflowsOnCreate.push({ label, readable: true, creates: summary.creates, sets: summary.sets, sendsEmail: summary.sendsEmail, customActivities });
      console.log(`     - ${label}`);
      console.log(`       creates: ${summary.creates.join(', ') || '(none)'}  sends email: ${summary.sendsEmail}  custom activities: ${customActivities.join(', ') || '(none)'}`);
      console.log(`       sets: ${summary.sets.join(', ') || '(none)'}`);
      if (exportDir) {
        const file = require('path').join(exportDir, `${entity}_${w.name.replace(/[^A-Za-z0-9]+/g, '_')}.xaml`);
        require('fs').mkdirSync(exportDir, { recursive: true });
        require('fs').writeFileSync(file, resp.body.xaml);
      }
    }
    const steps = await getAll(client,
      '/sdkmessageprocessingsteps?$select=name,stage,mode,statecode' +
      '&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)' +
      `&$filter=sdkmessagefilterid/primaryobjecttypecode eq '${entity}' and statecode eq 0`);
    const createSteps = steps.filter((st) => st.sdkmessageid?.name === 'Create');
    entry.createSteps = createSteps.map(stepLabel);
    console.log(`     plug-in steps on Create (enabled, entity-registered): ${createSteps.length}`);
    for (const label of entry.createSteps) console.log(`     - ${label}`);
    const def = await client.get(`/EntityDefinitions(LogicalName='${entity}')?$select=EntitySetName`);
    if (!def.ok) throw new Error(`GET ${entity} EntitySetName failed (${def.status})`);
    const names = [entity, def.body?.EntitySetName];
    const structured = classified.filter((f) => f.readable && flowNamesEntity(f.definition, names));
    const mentioning = flows.filter((f) => String(f.clientdata || '').includes(`"${entity}`) || String(f.clientdata || '').includes(`${entity}s"`));
    entry.flowsNamingIt = structured.map((f) => ({ name: f.name, ...summarizeFlow(f.clientdata) }));
    entry.flowsMentioningItBySubstring = mentioning.map((f) => f.name);
    console.log(`     cloud flows naming it in a trigger or record action: ${structured.length}; mentioning it anywhere: ${mentioning.length}`);
    for (const f of entry.flowsNamingIt) console.log(`     - ${f.name}  triggers: ${f.triggers.join('; ') || '(none)'}  actions: ${f.actions.join(', ') || '(none)'}`);
    for (const name of entry.flowsMentioningItBySubstring.filter((n) => !structured.some((f) => f.name === n))) console.log(`     - (mention only) ${name}`);
  }

  receipt.requestLookups = {};
  console.log('   akoya_request lookups the clone would set:');
  for (const field of CAST_REQUEST_LOOKUPS) {
    const attrs = await getAll(client,
      `/EntityDefinitions(LogicalName='akoya_request')/Attributes?$select=LogicalName,IsValidForCreate,IsValidForUpdate&$filter=LogicalName eq '${field}'`);
    const rels = await getAll(client,
      "/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships?$select=ReferencedEntity,ReferencingEntityNavigationPropertyName" +
      `&$filter=ReferencingAttribute eq '${field}'`);
    const a = attrs[0];
    const line = `${a ? `create=${a.IsValidForCreate} update=${a.IsValidForUpdate}` : '(absent)'}  looks up: ${rels.map((r) => `${r.ReferencedEntity} via ${r.ReferencingEntityNavigationPropertyName}`).join(', ') || '(none)'}`;
    receipt.requestLookups[field] = line;
    console.log(`   - ${field}: ${line}`);
  }

  const orphanResp = await client.get("/contacts?$apply=filter(_parentcustomerid_value eq null and statecode eq 0)/aggregate($count as n)");
  const orphans = orphanResp.ok ? orphanResp.body?.value?.[0]?.n : `unreadable (${orphanResp.status})`;
  receipt.activeContactsWithoutParentAccount = orphans;

  // Whether a new contact could join a mailing list: Dynamics marketing lists
  // and AkoyaGo's custom marketing list items. Counts only.
  receipt.mailingLists = {};
  for (const [label, path] of MAILING_LIST_COUNTS) {
    const resp = await client.get(path);
    const n = resp.ok ? resp.body?.value?.[0]?.n : `unreadable (${resp.status})`;
    receipt.mailingLists[label] = n;
    if (!resp.ok) receipt.incompleteReasons.push(`${label} count unreadable`);
    console.log(`   ${label} (count only): ${n}`);
  }

  // A dynamic list takes members from a saved query, so a new contact can join
  // one without any create-time automation. Names, type and member type only.
  const lists = await getAll(client, '/lists?$select=listname,type,createdfromcode,statecode');
  receipt.mailingLists.lists = lists.map((l) => ({
    name: l.listname, dynamic: l.type === true, memberType: LIST_MEMBER_TYPE[l.createdfromcode] || String(l.createdfromcode), active: l.statecode === 0,
  }));
  for (const l of receipt.mailingLists.lists) {
    console.log(`   - list "${l.name}": ${l.dynamic ? 'DYNAMIC (query-based)' : 'static'}, members: ${l.memberType}, ${l.active ? 'active' : 'inactive'}`);
  }

  // akoya_mailinglistmember: what "Update Mailing List Member Info (Contact)" writes to.
  const mlm = await client.get("/EntityDefinitions(LogicalName='akoya_mailinglistmember')?$select=EntitySetName");
  if (mlm.status === 404) {
    receipt.mailingLists.akoyaMailingListMember = 'absent';
    console.log('   akoya_mailinglistmember: absent');
  } else if (!mlm.ok) {
    receipt.mailingLists.akoyaMailingListMember = `unreadable (${mlm.status})`;
    receipt.incompleteReasons.push('akoya_mailinglistmember metadata unreadable');
    console.log(`   akoya_mailinglistmember: unreadable (${mlm.status})`);
  } else {
    const countResp = await client.get(`/${mlm.body.EntitySetName}?$apply=aggregate($count as n)`);
    const count = countResp.ok ? countResp.body?.value?.[0]?.n : `unreadable (${countResp.status})`;
    if (!countResp.ok) receipt.incompleteReasons.push('akoya_mailinglistmember count unreadable');
    const lookups = await getAll(client,
      "/EntityDefinitions(LogicalName='akoya_mailinglistmember')/ManyToOneRelationships?$select=ReferencingAttribute,ReferencedEntity");
    const fromContact = await getAll(client,
      "/EntityDefinitions(LogicalName='contact')/ManyToOneRelationships?$select=ReferencingAttribute,ReferencedEntity&$filter=ReferencedEntity eq 'akoya_mailinglistmember'");
    const own = lookups.filter((r) => !OWNERSHIP_LOOKUPS.has(r.ReferencingAttribute)).map((r) => `${r.ReferencingAttribute} -> ${r.ReferencedEntity}`).sort();
    receipt.mailingLists.akoyaMailingListMember = { count, lookups: own, contactLookupsToIt: fromContact.map((r) => r.ReferencingAttribute).sort() };
    console.log(`   akoya_mailinglistmember (count only): ${count}`);
    console.log(`     its lookups: ${own.join(', ') || '(none)'}`);
    console.log(`     contact lookups to it: ${receipt.mailingLists.akoyaMailingListMember.contactLookupsToIt.join(', ') || '(none)'}`);
  }
  if (!orphanResp.ok) receipt.incompleteReasons.push('parentless-contact count unreadable');
  console.log(`   active contacts with no parent account (count only): ${orphans}`);

  const ruleFilter = "&$filter=primaryentity eq 'akoya_request' and category eq 2 and type eq 1 and statecode eq 1";
  let rules;
  try {
    rules = await getAll(client, `/workflows?$select=name,workflowid,scope,processtriggerscope,_processtriggerformid_value${ruleFilter}`);
  } catch (error) {
    console.log(`   (scope columns unreadable: ${String(error.message).slice(0, 120)}; listing without them)`);
    rules = await getAll(client, `/workflows?$select=name,workflowid${ruleFilter}`);
  }
  const statusRules = rules.filter((r) => /request status/i.test(r.name));
  const SCOPE = { 1: 'form', 2: 'entity' };
  receipt.requestStatusRules = [];
  console.log(`   business rules naming Request Status: ${statusRules.length}`);
  for (const r of statusRules) {
    const resp = await client.get(`/workflows(${r.workflowid})?$select=xaml`);
    if (!resp.ok) throw new Error(`GET business rule xaml failed (${resp.status})`);
    const xaml = resp.body?.xaml || '';
    const summary = summarizeWorkflowXaml(xaml);
    const reads = ['wmkf_phaseistatus', 'wmkf_phaseiistatus', 'wmkf_grantprogram', 'akoya_requeststatus']
      .filter((f) => xaml.includes(`"${f}"`));
    const scope = SCOPE[r.processtriggerscope] || `processtriggerscope=${r.processtriggerscope ?? 'null'}`;
    console.log(`   - ${r.name}  scope: ${scope}${r._processtriggerformid_value ? ' (one form)' : ''}`);
    console.log(`     reads: ${reads.join(', ') || '(none)'}  sets: ${summary.sets.join(', ') || '(none)'}`);
    console.log(`     steps: ${summary.steps.join(' | ') || '(none labelled)'}`);
    receipt.requestStatusRules.push({ name: r.name, scope, oneForm: Boolean(r._processtriggerformid_value), reads, sets: summary.sets, steps: summary.steps });
    if (exportDir) {
      const file = require('path').join(exportDir, `${r.name.replace(/[^A-Za-z0-9]+/g, '_')}.xaml`);
      require('fs').mkdirSync(exportDir, { recursive: true });
      require('fs').writeFileSync(file, xaml);
      console.log(`     exported: ${file}`);
    }
  }

  receipt.complete = receipt.incompleteReasons.length === 0;
  console.log(`   section 12: ${receipt.complete ? 'COMPLETE' : `INCOMPLETE (${receipt.incompleteReasons.join('; ')})`}`);
  if (exportDir) {
    const fs = require('fs');
    fs.mkdirSync(exportDir, { recursive: true });
    const file = require('path').join(exportDir, `cast-readiness-receipt-${receipt.generatedAt.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    console.log(`   receipt: ${file}`);
  } else {
    console.log('   receipt: not written (pass --cast=<dir>)');
  }
  return receipt;
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

async function main() {
  loadEnvLocal();
  const director = parseDirector(process.argv.slice(2));
  const detail = process.argv.includes('--detail');
  const exportArg = process.argv.find((arg) => arg.startsWith('--export-xaml='));
  const exportDir = exportArg ? exportArg.slice('--export-xaml='.length) : null;
  const historyArg = process.argv.find((arg) => arg === '--history' || arg.startsWith('--history='));
  const historyLimit = historyArg ? Math.min(Math.max(parseInt(historyArg.split('=')[1] || '10', 10) || 10, 1), 50) : 0;
  const meetingArg = process.argv.find((arg) => arg === '--meeting-date' || arg.startsWith('--meeting-date='));
  const meetingLimit = meetingArg ? Math.min(Math.max(parseInt(meetingArg.split('=')[1] || '50', 10) || 50, 1), 200) : 0;
  const statusArg = process.argv.find((arg) => arg === '--status-fields' || arg.startsWith('--status-fields='));
  const statusExportDir = statusArg && statusArg.includes('=') ? statusArg.slice('--status-fields='.length) : null;
  const castArg = process.argv.find((arg) => arg === '--cast' || arg.startsWith('--cast='));
  const castExportDir = castArg && castArg.includes('=') ? castArg.slice('--cast='.length) : null;
  const slotArg = process.argv.find((arg) => arg === '--reviewer-slots' || arg.startsWith('--reviewer-slots='));
  const slotExportDir = slotArg && slotArg.includes('=') ? slotArg.slice('--reviewer-slots='.length) : null;
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
  if (statusArg) await printStatusFields(client, statusExportDir);
  if (castArg) {
    const castReceipt = await printCastReadiness(client, castExportDir);
    if (!castReceipt.complete) process.exitCode = 1;
  }
  if (slotArg) {
    const slotReceipt = await printReviewerSlotReadiness(client, slotExportDir);
    if (!slotReceipt.complete) process.exitCode = 1;
  }
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
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Probe failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { classifyFlowDefinition, flowNamesEntity, unfilteredCreateSteps, isPlatformStep, customWorkflowActivities, printCastReadiness, classifySlotUpdateFlow, classifySlotWriteStep, printReviewerSlotReadiness };
