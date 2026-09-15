/**
 * Durable, actor-bound staging for browser-direct private Blob uploads.
 *
 * Contract:
 *   mint: server chooses the pathname and records its owner before returning a
 *         short-lived, path-scoped client token.
 *   claim: finalize callers atomically acquire a lease by staging id + actor +
 *          scope + resource. A client-supplied pathname is never accepted.
 *   load: server fetches the exact private object, verifies metadata and bytes,
 *         and records its immutable Blob etag/hash under the lease.
 *   candidate/complete: downstream identity is durable before the Dataverse
 *         commit; a terminal response is durable before staged bytes are reaped.
 */

import crypto from 'crypto';
import { sql } from '@vercel/postgres';
import { del, get } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { sanitizeBlobFilename } from '../utils/blob-filename.js';
import { cleanupSharePointItemsDetailed } from './sharepoint-cleanup.js';
import * as requestDocumentAdapter from '../dataverse/adapters/request-document.js';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../shared/config/requestDocument.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from './request-document-actor-service.js';
import { getDeliverableForRequest } from './grantee-deliverable-record.js';
import { matchReceivedFiles } from './site-visit-materials/collection-service.js';

export const PORTAL_UPLOAD_SCOPES = Object.freeze({
  GRANTEE_IMAGE: 'grantee_image',
  STAFF_GRANTEE_IMAGE: 'staff_grantee_image',
  // Applicant site-visit materials (migration 043): documents, not images.
  SITE_VISIT_MATERIAL: 'site_visit_material',
  // Staff-uploaded consultant feedback attachments (migration 049).
  CONSULTANT_FEEDBACK: 'consultant_feedback',
});

export const PORTAL_DOCUMENT_CONTENT_TYPES = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.apple.keynote',
  'application/x-iwork-keynote-sffkey',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/octet-stream',
]);

export const PORTAL_IMAGE_CONTENT_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const VALID_SCOPES = new Set(Object.values(PORTAL_UPLOAD_SCOPES));
const VALID_IMAGE_TYPES = new Set(PORTAL_IMAGE_CONTENT_TYPES);
const TOKEN_TTL_MS = 15 * 60_000;
const ROW_TTL_MS = 60 * 60_000;
const LEASE_TTL_MS = 5 * 60_000;

export class PortalUploadStagingError extends Error {
  constructor(code, { httpStatus = 400, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'PortalUploadStagingError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function uploadsBlobToken() {
  const token = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!token) {
    throw new PortalUploadStagingError('staging_unavailable', { httpStatus: 503 });
  }
  return token;
}

function assertScope(scope) {
  if (!VALID_SCOPES.has(scope)) throw new Error(`Unsupported portal upload scope: ${scope}`);
}

export function externalGranteeActorBinding(token) {
  return `grantee:${crypto.createHash('sha256').update(String(token || '')).digest('hex')}`;
}

/** The applicant materials contributor link is the actor; PI and liaison share it. */
export function externalMaterialsActorBinding(token) {
  return `materials:${crypto.createHash('sha256').update(String(token || '')).digest('hex')}`;
}

export function staffActorBinding(profileId) {
  if (profileId === null || profileId === undefined || profileId === '') {
    // Development auth bypass has no stable profile. Keep it distinct from any
    // real user and still server-derived; production requireAppAccess never
    // returns this binding.
    return 'profile:development-bypass';
  }
  return `profile:${String(profileId)}`;
}

export async function createPortalUpload({
  scope,
  resourceId,
  actorBinding,
  filename,
  contentType,
  maxBytes,
  originalEtag = null,
  // Image scopes keep their fixed allowlist; the document scope passes its own.
  allowedContentTypes = null,
}) {
  assertScope(scope);
  if (!resourceId || !actorBinding) throw new Error('resourceId and actorBinding are required');
  const allowed = Array.isArray(allowedContentTypes) && allowedContentTypes.length
    ? new Set(allowedContentTypes)
    : VALID_IMAGE_TYPES;
  if (!allowed.has(contentType)) {
    throw new PortalUploadStagingError('content_type_not_allowed', { httpStatus: 422 });
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be a positive integer');

  let safeFilename;
  try {
    safeFilename = sanitizeBlobFilename(filename);
  } catch (cause) {
    throw new PortalUploadStagingError('filename_invalid', { httpStatus: 422, cause });
  }

  const id = crypto.randomUUID();
  const pathname = `portal-staging/${scope}/${resourceId}/${id}`;
  const now = Date.now();
  const tokenValidUntil = now + TOKEN_TTL_MS;
  const rowExpiresAt = new Date(now + ROW_TTL_MS);

  let clientToken;
  try {
    clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      maximumSizeInBytes: maxBytes,
      allowedContentTypes: [contentType],
      validUntil: tokenValidUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      token: uploadsBlobToken(),
    });
  } catch (cause) {
    if (cause instanceof PortalUploadStagingError) throw cause;
    throw new PortalUploadStagingError('staging_unavailable', { httpStatus: 503, cause });
  }

