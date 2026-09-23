#!/usr/bin/env node

/**
 * Prepare and execute one bounded Test Request Factory rehearsal in the
 * registered Dataverse sandbox.
 *
 * Default mode is read-only. A live create requires a previously written,
 * unexpired manifest and a new receipt path:
 *
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs
 *   node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs --prepare=/absolute/manifest.json --source-request-number=<actual-grant-request-number>
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
import {
  reserveRehearsalReceipt,
  updateRehearsalReceipt,
} from '../lib/services/test-requests/rehearsal-receipt.js';
import {
  createBypassSignalFence,
  isGoverifyDeactivationUncertain,
  throwIfInterrupted,
} from '../lib/services/test-requests/bypass-signal-fence.js';
import {
  assertCopiedSourceValues,
  assertSourceUnchanged,
  projectCloneSource,
  expectedRequestFolder,
  requireUniqueSourceRequest,
  resolveCloneCycle,
  verifyCloneRequestReadback,
} from '../lib/services/test-requests/sandbox-clone.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
const FOUNDATION_NAME = 'W. M. Keck Foundation';
const REQUEST_LIBRARY = 'akoya_request';
const MANIFEST_TTL_MS = 60 * 60 * 1000;
const POLL_MS = 5_000;
const OBSERVATION_MS = 60_000;
const BYPASS_REQUEST_TIMEOUT_MS = 15_000;
const CREATE_REQUEST_TIMEOUT_MS = 30_000;
const GOVERIFY_WORKFLOW = Object.freeze({
  definitionId: 'a5d850ee-e5b4-409c-a7e5-65ac82ff9ceb',
  name: 'GOverify- check Publication 78 on create of a request record',
  primaryEntity: 'akoya_request',
});

const CREATE_FIELDS = Object.freeze([
  'akoya_requestid',
  'akoya_applicantid',
  'akoya_title',
  'akoya_purpose',
  'akoya_request',
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
  'akoya_purpose',
  'akoya_request',
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
  '_createdby_value',
  '_ownerid_value',
]);

function parseArgs(argv) {
  const parsed = {
    prepare: null,
    execute: null,
    inspect: null,
    receipt: null,
    bypassGoverify: false,
    fiscalYear: null,
    meetingDate: null,
    sourceRequestNumber: null,
    testLabel: null,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--prepare=')) parsed.prepare = arg.slice('--prepare='.length);
    else if (arg.startsWith('--execute=')) parsed.execute = arg.slice('--execute='.length);
    else if (arg.startsWith('--inspect=')) parsed.inspect = arg.slice('--inspect='.length);
    else if (arg.startsWith('--receipt=')) parsed.receipt = arg.slice('--receipt='.length);
    else if (arg.startsWith('--fiscal-year=')) parsed.fiscalYear = arg.slice('--fiscal-year='.length);
    else if (arg.startsWith('--meeting-date=')) parsed.meetingDate = arg.slice('--meeting-date='.length);
    else if (arg.startsWith('--source-request-number=')) parsed.sourceRequestNumber = arg.slice('--source-request-number='.length);
    else if (arg.startsWith('--test-label=')) parsed.testLabel = arg.slice('--test-label='.length);
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
  if (parsed.prepare && (!parsed.sourceRequestNumber || !/^\d{1,10}$/.test(parsed.sourceRequestNumber))) {
    throw new Error('--prepare requires a bounded numeric --source-request-number.');
  }
  if (!parsed.prepare && (parsed.fiscalYear !== null || parsed.meetingDate !== null || parsed.sourceRequestNumber !== null || parsed.testLabel !== null)) {
    throw new Error('--source-request-number, --fiscal-year, --meeting-date, and --test-label are valid only with --prepare.');
  }
  for (const value of [parsed.prepare, parsed.execute, parsed.inspect, parsed.receipt].filter(Boolean)) {
    if (!path.isAbsolute(value)) throw new Error('Manifest and receipt paths must be absolute.');
  }
  return parsed;
}

function printHelp() {
  console.log('Read-only: node --env-file=/absolute/.env.local scripts/rehearse-test-request-sandbox.mjs');
  console.log('Prepare:  ... --prepare=/absolute/new-manifest.json --source-request-number=<actual-grant-request-number> [--fiscal-year=...] [--meeting-date=...]');
  console.log('Replace the source-number placeholder with an actual sandbox Grant Request number.');
  console.log('Execute:  ... --execute=/absolute/manifest.json --receipt=/absolute/new-receipt.json');
  console.log('Execute with one-create sandbox bypass: ... --execute=... --receipt=... --bypass-goverify');
  console.log('Inspect:  ... --inspect=/absolute/manifest.json');
}

async function getGoverifyWorkflow(client, requestOptions = null) {
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
  const requestPath = `/workflows(${GOVERIFY_WORKFLOW.definitionId})?$select=${fields.join(',')}`;
  const response = requestOptions
    ? await client.getWithOptions(requestPath, undefined, requestOptions)
    : await client.get(requestPath);
  return bodyOrThrow('GoVerify workflow readback', response);
}

async function getGoverifyActivations(client, requestOptions = null) {
  const filter = `_parentworkflowid_value eq ${GOVERIFY_WORKFLOW.definitionId} and type eq 2`;
  const requestPath = '/workflows?$select=workflowid,name,type,primaryentity,statecode,statuscode,_parentworkflowid_value' +
    `&$filter=${encodeURIComponent(filter)}&$top=5`;
  const response = requestOptions
    ? await client.getWithOptions(requestPath, undefined, requestOptions)
    : await client.get(requestPath);
  const body = bodyOrThrow('GoVerify activation readback', response);
  if (body['@odata.nextLink']) throw new Error('GoVerify activation readback exceeded five rows.');
  return body.value || [];
}

async function assertGoverifyActivationState(client, expectedActive, requestOptions = null) {
  const activations = await getGoverifyActivations(client, requestOptions);
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

async function setGoverifyWorkflowState(client, before, nextState, requestOptions = null) {
  const patchPath = `/workflows(${GOVERIFY_WORKFLOW.definitionId})`;
  const headers = { 'If-Match': before['@odata.etag'] };
  const response = requestOptions
    ? await client.patchWithOptions(patchPath, nextState, headers, requestOptions)
    : await client.patch(patchPath, nextState, headers);
  bodyOrThrow('GoVerify workflow state change', response);
  const after = await getGoverifyWorkflow(client, requestOptions);
  assertExpectedGoverifyWorkflow(after, nextState);
  await assertGoverifyActivationState(client, nextState.statecode === 1, requestOptions);
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
  fields.akoya_purpose.maxLength = await getMaxLength(client, 'akoya_purpose', 'Memo');
  const amountMeta = await client.get(
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='akoya_request')" +
      '/Microsoft.Dynamics.CRM.MoneyAttributeMetadata?$select=MinValue,MaxValue',
  );
  const amountRange = bodyOrThrow('requested amount metadata', amountMeta);
  fields.akoya_request.minValue = amountRange.MinValue;
  fields.akoya_request.maxValue = amountRange.MaxValue;
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

const SOURCE_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_requesttype', 'akoya_purpose',
  'akoya_request', 'akoya_fiscalyear', 'wmkf_meetingdate', 'versionnumber',
].join(',');

async function getSourceRequestByNumber(client, requestNumber) {
  if (!/^\d{1,10}$/.test(String(requestNumber))) throw new Error('Source Request number must be bounded digits.');
  const filter = `akoya_requestnum eq '${odataString(requestNumber)}'`;
  const response = await client.get(
    `/akoya_requests?$select=${SOURCE_SELECT}&$filter=${encodeURIComponent(filter)}&$top=2`,
  );
  const body = bodyOrThrow('source Request lookup', response);
  try {
    return requireUniqueSourceRequest(body.value || [], Boolean(body['@odata.nextLink']));
  } catch (error) {
    throw new Error(`Source Request ${requestNumber}: ${error.message}`);
  }
}

async function getSourceRequestById(client, requestId, requestOptions = null) {
  const requestPath = `/akoya_requests(${requestId})?$select=${SOURCE_SELECT}`;
  const response = requestOptions
    ? await client.getWithOptions(requestPath, undefined, requestOptions)
    : await client.get(requestPath);
  if (response.status === 404) throw new Error('Source Request no longer exists.');
  return bodyOrThrow('source Request revalidation', response);
}

async function getAppUser(client) {
  const applicationId = process.env.DYNAMICS_CLIENT_ID;
  if (!/^[0-9a-f-]{36}$/i.test(applicationId || '')) throw new Error('Configured Dataverse application ID is invalid.');
  const response = await client.get(
    '/systemusers?$select=systemuserid,fullname,applicationid,accessmode,isdisabled' +
      `&$filter=${encodeURIComponent(`applicationid eq ${applicationId}`)}&$top=3`,
  );
  const body = bodyOrThrow('app-suite system user lookup', response);
  if (body['@odata.nextLink'] || body.value?.length !== 1 ||
      body.value[0].isdisabled !== false || body.value[0].accessmode !== 4 ||
      body.value[0].fullname !== '# WMK: Research Review App Suite') {
    throw new Error('Expected exactly one active app-suite Dataverse application user.');
  }
  return body.value[0];
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
  const [metadata, grantOption, foundation, sharePointSites, requestLibraryParent, appUser] = await Promise.all([
    buildCompilerMetadata(client),
    getGrantOption(client),
    getFoundationSnapshot(client),
    getSharePointSites(client),
    getRequestLibraryParent(client),
    getAppUser(client),
  ]);
  const { configuredSharePointTargetInfo } = await import('../lib/services/sharepoint-target-registry.js');
  const sharePoint = configuredSharePointTargetInfo();
  if (!sharePoint.registered || sharePoint.key !== 'akoyago-shared' ||
      !sharePointSites.some((site) => site.absoluteurl === sharePoint.siteUrl)) {
    throw new Error('Sandbox Dataverse and Graph do not resolve to the registered akoyaGO site.');
  }
  const registeredDataverseSite = sharePointSites.find((site) => site.absoluteurl === sharePoint.siteUrl);
  if (!guidEqual(requestLibraryParent._parentsiteorlocation_value, registeredDataverseSite.sharepointsiteid)) {
    throw new Error('Request library parent is not under the registered Dataverse SharePoint site.');
  }
  const { GraphService } = await import('../lib/services/graph-service.js');
  const siteId = await GraphService.getSiteId();
  const driveId = await GraphService.getDriveId(REQUEST_LIBRARY, { siteId });
  if (!siteId || !driveId) throw new Error('Request SharePoint library did not resolve.');
  const contacts = await getContactSnapshot(client, foundation.accountid);
  return { metadata, grantOption, foundation, contacts, sharePointSites, requestLibraryParent, appUser, siteId, driveId };
}

function compileBody(preflight, values, sourceRequest) {
  const compiled = compileTestRequestDraft({
    recipe: 'basic',
    sourceRequest,
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
    requestLibraryParent: preflight.requestLibraryParent,
    appUser: { systemuserid: preflight.appUser.systemuserid, fullname: preflight.appUser.fullname },
    graphSiteId: preflight.siteId,
    graphDriveId: preflight.driveId,
  };
}

function buildManifest(preflight, { source, fiscalYear, meetingDate, testLabel }) {
  const requestId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const values = {
    requestId,
    runId,
    locationId,
    testLabel: testLabel || `Codex sandbox request factory rehearsal ${new Date().toISOString().slice(0, 10)} ${runId.slice(0, 8)}`,
    fiscalYear,
    meetingDate,
  };
  const createBody = compileBody(preflight, values, source);
  return {
    kind: 'test-request-sandbox-rehearsal-manifest/v3',
    preparedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + MANIFEST_TTL_MS).toISOString(),
    target: SANDBOX_URL,
    values,
    expectedOrganization: {
      accountid: preflight.foundation.accountid,
      name: preflight.foundation.name,
    },
    expectedRequestType: preflight.grantOption,
    expectedAppUserId: preflight.appUser.systemuserid,
    source: {
      requestId: source.akoya_requestid,
      requestNumber: source.akoya_requestnum,
      requestType: source.akoya_requesttype,
      revision: source.revision,
    },
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

function validateManifest(manifest, { allowExpired = false, forExecute = false } = {}) {
  if (!['test-request-sandbox-rehearsal-manifest/v1', 'test-request-sandbox-rehearsal-manifest/v2', 'test-request-sandbox-rehearsal-manifest/v3'].includes(manifest?.kind)) {
    throw new Error('Unsupported manifest kind.');
  }
  if (forExecute && manifest.kind !== 'test-request-sandbox-rehearsal-manifest/v3') {
    throw new Error('Only a source-bound v3 manifest can execute a sandbox clone.');
  }
  if (manifest.target !== SANDBOX_URL) throw new Error('Manifest target is not the registered sandbox.');
  if (manifest.kind.endsWith('/v3') && (!/^[0-9a-f-]{36}$/i.test(manifest.source?.requestId || '') ||
      !manifest.source?.revision || !Number.isInteger(manifest.source?.requestType) ||
      !String(manifest.createBody?.akoya_title || '').startsWith('TEST: '))) {
    throw new Error('Source-bound v3 manifest provenance is invalid.');
  }
  if (!manifest.expiresAt || (!allowExpired && Date.parse(manifest.expiresAt) <= Date.now())) throw new Error('Manifest is expired.');
  if (manifest.createBodySha256 !== sha256(manifest.createBody)) throw new Error('Manifest create body hash mismatch.');
  if (!guidEqual(manifest.createBody.akoya_requestid, manifest.values?.requestId) ||
      !guidEqual(manifest.createBody.wmkf_testcreationrunid, manifest.values?.runId) ||
      ((manifest.kind.endsWith('/v2') || manifest.kind.endsWith('/v3')) && (!/^[0-9a-f-]{36}$/i.test(manifest.values?.locationId || '') ||
        !/^[0-9a-f-]{36}$/i.test(manifest.expectedAppUserId || '')))) {
    throw new Error('Manifest identity mismatch.');
  }
  if (manifest.invariants?.exactlyOneCreate !== true || manifest.invariants?.retryOnAmbiguousCreate !== false) {
    throw new Error('Manifest create invariants are invalid.');
  }
}

function sanitizedRequestIdentity(request) {
  if (!request) return null;
  return {
    akoya_requestid: request.akoya_requestid,
    akoya_requestnum: request.akoya_requestnum,
    akoya_title: request.akoya_title,
    akoya_requesttype: request.akoya_requesttype,
    _akoya_applicantid_value: request._akoya_applicantid_value,
    _createdby_value: request._createdby_value,
    _ownerid_value: request._ownerid_value,
    wmkf_istestrequest: request.wmkf_istestrequest,
    wmkf_testcreationrunid: request.wmkf_testcreationrunid,
  };
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
  const expectedFolder = request?.akoya_requestnum
    ? expectedRequestFolder(request.akoya_requestnum, request.akoya_requestid)
    : null;
  console.log(JSON.stringify({
    mode: 'READ_ONLY_RECOVERY_INSPECTION',
    target: SANDBOX_URL,
    requestId: manifest.values.requestId,
    requestExists: Boolean(request),
    request: sanitizedRequestIdentity(request),
    expectedSharePointFolder: expectedFolder,
    expectedLocationId: manifest.values.locationId || null,
    folderRecoveryHint: expectedFolder && locations.length === 0
      ? 'If the location is absent, inspect this deterministic folder path before creating anything.'
      : null,
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
      '?$select=sharepointdocumentlocationid,name,relativeurl,absoluteurl,_parentsiteorlocation_value,_createdby_value,_ownerid_value,createdon' +
      `&$filter=${encodeURIComponent(filter)}&$top=20`,
  );
  const body = bodyOrThrow('Request SharePoint locations', response);
  if (body['@odata.nextLink']) throw new Error('Request SharePoint locations exceeded 20 rows.');
  return body.value || [];
}

async function getRequestLibraryParent(client) {
  const filter = `relativeurl eq '${REQUEST_LIBRARY}'`;
  const response = await client.get(
    '/sharepointdocumentlocations' +
      '?$select=sharepointdocumentlocationid,name,relativeurl,_parentsiteorlocation_value' +
      `&$filter=${encodeURIComponent(filter)}&$top=10`,
  );
  const body = bodyOrThrow('Request library parent lookup', response);
  if (body['@odata.nextLink'] || body.value?.length !== 1) {
    throw new Error(`Expected exactly one ${REQUEST_LIBRARY} document-location parent.`);
  }
  return body.value[0];
}

async function correctMeetingDate(client, manifest, request, receipt, receiptPath) {
  if (!guidEqual(request.akoya_requestid, manifest.values.requestId) ||
      !guidEqual(request.wmkf_testcreationrunid, manifest.values.runId) ||
      !guidEqual(request._createdby_value, manifest.expectedAppUserId) ||
      !guidEqual(request._ownerid_value, manifest.expectedAppUserId) ||
      request.wmkf_istestrequest !== true || !request['@odata.etag']) {
    throw new Error('Fresh synthetic Request readback failed the meeting-date correction precondition.');
  }
  const desired = manifest.values.meetingDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desired)) throw new Error('Manifest meeting date is invalid.');
  const before = request.wmkf_meetingdate || null;
  receipt.meetingDateCorrection = { desired, before, patchAttempted: false };
  if (String(before).slice(0, 10) === desired) return request;

  receipt.meetingDateCorrection.patchAttempted = true;
  receipt.meetingDateCorrection.patchAttemptedAt = new Date().toISOString();
  updateRehearsalReceipt(receiptPath, receipt);
  let patched = null;
  let patchError = null;
  try {
    patched = await client.patch(
      `/akoya_requests(${request.akoya_requestid})`,
      { wmkf_meetingdate: desired },
      { 'If-Match': request['@odata.etag'] },
    );
    receipt.meetingDateCorrection.patchResponseStatus = patched.status;
    receipt.meetingDateCorrection.patchResponseReceivedAt = new Date().toISOString();
    updateRehearsalReceipt(receiptPath, receipt);
  } catch (error) {
    patchError = error;
    receipt.meetingDateCorrection.patchResponseError = error.message;
    receipt.meetingDateCorrection.patchResponseReceivedAt = new Date().toISOString();
    updateRehearsalReceipt(receiptPath, receipt);
  }
  // The one-field PATCH is never retried. A lost response is reconciled by
  // rereading the same Request and exact date/marker/owner identities.
  const after = await getRequest(client, request.akoya_requestid);
  receipt.meetingDateCorrection.after = after.wmkf_meetingdate || null;
  receipt.meetingDateCorrection.readbackAt = new Date().toISOString();
  updateRehearsalReceipt(receiptPath, receipt);
  if (!guidEqual(after.akoya_requestid, manifest.values.requestId) ||
      !guidEqual(after.wmkf_testcreationrunid, manifest.values.runId) ||
      after.wmkf_istestrequest !== true ||
      !guidEqual(after._createdby_value, manifest.expectedAppUserId) ||
      !guidEqual(after._ownerid_value, manifest.expectedAppUserId) ||
      String(after.wmkf_meetingdate || '').slice(0, 10) !== desired) {
    if (patchError) throw new Error('Meeting-date PATCH outcome is ambiguous; no retry is allowed.', { cause: patchError });
    bodyOrThrow('single meeting-date correction', patched);
    throw new Error('Meeting-date correction readback did not match the planned Request state.');
  }
  return after;
}

async function provisionSharePointLocation(client, manifest, request, receipt, receiptPath) {
  if (!guidEqual(request.akoya_requestid, manifest.values.requestId) ||
      !guidEqual(request.wmkf_testcreationrunid, manifest.values.runId) ||
      !guidEqual(request._createdby_value, manifest.expectedAppUserId) ||
      !guidEqual(request._ownerid_value, manifest.expectedAppUserId) ||
      request.wmkf_istestrequest !== true || !request.akoya_requestnum) {
    throw new Error('Fresh synthetic Request readback failed the location-create precondition.');
  }
  const { configuredSharePointTargetInfo } = await import('../lib/services/sharepoint-target-registry.js');
  const sharePoint = configuredSharePointTargetInfo();
  if (!sharePoint.registered || sharePoint.key !== 'akoyago-shared') {
    throw new Error('The configured SharePoint site is not the registered akoyaGO site.');
  }
  const parent = await getRequestLibraryParent(client);
  const folder = expectedRequestFolder(request.akoya_requestnum, request.akoya_requestid);
  const existing = await getLocations(client, request.akoya_requestid);
  if (existing.length > 0) {
    throw new Error(`Expected no preexisting Request location before app provisioning; found ${existing.length}.`);
  }
  const { GraphService } = await import('../lib/services/graph-service.js');
  receipt.locationProvision = {
    parentId: parent.sharepointdocumentlocationid,
    folder,
    graphFolderAttempted: true,
    graphFolderAttemptedAt: new Date().toISOString(),
  };
  updateRehearsalReceipt(receiptPath, receipt);
  const graphFolder = await GraphService.ensureFolderPath(REQUEST_LIBRARY, folder);
  receipt.locationProvision.graphFolder = graphFolder;
  receipt.locationProvision.graphFolderReadyAt = new Date().toISOString();
  updateRehearsalReceipt(receiptPath, receipt);

  const body = {
    sharepointdocumentlocationid: manifest.values.locationId,
    name: 'Documents on Default Site 1',
    relativeurl: folder,
    servicetype: 0,
    locationtype: 0,
    'regardingobjectid_akoya_request@odata.bind': `/akoya_requests(${request.akoya_requestid})`,
    'parentsiteorlocation_sharepointdocumentlocation@odata.bind':
      `/sharepointdocumentlocations(${parent.sharepointdocumentlocationid})`,
  };
  receipt.locationProvision.locationCreateAttempted = true;
  receipt.locationProvision.locationCreateAttemptedAt = new Date().toISOString();
  updateRehearsalReceipt(receiptPath, receipt);
  const created = await client.post('/sharepointdocumentlocations', body, { Prefer: 'return=representation' });
  receipt.locationProvision.createResponseStatus = created.status;
  receipt.locationProvision.createResponseReceivedAt = new Date().toISOString();
  updateRehearsalReceipt(receiptPath, receipt);
  // A dropped response is reconciled by the preallocated ID. Never issue a
  // second POST: Dataverse and Graph cannot participate in one transaction.
  const readback = await getLocations(client, request.akoya_requestid);
  if (readback.length !== 1 ||
      !guidEqual(readback[0].sharepointdocumentlocationid, manifest.values.locationId) ||
      !guidEqual(readback[0]._parentsiteorlocation_value, parent.sharepointdocumentlocationid) ||
      !guidEqual(readback[0]._createdby_value, manifest.expectedAppUserId) ||
      !guidEqual(readback[0]._ownerid_value, manifest.expectedAppUserId) ||
      readback[0].relativeurl !== folder) {
    bodyOrThrow('single Request document-location create', created);
    throw new Error('Request document-location readback did not match the planned identity and parent.');
  }
  receipt.locationProvision.locationId = readback[0].sharepointdocumentlocationid;
  return { folder, parentId: parent.sharepointdocumentlocationid, graphFolder };
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
  failures.push(...verifyCloneRequestReadback(manifest, request));
  if (!request.akoya_requestnum) failures.push('server request number missing');
  if (request.wmkf_phaseiistatus != null) failures.push('Phase II status unexpectedly populated');
  if (request.akoya_recommendedamount != null) failures.push('recommended amount unexpectedly populated');
  if (request.akoya_originalgrantamount != null) failures.push('original grant amount unexpectedly populated');
  if (request.akoya_submissionaccepted !== false) failures.push('submission accepted is not the verified false default');
  if (observation.payments.length !== 0) failures.push(`created ${observation.payments.length} payment row(s)`);
  if (observation.emails.length !== 0) failures.push(`created ${observation.emails.length} regarding email row(s)`);
  if (observation.locations.length !== 1) failures.push(`expected one Dynamics SharePoint location, found ${observation.locations.length}`);
  if (observation.locationParents.length !== 1 || !observation.locationParents[0]?.relativeurl) failures.push('SharePoint parent did not resolve');
  if (observation.locations.length === 1) {
    const location = observation.locations[0];
    const expectedFolder = expectedRequestFolder(request.akoya_requestnum, manifest.values.requestId);
    if (!guidEqual(location.sharepointdocumentlocationid, manifest.values.locationId)) failures.push('SharePoint location ID mismatch');
    if (location.relativeurl !== expectedFolder) failures.push('SharePoint folder path mismatch');
    if (!guidEqual(location._createdby_value, manifest.expectedAppUserId)) failures.push('SharePoint location creator mismatch');
    if (!guidEqual(location._ownerid_value, manifest.expectedAppUserId)) failures.push('SharePoint location owner mismatch');
    if (observation.locationParents.length === 1 &&
        !guidEqual(observation.locationParents[0]?.sharepointdocumentlocationid, preflightBefore.requestLibraryParent.sharepointdocumentlocationid)) {
      failures.push('SharePoint location parent identity mismatch');
    }
  }
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
  validateManifest(manifest, { forExecute: true });
  const receipt = {
    kind: 'test-request-sandbox-rehearsal-receipt/v1',
    startedAt: new Date().toISOString(),
    target: SANDBOX_URL,
    requestId: manifest.values.requestId,
    locationId: manifest.values.locationId,
    runId: manifest.values.runId,
    sourceRequestId: manifest.source?.requestId || null,
    sourceRevision: manifest.source?.revision || null,
    createAttempted: false,
    createResponseStatus: null,
  };
  // Reserve the private receipt path before any request-side write. The open
  // descriptor also lets every later success/failure outcome retain exact IDs.
  reserveRehearsalReceipt(receiptPath, receipt);
  let signalFence = null;

  try {
    const preflightBefore = await runPreflight(client);
    if (!guidEqual(preflightBefore.foundation.accountid, manifest.expectedOrganization.accountid)) {
      throw new Error('Foundation account identity changed since prepare.');
    }
    if (preflightBefore.grantOption.value !== manifest.expectedRequestType.value) {
      throw new Error('Grant request-type option changed since prepare.');
    }
    if (!guidEqual(preflightBefore.appUser.systemuserid, manifest.expectedAppUserId)) {
      throw new Error('App-suite application user changed since prepare.');
    }
    const sourceRow = await getSourceRequestById(client, manifest.source?.requestId);
    const source = assertSourceUnchanged(manifest.source, sourceRow, preflightBefore.grantOption.value);
    assertCopiedSourceValues(source, manifest.createBody);
    const rebuiltBody = compileBody(preflightBefore, manifest.values, source);
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
          restoreVerified: false,
        };
        signalFence = createBypassSignalFence();
        // From this point forward a failed or ambiguous PATCH still requires
        // a readback and explicit restoration attempt in the finally block.
        goverifyRestoreRequired = true;
        updateRehearsalReceipt(receiptPath, receipt);
        throwIfInterrupted(signalFence);
        receipt.goverifyBypass.deactivationPatchAttemptedAt = new Date().toISOString();
        updateRehearsalReceipt(receiptPath, receipt);
        const workflowDeactivated = await setGoverifyWorkflowState(
          client,
          workflowBefore,
          { statecode: 0, statuscode: 1 },
          { signal: signalFence.signal, timeoutMs: BYPASS_REQUEST_TIMEOUT_MS },
        );
        receipt.goverifyBypass.deactivatedAt = new Date().toISOString();
        receipt.goverifyBypass.deactivatedVersionNumber = workflowDeactivated.versionnumber;
        updateRehearsalReceipt(receiptPath, receipt);
        throwIfInterrupted(signalFence);
      }

      // Fence the source again after any optional automation change and just
      // before the sole Request POST.
      const sourceBeforePost = assertSourceUnchanged(
        manifest.source,
        await getSourceRequestById(
          client,
          manifest.source.requestId,
          signalFence ? { signal: signalFence.signal, timeoutMs: BYPASS_REQUEST_TIMEOUT_MS } : null,
        ),
        preflightBefore.grantOption.value,
      );
      assertCopiedSourceValues(sourceBeforePost, manifest.createBody);
      throwIfInterrupted(signalFence);

      receipt.createAttempted = true;
      receipt.createAttemptedAt = new Date().toISOString();
      updateRehearsalReceipt(receiptPath, receipt);
      const createRequestOptions = { timeoutMs: CREATE_REQUEST_TIMEOUT_MS };
      if (signalFence) createRequestOptions.signal = signalFence.signal;
      created = await client.postWithOptions('/akoya_requests', manifest.createBody, {
        Prefer: 'return=representation',
      }, createRequestOptions);
      receipt.createResponseStatus = created.status;
      receipt.createResponseReceivedAt = new Date().toISOString();
      updateRehearsalReceipt(receiptPath, receipt);
    } finally {
      try {
        if (goverifyRestoreRequired) {
          receipt.goverifyBypass.restoreAttemptedAt = new Date().toISOString();
          try {
            updateRehearsalReceipt(receiptPath, receipt);
          } catch (error) {
            // A receipt I/O failure must not prevent the safety restoration.
            receipt.goverifyBypass.restoreIntentPersistError = error.message;
          }
          let workflowRestored;
          try {
            if (isGoverifyDeactivationUncertain(receipt.goverifyBypass)) {
              const reason = 'GoVerify deactivation PATCH was attempted but its inactive state was not verified; the server may still commit it. Manually recheck the workflow before resuming.';
              receipt.goverifyBypass.restoreVerified = false;
              receipt.goverifyBypass.restoreManualRecheckRequired = true;
              receipt.goverifyBypass.restoreManualRecheckReason = reason;
              receipt.goverifyBypass.restoreError = reason;
              if (receipt.createAttempted) {
                receipt.postCreateStepsSkipped = true;
                receipt.postCreateStepsSkippedReason = reason;
              }
              updateRehearsalReceipt(receiptPath, receipt);
              throw new Error(`${reason} Workflow ID: ${receipt.goverifyBypass.workflowId}.`);
            }
            const restoreOptions = { timeoutMs: BYPASS_REQUEST_TIMEOUT_MS };
            const workflowCurrent = await getGoverifyWorkflow(client, restoreOptions);
            workflowRestored = workflowCurrent;
            if (workflowCurrent.statecode === 0 && workflowCurrent.statuscode === 1) {
              assertExpectedGoverifyWorkflow(workflowCurrent, { statecode: 0, statuscode: 1 });
              workflowRestored = await setGoverifyWorkflowState(
                client,
                workflowCurrent,
                { statecode: 1, statuscode: 2 },
                restoreOptions,
              );
            } else {
              assertExpectedGoverifyWorkflow(workflowCurrent, { statecode: 1, statuscode: 2 });
              receipt.goverifyBypass.restoreWasAlreadyActive = true;
            }
          } catch (error) {
            receipt.goverifyBypass.restoreError = error.message;
            receipt.goverifyBypass.restored = false;
            receipt.goverifyBypass.restoreVerified = false;
            if (receipt.createAttempted) {
              receipt.postCreateStepsSkipped = true;
              receipt.postCreateStepsSkippedReason ||= 'GoVerify restoration failed; inspect the destination Request by its preallocated GUID.';
            }
            updateRehearsalReceipt(receiptPath, receipt);
            throw error;
          }
          receipt.goverifyBypass.restored = true;
          receipt.goverifyBypass.restoreVerified = true;
          receipt.goverifyBypass.restoredAt = new Date().toISOString();
          receipt.goverifyBypass.restoredVersionNumber = workflowRestored.versionnumber;
          updateRehearsalReceipt(receiptPath, receipt);
        }
      } finally {
        signalFence?.dispose();
      }
    }
    throwIfInterrupted(signalFence);
    if (!created?.ok) bodyOrThrow('single Request create', created);

    const createdRequest = await getRequest(client, manifest.values.requestId);
    const datedRequest = await correctMeetingDate(client, manifest, createdRequest, receipt, receiptPath);
    await provisionSharePointLocation(client, manifest, datedRequest, receipt, receiptPath);

    receipt.observationStartedAt = new Date().toISOString();
    updateRehearsalReceipt(receiptPath, receipt);
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
    try {
      const finalSource = assertSourceUnchanged(
        manifest.source,
        await getSourceRequestById(client, manifest.source.requestId),
        preflightBefore.grantOption.value,
      );
      assertCopiedSourceValues(finalSource, manifest.createBody);
    } catch {
      verification.ok = false;
      verification.failures.push('source changed during clone rehearsal');
    }
    if (graphError) {
      verification.ok = false;
      verification.failures.push(`Graph folder inspection failed: ${graphError}`);
    }

    Object.assign(receipt, {
      completedAt: new Date().toISOString(),
      request: sanitizedRequestIdentity(observation.request),
      dynamicsLocations: observation.locations,
      locationParents: observation.locationParents,
      sharePointFiles: files,
      paymentRows: observation.payments,
      regardingEmails: observation.emails,
      verification,
    });
    updateRehearsalReceipt(receiptPath, receipt);
    console.log(JSON.stringify({ receiptPath, requestNumber: observation.request.akoya_requestnum, verification }, null, 2));
    if (!verification.ok) process.exitCode = 1;
  } catch (error) {
    receipt.completedAt = new Date().toISOString();
    receipt.error = error.message;
    if (receipt.createAttempted && !receipt.postCreateStepsSkipped) {
      receipt.postCreateStepsSkipped = true;
      receipt.postCreateStepsSkippedReason = signalFence?.interruptedBy
        ? `Interrupted by ${signalFence.interruptedBy}; restore was awaited before stopping.`
        : receipt.createResponseReceivedAt
          ? 'A post-create step failed; inspect the exact destination IDs before continuing.'
          : 'The Request create outcome is ambiguous; inspect the preallocated Request GUID before continuing.';
    }
    updateRehearsalReceipt(receiptPath, receipt);
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
    const source = await getSourceRequestByNumber(client, args.sourceRequestNumber);
    if (source.akoya_requesttype !== preflight.grantOption.value) {
      throw new Error('Source Request must be a Grant Request matching the live Grant option.');
    }
    const cycle = resolveCloneCycle(source, args);
    const manifest = buildManifest(preflight, { ...cycle, source, testLabel: args.testLabel });
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
