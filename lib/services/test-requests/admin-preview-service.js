/**
 * Read-only runtime composition for the Admin Test Request preview.
 *
 * This service resolves every authoritative value on the server: target,
 * source request, W. M. Keck Foundation account, Grant request type, Dataverse
 * create metadata, SharePoint inventory, stable file versions, and content
 * hashes. The browser supplies only a source selector and bounded preview
 * choices. There is deliberately no create, update, upload, or copy operation
 * in this module.
 */

import crypto from 'node:crypto';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as metadataAdapter from '../../dataverse/adapters/metadata.js';
import { classifyDeployment, classifyTarget } from '../../dataverse/core/interlock.js';
import * as odata from '../../dataverse/core/odata.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import {
  expectedProposalBibliographyFilename,
  expectedProposalNarrativeFilename,
  expectedReviewerProposalFilename,
} from '../../utils/proposal-document-names.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { configuredSharePointTargetInfo } from '../sharepoint-target-registry.js';
import { compileBasicTestRequestPreview } from './preview.js';

const FOUNDATION_NAME = 'W. M. Keck Foundation';
const PHASE_I_FOLDER = 'Phase I';
const REVIEWER_MATERIALS_FOLDER = 'Reviewer Materials';
const AI_MATERIALS_FOLDER = 'AI Materials';

const SOURCE_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'akoya_purpose',
  'akoya_request',
  'akoya_fiscalyear',
  'akoya_requesttype',
  'wmkf_meetingdate',
  '_akoya_applicantid_value',
].join(',');

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

// These are safety ceilings for the read-only hashing operation, not an
// approved future copy policy. The preview remains blocked until the owner
// approves the actual executor limits.
export const TEST_REQUEST_PREVIEW_READ_LIMITS = Object.freeze({
  maxFiles: 7,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  allowedMimeTypes: Object.freeze([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
});

const DOCUMENT_SPECS = Object.freeze({
  projectDescription: Object.freeze({
    label: 'Project Description', folder: PHASE_I_FOLDER, filename: () => 'ProjectDescription.pdf', copyMode: 'copy',
  }),
  biosketches: Object.freeze({
    label: 'Biosketches', folder: PHASE_I_FOLDER, filename: () => 'Biosketches.pdf', copyMode: 'copy',
  }),
  projectBudget: Object.freeze({
    label: 'Project Budget', folder: PHASE_I_FOLDER, filename: () => 'ProjectBudget.pdf', copyMode: 'copy',
  }),
  projectBudgetSpreadsheet: Object.freeze({
    label: 'Project Budget spreadsheet', folder: PHASE_I_FOLDER, filename: () => 'Project Budget spreadsheet.xlsx', copyMode: 'copy',
  }),
  reviewerProposal: Object.freeze({
    label: 'Reviewer proposal', folder: REVIEWER_MATERIALS_FOLDER, filename: expectedReviewerProposalFilename, copyMode: 'requires-transform',
  }),
  proposalNarrative: Object.freeze({
    label: 'Proposal narrative', folder: AI_MATERIALS_FOLDER, filename: expectedProposalNarrativeFilename, copyMode: 'requires-transform',
  }),
  proposalBibliography: Object.freeze({
    label: 'Proposal bibliography', folder: AI_MATERIALS_FOLDER, filename: expectedProposalBibliographyFilename, copyMode: 'requires-transform',
  }),
});

function previewError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extras },
  });
}

function targetInfo() {
  const configuredUrl = process.env.DYNAMICS_URL || '';
  let hostname = null;
  try {
    hostname = new URL(configuredUrl).hostname;
  } catch {
    // Unknown is intentionally handled by assertSandboxTarget below.
  }
  return {
    deployment: classifyDeployment(),
    target: classifyTarget(configuredUrl),
    hostname,
  };
}

function assertPreviewTargets(dataverse, sharePoint) {
  if (dataverse?.target !== 'sandbox' || dataverse?.deployment === 'production') {
    throw previewError(
      'Test Request preview is available only when the server is connected to the registered Dataverse sandbox.',
      'test_request_preview_sandbox_required',
      503,
      { target: dataverse?.target || 'unknown' },
    );
  }
  if (!sharePoint?.registered || sharePoint.key !== 'akoyago-shared' || sharePoint.scope !== 'shared') {
    throw previewError(
      'Test Request preview is available only with the registered shared akoyaGO SharePoint site.',
      'test_request_preview_sharepoint_target_required',
      503,
      { sharePointTarget: sharePoint?.key || 'unknown' },
    );
  }
}

