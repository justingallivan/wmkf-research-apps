/**
 * Sanitized, best-effort client telemetry for the browser-direct Blob leg.
 *
 * The browser never sends exception text, URLs, pathnames, filenames, tokens,
 * captions, abstracts, or file bytes. Routes authenticate first and pass only
 * this closed vocabulary plus server-resolved resource identity.
 */

import OperationalEventService from './operational-event-service';

export const PORTAL_UPLOAD_FAILURE_STAGES = Object.freeze([
  'token_request',
  'blob_put',
  'finalize',
]);

export const PORTAL_UPLOAD_FAILURE_CATEGORIES = Object.freeze([
  'network',
  'http_rejected',
  'sdk_failure',
  'invalid_response',
]);

const STAGES = new Set(PORTAL_UPLOAD_FAILURE_STAGES);
const CATEGORIES = new Set(PORTAL_UPLOAD_FAILURE_CATEGORIES);
const SURFACES = new Set(['external_grantee', 'staff_grantee_replacement']);
const CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function parsePortalUploadFailure(body) {
  const stage = typeof body?.stage === 'string' ? body.stage : '';
  const category = typeof body?.category === 'string' ? body.category : '';
  const httpStatus = body?.httpStatus == null ? null : Number(body.httpStatus);
  const declaredBytes = body?.declaredBytes == null ? null : Number(body.declaredBytes);
  const contentType = typeof body?.contentType === 'string' ? body.contentType : null;

  if (!STAGES.has(stage) || !CATEGORIES.has(category)) return null;
  if (httpStatus !== null && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) return null;
  if (declaredBytes !== null && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > 10 * 1024 * 1024)) return null;
  if (contentType !== null && !CONTENT_TYPES.has(contentType)) return null;
  return { stage, category, httpStatus, declaredBytes, contentType };
}

export async function recordPortalUploadClientFailure({ surface, resourceId, report }) {
  if (!SURFACES.has(surface) || !resourceId || !report) return null;
  const statusPart = report.httpStatus == null ? 'none' : report.httpStatus;
  return OperationalEventService.recordEvent({
    source: 'app',
    eventType: 'portal_upload_client_failure',
    severity: 'warning',
    summary: `Browser-reported portal upload failure during ${report.stage}.`,
    subsystem: 'portal-upload',
    stage: report.stage,
    transient: report.category !== 'http_rejected' || (report.httpStatus ?? 500) >= 500,
    entityRefs: { requestId: resourceId },
    dedupeKey: `portal_upload_client_failure:${surface}:${resourceId}:${report.stage}:${report.category}:${statusPart}`,
    metadata: {
      clientReported: true,
      surface,
      category: report.category,
      httpStatus: report.httpStatus,
      declaredBytes: report.declaredBytes,
      contentType: report.contentType,
    },
  });
}
