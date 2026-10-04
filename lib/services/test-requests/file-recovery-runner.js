/**
 * Orchestrates the separately reviewed Basic file readback recovery. The
 * verifier is always rerun against fresh ledger/artifact/Dataverse/Graph
 * reads; a prior report is never accepted as CAS input.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_MAX_AGE_MS } from './bundle-file-copy.js';

export const FILE_READBACK_LEASE_SECONDS = 300;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFileReadbackArgs(argv) {
  const parsed = { target: null, runId: null, requestNumber: null, recover: false, receiptPath: null, manifestPath: null, bundlePath: null, help: false };
  const seen = new Set();
  for (const arg of argv.slice(2)) {
    const key = arg.startsWith('--') ? arg.split('=', 1)[0] : arg;
    if (seen.has(key)) throw blocked('duplicate_argument');
    seen.add(key);
    if (arg.startsWith('--target=')) parsed.target = arg.slice('--target='.length);
    else if (arg.startsWith('--run-id=')) parsed.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--confirm-request=')) parsed.requestNumber = arg.slice('--confirm-request='.length);
    else if (arg === '--recover') parsed.recover = true;
    else if (arg.startsWith('--receipt-out=')) parsed.receiptPath = arg.slice('--receipt-out='.length);
    else if (arg.startsWith('--manifest=')) parsed.manifestPath = arg.slice('--manifest='.length);
    else if (arg.startsWith('--bundle=')) parsed.bundlePath = arg.slice('--bundle='.length);
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw blocked('unknown_argument');
  }
  if (parsed.help) return parsed;
  if (parsed.target !== 'sandbox' || !GUID.test(parsed.runId || '') || !/^\d{1,10}$/.test(parsed.requestNumber || '')) {
    throw blocked('sandbox_run_and_request_confirmation_required');
  }
  if (parsed.recover && !parsed.receiptPath) throw blocked('private_receipt_required');
  if (!parsed.recover && parsed.receiptPath) throw blocked('receipt_requires_recovery_mode');
  if (Boolean(parsed.manifestPath) !== Boolean(parsed.bundlePath)) throw blocked('manifest_and_bundle_must_be_paired');
  if ([parsed.manifestPath, parsed.bundlePath].some((value) => value && !path.isAbsolute(value))) throw blocked('artifact_paths_must_be_absolute');
  return parsed;
}

function blocked(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertCandidate(run, confirmRequestNumber) {
  if (!run) throw blocked('run_not_found');
  if (run.recipe !== 'basic' || run.status !== 'needs_attention'
      || run.currentStep !== 'copy_file' || run.needsAttentionReason !== 'file_journal_unverified'
      || run.destinationEnvironment !== 'sandbox'
      || run.destinationDataverseHost !== 'orgd9e66399.crm.dynamics.com'
      || (run.lockedUntil && (!Number.isFinite(Date.parse(run.lockedUntil)) || Date.parse(run.lockedUntil) > Date.now()))) {
    throw blocked('run_not_candidate');
  }
  if (String(run.destinationRequestNumber ?? '') !== String(confirmRequestNumber ?? '')
      || !/^\d{1,10}$/.test(String(confirmRequestNumber ?? ''))) throw blocked('request_confirmation_mismatch');
  if (String(run.destinationRequestNumber) === '1003308') throw blocked('retained_request_excluded');
}

function bundleFreshAt(run, nowMs) {
  const exportedAt = Date.parse(run?.bundleExportedAt);
  return Number.isFinite(exportedAt)
    && exportedAt <= nowMs + 5 * 60 * 1000
    && nowMs - exportedAt <= BUNDLE_MAX_AGE_MS;
}

function receiptPathOutsideRepo(receiptPath, repoRoot) {
  if (typeof receiptPath !== 'string' || !path.isAbsolute(receiptPath)) throw blocked('receipt_path_must_be_absolute');
  const parent = path.dirname(receiptPath);
  const realParent = fs.realpathSync(parent);
  const realRepo = fs.realpathSync(repoRoot);
  const resolved = path.resolve(realParent, path.basename(receiptPath));
  const relative = path.relative(realRepo, resolved);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw blocked('receipt_path_must_be_outside_repo');
  }
  return resolved;
}

export function writePrivateRecoveryReceipt(receiptPath, receipt, { repoRoot }) {
  const resolved = receiptPathOutsideRepo(receiptPath, repoRoot);
  let fd;
  try {
    fd = fs.openSync(resolved, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } catch (error) {
    if (error?.code === 'EEXIST') throw blocked('receipt_path_exists');
    throw blocked('receipt_write_failed');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  fs.chmodSync(resolved, 0o600);
  if ((fs.statSync(resolved).mode & 0o777) !== 0o600) throw blocked('receipt_permissions_failed');
  return resolved;
}

function expectedLease(run) {
  return {
    token: run.leaseToken,
    generation: run.leaseGeneration,
    version: run.version,
    lockedUntil: run.lockedUntil,
  };
}

function verifiedReadback(evidence) {
  const proposal = evidence.proposedReadback;
  if (!proposal || proposal.itemId !== evidence.itemId || !proposal.contentHash
      || proposal.contentHash !== evidence.sourceSha256 || !proposal.eTag
      || !Number.isSafeInteger(proposal.itemSize)) throw blocked('verified_receipt_incomplete');
  return {
    index: proposal.index,
    filename: proposal.filename,
    folder: proposal.folder,
    library: proposal.library,
    size: proposal.size,
    contentHash: proposal.contentHash,
    sourceGraphItemId: proposal.sourceGraphItemId,
    driveId: proposal.driveId,
    itemId: proposal.itemId,
    eTag: proposal.eTag,
    versionId: proposal.versionId,
    itemSize: proposal.itemSize,
    eTagBefore: proposal.eTagBefore,
    sourceVersionId: proposal.sourceVersionId,
    sourceDriveId: proposal.sourceDriveId,
    uploadAttemptedAt: proposal.uploadAttemptedAt,
    verifiedAt: evidence.checkedAt,
    siteId: evidence.siteId,
    bytesSha256: evidence.destinationSha256,
    ...(proposal.mimeType ? { mimeType: proposal.mimeType } : {}),
    ...(proposal.attestedDigest ? { attestedDigest: proposal.attestedDigest } : {}),
  };
}

async function loadSnapshot(ledger, runId) {
  const run = await ledger.getRun(runId);
  if (!run) throw blocked('run_not_found');
  return { run, resources: await ledger.listRunResources(run.runId) };
}

/** Read-only full verifier entry; it does not claim a lease or persist evidence. */
export async function inspectPendingBasicFileReadback({
  ledger, runId, confirmRequestNumber, loadArtifacts, readRequest, graph, expectedTarget,
  verifyPendingBasicFileReadback, nowMs = Date.now(),
}) {
  const { run, resources } = await loadSnapshot(ledger, runId);
  assertCandidate(run, confirmRequestNumber);
  if (!bundleFreshAt(run, nowMs)) {
    return { status: 'blocked', reason: 'bundle_not_fresh', disposition: 'new_run_required', evidenceOnly: true, continuationAllowed: false };
  }
  const { manifest, bundle } = await loadArtifacts(run);
  return verifyPendingBasicFileReadback({
    run, resources, manifest, bundle, graph, readRequest, expectedTarget, nowMs,
  });
}

