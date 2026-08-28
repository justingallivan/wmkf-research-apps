/**
 * Durable Pre-Site Visit Word producer.
 *
 * The model output is first persisted on a claimed wmkf_requestdocument row.
 * Rendering then reads that row back, uploads one Word item, and atomically
 * activates the row with akoya_request.wmkf_CurrentPreSiteVisit.
 * Proposal-core envelope v3 stores the normalized canonical core plus bounded
 * diagnostics; v2 remains readable. Every projection derives the same warning
 * DTO and envelope/named-field divergence fails closed. Wave 20 correction
 * fields participate in reads and create payloads only behind the literal-on
 * guarded-reopen schema readiness interlock.
 */

import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { fetchCurrentPrompt } from '../prompt-store.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuardedReopenSchemaReady } from '../../utils/guarded-reopen-readiness.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { isGuid } from '../../utils/guid.js';
import { hashGovernedDocxContent } from '../initial-assessment/artifact-service.js';
import {
  generatePreSiteVisitProposalCoreFromInputs,
  loadPreSiteVisitInputs,
  prepareGeneratedCore,
  validateGeneratedCore,
} from './proposal-core-service.js';
import {
  PRE_SITE_VISIT_TEMPLATE,
  renderPreSiteVisitDocx,
} from './docx-renderer.js';
import {
  PROMPT_OUTPUT_SCHEMA,
  PROMPT_VARIABLES,
  PROPOSAL_CORE_KEYS,
  REQUIRED_SYSTEM_ASSERTIONS,
  USER_PROMPT_TEMPLATE,
} from '../../../shared/config/prompts/pre-site-visit-proposal-core.js';
import {
  isPreSiteDistributionSnapshot,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

const GENERATING_LEASE_MS = 15 * 60 * 1000;
const UNCHANGED_RETRY_BLOCKED_CODES = new Set([
  'claude_output_schema_invalid',
  'pre_site_visit_prompt_invalid',
  'pre_site_visit_prompt_empty_section',
  'pre_site_visit_prompt_reserved_token',
  'pre_site_visit_core_reconciliation_required',
  'pre_site_visit_draft_incomplete',
  'pre_site_visit_snapshot_mismatch',
]);
const REQUEST_LINEAGE_SELECT = [
  'akoya_requestid',
  '_wmkf_currentpresitevisit_value',
].join(',');
const SECTION_FIELDS = Object.freeze({
  executiveSummary: 'wmkf_presiteexecutivesummary',
  impactOverview: 'wmkf_presiteimpactoverview',
  methodologyOverview: 'wmkf_presitemethodologyoverview',
  personnelOverview: 'wmkf_presitepersonneloverview',
  keckFundingRationale: 'wmkf_presitekeckfundingrationale',
  backgroundAndImpact: 'wmkf_presitebackgroundandimpact',
  detailedMethodology: 'wmkf_presitedetailedmethodology',
  personnelDetails: 'wmkf_presitepersonneldetails',
});

const DEFAULT_DEPENDENCIES = Object.freeze({
  loadInputs: loadPreSiteVisitInputs,
  getCurrentPrompt: fetchCurrentPrompt,
  runProposalCore: generatePreSiteVisitProposalCoreFromInputs,
  renderDocx: renderPreSiteVisitDocx,
  hashDocx: hashGovernedDocxContent,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, {
    select: REQUEST_LINEAGE_SELECT,
  }),
  getBuckets: getRequestSharePointBuckets,
  findByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  findByRequest: requestDocumentAdapter.findByRequest,
  createDocument: requestDocumentAdapter.create,
  updateDocument: requestDocumentAdapter.update,
  commitChangeset: runChangeset,
  ensureFolderPath: (...args) => GraphService.ensureFolderPath(...args),
  uploadFile: (...args) => GraphService.uploadFile(...args),
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  deleteFile: (...args) => GraphService.deleteFile(...args),
  newClaimToken: () => crypto.randomUUID(),
  isGuardedReopenSchemaReady,
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sameNullableId(left, right) {
  if (!left && !right) return true;
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function sanitizeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function sanitizeError(error) {
  return {
    code: String(error?.code || error?.status || 'pre_site_visit_failed').slice(0, 100),
    message: String(error?.message || 'Pre-Site Visit generation failed')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
      .slice(0, 2000),
  };
}

function conditionalOptions(row, actingUserSystemId = null) {
  if (!row?._etag) {
    throw new ServiceHttpError('Pre-Site request-document row is missing its write fence.', {
      httpStatus: 500,
    });
  }
  return {
    ifMatch: row._etag,
    ...(actingUserSystemId ? { actingUserSystemId } : {}),
  };
}

function parseJsonField(value, label) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new ServiceHttpError(`The ${label} JSON is invalid.`, { httpStatus: 500 });
  }
}

function validateNarrativePrompt(prompt) {
  const promptId = prompt?.wmkf_ai_promptid;
  const promptVersion = Number(prompt?.wmkf_promptversion);
  const variables = parseJsonField(prompt?.wmkf_ai_promptvariables, 'current Pre-Site prompt variables');
  const declared = (variables?.variables || []).map((variable) => variable?.name);
  const names = new Set(declared);
  const required = ['request_context_json', 'proposal_text'];
  const missing = required.filter((name) => !names.has(name));
  const unexpected = declared.filter((name) => !required.includes(name));
  let outputSchema = null;
  try {
    outputSchema = parseJsonField(
      prompt?.wmkf_ai_promptoutputschema,
      'current Pre-Site prompt output schema',
    );
  } catch {
    outputSchema = null;
  }
  const expectedVariables = JSON.stringify(PROMPT_VARIABLES);
  const expectedOutputSchema = JSON.stringify(PROMPT_OUTPUT_SCHEMA);
  const systemPrompt = String(prompt?.wmkf_ai_systemprompt || '');
  const promptBody = String(prompt?.wmkf_ai_promptbody || '');
  const contractMatches = JSON.stringify(variables) === expectedVariables
    && JSON.stringify(outputSchema) === expectedOutputSchema
    && promptBody === USER_PROMPT_TEMPLATE
    && REQUIRED_SYSTEM_ASSERTIONS.every((assertion) => systemPrompt.includes(assertion));
  if (!isGuid(promptId) || !Number.isInteger(promptVersion) || promptVersion < 1
      || missing.length || unexpected.length || names.size !== required.length
      || declared.length !== required.length || !contractMatches) {
    throw new ServiceHttpError(
      'The current Pre-Site prompt is not a published narrative-only prompt version.',
      {
        httpStatus: 409,
        code: 'pre_site_visit_prompt_not_ready',
        body: {
          error: 'The current Pre-Site prompt is not a published narrative-only prompt version.',
          code: 'pre_site_visit_prompt_not_ready',
        },
      },
    );
  }
  return {
    promptId: promptId.toLowerCase(),
    promptName: String(prompt.wmkf_ai_promptname || PRE_SITE_VISIT_CONTRACT.promptName),
    promptVersion,
  };
}

function validateTemplateContract() {
  if (PRE_SITE_VISIT_TEMPLATE.id !== PRE_SITE_VISIT_CONTRACT.templateId
    || String(PRE_SITE_VISIT_TEMPLATE.version) !== PRE_SITE_VISIT_CONTRACT.templateVersion) {
    throw new ServiceHttpError('The Pre-Site renderer and artifact template contracts have drifted.', {
      httpStatus: 500,
      code: 'pre_site_visit_template_contract_drift',
    });
  }
}

function parseCleanupQueue(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch {
    throw new ServiceHttpError('Pre-Site SharePoint cleanup state is unreadable.', {
      httpStatus: 500,
    });
  }
}

function sourceManifest(source) {
  const manifest = {
    role: 'proposalNarrative',
    filename: source?.filename || null,
    siteId: source?.siteId || null,
    driveId: source?.driveId || null,
    itemId: source?.itemId || null,
    versionId: source?.versionId || null,
    contentHash: source?.contentHash || null,
  };
  if (!manifest.filename || !manifest.siteId || !manifest.driveId || !manifest.itemId
    || !manifest.versionId || !/^[a-f0-9]{64}$/i.test(manifest.contentHash || '')) {
    throw new ServiceHttpError('Pre-Site proposal source identity is incomplete.', {
      httpStatus: 409,
      code: 'pre_site_visit_source_identity_incomplete',
    });
  }
  return [manifest];
}

export function buildPreSiteVisitInputSnapshot(inputs) {
  const { context } = inputs;
  return {
    schemaVersion: 3,
    request: {
      requestId: context.requestId,
      requestNumber: context.requestNumber,
      projectTitle: context.projectTitle,
      applicantInstitution: context.applicantInstitution,
      cityState: context.documentFields.cityState,
      internalProgram: context.documentFields.internalProgram,
      meetingDate: context.documentFields.meetingDate,
      requestedAmount: context.documentFields.requestedAmount,
      invitedAmount: context.documentFields.invitedAmount,
      totalProjectBudget: context.documentFields.totalProjectBudget,
      programDirector: context.documentFields.programDirector,
      institutionalFundingHistory: context.documentFields.institutionalFundingHistory,
      projectPeriod: context.projectPeriod,
      personnel: context.personnel,
    },
    proposalSources: sourceManifest(inputs.proposalNarrative),
  };
}

export function buildPreSiteVisitIdentity({
  requestId,
  inputSnapshot,
  promptIdentity,
  reopenCycleId = null,
}) {
  const inputFingerprint = sha256(JSON.stringify(inputSnapshot));
  const generationKey = sha256(JSON.stringify({
    requestId: requestId.toLowerCase(),
    artifactType: PRE_SITE_VISIT_CONTRACT.artifactType,
    inputFingerprint,
    promptId: promptIdentity.promptId,
    promptName: promptIdentity.promptName,
    promptVersion: promptIdentity.promptVersion,
    templateId: PRE_SITE_VISIT_CONTRACT.templateId,
    templateVersion: PRE_SITE_VISIT_CONTRACT.templateVersion,
    ...(reopenCycleId ? { reopenCycleId: String(reopenCycleId).toLowerCase() } : {}),
  }));
  return { inputFingerprint, generationKey };
}

function fileNameFor(requestNumber, generationKey, claimToken) {
  return `${sanitizeFilePart(requestNumber)} Pre-Site Visit `
    + `${generationKey.slice(0, 8)}-${claimToken.slice(0, 8)}.docx`;
}

function assertPreSiteWordRow(row) {
  if (!row
    || row.wmkf_artifacttype !== REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
    || row.wmkf_contenttype !== PRE_SITE_VISIT_CONTRACT.contentType) {
    throw new ServiceHttpError('Request-document row is not a governed Pre-Site Word document.', {
      httpStatus: 500,
    });
  }
  if (!Object.values(REQUEST_DOCUMENT_OPERATION_STATUS).includes(row.wmkf_operationstatus)
    || !Object.values(REQUEST_DOCUMENT_LIFECYCLE_STATE).includes(row.wmkf_lifecyclestate)) {
    throw new ServiceHttpError('Pre-Site request-document row has an unknown state.', {
      httpStatus: 500,
    });
  }
  return row;
}

const WARNING_MESSAGES = Object.freeze({
  section_over_target: 'A generated section is longer than suggested and may need editing.',
  long_form_over_target: 'Background and Methodology may require layout editing.',
  paragraphs_over_target: 'A generated section has more paragraphs than suggested.',
  personnel_name_not_matched: 'A roster name was not found exactly in a Personnel section.',
  proposal_input_truncated: 'Claude received a truncated proposal input; review the draft for omitted material.',
  extra_output_key_dropped: 'Claude returned an undeclared field that was excluded from the draft.',
  unknown_review_warning: 'The draft completed with a review warning.',
  funding_history_manual: 'Institutional Funding History was not filled automatically (this document was generated before the Dataverse fill). Check that it is completed in Word; this note stays until the document is regenerated.',
});
const SECTION_LABELS = Object.freeze({
  executiveSummary: 'Executive Summary',
  impactOverview: 'Impact Overview',
  methodologyOverview: 'Methodology Overview',
  personnelOverview: 'Personnel Overview',
  keckFundingRationale: 'Keck Funding Rationale',
  backgroundAndImpact: 'Background and Impact',
  detailedMethodology: 'Detailed Methodology',
  personnelDetails: 'Personnel Details',
});

function validateDiagnostics(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new ServiceHttpError('Pre-Site proposal-core diagnostics require reconciliation.', {
      httpStatus: 500,
      code: 'pre_site_visit_diagnostics_invalid',
    });
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(entry.code)) {
      throw new ServiceHttpError('Pre-Site proposal-core diagnostics require reconciliation.', {
        httpStatus: 500,
        code: 'pre_site_visit_diagnostics_invalid',
      });
    }
    const diagnostic = { code: entry.code };
    for (const key of [
      'section', 'rosterDisplayName', 'path',
      'observedWords', 'observedChars', 'targetWords', 'targetChars',
      'observed', 'target', 'originalChars', 'transmittedChars',
    ]) {
      if (typeof entry[key] === 'string') diagnostic[key] = entry[key].slice(0, 200);
      if (Number.isFinite(entry[key])) diagnostic[key] = Number(entry[key]);
      if (entry[key] === null) diagnostic[key] = null;
    }
    return diagnostic;
  });
}