  try {
    await sql`
      INSERT INTO portal_upload_staging (
        id, scope, resource_id, actor_binding, pathname, filename,
        declared_content_type, max_bytes, original_etag, expires_at
      ) VALUES (
        ${id}, ${scope}, ${resourceId}, ${actorBinding}, ${pathname}, ${safeFilename},
        ${contentType}, ${maxBytes}, ${originalEtag || null}, ${rowExpiresAt}
      )
    `;
  } catch (cause) {
    throw new PortalUploadStagingError('staging_unavailable', { httpStatus: 503, cause });
  }

  return {
    stagingId: id,
    pathname,
    clientToken,
    access: 'private',
    contentType,
    tokenExpiresAt: new Date(tokenValidUntil).toISOString(),
    stagingExpiresAt: rowExpiresAt.toISOString(),
  };
}

export async function claimPortalUpload({ stagingId, scope, resourceId, actorBinding }) {
  assertScope(scope);
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_MS);

  const claimed = await sql`
    UPDATE portal_upload_staging
       SET status = 'finalizing',
           lease_token = ${leaseToken},
           lease_expires_at = ${leaseExpiresAt},
           updated_at = NOW()
     WHERE id = ${stagingId}
       AND scope = ${scope}
       AND resource_id = ${resourceId}
       AND actor_binding = ${actorBinding}
       AND expires_at > NOW()
       AND (
         status = 'pending'
         OR (status = 'finalizing' AND lease_expires_at < NOW())
       )
     RETURNING *
  `;
  if (claimed.rows[0]) return { state: 'claimed', row: claimed.rows[0], leaseToken };

  // Deliberately use the full ownership tuple again: a valid-but-foreign id is
  // indistinguishable from a nonexistent id.
  const found = await sql`
    SELECT * FROM portal_upload_staging
     WHERE id = ${stagingId}
       AND scope = ${scope}
       AND resource_id = ${resourceId}
       AND actor_binding = ${actorBinding}
     LIMIT 1
  `;
  const row = found.rows[0];
  if (!row) throw new PortalUploadStagingError('staging_not_found', { httpStatus: 404 });
  if (row.status === 'consumed') return { state: 'consumed', row, result: row.result_payload };
  if (row.status === 'rejected') throw new PortalUploadStagingError(row.result_code || 'staging_rejected', { httpStatus: 409 });
  if (new Date(row.expires_at).getTime() <= Date.now() || row.status === 'expired') {
    await sql`
      UPDATE portal_upload_staging
         SET status = 'expired', lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
       WHERE id = ${stagingId} AND status <> 'consumed'
    `;
    throw new PortalUploadStagingError('staging_expired', { httpStatus: 410 });
  }
  throw new PortalUploadStagingError('finalize_in_progress', { httpStatus: 409 });
}

