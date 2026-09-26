/**
 * Test Request Factory "Basic clone" step bodies (build order item 5,
 * slice 5b), extracted from scripts/rehearse-test-request-sandbox.mjs so a
 * bounded resumable runner (lib/services/test-requests/run-runner.js) and
 * the CLI script can call the identical logic.
 *
 * Design doc: docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md,
 * "Operation contract and recovery".
 *
 * Every step here is INJECTED-dependency and does no receipt or file I/O of
 * its own: callers (the CLI script's file receipt, or the ledger-backed
 * runner) supply a `journal` callback that is invoked at exactly the points
 * the original single-file script persisted state before/after a dispatch,
 * and are responsible for actually persisting whatever the journal callback
 * is handed. `client` is a lib/dataverse/client.js instance; `graph` is a
 * GraphService-shaped object (getSiteId, getDriveId, ensureFolderPath,
 * listFiles, getFileMetadataById, downloadFile, getFileMetadataByPath,
 * uploadFile, clearGraphCaches); `sharePointTarget` is
 * `() => configuredSharePointTargetInfo()`.
 */

import crypto from 'node:crypto';
import { escape as escapeOdata } from '../../dataverse/core/odata.js';
import { compileTestRequestDraft } from './policy.js';
import {
  createBypassSignalFence,
  isGoverifyDeactivationUncertain,
  throwIfInterrupted,
} from './bypass-signal-fence.js';
import {
  assertCopiedSourceValues,
  assertSourceUnchanged,
  expectedRequestFolder,
  verifyCloneRequestReadback,
} from './sandbox-clone.js';
import { readSourceBundle } from './source-bundle.js';
import {
  SANDBOX_REHEARSAL_COPY_POLICY,
  assertBundleFresh,
  copyPolicyDigest,
  planBundleFileCopies,
  reverifyCopiedItems,
  verifyCopiedFiles,
} from './bundle-file-copy.js';
import { REVIEW_FILE_COPY_POLICY, reviewFileCopyPolicyDigest } from './review-file-copy.js';

export const SANDBOX_URL = 'https://orgd9e66399.crm.dynamics.com';
export const FOUNDATION_NAME = 'W. M. Keck Foundation';
export const REQUEST_LIBRARY = 'akoya_request';
export const MANIFEST_TTL_MS = 60 * 60 * 1000;
export const POLL_MS = 5_000;
export const OBSERVATION_MS = 60_000;
// 60 s, not 15 s (live proof 2026-09-24, Session 542): the sandbox's GoVerify
// deactivation PATCH committed server-side ~8 s in but had not responded by
// 15 s, so the client aborted, the fail-closed rule refused to restore, and
// the operator had to re-activate the workflow by hand (activation measured
// at 9.0 s). The bound still exists; the signal fence still covers interrupts.
export const BYPASS_REQUEST_TIMEOUT_MS = 60_000;
export const CREATE_REQUEST_TIMEOUT_MS = 30_000;
export const GOVERIFY_WORKFLOW = Object.freeze({
  definitionId: 'a5d850ee-e5b4-409c-a7e5-65ac82ff9ceb',
  name: 'GOverify- check Publication 78 on create of a request record',
  primaryEntity: 'akoya_request',
});