function diagnosticsForRow(row) {
  if (!row.wmkf_presiteproposalcorejson) return [];
  const coreEnvelope = parseJsonField(row.wmkf_presiteproposalcorejson, 'Pre-Site proposal core');
  if (![2, 3].includes(coreEnvelope?.schemaVersion)) {
    throw new ServiceHttpError('The Pre-Site proposal-core envelope version is unsupported.', {
      httpStatus: 409,
      code: 'pre_site_visit_core_version_unsupported',
    });
  }
  const inputSnapshot = row.wmkf_presiteinputsnapshotjson
    ? parseJsonField(row.wmkf_presiteinputsnapshotjson, 'Pre-Site input snapshot')
    : null;
  // Ready rows persisted before S467 carry v2 snapshots (no funding history);
  // v3 adds it. Both remain readable for warnings/diagnostics.
  if (![2, 3].includes(inputSnapshot?.schemaVersion)) {
    throw new ServiceHttpError('The Pre-Site input snapshot version is unsupported.', {
      httpStatus: 409,
      code: 'pre_site_visit_snapshot_version_unsupported',
    });
  }
  const personnelNames = (inputSnapshot.request?.personnel || []).map((person) => person?.name);
  const prepared = prepareGeneratedCore(coreEnvelope.proposalCore, { personnelNames });
  const namedCore = validateGeneratedCore(
    Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [key, row[SECTION_FIELDS[key]]])),
  );
  if (JSON.stringify(namedCore) !== JSON.stringify(prepared.proposalCore)) {
    throw new ServiceHttpError('Pre-Site proposal-core fields do not match the audited envelope.', {
      httpStatus: 409,
      code: 'pre_site_visit_core_reconciliation_required',
    });
  }
  const stored = coreEnvelope.schemaVersion === 3
    ? validateDiagnostics(coreEnvelope.diagnostics)
    : [];
  // v2 documents still carry the [[AI:InstitutionalFundingHistory]] placeholder
  // in Word; surface that as a per-document edit task instead of letting the
  // generic help text imply it was filled.
  const legacy = inputSnapshot.schemaVersion === 2 ? [{ code: 'funding_history_manual' }] : [];
  const unique = new Map();
  for (const diagnostic of [...prepared.diagnostics, ...stored, ...legacy]) {
    unique.set(JSON.stringify(diagnostic), diagnostic);
  }
  return [...unique.values()];
}