export async function loadClaimedPortalImage({ row, leaseToken }) {
  let result;
  try {
    result = await get(row.pathname, {
      access: 'private',
      useCache: false,
      token: uploadsBlobToken(),
    });
  } catch (cause) {
    throw new PortalUploadStagingError('staged_upload_missing', { httpStatus: 409, cause });
  }
  if (!result || result.statusCode !== 200 || !result.stream || result.blob?.pathname !== row.pathname) {
    throw new PortalUploadStagingError('staged_upload_missing', { httpStatus: 409 });
  }
  if (result.blob.contentType !== row.declared_content_type) {
    throw new PortalUploadStagingError('staged_upload_mismatch', { httpStatus: 422 });
  }
  if (!Number.isSafeInteger(result.blob.size) || result.blob.size <= 0) {
    throw new PortalUploadStagingError('empty_image', { httpStatus: 400 });
  }
  if (result.blob.size > Number(row.max_bytes)) {
    throw new PortalUploadStagingError('image_too_large', { httpStatus: 400 });
  }

  // Defense in depth against a future store/SDK policy regression: the exact
  // object must not be anonymously readable even though the client token was
  // minted from a private store. Never log or return the Blob URL.
  let anonymous;
  try {
    anonymous = await fetch(result.blob.url, { method: 'HEAD', redirect: 'manual' });
  } catch (cause) {
    throw new PortalUploadStagingError('staging_privacy_unverified', { httpStatus: 503, cause });
  }
  if (anonymous.ok) {
    throw new PortalUploadStagingError('staging_publicly_readable', { httpStatus: 422 });
  }
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new PortalUploadStagingError('staging_privacy_unverified', { httpStatus: 503 });
  }

  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  if (buffer.length !== result.blob.size || buffer.length > Number(row.max_bytes)) {
    throw new PortalUploadStagingError('staged_upload_mismatch', { httpStatus: 422 });
  }
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const updated = await sql`
    UPDATE portal_upload_staging
       SET blob_etag = ${result.blob.etag}, sha256 = ${sha256}, actual_bytes = ${buffer.length}, updated_at = NOW()
     WHERE id = ${row.id} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING id
  `;
  if (!updated.rows[0]) throw new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 });

  return {
    buffer,
    filename: row.filename,
    mimeType: row.declared_content_type,
    sha256,
    blobEtag: result.blob.etag,
  };
}

export async function recordPortalUploadCandidate({ stagingId, leaseToken, candidate }) {
  const updated = await sql`
    UPDATE portal_upload_staging
       SET candidate_result = ${JSON.stringify(candidate)}::jsonb, updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING id
  `;
  if (!updated.rows[0]) throw new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 });
}

export async function completePortalUpload({ stagingId, leaseToken, resultCode = 'ok', resultPayload }) {
  const completed = await sql`
    UPDATE portal_upload_staging
       SET status = 'consumed',
           result_code = ${resultCode},
           result_payload = ${JSON.stringify(resultPayload || { ok: true })}::jsonb,
           consumed_at = NOW(),
           lease_token = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING pathname, result_payload
  `;
  if (!completed.rows[0]) throw new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 });
  try {
    await del(completed.rows[0].pathname, { token: uploadsBlobToken() });
  } catch (error) {
    // Durable consumed state is authoritative; exact-path maintenance cleanup
    // will retry the byte deletion. Never turn a committed domain write into a
    // reported failure because staging cleanup had a transient error.
    console.warn('[portal-upload-staging] post-commit Blob cleanup failed:', error?.message || error);
  }
  return completed.rows[0].result_payload;
}

export async function releasePortalUpload({ stagingId, leaseToken }) {
  await sql`
    UPDATE portal_upload_staging
       SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
  `;
}

export async function rejectPortalUpload({ stagingId, leaseToken, resultCode }) {
  const rejected = await sql`
    UPDATE portal_upload_staging
       SET status = 'rejected', result_code = ${resultCode},
           lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING pathname
  `;
  if (rejected.rows[0]) {
    try {
      await del(rejected.rows[0].pathname, { token: uploadsBlobToken() });
    } catch (error) {
      console.warn('[portal-upload-staging] rejected Blob cleanup failed:', error?.message || error);
    }
  }
}

export async function clearPortalUploadCandidate({ stagingId, leaseToken }) {
  const updated = await sql`
    UPDATE portal_upload_staging
       SET candidate_result = NULL, updated_at = NOW()
     WHERE id = ${stagingId} AND status = 'finalizing' AND lease_token = ${leaseToken}
     RETURNING id
  `;
  if (!updated.rows[0]) throw new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 });
}

export async function discardPortalUploadCandidate(candidate) {
  const driveId = typeof candidate?.driveId === 'string' ? candidate.driveId : '';
  const itemId = typeof candidate?.itemId === 'string' ? candidate.itemId : '';
  if (!driveId || !itemId) return false;
  const cleanup = await cleanupSharePointItemsDetailed(
    driveId,
    [{ id: itemId }],
    'portal-staging-reconcile',
  );
  return cleanup.failed.length === 0
    || cleanup.failed.every((item) => /\b404\b|not[ -]?found/i.test(item.error || ''));
}