export const CREATE_FIELDS = Object.freeze([
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

export const READBACK_FIELDS = Object.freeze([
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

export const SOURCE_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_requesttype', 'akoya_purpose',
  'akoya_request', 'akoya_fiscalyear', 'wmkf_meetingdate', 'versionnumber',
].join(',');

export const MANIFEST_V3 = 'test-request-sandbox-rehearsal-manifest/v3';
export const MANIFEST_V4 = 'test-request-sandbox-rehearsal-manifest/v4';

export function isBundleManifest(manifest) {
  return manifest?.kind === MANIFEST_V4;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function guidEqual(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

export function odataString(value) {
  return escapeOdata(value);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function bodyOrThrow(label, response) {
  if (!response?.ok) {
    const detail = String(response?.text || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
    throw new Error(`${label} failed (${response?.status ?? 'no status'}): ${detail}`);
  }
  return response.body || {};
}

export function sanitizedRequestIdentity(request) {
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

export function compareSnapshots(before, after, idField) {
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

/* -------------------------------------------------------------------- */
/* Read helpers shared with the script's (unextracted) inspect mode.    */
/* -------------------------------------------------------------------- */

export async function getRequest(client, requestId) {
  const response = await client.get(`/akoya_requests(${requestId})?$select=${READBACK_FIELDS.join(',')}`);
  return bodyOrThrow('created Request readback', response);
}

export async function getLocations(client, requestId) {
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

export async function getRequestLibraryParent(client) {
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

export async function resolveLocationParents(client, locations) {
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

export async function getPayments(client, requestId) {
  const filter = `_akoya_requestlookup_value eq ${requestId}`;
  const response = await client.get(
    '/akoya_requestpayments?$select=akoya_requestpaymentid,akoya_paymentnum,akoya_type,createdon' +
      `&$filter=${encodeURIComponent(filter)}&$top=50`,
  );
  return bodyOrThrow('Request payments', response).value || [];
}

export async function getEmails(client, requestId) {
  const filter = `_regardingobjectid_value eq ${requestId}`;
  const response = await client.get(
    '/emails?$select=activityid,subject,createdon,senton,statecode,statuscode,_regardingobjectid_value' +
      `&$filter=${encodeURIComponent(filter)}&$top=50`,
  );
  return bodyOrThrow('regarding emails', response).value || [];
}

export async function getFoundationSnapshot(client) {
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

/**
 * SHA-256 over a canonical serialization of the Foundation account's and its
 * Contacts' identity-and-version fields only (never names or other content),
 * so the Initial Assessment recipe's `verify` step can record a receipt
 * value proving no Foundation/Contact row changed between the Basic clone's
 * own verification and the IA steps that follow it (`verifyClone`'s own
 * before/after pair is taken seconds apart inside one step and cannot see a
 * change made between steps). Contacts are sorted by ID for a stable digest
 * regardless of query ordering. Slice 6b's `verify_initial_assessment` step
 * recomputes this over its own fresh Foundation/Contact reads and compares
 * it against the ledger-recorded value.
 */
export function foundationBaselineDigest(foundation, contacts) {
  const canonical = {
    account: { accountid: String(foundation.accountid).toLowerCase(), versionnumber: String(foundation.versionnumber) },
    contacts: [...contacts]
      .map((row) => ({ contactid: String(row.contactid).toLowerCase(), versionnumber: String(row.versionnumber) }))
      .sort((a, b) => (a.contactid < b.contactid ? -1 : a.contactid > b.contactid ? 1 : 0)),
  };
  return sha256(canonical);
}

export async function getContactSnapshot(client, accountId) {
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

export async function getGrantOption(client) {
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

/**
 * Full sandbox/Graph preflight. Moved as-is from the script; `graph` is a
 * GraphService-shaped object and `sharePointTarget` is
 * `() => configuredSharePointTargetInfo()` -- both injected so this module
 * never imports Graph or the SharePoint target registry itself.
 */
export async function runPreflight(client, graph, sharePointTarget) {
  const [metadata, grantOption, foundation, sharePointSites, requestLibraryParent, appUser] = await Promise.all([
    buildCompilerMetadata(client),
    getGrantOption(client),
    getFoundationSnapshot(client),
    getSharePointSites(client),
    getRequestLibraryParent(client),
    getAppUser(client),
  ]);
  const sharePoint = sharePointTarget();
  if (!sharePoint.registered || sharePoint.key !== 'akoyago-shared' ||
      !sharePointSites.some((site) => site.absoluteurl === sharePoint.siteUrl)) {
    throw new Error('Sandbox Dataverse and Graph do not resolve to the registered akoyaGO site.');
  }
  const registeredDataverseSite = sharePointSites.find((site) => site.absoluteurl === sharePoint.siteUrl);
  if (!guidEqual(requestLibraryParent._parentsiteorlocation_value, registeredDataverseSite.sharepointsiteid)) {
    throw new Error('Request library parent is not under the registered Dataverse SharePoint site.');
  }
  const siteId = await graph.getSiteId();
  const driveId = await graph.getDriveId(REQUEST_LIBRARY, { siteId });
  if (!siteId || !driveId) throw new Error('Request SharePoint library did not resolve.');
  const contacts = await getContactSnapshot(client, foundation.accountid);
  return { metadata, grantOption, foundation, contacts, sharePointSites, requestLibraryParent, appUser, siteId, driveId };
}

export function preflightSummary(preflight) {
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

export function compileBody(preflight, values, sourceRequest) {
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

export function buildCloneManifest(preflight, { source, fiscalYear, meetingDate, testLabel, bundle = null, recipe = 'basic' }) {
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
  // A bundle manifest carries the validated bundle so execute never reads the
  // production source: destinations stay templates until the server assigns
  // the new request number.
  const plannedFiles = bundle ? planBundleFileCopies(bundle) : [];
  // A bundle manifest expires when either the manifest TTL or the bundle
  // freshness window ends, whichever is earlier.
  const preparedAt = Date.now();
  const expiresAt = Math.min(preparedAt + MANIFEST_TTL_MS, bundle ? assertBundleFresh(bundle, preparedAt) : Infinity);
  return {
    kind: bundle ? MANIFEST_V4 : MANIFEST_V3,
    preparedAt: new Date(preparedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    target: SANDBOX_URL,
    recipe,
    values,
    expectedOrganization: {
      accountid: preflight.foundation.accountid,
      name: preflight.foundation.name,
    },
    expectedRequestType: preflight.grantOption,
    expectedAppUserId: preflight.appUser.systemuserid,
    expectedGraphSiteId: preflight.siteId,
    expectedGraphDriveId: preflight.driveId,
    source: {
      requestId: source.akoya_requestid,
      requestNumber: source.akoya_requestnum,
      requestType: source.akoya_requesttype,
      revision: source.revision,
      ...(bundle ? {
        dataverseHost: bundle.source.dataverseHost,
        exportedAt: bundle.exportedAt,
        bundleSha256: sha256(bundle),
      } : {}),
    },
    ...(bundle ? {
      bundle,
      plannedFiles,
      copyPolicy: { version: SANDBOX_REHEARSAL_COPY_POLICY.version, digest: copyPolicyDigest() },
      // F2 (Codex slice 6c-ii Stage C round 1): the reviews recipe's file
      // copies are governed by a SEPARATE policy (review-file-copy.js) from
      // the Basic/IA copyPolicy above; a reviews manifest must bind to it
      // too, so a stale review-file policy is caught the same way a stale
      // copyPolicy is -- never only for non-reviews recipes.
      ...(recipe === 'reviews' ? {
        reviewFilePolicy: { version: REVIEW_FILE_COPY_POLICY.version, digest: reviewFileCopyPolicyDigest() },
      } : {}),
    } : {}),
    createBody,
    createBodySha256: sha256(createBody),
    invariants: {
      exactlyOneCreate: true,
      retryOnAmbiguousCreate: false,
      retryOnAmbiguousFileUpload: false,
      deleteOrReset: false,
      expectedPayments: 0,
      expectedRegardingEmails: 0,
      expectedDynamicsLocations: 1,
      expectedSharePointFiles: plannedFiles.length,
    },
  };
}

/** Re-validate the embedded bundle and return its projected source Request. */
export function bundleSourceOf(manifest, { allowStale = false } = {}) {
  const bundle = readSourceBundle(manifest.bundle);
  if (sha256(manifest.bundle) !== manifest.source?.bundleSha256) throw new Error('Embedded source bundle hash mismatch.');
  const request = bundle.source.request;
  if (request.akoya_requestid !== String(manifest.source.requestId).toLowerCase()
      || request.akoya_requestnum !== manifest.source.requestNumber
      || request.revision !== manifest.source.revision
      || request.akoya_requesttype !== manifest.source.requestType
      || bundle.source.dataverseHost !== manifest.source.dataverseHost) {
    throw new Error('Embedded source bundle does not match the manifest source.');
  }
  if (manifest.copyPolicy?.version !== SANDBOX_REHEARSAL_COPY_POLICY.version
      || manifest.copyPolicy?.digest !== copyPolicyDigest()) {
    throw new Error('Manifest copy policy does not match the current sandbox rehearsal copy policy; re-prepare.');
  }
  // F2: a `reviews` manifest must bind to the CURRENT review-file copy
  // policy (fail closed the same way a stale copyPolicy does above); a
  // non-`reviews` manifest carrying a `reviewFilePolicy` at all is refused
  // on the complement, since that recipe never plans reviewer-upload copies.
  if ((manifest.recipe ?? 'basic') === 'reviews') {
    if (manifest.reviewFilePolicy?.version !== REVIEW_FILE_COPY_POLICY.version
        || manifest.reviewFilePolicy?.digest !== reviewFileCopyPolicyDigest()) {
      throw new Error('Manifest review-file copy policy does not match the current review-file copy policy; re-prepare.');
    }
  } else if (manifest.reviewFilePolicy) {
    throw new Error('Manifest carries a review-file copy policy for a non-reviews recipe; refusing.');
  }
  if (!allowStale) assertBundleFresh(bundle);
  return { bundle, request };
}

/**
 * Compute the plan digest a reservation binds to (F2, Codex slice 6c-ii
 * Stage C round 1): moved out of scripts/rehearse-test-request-sandbox.mjs
 * into this shared helper so the runner's pre-lease check
 * (`assertRunMatchesManifestAndBundle`) can recompute the SAME digest from
 * the manifest plus the ledger's own reviewer-assignment addresses, rather
 * than trusting the run row's `planDigest` column alone.
 *
 * For `basic`/`initial_assessment` manifests this is BYTE-IDENTICAL to the
 * pre-F2 formula (key order and fields unchanged; no reviewer fields at
 * all) -- an existing reserved run's `planDigest` must still match after
 * this refactor, so this key order must never change without a migration
 * story.
 *
 * `reviewerAddressDigests` is every reviewer assignment's ALREADY-NORMALIZED
 * `addressSha256` for a `reviews` manifest (ignored otherwise), sorted (so a
 * same-key retry naming the same reviewers in a different order still
 * matches) plus the assignment count. This takes digests, never plaintext
 * addresses: `run-ledger.js`'s `listRunReviewerAssignments` never returns a
 * plaintext address (migration 054's own "no plaintext" posture), so the
 * runner's pre-lease recompute can only ever have the digest, and the
 * reservation script must normalize through `reviewerAddressSha256` itself
 * (exactly as it always has) BEFORE calling this helper, so both callers
 * feed it the same shape. `reviewFilePolicyDigest` binds the reviews-only
 * review-file copy policy (F2 change 3), so a stale review-file policy
 * changes the plan digest the same way a stale `copyPolicy` already does.
 */
export function computeRunPlanDigest({ manifest, reviewerAddressDigests = [] }) {
  return sha256({
    runId: manifest.values.runId,
    recipe: manifest.recipe,
    destinationRequestId: manifest.values.requestId,
    destinationLocationId: manifest.values.locationId,
    sourceRequestId: manifest.source.requestId,
    sourceRevision: manifest.source.revision,
    bundleSha256: manifest.source.bundleSha256,
    copyPolicyDigest: manifest.copyPolicy.digest,
    createBodySha256: manifest.createBodySha256,
    ...(manifest.recipe === 'reviews' ? {
      reviewerAddressDigests: [...reviewerAddressDigests].sort(),
      reviewerAssignmentCount: reviewerAddressDigests.length,
      reviewFilePolicyDigest: manifest.reviewFilePolicy.digest,
    } : {}),
  });
}

export function validateCloneManifest(manifest, { allowExpired = false, forExecute = false } = {}) {
  if (!['test-request-sandbox-rehearsal-manifest/v1', 'test-request-sandbox-rehearsal-manifest/v2', MANIFEST_V3, MANIFEST_V4].includes(manifest?.kind)) {
    throw new Error('Unsupported manifest kind.');
  }
  if (forExecute && ![MANIFEST_V3, MANIFEST_V4].includes(manifest.kind)) {
    throw new Error('Only a source-bound v3 or bundle v4 manifest can execute a sandbox clone.');
  }
  if (forExecute && (manifest.recipe ?? 'basic') !== 'basic') {
    throw new Error('Only a basic recipe manifest can execute the legacy one-shot sandbox clone.');
  }
  if (manifest.target !== SANDBOX_URL) throw new Error('Manifest target is not the registered sandbox.');
  const sourceBound = manifest.kind === MANIFEST_V3 || manifest.kind === MANIFEST_V4;
  if (sourceBound && (!/^[0-9a-f-]{36}$/i.test(manifest.source?.requestId || '') ||
      !manifest.source?.revision || !Number.isInteger(manifest.source?.requestType) ||
      !String(manifest.createBody?.akoya_title || '').startsWith('TEST: '))) {
    throw new Error('Source-bound manifest provenance is invalid.');
  }
  if (isBundleManifest(manifest)) {
    const { bundle } = bundleSourceOf(manifest, { allowStale: allowExpired });
    // P3 (Opus round 1, 6c-ii Stage A): bundle.documents never carries a
    // reviewerUpload document (rejected at export time), so this count check
    // is Basic-recipe file plan only, never reviewer files. Stage C's
    // reviews-recipe file plan/count is a separate invariant over
    // bundle.reviewers[].files.
    if (!Array.isArray(manifest.plannedFiles) || manifest.plannedFiles.length !== bundle.documents.length
        || manifest.invariants?.expectedSharePointFiles !== bundle.documents.length
        || manifest.invariants?.retryOnAmbiguousFileUpload !== false
        || !manifest.expectedGraphSiteId || !manifest.expectedGraphDriveId) {
      throw new Error('Bundle manifest file plan is invalid.');
    }
  }
  if (!manifest.expiresAt || (!allowExpired && Date.parse(manifest.expiresAt) <= Date.now())) throw new Error('Manifest is expired.');
  if (manifest.createBodySha256 !== sha256(manifest.createBody)) throw new Error('Manifest create body hash mismatch.');
  if (!guidEqual(manifest.createBody.akoya_requestid, manifest.values?.requestId) ||
      !guidEqual(manifest.createBody.wmkf_testcreationrunid, manifest.values?.runId) ||
      (!manifest.kind.endsWith('/v1') && (!/^[0-9a-f-]{36}$/i.test(manifest.values?.locationId || '') ||
        !/^[0-9a-f-]{36}$/i.test(manifest.expectedAppUserId || '')))) {
    throw new Error('Manifest identity mismatch.');
  }
  if (manifest.invariants?.exactlyOneCreate !== true || manifest.invariants?.retryOnAmbiguousCreate !== false) {
    throw new Error('Manifest create invariants are invalid.');
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

/**
 * Fence the source before a write. A v3 manifest re-reads its sandbox source;
 * a v4 manifest re-validates the embedded production bundle instead, because
 * the sandbox client must never read production. Called three separate times
 * by the script's executeManifest (pre-create, immediately pre-POST after
 * any GoVerify bypass, and post-observation) with different failure
 * semantics at each call site -- this function itself is identical each
 * time; callers decide whether a thrown error is fatal or a soft
 * verification failure.
 */
export async function fenceSource(client, manifest, grantType, requestOptions = null) {
  let source;
  if (isBundleManifest(manifest)) {
    source = bundleSourceOf(manifest).request;
    if (source.akoya_requesttype !== grantType) throw new Error('Bundle source is not a Grant Request for the sandbox Grant option.');
  } else {
    source = assertSourceUnchanged(
      manifest.source,
      await getSourceRequestById(client, manifest.source.requestId, requestOptions),
      grantType,
    );
  }
  assertCopiedSourceValues(source, manifest.createBody);
  return source;
}

/** The preallocated destination GUID must be absent before the sole create POST. */
export async function checkPreallocatedRequestAbsent(client, requestId) {
  const existing = await client.get(`/akoya_requests(${requestId})?$select=akoya_requestid`);
  if (existing.status !== 404) {
    throw Object.assign(new Error(`Preallocated request GUID is not absent (status ${existing.status}).`), {
      code: 'preallocated_request_present',
    });
  }
}

/* -------------------------------------------------------------------- */
/* GoVerify bypass helpers (internal to createRequestWithGoverifyBypass) */
/* -------------------------------------------------------------------- */

async function getGoverifyWorkflow(client, requestOptions = null) {
  const fields = [
    'workflowid', 'workflowidunique', 'name', 'category', 'type', 'mode', 'primaryentity',
    'statecode', 'statuscode', 'componentstate', 'triggeroncreate', 'triggeronupdateattributelist',
    'modifiedon', 'versionnumber',
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

/**
 * The paired GoVerify deactivate -> Request create -> GoVerify restore
 * sequence, in the same try/finally as the original single-file script: the
 * restore is unconditionally attempted whenever a deactivation was started,
 * regardless of whether the create succeeded, failed, or was ambiguous, and
 * can itself throw and mask/replace the create's own error (matching the
 * original executeManifest exactly).
 *
 * `journal(patch)` is called at every point the original script wrote a
 * receipt field before or after a dispatch; the caller (script or runner)
 * persists `patch` however it stores state (a merged file receipt, or a
 * ledger resource row). Patch shapes:
 *   - `{ goverifyBypass: {...} }` -- merge into the bypass state.
 *   - `{ createAttempted, createAttemptedAt }` -- before the create POST.
 *   - `{ createResponseStatus, createResponseReceivedAt }` -- after the POST.
 *   - `{ postCreateStepsSkipped, postCreateStepsSkippedReason }` -- set only
 *     from the restore's own failure paths (the outer catch-all fallback for
 *     every OTHER kind of post-create failure remains the caller's job, as
 *     it always has been).
 *
 * A signal fence (SIGINT/SIGTERM) is created and disposed inside this one
 * call only when `bypassGoverify` is true; it cannot span multiple bounded
 * runner invocations (see run-runner.js's per-call re-entry rules instead).
 *
 * Returns `{ created, goverifyBypass }` where `created` is the raw
 * `postWithOptions` response for the sole Request create.
 */
export async function createRequestWithGoverifyBypass({
  client, manifest, preflightBefore, bypassGoverify = false, journal,
}) {
  let created;
  let goverifyBypass = null;
  let signalFence = null;
  let goverifyRestoreRequired = false;
  let createAttempted = false;
  try {
    if (bypassGoverify) {
      const workflowBefore = await getGoverifyWorkflow(client);
      assertExpectedGoverifyWorkflow(workflowBefore, { statecode: 1, statuscode: 2 });
      await assertGoverifyActivationState(client, true);
      goverifyBypass = {
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
      await journal({ goverifyBypass });
      throwIfInterrupted(signalFence);
      goverifyBypass = { ...goverifyBypass, deactivationPatchAttemptedAt: new Date().toISOString() };
      await journal({ goverifyBypass });
      const workflowDeactivated = await setGoverifyWorkflowState(
        client,
        workflowBefore,
        { statecode: 0, statuscode: 1 },
        { signal: signalFence.signal, timeoutMs: BYPASS_REQUEST_TIMEOUT_MS },
      );
      goverifyBypass = {
        ...goverifyBypass,
        deactivatedAt: new Date().toISOString(),
        deactivatedVersionNumber: workflowDeactivated.versionnumber,
      };
      await journal({ goverifyBypass });
      throwIfInterrupted(signalFence);
    }

    // Fence the source again after any optional automation change and just
    // before the sole Request POST.
    await fenceSource(
      client,
      manifest,
      preflightBefore.grantOption.value,
      signalFence ? { signal: signalFence.signal, timeoutMs: BYPASS_REQUEST_TIMEOUT_MS } : null,
    );
    throwIfInterrupted(signalFence);

    const createAttemptedAt = new Date().toISOString();
    createAttempted = true;
    await journal({ createAttempted: true, createAttemptedAt });
    const createRequestOptions = { timeoutMs: CREATE_REQUEST_TIMEOUT_MS };
    if (signalFence) createRequestOptions.signal = signalFence.signal;
    created = await client.postWithOptions('/akoya_requests', manifest.createBody, {
      Prefer: 'return=representation',
    }, createRequestOptions);
    await journal({ createResponseStatus: created.status, createResponseReceivedAt: new Date().toISOString() });
  } finally {
    try {
      if (goverifyRestoreRequired) {
        goverifyBypass = { ...goverifyBypass, restoreAttemptedAt: new Date().toISOString() };
        try {
          await journal({ goverifyBypass });
        } catch (error) {
          // A journal I/O failure must not prevent the safety restoration.
          goverifyBypass = { ...goverifyBypass, restoreIntentPersistError: error.message };
        }
        let workflowRestored;
        try {
          if (isGoverifyDeactivationUncertain(goverifyBypass)) {
            const reason = 'GoVerify deactivation PATCH was attempted but its inactive state was not verified; the server may still commit it. Manually recheck the workflow before resuming.';
            goverifyBypass = {
              ...goverifyBypass,
              restoreVerified: false,
              restoreManualRecheckRequired: true,
              restoreManualRecheckReason: reason,
              restoreError: reason,
            };
            const patch = { goverifyBypass };
            if (createAttempted) {
              patch.postCreateStepsSkipped = true;
              patch.postCreateStepsSkippedReason = reason;
            }
            await journal(patch);
            throw new Error(`${reason} Workflow ID: ${goverifyBypass.workflowId}.`);
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
            goverifyBypass = { ...goverifyBypass, restoreWasAlreadyActive: true };
          }
        } catch (error) {
          goverifyBypass = {
            ...goverifyBypass,
            restoreError: error.message,
            restored: false,
            restoreVerified: false,
          };
          const patch = { goverifyBypass };
          if (createAttempted) {
            patch.postCreateStepsSkipped = true;
            patch.postCreateStepsSkippedReason = 'GoVerify restoration failed; inspect the destination Request by its preallocated GUID.';
          }
          await journal(patch);
          throw error;
        }
        goverifyBypass = {
          ...goverifyBypass,
          restored: true,
          restoreVerified: true,
          restoredAt: new Date().toISOString(),
          restoredVersionNumber: workflowRestored.versionnumber,
        };
        await journal({ goverifyBypass });
      }
    } finally {
      signalFence?.dispose();
    }
  }
  throwIfInterrupted(signalFence);
  if (!created?.ok) bodyOrThrow('single Request create', created);
  return { created, goverifyBypass };
}

/** Fresh readback of the just-created Request, for correctMeetingDate's precondition. */
export async function readRequestForCorrection(client, requestId) {
  return getRequest(client, requestId);
}

/**
 * ETag-guarded, single-shot, never-retried meeting-date correction. `request`
 * must be a fresh readback (readRequestForCorrection) taken immediately
 * before this call in the SAME invocation, since the ETag is not re-fetched.
 * `journal(patch)` merges into `meetingDateCorrection`.
 */
export async function correctMeetingDate(client, manifest, request, journal) {
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
  let correction = { desired, before, patchAttempted: false };
  if (String(before).slice(0, 10) === desired) return request;

  correction = { ...correction, patchAttempted: true, patchAttemptedAt: new Date().toISOString() };
  await journal(correction);
  let patched = null;
  let patchError = null;
  try {
    patched = await client.patch(
      `/akoya_requests(${request.akoya_requestid})`,
      { wmkf_meetingdate: desired },
      { 'If-Match': request['@odata.etag'] },
    );
    correction = {
      ...correction,
      patchResponseStatus: patched.status,
      patchResponseReceivedAt: new Date().toISOString(),
    };
    await journal(correction);
  } catch (error) {
    patchError = error;
    correction = {
      ...correction,
      patchResponseError: error.message,
      patchResponseReceivedAt: new Date().toISOString(),
    };
    await journal(correction);
  }
  // The one-field PATCH is never retried. A lost response is reconciled by
  // rereading the same Request and exact date/marker/owner identities.
  const after = await getRequest(client, request.akoya_requestid);
  correction = { ...correction, after: after.wmkf_meetingdate || null, readbackAt: new Date().toISOString() };
  await journal(correction);
  if (!guidEqual(after.akoya_requestid, manifest.values.requestId) ||
      !guidEqual(after.wmkf_testcreationrunid, manifest.values.runId) ||
      after.wmkf_istestrequest !== true ||
      !guidEqual(after._createdby_value, manifest.expectedAppUserId) ||
      !guidEqual(after._ownerid_value, manifest.expectedAppUserId) ||
      String(after.wmkf_meetingdate || '').slice(0, 10) !== desired) {
    if (patchError) {
      throw Object.assign(new Error('Meeting-date PATCH outcome is ambiguous; no retry is allowed.', { cause: patchError }), {
        code: 'meeting_date_patch_failed',
      });
    }
    bodyOrThrow('single meeting-date correction', patched);
    throw Object.assign(new Error('Meeting-date correction readback did not match the planned Request state.'), {
      code: 'meeting_date_readback_mismatch',
    });
  }
  return after;
}

/**
 * App-owned SharePoint document-location provisioning: exactly one create
 * with the preallocated location GUID, reconciled by that GUID on any
 * ambiguous response, never a second POST. `journal(patch)` merges into
 * `locationProvision`.
 */
export async function provisionSharePointLocation(client, graph, sharePointTarget, manifest, request, journal) {
  if (!guidEqual(request.akoya_requestid, manifest.values.requestId) ||
      !guidEqual(request.wmkf_testcreationrunid, manifest.values.runId) ||
      !guidEqual(request._createdby_value, manifest.expectedAppUserId) ||
      !guidEqual(request._ownerid_value, manifest.expectedAppUserId) ||
      request.wmkf_istestrequest !== true || !request.akoya_requestnum) {
    throw new Error('Fresh synthetic Request readback failed the location-create precondition.');
  }
  const sharePoint = sharePointTarget();
  if (!sharePoint.registered || sharePoint.key !== 'akoyago-shared') {
    throw new Error('The configured SharePoint site is not the registered akoyaGO site.');
  }
  const parent = await getRequestLibraryParent(client);
  const folder = expectedRequestFolder(request.akoya_requestnum, request.akoya_requestid);
  const existing = await getLocations(client, request.akoya_requestid);
  if (existing.length > 0) {
    throw new Error(`Expected no preexisting Request location before app provisioning; found ${existing.length}.`);
  }
  let provision = {
    parentId: parent.sharepointdocumentlocationid,
    folder,
    graphFolderAttempted: true,
    graphFolderAttemptedAt: new Date().toISOString(),
  };
  await journal(provision);
  const graphFolder = await graph.ensureFolderPath(REQUEST_LIBRARY, folder);
  provision = { ...provision, graphFolder, graphFolderReadyAt: new Date().toISOString() };
  await journal(provision);

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
  provision = { ...provision, locationCreateAttempted: true, locationCreateAttemptedAt: new Date().toISOString() };
  await journal(provision);
  const created = await client.post('/sharepointdocumentlocations', body, { Prefer: 'return=representation' });
  provision = { ...provision, createResponseStatus: created.status, createResponseReceivedAt: new Date().toISOString() };
  await journal(provision);
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
  provision = { ...provision, locationId: readback[0].sharepointdocumentlocationid };
  await journal(provision);
  return { folder, parentId: parent.sharepointdocumentlocationid, graphFolder };
}

/**
 * The 60-second observation window: polls every `pollMs` until `observationMs`
 * elapses, keeping only the last snapshot (matching the original script,
 * which discards intermediate polls). `observationMs`/`pollMs`/`sleep` are
 * injectable so tests never wait 60 real seconds; defaults match the
 * original constants.
 */
export async function observe(client, requestId, {
  observationMs = OBSERVATION_MS, pollMs = POLL_MS, sleep: sleepFn = sleep,
} = {}) {
  const deadline = Date.now() + observationMs;
  let snapshot = null;
  do {
    const [request, locations, payments, emails] = await Promise.all([
      getRequest(client, requestId),
      getLocations(client, requestId),
      getPayments(client, requestId),
      getEmails(client, requestId),
    ]);
    snapshot = { request, locations, payments, emails };
    if (Date.now() < deadline) await sleepFn(Math.min(pollMs, deadline - Date.now()));
  } while (Date.now() < deadline);
  snapshot.locationParents = await resolveLocationParents(client, snapshot.locations);
  return snapshot;
}

/**
 * Folder census under the destination Request folder. `maxDepth` counts
 * folder levels below the Request folder itself (`Graph listFiles` walks
 * depth 0..maxDepth inclusive), so the default of 3 reaches
 * `Reviewer_Uploads/<reviewer>/attempt_<id>/` but NOT a folder nested inside
 * an attempt folder. Verifiers that must see everything under a deeper
 * tree pass a larger `maxDepth` (Codex slice review round 1, F4).
 *
 * `failOnTruncation` is on: a census that silently stopped at `maxFiles`
 * would report MISSING files rather than the EXTRA ones it never saw, which
 * is the wrong direction for a verifier. The caller records the thrown
 * `graph_file_list_truncated` error as a Graph inspection failure.
 */
export const SHAREPOINT_CENSUS_DEFAULTS = Object.freeze({ maxDepth: 3, maxFiles: 100, totalTimeoutMs: 30_000 });

export async function listSharePointFiles(graph, observation, options = {}) {
  if (observation.locations.length !== 1 || observation.locationParents.length !== 1) return null;
  const location = observation.locations[0];
  const parent = observation.locationParents[0];
  if (!parent?.relativeurl || !location.relativeurl) return null;
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth >= SHAREPOINT_CENSUS_DEFAULTS.maxDepth
    ? options.maxDepth : SHAREPOINT_CENSUS_DEFAULTS.maxDepth;
  return graph.listFiles(parent.relativeurl, location.relativeurl, {
    recursive: true,
    maxDepth,
    maxFiles: SHAREPOINT_CENSUS_DEFAULTS.maxFiles,
    totalTimeoutMs: SHAREPOINT_CENSUS_DEFAULTS.totalTimeoutMs,
    failOnTruncation: true,
  });
}

/** Pure verification, unchanged from the original script's `verify`. */
export function verifyClone(manifest, preflightBefore, observation, files, foundationAfter, contactsAfter, fileCopies = null) {
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
  else if (fileCopies) {
    if (fileCopies.length !== manifest.invariants.expectedSharePointFiles) {
      failures.push(`journaled ${fileCopies.length} file copies; manifest expected ${manifest.invariants.expectedSharePointFiles}`);
    }
    failures.push(...verifyCopiedFiles(fileCopies, files));
  } else if (files.length !== 0) failures.push(`SharePoint folder contains ${files.length} file(s)`);

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

/**
 * Final, manifest-authoritative byte re-check by stable ID, injected via a
 * GraphService-shaped object rather than a dynamic import.
 */
export async function reverifyClone(graph, fileCopies) {
  return reverifyCopiedItems(fileCopies, {
    getFileMetadataById: (driveId, itemId) => graph.getFileMetadataById(driveId, itemId),
    downloadFile: (driveId, itemId) => graph.downloadFile(driveId, itemId),
  });
}