function projectWarnings(row) {
  return diagnosticsForRow(row).map((diagnostic) => {
    const known = Object.prototype.hasOwnProperty.call(WARNING_MESSAGES, diagnostic.code);
    const code = known ? diagnostic.code : 'unknown_review_warning';
    let message = WARNING_MESSAGES[code];
    const sectionLabel = SECTION_LABELS[diagnostic.section];
    if (code === 'section_over_target' && sectionLabel) {
      message = `${sectionLabel} is longer than suggested and may need editing.`;
    } else if (code === 'paragraphs_over_target' && sectionLabel) {
      message = `${sectionLabel} has more paragraphs than suggested.`;
    } else if (code === 'personnel_name_not_matched' && sectionLabel) {
      message = `A roster name was not found exactly in ${sectionLabel}.`;
    }
    return {
      ...diagnostic,
      code,
      message,
    };
  });
}

export function projectPreSiteVisitArtifact(row) {
  assertPreSiteWordRow(row);
  const isReopenAuditEvent = Boolean(row.wmkf_reopenreasoncode);
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    operationStatus: row.wmkf_operationstatus,
    lifecycleState: row.wmkf_lifecyclestate,
    retryable: row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
      && !UNCHANGED_RETRY_BLOCKED_CODES.has(row.wmkf_lasterrorcode),
    warnings: projectWarnings(row),
    file: row.wmkf_sharepointitemid ? {
      siteId: row.wmkf_sharepointsiteid,
      driveId: row.wmkf_sharepointdriveid,
      itemId: row.wmkf_sharepointitemid,
      webUrl: row.wmkf_sharepointweburl,
      versionId: row.wmkf_sharepointversionid,
      eTag: row.wmkf_sharepointetag,
      folderPath: row.wmkf_sharepointfolderpath,
      name: row.wmkf_filename,
      size: row.wmkf_filesize,
      lastModified: row.wmkf_sharepointlastmodified,
    } : null,
    provenance: {
      inputFingerprint: row.wmkf_inputfingerprint,
      renderInputFingerprint: row.wmkf_renderinputfingerprint,
      promptName: row.wmkf_promptname,
      promptVersion: row.wmkf_promptversion,
      promptId: row._wmkf_aiprompt_value || null,
      runId: row._wmkf_airun_value || null,
      templateId: row.wmkf_templateid,
      templateVersion: row.wmkf_templateversion,
      contentHash: row.wmkf_contenthash,
    },
    milestone: row.wmkf_milestoneversionid ? {
      versionId: row.wmkf_milestoneversionid,
      contentHash: row.wmkf_milestonecontenthash || null,
      createdAt: row.wmkf_milestonecreatedat || null,
    } : null,
    correction: row.wmkf_reopencycleid ? {
      cycleId: row.wmkf_reopencycleid,
      reasonCode: row.wmkf_reopenreasoncode || null,
      reasonNote: row.wmkf_reopenreasonnote || null,
      sourceArtifactId: row._wmkf_sourcedocument_value || null,
      sourceVersionId: row.wmkf_sourceversionid || null,
      sourceContentHash: row.wmkf_sourcecontenthash || null,
      actorId: isReopenAuditEvent ? row._createdby_value || null : null,
      actorName: isReopenAuditEvent ? row._createdby_value_formatted || null : null,
      createdAt: isReopenAuditEvent ? row.createdon || null : null,
    } : null,
    lastError: row.wmkf_lasterrormessage ? {
      code: row.wmkf_lasterrorcode || null,
      message: row.wmkf_lasterrormessage,
      at: row.wmkf_lastfailedat || null,
      supportReference: row._wmkf_airun_value || row.wmkf_requestdocumentid,
    } : null,
  };
}

