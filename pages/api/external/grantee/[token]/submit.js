/**
 * POST /api/external/grantee/[token]/submit
 *
 * Small-JSON finalizer for the grantee deliverables portal. New image bytes are
 * uploaded browser → private Blob using /upload-token; this route re-verifies
 * token ownership, claims the staging row, downloads the exact private object,
 * and then runs the existing SharePoint + atomic Dataverse writer.
 */

import { verifyGranteeToken } from '../../../../../lib/external/verify-grantee-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { writeGranteeDeliverables } from '../../../../../lib/services/grantee-upload';
import { verifyWaiverRenderToken } from '../../../../../lib/services/external-token';
import { WAIVER_SLOT_CODE } from '../../../../../lib/external/grantee-waiver-policy';
import { isGuid } from '../../../../../lib/utils/guid';
import NotificationService from '../../../../../lib/services/notification-service';
import {
  GRANTEE_DELIVERABLE_STATUS,
  isGranteeEditableStatus,
} from '../../../../../shared/config/granteeDeliverableStatus';
import { notifyGranteeSubmission } from '../../../../../lib/services/grantee-submit-notification';
import { keepAlive } from '../../../../../lib/utils/keep-alive';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  claimPortalUpload,
  clearPortalUploadCandidate,
  completePortalUpload,
  discardPortalUploadCandidate,
  externalGranteeActorBinding,
  loadClaimedPortalImage,
  recordPortalUploadCandidate,
  rejectPortalUpload,
  releasePortalUpload,
} from '../../../../../lib/services/portal-upload-staging';

async function alertWaiverBlock({ requestId, detail }) {
  try {
    await withDalContext('grantee-waiver-alert', () => NotificationService.notify({
      type: 'grantee_waiver_block',
      severity: 'warning',
      emailAdmins: true,
      autoResolveKey: `grantee_waiver_block:${WAIVER_SLOT_CODE}`,
      title: 'Grantee waiver submit blocked (fail-closed)',
      message:
        `A grantee submission was blocked because the ${WAIVER_SLOT_CODE} waiver render token `
        + `failed verification (${detail}). Confirm the slot is seeded + active and the portal `
        + 'deploy matches the seeded environment.',
      metadata: { requestId, slotCode: WAIVER_SLOT_CODE, detail },
      source: 'grantee-waiver',
      category: 'ops',
    }));
  } catch (err) {
    console.error('[grantee/submit] waiver-block alert failed (non-fatal):', err?.message || err);
  }
}

const ALERTED_SUBMIT_FAILURE_REASONS = new Set([
  'sharepoint_failed',
  'scan_unavailable',
  'scan_misconfigured',
  'infected',
  'dataverse_failed',
  'reconciliation_unavailable',
]);

function imageMeta(imageFile) {
  if (!imageFile) return { present: false };
  const name = typeof imageFile.filename === 'string' ? imageFile.filename : '';
  const match = name.match(/\.([A-Za-z0-9]+)$/);
  return {
    present: true,
    extension: match ? match[1].toLowerCase() : null,
    declaredMime: imageFile.mimeType || null,
    sizeBytes: Buffer.isBuffer(imageFile.buffer) ? imageFile.buffer.length : null,
  };
}

async function alertSubmitFailure({ request, deliverable, imageFile, result }) {
  if (!ALERTED_SUBMIT_FAILURE_REASONS.has(result?.reason)) return;
  const requestId = request?.akoya_requestid || null;
  const requestNumber = request?.akoya_requestnum || null;
  const metadata = {
    reason: result.reason,
    status: result.status || null,
    requestId,
    requestNumber,
    deliverableId: deliverable?.wmkf_granteedeliverableid || null,
    deliverableStatus: deliverable?.wmkf_deliverablestatus ?? null,
    image: imageMeta(imageFile),
    diagnostics: result.diagnostics || null,
  };
  console.error('[grantee/submit] failure incident:', JSON.stringify(metadata));
  try {
    await withDalContext('grantee-submit-alert', () => NotificationService.notify({
      type: 'grantee_submit_failed',
      severity: result.reason === 'infected' ? 'warning' : 'error',
      emailAdmins: true,
      autoResolveKey: `grantee_submit_failed:${result.reason}:${requestId || 'unknown'}`,
      title: `Grantee submit failed (${result.reason})`,
      message:
        `A grantee deliverables submission failed for request ${requestNumber || requestId || 'unknown'} `
        + `with reason ${result.reason}. Check the sanitized metadata for the upload/write stage and cleanup outcome.`,
      metadata,
      source: 'grantee-submit',
      category: 'grantee-deliverables',
    }));
  } catch (err) {
    console.error('[grantee/submit] failure alert failed (non-fatal):', err?.message || err);
  }
}