function previewEnvironment(dependencies) {
  const dataverse = dependencies.getTargetInfo();
  const sharePoint = dependencies.getSharePointTargetInfo();
  assertPreviewTargets(dataverse, sharePoint);
  return {
    ...dataverse,
    sharePoint: {
      key: sharePoint.key,
      scope: sharePoint.scope,
      hostname: sharePoint.hostname,
      pathname: sharePoint.pathname,
    },
  };
}

function lastFolderSegment(folder) {
  return String(folder || '').split('/').filter(Boolean).at(-1) || '';
}

function classifyDocument(folder, name, requestNumber) {
  const folderName = lastFolderSegment(folder);
  for (const [kind, spec] of Object.entries(DOCUMENT_SPECS)) {
    if (folderName.toLowerCase() !== spec.folder.toLowerCase()) continue;
    if (name !== spec.filename(requestNumber)) continue;
    return { kind, ...spec };
  }
  return null;
}

function inventoryId(requestId, library, folder, graphItemId) {
  return crypto.createHash('sha256')
    .update([requestId, library, folder, graphItemId].join('\u0000'))
    .digest('base64url');
}

function publicDocument(document) {
  return {
    id: document.id,
    kind: document.kind,
    label: document.label,
    name: document.name,
    folder: lastFolderSegment(document.folder),
    size: document.size,
    mimeType: document.mimeType,
    lastModified: document.lastModified,
    source: document.source,
    copyMode: document.copyMode,
  };
}

function sourceSummary(source) {
  return {
    requestId: source.akoya_requestid,
    requestNumber: source.akoya_requestnum,
    title: source.akoya_title || null,
    applicant: source._akoya_applicantid_value_formatted || null,
    fiscalYear: source.akoya_fiscalyear || '',
    meetingDate: source.wmkf_meetingdate ? String(source.wmkf_meetingdate).slice(0, 10) : '',
    requestedAmount: source.akoya_request ?? null,
  };
}

function isExpectedArchiveMiss(bucket, error) {
  return bucket?.source === 'archive' && /\(\s*404\s*\)/.test(String(error?.message || ''));
}

async function discoverDocuments(source, dependencies) {
  const buckets = await dependencies.getRequestSharePointBuckets(
    source.akoya_requestid,
    source.akoya_requestnum,
  );
  const results = await Promise.all(buckets.map(async (bucket) => {
    try {
      const files = await dependencies.listFiles(bucket.library, bucket.folder, {
        recursive: true,
        maxDepth: 3,
        maxFiles: 200,
        failOnTruncation: true,
      });
      return { bucket, files };
    } catch (error) {
      if (isExpectedArchiveMiss(bucket, error)) return { bucket, files: [] };
      return {
        bucket,
        files: [],
        errorCode: error?.code === 'graph_file_list_truncated'
          ? 'SOURCE_BUCKET_TRUNCATED'
          : 'SOURCE_BUCKET_UNAVAILABLE',
      };
    }
  }));

  const seen = new Set();
  const documents = [];
  const errors = [];
  for (const result of results) {
    if (result.errorCode) {
      errors.push({ source: result.bucket.source, code: result.errorCode });
      continue;
    }
    for (const file of result.files) {
      const spec = classifyDocument(file.folder || result.bucket.folder, file.name, source.akoya_requestnum);
      if (!spec || !file.id) continue;
      const folder = file.folder || result.bucket.folder;
      const id = inventoryId(source.akoya_requestid, result.bucket.library, folder, file.id);
      if (seen.has(id)) continue;
      seen.add(id);
      documents.push({
        id,
        graphItemId: file.id,
        library: result.bucket.library,
        folder,
        name: file.name,
        size: file.size ?? null,
        mimeType: file.mimeType ?? null,
        lastModified: file.lastModified || null,
        source: result.bucket.source,
        ...spec,
      });
    }
  }
  documents.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  return { documents, errors };
}

async function resolveSource({ requestId, requestNumber }, dependencies) {
  let source = null;
  if (requestId) {
    source = await dependencies.getRequestById(requestId);
  } else {
    const result = await dependencies.findRequestByNumber(requestNumber);
    const matches = result.records || [];
    if (matches.length > 1) {
      throw previewError(
        'The source Request number is ambiguous in the sandbox.',
        'test_request_source_ambiguous',
        409,
      );
    }
    source = matches.length === 1 ? matches[0] : null;
  }
  if (!source?.akoya_requestid || !source?.akoya_requestnum) {
    throw previewError('The source Request could not be found in the sandbox.', 'test_request_source_not_found', 404);
  }
  return source;
}

