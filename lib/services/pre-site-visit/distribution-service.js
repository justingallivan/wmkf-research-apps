/**
 * Frozen Pre-Site informational distribution coordinator.
 *
 * Captures one exact editable Word version, retains an immutable DOCX snapshot,
 * optionally derives PDF under native version/eTag fences, binds the selected
 * bytes and compose fields into an exact preview, and resumes one Dynamics
 * activity through granular attachment/send steps. Non-sent sends require
 * literal impersonation, current-source readback, durable activity identity,
 * and a renewed pre-transport lease. READY snapshot reuse refreshes registry
 * metadata only after a stable read and exact byte/hash verification.
 * SharePoint + Request Document own file identity, Postgres owns recovery
 * state, and Dynamics owns transport.
 */
import crypto from 'node:crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as emailActivityAdapter from '../../dataverse/adapters/email-activity.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import { GraphService } from '../graph-service.js';
import { buildSiteVisitIcs } from '../../external/calendar-invite.js';
import { hashGovernedDocxContent } from '../initial-assessment/artifact-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import { isSiteVisitLogisticsSchemaReady } from '../../utils/site-visit-logistics-readiness.js';
import {
  isPreSiteDistributionSnapshot,
  PRE_SITE_DISTRIBUTION_CONTRACT,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
  SITE_VISIT_ACTIVE_STATE_CODES,
  SITE_VISIT_PARTICIPATION_MASK,
} from '../../../shared/config/siteVisit.js';
import * as store from './distribution-store.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = 'application/pdf';
const TEMPLATE_VERSION = PRE_SITE_DISTRIBUTION_CONTRACT.templateVersion;
const PRODUCER = PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix;
const SNAPSHOT_STALE_MS = 2 * 60 * 1000;
const SEND_ACCEPTED_STATUS_CODES = new Set([3, 6, 7]);
const MODES = new Set(['docx', 'pdf', 'both']);
const MATERIAL_TYPES = new Set([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
]);
const MAX_MATERIAL_LINKS = 25;

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  '_wmkf_currentpresitevisit_value',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findDocumentsByRequest: requestDocumentAdapter.findByRequest,
  findDocumentByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  createDocument: requestDocumentAdapter.create,
  updateDocument: requestDocumentAdapter.update,
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  ensureFolderPath: (...args) => GraphService.ensureFolderPath(...args),
  uploadFile: (...args) => GraphService.uploadFile(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  downloadFileVersion: (...args) => GraphService.downloadFileVersion(...args),
  downloadFileAsPdf: (...args) => GraphService.downloadFileAsPdf(...args),
  hashDocx: hashGovernedDocxContent,
  createEmailActivity: emailActivityAdapter.create,
  addEmailAttachment: emailActivityAdapter.addAttachment,
  sendEmail: emailActivityAdapter.send,
  getEmailActivity: emailActivityAdapter.getById,
  findEmailByCorrelation: emailActivityAdapter.findByCorrelation,
  findEmailAttachments: emailActivityAdapter.findAttachments,
  getEmailAttachmentContent: emailActivityAdapter.getAttachmentById,
  getSiteVisitById: siteVisitAdapter.getById,
  schemaReady: isSiteVisitLogisticsSchemaReady,
  createOrGetAttempt: store.createOrGetDistributionAttempt,
  getAttempt: store.getDistributionAttempt,
  listAttempts: store.listDistributionAttempts,
  recordSource: store.recordDistributionSource,
  recordPrepared: store.recordDistributionPrepared,
  claimSend: store.claimDistributionSend,
  recordEmailActivity: store.recordDistributionEmailActivity,
  recordAttachment: store.recordDistributionAttachment,
  recordSendRequested: store.recordDistributionSendRequested,
  renewSendLease: store.renewDistributionSendLease,
  recordSent: store.recordDistributionSent,
  recordFailure: store.recordDistributionFailure,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
});

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

export function normalizeDistributionRecipients(toInput, ccInput) {
  const split = (input) => (Array.isArray(input) ? input : String(input || '').split(/[;,\n]/))
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const to = [...new Set(split(toInput))];
  const ccRaw = [...new Set(split(ccInput))];
  if (to.length === 0) {
    throw distributionError('At least one To recipient is required.', 'distribution_to_required', 400);
  }
  const invalid = [...to, ...ccRaw].filter((email) => !emailPattern.test(email));
  if (invalid.length) {
    throw distributionError('Every recipient must be a valid email address.', 'distribution_recipient_invalid', 400);
  }
  const toSet = new Set(to);
  const conflict = ccRaw.find((email) => toSet.has(email));
  if (conflict) {
    throw distributionError(
      `${conflict} cannot appear in both To and Cc.`,
      'distribution_recipient_conflict',
      400,
    );
  }
  return { to, cc: ccRaw };
}