/**
 * Claim, reread and verify the exact current snapshot, persist a private
 * create-only receipt, then perform one atomic same-step ledger CAS.
 */
export async function recoverPendingBasicFileReadback({
  ledger, runId, confirmRequestNumber, loadArtifacts, readRequest, graph, expectedTarget,
  verifyPendingBasicFileReadback, receiptPath, repoRoot, nowMs = Date.now(),
}) {
  const initial = await loadSnapshot(ledger, runId);
  assertCandidate(initial.run, confirmRequestNumber);
  if (!bundleFreshAt(initial.run, nowMs)) throw blocked('bundle_not_fresh');
  const claim = await ledger.claimLease({
    runId: initial.run.runId,
    expectedVersion: initial.run.version,
    leaseSeconds: FILE_READBACK_LEASE_SECONDS,
  });
  if (!claim) throw blocked('lease_claim_conflict');
  let casCommitted = false;
  try {
    const { run, resources } = await loadSnapshot(ledger, runId);
    if (!run.leaseToken || run.leaseToken !== claim.leaseToken
        || run.version !== claim.version || run.leaseGeneration !== claim.leaseGeneration) {
      throw blocked('claimed_run_changed');
    }
    assertCandidate({ ...run, leaseToken: null, lockedUntil: null }, confirmRequestNumber);
    const { manifest, bundle } = await loadArtifacts(run);
    const evidence = await verifyPendingBasicFileReadback({
      run, resources, manifest, bundle, graph, readRequest, expectedTarget,
      nowMs, expectedLease: expectedLease(run),
    });
    if (evidence?.status !== 'evidence_matches' || evidence.evidenceOnly !== true
        || evidence.continuationAllowed !== false) throw blocked(evidence?.reason || 'readback_not_verified');
    const resource = resources.find((row) => row.resourceId === evidence.resourceId);
    if (!resource) throw blocked('resource_snapshot_missing');
    const readback = verifiedReadback(evidence);
    const privateReceipt = {
      schema: 'factory-basic-file-readback-recovery/v1',
      capturedAt: new Date().toISOString(),
      target: expectedTarget,
      runId: run.runId,
      actorId: run.actorId,
      requestId: run.destinationRequestId,
      requestNumber: run.destinationRequestNumber,
      runVersion: run.version,
      leaseGeneration: run.leaseGeneration,
      resourceId: resource.resourceId,
      resourceSequence: resource.sequence,
      evidence,
      disposition: 'verified_same_step_cas_requested',
    };
    const durableReceiptPath = writePrivateRecoveryReceipt(receiptPath, privateReceipt, { repoRoot });
    const recovered = await ledger.recoverFileReadback({
      runId: run.runId,
      actorId: run.actorId,
      leaseToken: run.leaseToken,
      expectedVersion: run.version,
      expectedLeaseGeneration: run.leaseGeneration,
      expectedStepIndex: run.stepIndex,
      expectedBundleExportedAt: new Date(run.bundleExportedAt).toISOString(),
      expectedPlanDigest: run.planDigest,
      expectedCopyPolicyDigest: run.copyPolicyDigest,
      expectedCreateBodySha256: run.createBodySha256,
      expectedRequestId: run.destinationRequestId,
      expectedRequestNumber: run.destinationRequestNumber,
      resourceId: resource.resourceId,
      expectedResourceSequence: resource.sequence,
      expectedPlannedIdentity: resource.plannedIdentity,
      expectedSourceProvenance: resource.sourceProvenance,
      expectedReadback: resource.readback,
      expectedOutcome: resource.outcome,
      verifiedReadback: readback,
    });
    if (!recovered) throw blocked('recovery_cas_conflict');
    casCommitted = true;
    return {
      status: 'recovered_to_copy_step',
      runId: recovered.runId,
      requestNumber: recovered.destinationRequestNumber,
      currentStep: recovered.currentStep,
      runVersion: recovered.version,
      receiptPath: durableReceiptPath,
      evidence,
    };
  } finally {
    if (!casCommitted) {
      await ledger.releaseLease({
        runId: claim.runId,
        leaseToken: claim.leaseToken,
        leaseGeneration: claim.leaseGeneration,
      }).catch(() => null);
    }
  }
}
