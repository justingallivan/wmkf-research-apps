/**
 * Pure Request Document model for post-presentation materials.
 *
 * This is the single owner of backing validation and latest-only winner
 * ordering. Producers, staff readers, and external resolvers must project
 * through this module rather than independently interpreting registry rows.
 */
import {
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

export const POST_PRESENTATION_ARTIFACT_TYPES = Object.freeze([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
]);

const POST_PRESENTATION_TYPE_SET = new Set(POST_PRESENTATION_ARTIFACT_TYPES);
const SHAREPOINT_BACKING_FIELDS = Object.freeze([
  'wmkf_sharepointsiteid',
  'wmkf_sharepointdriveid',
  'wmkf_sharepointitemid',
  'wmkf_sharepointweburl',
  'wmkf_sharepointversionid',
  'wmkf_sharepointetag',
  'wmkf_sharepointfolderpath',
  'wmkf_filename',
  'wmkf_filesize',
  'wmkf_contenthash',
  'wmkf_contenttype',
  'wmkf_sharepointlastmodified',
]);
const ZOOM_PATHS = Object.freeze([
  /^\/rec\/(?:share|play)\/[A-Za-z0-9._~-]+(?:\/)?$/,
]);

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

export function isPostPresentationArtifactType(value) {
  return POST_PRESENTATION_TYPE_SET.has(Number(value));
}

export function normalizeZoomPaste(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 12_000) {
    throw new Error('Paste one Zoom recording link (up to 12,000 characters).');
  }
  const matches = text.match(/\bhttps?:\/\/[^\s<>"']+/gi) || [];
  if (matches.length !== 1) {
    throw new Error('Paste exactly one absolute HTTPS Zoom recording link.');
  }
  // Common prose punctuation is not part of a copied Zoom URL. Parentheses
  // are deliberately retained because stripping them can alter a path/query.
  const candidate = matches[0].replace(/[.,;!?]+$/g, '');
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('The Zoom recording link is not a valid absolute URL.');
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('The Zoom recording link must use HTTPS and cannot contain user credentials.');
  }
  if (hostname !== 'zoom.us' && !hostname.endsWith('.zoom.us')) {
    throw new Error('Use a recording share link hosted on zoom.us.');
  }
  if (!ZOOM_PATHS.some((pattern) => pattern.test(url.pathname))) {
    throw new Error('Use a Zoom recording share or playback link.');
  }
  const normalized = url.toString();
  if (normalized.length > 2000) {
    throw new Error('The Zoom recording link must be at most 2,000 characters.');
  }
  if (/\bpasscode\s*:/i.test(text) && !url.searchParams.get('pwd')?.trim()) {
    throw new Error('Use a Zoom link with the passcode embedded (the URL must contain pwd).');
  }
  url.hostname = hostname;
  return url.toString();
}

/**
 * Returns one of two valid backing modes or a reconciliation reason.
 * External backing is Recording-only and is mutually exclusive with every
 * SharePoint identity/content field, not merely drive/item.
 */
export function materialBacking(row) {
  const artifactType = Number(row?.wmkf_artifacttype);
  const externalUrl = present(row?.wmkf_externalurl) ? String(row.wmkf_externalurl) : null;
  const drive = present(row?.wmkf_sharepointdriveid);
  const item = present(row?.wmkf_sharepointitemid);
  const anySharePoint = SHAREPOINT_BACKING_FIELDS.some((field) => present(row?.[field]));

  if (externalUrl) {
    if (artifactType !== REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING) {
      return { kind: 'invalid', reason: 'external_non_recording' };
    }
    if (anySharePoint) return { kind: 'invalid', reason: 'multiple_backings' };
    try {
      return { kind: 'external', url: normalizeZoomPaste(externalUrl) };
    } catch {
      return { kind: 'invalid', reason: 'invalid_external_url' };
    }
  }
  if (drive && item) return { kind: 'file' };
  if (anySharePoint) return { kind: 'invalid', reason: 'incomplete_file_backing' };
  return { kind: 'invalid', reason: 'missing_backing' };
}

export function isEligiblePostPresentationRow(row, requestId) {
  if (!row || !isPostPresentationArtifactType(row.wmkf_artifacttype)) return false;
  if (requestId && !sameId(row._wmkf_request_value, requestId)) return false;
  return row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && materialBacking(row).kind !== 'invalid';
}

function slotVersion(row) {
  const value = Number(row?.wmkf_slotversion);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function compareNewest(left, right) {
  const leftFence = slotVersion(left);
  const rightFence = slotVersion(right);
  if (leftFence !== rightFence) {
    if (leftFence === null) return 1;
    if (rightFence === null) return -1;
    return rightFence - leftFence;
  }
  const time = String(right?.createdon || '').localeCompare(String(left?.createdon || ''));
  if (time) return time;
  return String(right?.wmkf_requestdocumentid || '')
    .localeCompare(String(left?.wmkf_requestdocumentid || ''));
}

export function projectPostPresentationMaterials(rows, requestId) {
  const candidates = new Map(POST_PRESENTATION_ARTIFACT_TYPES.map((type) => [type, []]));
  const conflicts = [];
  for (const row of rows || []) {
    if (!row || !isPostPresentationArtifactType(row.wmkf_artifacttype)
      || (requestId && !sameId(row._wmkf_request_value, requestId))
      || row.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY
      || row.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED) continue;
    const backing = materialBacking(row);
    if (backing.kind === 'invalid') {
      conflicts.push({
        artifactId: row.wmkf_requestdocumentid || null,
        artifactType: Number(row.wmkf_artifacttype),
        reason: backing.reason,
      });
      continue;
    }
    candidates.get(Number(row.wmkf_artifacttype)).push(row);
  }

  const winners = [];
  for (const artifactType of POST_PRESENTATION_ARTIFACT_TYPES) {
    const ordered = candidates.get(artifactType).sort(compareNewest);
    if (ordered.length > 0) winners.push(ordered[0]);
    for (const loser of ordered.slice(1)) {
      conflicts.push({
        artifactId: loser.wmkf_requestdocumentid,
        artifactType,
        reason: 'eligible_non_winner',
      });
    }
  }
  return { winners, conflicts };
}

export function materialDescriptor(row, { includeStaffUrls = false } = {}) {
  const backing = materialBacking(row);
  if (backing.kind === 'invalid') return null;
  const artifactType = Number(row.wmkf_artifacttype);
  return {
    artifactId: row.wmkf_requestdocumentid,
    member: `material:${row.wmkf_requestdocumentid}`,
    artifactType,
    artifactTypeLabel: REQUEST_DOCUMENT_ARTIFACT_LABEL[artifactType] || 'Material',
    backing: backing.kind,
    filename: row.wmkf_filename || row.wmkf_name || REQUEST_DOCUMENT_ARTIFACT_LABEL[artifactType] || 'Material',
    contentType: row.wmkf_contenttype || null,
    size: Number.isFinite(Number(row.wmkf_filesize)) && Number(row.wmkf_filesize) > 0
      ? Number(row.wmkf_filesize) : null,
    slotVersion: slotVersion(row),
    createdAt: row.createdon || null,
    ...(includeStaffUrls && backing.kind === 'external' ? { externalUrl: backing.url } : {}),
    ...(includeStaffUrls && backing.kind === 'file' ? { webUrl: row.wmkf_sharepointweburl || null } : {}),
  };
}

export function projectPostPresentationDescriptors(rows, requestId, options) {
  const projection = projectPostPresentationMaterials(rows, requestId);
  return {
    materials: projection.winners.map((row) => materialDescriptor(row, options)),
    conflicts: projection.conflicts,
  };
}

export const _internal = { compareNewest, SHAREPOINT_BACKING_FIELDS, ZOOM_PATHS };