function includeCalendarOrganizer(recipients, organizerEmail) {
  const normalizedOrganizer = String(organizerEmail || '').trim().toLowerCase();
  return {
    to: [...new Set([...recipients.to, normalizedOrganizer])],
    cc: recipients.cc.filter((email) => email !== normalizedOrganizer),
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function distributionBodyHtml(bodyText, operationId, materialLinks = []) {
  const paragraphs = String(bodyText || '').trim().split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
  const links = materialLinks.length
    ? '<h3>Site Visit materials</h3><ul>'
      + materialLinks.map((material) => (
        `<li><a href="${escapeHtml(material.webUrl)}">${escapeHtml(material.filename)}</a>`
          + ` — ${escapeHtml(material.artifactTypeLabel)}</li>`
      )).join('')
      + '</ul>'
    : '';
  return `${paragraphs}${links}<!-- wmkf-pre-site-distribution:${operationId} -->`;
}

function normalizeComposeInput(input) {
  const attachmentMode = String(input.attachmentMode || '').trim().toLowerCase();
  if (!MODES.has(attachmentMode)) {
    throw distributionError(
      'Choose Word, PDF, or both attachments.',
      'distribution_attachment_mode_required',
      400,
    );
  }
  const recipients = normalizeDistributionRecipients(input.to, input.cc);
  const subject = String(input.subject || '').trim();
  const bodyText = String(input.bodyText || '').trim();
  if (!subject || subject.length > 500) {
    throw distributionError('A subject of at most 500 characters is required.', 'distribution_subject_invalid', 400);
  }
  if (bodyText.length < 1 || bodyText.length > 20_000) {
    throw distributionError('An email body of at most 20,000 characters is required.', 'distribution_body_invalid', 400);
  }
  if (input.includeCalendar !== undefined && typeof input.includeCalendar !== 'boolean') {
    throw distributionError('includeCalendar must be true or false.', 'distribution_calendar_invalid', 400);
  }
  const selectedMaterialIds = input.selectedMaterialIds ?? [];
  if (!Array.isArray(selectedMaterialIds)
    || selectedMaterialIds.length > MAX_MATERIAL_LINKS
    || selectedMaterialIds.some((id) => !isGuid(id))) {
    throw distributionError(
      `Choose at most ${MAX_MATERIAL_LINKS} valid material links.`,
      'distribution_material_selection_invalid',
      400,
    );
  }
  const uniqueMaterialIds = [...new Set(selectedMaterialIds.map((id) => id.toLowerCase()))];
  if (uniqueMaterialIds.length !== selectedMaterialIds.length) {
    throw distributionError('A material can be selected only once.', 'distribution_material_selection_invalid', 400);
  }
  if (input.includeCalendar === true && !isGuid(input.siteVisitId)) {
    throw distributionError(
      'Save the Site Visit logistics before including its calendar attachment.',
      'distribution_site_visit_required',
      400,
    );
  }
  return {
    attachmentMode,
    recipients,
    subject,
    bodyText,
    includeCalendar: input.includeCalendar === true,
    siteVisitId: input.includeCalendar === true ? input.siteVisitId.toLowerCase() : null,
    selectedMaterialIds: uniqueMaterialIds,
  };
}

function eligibleMaterial(row, requestId) {
  let safeWebUrl = false;
  try {
    safeWebUrl = new URL(row?.wmkf_sharepointweburl).protocol === 'https:';
  } catch {}
  return sameId(row?._wmkf_request_value, requestId)
    && MATERIAL_TYPES.has(row.wmkf_artifacttype)
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && safeWebUrl
    && !isPreSiteDistributionSnapshot(row);
}

async function resolveMaterialLinks(requestId, selectedIds, dependencies) {
  if (!selectedIds.length) return [];
  const result = await dependencies.findDocumentsByRequest(requestId);
  const rows = (result?.records || []).filter((row) => eligibleMaterial(row, requestId));
  const byId = new Map(rows.map((row) => [String(row.wmkf_requestdocumentid).toLowerCase(), row]));
  return selectedIds.map((id) => {
    const row = byId.get(id);
    if (!row) {
      throw distributionError(
        'A selected material is no longer an eligible Ready request document.',
        'distribution_material_stale',
      );
    }
    return {
      artifactId: row.wmkf_requestdocumentid,
      artifactType: row.wmkf_artifacttype,
      artifactTypeLabel: REQUEST_DOCUMENT_ARTIFACT_LABEL[row.wmkf_artifacttype] || 'Material',
      filename: row.wmkf_filename || row.wmkf_name || 'Material',
      webUrl: row.wmkf_sharepointweburl,
      driveId: row.wmkf_sharepointdriveid || null,
      itemId: row.wmkf_sharepointitemid || null,
      versionId: row.wmkf_sharepointversionid || null,
    };
  });
}

function calendarSnapshot(row, requestId) {
  if (!row || !sameId(row._regardingobjectid_value, requestId)
    || !SITE_VISIT_ACTIVE_STATE_CODES.includes(Number(row.statecode))
    || !row._etag || !row.activityid || !row.scheduledstart || !row.scheduledend) {
    throw distributionError(
      'The saved Site Visit activity is no longer eligible for a calendar attachment.',
      'distribution_site_visit_stale',
    );
  }
  const parties = Array.isArray(row[siteVisitAdapter.PARTY_NAVIGATION_PROPERTY])
    ? row[siteVisitAdapter.PARTY_NAVIGATION_PROPERTY]
    : [];
  const organizers = parties.filter((party) => (
    Number(party.participationtypemask) === SITE_VISIT_PARTICIPATION_MASK.ORGANIZER
  ));
  const organizerEmail = String(organizers[0]?.addressused || '').trim().toLowerCase();
  if (organizers.length !== 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(organizerEmail)) {
    throw distributionError(
      'The saved Site Visit must have exactly one staff organizer with an email address.',
      'distribution_site_visit_organizer_invalid',
    );
  }
  let attendeeRefs;
  try {
    attendeeRefs = JSON.parse(row.wmkf_attendeerefsjson || '');
  } catch {
    attendeeRefs = null;
  }
  if (attendeeRefs?.version !== 1) {
    throw distributionError(
      'The saved Site Visit attendee identity map requires reconciliation.',
      'distribution_site_visit_attendee_map_invalid',
    );
  }
  const modifiedAt = row.modifiedon || row.createdon;
  if (!Number.isFinite(Date.parse(modifiedAt || ''))) {
    throw distributionError('The Site Visit has no stable calendar timestamp.', 'distribution_site_visit_stale');
  }
  return {
    version: 1,
    activityId: row.activityid,
    etag: row._etag,
    subject: row.subject || 'Site Visit',
    description: row.description || '',
    startIso: row.scheduledstart,
    endIso: row.scheduledend,
    timeZone: row.wmkf_ianatimezone || null,
    format: row.wmkf_visitformat ?? null,
    location: row.wmkf_locationorlink || '',
    organizerEmail,
    attendeeRefs,
    modifiedAt,
  };
}

function buildCalendar(snapshot) {
  const built = buildSiteVisitIcs({
    activityId: snapshot.activityId,
    startIso: snapshot.startIso,
    endIso: snapshot.endIso,
    subject: snapshot.subject,
    description: snapshot.description,
    location: snapshot.location,
    organizerEmail: snapshot.organizerEmail,
    nowIso: snapshot.modifiedAt,
  });
  return {
    filename: built.filename,
    contentType: built.contentType,
    content: built.content,
    byteHash: sha256(built.content),
    size: built.content.length,
  };
}

async function resolveCalendar(requestId, compose, dependencies) {
  if (!compose.includeCalendar) return null;
  if (!dependencies.schemaReady()) {
    throw distributionError(
      'Site Visit calendar attachments are not enabled for this environment.',
      'distribution_calendar_schema_not_ready',
      503,
    );
  }
  const row = await dependencies.getSiteVisitById(compose.siteVisitId);
  const snapshot = calendarSnapshot(row, requestId);
  return { snapshot, attachment: buildCalendar(snapshot) };
}

async function resolveSource(requestId, expectedArtifactId, dependencies) {
  const [request, result] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findDocumentsByRequest(requestId, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    }),
  ]);
  if (!request || !sameId(request.akoya_requestid, requestId)) {
    throw distributionError('The request could not be resolved.', 'distribution_request_not_found', 404);
  }
  const pointerId = request._wmkf_currentpresitevisit_value;
  if (!pointerId || !sameId(pointerId, expectedArtifactId)) {
    throw distributionError(
      'A different Pre-Site document is current. Reload before preparing the email.',
      'distribution_stale_source',
    );
  }
  const row = (result.records || []).find((candidate) => (
    sameId(candidate.wmkf_requestdocumentid, pointerId)
    && sameId(candidate._wmkf_request_value, requestId)
  ));
  if (!row
    || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
    || row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    || row.wmkf_contenttype !== DOCX
    || !row.wmkf_sharepointdriveid
    || !row.wmkf_sharepointitemid
    || !row.wmkf_sharepointfolderpath) {
    throw distributionError(
      'The current Site Visit Word document is not eligible for frozen distribution.',
      'distribution_source_ineligible',
    );
  }
  return { request, row };
}

