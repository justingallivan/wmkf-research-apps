import { requireSuperuser } from '../../../../../../lib/utils/auth';
import {
  claimUncertainTranscriptionJobForReconcile,
  getLeasedTranscriptionJob,
  getOwnerTranscriptionJob,
  markTranscriptionProviderDeletionCompleted,
  reconcileVerifiedTranscriptionProviderId,
  releaseTranscriptionLease,
} from '../../../../../../lib/services/transcription-pilot/store';
import { deleteAssemblyAITranscript, getAssemblyAITranscript } from '../../../../../../lib/services/transcription-pilot/provider';
import { providerReference, getOwnerJob, requirePilotEnabled, TranscriptionPilotError, validateOwnerProfile } from '../../../../../../lib/services/transcription-pilot/runtime';
import { dispatchQueuedTranscriptionWorkflow } from '../../../../../../lib/services/transcription-pilot/workflow-dispatch';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  res.setHeader('Cache-Control', 'private, no-store');
  let lease = null;
  try {
    requirePilotEnabled();
    validateOwnerProfile(gate.profileId);
    const { expectedVersion, providerTranscriptId, mode = 'publish' } = req.body || {};
    if (!['publish', 'cleanup'].includes(mode)) throw new TranscriptionPilotError('invalid_reconciliation_mode', 400);
    if (!Number.isInteger(expectedVersion) || typeof providerTranscriptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(providerTranscriptId)) throw new TranscriptionPilotError('invalid_reconciliation', 400);
    const existing = await getOwnerTranscriptionJob({ jobId: req.query.id, ownerProfileId: gate.profileId });
    if (!existing) throw new TranscriptionPilotError('job_not_found', 404);
    if (existing.version !== expectedVersion || existing.status !== 'submission_uncertain') throw new TranscriptionPilotError('job_changed', 409);
    if (mode === 'publish' && existing.cleanup_requested_at) throw new TranscriptionPilotError('cleanup_only_reconciliation_required', 409);
    if (mode === 'cleanup' && (!existing.cleanup_requested_at || !existing.provider_upload_ref_ciphertext)) throw new TranscriptionPilotError('cleanup_verification_unavailable', 409);
    lease = await claimUncertainTranscriptionJobForReconcile({ jobId: req.query.id, ownerProfileId: gate.profileId });
    if (!lease) throw new TranscriptionPilotError('job_changed_or_busy', 409);
    const transcript = await getAssemblyAITranscript({ region: lease.job.provider_region, transcriptId: providerTranscriptId });
    const expectedUpload = await providerReference(lease.job.provider_upload_ref_ciphertext);
    if (transcript.audio_url !== expectedUpload) throw new TranscriptionPilotError('provider_job_audio_mismatch', 409);
    const current = await getLeasedTranscriptionJob({ jobId: req.query.id, leaseToken: lease.leaseToken });
    if (!current) throw new TranscriptionPilotError('job_lease_lost', 409);
    const reconciled = await reconcileVerifiedTranscriptionProviderId({
      jobId: req.query.id, ownerProfileId: gate.profileId,
      leaseToken: lease.leaseToken, expectedVersion: current.version, providerTranscriptId,
    });
    if (!reconciled) throw new TranscriptionPilotError('job_changed', 409);
    if (mode === 'cleanup') {
      await deleteAssemblyAITranscript({ region: lease.job.provider_region, transcriptId: providerTranscriptId });
      const latest = await getLeasedTranscriptionJob({ jobId: req.query.id, leaseToken: lease.leaseToken });
      if (!latest) throw new TranscriptionPilotError('job_lease_lost', 409);
      const deleted = await markTranscriptionProviderDeletionCompleted({ jobId: req.query.id, leaseToken: lease.leaseToken, expectedVersion: latest.version });
      if (!deleted) throw new TranscriptionPilotError('job_changed', 409);
      await releaseTranscriptionLease({ jobId: deleted.id, leaseToken: lease.leaseToken, expectedVersion: deleted.version, expectedStatuses: ['failed', 'submission_uncertain'] });
      return res.status(200).json({ job: await getOwnerJob({ ownerProfileId: gate.profileId, jobId: req.query.id }), cleanupOnly: true, providerDeleted: true });
    }
    await releaseTranscriptionLease({ jobId: reconciled.id, leaseToken: lease.leaseToken, expectedVersion: reconciled.version, expectedStatuses: ['processing', 'submission_uncertain'] });
    // Reconciliation atomically re-arms the outbox. Resume the verified job,
    // including when its earlier workflow stopped for operator attention.
    try {
      await dispatchQueuedTranscriptionWorkflow({ jobId: reconciled.id, ownerProfileId: gate.profileId });
    } catch {
      return res.status(503).json({
        error: 'Provider verification succeeded; processing delivery is pending. Refresh status before retrying.',
        code: 'transcription_dispatch_pending', retryable: true,
        job: await getOwnerJob({ ownerProfileId: gate.profileId, jobId: req.query.id }),
      });
    }
    return res.status(200).json({ job: await getOwnerJob({ ownerProfileId: gate.profileId, jobId: req.query.id }) });
  } catch (error) {
    if (lease) {
      const current = await getLeasedTranscriptionJob({ jobId: req.query.id, leaseToken: lease.leaseToken }).catch(() => null);
      if (current) await releaseTranscriptionLease({ jobId: current.id, leaseToken: lease.leaseToken, expectedVersion: current.version, expectedStatuses: ['submission_uncertain', 'processing'] }).catch(() => {});
    }
    if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error?.code?.startsWith('transcription_')) return res.status(error.httpStatus || 409).json({ error: error.message, code: error.code });
    console.error('[transcription-pilot/reconcile] failed:', error?.code || error?.name || 'unknown');
    return res.status(503).json({ error: 'Provider verification or cleanup could not complete; refresh status before retrying', code: 'provider_verification_failed' });
  }
}
