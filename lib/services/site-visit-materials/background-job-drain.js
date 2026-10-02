/** One-job, memory-guarded consumer for durable applicant materials uploads. */
import { sql } from '@vercel/postgres';
import { isVirusScanEnabled } from '../../utils/virus-scan-config.js';
import { isMaterialsBackgroundSchemaReady } from '../../utils/site-visit-materials-background-readiness.js';
import { SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED } from '../../../shared/config/siteVisitMaterials.js';
import {
  acquireLargeUploadAdmission,
  releaseLargeUploadAdmission,
} from '../large-upload-admission.js';
import {
  claimNextMaterialsUploadJob,
  getClaimedMaterialsUploadStage,
  getCurrentMaterialsUploadSideEffects,
  assertMaterialsUploadJobLease,
  recordMaterialsUploadJobScan,
  completeMaterialsUploadJob,
  settleMaterialsUploadJob,
  pruneMaterialsUploadJobs,
  MATERIALS_JOB_RETRY_LIMIT,
} from './background-job-store.js';
import {
  DEFAULT_DEPENDENCIES as MATERIAL_FINALIZE_DEPENDENCIES,
  finalizeMaterialUpload,
} from './contributor-service.js';
import {
  completePortalUpload,
  deleteStagedPortalBlob,
  loadClaimedPortalDocument,
} from '../portal-upload-staging.js';
import OperationalEventService from '../operational-event-service.js';

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isMaterialsBackgroundSchemaReady,
  scanEnabled: isVirusScanEnabled,
  acquireAdmission: acquireLargeUploadAdmission,
  releaseAdmission: releaseLargeUploadAdmission,
  claim: claimNextMaterialsUploadJob,
  getStage: getClaimedMaterialsUploadStage,
  getCurrentSideEffects: getCurrentMaterialsUploadSideEffects,
  assertLease: assertMaterialsUploadJobLease,
  recordScan: recordMaterialsUploadJobScan,
  completeJob: completeMaterialsUploadJob,
  settleJob: settleMaterialsUploadJob,
  pruneJobs: pruneMaterialsUploadJobs,
  loadFile: loadClaimedPortalDocument,
  completeStaging: completePortalUpload,
  deleteStagedBlob: deleteStagedPortalBlob,
  finalize: finalizeMaterialUpload,
  materialFinalizeDependencies: MATERIAL_FINALIZE_DEPENDENCIES,
  getCollection: async (id) => {
    const result = await sql`SELECT * FROM site_visit_material_collections WHERE id = ${id} LIMIT 1`;
    return result.rows[0] || null;
  },
  recordEvent: (event) => OperationalEventService.recordEvent(event),
  now: () => new Date(),
});

function hasCleanCheckpoint(job) {
  return job?.scan_checkpoint?.clean === true
    && typeof job.scan_checkpoint.sha256 === 'string'
    && typeof job.scan_checkpoint.policyVersion === 'string';
}

function hasCandidate(stage) {
  return Boolean(stage?.candidate_result && typeof stage.candidate_result === 'object');
}

function needsAttention(job, stage) {
  return hasCleanCheckpoint(job) || hasCandidate(stage);
}

function retryDelay(attempt) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)));
}

function errorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'scan_infected') return 'scan_infected';
  if (code === 'replay_ambiguous') return 'replay_ambiguous';
  if (code === 'background_lease_lost' || code === 'finalize_lease_lost') return 'lease_lost';
  if (code === 'staged_upload_missing' || code === 'staged_upload_mismatch') return code;
  if (['extension_not_allowed', 'signature_mismatch', 'empty_file'].includes(code)) return 'invalid_file';
  if (code === 'file_too_large') return 'size_limit';
  if (code === 'processing_deadline' || code === 'retry_limit') return code;
  if (code === 'collection_or_token_changed') return code;
  if (code === 'slot_busy') return 'slot_busy';
  if (code === 'scan_paused') return code;
  return 'storage_unavailable';
}