function assertStableSource(before, after, row) {
  if (!before || !after
    || !sameId(before.driveId, row.wmkf_sharepointdriveid)
    || !sameId(before.id, row.wmkf_sharepointitemid)
    || !sameId(after.driveId, row.wmkf_sharepointdriveid)
    || !sameId(after.id, row.wmkf_sharepointitemid)
    || !before.versionId
    || before.versionId !== after.versionId
    || before.eTag !== after.eTag
    || before.lastModified !== after.lastModified
    || before.size !== after.size) {
    throw distributionError(
      'The Word document changed while its frozen copy was being prepared. Retry to use one exact version.',
      'distribution_source_changed',
    );
  }
}

function assertStableFrozenWord(before, after, word) {
  if (!before || !after
    || !sameId(before.driveId, word.driveId)
    || !sameId(before.id, word.itemId)
    || !sameId(after.driveId, word.driveId)
    || !sameId(after.id, word.itemId)
    || !word.versionId
    || before.versionId !== word.versionId
    || after.versionId !== word.versionId
    || !word.eTag
    || before.eTag !== word.eTag
    || after.eTag !== word.eTag
    || Number(before.size) !== Number(word.size)
    || Number(after.size) !== Number(word.size)) {
    throw distributionError(
      'The frozen Word snapshot changed while Microsoft Graph converted it to PDF.',
      'distribution_pdf_source_changed',
    );
  }
}

