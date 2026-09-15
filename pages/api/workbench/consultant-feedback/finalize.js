/**
 * POST /api/workbench/consultant-feedback/finalize
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3.4, §4 lifecycle steps
 * 3-8, §5)
 *
 * Reauthorizes independently: staff app access, then the staging row's full
 * ownership tuple (staging id, scope, request id, actor binding). Claims the
 * lease, downloads only the staged bytes, scans when enabled, then hands off
 * to `finalizeAttachmentUpload` for the Graph upload / registry create /
 * feedback bind. A consumed row replays its stored result; permanent byte or
 * bind problems reject the row, transient ones release it for retry.
 */
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { finalizeAttachmentUpload } from '../../../../lib/services/consultant-feedback-attachment-service';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  claimPortalUpload,
  completePortalUpload,
  loadClaimedPortalImage,
  rejectPortalUpload,
  releasePortalUpload,
  staffActorBinding,
} from '../../../../lib/services/portal-upload-staging';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 300 };

const PERMANENT_BYTE_CODES = new Set(['empty_image', 'image_too_large', 'staged_upload_mismatch', 'staging_publicly_readable']);
// `folder_unavailable` (the request's SharePoint bucket lookup came back
// empty) is a transient outage, not permanent — it is deliberately NOT in
// this set, so the staging row is released for retry rather than rejected.
const PERMANENT_RESULT_CODES = new Set([
  'scan_infected', 'attachment_conflict', 'invalid_bind_target',
  'upload_unconfirmed', 'registry_unconfirmed', 'attachment_replay_dead', 'attachment_replay_ambiguous',
  'attachment_target_gone',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const stagingId = typeof req.body?.stagingId === 'string' ? req.body.stagingId.trim() : '';
  const entryId = req.body?.entryId != null ? req.body.entryId : null;
  const newEntry = req.body && typeof req.body.newEntry === 'object' && req.body.newEntry !== null ? req.body.newEntry : null;
  if (!isGuid(requestId) || !isGuid(stagingId)) return res.status(400).json({ ok: false, reason: 'bad_request' });
  if (Boolean(entryId) === Boolean(newEntry)) return res.status(400).json({ ok: false, reason: 'invalid_bind_target' });

  let claim;
  try {
    claim = await claimPortalUpload({
      stagingId,
      scope: PORTAL_UPLOAD_SCOPES.CONSULTANT_FEEDBACK,
      resourceId: requestId,
      actorBinding: staffActorBinding(access.profileId),
    });
  } catch (error) {
    if (error instanceof PortalUploadStagingError) return res.status(error.httpStatus).json({ ok: false, reason: error.code });
    throw error;
  }
  if (claim.state === 'consumed') return res.status(200).json(claim.result || { ok: true });

  let file;
  try {
    file = await loadClaimedPortalImage({ row: claim.row, leaseToken: claim.leaseToken });
  } catch (error) {
    if (!(error instanceof PortalUploadStagingError)) throw error;
    if (PERMANENT_BYTE_CODES.has(error.code)) await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: error.code });
    else await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
    return res.status(error.httpStatus).json({ ok: false, reason: error.code });
  }
  file.leaseToken = claim.leaseToken;
  // Step-5 recovery: hand the ALREADY-claimed row's recorded candidate (if
  // any) to the service so a retry can reuse or discard it rather than
  // uploading over it silently.
  file.candidate = claim.row?.candidate_result || null;

  try {
    const result = await withDalContext('workbench-consultant-feedback-finalize', () =>
      finalizeAttachmentUpload({
        requestId,
        actorProfileId: access.profileId,
        file,
        stagingId,
        entryId: entryId != null ? Number(entryId) : null,
        newEntry,
      }));
    const body = { ok: true, ...result };
    await completePortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: 'ok', resultPayload: body });
    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      const code = error.code || error.body?.reason || 'persist_failed';
      if (PERMANENT_RESULT_CODES.has(code)) await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: code });
      else await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
      return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: code });
    }
    await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
    console.error('[consultant-feedback/finalize] failed:', error?.message || error);
    return res.status(503).json({ ok: false, reason: 'persist_failed' });
  }
}
