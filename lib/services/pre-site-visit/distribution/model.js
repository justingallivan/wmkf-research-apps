import crypto from 'node:crypto';
import { ServiceHttpError } from '../../service-http-error.js';
import {
  PRE_SITE_DISTRIBUTION_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
} from '../../../../shared/config/requestDocument.js';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = 'application/pdf';
const TEMPLATE_VERSION = PRE_SITE_DISTRIBUTION_CONTRACT.templateVersion;
const PRODUCER = PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix;
const SNAPSHOT_STALE_MS = 2 * 60 * 1000;
const SEND_ACCEPTED_STATUS_CODES = new Set([3, 6, 7]);
// 'none' is the only mode the composer sends since 2026-09-10 (owner: the
// briefing page carries the writeup; nothing is attached). The legacy modes
// stay readable and sendable so rows already on the ledger project and retry
// unchanged.
const MODES = new Set(['none', 'docx', 'pdf', 'both']);
const DEFAULT_ATTACHMENT_MODE = 'none';
// Fail closed at prepare: a stale client bundle that still posts a legacy mode
// must not attach anything after the cutover.
const PREPARE_MODES = new Set([DEFAULT_ATTACHMENT_MODE]);
const MATERIAL_TYPES = new Set([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
]);
const MAX_MATERIAL_LINKS = 25;

// The Pre-Site pointer is no longer read anywhere in this file (plan §3,
// slice 4) — the source is the brief, resolved through
// `_wmkf_currentprerpbrief_value`.
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  '_wmkf_currentprerpbrief_value',
].join(',');



function distributionError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extras },
  });
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalHash(value) {
  return sha256(JSON.stringify(value));
}

function parseStoredObject(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; }
  }
  return typeof value === 'object' ? value : null;
}

function parseStoredArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function materialLinkComparisonTuple(link) {
  return [
    link?.artifactId,
    link?.artifactType,
    link?.artifactTypeLabel,
    link?.filename,
    link?.webUrl,
    link?.driveId,
    link?.itemId,
    link?.versionId,
  ];
}

function materialLinksMatch(current, stored) {
  // JSONB preserves values but not object-key order, so compare an explicit
  // field projection instead of serializing the stored objects directly.
  return JSON.stringify(current.map(materialLinkComparisonTuple))
    === JSON.stringify(stored.map(materialLinkComparisonTuple));
}

function attemptAttachments(attempt) {
  const selected = [];
  if (attempt.docx_snapshot_document_id
    && ['docx', 'both'].includes(attempt.attachment_mode)) {
    selected.push({
      kind: 'docx',
      documentId: attempt.docx_snapshot_document_id,
      driveId: attempt.docx_drive_id,
      itemId: attempt.docx_item_id,
      versionId: attempt.docx_version_id,
      webUrl: attempt.docx_web_url,
      filename: attempt.docx_filename,
      contentType: attempt.docx_content_type,
      byteHash: attempt.docx_byte_hash,
      size: Number(attempt.docx_size || 0),
      attachedAt: attempt.docx_attached_at || null,
    });
  }
  if (attempt.pdf_snapshot_document_id
    && ['pdf', 'both'].includes(attempt.attachment_mode)) {
    selected.push({
      kind: 'pdf',
      documentId: attempt.pdf_snapshot_document_id,
      driveId: attempt.pdf_drive_id,
      itemId: attempt.pdf_item_id,
      versionId: attempt.pdf_version_id,
      webUrl: attempt.pdf_web_url,
      filename: attempt.pdf_filename,
      contentType: attempt.pdf_content_type,
      byteHash: attempt.pdf_byte_hash,
      size: Number(attempt.pdf_size || 0),
      attachedAt: attempt.pdf_attached_at || null,
    });
  }
  if (attempt.calendar_enabled) {
    selected.push({
      kind: 'calendar',
      filename: attempt.calendar_filename,
      contentType: attempt.calendar_content_type,
      byteHash: attempt.calendar_byte_hash,
      size: Number(attempt.calendar_size || 0),
      attachedAt: attempt.calendar_attached_at || null,
    });
  }
  return selected;
}