async function captureCurrentSource(row, dependencies) {
  const before = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  const downloaded = await dependencies.downloadFile(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  let contentHash;
  try {
    contentHash = await dependencies.hashDocx(downloaded.buffer);
  } catch {
    throw distributionError(
      'The current SharePoint item could not be verified as a Word document.',
      'distribution_source_word_invalid',
    );
  }
  const after = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  assertStableSource(before, after, row);
  return {
    buffer: downloaded.buffer,
    driveId: after.driveId,
    itemId: after.id,
    versionId: after.versionId,
    contentHash,
    byteHash: sha256(downloaded.buffer),
    filename: after.name || downloaded.filename || row.wmkf_filename,
  };
}

async function loadCapturedSource(attempt, sourceRow, dependencies) {
  if (!attempt.source_version_id) return captureCurrentSource(sourceRow, dependencies);
  const current = await dependencies.getFileMetadataById(
    attempt.source_drive_id,
    attempt.source_item_id,
    { siteId: sourceRow.wmkf_sharepointsiteid || null },
  );
  let buffer;
  if (current?.versionId === attempt.source_version_id) {
    const captured = await captureCurrentSource(sourceRow, dependencies);
    buffer = captured.buffer;
  } else {
    buffer = await dependencies.downloadFileVersion(
      attempt.source_drive_id,
      attempt.source_item_id,
      attempt.source_version_id,
    );
  }
  const [contentHash, byteHash] = await Promise.all([
    dependencies.hashDocx(buffer),
    Promise.resolve(sha256(buffer)),
  ]);
  if (contentHash !== attempt.source_content_hash || byteHash !== attempt.source_byte_hash) {
    throw distributionError(
      'The captured Word version no longer matches the prepared source identity.',
      'distribution_source_hash_mismatch',
    );
  }
  return {
    buffer,
    driveId: attempt.source_drive_id,
    itemId: attempt.source_item_id,
    versionId: attempt.source_version_id,
    contentHash,
    byteHash,
    filename: attempt.source_filename,
  };
}

async function oneSnapshotRow(generationKey, dependencies) {
  const result = await dependencies.findDocumentByGenerationKey(generationKey);
  const rows = result?.records || [];
  if (rows.length > 1) {
    throw distributionError(
      'The frozen snapshot generation key resolved to multiple registry rows.',
      'distribution_snapshot_ambiguous',
      500,
    );
  }
  return rows[0] || null;
}

function snapshotProjection(row, buffer, byteHash) {
  return {
    documentId: row.wmkf_requestdocumentid,
    siteId: row.wmkf_sharepointsiteid,
    driveId: row.wmkf_sharepointdriveid,
    itemId: row.wmkf_sharepointitemid,
    versionId: row.wmkf_sharepointversionid,
    eTag: row.wmkf_sharepointetag,
    webUrl: row.wmkf_sharepointweburl,
    filename: row.wmkf_filename,
    contentType: row.wmkf_contenttype,
    size: buffer.length,
    byteHash,
    buffer,
  };
}

function assertStableSnapshotRead(row, before, after, expectedSize) {
  if (!before || !after
    || !sameId(before.driveId, row.wmkf_sharepointdriveid)
    || !sameId(before.id, row.wmkf_sharepointitemid)
    || !sameId(after.driveId, row.wmkf_sharepointdriveid)
    || !sameId(after.id, row.wmkf_sharepointitemid)
    || !before.versionId
    || before.versionId !== after.versionId
    || !before.eTag
    || before.eTag !== after.eTag
    || Number(before.size) !== Number(expectedSize)
    || Number(after.size) !== Number(expectedSize)) {
    throw distributionError(
      'The retained snapshot publication identity changed during verification.',
      'distribution_snapshot_publication_changed',
    );
  }
}

function stableUploadedMetadata(provisional, stable, expectedSize) {
  if (!stable
    || !sameId(stable.driveId, provisional?.driveId)
    || !sameId(stable.id, provisional?.id)
    || !stable.versionId
    || !stable.eTag
    || Number(stable.size) !== Number(expectedSize)) {
    throw distributionError(
      'SharePoint did not confirm one stable native snapshot publication identity.',
      'distribution_snapshot_identity_incomplete',
      502,
    );
  }
  return {
    ...stable,
    siteId: stable.siteId || provisional.siteId || null,
  };
}

async function validateReadySnapshot(row, spec, dependencies, actingUserSystemId) {
  if (!sameId(row._wmkf_sourcedocument_value, spec.sourceDocumentId)
    || row.wmkf_sourceversionid !== spec.sourceVersionId
    || row.wmkf_sourcecontenthash !== spec.sourceContentHash
    || row.wmkf_contenttype !== spec.contentType
    || !row.wmkf_sharepointdriveid
    || !row.wmkf_sharepointitemid
    || !row.wmkf_sharepointversionid
    || !row.wmkf_sharepointetag
    || !Number(row.wmkf_filesize)) {
    throw distributionError(
      'A frozen snapshot registry row has conflicting lineage.',
      'distribution_snapshot_lineage_mismatch',
      500,
    );
  }
  const before = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  const downloaded = await dependencies.downloadFile(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  const after = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  assertStableSnapshotRead(row, before, after, downloaded.buffer.length);
  const byteHash = sha256(downloaded.buffer);
  if (spec.contentType === DOCX) {
    const semanticHash = await dependencies.hashDocx(downloaded.buffer);
    if (semanticHash !== spec.contentHash || byteHash !== spec.byteHash) {
      throw distributionError(
        'The retained Word snapshot no longer matches its frozen identity.',
        'distribution_word_snapshot_hash_mismatch',
      );
    }
  } else if (!downloaded.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
    || row.wmkf_contenthash !== byteHash) {
    throw distributionError(
      'The retained PDF snapshot no longer matches its frozen identity.',
      'distribution_pdf_snapshot_hash_mismatch',
    );
  }
  if (row.wmkf_sharepointversionid !== after.versionId
    || row.wmkf_sharepointetag !== after.eTag
    || Number(row.wmkf_filesize) !== Number(after.size)
    || row.wmkf_sharepointlastmodified !== (after.lastModified || null)) {
    if (!row._etag) {
      throw distributionError(
        'The retained snapshot registry row has no concurrency identity.',
        'distribution_snapshot_etag_missing',
        500,
      );
    }
    try {
      await dependencies.updateDocument(row.wmkf_requestdocumentid, {
        wmkf_sharepointsiteid: after.siteId || row.wmkf_sharepointsiteid || null,
        wmkf_sharepointdriveid: after.driveId,
        wmkf_sharepointitemid: after.id,
        wmkf_sharepointweburl: after.webUrl || row.wmkf_sharepointweburl || null,
        wmkf_sharepointversionid: after.versionId,
        wmkf_sharepointetag: after.eTag,
        wmkf_filename: after.name || row.wmkf_filename,
        wmkf_filesize: after.size,
        wmkf_sharepointlastmodified: after.lastModified || null,
      }, { actingUserSystemId, ifMatch: row._etag });
    } catch (error) {
      if (![409, 412].includes(error?.status)) throw error;
    }
    const refreshed = await oneSnapshotRow(row.wmkf_generationkey, dependencies);
    if (!refreshed
      || refreshed.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
      || refreshed.wmkf_sharepointversionid !== after.versionId
      || refreshed.wmkf_sharepointetag !== after.eTag
      || Number(refreshed.wmkf_filesize) !== Number(after.size)) {
      throw distributionError(
        'The retained snapshot registry metadata changed concurrently.',
        'distribution_snapshot_registry_conflict',
        409,
      );
    }
    row = refreshed;
  }
  return snapshotProjection(row, downloaded.buffer, byteHash);
}

async function ensureSnapshot(spec, dependencies, actingUserSystemId) {
  const generationKey = canonicalHash({
    contract: TEMPLATE_VERSION,
    format: spec.format,
    sourceDocumentId: spec.sourceDocumentId,
    sourceVersionId: spec.sourceVersionId,
    sourceContentHash: spec.sourceContentHash,
    sourceByteHash: spec.sourceByteHash,
  });
  const inputFingerprint = canonicalHash({
    sourceDocumentId: spec.sourceDocumentId,
    sourceVersionId: spec.sourceVersionId,
    sourceContentHash: spec.sourceContentHash,
    sourceByteHash: spec.sourceByteHash,
  });
  let row = await oneSnapshotRow(generationKey, dependencies);
  if (row?.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    return validateReadySnapshot(row, spec, dependencies, actingUserSystemId);
  }

  let claimToken = dependencies.randomUUID();
  if (!row) {
    try {
      await dependencies.createDocument({
        wmkf_name: `${spec.requestNumber} frozen ${spec.format.toUpperCase()} distribution snapshot`,
        'wmkf_Request@odata.bind': `/akoya_requests(${spec.requestId})`,
        'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${spec.sourceDocumentId})`,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
        wmkf_generationkey: generationKey,
        wmkf_cyclecode: spec.cycleCode,
        wmkf_inputfingerprint: inputFingerprint,
        wmkf_claimtoken: claimToken,
        wmkf_producer: `${PRODUCER}-${spec.format}`,
        wmkf_templateid: spec.format === 'pdf' ? 'microsoft-graph-pdf' : 'frozen-word-copy',
        wmkf_templateversion: TEMPLATE_VERSION,
        wmkf_contenttype: spec.contentType,
        wmkf_contenthash: spec.contentHash,
        wmkf_sourceversionid: spec.sourceVersionId,
        wmkf_sourcecontenthash: spec.sourceContentHash,
        wmkf_sharepointfolderpath: spec.folderPath,
        wmkf_filename: spec.filename,
        wmkf_attemptcount: 1,
      }, { actingUserSystemId });
    } catch (error) {
      if (![409, 412].includes(error?.status)
        && !/duplicate|alternate key/i.test(error?.message || '')) throw error;
    }
    row = await oneSnapshotRow(generationKey, dependencies);
  }
  if (!row) {
    throw distributionError('The frozen snapshot claim could not be read back.', 'distribution_snapshot_claim_missing', 502);
  }
  if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    return validateReadySnapshot(row, spec, dependencies, actingUserSystemId);
  }
  if (row.wmkf_claimtoken !== claimToken) {
    const modified = Date.parse(row.modifiedon || '');
    if (row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING
      && Number.isFinite(modified)
      && dependencies.now().getTime() - modified < SNAPSHOT_STALE_MS) {
      throw distributionError(
        'The same frozen snapshot is already being prepared. Retry shortly.',
        'distribution_snapshot_in_progress',
        409,
        { inProgress: true },
      );
    }
    if (!row._etag) {
      throw distributionError('The frozen snapshot row has no concurrency identity.', 'distribution_snapshot_etag_missing', 500);
    }
    claimToken = dependencies.randomUUID();
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_claimtoken: claimToken,
      wmkf_attemptcount: Number(row.wmkf_attemptcount || 0) + 1,
      wmkf_lasterrorcode: null,
      wmkf_lasterrormessage: null,
    }, { actingUserSystemId, ifMatch: row._etag });
    row = await oneSnapshotRow(generationKey, dependencies);
  }
  if (!row || row.wmkf_claimtoken !== claimToken) {
    throw distributionError('Another request owns the frozen snapshot claim.', 'distribution_snapshot_claim_lost', 409);
  }

  try {
    let buffer = spec.buffer;
    if (!buffer) buffer = await spec.buildBuffer();
    const byteHash = sha256(buffer);
    if (spec.expectedByteHash && byteHash !== spec.expectedByteHash) {
      throw distributionError('Frozen snapshot bytes changed before upload.', 'distribution_snapshot_bytes_changed');
    }
    const contentHash = spec.contentType === DOCX
      ? await dependencies.hashDocx(buffer)
      : byteHash;
    if (spec.contentHash && contentHash !== spec.contentHash) {
      throw distributionError('Frozen snapshot content hash changed before upload.', 'distribution_snapshot_content_changed');
    }

    await dependencies.ensureFolderPath('akoya_request', spec.folderPath);
    let uploaded = await dependencies.getFileMetadataByPath(
      'akoya_request',
      spec.folderPath,
      spec.filename,
    );
    if (uploaded) {
      const existing = await dependencies.downloadFile(uploaded.driveId, uploaded.id);
      const existingHash = spec.contentType === DOCX
        ? await dependencies.hashDocx(existing.buffer)
        : sha256(existing.buffer);
      if (existingHash !== contentHash || sha256(existing.buffer) !== byteHash) {
        throw distributionError(
          'A different file already occupies the frozen snapshot path.',
          'distribution_snapshot_path_conflict',
        );
      }
      buffer = existing.buffer;
    } else {
      uploaded = await dependencies.uploadFile(
        'akoya_request',
        spec.folderPath,
        spec.filename,
        buffer,
        spec.contentType,
      );
    }
    if (!uploaded?.driveId || !uploaded?.id) {
      throw distributionError('SharePoint returned incomplete snapshot identity.', 'distribution_snapshot_identity_incomplete', 502);
    }
    const stable = await dependencies.getFileMetadataById(
      uploaded.driveId,
      uploaded.id,
      { siteId: uploaded.siteId || row.wmkf_sharepointsiteid || null },
    );
    uploaded = stableUploadedMetadata(uploaded, stable, buffer.length);
    await dependencies.updateDocument(row.wmkf_requestdocumentid, {
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_claimtoken: null,
      wmkf_contenthash: contentHash,
      wmkf_sharepointsiteid: uploaded.siteId || row.wmkf_sharepointsiteid || null,
      wmkf_sharepointdriveid: uploaded.driveId,
      wmkf_sharepointitemid: uploaded.id,
      wmkf_sharepointweburl: uploaded.webUrl,
      wmkf_sharepointversionid: uploaded.versionId,
      wmkf_sharepointetag: uploaded.eTag || null,
      wmkf_filename: uploaded.name || spec.filename,
      wmkf_filesize: uploaded.size ?? buffer.length,
      wmkf_sharepointlastmodified: uploaded.lastModified || null,
    }, { actingUserSystemId, ifMatch: row._etag });
    const ready = await oneSnapshotRow(generationKey, dependencies);
    if (ready?.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
      throw distributionError('The frozen snapshot did not finalize.', 'distribution_snapshot_finalize_failed', 502);
    }
    return snapshotProjection(ready, buffer, byteHash);
  } catch (error) {
    const owned = await oneSnapshotRow(generationKey, dependencies).catch(() => null);
    if (owned?.wmkf_claimtoken === claimToken && owned._etag) {
      await dependencies.updateDocument(owned.wmkf_requestdocumentid, {
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
        wmkf_claimtoken: null,
        wmkf_lasterrorcode: String(error?.code || 'distribution_snapshot_failed').slice(0, 100),
        wmkf_lasterrormessage: String(error?.message || error).slice(0, 2000),
        wmkf_lastfailedat: dependencies.now().toISOString(),
      }, { actingUserSystemId, ifMatch: owned._etag }).catch(() => {});
    }
    throw error;
  }
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
  const expectedCount = (attempt.attachment_mode === 'both' ? 2 : 1)
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

