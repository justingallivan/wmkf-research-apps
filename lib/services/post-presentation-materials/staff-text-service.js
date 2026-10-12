/**
 * Staff reading page text (docs/plans/STAFF_READER_AND_VIDEO_PLAN_2026-10-11.md §2): the text of a
 * transcript or summary staff already see linked on the Workbench and the Site Visit card, so the
 * browser can show it formatted. Only the current staff winners of five text types are readable,
 * only as TXT whose bytes match the row's recorded size and SHA-256, within a source budget and a
 * serialized response budget. Read-only.
 */
import crypto from 'node:crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import {
  isPostPresentationMaterialsRequestAllowed,
  isPostPresentationMaterialsSchemaReady,
} from '../../utils/post-presentation-materials-readiness.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
} from '../../../shared/config/requestDocument.js';
import { materialBacking, projectPostPresentationMaterials } from './material-model.js';
import {
  bindStaffDiscussionSummary,
  bindTranscriptSummary,
  POST_PRESENTATION_PRODUCER,
  withoutUnboundDerivatives,
} from './presentation-transcript-binding.js';

const {
  TRANSCRIPT, PRESENTATION_TRANSCRIPT, STAFF_DISCUSSION_TRANSCRIPT, TRANSCRIPT_SUMMARY, STAFF_DISCUSSION_SUMMARY,
} = REQUEST_DOCUMENT_ARTIFACT_TYPE;

// What each readable type renders as. Only these five types are readable.
const READABLE = new Map([
  [TRANSCRIPT, { kind: 'transcript' }],
  [PRESENTATION_TRANSCRIPT, { kind: 'transcript' }],
  [STAFF_DISCUSSION_TRANSCRIPT, { kind: 'transcript' }],
  [TRANSCRIPT_SUMMARY, { kind: 'summary', summaryKind: 'presentation', bind: bindTranscriptSummary }],
  [STAFF_DISCUSSION_SUMMARY, { kind: 'summary', summaryKind: 'discussion', bind: bindStaffDiscussionSummary }],
]);

// The declared file size is checked before any download; the serialized response after, because
// JSON escaping can grow text by about half and the Function response limit is about 4.5 MB.
export const SOURCE_MAX_BYTES = 3 * 1024 * 1024;
export const RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: ['akoya_requestid', 'akoya_requestnum', 'akoya_title'] }),
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId, { includeMeetingTranscriptBundle: true }),
  downloadFile: (driveId, itemId, options) => GraphService.downloadFile(driveId, itemId, options),
  presentationSchemaReady: isPostPresentationMaterialsSchemaReady,
  presentationRequestAllowed: isPostPresentationMaterialsRequestAllowed,
});

// Errors after the request is known carry its identity, and once the item is known its label and
// SharePoint link, so the page always says what it is and can offer the file instead.
function fail(httpStatus, reason, extras = {}) {
  return new ServiceHttpError(reason, { httpStatus, body: { ok: false, reason, ...extras } });
}

const sameId = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// TXT only: an uploaded PDF, DOCX or VTT transcript keeps its SharePoint link instead.
function isTxt(row) {
  const type = String(row.wmkf_contenttype || '').split(';')[0].trim().toLowerCase();
  return type === 'text/plain' && String(row.wmkf_filename || '').toLowerCase().endsWith('.txt');
}

export async function readStaffPresentationText({ requestId, documentId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId) || !isGuid(documentId)) throw fail(400, 'invalid_request');
  if (!dependencies.presentationSchemaReady() || !dependencies.presentationRequestAllowed(requestId)) {
    throw fail(404, 'not_found');
  }
  const [request, documents] = await Promise.all([
    dependencies.getRequest(requestId).catch(() => null),
    dependencies.findDocuments(requestId),
  ]);
  const requestInfo = request && sameId(request.akoya_requestid, requestId)
    ? { number: request.akoya_requestnum || null, title: request.akoya_title || null }
    : null;
  // The same rows the Workbench lists: current winners, with unbound transcript halves removed.
  const records = withoutUnboundDerivatives(documents?.records || [], requestId);
  const winners = projectPostPresentationMaterials(records, requestId).winners;
  const row = winners.find((candidate) => sameId(candidate.wmkf_requestdocumentid, documentId));
  const readable = row && READABLE.get(Number(row.wmkf_artifacttype));
  if (!readable || materialBacking(row).kind !== 'file') throw fail(404, 'not_found', { request: requestInfo });
  if (Number(row.wmkf_artifacttype) !== TRANSCRIPT && row.wmkf_producer !== POST_PRESENTATION_PRODUCER) {
    throw fail(404, 'not_found', { request: requestInfo });
  }
  const known = {
    request: requestInfo,
    item: { label: REQUEST_DOCUMENT_ARTIFACT_LABEL[Number(row.wmkf_artifacttype)] || 'Document' },
    links: { sharePoint: row.wmkf_sharepointweburl || null },
  };
  if (!isTxt(row)) throw fail(415, 'unsupported_format', known);
  const size = Number(row.wmkf_filesize);
  const expectedSha = String(row.wmkf_contenthash || '').toLowerCase();
  if (!Number.isSafeInteger(size) || size <= 0 || !/^[0-9a-f]{64}$/.test(expectedSha)) throw fail(415, 'unsupported_format', known);
  if (size > SOURCE_MAX_BYTES) throw fail(413, 'too_large', known);

  const downloaded = await dependencies.downloadFile(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid, { maxBytes: size });
  const bytes = downloaded?.buffer;
  if (!Buffer.isBuffer(bytes) || bytes.length !== size || sha256(bytes) !== expectedSha) throw fail(503, 'integrity_failed', known);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    throw fail(415, 'unsupported_format', known);
  }

  // A summary made from an earlier transcript revision or boundary is still shown to staff, marked stale.
  const stale = readable.bind ? readable.bind(winners, requestId).reason !== 'bound' : false;
  const payload = {
    ok: true,
    request: requestInfo,
    item: {
      kind: readable.kind,
      summaryKind: readable.summaryKind || null,
      label: known.item.label,
      publishedAt: row.createdon || null,
      stale,
    },
    text,
    links: known.links,
  };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > RESPONSE_MAX_BYTES) throw fail(413, 'too_large', known);
  return payload;
}

export const _internal = { READABLE, DEFAULT_DEPENDENCIES };
