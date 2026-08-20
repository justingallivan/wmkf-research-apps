/**
 * POST /api/workbench/grantee-deliverables/replace-submission
 *
 * Small-JSON staff finalizer. Optional replacement image bytes are staged by
 * replacement-upload-token and never traverse this Function request body.
 * Caption-only edits remain supported with no staging id.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { getDeliverableForRequest } from '../../../../lib/services/grantee-deliverable-record';
import { replaceGranteeSubmission } from '../../../../lib/services/workbench/grantee-deliverables/replace-submission-service';
import { MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH } from '../../../../shared/config/granteeAbstract';
import {
  GRANTEE_DELIVERABLE_LABEL,
} from '../../../../shared/config/granteeDeliverableStatus';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  claimPortalUpload,
  clearPortalUploadCandidate,
  completePortalUpload,
  discardPortalUploadCandidate,
  loadClaimedPortalImage,
  recordPortalUploadCandidate,
  rejectPortalUpload,
  releasePortalUpload,
  staffActorBinding,
} from '../../../../lib/services/portal-upload-staging';

function statusLabelOf(status) {
  const normalized = status === null || status === undefined || status === '' ? null : Number(status);
  return normalized === null ? null : (GRANTEE_DELIVERABLE_LABEL[normalized] || null);
}

function currentBody(deliverable) {
  const status = deliverable?.wmkf_deliverablestatus === null
    || deliverable?.wmkf_deliverablestatus === undefined
    ? null
    : Number(deliverable.wmkf_deliverablestatus);
  return {
    ok: true,
    caption: deliverable?.wmkf_imagecaption || null,
    imageRef: deliverable?.wmkf_imagefileref || null,
    etag: deliverable?._etag || null,
    status,
    statusLabel: statusLabelOf(status),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });

  const hasCaption = Object.prototype.hasOwnProperty.call(req.body || {}, 'caption');
  const caption = hasCaption ? String(req.body.caption ?? '') : null;
  if (caption !== null && caption.length > MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH) {
    return res.status(400).json({ error: `The caption is too long (max ${MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH} characters).` });
  }
  const clientEtag = typeof req.body?.etag === 'string' ? req.body.etag.trim() : '';
  if (!clientEtag) return res.status(400).json({ error: 'etag is required for a conditional replace' });
  const stagingId = typeof req.body?.stagingId === 'string' ? req.body.stagingId.trim() : '';
  if (stagingId && !isGuid(stagingId)) return res.status(400).json({ error: 'stagingId must be a GUID' });
  if (caption === null && !stagingId) {
    return res.status(400).json({ error: 'Provide a new image, a new caption, or both.' });
  }

  return withDalContext('grantee-submission-replace', async () => {
    let claim = null;
    let imageFile = null;
    try {
      if (stagingId) {
        claim = await claimPortalUpload({
          stagingId,
          scope: PORTAL_UPLOAD_SCOPES.STAFF_GRANTEE_IMAGE,
          resourceId: requestId,
          actorBinding: staffActorBinding(access.profileId),
        });
        if (claim.state === 'consumed') {
          return res.status(200).json(claim.result || { ok: true });
        }

        const current = await getDeliverableForRequest(requestId);
        const candidate = claim.row.candidate_result;
        if (candidate?.imageRef) {
          if (current?.wmkf_imagefileref === candidate.imageRef) {
            const body = currentBody(current);
            await completePortalUpload({
              stagingId,
              leaseToken: claim.leaseToken,
              resultCode: 'reconciled',
              resultPayload: body,
            });
            return res.status(200).json(body);
          }
          const discarded = await discardPortalUploadCandidate(candidate);
          if (!discarded) {
            await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
            return res.status(503).json({ code: 'reconciliation_unavailable', error: 'Could not safely reconcile the prior save. Please try again shortly.' });
          }
          await clearPortalUploadCandidate({ stagingId, leaseToken: claim.leaseToken });
        }

        if (claim.row.original_etag && claim.row.original_etag !== current?._etag) {
          await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: 'stale' });
          return res.status(409).json({ code: 'stale', error: 'This package changed since you loaded it. Reload and re-apply your change.' });
        }
        imageFile = await loadClaimedPortalImage({ row: claim.row, leaseToken: claim.leaseToken });
      }

      const body = await replaceGranteeSubmission({
        requestId,
        caption,
        imageFile,
        clientEtag,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
        onCandidateUploaded: claim
          ? (candidate) => recordPortalUploadCandidate({
            stagingId,
            leaseToken: claim.leaseToken,
            candidate,
          })
          : null,
      });
      if (claim) {
        await completePortalUpload({
          stagingId,
          leaseToken: claim.leaseToken,
          resultCode: 'ok',
          resultPayload: body,
        });
      }
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof PortalUploadStagingError) {
        if (claim?.state === 'claimed') {
          const permanent = [
            'empty_image', 'image_too_large', 'staged_upload_mismatch', 'staging_publicly_readable',
          ].includes(error.code);
          if (permanent) {
            await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: error.code });
          } else {
            await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
          }
        }
        return res.status(error.httpStatus).json({ code: error.code, error: 'Could not read the staged image.' });
      }
      if (error instanceof ServiceHttpError) {
        if (claim?.state === 'claimed') {
          const permanent = ['stale', 'not_replaceable'].includes(error.code);
          if (permanent) {
            await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: error.code });
          } else {
            await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
          }
        }
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      if (claim?.state === 'claimed') {
        // Preserve candidate_result and let the lease expire. A retry will first
        // reconcile whether the downstream write committed before doing anything.
        console.error('[grantee-deliverables/replace-submission] finalize left for reconciliation:', error?.message || error);
      } else {
        console.error('[grantee-deliverables/replace-submission] error:', error);
      }
      return res.status(500).json({ error: 'Failed to save the replacement.' });
    }
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};