function projectReopenHistory(rows) {
  const byId = new Map(rows.map((row) => [
    String(row.wmkf_requestdocumentid || '').toLowerCase(),
    row,
  ]));
  return rows
    .filter((row) => row.wmkf_reopencycleid && row.wmkf_reopenreasoncode)
    .sort((left, right) => Date.parse(right.createdon || '') - Date.parse(left.createdon || ''))
    .map((row) => {
      const artifact = projectPreSiteVisitArtifact(row);
      const source = byId.get(String(row._wmkf_sourcedocument_value || '').toLowerCase()) || null;
      const cleanupRequired = [
        ...parseCleanupQueue(row.wmkf_orphancleanupjson),
        ...parseCleanupQueue(row.wmkf_orphancleanupoverflowjson),
      ];
      return {
        artifactId: artifact.artifactId,
        operationStatus: artifact.operationStatus,
        lifecycleState: artifact.lifecycleState,
        outcome: cleanupRequired.length > 0
          ? 'needs_reconciliation'
          : artifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
          ? 'completed'
          : artifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
            ? 'failed'
            : artifact.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
              ? 'in_progress'
              : 'needs_reconciliation',
        correction: artifact.correction,
        file: artifact.file,
        cleanupRequired,
        source: source ? {
          artifactId: source.wmkf_requestdocumentid,
          fileName: source.wmkf_filename || null,
          milestone: source.wmkf_milestoneversionid ? {
            versionId: source.wmkf_milestoneversionid,
            contentHash: source.wmkf_milestonecontenthash || null,
            createdAt: source.wmkf_milestonecreatedat || null,
          } : null,
        } : null,
      };
    });
}

/** Read the current Ready Word row and newest non-current operation without side effects. */
export async function getPreSiteVisitArtifactStatus(
  { requestId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('A valid requestId is required.', {
      httpStatus: 400,
      code: 'invalid_request_id',
    });
  }

  const [request, result] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    }),
  ]);
  if (!request || String(request.akoya_requestid || '').toLowerCase() !== requestId.toLowerCase()) {
    throw new ServiceHttpError('The Pre-Site request could not be resolved.', {
      httpStatus: 404,
      code: 'pre_site_visit_request_not_found',
    });
  }

  const rows = (result?.records || []).filter((row) => (
    String(row?._wmkf_request_value || '').toLowerCase() === requestId.toLowerCase()
    && row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT
  ));
  const activeRows = rows.filter((row) => (
    row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  const unknownContent = activeRows.find((row) => (
    ![PRE_SITE_VISIT_CONTRACT.contentType, 'application/pdf'].includes(row.wmkf_contenttype)
  ));
  if (unknownContent) {
    throw new ServiceHttpError('An active Pre-Site artifact has an unknown content type.', {
      httpStatus: 409,
      code: 'pre_site_visit_content_type_unknown',
    });
  }

  const wordRows = activeRows.filter((row) => (
    row.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && !isPreSiteDistributionSnapshot(row)
  ));
  const pointerId = request._wmkf_currentpresitevisit_value
    ? String(request._wmkf_currentpresitevisit_value).toLowerCase()
    : null;
  let currentRow = null;
  let currentArtifact = null;
  if (pointerId) {
    currentRow = wordRows.find((row) => (
      String(row.wmkf_requestdocumentid || '').toLowerCase() === pointerId
    ));
    if (!currentRow
      || currentRow.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      throw new ServiceHttpError('The current Pre-Site request pointer requires reconciliation.', {
        httpStatus: 409,
        code: 'pre_site_visit_pointer_invalid',
      });
    }
    currentArtifact = projectPreSiteVisitArtifact(currentRow);
  } else if (wordRows.some((row) => row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY)) {
    throw new ServiceHttpError('A Ready Pre-Site Word document has no current request pointer.', {
      httpStatus: 409,
      code: 'pre_site_visit_pointer_missing',
    });
  }

  const currentCreatedAt = currentRow
    ? Date.parse(currentRow.createdon || '')
    : null;
  const pendingRow = wordRows.find((row) => {
    if (String(row.wmkf_requestdocumentid || '').toLowerCase() === pointerId
      || row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      return false;
    }
    if (!currentArtifact) return true;
    const candidateCreatedAt = Date.parse(row.createdon || '');
    return Number.isFinite(currentCreatedAt)
      && Number.isFinite(candidateCreatedAt)
      && candidateCreatedAt > currentCreatedAt;
  });
  return {
    currentArtifact,
    pendingArtifact: pendingRow ? projectPreSiteVisitArtifact(pendingRow) : null,
    reopenHistory: projectReopenHistory(rows),
  };
}

async function rereadByGenerationKey(generationKey, dependencies) {
  const result = await dependencies.findByGenerationKey(generationKey);
  const rows = result?.records || [];
  if (rows.length > 1) {
    throw new ServiceHttpError('Duplicate Pre-Site generation keys require reconciliation.', {
      httpStatus: 500,
    });
  }
  return rows[0] || null;
}

function generatingLeaseActive(row) {
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return false;
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  return Number.isFinite(modifiedAt) && Date.now() - modifiedAt < GENERATING_LEASE_MS;
}

async function assertOwnedClaim(generationKey, claimToken, dependencies) {
  const row = await rereadByGenerationKey(generationKey, dependencies);
  assertPreSiteWordRow(row);
  if (row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) {
    throw new ServiceHttpError('Pre-Site generation claim was superseded.', {
      httpStatus: 409,
      code: 'claim_lost',
      body: { error: 'Pre-Site generation claim was superseded.', code: 'claim_lost' },
    });
  }
  if (parseCleanupQueue(row.wmkf_orphancleanupoverflowjson).length > 0) {
    throw new ServiceHttpError('Pre-Site generation is blocked by unresolved SharePoint cleanup.', {
      httpStatus: 409,
      code: 'orphan_cleanup_required',
    });
  }
  return row;
}

async function claimExisting(row, actingUserSystemId, dependencies) {
  assertPreSiteWordRow(row);
  if (generatingLeaseActive(row)) return null;
  if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
    && UNCHANGED_RETRY_BLOCKED_CODES.has(row.wmkf_lasterrorcode)) {
    throw new ServiceHttpError(
      'This draft attempt requires a prompt or application change before retrying.',
      {
        httpStatus: 409,
        code: 'pre_site_visit_retry_requires_change',
        body: {
          error: 'This draft attempt requires a prompt or application change before retrying.',
          code: 'pre_site_visit_retry_requires_change',
          artifactId: row.wmkf_requestdocumentid,
          runId: row._wmkf_airun_value || null,
        },
      },
    );
  }
  if (parseCleanupQueue(row.wmkf_orphancleanupoverflowjson).length > 0) {
    throw new ServiceHttpError('Pre-Site generation is blocked by unresolved SharePoint cleanup.', {
      httpStatus: 409,
      code: 'orphan_cleanup_required',
    });
  }
  const claimToken = dependencies.newClaimToken();
  try {
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_claimtoken: claimToken,
      wmkf_attemptcount: Number(row.wmkf_attemptcount || 0) + 1,
      wmkf_lasterrorcode: null,
      wmkf_lasterrormessage: null,
      wmkf_lastfailedat: null,
    }, conditionalOptions(row, actingUserSystemId));
    return claimToken;
  } catch (error) {
    if (error?.status === 412) return null;
    throw error;
  }
}

