/** Pure helpers for matching canonical applicant-material receipts. */

import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

/** Canonical staff filenames per plan §7.3; the extension follows the format. */
export function canonicalFilename(requestNumber, key, extension) {
  const base = key === 'participant_bios' ? `${requestNumber} Site Visit Participant Bios` : `${requestNumber} Site Visit Presentation`;
  return `${base}.${String(extension || '').replace(/^\./, '').toLowerCase()}`;
}

const SLOT_RULES = Object.freeze({
  presentation_pdf: { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, extensions: ['pdf'] },
  presentation_source: { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, extensions: ['pptx', 'ppt', 'key'] },
  participant_bios: { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS, extensions: ['pdf', 'docx', 'doc'] },
});

function eligibleRegistryRow(row, requestId) {
  return sameId(row?._wmkf_request_value, requestId)
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && Boolean(row.wmkf_sharepointitemid);
}

/**
 * Received files per checklist slot: the newest Ready row of the slot's
 * artifact type whose filename is the canonical name.
 */
export function matchReceivedFiles(rows, requestId, requestNumber) {
  const eligible = (rows || []).filter((row) => eligibleRegistryRow(row, requestId));
  const received = {};
  for (const [key, rule] of Object.entries(SLOT_RULES)) {
    const names = new Set(rule.extensions.map((ext) => canonicalFilename(requestNumber, key, ext).toLowerCase()));
    const matches = eligible
      .filter((row) => row.wmkf_artifacttype === rule.artifactType && names.has(String(row.wmkf_filename || '').toLowerCase()))
      .sort((a, b) => String(b.modifiedon || b.createdon || '').localeCompare(String(a.modifiedon || a.createdon || '')));
    const row = matches[0];
    received[key] = row ? {
      artifactId: row.wmkf_requestdocumentid,
      filename: row.wmkf_filename,
      versionId: row.wmkf_sharepointversionid || null,
      receivedAt: row.modifiedon || row.createdon || null,
      size: row.wmkf_filesize ?? null,
    } : null;
  }
  const other = eligible
    .filter((row) => row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS
      && !Object.values(received).some((hit) => hit && sameId(hit.artifactId, row.wmkf_requestdocumentid)))
    .map((row) => ({ artifactId: row.wmkf_requestdocumentid, filename: row.wmkf_filename, receivedAt: row.modifiedon || row.createdon || null }));
  return { received, other };
}
