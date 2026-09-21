#!/usr/bin/env node

/**
 * Prepare and execute one bounded Test Request Factory rehearsal in the
 * registered Dataverse sandbox.
 *
 * Default mode is read-only. A live create requires a previously written,
 * unexpired manifest and a new receipt path:
 *
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs --prepare=/absolute/manifest.json
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs --execute=/absolute/manifest.json --receipt=/absolute/receipt.json
 *
 * The script never deletes or resets the created Request. An ambiguous create
 * is not retried: the preallocated GUID in the manifest is the recovery key.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { compileTestRequestDraft } from '../lib/services/test-requests/policy.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
const FOUNDATION_NAME = 'W. M. Keck Foundation';
const REHEARSAL_MEETING_DATE = '2099-12-01';
const REHEARSAL_FISCAL_YEAR = 'December 2099';
const MANIFEST_TTL_MS = 60 * 60 * 1000;
const POLL_MS = 5_000;
const OBSERVATION_MS = 60_000;
const GOVERIFY_WORKFLOW = Object.freeze({
  definitionId: 'a5d850ee-e5b4-409c-a7e5-65ac82ff9ceb',
  name: 'GOverify- check Publication 78 on create of a request record',
  primaryEntity: 'akoya_request',
});

const CREATE_FIELDS = Object.freeze([
  'akoya_requestid',
  'akoya_applicantid',
  'akoya_title',
  'akoya_fiscalyear',
  'akoya_requesttype',
  'wmkf_meetingdate',
  'wmkf_istestrequest',
  'wmkf_testcreationrunid',
  'wmkf_respondreminderenabled',
  'wmkf_reviewduereminderenabled',
]);

const READBACK_FIELDS = Object.freeze([
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'akoya_fiscalyear',
  'akoya_requesttype',
  'wmkf_meetingdate',
  'wmkf_istestrequest',
  'wmkf_testcreationrunid',
  'wmkf_respondreminderenabled',
  'wmkf_reviewduereminderenabled',
  'akoya_requeststatus',
  'wmkf_phaseiistatus',
  'akoya_recommendedamount',
  'akoya_originalgrantamount',
  'akoya_submissionaccepted',
  '_akoya_applicantid_value',
  '_akoya_payee_value',
  '_akoya_primarycontactid_value',
  'createdon',
  'modifiedon',
]);

function parseArgs(argv) {
  const parsed = {
    prepare: null,
    execute: null,
    inspect: null,
    receipt: null,
    bypassGoverify: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--prepare=')) parsed.prepare = arg.slice('--prepare='.length);
    else if (arg.startsWith('--execute=')) parsed.execute = arg.slice('--execute='.length);
    else if (arg.startsWith('--inspect=')) parsed.inspect = arg.slice('--inspect='.length);
    else if (arg.startsWith('--receipt=')) parsed.receipt = arg.slice('--receipt='.length);
    else if (arg === '--bypass-goverify') parsed.bypassGoverify = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if ([parsed.prepare, parsed.execute, parsed.inspect].filter(Boolean).length > 1) {
    throw new Error('Choose exactly one of --prepare, --execute, or --inspect.');
  }
  if (parsed.execute && !parsed.receipt) throw new Error('--execute requires --receipt.');
  if (!parsed.execute && parsed.receipt) throw new Error('--receipt is valid only with --execute.');
  if (parsed.bypassGoverify && !parsed.execute) {
    throw new Error('--bypass-goverify is valid only with --execute.');
  }
  for (const value of [parsed.prepare, parsed.execute, parsed.inspect, parsed.receipt].filter(Boolean)) {
    if (!path.isAbsolute(value)) throw new Error('Manifest and receipt paths must be absolute.');
  }
  return parsed;
}

function printHelp() {
  console.log('Read-only: node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs');
  console.log('Prepare:  ... --prepare=/absolute/new-manifest.json');
  console.log('Execute:  ... --execute=/absolute/manifest.json --receipt=/absolute/new-receipt.json');
  console.log('Execute with one-create sandbox bypass: ... --execute=... --receipt=... --bypass-goverify');
  console.log('Inspect:  ... --inspect=/absolute/manifest.json');
}

async function getGoverifyWorkflow(client) {
  const fields = [
    'workflowid',
    'workflowidunique',
    'name',
    'category',
    'type',
    'mode',
    'primaryentity',
    'statecode',
    'statuscode',
    'componentstate',
    'triggeroncreate',
    'triggeronupdateattributelist',
    'modifiedon',
    'versionnumber',
  ];
  const response = await client.get(
    `/workflows(${GOVERIFY_WORKFLOW.definitionId})?$select=${fields.join(',')}`,
  );
  return bodyOrThrow('GoVerify workflow readback', response);
}

async function getGoverifyActivations(client) {
  const filter = `_parentworkflowid_value eq ${GOVERIFY_WORKFLOW.definitionId} and type eq 2`;
  const response = await client.get(
    '/workflows?$select=workflowid,name,type,primaryentity,statecode,statuscode,_parentworkflowid_value' +
      `&$filter=${encodeURIComponent(filter)}&$top=5`,
  );
  const body = bodyOrThrow('GoVerify activation readback', response);
  if (body['@odata.nextLink']) throw new Error('GoVerify activation readback exceeded five rows.');
  return body.value || [];
}

async function assertGoverifyActivationState(client, expectedActive) {
  const activations = await getGoverifyActivations(client);
  const unexpectedIdentity = activations.find((workflow) =>
    workflow.name !== GOVERIFY_WORKFLOW.name ||
    workflow.primaryentity !== GOVERIFY_WORKFLOW.primaryEntity ||
    workflow.type !== 2 ||
    !guidEqual(workflow._parentworkflowid_value, GOVERIFY_WORKFLOW.definitionId));
  if (unexpectedIdentity) throw new Error('GoVerify activation identity mismatch.');
  const active = activations.filter((workflow) => workflow.statecode === 1 && workflow.statuscode === 2);
  const invalidInactive = activations.filter((workflow) =>
    workflow.statecode !== 1 && !(workflow.statecode === 0 && workflow.statuscode === 1));
  if (invalidInactive.length) {
    throw new Error(`Found ${invalidInactive.length} GoVerify activation(s) in an unexpected inactive state.`);
  }
  if (expectedActive && active.length !== 1) {
    throw new Error(`Expected one active GoVerify activation; found ${active.length} active of ${activations.length}.`);
  }
  if (!expectedActive && active.length !== 0) {
    throw new Error(`Expected no active GoVerify activation; found ${active.length}.`);
  }
  return activations;
}

function assertExpectedGoverifyWorkflow(workflow, expectedState) {
  const mismatches = [];
  if (!guidEqual(workflow.workflowid, GOVERIFY_WORKFLOW.definitionId)) mismatches.push('workflow ID');
  if (workflow.name !== GOVERIFY_WORKFLOW.name) mismatches.push('workflow name');
  if (workflow.primaryentity !== GOVERIFY_WORKFLOW.primaryEntity) mismatches.push('primary entity');
  if (workflow.category !== 0) mismatches.push('category');
  if (workflow.type !== 1) mismatches.push('type');
  if (workflow.mode !== 1) mismatches.push('mode');
  if (workflow.componentstate !== 0) mismatches.push('component state');
  if (workflow.triggeroncreate !== true) mismatches.push('create trigger');
  if (workflow.statecode !== expectedState.statecode) mismatches.push('state');
  if (workflow.statuscode !== expectedState.statuscode) mismatches.push('status');
  if (mismatches.length) {
    throw new Error(`GoVerify workflow precondition mismatch: ${mismatches.join(', ')}.`);
  }
}

async function setGoverifyWorkflowState(client, before, nextState) {
  const response = await client.patch(
    `/workflows(${GOVERIFY_WORKFLOW.definitionId})`,
    nextState,
    { 'If-Match': before['@odata.etag'] },
  );
  bodyOrThrow('GoVerify workflow state change', response);
  const after = await getGoverifyWorkflow(client);
  assertExpectedGoverifyWorkflow(after, nextState);
  await assertGoverifyActivationState(client, nextState.statecode === 1);
  return after;
}

function bodyOrThrow(label, response) {
  if (!response?.ok) {
    const detail = String(response?.text || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
    throw new Error(`${label} failed (${response?.status ?? 'no status'}): ${detail}`);
  }
  return response.body || {};
}

function writeNewJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function guidEqual(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

function odataString(value) {
  return String(value).replace(/'/g, "''");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAttributeRows(client) {
  const filter = CREATE_FIELDS.map((field) => `LogicalName eq '${field}'`).join(' or ');
  const response = await client.get(
    `/EntityDefinitions(LogicalName='akoya_request')/Attributes` +
      `?$select=LogicalName,AttributeType,IsValidForCreate,RequiredLevel` +
      `&$filter=${encodeURIComponent(filter)}`,
  );
  const rows = bodyOrThrow('request attribute metadata', response).value || [];
  const byName = new Map(rows.map((row) => [row.LogicalName, row]));
  const missing = CREATE_FIELDS.filter((field) => !byName.has(field));
  if (missing.length) throw new Error(`Required sandbox attributes are absent: ${missing.join(', ')}`);
  return byName;
}

async function getMaxLength(client, field, cast) {
  const response = await client.get(
    `/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${field}')` +
      `/Microsoft.Dynamics.CRM.${cast}AttributeMetadata?$select=MaxLength`,
  );
  return bodyOrThrow(`${field} max length`, response).MaxLength;
}

async function getApplicantTarget(client) {
  const response = await client.get(
    "/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships" +
      "?$select=ReferencedEntity,ReferencingAttribute,SchemaName" +
      `&$filter=${encodeURIComponent("ReferencingAttribute eq 'akoya_applicantid'")}`,
  );
  const rows = bodyOrThrow('applicant relationship metadata', response).value || [];
  const targets = [...new Set(rows.map((row) => row.ReferencedEntity).filter(Boolean))];
  if (targets.length !== 1 || targets[0] !== 'account') {
    throw new Error(`Applicant relationship target is not exactly account: ${targets.join(', ') || 'none'}`);
  }
  return 'accounts';
}

function optionLabel(option) {
  return option?.Label?.UserLocalizedLabel?.Label ||
    option?.Label?.LocalizedLabels?.find((label) => label.LanguageCode === 1033)?.Label || null;
}

async function getGrantOption(client) {
  const response = await client.get(
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='akoya_requesttype')" +
      '/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet',
  );
  const options = bodyOrThrow('request type options', response).OptionSet?.Options || [];
  const matches = options.filter((option) => optionLabel(option) === 'Grant');
  if (matches.length !== 1 || !Number.isInteger(matches[0].Value)) {
    throw new Error(`Expected exactly one numeric Grant request type; found ${matches.length}.`);
  }
  return { label: 'Grant', value: matches[0].Value };
}

async function buildCompilerMetadata(client) {
  const rows = await getAttributeRows(client);
  const fields = {};
  for (const field of CREATE_FIELDS) {
    const row = rows.get(field);
    const requiredLevel = row.RequiredLevel?.Value;
    fields[field] = {
      createable: row.IsValidForCreate === true,
      requiredLevel,
      type: row.AttributeType === 'DateTime' ? 'DateTime' : row.AttributeType,
    };
  }
  for (const field of ['akoya_title', 'akoya_fiscalyear', 'wmkf_testcreationrunid']) {
    fields[field].maxLength = await getMaxLength(client, field, 'String');
  }
  fields.akoya_applicantid.lookupTarget = await getApplicantTarget(client);
  return { entity: 'akoya_request', fields };
}

async function getFoundationSnapshot(client) {
  const filter = `name eq '${odataString(FOUNDATION_NAME)}' and statecode eq 0`;
  const response = await client.get(
    `/accounts?$select=accountid,name,modifiedon,versionnumber,statecode` +
      `&$filter=${encodeURIComponent(filter)}&$top=3`,
  );
  const rows = bodyOrThrow('Foundation account lookup', response).value || [];
  if (rows.length !== 1 || rows[0].name !== FOUNDATION_NAME) {
    throw new Error(`Expected exactly one active exact-name ${FOUNDATION_NAME} account; found ${rows.length}.`);
  }
  return rows[0];
}

async function getContactSnapshot(client, accountId) {
  const filter = `_parentcustomerid_value eq ${accountId}`;
  const response = await client.get(
    `/contacts?$select=contactid,fullname,modifiedon,versionnumber,statecode` +
      `&$filter=${encodeURIComponent(filter)}&$orderby=contactid asc&$top=500`,
  );
  const body = bodyOrThrow('Foundation contact snapshot', response);
  if (body['@odata.nextLink']) throw new Error('Foundation contact snapshot exceeded 500 rows.');
  return body.value || [];
}

async function getSharePointSites(client) {
  const response = await client.get(
    '/sharepointsites?$select=sharepointsiteid,name,absoluteurl,relativeurl&$top=20',
  );
  const rows = bodyOrThrow('sandbox SharePoint site inventory', response).value || [];
  return rows.map((row) => ({
    sharepointsiteid: row.sharepointsiteid,
    name: row.name || null,
    absoluteurl: row.absoluteurl || null,
    relativeurl: row.relativeurl || null,
  }));
}

async function runPreflight(client) {
  const [metadata, grantOption, foundation, sharePointSites] = await Promise.all([
    buildCompilerMetadata(client),
    getGrantOption(client),
    getFoundationSnapshot(client),
    getSharePointSites(client),
  ]);
  const contacts = await getContactSnapshot(client, foundation.accountid);
  return { metadata, grantOption, foundation, contacts, sharePointSites };
}

function compileBody(preflight, values) {
  const compiled = compileTestRequestDraft({
    recipe: 'basic',
    sourceRequest: { akoya_requestid: '00000000-0000-4000-8000-000000000001' },
    testLabel: values.testLabel,
    fiscalYear: values.fiscalYear,
    meetingDate: values.meetingDate,
    requestType: preflight.grantOption.value,
    metadata: preflight.metadata,
    requestId: values.requestId,
    runId: values.runId,
    testOrganizationId: preflight.foundation.accountid,
  });
  if (compiled.blockers.length || !compiled.createBody) {
    throw new Error(`Draft compiler blocked the rehearsal: ${JSON.stringify(compiled.blockers)}`);
  }
  return compiled.createBody;
}

function preflightSummary(preflight) {
  return {
    target: SANDBOX_URL,
    organization: {
      accountid: preflight.foundation.accountid,
      name: preflight.foundation.name,
      modifiedon: preflight.foundation.modifiedon,
      versionnumber: preflight.foundation.versionnumber,
    },
    childContactCount: preflight.contacts.length,
    requestType: preflight.grantOption,
    requiredFields: Object.fromEntries(CREATE_FIELDS.map((field) => [field, {
      createable: preflight.metadata.fields[field].createable,
      requiredLevel: preflight.metadata.fields[field].requiredLevel,
      type: preflight.metadata.fields[field].type,
    }])),
    sharePointSites: preflight.sharePointSites,
  };
}

function buildManifest(preflight) {
  const requestId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const values = {
    requestId,
    runId,
    testLabel: `Codex sandbox request factory rehearsal ${new Date().toISOString().slice(0, 10)} ${runId.slice(0, 8)}`,
    fiscalYear: REHEARSAL_FISCAL_YEAR,
    meetingDate: REHEARSAL_MEETING_DATE,
  };
  const createBody = compileBody(preflight, values);
  return {
    kind: 'test-request-sandbox-rehearsal-manifest/v1',
    preparedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + MANIFEST_TTL_MS).toISOString(),
    target: SANDBOX_URL,
    values,
    expectedOrganization: {
      accountid: preflight.foundation.accountid,
      name: preflight.foundation.name,
    },
    expectedRequestType: preflight.grantOption,
    createBody,
    createBodySha256: sha256(createBody),
    invariants: {
      exactlyOneCreate: true,
      retryOnAmbiguousCreate: false,
      deleteOrReset: false,
      expectedPayments: 0,
      expectedRegardingEmails: 0,
      expectedDynamicsLocations: 1,
      expectedSharePointFiles: 0,
    },
  };
}

function validateManifest(manifest, { allowExpired = false } = {}) {
  if (manifest?.kind !== 'test-request-sandbox-rehearsal-manifest/v1') throw new Error('Unsupported manifest kind.');
  if (manifest.target !== SANDBOX_URL) throw new Error('Manifest target is not the registered sandbox.');
  if (!manifest.expiresAt || (!allowExpired && Date.parse(manifest.expiresAt) <= Date.now())) throw new Error('Manifest is expired.');
  if (manifest.createBodySha256 !== sha256(manifest.createBody)) throw new Error('Manifest create body hash mismatch.');
  if (manifest.invariants?.exactlyOneCreate !== true || manifest.invariants?.retryOnAmbiguousCreate !== false) {
    throw new Error('Manifest create invariants are invalid.');
  }
}

async function inspectManifest(client, manifest) {
  validateManifest(manifest, { allowExpired: true });
  const response = await client.get(
    `/akoya_requests(${manifest.values.requestId})?$select=${READBACK_FIELDS.join(',')}`,
  );
  const request = response.status === 404 ? null : bodyOrThrow('recovery Request readback', response);
  const [locations, payments, emails, foundation, contacts] = await Promise.all([
    getLocations(client, manifest.values.requestId),
    getPayments(client, manifest.values.requestId),
    getEmails(client, manifest.values.requestId),
    getFoundationSnapshot(client),
    getContactSnapshot(client, manifest.expectedOrganization.accountid),
  ]);
  const locationParents = await resolveLocationParents(client, locations);
  console.log(JSON.stringify({
    mode: 'READ_ONLY_RECOVERY_INSPECTION',
    target: SANDBOX_URL,
    requestId: manifest.values.requestId,
    requestExists: Boolean(request),
    request,
    dynamicsLocations: locations,
    locationParents,
    paymentRows: payments,
    regardingEmails: emails,
    foundation: {
      accountid: foundation.accountid,
      name: foundation.name,
      modifiedon: foundation.modifiedon,
      versionnumber: foundation.versionnumber,
    },
    childContacts: contacts,
  }, null, 2));
}

function compareSnapshots(before, after, idField) {
  const beforeMap = new Map(before.map((row) => [String(row[idField]).toLowerCase(), row]));
  const afterMap = new Map(after.map((row) => [String(row[idField]).toLowerCase(), row]));
  const changes = [];
  for (const [id, row] of beforeMap) {
    const next = afterMap.get(id);
    if (!next) changes.push({ id, kind: 'removed' });
    else if (String(row.versionnumber) !== String(next.versionnumber) || row.modifiedon !== next.modifiedon) {
      changes.push({ id, kind: 'modified', beforeModifiedOn: row.modifiedon, afterModifiedOn: next.modifiedon });
    }
  }
  for (const id of afterMap.keys()) if (!beforeMap.has(id)) changes.push({ id, kind: 'added' });
  return changes;
}

async function getRequest(client, requestId) {
  const response = await client.get(`/akoya_requests(${requestId})?$select=${READBACK_FIELDS.join(',')}`);
  return bodyOrThrow('created Request readback', response);
}

async function getLocations(client, requestId) {
  const filter = `_regardingobjectid_value eq ${requestId}`;
  const response = await client.get(
    '/sharepointdocumentlocations' +
      '?$select=sharepointdocumentlocationid,name,relativeurl,absoluteurl,_parentsiteorlocation_value,createdon' +
      `&$filter=${encodeURIComponent(filter)}&$top=20`,
  );
  return bodyOrThrow('Request SharePoint locations', response).value || [];
}

async function resolveLocationParents(client, locations) {
  const parents = [];
  for (const location of locations) {
    const parentId = location._parentsiteorlocation_value;
    if (!parentId) {
      parents.push(null);
      continue;
    }
    const response = await client.get(
      `/sharepointdocumentlocations(${parentId})` +
        '?$select=sharepointdocumentlocationid,name,relativeurl,absoluteurl,_parentsiteorlocation_value',
    );
    parents.push(bodyOrThrow('SharePoint location parent', response));
  }
  return parents;
}

async function getPayments(client, requestId) {
  const filter = `_akoya_requestlookup_value eq ${requestId}`;
  const response = await client.get(
    '/akoya_requestpayments?$select=akoya_requestpaymentid,akoya_paymentnum,akoya_type,createdon' +
      `&$filter=${encodeURIComponent(filter)}&$top=50`,
  );
  return bodyOrThrow('Request payments', response).value || [];
}

async function getEmails(client, requestId) {
  const filter = `_regardingobjectid_value eq ${requestId}`;
  const response = await client.get(
    '/emails?$select=activityid,subject,createdon,senton,statecode,statuscode,_regardingobjectid_value' +
      `&$filter=${encodeURIComponent(filter)}&$top=50`,
  );
  return bodyOrThrow('regarding emails', response).value || [];
}

async function observe(client, requestId) {
  const deadline = Date.now() + OBSERVATION_MS;
  let snapshot = null;
  do {
    const [request, locations, payments, emails] = await Promise.all([
      getRequest(client, requestId),
      getLocations(client, requestId),
      getPayments(client, requestId),
      getEmails(client, requestId),
    ]);
    snapshot = { request, locations, payments, emails };
    if (Date.now() < deadline) await sleep(Math.min(POLL_MS, deadline - Date.now()));
  } while (Date.now() < deadline);
  snapshot.locationParents = await resolveLocationParents(client, snapshot.locations);
  return snapshot;
}

async function listSharePointFiles(observation) {
  if (observation.locations.length !== 1 || observation.locationParents.length !== 1) return null;
  const location = observation.locations[0];
  const parent = observation.locationParents[0];
  if (!parent?.relativeurl || !location.relativeurl) return null;
  const { GraphService } = await import('../lib/services/graph-service.js');
  return GraphService.listFiles(parent.relativeurl, location.relativeurl, {
    recursive: true,
    maxDepth: 3,
    maxFiles: 100,
    totalTimeoutMs: 30_000,
  });
}

function verify(manifest, preflightBefore, observation, files, foundationAfter, contactsAfter) {
  const failures = [];
  const request = observation.request;
  if (!guidEqual(request.akoya_requestid, manifest.values.requestId)) failures.push('request GUID mismatch');
  if (!request.akoya_requestnum) failures.push('server request number missing');
  if (request.akoya_title !== manifest.createBody.akoya_title) failures.push('title mismatch');
  if (request.akoya_requesttype !== manifest.createBody.akoya_requesttype) failures.push('request type mismatch');
  if (!guidEqual(request._akoya_applicantid_value, manifest.expectedOrganization.accountid)) failures.push('applicant mismatch');
  if (request.wmkf_istestrequest !== true) failures.push('test marker not true');
  if (!guidEqual(request.wmkf_testcreationrunid, manifest.values.runId)) failures.push('run ID mismatch');
  if (request.wmkf_respondreminderenabled !== false) failures.push('respond reminder not false');
  if (request.wmkf_reviewduereminderenabled !== false) failures.push('review-due reminder not false');
  if (request.wmkf_phaseiistatus != null) failures.push('Phase II status unexpectedly populated');
  if (request.akoya_recommendedamount != null) failures.push('recommended amount unexpectedly populated');
  if (request.akoya_originalgrantamount != null) failures.push('original grant amount unexpectedly populated');
  if (request.akoya_submissionaccepted != null) failures.push('submission accepted unexpectedly populated');
  if (observation.payments.length !== 0) failures.push(`created ${observation.payments.length} payment row(s)`);
  if (observation.emails.length !== 0) failures.push(`created ${observation.emails.length} regarding email row(s)`);
  if (observation.locations.length !== 1) failures.push(`expected one Dynamics SharePoint location, found ${observation.locations.length}`);
  if (observation.locationParents.length !== 1 || !observation.locationParents[0]?.relativeurl) failures.push('SharePoint parent did not resolve');
  if (!Array.isArray(files)) failures.push('SharePoint folder could not be inspected');
  else if (files.length !== 0) failures.push(`SharePoint folder contains ${files.length} file(s)`);

  const accountChanges = compareSnapshots(
    [preflightBefore.foundation],
    [foundationAfter],
    'accountid',
  );
  const contactChanges = compareSnapshots(preflightBefore.contacts, contactsAfter, 'contactid');
  if (accountChanges.length) failures.push('Foundation account changed during rehearsal');
  if (contactChanges.length) failures.push(`${contactChanges.length} Foundation contact row(s) changed during rehearsal`);

  return { ok: failures.length === 0, failures, accountChanges, contactChanges };
}

async function executeManifest(client, manifest, receiptPath, { bypassGoverify = false } = {}) {
  validateManifest(manifest);
  const receipt = {
    kind: 'test-request-sandbox-rehearsal-receipt/v1',
    startedAt: new Date().toISOString(),
    target: SANDBOX_URL,
    requestId: manifest.values.requestId,
    runId: manifest.values.runId,
    createAttempted: false,
    createResponseStatus: null,
  };

  try {
    const preflightBefore = await runPreflight(client);
    if (!guidEqual(preflightBefore.foundation.accountid, manifest.expectedOrganization.accountid)) {
      throw new Error('Foundation account identity changed since prepare.');
    }
    if (preflightBefore.grantOption.value !== manifest.expectedRequestType.value) {
      throw new Error('Grant request-type option changed since prepare.');
    }
    const rebuiltBody = compileBody(preflightBefore, manifest.values);
    if (sha256(rebuiltBody) !== manifest.createBodySha256) throw new Error('Fresh preflight does not reproduce manifest body.');

    const existing = await client.get(`/akoya_requests(${manifest.values.requestId})?$select=akoya_requestid`);
    if (existing.status !== 404) {
      throw new Error(`Preallocated request GUID is not absent (status ${existing.status}).`);
    }

    let created;
    let goverifyRestoreRequired = false;
    try {
      if (bypassGoverify) {
        const workflowBefore = await getGoverifyWorkflow(client);
        assertExpectedGoverifyWorkflow(workflowBefore, { statecode: 1, statuscode: 2 });
        await assertGoverifyActivationState(client, true);
        receipt.goverifyBypass = {
          workflowId: workflowBefore.workflowid,
          workflowName: workflowBefore.name,
          originalVersionNumber: workflowBefore.versionnumber,
          deactivationAttemptedAt: new Date().toISOString(),
          restored: false,
        };
        // From this point forward a failed or ambiguous PATCH still requires
        // a readback and explicit restoration attempt in the finally block.
        goverifyRestoreRequired = true;
        const workflowDeactivated = await setGoverifyWorkflowState(
          client,
          workflowBefore,
          { statecode: 0, statuscode: 1 },
        );
        receipt.goverifyBypass.deactivatedAt = new Date().toISOString();
        receipt.goverifyBypass.deactivatedVersionNumber = workflowDeactivated.versionnumber;
      }

      receipt.createAttempted = true;
      created = await client.post('/akoya_requests', manifest.createBody, {
        Prefer: 'return=representation',
      });
      receipt.createResponseStatus = created.status;
    } finally {
      if (goverifyRestoreRequired) {
        const workflowCurrent = await getGoverifyWorkflow(client);
        let workflowRestored = workflowCurrent;
        if (workflowCurrent.statecode === 0 && workflowCurrent.statuscode === 1) {
          assertExpectedGoverifyWorkflow(workflowCurrent, { statecode: 0, statuscode: 1 });
          workflowRestored = await setGoverifyWorkflowState(
            client,
            workflowCurrent,
            { statecode: 1, statuscode: 2 },
          );
        } else {
          assertExpectedGoverifyWorkflow(workflowCurrent, { statecode: 1, statuscode: 2 });
          receipt.goverifyBypass.restoreWasAlreadyActive = true;
        }
        receipt.goverifyBypass.restored = true;
        receipt.goverifyBypass.restoredAt = new Date().toISOString();
        receipt.goverifyBypass.restoredVersionNumber = workflowRestored.versionnumber;
      }
    }
    if (!created?.ok) bodyOrThrow('single Request create', created);

    const observation = await observe(client, manifest.values.requestId);
    let files = null;
    let graphError = null;
    try {
      files = await listSharePointFiles(observation);
    } catch (error) {
      graphError = error.message;
    }
    const [foundationAfter, contactsAfter] = await Promise.all([
      getFoundationSnapshot(client),
      getContactSnapshot(client, manifest.expectedOrganization.accountid),
    ]);
    const verification = verify(
      manifest,
      preflightBefore,
      observation,
      files,
      foundationAfter,
      contactsAfter,
    );
    if (graphError) {
      verification.ok = false;
      verification.failures.push(`Graph folder inspection failed: ${graphError}`);
    }

    Object.assign(receipt, {
      completedAt: new Date().toISOString(),
      request: observation.request,
      dynamicsLocations: observation.locations,
      locationParents: observation.locationParents,
      sharePointFiles: files,
      paymentRows: observation.payments,
      regardingEmails: observation.emails,
      verification,
    });
    writeNewJson(receiptPath, receipt);
    console.log(JSON.stringify({ receiptPath, requestNumber: observation.request.akoya_requestnum, verification }, null, 2));
    if (!verification.ok) process.exitCode = 1;
  } catch (error) {
    receipt.completedAt = new Date().toISOString();
    receipt.error = error.message;
    if (!fs.existsSync(receiptPath)) writeNewJson(receiptPath, receipt);
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  loadEnvLocal();
  if (process.env.DYNAMICS_SANDBOX_URL !== SANDBOX_URL) {
    throw new Error(`DYNAMICS_SANDBOX_URL must equal the registered sandbox ${SANDBOX_URL}.`);
  }
  const client = createClient({
    resourceUrl: SANDBOX_URL,
    token: await getAccessToken(SANDBOX_URL),
  });

  if (args.execute) {
    await executeManifest(client, readJson(args.execute), args.receipt, {
      bypassGoverify: args.bypassGoverify,
    });
    return;
  }
  if (args.inspect) {
    await inspectManifest(client, readJson(args.inspect));
    return;
  }

  const preflight = await runPreflight(client);
  if (args.prepare) {
    const manifest = buildManifest(preflight);
    writeNewJson(args.prepare, manifest);
    console.log(JSON.stringify({
      manifestPath: args.prepare,
      requestId: manifest.values.requestId,
      runId: manifest.values.runId,
      createBodySha256: manifest.createBodySha256,
      preflight: preflightSummary(preflight),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({ mode: 'READ_ONLY_PREFLIGHT', preflight: preflightSummary(preflight) }, null, 2));
}

main().catch((error) => {
  console.error(`FATAL: ${error.message}`);
  process.exit(1);
});
