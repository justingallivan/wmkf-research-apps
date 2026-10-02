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
import { isVirusScanEnabled } from '../../../../../lib/utils/virus-scan-config.js';
import { SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED } from '../../../../../shared/config/siteVisitMaterials.js';
import { getUploadMaxMb } from '../../../../../lib/services/site-visit-materials/upload-cap.js';
import {
  isMaterialsBackgroundAdmissionEnabled,
  isMaterialsBackgroundSchemaReady,
} from '../../../../../lib/utils/site-visit-materials-background-readiness.js';
import {
  enqueueMaterialsUploadJob,
  getMaterialsUploadJobForStaging,
  MaterialsJobConflict,
} from '../../../../../lib/services/site-visit-materials/background-job-store.js';
import {
  acquireLargeUploadAdmission,
  LARGE_UPLOAD_RETRY_AFTER_SECONDS,
  releaseLargeUploadAdmission,
} from '../../../../../lib/services/large-upload-admission';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  claimPortalUpload,
  completePortalUpload,
  externalMaterialsActorBinding,
  inspectClaimedPortalUploadMetadata,
  loadClaimedPortalImage,
  rejectPortalUpload,
  releasePortalUpload,
} from '../../../../../lib/services/portal-upload-staging';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 300 };

const PERMANENT_BYTE_CODES = new Set(['empty_image', 'image_too_large', 'file_too_large', 'staged_upload_missing', 'staged_upload_mismatch', 'staging_publicly_readable']);
const PERMANENT_RESULT_CODES = new Set(['file_too_large', 'extension_not_allowed', 'signature_mismatch', 'empty_file', 'scan_infected', 'slot_not_open', 'unknown_slot', 'filename_required']);
const HOLD_STAGING_CODES = new Set(['replay_ambiguous']);

function queuedJobResponse(res, job, stagingId) {
  if (job.status === 'completed') return res.status(200).json(job.result_payload || { ok: true });
  if (['queued', 'processing', 'needs_attention'].includes(job.status)) {
    return res.status(202).json({ ok: true, jobId: job.id, stagingId, status: job.status });
  }
  return res.status(409).json({ ok: false, jobId: job.id, stagingId, status: job.status, reason: job.error_code || job.status });
}

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

  const backgroundSchemaReady = isMaterialsBackgroundSchemaReady();
  const queueThisUpload = isMaterialsBackgroundAdmissionEnabled() && isVirusScanEnabled();
  if (backgroundSchemaReady) {
    const existing = await getMaterialsUploadJobForStaging({
      stagingId,
      requestId: verified.requestId,
      actorBinding: externalMaterialsActorBinding(token),
    });
    if (existing) return queuedJobResponse(res, existing, stagingId);
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

  const startedAt = Date.now();
  let stage = 'claim';
  try {
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

  if (queueThisUpload) {
    stage = 'admit_background_job';
    try {
      const metadata = await inspectClaimedPortalUploadMetadata({ row: claim.row });
      const maxMb = await getUploadMaxMb();
      const liveByteLimit = maxMb.maxMb * 1024 * 1024;
      if (metadata.size > liveByteLimit) {
        await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: 'file_too_large' });
        return res.status(400).json({ ok: false, reason: 'file_too_large' });
      }
      const job = await enqueueMaterialsUploadJob({
        stagingId,
        stagingLeaseToken: claim.leaseToken,
        requestId: verified.requestId,
        collectionId: verified.collection.id,
        actorBinding: externalMaterialsActorBinding(token),
        tokenDigest: verified.collection.token_digest,
        slot,
        otherUploadsEnabled: SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED,
      });
      return res.status(202).json({ ok: true, jobId: job.id, stagingId, status: job.status });
    } catch (error) {
      if (error instanceof MaterialsJobConflict) {
        await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
        return res.status(error.httpStatus).json({ ok: false, reason: error.code });
      }
      if (error instanceof PortalUploadStagingError) {
        if (PERMANENT_BYTE_CODES.has(error.code)) {
          await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: error.code });
        } else {
          await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
        }
        return res.status(error.httpStatus).json({ ok: false, reason: error.code });
      }
      await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
      throw error;
    }
  }

  let file;
  stage = 'load';
  const loadStartedAt = Date.now();
  try {
    file = await loadClaimedPortalImage({ row: claim.row, leaseToken: claim.leaseToken });
    console.info('[materials/finalize] stage complete', {
      stage,
      durationMs: Date.now() - loadStartedAt,
      bytes: file.buffer.length,
      rssBytes: process.memoryUsage().rss,
    });
  } catch (error) {
    if (!(error instanceof PortalUploadStagingError)) throw error;
    console.warn('[materials/finalize] stage failed', {
      stage,
      durationMs: Date.now() - loadStartedAt,
      code: error.code,
      status: error.httpStatus,
    });
    if (PERMANENT_BYTE_CODES.has(error.code)) await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: error.code });
    else await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
    const reason = error.code === 'empty_image' ? 'empty_file' : error.code === 'image_too_large' ? 'file_too_large' : error.code;
    return res.status(error.httpStatus).json({ ok: false, reason });
  }

  stage = 'validate_scan_upload_and_register';
  const finalizeStartedAt = Date.now();
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
    console.info('[materials/finalize] stage complete', {
      stage,
      durationMs: Date.now() - finalizeStartedAt,
      totalDurationMs: Date.now() - startedAt,
      bytes: file.buffer.length,
      rssBytes: process.memoryUsage().rss,
    });
    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      const code = error.code || error.body?.reason || 'persist_failed';
      if (PERMANENT_RESULT_CODES.has(code)) await rejectPortalUpload({ stagingId, leaseToken: claim.leaseToken, resultCode: code });
      else if (!HOLD_STAGING_CODES.has(code)) await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
      console.warn('[materials/finalize] stage failed', {
        stage, durationMs: Date.now() - finalizeStartedAt, totalDurationMs: Date.now() - startedAt,
        bytes: file.buffer.length, rssBytes: process.memoryUsage().rss,
        code, status: error.httpStatus,
      });
      return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: code });
    }
    await releasePortalUpload({ stagingId, leaseToken: claim.leaseToken });
    console.error('[materials/finalize] stage failed', {
      stage,
      durationMs: Date.now() - finalizeStartedAt,
      totalDurationMs: Date.now() - startedAt,
      code: 'persist_failed',
      status: 503,
      bytes: file.buffer.length,
      rssBytes: process.memoryUsage().rss,
    });
    return res.status(503).json({ ok: false, reason: 'persist_failed' });
  }
  } catch (error) {
    console.error('[materials/finalize] stage interrupted', {
      stage,
      totalDurationMs: Date.now() - startedAt,
      code: typeof error?.code === 'string' ? error.code : 'unexpected_error',
      status: Number.isInteger(error?.status) ? error.status : null,
      rssBytes: process.memoryUsage().rss,
    });
    throw error;
  } finally {
    releaseLargeUploadAdmission(admission.token);
  }
}