export function projectDistributionAttempt(attempt, { sourceFreshness = 'unknown' } = {}) {
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
  };
}

export async function preparePreSiteDistribution(input, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(input.requestId) || !isGuid(input.expectedArtifactId) || !isGuid(input.operationId)) {
    throw distributionError(
      'requestId, expectedArtifactId, and operationId must be GUIDs.',
      'distribution_identity_invalid',
      400,
    );
  }
  if (!input.fromEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.fromEmail)) {
    throw distributionError('Your account has no valid sending address.', 'distribution_sender_invalid', 400);
  }
  if (!isGuid(input.actingUserSystemId)) {
    throw distributionError(
      'Your staff account is not linked to a Dynamics sender identity.',
      'distribution_staff_identity_required',
      403,
    );
  }
  const compose = normalizeComposeInput(input);
  const { request, row: sourceRow } = await resolveSource(
    input.requestId,
    input.expectedArtifactId,
    dependencies,
  );
  const [materialLinks, calendar] = await Promise.all([
    resolveMaterialLinks(input.requestId, compose.selectedMaterialIds, dependencies),
    resolveCalendar(input.requestId, compose, dependencies),
  ]);
  const recipients = calendar
    ? includeCalendarOrganizer(compose.recipients, calendar.snapshot.organizerEmail)
    : compose.recipients;
  const bodyHtml = distributionBodyHtml(compose.bodyText, input.operationId, materialLinks);
  const draftHash = canonicalHash({
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    attachmentMode: compose.attachmentMode,
    to: recipients.to,
    cc: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    materialLinks,
    calendar: calendar ? {
      siteVisitId: calendar.snapshot.activityId,
      siteVisitEtag: calendar.snapshot.etag,
      byteHash: calendar.attachment.byteHash,
    } : null,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    templateVersion: TEMPLATE_VERSION,
  });
  let attempt = await dependencies.createOrGetAttempt({
    operationId: input.operationId,
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    attachmentMode: compose.attachmentMode,
    toRecipients: recipients.to,
    ccRecipients: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    bodyHtml,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    draftHash,
    templateVersion: TEMPLATE_VERSION,
    calendarEnabled: Boolean(calendar),
    siteVisitId: calendar?.snapshot.activityId || null,
    siteVisitEtag: calendar?.snapshot.etag || null,
    siteVisitSnapshot: calendar?.snapshot || null,
    materialLinks,
    calendar: calendar?.attachment || null,
  });
  if (!attempt || attempt.draft_hash !== draftHash
    || !sameId(attempt.request_id, input.requestId)
    || !sameId(attempt.source_document_id, sourceRow.wmkf_requestdocumentid)) {
    throw distributionError(
      'This operation ID is already bound to a different preview. Start a new preview.',
      'distribution_operation_conflict',
    );
  }
  if (attempt.state !== 'preparing') return { attempt: projectDistributionAttempt(attempt), reused: true };

  const captured = await loadCapturedSource(attempt, sourceRow, dependencies);
  attempt = await dependencies.recordSource(input.operationId, captured);
  if (!attempt) {
    throw distributionError('The exact source identity could not be persisted.', 'distribution_source_persist_failed', 502);
  }

  // Recheck the current pointer after the source identity is durable and before
  // creating the downstream Request Document that closes guarded reopen.
  await resolveSource(input.requestId, sourceRow.wmkf_requestdocumentid, dependencies);

  const sourceHashTag = captured.byteHash.slice(0, 16);
  const folderPath = `${sourceRow.wmkf_sharepointfolderpath.replace(/\/+$/, '')}/Distribution Snapshots`;
  const baseName = `PreSite_${String(request.akoya_requestnum || input.requestId).replace(/[^A-Za-z0-9_-]/g, '_')}`
    + `_${sourceHashTag}`;
  const word = await ensureSnapshot({
    format: 'docx',
    requestId: input.requestId,
    requestNumber: request.akoya_requestnum || input.requestId,
    cycleCode: sourceRow.wmkf_cyclecode,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    sourceVersionId: captured.versionId,
    sourceContentHash: captured.contentHash,
    sourceByteHash: captured.byteHash,
    contentType: DOCX,
    contentHash: captured.contentHash,
    byteHash: captured.byteHash,
    expectedByteHash: captured.byteHash,
    folderPath,
    filename: `${baseName}.docx`,
    buffer: captured.buffer,
  }, dependencies, input.actingUserSystemId || null);

  let pdf = null;
  if (compose.attachmentMode !== 'docx') {
    pdf = await ensureSnapshot({
      format: 'pdf',
      requestId: input.requestId,
      requestNumber: request.akoya_requestnum || input.requestId,
      cycleCode: sourceRow.wmkf_cyclecode,
      sourceDocumentId: word.documentId,
      sourceVersionId: word.versionId,
      sourceContentHash: captured.contentHash,
      sourceByteHash: word.byteHash,
      contentType: PDF,
      contentHash: null,
      folderPath,
      filename: `${baseName}.pdf`,
      buildBuffer: async () => {
        const before = await dependencies.getFileMetadataById(
          word.driveId,
          word.itemId,
          { siteId: word.siteId || null },
        );
        const pdfBuffer = await dependencies.downloadFileAsPdf(word.driveId, word.itemId);
        const after = await dependencies.getFileMetadataById(
          word.driveId,
          word.itemId,
          { siteId: word.siteId || null },
        );
        assertStableFrozenWord(before, after, word);
        if (!pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          throw distributionError('Microsoft Graph did not return a PDF.', 'distribution_pdf_invalid', 502);
        }
        return pdfBuffer;
      },
    }, dependencies, input.actingUserSystemId || null);
  }

  const selected = [
    ...(['docx', 'both'].includes(compose.attachmentMode) ? [{ kind: 'docx', ...word }] : []),
    ...(['pdf', 'both'].includes(compose.attachmentMode) ? [{ kind: 'pdf', ...pdf }] : []),
  ];
  const previewHash = canonicalHash({
    operationId: input.operationId,
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    sourceVersionId: captured.versionId,
    sourceByteHash: captured.byteHash,
    attachmentMode: compose.attachmentMode,
    attachments: selected.map((file) => ({
      kind: file.kind,
      documentId: file.documentId,
      driveId: file.driveId,
      itemId: file.itemId,
      versionId: file.versionId,
      filename: file.filename,
      contentType: file.contentType,
      byteHash: file.byteHash,
      size: file.size,
    })).concat(calendar ? [{
      kind: 'calendar',
      filename: calendar.attachment.filename,
      contentType: calendar.attachment.contentType,
      byteHash: calendar.attachment.byteHash,
      size: calendar.attachment.size,
    }] : []),
    materialLinks,
    siteVisit: calendar ? {
      activityId: calendar.snapshot.activityId,
      etag: calendar.snapshot.etag,
    } : null,
    to: recipients.to,
    cc: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    templateVersion: TEMPLATE_VERSION,
  });
  attempt = await dependencies.recordPrepared(input.operationId, {
    docx: word,
    pdf,
    calendar: calendar?.attachment || null,
    previewHash,
  });
  if (!attempt) {
    throw distributionError('The exact preview could not be persisted.', 'distribution_preview_persist_failed', 502);
  }
  return { attempt: projectDistributionAttempt(attempt), reused: false };
}