async function emitNeedsAttention(dependencies, job, reason) {
  try {
    await dependencies.recordEvent({
      source: 'app',
      eventType: 'site_visit_material_upload_needs_attention',
      severity: 'error',
      transient: false,
      subsystem: 'site-visit-materials',
      stage: 'background_upload',
      summary: `Applicant materials upload ${job.id} for slot ${job.slot} requires coordinator attention (${reason}).`,
      entityRefs: {
        requestId: job.request_id,
        collectionId: job.collection_id,
        stagingId: job.staging_id,
        jobId: job.id,
        slot: job.slot,
      },
      dedupeKey: `site_visit_material_upload_needs_attention:${job.id}`,
    });
  } catch (error) {
    console.error('[materials-upload-drain] attention event failed:', error?.message || error);
  }
}

async function settleAfterError(dependencies, job, stage, error) {
  const code = errorCode(error);
  if (code === 'lease_lost') return { status: 'lease_lost', jobId: job.id };
  const spent = job.attempt_count >= MATERIALS_JOB_RETRY_LIMIT;
  const deadlineHit = new Date(job.deadline_at).getTime() <= dependencies.now().getTime();
  const terminal = ['scan_infected', 'staged_upload_missing', 'staged_upload_mismatch', 'invalid_file', 'size_limit', 'collection_or_token_changed'].includes(code)
    || spent || deadlineHit;
  if (!terminal) {
    const retryAt = new Date(dependencies.now().getTime() + retryDelay(job.attempt_count));
    const updated = await dependencies.settleJob({ job, status: 'queued', errorCode: code, retryAt });
    return { status: updated ? 'queued' : 'lease_lost', jobId: job.id, retryAt: retryAt.toISOString() };
  }
  let currentJob = job;
  let currentStage = stage;
  if (terminal) {
    const current = await dependencies.getCurrentSideEffects({ jobId: job.id, leaseToken: job.lease_token });
    if (!current) return { status: 'lease_lost', jobId: job.id };
    currentJob = { ...job, scan_checkpoint: current.scan_checkpoint };
    currentStage = { ...stage, candidate_result: current.candidate_result };
  }
  if (needsAttention(currentJob, currentStage)) {
    const updated = await dependencies.settleJob({ job, status: 'needs_attention', errorCode: code });
    if (updated) await emitNeedsAttention(dependencies, job, code);
    return { status: updated ? 'needs_attention' : 'lease_lost', jobId: job.id };
  }
  const finalCode = deadlineHit ? 'processing_deadline' : spent ? 'retry_limit' : code;
  const finalStatus = code === 'collection_or_token_changed' ? 'cancelled' : 'failed';
  const updated = await dependencies.settleJob({
    job,
    status: finalStatus,
    errorCode: finalCode,
    clearStageOwner: true,
    rejectStage: true,
  });
  return { status: updated ? finalStatus : 'lease_lost', jobId: job.id, errorCode: finalCode };
}

function admittedCollectionStillValid(job, collection) {
  if (!collection || String(collection.id).toLowerCase() !== String(job.collection_id).toLowerCase()
    || String(collection.request_id).toLowerCase() !== String(job.request_id).toLowerCase()
    || collection.token_digest !== job.token_digest) return false;
  const slotOpen = job.slot === 'other'
    ? SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED
    : Array.isArray(collection.checklist)
      && collection.checklist.some((item) => item?.key === job.slot && item.waived !== true);
  if (!slotOpen) return false;
  // Natural close after queue admission does not cancel accepted work. An
  // explicit close before its recorded close instant does.
  if (collection.status === 'closed'
    && new Date(collection.closes_at).getTime() <= new Date(job.created_at).getTime()) return false;
  return true;
}