function stagingErrorResponse(res, error) {
  if (error instanceof PortalUploadStagingError) {
    return res.status(error.httpStatus).json({ ok: false, reason: error.code });
  }
  throw error;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const token = req.query.token;
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }

    const verified = await withDalContext('grantee-token-verify', () => verifyGranteeToken(token));
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401)
        .json({ ok: false, reason: verified.reason });
    }

    const { request, deliverable } = verified;
    const editedAbstract = typeof req.body?.editedAbstract === 'string' ? req.body.editedAbstract : '';
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : '';
    const waiverToken = typeof req.body?.waiverToken === 'string' ? req.body.waiverToken : '';
    const stagingId = typeof req.body?.stagingId === 'string' ? req.body.stagingId.trim() : '';
    if (stagingId && !isGuid(stagingId)) {
      return res.status(400).json({ ok: false, reason: 'bad_request' });
    }

    let claim = null;
    let imageFile = null;
    if (stagingId) {
      try {
        claim = await claimPortalUpload({
          stagingId,
          scope: PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
          resourceId: verified.requestId,
          actorBinding: externalGranteeActorBinding(token),
        });
      } catch (error) {
        return stagingErrorResponse(res, error);
      }
      if (claim.state === 'consumed') {
        return res.status(200).json(claim.result || { ok: true });
      }

      const candidate = claim.row.candidate_result;
      if (candidate?.imageRef) {
        const committed = deliverable?.wmkf_imagefileref === candidate.imageRef
          && Number(deliverable?.wmkf_deliverablestatus) === GRANTEE_DELIVERABLE_STATUS.SUBMITTED;
        if (committed) {
          const body = { ok: true };
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
          const result = { ok: false, reason: 'reconciliation_unavailable', status: 503 };
          await alertSubmitFailure({ request, deliverable, imageFile: null, result });
          return res.status(503).json({ ok: false, reason: result.reason });
        }
        await clearPortalUploadCandidate({ stagingId, leaseToken: claim.leaseToken });
      }

      if (claim.row.original_etag && claim.row.original_etag !== deliverable?._etag) {
        await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: 'conflict' });
        return res.status(409).json({ ok: false, reason: 'conflict' });
      }
    }

    if (!isGranteeEditableStatus(deliverable?.wmkf_deliverablestatus)) {
      if (claim) {
        await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: 'not_editable' });
      }
      return res.status(409).json({ ok: false, reason: 'not_editable' });
    }

    const waiver = await verifyWaiverRenderToken(waiverToken);
    const waiverOk = waiver.valid
      && waiver.requestId === verified.requestId
      && isGuid(waiver.versionId);
    if (!waiverOk) {
      const clientStale = !waiver.valid && (waiver.reason === 'expired' || waiver.reason === 'no_token');
      if (!clientStale) {
        const detail = waiver.valid ? 'request_mismatch_or_bad_version' : waiver.reason;
        await alertWaiverBlock({ requestId: verified.requestId, detail });
      }
      if (claim) await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
      return res.status(409).json({ ok: false, reason: 'waiver_invalid' });
    }

    if (claim) {
      try {
        imageFile = await loadClaimedPortalImage({ row: claim.row, leaseToken: claim.leaseToken });
      } catch (error) {
        if (!(error instanceof PortalUploadStagingError)) throw error;
        const permanent = ['empty_image', 'image_too_large', 'staged_upload_mismatch'].includes(error.code);
        if (permanent) {
          await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: error.code });
        } else {
          await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
        }
        return res.status(error.httpStatus).json({ ok: false, reason: error.code });
      }
    }

    const result = await withDalContext('grantee-submit', () =>
      writeGranteeDeliverables({
        request,
        deliverable,
        editedAbstract,
        caption,
        imageFile,
        waiverVersionId: waiver.versionId,
        waiverBodyHash: waiver.bodyHash,
        onCandidateUploaded: claim
          ? (candidate) => recordPortalUploadCandidate({
            stagingId,
            leaseToken: claim.leaseToken,
            candidate,
          })
          : null,
      }));

    if (!result.ok) {
      if (claim) {
        const candidateAlreadyCleaned = result.reason === 'conflict'
          || result.reason === 'staging_failed'
          || result.diagnostics?.postErrorCommitState === 'not_committed';
        if (candidateAlreadyCleaned) {
          await clearPortalUploadCandidate({ stagingId, leaseToken: claim.leaseToken });
        }
        // Text validation can be corrected without uploading the same image again.
        // Reject only failures that make the staged bytes unusable or unsafe.
        const permanent = [
          'image_required', 'empty_image', 'image_too_large', 'image_invalid', 'infected',
          'conflict',
        ].includes(result.reason);
        if (permanent) {
          await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: result.reason });
        } else {
          await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
        }
      }
      await alertSubmitFailure({ request, deliverable, imageFile, result });
      return res.status(result.status || 500).json({ ok: false, reason: result.reason });
    }

    const responseBody = { ok: true };
    if (claim) {
      await completePortalUpload({
        stagingId,
        leaseToken: claim.leaseToken,
        resultCode: 'ok',
        resultPayload: responseBody,
      });
    }

    const notifying = notifyGranteeSubmission({
      requestId: verified.requestId,
      requestNum: request?.akoya_requestnum || null,
      title: request?.akoya_title || null,
      hasImage: Boolean(imageFile || deliverable?.wmkf_imagefileref),
      captionPresent: Boolean(caption && caption.trim()),
    });
    res.status(200).json(responseBody);
    await keepAlive(notifying);
    return undefined;
  } catch (e) {
    console.error('[grantee/submit] unexpected error:', e?.message || e);
    if (res.headersSent) return undefined;
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '128kb' } },
};