async function recoverEmailActivity(attempt, dependencies) {
  const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
  if (attempt.dynamics_email_id) {
    return dependencies.getEmailActivity(attempt.dynamics_email_id);
  }
  const matches = await dependencies.findEmailByCorrelation(correlationKey);
  if (matches.length > 1) {
    throw distributionError(
      'Multiple Dynamics email activities share this distribution identity.',
      'distribution_email_ambiguous',
      500,
    );
  }
  return matches[0] || null;
}

async function persistEmailIdentity(attempt, emailId, dependencies) {
  if (!isGuid(emailId)) {
    throw distributionError(
      'Dynamics returned an invalid email activity identity.',
      'distribution_email_identity_invalid',
      502,
    );
  }
  if (attempt.dynamics_email_id) {
    if (!sameId(attempt.dynamics_email_id, emailId)) {
      throw distributionError(
        'The distribution ledger and Dynamics correlation resolved to different activities.',
        'distribution_email_identity_mismatch',
        500,
      );
    }
    return attempt;
  }

  let recordError = null;
  try {
    const persisted = await dependencies.recordEmailActivity(attempt, emailId);
    if (persisted) return persisted;
  } catch (error) {
    recordError = error;
  }

  const recovered = await recoverEmailActivity(attempt, dependencies);
  if (!recovered) {
    if (recordError) throw recordError;
    throw distributionError(
      'The Dynamics activity ID could not be persisted.',
      'distribution_email_persist_failed',
      502,
    );
  }
  if (!sameId(recovered.activityid, emailId)) {
    throw distributionError(
      'The distribution correlation resolved to a different Dynamics activity.',
      'distribution_email_identity_mismatch',
      500,
    );
  }
  const retried = await dependencies.recordEmailActivity(attempt, recovered.activityid);
  if (!retried) {
    throw distributionError(
      'The recovered Dynamics activity ID could not be persisted.',
      'distribution_email_persist_failed',
      502,
    );
  }
  return retried;
}