function assertPreviewReadLimits(selectedDocuments) {
  if (selectedDocuments.length > TEST_REQUEST_PREVIEW_READ_LIMITS.maxFiles) {
    throw previewError(
      `Select no more than ${TEST_REQUEST_PREVIEW_READ_LIMITS.maxFiles} documents for one preview.`,
      'test_request_preview_file_count_exceeded',
      413,
    );
  }
  let totalBytes = 0;
  for (const document of selectedDocuments) {
    if (!Number.isSafeInteger(document.size) || document.size < 0) {
      throw previewError('A selected document has no trustworthy size.', 'test_request_preview_file_metadata_unavailable', 503);
    }
    if (document.size > TEST_REQUEST_PREVIEW_READ_LIMITS.maxFileBytes) {
      throw previewError(
        `${document.name} exceeds the read-only preview hashing limit.`,
        'test_request_preview_file_too_large',
        413,
      );
    }
    if (!TEST_REQUEST_PREVIEW_READ_LIMITS.allowedMimeTypes.includes(document.mimeType)) {
      throw previewError(
        `${document.name} has a file type that the Basic preview does not support.`,
        'test_request_preview_file_type_unsupported',
        415,
      );
    }
    totalBytes += document.size;
  }
  if (totalBytes > TEST_REQUEST_PREVIEW_READ_LIMITS.maxTotalBytes) {
    throw previewError(
      'The selected documents exceed the read-only preview hashing limit.',
      'test_request_preview_total_size_exceeded',
      413,
    );
  }
}

function sameVersion(left, right) {
  return left?.id === right?.id
    && left?.name === right?.name
    && left?.size === right?.size
    && left?.mimeType === right?.mimeType
    && left?.eTag === right?.eTag
    && left?.versionId === right?.versionId;
}

async function hydrateSelectedDocument(document, dependencies) {
  const driveId = await dependencies.getDriveId(document.library);
  const before = await dependencies.getFileMetadataById(driveId, document.graphItemId);
  if (!before || !before.eTag
      || before.name !== document.name
      || before.size !== document.size
      || before.mimeType !== document.mimeType) {
    throw previewError(
      `${document.name} changed while the preview was being prepared. Reload the source Request.`,
      'test_request_preview_source_changed',
      409,
    );
  }
  const downloaded = await dependencies.downloadFile(driveId, document.graphItemId);
  const after = await dependencies.getFileMetadataById(driveId, document.graphItemId);
  if (!sameVersion(before, after)
      || downloaded.filename !== before.name
      || downloaded.size !== before.size
      || downloaded.buffer.length !== before.size) {
    throw previewError(
      `${document.name} changed while its bytes were being verified. Reload the source Request.`,
      'test_request_preview_source_changed',
      409,
    );
  }
  return {
    id: document.id,
    kind: document.kind,
    library: document.library,
    folder: document.folder,
    name: document.name,
    size: document.size,
    mimeType: before.mimeType,
    eTag: before.eTag,
    versionId: before.versionId || null,
    contentHash: crypto.createHash('sha256').update(downloaded.buffer).digest('hex'),
  };
}

function publicRequestFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.entries(body)
    .filter(([field]) => field !== 'akoya_requestid')
    .map(([field, value]) => field.endsWith('@odata.bind')
      ? { field: field.slice(0, -'@odata.bind'.length), value: FOUNDATION_NAME }
      : { field, value });
}

function publicCompiledPreview(compiled) {
  return {
    ...compiled,
    executionReady: false,
    requestPlan: { ...compiled.requestPlan, createBody: null, executionReady: false },
    filePlan: { ...compiled.filePlan, plannedFiles: [], executionReady: false },
    preview: {
      request: {
        authoritative: false,
        fields: publicRequestFields(compiled.preview?.request?.body),
      },
      files: (compiled.preview?.files || []).map((file) => {
        const { library: _library, ...source } = file.source || {};
        return {
          ...file,
          source: { ...source, folder: lastFolderSegment(source.folder) },
        };
      }),
    },
  };
}

function addBlockingConditions(compiled, blockers) {
  if (!blockers.length) return compiled;
  return {
    ...compiled,
    blockers: [...compiled.blockers, ...blockers],
    executionReady: false,
    planReady: false,
    requestPlan: { ...compiled.requestPlan, createBody: null, executionReady: false },
    filePlan: {
      ...compiled.filePlan,
      executionReady: false,
      planReady: false,
      plannedFiles: [],
    },
    preview: {
      ...compiled.preview,
      files: compiled.preview.files.map((file) => (
        file.operation === 'would-copy' ? { ...file, operation: 'blocked' } : file
      )),
    },
  };
}