async function markFailedIfOwned(generationKey, claimToken, patch, actingUserSystemId, dependencies) {
  const row = await rereadByGenerationKey(generationKey, dependencies).catch(() => null);
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    || row.wmkf_claimtoken !== claimToken) return false;
  try {
    await dependencies.updateDocument(
      row.wmkf_requestdocumentid,
      patch,
      conditionalOptions(row, actingUserSystemId),
    );
    return true;
  } catch (error) {
    if (error?.status === 412) return false;
    throw error;
  }
}

async function activeRequestBucket(requestId, requestNumber, dependencies) {
  const buckets = await dependencies.getBuckets(requestId, requestNumber, {
    requireResolvedParents: true,
  });
  const active = (buckets || []).filter((bucket) => (
    bucket.source === 'dynamics'
    && String(bucket.library || '').toLowerCase() === 'akoya_request'
  ));
  if (active.length !== 1) {
    throw new ServiceHttpError(
      `Expected exactly one active akoya_request SharePoint location; found ${active.length}.`,
      { httpStatus: 409 },
    );
  }
  return active[0];
}

function proposalCorePatch(proposalCore) {
  return Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [SECTION_FIELDS[key], proposalCore[key]]));
}

function documentFieldsFromSnapshot(snapshot) {
  const request = snapshot.request;
  return {
    institutionName: request.applicantInstitution,
    cityState: request.cityState,
    internalProgram: request.internalProgram,
    projectTitle: request.projectTitle,
    meetingDate: request.meetingDate,
    requestedAmount: request.requestedAmount,
    programDirector: request.programDirector,
    invitedAmount: request.invitedAmount,
    totalProjectBudget: request.totalProjectBudget,
    institutionalFundingHistory: request.institutionalFundingHistory,
  };
}