async function assertAttemptSourceCurrent(attempt, dependencies) {
  const { row } = await resolveSource(
    attempt.request_id,
    attempt.source_document_id,
    dependencies,
  );
  const metadata = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  if (!metadata
    || !sameId(metadata.driveId, attempt.source_drive_id)
    || !sameId(metadata.id, attempt.source_item_id)
    || !attempt.source_version_id
    || metadata.versionId !== attempt.source_version_id) {
    throw distributionError(
      'The prepared distribution source is no longer current. Prepare a new exact preview.',
      'distribution_stale_source',
    );
  }
}

async function assertAttemptExtensionsCurrent(attempt, dependencies) {
  const storedLinks = parseStoredArray(attempt.material_links);
  if (storedLinks.length) {
    const current = await resolveMaterialLinks(
      attempt.request_id,
      storedLinks.map((row) => row.artifactId),
      dependencies,
    );
    if (!materialLinksMatch(current, storedLinks)) {
      throw distributionError(
        'A linked Site Visit material changed after preview. Prepare a new exact preview.',
        'distribution_material_stale',
      );
    }
  }
  if (attempt.calendar_enabled) {
    if (!dependencies.schemaReady()) {
      throw distributionError('Site Visit calendar attachments are not enabled.', 'distribution_calendar_schema_not_ready', 503);
    }
    const row = await dependencies.getSiteVisitById(attempt.site_visit_id);
    const current = calendarSnapshot(row, attempt.request_id);
    if (current.etag !== attempt.site_visit_etag) {
      throw distributionError(
        'The Site Visit schedule changed after preview. Prepare a new exact preview.',
        'distribution_site_visit_stale',
      );
    }
  }
}

