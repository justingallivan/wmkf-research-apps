/** Initial Assessment artifact identity, projections, validation, and model constants. */
import crypto from 'crypto';
import { ServiceHttpError } from '../service-http-error.js';
import {
  INITIAL_ASSESSMENT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_LIFECYCLE_LABEL,
  REQUEST_DOCUMENT_OPERATION_LABEL,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isInitialAssessmentBoardSnapshot,
  requestDocumentLabel,
} from '../../../shared/config/requestDocument.js';
import { INITIAL_ASSESSMENT_REQUIRED_OUTPUTS } from '../../../shared/config/prompts/initial-assessment.js';
import { requestInstitution } from '../../../shared/utils/institution.js';

export const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
].join(',');
export const REQUEST_DASHBOARD_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_programdirector_value',
  '_wmkf_currentinitialassessment_value',
].join(',');
export const REQUEST_LINEAGE_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  '_wmkf_currentinitialassessment_value',
].join(',');
export const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const GENERATING_LEASE_MS = 15 * 60 * 1000;
export const FILE_METADATA_READ_CONCURRENCY = 8;
export const FILE_METADATA_READ_BUDGET_MS = 10_000;
export const REQUIRED_OUTPUTS = INITIAL_ASSESSMENT_REQUIRED_OUTPUTS;

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

export function sanitizeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function sanitizeError(error) {
  const code = String(error?.code || error?.status || 'initial_assessment_failed').slice(0, 100);
  const message = String(error?.message || 'Initial Assessment generation failed')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_~.-]{40,}/g, '[redacted]')
    .slice(0, 2000);
  return { code, message };
}

export function validateGenerated(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Initial Assessment prompt returned a non-object result.');
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !REQUIRED_OUTPUTS.includes(key));
  const missing = REQUIRED_OUTPUTS.filter((key) => typeof value[key] !== 'string' || !value[key].trim());
  if (unexpected.length || missing.length) {
    throw new Error(
      `Initial Assessment output contract mismatch (missing=${missing.join('|') || 'none'}, unexpected=${unexpected.join('|') || 'none'}).`,
    );
  }
  return Object.fromEntries(REQUIRED_OUTPUTS.map((key) => [key, value[key].trim()]));
}

export function assertKnownRegistryRow(row) {
  const artifactLabel = requestDocumentLabel(REQUEST_DOCUMENT_ARTIFACT_LABEL, row.wmkf_artifacttype);
  const operationLabel = requestDocumentLabel(REQUEST_DOCUMENT_OPERATION_LABEL, row.wmkf_operationstatus);
  const lifecycleLabel = requestDocumentLabel(REQUEST_DOCUMENT_LIFECYCLE_LABEL, row.wmkf_lifecyclestate);
  if (!artifactLabel || !operationLabel || !lifecycleLabel) {
    throw new ServiceHttpError('Request document registry contains an unknown contract value.', {
      httpStatus: 500,
    });
  }
  return { artifactLabel, operationLabel, lifecycleLabel };
}