function persistedDraft(row, expectedInputSnapshot) {
  const hasCore = Boolean(row.wmkf_presiteproposalcorejson);
  const hasInputs = Boolean(row.wmkf_presiteinputsnapshotjson);
  // A failed Executor attempt may be linked without having produced a usable
  // draft. That state is retryable: only a partial core/snapshot pair is
  // corruption. Once both snapshots exist, a successful run link is required.
  if (!hasCore && !hasInputs) return null;
  if (!hasCore || !hasInputs || !row._wmkf_airun_value) {
    throw new ServiceHttpError('Pre-Site draft persistence is incomplete and requires reconciliation.', {
      httpStatus: 409,
      code: 'pre_site_visit_draft_incomplete',
    });
  }
  const coreEnvelope = parseJsonField(row.wmkf_presiteproposalcorejson, 'Pre-Site proposal core');
  const inputSnapshot = parseJsonField(row.wmkf_presiteinputsnapshotjson, 'Pre-Site input snapshot');
  // Snapshot v3 (S467) added institutionalFundingHistory. The fingerprint is
  // part of the generation key, so a v2 draft can never be reached from a new
  // key; only the current shape is accepted here.
  if (![2, 3].includes(coreEnvelope?.schemaVersion) || inputSnapshot?.schemaVersion !== 3
    || JSON.stringify(inputSnapshot) !== JSON.stringify(expectedInputSnapshot)) {
    throw new ServiceHttpError('Pre-Site persisted snapshots do not match the claimed generation.', {
      httpStatus: 409,
      code: 'pre_site_visit_snapshot_mismatch',
    });
  }
  const personnelNames = (inputSnapshot.request.personnel || []).map((person) => person.name);
  const preparedEnvelope = prepareGeneratedCore(coreEnvelope.proposalCore, {
    personnelNames,
  });
  const namedCore = validateGeneratedCore(
    Object.fromEntries(PROPOSAL_CORE_KEYS.map((key) => [key, row[SECTION_FIELDS[key]]])),
  );
  if (JSON.stringify(namedCore) !== JSON.stringify(preparedEnvelope.proposalCore)) {
    throw new ServiceHttpError('Pre-Site proposal-core fields do not match the audited envelope.', {
      httpStatus: 409,
      code: 'pre_site_visit_core_reconciliation_required',
    });
  }
  return {
    proposalCore: namedCore,
    diagnostics: [...new Map([
      ...preparedEnvelope.diagnostics,
      ...(coreEnvelope.schemaVersion === 3 ? validateDiagnostics(coreEnvelope.diagnostics) : []),
    ].map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values()],
    inputSnapshot,
    documentFields: documentFieldsFromSnapshot(inputSnapshot),
    personnelNames,
  };
}

function renderFingerprint(draft) {
  return sha256(JSON.stringify({
    templateId: PRE_SITE_VISIT_CONTRACT.templateId,
    templateVersion: PRE_SITE_VISIT_CONTRACT.templateVersion,
    documentFields: draft.documentFields,
    proposalCore: draft.proposalCore,
    personnelNames: draft.personnelNames,
  }));
}

async function verifyReadyLineage(generationKey, targetId, requestId, dependencies) {
  const [target, request, result] = await Promise.all([
    rereadByGenerationKey(generationKey, dependencies),
    dependencies.getRequest(requestId),
    dependencies.findByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    }),
  ]);
  const activeReadyWords = (result?.records || []).filter((row) => (
    row.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && !isPreSiteDistributionSnapshot(row)
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  if (target
    && target.wmkf_requestdocumentid === targetId
    && target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && target.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
    && target.wmkf_sharepointdriveid
    && target.wmkf_sharepointitemid
    && request?._wmkf_currentpresitevisit_value === targetId
    && activeReadyWords.length === 1
    && activeReadyWords[0].wmkf_requestdocumentid === targetId) return target;
  return null;
}

async function commitReadyLineage(
  row,
  { metadata = null, claimToken = null, actingUserSystemId = null } = {},
  dependencies,
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const target = claimToken
      ? await assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies)
      : assertPreSiteWordRow(await rereadByGenerationKey(row.wmkf_generationkey, dependencies));
    const result = await dependencies.findByRequest(target._wmkf_request_value, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    });
    const request = await dependencies.getRequest(target._wmkf_request_value);
    const rows = result?.records || [];
    const pointerId = request?._wmkf_currentpresitevisit_value || null;
    if (pointerId) {
      const pointer = rows.find((candidate) => candidate.wmkf_requestdocumentid === pointerId);
      if (!pointer
        || pointer._wmkf_request_value !== target._wmkf_request_value
        || pointer.wmkf_contenttype !== PRE_SITE_VISIT_CONTRACT.contentType
        || pointer.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
        || pointer.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) {
        throw new ServiceHttpError('The current Pre-Site request pointer requires reconciliation.', {
          httpStatus: 409,
          code: 'pre_site_visit_pointer_invalid',
        });
      }
      if (pointer.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
        throw new ServiceHttpError(
          'This Word draft became the Site Visit workspace while generation was running.',
          {
            httpStatus: 409,
            code: 'pre_site_visit_regeneration_locked',
          },
        );
      }
      if (!sameNullableId(pointer.wmkf_reopencycleid, target.wmkf_reopencycleid)) {
        throw new ServiceHttpError(
          'The current Pre-Site correction cycle changed while generation was running.',
          {
            httpStatus: 409,
            code: 'pre_site_visit_correction_cycle_changed',
          },
        );
      }
    }
    const unknownActiveReady = rows.some((candidate) => (
      candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && ![PRE_SITE_VISIT_CONTRACT.contentType, 'application/pdf'].includes(candidate.wmkf_contenttype)
    ));
    if (unknownActiveReady) {
      throw new ServiceHttpError('An active Pre-Site artifact has an unknown content type.', {
        httpStatus: 409,
        code: 'pre_site_visit_content_type_unknown',
      });
    }
    const priorReady = rows.filter((candidate) => (
      candidate.wmkf_requestdocumentid !== target.wmkf_requestdocumentid
      && candidate.wmkf_contenttype === PRE_SITE_VISIT_CONTRACT.contentType
      && !isPreSiteDistributionSnapshot(candidate)
      && candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    ));
    if (!metadata
      && target.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && target.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && priorReady.length === 0
      && request?._wmkf_currentpresitevisit_value === target.wmkf_requestdocumentid) return target;

    const operations = [
      ...priorReady.map((prior) => ({
        method: 'PATCH',
        entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
        key: prior.wmkf_requestdocumentid,
        body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
        ifMatch: conditionalOptions(prior).ifMatch,
      })),
      {
        method: 'PATCH',
        entitySet: requestDocumentAdapter.ENTITY_SET_NAME,
        key: target.wmkf_requestdocumentid,
        body: {
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
          wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
          wmkf_lasterrorcode: null,
          wmkf_lasterrormessage: null,
          wmkf_lastfailedat: null,
          ...(metadata ? {
            wmkf_sharepointsiteid: metadata.siteId,
            wmkf_sharepointdriveid: metadata.driveId,
            wmkf_sharepointitemid: metadata.id,
            wmkf_sharepointweburl: metadata.webUrl,
            wmkf_sharepointversionid: metadata.versionId,
            wmkf_sharepointetag: metadata.eTag,
            wmkf_filesize: metadata.size,
            wmkf_sharepointlastmodified: metadata.lastModified,
          } : {}),
        },
        ifMatch: conditionalOptions(target).ifMatch,
      },
      {
        method: 'PATCH',
        entitySet: grantRequestAdapter.ENTITY_SET_NAME,
        key: target._wmkf_request_value,
        body: {
          'wmkf_CurrentPreSiteVisit@odata.bind':
            `/wmkf_requestdocuments(${target.wmkf_requestdocumentid})`,
        },
        ifMatch: conditionalOptions(request).ifMatch,
      },
    ];
    try {
      await dependencies.commitChangeset(operations, {
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      });
    } catch (error) {
      if (error?.status === 412 || /\b412\b/.test(error?.message || '')) continue;
      const committed = await verifyReadyLineage(
        row.wmkf_generationkey,
        target.wmkf_requestdocumentid,
        target._wmkf_request_value,
        dependencies,
      ).catch(() => null);
      if (committed) return committed;
      throw error;
    }
    const ready = await verifyReadyLineage(
      row.wmkf_generationkey,
      target.wmkf_requestdocumentid,
      target._wmkf_request_value,
      dependencies,
    );
    if (ready) return ready;
    throw new Error('Pre-Site registry read-back did not confirm the current Ready Word item.');
  }
  throw new ServiceHttpError('Pre-Site activation conflicted repeatedly; retry is safe.', {
    httpStatus: 409,
    code: 'ready_lineage_conflict',
  });
}