export async function drainOneMaterialsUpload(dependencies = DEFAULT_DEPENDENCIES) {
  if (!dependencies.schemaReady()) return { status: 'schema_paused' };
  if (!dependencies.scanEnabled()) return { status: 'scan_paused' };
  const admission = dependencies.acquireAdmission();
  if (!admission) return { status: 'process_busy' };
  try {
    await dependencies.pruneJobs();
    const job = await dependencies.claim();
    if (!job) return { status: 'empty' };
    let stage = null;
    let completionReceiptMayBeCommitted = false;
    try {
      stage = await dependencies.getStage({ jobId: job.id, leaseToken: job.lease_token });
      if (!stage) {
        const updated = await dependencies.settleJob({ job, status: 'needs_attention', errorCode: 'staging_owner_mismatch' });
        if (updated) await emitNeedsAttention(dependencies, job, 'staging_owner_mismatch');
        return { status: updated ? 'needs_attention' : 'lease_lost', jobId: job.id };
      }
      if (stage.status === 'consumed') {
        const completed = await dependencies.completeJob({
          jobId: job.id,
          leaseToken: job.lease_token,
          resultPayload: stage.result_payload || { ok: true },
        });
        return { status: completed ? 'completed' : 'lease_lost', jobId: job.id, replayed: true };
      }
      const collection = await dependencies.getCollection(job.collection_id);
      if (!admittedCollectionStillValid(job, collection)) {
        return await settleAfterError(dependencies, job, stage, { code: 'collection_or_token_changed' });
      }
      if (new Date(job.deadline_at).getTime() <= dependencies.now().getTime()
        || job.attempt_count > MATERIALS_JOB_RETRY_LIMIT) {
        return await settleAfterError(dependencies, job, stage, { code: 'retry_limit' });
      }
      const file = await dependencies.loadFile({ row: stage, leaseToken: job.lease_token, backgroundJobId: job.id });
      const assertCurrentJobAndCollection = async ({ jobId, leaseToken }) => {
        if (!(await dependencies.assertLease(jobId, leaseToken))) return false;
        const current = await dependencies.getCollection(job.collection_id);
        return admittedCollectionStillValid(job, current);
      };
      const result = await dependencies.finalize({
        collection,
        slotKey: job.slot,
        file,
        stagingId: job.staging_id,
        leaseToken: job.lease_token,
        candidateResult: stage.candidate_result || null,
        backgroundJob: {
          jobId: job.id,
          leaseToken: job.lease_token,
          lockedUntil: job.locked_until,
          scanCheckpoint: job.scan_checkpoint,
        },
      }, {
        ...dependencies.materialFinalizeDependencies,
        assertBackgroundJobLease: assertCurrentJobAndCollection,
        recordBackgroundScan: ({ jobId, leaseToken, sha256, policyVersion }) =>
          dependencies.recordScan({ jobId, leaseToken, sha256, policyVersion }),
      });
      const body = { ok: true, slot: result.slot, filename: result.filename, receivedAt: result.receivedAt };
      if (!(await dependencies.assertLease(job.id, job.lease_token))) return { status: 'lease_lost', jobId: job.id };
      // From this point a failed/ambiguous DB response may follow a committed
      // consumed receipt. Leave the processing lease for normal expiry/reclaim;
      // the next worker will finish from that durable receipt without replaying
      // external work or freeing a possibly published slot.
      completionReceiptMayBeCommitted = true;
      await dependencies.completeStaging({
        stagingId: job.staging_id,
        leaseToken: job.lease_token,
        backgroundJobId: job.id,
        resultCode: 'ok',
        resultPayload: body,
      });
      const completed = await dependencies.completeJob({
        jobId: job.id,
        leaseToken: job.lease_token,
        resultPayload: body,
      });
      return { status: completed ? 'completed' : 'lease_lost', jobId: job.id };
    } catch (error) {
      if (completionReceiptMayBeCommitted) {
        console.warn('[materials-upload-drain] completion receipt outcome uncertain; leaving lease for recovery', {
          jobId: job.id,
          code: errorCode(error),
        });
        return { status: 'completion_recovery_pending', jobId: job.id };
      }
      console.error('[materials-upload-drain] job failed', {
        jobId: job.id,
        code: errorCode(error),
        status: Number.isInteger(error?.status) ? error.status : null,
      });
      if (error?.code === 'scan_infected') {
        const outcome = await settleAfterError(dependencies, job, stage, error);
        if (['failed', 'needs_attention'].includes(outcome.status) && stage?.pathname) {
          await dependencies.deleteStagedBlob(stage.pathname).catch((deleteError) => {
            console.error('[materials-upload-drain] infected Blob cleanup failed:', deleteError?.message || deleteError);
          });
        }
        return { ...outcome, errorCode: 'scan_infected' };
      }
      return await settleAfterError(dependencies, job, stage, error);
    }
  } finally {
    dependencies.releaseAdmission(admission.token || admission);
  }
}