/**
 * Default reconciliation dependencies for `cleanupExpiredPortalUploads`
 * (plan §4 "Slice 2 prerequisite", Codex AR-3). Injected so tests can drive
 * every scope's binding-proof branch without a live Dataverse/Postgres call.
 */
export const DEFAULT_CLEANUP_DEPENDENCIES = Object.freeze({
  findDocumentByGenerationKey: (key) => requestDocumentAdapter.findByGenerationKey(key),
  supersedeDocument: (id) => requestDocumentAdapter.update(
    id,
    { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
    { actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED, actorContext: { operation: 'portal-upload-staging-cleanup' } },
  ),
  discardCandidate: (candidate) => discardPortalUploadCandidate(candidate),
  isConsultantFeedbackBound: async (registryId) => {
    const { rows } = await sql`SELECT id FROM consultant_feedback WHERE requestdocument_id = ${registryId} LIMIT 1`;
    return rows.length > 0;
  },
  // grantee_image / staff_grantee_image binding proof (matches the inline
  // check both `pages/api/external/grantee/[token]/submit.js` and
  // `pages/api/workbench/grantee-deliverables/replace-submission.js` run at
  // finalize time): the candidate's `imageRef` committed iff it equals the
  // deliverable's CURRENT `wmkf_imagefileref` for the staging row's request.
  getGranteeDeliverable: (requestId) => getDeliverableForRequest(requestId),
  // site_visit_material binding proof (`contributor-service.js`'s
  // `replayIsBound`/`matchReceivedFiles`): a registry row for the candidate's
  // generation key is not enough — for a checklist slot (not 'other') it must
  // also be the CURRENT holder of that slot, i.e. the row `matchReceivedFiles`
  // itself would return for this request right now.
  isSiteVisitMaterialSlotCurrent: async ({ requestId, slot, artifactId }) => {
    if (slot === 'other') return true; // many 'other' files legitimately coexist; no single current holder.
    const request = await grantRequestAdapter.getById(requestId, { select: ['akoya_requestid', 'akoya_requestnum'] });
    // Throw (→ the sweep RETAINS) rather than return false (→ discard) when the
    // request cannot be resolved: an unreadable request is not proof of an
    // unbound file.
    if (!request?.akoya_requestnum) throw new Error(`site-visit slot proof: request ${requestId} has no akoya_requestnum`);
    const documents = await requestDocumentAdapter.findByRequest(requestId);
    const { received } = matchReceivedFiles(documents?.records, requestId, request.akoya_requestnum);
    const current = received[slot];
    return Boolean(current?.artifactId) && String(current.artifactId).toLowerCase() === String(artifactId).toLowerCase();
  },
});

async function safeDiscard(candidate, row, dependencies) {
  try {
    const discarded = await dependencies.discardCandidate(candidate);
    if (!discarded) {
      console.warn('[portal-upload-staging] candidate discard reported failure; retaining', { id: row.id, scope: row.scope });
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[portal-upload-staging] candidate discard threw; retaining', { id: row.id, scope: row.scope, message: error?.message });
    return false;
  }
}

/**
 * `consultant_feedback` scope: bound iff a registry row with the candidate's
 * generation key exists AND a `consultant_feedback` row (active or deleting —
 * a `deleting` row's own three-step owns the supersede, so the sweep must not
 * race it) references that registry row. Unbound with a Ready registry row:
 * supersede FIRST, then discard; either failing retains the row. Unbound with
 * no registry row: discard directly.
 */
async function reconcileConsultantFeedbackCandidate(row, candidate, dependencies) {
  const generationKey = typeof candidate?.generationKey === 'string' ? candidate.generationKey : '';
  if (!generationKey) {
    console.warn('[portal-upload-staging] unrecognised candidate retained', { id: row.id, scope: row.scope });
    return { action: 'retain' };
  }
  let registry;
  try {
    registry = await dependencies.findDocumentByGenerationKey(generationKey);
  } catch (error) {
    console.warn('[portal-upload-staging] registry lookup failed; retaining', { id: row.id, message: error?.message });
    return { action: 'retain' };
  }
  const records = registry?.records || [];
  if (records.length > 1) {
    // Ambiguous — never guess which row is authoritative; never discard.
    console.warn('[portal-upload-staging] ambiguous generation-key match retained', { id: row.id, count: records.length });
    return { action: 'retain' };
  }
  const registryRow = records.length === 1 ? records[0] : null;
  if (!registryRow) {
    // Crash after the Graph upload (step 5) but before the registry create
    // (step 6): nothing to supersede, just discard the orphaned Graph item.
    return (await safeDiscard(candidate, row, dependencies)) ? { action: 'cleared' } : { action: 'retain' };
  }
  const registryId = registryRow.wmkf_requestdocumentid;
  let bound;
  try {
    bound = await dependencies.isConsultantFeedbackBound(registryId);
  } catch (error) {
    console.warn('[portal-upload-staging] binding check failed; retaining', { id: row.id, message: error?.message });
    return { action: 'retain' };
  }
  if (bound) return { action: 'bound' };
  try {
    await dependencies.supersedeDocument(registryId);
  } catch (error) {
    console.warn('[portal-upload-staging] supersede failed; retaining', { id: row.id, message: error?.message });
    return { action: 'retain' };
  }
  return (await safeDiscard(candidate, row, dependencies)) ? { action: 'cleared' } : { action: 'retain' };
}

/**
 * `site_visit_material` scope: bound iff a registry row for the candidate's
 * generation key exists AND (for a checklist slot, not 'other') that row is
 * the CURRENT holder of its slot — mirrors `contributor-service.js`'s
 * `replayIsBound` + `matchReceivedFiles`. A row that exists but lost its slot
 * to a later upload (superseded) is unbound and its candidate is discarded.
 */
async function reconcileSiteVisitMaterialCandidate(row, candidate, dependencies) {
  const generationKey = typeof candidate?.generationKey === 'string' ? candidate.generationKey : '';
  const slot = typeof candidate?.slot === 'string' ? candidate.slot : '';
  if (!generationKey || !slot) {
    console.warn('[portal-upload-staging] unrecognised candidate retained', { id: row.id, scope: row.scope });
    return { action: 'retain' };
  }
  let registry;
  try {
    registry = await dependencies.findDocumentByGenerationKey(generationKey);
  } catch (error) {
    console.warn('[portal-upload-staging] registry lookup failed; retaining', { id: row.id, message: error?.message });
    return { action: 'retain' };
  }
  const records = registry?.records || [];
  if (records.length > 1) {
    console.warn('[portal-upload-staging] ambiguous generation-key match retained', { id: row.id, count: records.length });
    return { action: 'retain' };
  }
  const registryRow = records.length === 1 ? records[0] : null;
  if (!registryRow) {
    return (await safeDiscard(candidate, row, dependencies)) ? { action: 'cleared' } : { action: 'retain' };
  }
  let current;
  try {
    current = await dependencies.isSiteVisitMaterialSlotCurrent({
      requestId: row.resource_id, slot, artifactId: registryRow.wmkf_requestdocumentid,
    });
  } catch (error) {
    console.warn('[portal-upload-staging] slot-currency check failed; retaining', { id: row.id, message: error?.message });
    return { action: 'retain' };
  }
  if (current) return { action: 'bound' };
  return (await safeDiscard(candidate, row, dependencies)) ? { action: 'cleared' } : { action: 'retain' };
}

/**
 * `grantee_image`/`staff_grantee_image` scopes: bound iff the candidate's
 * `imageRef` equals the deliverable's CURRENT `wmkf_imagefileref` for the
 * staging row's request — the same check both the external submit route and
 * the staff replace-submission route run inline at finalize time.
 */
async function reconcileGranteeImageCandidate(row, candidate, dependencies) {
  const imageRef = typeof candidate?.imageRef === 'string' ? candidate.imageRef : '';
  if (!imageRef) {
    console.warn('[portal-upload-staging] unrecognised candidate retained', { id: row.id, scope: row.scope });
    return { action: 'retain' };
  }
  let deliverable;
  try {
    deliverable = await dependencies.getGranteeDeliverable(row.resource_id);
  } catch (error) {
    console.warn('[portal-upload-staging] deliverable lookup failed; retaining', { id: row.id, message: error?.message });
    return { action: 'retain' };
  }
  if (deliverable?.wmkf_imagefileref === imageRef) return { action: 'bound' };
  return (await safeDiscard(candidate, row, dependencies)) ? { action: 'cleared' } : { action: 'retain' };
}

/**
 * Per-scope binding proof (plan §4 "Slice 2 prerequisite", Codex AR-3):
 * candidate shapes differ per scope, so one lookup cannot serve every scope.
 * Any shape this function does not recognise is retained and logged, never
 * discarded.
 */
async function reconcileCandidate(row, dependencies) {
  const candidate = row.candidate_result;
  if (candidate == null) return { action: 'none' };
  if (row.status === 'consumed') {
    // Step 8 (`completePortalUpload`) only ever runs after the domain write
    // (registry create + entry bind, or the equivalent for other scopes)
    // already committed — a consumed row's candidate is bound by
    // construction, with no Dataverse round-trip needed to prove it. This is
    // also what makes the row eligible to be pruned like any other consumed
    // row once its candidate is cleared below.
    return { action: 'bound' };
  }
  if (row.scope === PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK) {
    return reconcileConsultantFeedbackCandidate(row, candidate, dependencies);
  }
  if (row.scope === PORTAL_UPLOAD_SCOPES.SITE_VISIT_MATERIAL) {
    return reconcileSiteVisitMaterialCandidate(row, candidate, dependencies);
  }
  if (row.scope === PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE || row.scope === PORTAL_UPLOAD_SCOPES.STAFF_GRANTEE_IMAGE) {
    return reconcileGranteeImageCandidate(row, candidate, dependencies);
  }
  console.warn('[portal-upload-staging] unrecognised candidate retained', { id: row.id, scope: row.scope });
  return { action: 'retain' };
}

export async function cleanupExpiredPortalUploads({ retentionDays = 7 } = {}, dependencies = DEFAULT_CLEANUP_DEPENDENCIES) {
  // Resolve once and fail the whole maintenance subtask if the store credential
  // is absent. Advancing/pruning ledger rows without the ability to delete their
  // bytes would erase the only exact cleanup authority and strand objects.
  const token = uploadsBlobToken();
  const eligible = await sql`
    SELECT id, pathname, scope, status, resource_id, candidate_result
      FROM portal_upload_staging
     WHERE expires_at < NOW()
       AND NOT (status = 'finalizing' AND lease_expires_at >= NOW())
     ORDER BY expires_at ASC
     LIMIT 500
  `;
  let deleted = 0;
  let errors = 0;
  let retained = 0;
  for (const row of eligible.rows) {
    if (row.candidate_result != null) {
      const outcome = await reconcileCandidate(row, dependencies);
      if (outcome.action === 'retain') {
        retained += 1;
        continue;
      }
      if (outcome.action === 'cleared' || outcome.action === 'bound') {
        // A proven-bound candidate (including every 'consumed' row) is
        // cleared here too: the prune query below only removes terminal rows
        // with `candidate_result IS NULL`, so leaving it set on a legitimate
        // bound row would silently exempt every such row from ever being
        // pruned — the regression this fixes.
        await sql`
          UPDATE portal_upload_staging
             SET candidate_result = NULL, updated_at = NOW()
           WHERE id = ${row.id}
             AND NOT (status = 'finalizing' AND lease_expires_at >= NOW())
        `;
      }
    }
    let blobSettled = false;
    try {
      await del(row.pathname, { token });
      blobSettled = true;
    } catch (error) {
      // Blob-not-found errors vary by SDK version; deleting an already-absent
      // object is the desired state. Only retain a diagnostic count here.
      if (error?.name === 'BlobNotFoundError') blobSettled = true;
      else errors += 1;
    }
    await sql`
      UPDATE portal_upload_staging
         SET status = CASE WHEN status = 'consumed' THEN status ELSE 'expired' END,
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = NOW()
       WHERE id = ${row.id}
         AND NOT (status = 'finalizing' AND lease_expires_at >= NOW())
    `;
    if (blobSettled) deleted += 1;
  }
  const pruned = await sql`
    DELETE FROM portal_upload_staging
     WHERE updated_at < NOW() - (${retentionDays} * INTERVAL '1 day')
       AND status IN ('consumed', 'rejected', 'expired')
       AND candidate_result IS NULL
  `;
  return { deleted, pruned: pruned.rowCount || 0, errors, retained };
}