function assertEmailActivityMatches(attempt, email) {
  const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
  const parties = Array.isArray(email?.email_activity_parties)
    ? email.email_activity_parties
    : [];
  const addresses = (mask) => parties
    .filter((party) => Number(party.participationtypemask) === mask)
    .map((party) => String(party.addressused || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const expectedTo = parseStoredArray(attempt.to_recipients).slice().sort();
  const expectedCc = parseStoredArray(attempt.cc_recipients).slice().sort();
  const expectedFrom = [attempt.from_email];
  if (email?.subject !== attempt.subject
    || email?.description !== attempt.body_html
    || email?.subcategory !== correlationKey
    || JSON.stringify(addresses(1)) !== JSON.stringify(expectedFrom)
    || JSON.stringify(addresses(2)) !== JSON.stringify(expectedTo)
    || JSON.stringify(addresses(3)) !== JSON.stringify(expectedCc)) {
    throw distributionError(
      'The recovered Dynamics activity no longer matches this exact preview.',
      'distribution_email_mismatch',
      500,
    );
  }
}

async function ensureEmailAttachment(attempt, file, dependencies, actingUserSystemId) {
  const assertRecoveredAttachment = async (attachmentId) => {
    const recovered = await dependencies.getEmailAttachmentContent(attachmentId);
    let recoveredBytes;
    try {
      recoveredBytes = Buffer.from(String(recovered?.body || ''), 'base64');
    } catch {
      recoveredBytes = null;
    }
    if (!recoveredBytes
      || recovered?.filename !== file.filename
      || String(recovered?.mimetype || '').toLowerCase() !== file.contentType.toLowerCase()
      || Number(recovered?.filesize) !== file.size
      || sha256(recoveredBytes) !== file.byteHash) {
      throw distributionError(
        `The recovered Dynamics ${file.kind.toUpperCase()} attachment does not match the confirmed preview.`,
        'distribution_attachment_recovery_mismatch',
        500,
      );
    }
  };
  const found = await dependencies.findEmailAttachments(attempt.dynamics_email_id, file.filename);
  if (found.length > 1) {
    throw distributionError(
      `Dynamics contains duplicate ${file.kind.toUpperCase()} attachments for this activity.`,
      'distribution_attachment_ambiguous',
      500,
    );
  }
  if (found.length === 1) {
    await assertRecoveredAttachment(found[0].activitymimeattachmentid);
    return;
  }
  let content;
  if (file.kind === 'calendar') {
    const snapshot = typeof attempt.site_visit_snapshot === 'string'
      ? JSON.parse(attempt.site_visit_snapshot)
      : attempt.site_visit_snapshot;
    content = buildCalendar(snapshot).content;
  } else {
    const downloaded = await dependencies.downloadFile(file.driveId, file.itemId);
    content = downloaded.buffer;
  }
  if ((file.kind === 'calendar' && content.length !== file.size)
    || sha256(content) !== file.byteHash) {
    throw distributionError(
      `The frozen ${file.kind.toUpperCase()} no longer matches the confirmed preview.`,
      'distribution_attachment_hash_mismatch',
    );
  }
  try {
    await dependencies.addEmailAttachment(attempt.dynamics_email_id, {
      filename: file.filename,
      contentType: file.contentType,
      content,
      actingUserSystemId,
      noFallback: true,
    });
  } catch (error) {
    const after = await dependencies.findEmailAttachments(attempt.dynamics_email_id, file.filename)
      .catch(() => []);
    if (after.length !== 1) throw error;
    await assertRecoveredAttachment(after[0].activitymimeattachmentid);
  }
}

export async function sendPreSiteDistribution(input, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(input.requestId) || !isGuid(input.operationId)
    || !/^[0-9a-f]{64}$/.test(String(input.previewHash || ''))) {
    throw distributionError('Valid requestId, operationId, and previewHash are required.', 'distribution_send_identity_invalid', 400);
  }
  if (!isGuid(input.actingUserSystemId)) {
    throw distributionError(
      'Your staff account is not linked to a Dynamics sender identity.',
      'distribution_staff_identity_required',
      403,
    );
  }
  let existing = await dependencies.getAttempt(input.operationId);
  if (!existing || !sameId(existing.request_id, input.requestId)) {
    throw distributionError('The prepared distribution was not found.', 'distribution_attempt_not_found', 404);
  }
  if (existing.preview_hash !== input.previewHash) {
    throw distributionError(
      'The email or attachment selection changed after preview. Prepare a new exact preview.',
      'distribution_preview_changed',
    );
  }
  if (existing.from_email !== String(input.fromEmail || '').toLowerCase()
    || !sameId(existing.acting_user_system_id, input.actingUserSystemId)) {
    throw distributionError('This preview belongs to a different staff sender.', 'distribution_actor_mismatch', 403);
  }
  if (existing.state === 'sent') return { attempt: projectDistributionAttempt(existing), reused: true };
  if (existing.state === 'preparing') {
    throw distributionError('Prepare and confirm the exact preview before sending.', 'distribution_not_prepared');
  }
  assertPreparedAttachments(existing);
  if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
    throw distributionError(
      'Dynamics sender impersonation must be enabled before this distribution can be sent.',
      'distribution_impersonation_required',
      503,
    );
  }
  let attempt = await dependencies.claimSend(input.operationId);
  if (!attempt) {
    existing = await dependencies.getAttempt(input.operationId);
    if (existing?.state === 'sent') return { attempt: projectDistributionAttempt(existing), reused: true };
    throw distributionError(
      'This exact send is already in progress. Retry shortly to read its result.',
      'distribution_send_in_progress',
      202,
      { inProgress: true },
    );
  }
  try {
    await assertAttemptSourceCurrent(attempt, dependencies);
    await assertAttemptExtensionsCurrent(attempt, dependencies);
    let email = await recoverEmailActivity(attempt, dependencies);
    if (!email && attempt.dynamics_email_id) {
      throw distributionError(
        'The persisted Dynamics email activity could not be found. Reconcile it before retrying.',
        'distribution_email_missing',
        409,
      );
    }
    if (email && !attempt.dynamics_email_id) {
      attempt = await persistEmailIdentity(attempt, email.activityid, dependencies);
    }
    if (!email) {
      const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
      try {
        const emailId = await dependencies.createEmailActivity({
          subject: attempt.subject,
          body: attempt.body_html,
          from: attempt.from_email,
          to: parseStoredArray(attempt.to_recipients),
          cc: parseStoredArray(attempt.cc_recipients),
          regardingId: attempt.request_id,
          regardingType: 'akoya_request',
          correlationKey,
          actingUserSystemId: input.actingUserSystemId || null,
          noFallback: true,
        });
        attempt = await persistEmailIdentity(attempt, emailId, dependencies);
        email = await dependencies.getEmailActivity(attempt.dynamics_email_id);
      } catch (error) {
        email = await recoverEmailActivity(attempt, dependencies);
        if (!email) throw error;
        attempt = await persistEmailIdentity(attempt, email.activityid, dependencies);
      }
    }
    if (!email) {
      throw distributionError(
        'The persisted Dynamics email activity could not be found. Reconcile it before retrying.',
        'distribution_email_missing',
        409,
      );
    }
    assertEmailActivityMatches(attempt, email);

    for (const file of attemptAttachments(attempt)) {
      const alreadyAttached = file.kind === 'docx'
        ? attempt.docx_attached_at
        : file.kind === 'pdf' ? attempt.pdf_attached_at : attempt.calendar_attached_at;
      if (!alreadyAttached) {
        await ensureEmailAttachment(attempt, file, dependencies, input.actingUserSystemId || null);
        attempt = await dependencies.recordAttachment(attempt, file.kind);
        if (!attempt) throw distributionError('Attachment completion could not be persisted.', 'distribution_attachment_persist_failed', 502);
      }
    }

    const statusBefore = await dependencies.getEmailActivity(attempt.dynamics_email_id);
    if (SEND_ACCEPTED_STATUS_CODES.has(Number(statusBefore?.statuscode))) {
      const sent = await dependencies.recordSent(attempt, statusBefore);
      if (!sent) throw distributionError('Transport acceptance could not be persisted.', 'distribution_send_persist_failed', 502);
      return { attempt: projectDistributionAttempt(sent), reused: true };
    }

    attempt = await dependencies.recordSendRequested(attempt);
    if (!attempt) {
      throw distributionError(
        'The exact send intent could not be persisted.',
        'distribution_send_request_persist_failed',
        502,
      );
    }
    attempt = await dependencies.renewSendLease(attempt);
    if (!attempt) {
      throw distributionError(
        'The exact send lease expired before transport. Retry to reconcile its state.',
        'distribution_send_lease_lost',
        409,
      );
    }
    await assertAttemptSourceCurrent(attempt, dependencies);
    await assertAttemptExtensionsCurrent(attempt, dependencies);
    try {
      await dependencies.sendEmail(attempt.dynamics_email_id, {
        actingUserSystemId: input.actingUserSystemId || null,
        noFallback: true,
      });
    } catch (error) {
      const ambiguous = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => null);
      if (!SEND_ACCEPTED_STATUS_CODES.has(Number(ambiguous?.statuscode))) throw error;
    }
    const statusAfter = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => ({}));
    const sent = await dependencies.recordSent(attempt, statusAfter);
    if (!sent) throw distributionError('Transport acceptance could not be persisted.', 'distribution_send_persist_failed', 502);
    return { attempt: projectDistributionAttempt(sent), reused: false };
  } catch (error) {
    await dependencies.recordFailure(attempt, error, error?.code || 'distribution_send_failed').catch(() => {});
    throw error;
  }
}

export async function getPreSiteDistributionHistory(
  { requestId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw distributionError('requestId must be a GUID.', 'distribution_request_invalid', 400);
  }
  const [attempts, currentSource] = await Promise.all([
    dependencies.listAttempts(requestId),
    (async () => {
      try {
        const request = await dependencies.getRequest(requestId);
        const documentId = request?._wmkf_currentpresitevisit_value || null;
        if (!documentId) return null;
        const result = await dependencies.findDocumentsByRequest(requestId, {
          artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
        });
        const row = (result.records || []).find((candidate) => (
          sameId(candidate.wmkf_requestdocumentid, documentId)
        ));
        if (!row?.wmkf_sharepointdriveid || !row?.wmkf_sharepointitemid) {
          return { documentId, versionId: null };
        }
        const metadata = await dependencies.getFileMetadataById(
          row.wmkf_sharepointdriveid,
          row.wmkf_sharepointitemid,
          { siteId: row.wmkf_sharepointsiteid || null },
        );
        return { documentId, versionId: metadata?.versionId || null };
      } catch {
        return null;
      }
    })(),
  ]);
  return {
    attempts: attempts.map((attempt) => {
      let sourceFreshness = 'unknown';
      if (attempt.source_version_id && currentSource?.documentId) {
        sourceFreshness = !sameId(currentSource.documentId, attempt.source_document_id)
          || (currentSource.versionId && currentSource.versionId !== attempt.source_version_id)
          ? 'changed'
          : currentSource.versionId ? 'current' : 'unknown';
      }
      return projectDistributionAttempt(attempt, { sourceFreshness });
    }),
  };
}

export const PRE_SITE_DISTRIBUTION_TEMPLATE_VERSION = TEMPLATE_VERSION;