async function loadCompilerMetadata() {
  const [attributeBody, titleMetadata, purposeMetadata, fiscalYearMetadata, runIdMetadata, amountMetadata, relationshipBody] = await metadataAdapter.getMetadataBatch([
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes"
      + '?$select=LogicalName,AttributeType,IsValidForCreate,RequiredLevel',
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='akoya_title')/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=MaxLength",
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='akoya_purpose')/Microsoft.Dynamics.CRM.MemoAttributeMetadata?$select=MaxLength",
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='akoya_fiscalyear')/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=MaxLength",
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='wmkf_testcreationrunid')/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=MaxLength",
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='akoya_request')/Microsoft.Dynamics.CRM.MoneyAttributeMetadata?$select=MinValue,MaxValue",
    "/EntityDefinitions(LogicalName='akoya_request')/ManyToOneRelationships"
      + '?$select=ReferencedEntity,ReferencingAttribute'
      + `&$filter=${encodeURIComponent("ReferencingAttribute eq 'akoya_applicantid'")}`,
  ]);
  const rows = attributeBody.value || [];
  const fields = {};
  for (const row of rows) {
    const requiredLevel = row.RequiredLevel?.Value;
    if (!CREATE_FIELDS.includes(row.LogicalName)
        && requiredLevel !== 'ApplicationRequired'
        && requiredLevel !== 'SystemRequired') continue;
    fields[row.LogicalName] = {
      createable: row.IsValidForCreate === true,
      requiredLevel,
      type: row.AttributeType,
    };
  }
  if (fields.akoya_title) fields.akoya_title.maxLength = titleMetadata.MaxLength;
  if (fields.akoya_purpose) fields.akoya_purpose.maxLength = purposeMetadata.MaxLength;
  if (fields.akoya_fiscalyear) fields.akoya_fiscalyear.maxLength = fiscalYearMetadata.MaxLength;
  if (fields.wmkf_testcreationrunid) fields.wmkf_testcreationrunid.maxLength = runIdMetadata.MaxLength;
  if (fields.akoya_request) {
    fields.akoya_request.minValue = amountMetadata.MinValue;
    fields.akoya_request.maxValue = amountMetadata.MaxValue;
  }
  const lookupTargets = [...new Set((relationshipBody.value || [])
    .map((row) => row.ReferencedEntity)
    .filter(Boolean))];
  if (fields.akoya_applicantid && lookupTargets.length === 1 && lookupTargets[0] === 'account') {
    fields.akoya_applicantid.lookupTarget = 'accounts';
  }
  return { entity: 'akoya_request', fields };
}

function optionLabel(option) {
  return option?.Label?.UserLocalizedLabel?.Label
    || option?.Label?.LocalizedLabels?.find((label) => label.LanguageCode === 1033)?.Label
    || null;
}

async function loadGrantRequestType() {
  const body = await metadataAdapter.getMetadata(
    "/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='akoya_requesttype')"
    + '/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet',
  );
  const matches = (body.OptionSet?.Options || []).filter((option) => optionLabel(option) === 'Grant');
  if (matches.length !== 1 || !Number.isInteger(matches[0].Value)) {
    throw previewError('The sandbox Grant request type could not be resolved uniquely.', 'test_request_grant_type_unavailable', 503);
  }
  return matches[0].Value;
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  getTargetInfo: targetInfo,
  getSharePointTargetInfo: configuredSharePointTargetInfo,
  getRequestById: (requestId) => grantRequestAdapter.getById(requestId, { select: SOURCE_SELECT }),
  findRequestByNumber: (requestNumber) => grantRequestAdapter.findByRequestNumber(requestNumber, { select: SOURCE_SELECT, top: 2 }),
  getRequestSharePointBuckets,
  listFiles: (library, folder, options) => GraphService.listFiles(library, folder, options),
  getDriveId: (library) => GraphService.getDriveId(library),
  getFileMetadataById: (driveId, itemId) => GraphService.getFileMetadataById(driveId, itemId),
  downloadFile: (driveId, itemId) => GraphService.downloadFile(driveId, itemId),
  loadCompilerMetadata,
  loadGrantRequestType,
  findFoundation: () => accountAdapter.queryAccounts({
    select: 'accountid,name,statecode',
    filter: odata.and([odata.eq('name', FOUNDATION_NAME), odata.eqRaw('statecode', 0)]),
    top: 3,
  }),
  randomUUID: () => crypto.randomUUID(),
});