export function projectArtifact(row, request = null) {
  const labels = assertKnownRegistryRow(row);
  const modifiedAt = Date.parse(row.modifiedon || row.createdon || '');
  const generatingRetryAt = row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
    && Number.isFinite(modifiedAt)
    ? new Date(modifiedAt + GENERATING_LEASE_MS).toISOString()
    : null;
  const retryable = row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED
    || (generatingRetryAt ? Date.now() >= Date.parse(generatingRetryAt) : false);
  return {
    artifactId: row.wmkf_requestdocumentid,
    requestId: row._wmkf_request_value,
    requestNumber: request?.akoya_requestnum || null,
    title: request?.akoya_title || null,
    institution: requestInstitution(request)
      || null,
    programDirector: request?._wmkf_programdirector_value_formatted || null,
    artifactType: row.wmkf_artifacttype,
    artifactLabel: labels.artifactLabel,
    operationStatus: row.wmkf_operationstatus,
    operationLabel: labels.operationLabel,
    lifecycleState: row.wmkf_lifecyclestate,
    lifecycleLabel: labels.lifecycleLabel,
    isBoardSnapshot: isInitialAssessmentBoardSnapshot(row),
    cycleCode: row.wmkf_cyclecode,
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
      metadataStatus: 'registry_snapshot',
      metadataCheckedAt: null,
    } : null,
    provenance: {
      producer: row.wmkf_producer,
      inputFingerprint: row.wmkf_inputfingerprint,
      templateId: row.wmkf_templateid,
      templateVersion: row.wmkf_templateversion,
      promptName: row.wmkf_promptname,
      promptVersion: row.wmkf_promptversion,
      promptId: row._wmkf_aiprompt_value || null,
      runId: row._wmkf_airun_value || null,
      contentHash: row.wmkf_contenthash || null,
      sourceDocumentId: row._wmkf_sourcedocument_value || null,
      sourceVersionId: row.wmkf_sourceversionid || null,
      sourceContentHash: row.wmkf_sourcecontenthash || null,
      milestoneVersionId: row.wmkf_milestoneversionid || null,
      milestoneContentHash: row.wmkf_milestonecontenthash || null,
      milestoneCreatedAt: row.wmkf_milestonecreatedat || null,
      initiatedAt: row.wmkf_initiatedat || null,
      createdBySystemUserId: row._wmkf_initiatedby_value || null,
      createdBy: row._wmkf_initiatedby_value_formatted || null,
      modifiedBySystemUserId: row._modifiedby_value || null,
      modifiedBy: row._modifiedby_value_formatted || null,
    },
    attemptCount: row.wmkf_attemptcount || 0,
    retryable,
    retryAfterAt: generatingRetryAt,
    lastError: row.wmkf_lasterrormessage ? {
      code: row.wmkf_lasterrorcode || null,
      message: row.wmkf_lasterrormessage,
      at: row.wmkf_lastfailedat || null,
    } : null,
    cleanupRequired: [
      ...parseOrphanCleanup(row.wmkf_orphancleanupjson),
      ...parseOrphanCleanup(row.wmkf_orphancleanupoverflowjson),
    ],
    createdAt: row.createdon || null,
    modifiedAt: row.modifiedon || null,
  };
}

export function parseOrphanCleanup(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed.map((entry) => {
      const normalized = {
        driveId: String(entry?.driveId || ''),
        itemId: String(entry?.itemId || ''),
        name: entry?.name ? String(entry.name) : null,
        recordedAt: entry?.recordedAt ? String(entry.recordedAt) : null,
        reason: entry?.reason ? String(entry.reason) : null,
        error: entry?.error ? String(entry.error) : null,
      };
      if (!normalized.driveId || !normalized.itemId) {
        throw new Error('cleanup entry has no stable drive/item identity');
      }
      return normalized;
    });
  } catch {
    throw new ServiceHttpError(
      'Initial Assessment registry contains unreadable SharePoint cleanup work.',
      { httpStatus: 500 },
    );
  }
}

export function buildInitialAssessmentIdentity({
  requestId,
  requestNumber,
  title,
  institution,
  cycleCode,
  proposalFilename,
  proposalText,
}) {
  const inputFingerprint = sha256(JSON.stringify({
    requestId: requestId.toLowerCase(),
    requestNumber,
    title,
    institution,
    cycleCode: String(cycleCode).toUpperCase(),
    proposalFilename,
    proposalText,
  }));
  const generationKey = sha256(JSON.stringify({
    requestId: requestId.toLowerCase(),
    artifactType: INITIAL_ASSESSMENT_CONTRACT.artifactType,
    inputFingerprint,
    promptName: INITIAL_ASSESSMENT_CONTRACT.promptName,
    promptVersion: INITIAL_ASSESSMENT_CONTRACT.promptVersion,
    templateId: INITIAL_ASSESSMENT_CONTRACT.templateId,
    templateVersion: INITIAL_ASSESSMENT_CONTRACT.templateVersion,
  }));
  return { inputFingerprint, generationKey };
}
