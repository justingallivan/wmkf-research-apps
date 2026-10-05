/**
 * POST /api/meeting-tracker/visits/[requestId]/materials/staff-finalize — turn
 * one staff-staged upload into the request's SharePoint file and registry row
 * (docs/plans/STAFF_APPLICANT_MATERIALS_REPLACEMENT_PLAN_2026-10-05.md §3.1-3.3).
 * Always inline: a staff upload never enqueues a background job, never reopens
 * the applicant link, and records the session's Dynamics system user as the
 * uploader. The staging row is claimed by the full ownership tuple (scope,
 * request, staff binding); the collection is re-read server-side.
 */
import { requireAppAccess } from '../../../../../../lib/utils/auth';
import { withDalContext } from '../../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../../shared/config/meetingTracker';
import { isSiteVisitMaterialsSchemaReady } from '../../../../../../lib/utils/site-visit-materials-readiness';
import { sanitizeSiteVisitMaterialsScanRejection } from '../../../../../../shared/utils/site-visit-materials-scan-rejection.js';
import { finalizeMaterialUpload } from '../../../../../../lib/services/site-visit-materials/contributor-service';
import {
  getLatestCollectionForRequest,
  getOpenCollectionForRequest,
} from '../../../../../../lib/services/site-visit-materials/collection-store';
import {
  acquireLargeUploadAdmission,
  LARGE_UPLOAD_RETRY_AFTER_SECONDS,
  releaseLargeUploadAdmission,
} from '../../../../../../lib/services/large-upload-admission';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  claimPortalUpload,
  completePortalUpload,
  loadClaimedPortalImage,
  rejectPortalUpload,
  releasePortalUpload,
  staffActorBinding,
} from '../../../../../../lib/services/portal-upload-staging';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 300 };

const BODY_KEYS = new Set(['stagingId', 'slot']);
const PERMANENT_BYTE_CODES = new Set(['empty_image', 'image_too_large', 'file_too_large', 'staged_upload_missing', 'staged_upload_mismatch', 'staging_publicly_readable']);
const PERMANENT_RESULT_CODES = new Set(['file_too_large', 'extension_not_allowed', 'signature_mismatch', 'empty_file', 'scan_infected', 'slot_not_open', 'unknown_slot', 'filename_required', 'uploader_invalid']);
const HOLD_STAGING_CODES = new Set(['replay_ambiguous']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ ok: false, reason: 'bad_request' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!isMeetingTrackerSchemaReady() || !isSiteVisitMaterialsSchemaReady()) {
    return res.status(503).json({ ok: false, reason: 'site_visit_materials_schema_not_ready' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).every((key) => BODY_KEYS.has(key))) {
    return res.status(400).json({ ok: false, reason: 'bad_request' });
  }
  const stagingId = typeof body.stagingId === 'string' ? body.stagingId.trim() : '';
  const slot = typeof body.slot === 'string' ? body.slot : '';
  if (!isGuid(stagingId) || !slot) return res.status(400).json({ ok: false, reason: 'bad_request' });
  // The registry row records who uploaded; without a Dynamics system user the
  // REQUIRED actor policy would refuse after the bytes were scanned and stored.
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  if (!isGuid(actingUserSystemId || '')) {
    return res.status(403).json({ ok: false, reason: 'staff_actor_unavailable', error: 'Your account is not linked to a Dynamics user, so the upload cannot be recorded.' });
  }

  const admission = acquireLargeUploadAdmission();
  if (!admission) {
    res.setHeader('Retry-After', String(LARGE_UPLOAD_RETRY_AFTER_SECONDS));
    return res.status(503).json({
      ok: false,
      reason: 'processing_busy',
      retryAfterSeconds: LARGE_UPLOAD_RETRY_AFTER_SECONDS,
      message: 'Another large upload is being processed. Please wait and try again.',
    });
  }

  try {
    return await withDalContext('meeting-tracker-materials-staff-finalize', async () => {
      const collection = (await getOpenCollectionForRequest(requestId)) || (await getLatestCollectionForRequest(requestId));
      if (!collection) return res.status(404).json({ ok: false, reason: 'site_visit_materials_missing' });

      let claim;
      try {
        claim = await claimPortalUpload({
          stagingId,
          scope: PORTAL_UPLOAD_SCOPES.SITE_VISIT_MATERIAL,
          resourceId: requestId,
          actorBinding: staffActorBinding(access.profileId),
        });
      } catch (error) {
        if (error instanceof PortalUploadStagingError) {
          if (error.code === 'scan_infected') {
            const scanRejection = sanitizeSiteVisitMaterialsScanRejection(error.resultPayload?.scanRejection)
              || { category: 'unspecified', flags: [] };
            return res.status(422).json({ ok: false, reason: 'scan_infected', scanRejection });
          }
          return res.status(error.httpStatus).json({ ok: false, reason: error.code });
        }
        throw error;
      }
      if (claim.state === 'consumed') return res.status(200).json(claim.result || { ok: true });

      let file;
      try {
        file = await loadClaimedPortalImage({ row: claim.row, leaseToken: claim.leaseToken });
      } catch (error) {
        if (!(error instanceof PortalUploadStagingError)) {
          await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
          throw error;
        }
        if (PERMANENT_BYTE_CODES.has(error.code)) await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: error.code });
        else await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
        const reason = error.code === 'empty_image' ? 'empty_file' : error.code === 'image_too_large' ? 'file_too_large' : error.code;
        return res.status(error.httpStatus).json({ ok: false, reason });
      }

      try {
        const result = await finalizeMaterialUpload({
          collection,
          slotKey: slot,
          file,
          stagingId,
          leaseToken: claim.leaseToken,
          candidateResult: claim.row?.candidate_result || null,
          uploader: { kind: 'staff', actingUserSystemId },
        });
        const responseBody = { ok: true, slot: result.slot, filename: result.filename, receivedAt: result.receivedAt };
        await completePortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: 'ok', resultPayload: responseBody });
        return res.status(200).json(responseBody);
      } catch (error) {
        if (error instanceof ServiceHttpError) {
          const code = error.code || error.body?.reason || 'persist_failed';
          if (PERMANENT_RESULT_CODES.has(code)) {
            await rejectPortalUpload({
              stagingId,
              leaseToken: claim.leaseToken,
              resultCode: code,
              ...(code === 'scan_infected' ? {
                resultPayload: {
                  ok: false,
                  reason: 'scan_infected',
                  scanRejection: sanitizeSiteVisitMaterialsScanRejection(error.body?.scanRejection)
                    || { category: 'unspecified', flags: [] },
                },
              } : {}),
            });
          } else if (!HOLD_STAGING_CODES.has(code)) {
            await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
          }
          if (code === 'scan_infected') {
            const scanRejection = sanitizeSiteVisitMaterialsScanRejection(error.body?.scanRejection)
              || { category: 'unspecified', flags: [] };
            return res.status(422).json({ ok: false, reason: 'scan_infected', scanRejection });
          }
          return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: code });
        }
        await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
        console.error('[materials/staff-finalize] persist failed:', error?.message || error);
        return res.status(503).json({ ok: false, reason: 'persist_failed' });
      }
    });
  } finally {
    releaseLargeUploadAdmission(admission.token);
  }
}
