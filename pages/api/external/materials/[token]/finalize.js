/**
 * POST /api/external/materials/[token]/finalize — turn one claimed staged
 * upload into the request's SharePoint file and registry row. Re-verifies the
 * link, claims the staging row by the full ownership tuple, downloads only
 * its persisted path, validates and scans the bytes, then persists. A
 * consumed row replays its stored result; permanent byte problems reject the
 * row, transient ones release it for retry.
 */
import { verifyMaterialsToken } from '../../../../../lib/external/verify-materials-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { finalizeMaterialUpload } from '../../../../../lib/services/site-visit-materials/contributor-service';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  claimPortalUpload,
  completePortalUpload,
  externalMaterialsActorBinding,
  loadClaimedPortalImage,
  rejectPortalUpload,
  releasePortalUpload,
} from '../../../../../lib/services/portal-upload-staging';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 300 };

const PERMANENT_BYTE_CODES = new Set(['empty_image', 'image_too_large', 'staged_upload_mismatch', 'staging_publicly_readable']);
const PERMANENT_RESULT_CODES = new Set(['file_too_large', 'extension_not_allowed', 'signature_mismatch', 'empty_file', 'scan_infected', 'slot_not_open', 'unknown_slot', 'filename_required']);
const HOLD_STAGING_CODES = new Set(['replay_ambiguous']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  const { token } = req.query;
  const rl = await checkRateLimit(req, token);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const verified = await verifyMaterialsToken(token);
  await recordTokenOutcome(req, token, verified.ok);
  if (!verified.ok) return res.status(verified.reason === 'not_found' ? 404 : 401).json({ ok: false, reason: verified.reason });

  const stagingId = typeof req.body?.stagingId === 'string' ? req.body.stagingId.trim() : '';
  const slot = typeof req.body?.slot === 'string' ? req.body.slot : '';
  if (!isGuid(stagingId) || !slot) return res.status(400).json({ ok: false, reason: 'bad_request' });

  let claim;
  try {
    claim = await claimPortalUpload({
      stagingId,
      scope: PORTAL_UPLOAD_SCOPES.SITE_VISIT_MATERIAL,
      resourceId: verified.requestId,
      actorBinding: externalMaterialsActorBinding(token),
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
    const reason = error.code === 'empty_image' ? 'empty_file' : error.code === 'image_too_large' ? 'file_too_large' : error.code;
    return res.status(error.httpStatus).json({ ok: false, reason });
  }

  try {
    const result = await withDalContext('external-materials-finalize', () =>
      finalizeMaterialUpload({
        collection: verified.collection,
        slotKey: slot,
        file,
        stagingId,
        leaseToken: claim.leaseToken,
        candidateResult: claim.row?.candidate_result || null,
      }));
    const body = { ok: true, slot: result.slot, filename: result.filename, receivedAt: result.receivedAt };
    await completePortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: 'ok', resultPayload: body });
    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      const code = error.code || error.body?.reason || 'persist_failed';
      if (PERMANENT_RESULT_CODES.has(code)) await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: code });
      else if (!HOLD_STAGING_CODES.has(code)) await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
      return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: code });
    }
    await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
    console.error('[materials/finalize] failed:', error?.message || error);
    return res.status(503).json({ ok: false, reason: 'persist_failed' });
  }
}