function assertPreparedAttachments(attempt) {
  const attachments = attemptAttachments(attempt);
  const expectedCount = (attempt.attachment_mode === 'none' ? 0 : attempt.attachment_mode === 'both' ? 2 : 1)
    + (attempt.calendar_enabled ? 1 : 0);
  const complete = attachments.length === expectedCount && attachments.every((file) => (
    (file.kind === 'calendar' || (
      file.documentId
      && file.driveId
      && file.itemId
      && file.versionId
    ))
    && file.filename
    && file.contentType
    && /^[0-9a-f]{64}$/.test(String(file.byteHash || ''))
    && file.size > 0
  ));
  if (!complete) {
    throw distributionError(
      'The confirmed preview is missing a complete frozen attachment identity.',
      'distribution_preview_incomplete',
      409,
    );
  }
  return attachments;
}

function projectDistributionAttempt(
  attempt,
  { sourceFreshness = 'unknown', actorNames = null } = {},
) {
  if (!attempt) return null;
  return {
    operationId: attempt.operation_id,
    requestId: attempt.request_id,
    sourceDocumentId: attempt.source_document_id,
    sourceVersionId: attempt.source_version_id,
    attachmentMode: attempt.attachment_mode,
    to: parseStoredArray(attempt.to_recipients),
    cc: parseStoredArray(attempt.cc_recipients),
    subject: attempt.subject,
    bodyText: attempt.body_text,
    materialLinks: parseStoredArray(attempt.material_links),
    calendarEnabled: attempt.calendar_enabled === true,
    siteVisitId: attempt.site_visit_id || null,
    session: parseStoredObject(attempt.session_snapshot),
    briefingLinkId: attempt.briefing_link_id || null,
    from: attempt.from_email,
    previewHash: attempt.preview_hash,
    state: attempt.state,
    attachments: attemptAttachments(attempt),
    dynamicsEmailId: attempt.dynamics_email_id,
    dynamicsStatusCode: attempt.dynamics_statuscode,
    attempts: attempt.attempt_count || 0,
    lastError: attempt.last_error_message || null,
    lastErrorCode: attempt.last_error_code || null,
    createdAt: attempt.created_at,
    updatedAt: attempt.updated_at,
    sendRequestedAt: attempt.send_requested_at,
    sentAt: attempt.sent_at,
    transportAccepted: attempt.state === 'sent',
    sourceFreshness,
    // B14: staff history shows the bounded delta, actor, and time for a
    // drift-acknowledged attempt; null when there was no drift to
    // acknowledge (including every pre-brief legacy attempt).
    staleInputsAcknowledged: attempt.stale_inputs_acknowledged_at ? {
      delta: parseStoredObject(attempt.stale_inputs_delta),
      acknowledgedAt: attempt.stale_inputs_acknowledged_at,
      acknowledgedBy: attempt.stale_inputs_acknowledged_by || null,
      // Resolved only for the staff history read; send-time projections
      // carry null and the external briefing context never sees either.
      acknowledgedByName: actorNames?.get(
        String(attempt.stale_inputs_acknowledged_by || '').toLowerCase(),
      ) || null,
    } : null,
    // Plan §11 (Step C1): filename/size/count/identity only — no drive/item
    // ids to the client (those stay server-side, same rationale as the
    // DOCX/PDF snapshots, which also never project drive/item ids).
    reviewBundle: attempt.review_bundle_document_id ? {
      filename: attempt.review_bundle_filename,
      size: attempt.review_bundle_size ?? null,
      reviewCount: attempt.review_bundle_review_count,
      setFingerprint: attempt.review_bundle_set_fingerprint,
      rebuiltAt: attempt.review_bundle_rebuilt_at || null,
    } : null,
  };
}
export {
  DOCX, PDF, TEMPLATE_VERSION, PRODUCER, SNAPSHOT_STALE_MS, SEND_ACCEPTED_STATUS_CODES,
  REQUEST_SELECT,
  MODES, DEFAULT_ATTACHMENT_MODE, PREPARE_MODES, MATERIAL_TYPES, MAX_MATERIAL_LINKS,
  distributionError, sameId, sha256, canonicalHash, parseStoredObject, parseStoredArray,
  materialLinkComparisonTuple, materialLinksMatch, attemptAttachments, assertPreparedAttachments,
  projectDistributionAttempt,
};