async function recordCleanup(row, metadata, reason, error, actingUserSystemId, dependencies) {
  const current = await rereadByGenerationKey(row.wmkf_generationkey, dependencies);
  if (!current) return;
  const existing = parseCleanupQueue(current.wmkf_orphancleanupjson);
  const overflow = parseCleanupQueue(current.wmkf_orphancleanupoverflowjson);
  if ([...existing, ...overflow].some((item) => (
    item.driveId === metadata.driveId && item.itemId === metadata.id
  ))) return;
  const entry = {
    driveId: metadata.driveId,
    itemId: metadata.id,
    name: metadata.name || null,
    recordedAt: new Date().toISOString(),
    reason,
    error: sanitizeError(error).message.slice(0, 1000),
  };
  const primary = JSON.stringify([...existing, entry]);
  const patch = primary.length <= 10000 && overflow.length === 0
    ? { wmkf_orphancleanupjson: primary }
    : { wmkf_orphancleanupoverflowjson: JSON.stringify([...overflow, entry]) };
  await dependencies.updateDocument(
    current.wmkf_requestdocumentid,
    patch,
    conditionalOptions(current, actingUserSystemId),
  );
}

async function recoverUploadedFile(row, claimToken, actingUserSystemId, dependencies) {
  if (!row.wmkf_contenthash || !row.wmkf_sharepointfolderpath || !row.wmkf_filename) return null;
  const metadata = await dependencies.getFileMetadataByPath(
    'akoya_request',
    row.wmkf_sharepointfolderpath,
    row.wmkf_filename,
  );
  if (!metadata) return null;
  const downloaded = await dependencies.downloadFile(metadata.driveId, metadata.id);
  const actualHash = await dependencies.hashDocx(downloaded.buffer).catch(() => null);
  if (actualHash !== row.wmkf_contenthash) {
    await recordCleanup(
      row,
      metadata,
      'content_hash_mismatch_retained',
      new Error('Existing Pre-Site upload does not match the governed render.'),
      actingUserSystemId,
      dependencies,
    );
    return null;
  }
  return commitReadyLineage(row, { metadata, claimToken, actingUserSystemId }, dependencies);
}

async function prepareFreshFilename(row, requestNumber, claimToken, actingUserSystemId, dependencies) {
  const current = await assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies);
  await dependencies.updateDocument(current.wmkf_requestdocumentid, {
    wmkf_filename: fileNameFor(requestNumber, row.wmkf_generationkey, claimToken),
    wmkf_contenthash: null,
    wmkf_renderinputfingerprint: null,
    wmkf_sharepointsiteid: null,
    wmkf_sharepointdriveid: null,
    wmkf_sharepointitemid: null,
    wmkf_sharepointweburl: null,
    wmkf_sharepointversionid: null,
    wmkf_sharepointetag: null,
    wmkf_filesize: null,
    wmkf_sharepointlastmodified: null,
  }, conditionalOptions(current, actingUserSystemId));
  return assertOwnedClaim(row.wmkf_generationkey, claimToken, dependencies);
}