export async function loadTestRequestPreviewSource(
  { requestNumber },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const environment = previewEnvironment(dependencies);
  const source = await resolveSource({ requestNumber }, dependencies);
  const inventory = await discoverDocuments(source, dependencies);
  return {
    success: true,
    mode: 'read-only',
    executionEnabled: false,
    environment,
    source: sourceSummary(source),
    documents: inventory.documents.map(publicDocument),
    inventoryErrors: inventory.errors,
    defaults: {
      recipe: 'basic',
      testLabel: `Basic clone of Request ${source.akoya_requestnum}`,
      fiscalYear: source.akoya_fiscalyear || '',
      meetingDate: source.wmkf_meetingdate ? String(source.wmkf_meetingdate).slice(0, 10) : '',
    },
    filePolicy: {
      approved: false,
      previewReadLimits: TEST_REQUEST_PREVIEW_READ_LIMITS,
    },
  };
}

export async function buildTestRequestAdminPreview(
  { sourceRequestId, selectedDocumentIds, testLabel, fiscalYear, meetingDate },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const environment = previewEnvironment(dependencies);
  const source = await resolveSource({ requestId: sourceRequestId }, dependencies);
  const inventory = await discoverDocuments(source, dependencies);
  const byId = new Map(inventory.documents.map((document) => [document.id, document]));
  const selectedDocuments = [...new Set(selectedDocumentIds)]
    .map((id) => byId.get(id))
    .filter(Boolean);
  assertPreviewReadLimits(selectedDocuments);

  const [sourceDocuments, metadata, requestType, foundationResult] = await Promise.all([
    Promise.all(selectedDocuments.map((document) => hydrateSelectedDocument(document, dependencies))),
    dependencies.loadCompilerMetadata(),
    dependencies.loadGrantRequestType(),
    dependencies.findFoundation(),
  ]);
  const foundations = foundationResult.records || [];
  if (foundations.length !== 1 || foundations[0].name !== FOUNDATION_NAME) {
    throw previewError(
      `Expected exactly one active ${FOUNDATION_NAME} sandbox account.`,
      'test_request_foundation_unavailable',
      503,
    );
  }

  const compiled = compileBasicTestRequestPreview({
    filePolicy: TEST_REQUEST_PREVIEW_READ_LIMITS,
    metadata,
    requestId: dependencies.randomUUID(),
    requestType,
    runId: dependencies.randomUUID(),
    sourceDocuments,
    sourceRequest: source,
    sourceRequestNumber: source.akoya_requestnum,
    testOrganizationId: foundations[0].accountid,
  }, {
    fiscalYear,
    meetingDate,
    recipe: 'basic',
    selectedDocumentIds,
    testLabel,
  });
  const externalBlockers = [
    {
      code: 'FILE_POLICY_APPROVAL_REQUIRED',
      field: 'filePolicy',
      detail: 'The copy executor file-count and byte limits have not been approved. Preview hashing limits are not an execution policy.',
      scope: 'files',
    },
    ...inventory.errors.map((error) => ({
      code: 'SOURCE_INVENTORY_INCOMPLETE',
      field: 'sourceDocuments',
      detail: error.code === 'SOURCE_BUCKET_TRUNCATED'
        ? `A ${error.source} SharePoint bucket exceeded the bounded inventory limit.`
        : `A ${error.source} SharePoint bucket could not be inventoried.`,
      scope: 'files',
    })),
  ];
  const preview = publicCompiledPreview(addBlockingConditions(compiled, externalBlockers));
  const selected = new Set(selectedDocumentIds);

  return {
    success: true,
    mode: 'read-only',
    executionEnabled: false,
    environment,
    source: sourceSummary(source),
    documents: inventory.documents.map((document) => ({
      ...publicDocument(document),
      selected: selected.has(document.id),
      previewOperation: selected.has(document.id)
        ? preview.preview.files.find((file) => file.source.id === document.id)?.operation || 'blocked'
        : 'omitted',
    })),
    filePolicy: {
      approved: false,
      previewReadLimits: TEST_REQUEST_PREVIEW_READ_LIMITS,
    },
    preview,
  };
}

export const TEST_REQUEST_ADMIN_PREVIEW_DEPENDENCIES = DEFAULT_DEPENDENCIES;
