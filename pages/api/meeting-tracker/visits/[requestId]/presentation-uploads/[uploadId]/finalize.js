/** Finalize one private staged transcript into SharePoint and Request Document. */
import { requireAppAccess } from '../../../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../../../shared/config/meetingTracker';
import {
  finalizeMp4Upload,
  finalizeTranscriptUpload,
} from '../../../../../../../lib/services/post-presentation-materials/material-service';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  claimPortalUpload,
  completePortalUpload,
  loadClaimedPortalDocument,
  rejectPortalUpload,
  releasePortalUpload,
  staffActorBinding,
} from '../../../../../../../lib/services/portal-upload-staging';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 300 };

const PERMANENT_BYTE_CODES = new Set([
  'empty_file',
  'file_too_large',
  'staged_upload_mismatch',
  'staging_publicly_readable',
]);
const PERMANENT_RESULT_CODES = new Set([
  'filename_required',
  'invalid_size',
  'file_too_large',
  'extension_not_allowed',
  'content_type_mismatch',
  'vtt_header_invalid',
  'signature_mismatch',
  'post_presentation_content_mismatch',
  'post_presentation_candidate_mismatch',
  'post_presentation_replay_mismatch',
  'post_presentation_generation_ambiguous',
  'scan_infected',
]);

function emptyBody(body) {
  return body == null || body === ''
    || (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);
}

async function settleStaging(operation, args, label) {
  try {
    await operation(args);
  } catch (error) {
    // Settlement is maintenance on an already-classified outcome. Preserve the
    // original HTTP contract; the lease/expiry sweep remains authoritative.
    console.error(`[meeting tracker transcript ${label}] staging settlement failed:`, error?.message || error);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const stagingId = Array.isArray(req.query.uploadId) ? '' : String(req.query.uploadId || '').trim();
  if (!isGuid(requestId) || !isGuid(stagingId) || !emptyBody(req.body)) {
    return res.status(400).json({ error: 'A valid transcript finalize request is required.' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!isMeetingTrackerSchemaReady()) {
    return res.status(503).json({
      error: 'Meeting Tracker is not enabled for this environment.',
      code: 'meeting_tracker_schema_not_ready',
    });
  }
  res.setHeader('Cache-Control', 'private, no-store');

  const actorId = actorRefFromSession(access.session);
  try {
    const result = await withDalContext('meeting-tracker-presentation-mp4-finalize', () =>
      finalizeMp4Upload({ requestId, uploadId: stagingId, actingUserSystemId: actorId }));
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (!(error instanceof ServiceHttpError) || error.code !== 'post_presentation_upload_not_found') {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body || { error: error.message, code: error.code });
      }
      console.error('[meeting tracker recording upload finalize] failed:', error?.message || error);
      return res.status(503).json({ error: 'The recording upload could not be finalized.' });
    }
  }

  let claim;
  try {
    claim = await claimPortalUpload({
      stagingId,
      scope: PORTAL_UPLOAD_SCOPES.POST_PRESENTATION_TRANSCRIPT,
      resourceId: requestId,
      actorBinding: staffActorBinding(access.profileId),
    });
  } catch (error) {
    if (error instanceof PortalUploadStagingError) {
      return res.status(error.httpStatus).json({ error: error.code, code: error.code });
    }
    throw error;
  }
  if (claim.state === 'consumed') return res.status(200).json(claim.result || { success: true });

  let file;
  try {
    file = await loadClaimedPortalDocument({ row: claim.row, leaseToken: claim.leaseToken });
  } catch (error) {
    if (!(error instanceof PortalUploadStagingError)) throw error;
    if (PERMANENT_BYTE_CODES.has(error.code)) {
      await settleStaging(rejectPortalUpload, {
        stagingId, leaseToken: claim.leaseToken, resultCode: error.code,
      }, 'reject');
    } else {
      await settleStaging(releasePortalUpload, {
        stagingId, leaseToken: claim.leaseToken,
      }, 'release');
    }
    return res.status(error.httpStatus).json({ error: error.code, code: error.code });
  }
  file.leaseToken = claim.leaseToken;
  file.candidate = claim.row?.candidate_result || null;

  try {
    const result = await withDalContext('meeting-tracker-presentation-upload-finalize', () =>
      finalizeTranscriptUpload({
        requestId,
        stagingId,
        actorProfileId: access.profileId,
        actingUserSystemId: actorId,
        file,
      }));
    const body = { success: true, ...result };
    try {
      await completePortalUpload({
        stagingId,
        leaseToken: claim.leaseToken,
        resultCode: 'ok',
        resultPayload: body,
      });
      return res.status(200).json(body);
    } catch (error) {
      // Domain writes already committed. Release for an immediate retry: the
      // persisted candidate + generation key make replay idempotent, and the
      // retry only durably stores this same concrete result.
      await settleStaging(releasePortalUpload, {
        stagingId, leaseToken: claim.leaseToken,
      }, 'completion-release');
      console.error('[meeting tracker transcript completion] failed:', error?.message || error);
      return res.status(503).json({
        error: 'The transcript was saved but its completion receipt could not be stored. Retry finalize.',
        code: 'staging_completion_failed',
      });
    }
  } catch (error) {
    if (error instanceof PortalUploadStagingError) {
      await settleStaging(releasePortalUpload, {
        stagingId, leaseToken: claim.leaseToken,
      }, 'release');
      return res.status(error.httpStatus).json({ error: error.code, code: error.code });
    }
    if (error instanceof ServiceHttpError) {
      const code = error.code || 'post_presentation_finalize_failed';
      if (PERMANENT_RESULT_CODES.has(code)) {
        await settleStaging(rejectPortalUpload, {
          stagingId, leaseToken: claim.leaseToken, resultCode: code,
        }, 'reject');
      } else {
        await settleStaging(releasePortalUpload, {
          stagingId, leaseToken: claim.leaseToken,
        }, 'release');
      }
      return res.status(error.httpStatus).json(error.body || { error: error.message, code });
    }
    await settleStaging(releasePortalUpload, {
      stagingId, leaseToken: claim.leaseToken,
    }, 'release');
    console.error('[meeting tracker transcript upload finalize] failed:', error?.message || error);
    return res.status(503).json({ error: 'The transcript upload could not be finalized.' });
  }
}