/** Generate, recover, or safely reuse one governed Pre-Site Word draft. */
export async function generatePreSiteVisitArtifact(
  { requestId, actingUserSystemId = null },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('A valid requestId is required.', {
      httpStatus: 400,
      code: 'invalid_request_id',
    });
  }

  // Promotion makes the current Word item the staff-owned Site Visit workspace.
  // Check that lifecycle before loading inputs, resolving the prompt, claiming a
  // row, calling Claude, rendering, or touching SharePoint.
  const currentStatus = await getPreSiteVisitArtifactStatus({ requestId }, dependencies);
  if (currentStatus.currentArtifact
    && currentStatus.currentArtifact.lifecycleState !== REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT) {
    throw new ServiceHttpError(
      'This Word draft is already the Site Visit workspace and can no longer be regenerated.',
      {
        httpStatus: 409,
        code: 'pre_site_visit_regeneration_locked',
        body: {
          error: 'This Word draft is already the Site Visit workspace and can no longer be regenerated.',
          code: 'pre_site_visit_regeneration_locked',
        },
      },
    );
  }

  // The exact narrative and all authoritative structured inputs are frozen before
  // a claim is created. A missing source therefore has no durable side effect.
  const inputs = await dependencies.loadInputs({ requestId });
  if (String(inputs?.context?.requestId || '').toLowerCase() !== requestId.toLowerCase()) {
    throw new ServiceHttpError('The loaded Pre-Site inputs do not belong to the requested record.', {
      httpStatus: 409,
      code: 'pre_site_visit_request_mismatch',
    });
  }
  if (!inputs.context.cycleCode) {
    throw new ServiceHttpError('The request needs a meeting-date cycle before generation.', {
      httpStatus: 409,
      code: 'pre_site_visit_cycle_missing',
    });
  }
  const promptIdentity = validateNarrativePrompt(
    await dependencies.getCurrentPrompt(PRE_SITE_VISIT_CONTRACT.promptName),
  );
  validateTemplateContract();
  const inputSnapshot = buildPreSiteVisitInputSnapshot(inputs);
  const inputSnapshotJson = JSON.stringify(inputSnapshot);
  const { inputFingerprint, generationKey } = buildPreSiteVisitIdentity({
    requestId,
    inputSnapshot,
    promptIdentity,
    reopenCycleId: currentStatus.currentArtifact?.correction?.cycleId || null,
  });

  let row = await rereadByGenerationKey(generationKey, dependencies);
  let claimToken = null;
  let observedRunId = null;
  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    const ready = await commitReadyLineage(row, { actingUserSystemId }, dependencies);
    return { artifact: projectPreSiteVisitArtifact(ready), reused: true, recovered: false };
  }

  try {
    if (row) {
      claimToken = await claimExisting(row, actingUserSystemId, dependencies);
      if (!claimToken) {
        const current = await rereadByGenerationKey(generationKey, dependencies);
        return {
          artifact: projectPreSiteVisitArtifact(current || row),
          reused: true,
          recovered: false,
        };
      }
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
      const recovered = await recoverUploadedFile(row, claimToken, actingUserSystemId, dependencies);
      if (recovered) {
        return { artifact: projectPreSiteVisitArtifact(recovered), reused: true, recovered: true };
      }
      row = await prepareFreshFilename(
        row,
        inputs.context.requestNumber,
        claimToken,
        actingUserSystemId,
        dependencies,
      );
    } else {
      const bucket = await activeRequestBucket(
        requestId,
        inputs.context.requestNumber,
        dependencies,
      );
      if (!String(bucket.folder || '').trim()) {
        throw new ServiceHttpError('The active request SharePoint location has no folder path.', {
          httpStatus: 409,
        });
      }
      claimToken = dependencies.newClaimToken();
      const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}`
        + `/${PRE_SITE_VISIT_CONTRACT.relativeFolder}`;
      await dependencies.createDocument({
        wmkf_name: `${inputs.context.requestNumber} Pre-Site Visit`,
        'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
        wmkf_artifacttype: PRE_SITE_VISIT_CONTRACT.artifactType,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: inputs.context.cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: claimToken,
        wmkf_producer: PRE_SITE_VISIT_CONTRACT.producer,
        wmkf_templateid: PRE_SITE_VISIT_CONTRACT.templateId,
        wmkf_templateversion: PRE_SITE_VISIT_CONTRACT.templateVersion,
        wmkf_promptname: promptIdentity.promptName,
        wmkf_promptversion: promptIdentity.promptVersion,
        'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${promptIdentity.promptId})`,
        wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
        wmkf_sharepointfolderpath: folderPath,
        wmkf_filename: fileNameFor(inputs.context.requestNumber, generationKey, claimToken),
        ...(dependencies.isGuardedReopenSchemaReady?.() ? {
          wmkf_reopencycleid: currentStatus.currentArtifact?.correction?.cycleId || null,
        } : {}),
        wmkf_attemptcount: 1,
      }, { actingUserSystemId });
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    }

    let draft = persistedDraft(row, inputSnapshot);
    let runId = row._wmkf_airun_value || null;
    observedRunId = runId;
    if (!draft) {
      const generated = await dependencies.runProposalCore({
        requestId,
        inputs,
        actingUserSystemId,
        runSource: 'Vercel Interactive',
      });
      runId = generated.runId || null;
      observedRunId = runId;
      if (!isGuid(runId)
        || generated.meta?.promptId?.toLowerCase() !== promptIdentity.promptId
        || Number(generated.meta?.promptVersion) !== promptIdentity.promptVersion) {
        throw new ServiceHttpError('The executed Pre-Site prompt did not match the claimed prompt version.', {
          httpStatus: 409,
          code: 'pre_site_visit_prompt_changed',
        });
      }
      const preparedGenerated = prepareGeneratedCore(generated.proposalCore, {
        personnelNames: inputs.context.personnel.map((person) => person.name),
      });
      const generatedDiagnostics = [...new Map([
        ...preparedGenerated.diagnostics,
        ...validateDiagnostics(generated.diagnostics),
      ].map((diagnostic) => [JSON.stringify(diagnostic), diagnostic])).values()];
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
      await dependencies.updateDocument(row.wmkf_requestdocumentid, {
        ...proposalCorePatch(preparedGenerated.proposalCore),
        wmkf_presiteproposalcorejson: JSON.stringify({
          schemaVersion: 3,
          proposalCore: preparedGenerated.proposalCore,
          diagnostics: generatedDiagnostics,
        }),
        wmkf_presiteinputsnapshotjson: inputSnapshotJson,
        wmkf_promptname: generated.meta.promptName,
        wmkf_promptversion: generated.meta.promptVersion,
        'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${generated.meta.promptId})`,
        'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${runId})`,
      }, conditionalOptions(row, actingUserSystemId));
      row = await assertOwnedClaim(generationKey, claimToken, dependencies);
      draft = persistedDraft(row, inputSnapshot);
    }

    const exactRenderFingerprint = renderFingerprint(draft);
    const docx = await dependencies.renderDocx({
      documentFields: draft.documentFields,
      proposalCore: draft.proposalCore,
      personnelNames: draft.personnelNames,
    });
    const contentHash = await dependencies.hashDocx(docx);
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_renderinputfingerprint: exactRenderFingerprint,
      wmkf_contenthash: contentHash,
    }, conditionalOptions(row, actingUserSystemId));
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);

    await dependencies.ensureFolderPath('akoya_request', row.wmkf_sharepointfolderpath);
    row = await assertOwnedClaim(generationKey, claimToken, dependencies);
    const uploaded = await dependencies.uploadFile(
      'akoya_request',
      row.wmkf_sharepointfolderpath,
      row.wmkf_filename,
      docx,
      PRE_SITE_VISIT_CONTRACT.contentType,
    );
    if (!uploaded?.driveId || !uploaded?.id || !uploaded?.versionId) {
      throw new ServiceHttpError('SharePoint upload returned incomplete stable identity.', {
        httpStatus: 502,
        code: 'pre_site_visit_upload_identity_incomplete',
      });
    }
    try {
      const ready = await commitReadyLineage(
        row,
        { metadata: uploaded, claimToken, actingUserSystemId },
        dependencies,
      );
      return { artifact: projectPreSiteVisitArtifact(ready), reused: false, recovered: false };
    } catch (error) {
      if (error?.body?.code === 'claim_lost' || error?.code === 'claim_lost') {
        try {
          await dependencies.deleteFile(uploaded.driveId, uploaded.id);
        } catch (cleanupError) {
          await recordCleanup(
            row,
            uploaded,
            'claim_lost_delete_failed',
            cleanupError,
            actingUserSystemId,
            dependencies,
          );
        }
      }
      throw error;
    }
  } catch (error) {
    if (!row && (
      [409, 412].includes(error?.status)
      || /duplicate|alternate key/i.test(error?.message || '')
    )) {
      const winner = await rereadByGenerationKey(generationKey, dependencies);
      if (winner) {
        return {
          artifact: projectPreSiteVisitArtifact(winner),
          reused: true,
          recovered: false,
        };
      }
    }
    const safe = sanitizeError(error);
    try {
      await markFailedIfOwned(generationKey, claimToken, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_lasterrorcode: safe.code,
        wmkf_lasterrormessage: safe.message,
        wmkf_lastfailedat: new Date().toISOString(),
        ...(isGuid(error?.runId || observedRunId) ? {
          'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${error?.runId || observedRunId})`,
        } : {}),
      }, actingUserSystemId, dependencies);
    } catch (patchError) {
      console.error('[pre-site-visit] failed to persist failure state:', patchError.message);
    }
    if (error instanceof ServiceHttpError) throw error;
    throw new ServiceHttpError('Pre-Site Visit generation did not complete.', {
      httpStatus: 500,
      body: {
        error: 'Pre-Site Visit generation did not complete.',
        code: safe.code,
        runId: error?.runId || observedRunId || null,
      },
    });
  }
}

export {
  SECTION_FIELDS,
  projectReopenHistory,
  validateNarrativePrompt,
  validateTemplateContract,
};
