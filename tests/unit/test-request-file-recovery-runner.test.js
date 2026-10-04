/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inspectPendingBasicFileReadback,
  parseFileReadbackArgs,
  recoverPendingBasicFileReadback,
} from '../../lib/services/test-requests/file-recovery-runner.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);
const ITEM = `01${'A'.repeat(32)}`;
const DEST_ITEM = `01${'B'.repeat(32)}`;
const DRIVE = `b!${'A'.repeat(32)}`;
const SOURCE_DRIVE = `b!${'B'.repeat(32)}`;
const SITE_ID = 'appriver3651007194.sharepoint.com,48930e19-0000-4000-8000-000000000000,11111111-1111-4111-8111-111111111111';

function run(overrides = {}) {
  return {
    runId: RUN_ID, actorId: 'admin:44444444-4444-4444-8444-444444444444',
    recipe: 'basic', status: 'needs_attention', currentStep: 'copy_file', stepIndex: 4,
    needsAttentionReason: 'file_journal_unverified', version: 8, leaseToken: null,
    leaseGeneration: 2, lockedUntil: null, destinationEnvironment: 'sandbox',
    destinationDataverseHost: 'orgd9e66399.crm.dynamics.com', destinationRequestId: REQUEST_ID,
    destinationRequestNumber: '9000001', destinationLocationId: '55555555-5555-4555-8555-555555555555',
    sourceRequestId: '66666666-6666-4666-8666-666666666666', sourceRevision: 'rev-1',
    bundleSha256: HASH, bundleExportedAt: new Date().toISOString(), copyPolicyDigest: HASH,
    planDigest: HASH, createBodySha256: HASH, ...overrides,
  };
}

function makeEvidence() {
  const proposedReadback = {
    index: 0, filename: 'ProposalNarrative_1003222.pdf', folder: `9000001_${'C'.repeat(32)}/Phase I`,
    library: 'akoya_request', size: 12, contentHash: HASH, sourceGraphItemId: ITEM,
    driveId: DRIVE, itemId: DEST_ITEM, eTag: '"etag,1"', versionId: null, itemSize: 12,
    eTagBefore: '"source,1"', sourceVersionId: '1.0', sourceDriveId: SOURCE_DRIVE,
    uploadAttemptedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(),
  };
  return {
    status: 'evidence_matches', reason: 'readback_integrity_verified', evidenceOnly: true,
    continuationAllowed: false, runId: RUN_ID, siteId: SITE_ID, sourceDriveId: SOURCE_DRIVE,
    destinationDriveId: DRIVE, resourceId: RESOURCE_ID, index: 0, itemId: DEST_ITEM,
    sourceSha256: HASH, destinationSha256: HASH, integrityMode: 'exact_hash', normalizedParts: null,
    inventoryCount: 1, checkedAt: new Date().toISOString(), proposedReadback,
  };
}

function fixture({ initialRun = run(), evidence = makeEvidence() } = {}) {
  const resource = {
    resourceId: RESOURCE_ID, sequence: 5, step: 'copy_file', resourceKind: 'sharepoint_file',
    outcome: 'dispatched', plannedIdentity: { index: 0, filename: 'ProposalNarrative_1003222.pdf' },
    sourceProvenance: null,
    readback: {
      index: 0, filename: 'ProposalNarrative_1003222.pdf', folder: evidence.proposedReadback.folder,
      library: 'akoya_request', size: 12, contentHash: HASH, sourceGraphItemId: ITEM,
      driveId: DRIVE, sourceDriveId: SOURCE_DRIVE, itemId: DEST_ITEM,
      eTag: '"etag,1"', versionId: null, itemSize: 12, eTagBefore: '"source,1"',
      sourceVersionId: '1.0', uploadAttemptedAt: evidence.proposedReadback.uploadAttemptedAt,
    },
  };
  const claimedRun = run({ ...initialRun, version: initialRun.version + 1, leaseToken: '77777777-7777-4777-8777-777777777777',
    leaseGeneration: initialRun.leaseGeneration + 1, lockedUntil: new Date(Date.now() + 180_000) });
  const ledger = {
    getRun: jest.fn().mockResolvedValueOnce(initialRun).mockResolvedValue(claimedRun),
    listRunResources: jest.fn().mockResolvedValue([resource]),
    claimLease: jest.fn().mockResolvedValue(claimedRun),
    releaseLease: jest.fn().mockResolvedValue(initialRun),
    recoverFileReadback: jest.fn().mockResolvedValue(run({ ...claimedRun, status: 'creating', needsAttentionReason: null,
      currentStep: 'copy_file', leaseToken: null, lockedUntil: null, version: claimedRun.version + 1 })),
  };
  const verifyPendingBasicFileReadback = jest.fn().mockResolvedValue(evidence);
  const common = {
    ledger, runId: RUN_ID, confirmRequestNumber: '9000001',
    loadArtifacts: jest.fn().mockResolvedValue({ manifest: { source: { bundleSha256: HASH } }, bundle: {} }),
    readRequest: jest.fn(), graph: {}, expectedTarget: { environment: 'sandbox', url: 'https://orgd9e66399.crm.dynamics.com' },
    verifyPendingBasicFileReadback,
  };
  return { ledger, resource, claimedRun, evidence, common, verifyPendingBasicFileReadback };
}

describe('Factory file readback recovery orchestration', () => {
  let tempDir;
  beforeEach(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-readback-')); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  test('read-only inspect verifies without claiming a lease or writing a receipt', async () => {
    const f = fixture();
    const result = await inspectPendingBasicFileReadback(f.common);
    expect(result.status).toBe('evidence_matches');
    expect(f.ledger.claimLease).not.toHaveBeenCalled();
    expect(f.ledger.recoverFileReadback).not.toHaveBeenCalled();
    const verifierArgs = f.verifyPendingBasicFileReadback.mock.calls[0][0];
    expect(verifierArgs).not.toHaveProperty('expectedLease');
    expect(verifierArgs.run).toEqual(expect.objectContaining({ leaseToken: null }));
  });

  test('recovery claims, re-verifies under that exact lease, writes a mode-0600 private receipt, and CASes once', async () => {
    const f = fixture();
    const receiptPath = path.join(tempDir, 'private.json');
    const result = await recoverPendingBasicFileReadback({
      ...f.common, receiptPath, repoRoot: process.cwd(),
    });
    expect(f.ledger.claimLease).toHaveBeenCalledWith({ runId: RUN_ID, expectedVersion: 8, leaseSeconds: 300 });
    expect(f.verifyPendingBasicFileReadback).toHaveBeenCalledWith(expect.objectContaining({
      expectedLease: expect.objectContaining({ token: f.claimedRun.leaseToken, generation: f.claimedRun.leaseGeneration }),
      run: expect.objectContaining({ version: f.claimedRun.version }),
    }));
    expect(f.ledger.recoverFileReadback).toHaveBeenCalledTimes(1);
    expect(f.ledger.recoverFileReadback.mock.calls[0][0]).toMatchObject({
      actorId: f.claimedRun.actorId, leaseToken: f.claimedRun.leaseToken,
      expectedRequestId: REQUEST_ID, expectedRequestNumber: '9000001',
      expectedOutcome: 'dispatched', expectedReadback: f.resource.readback,
      verifiedReadback: expect.objectContaining({ itemId: DEST_ITEM, bytesSha256: HASH, contentHash: HASH }),
    });
    expect(fs.statSync(receiptPath).mode & 0o777).toBe(0o600);
    expect(result.status).toBe('recovered_to_copy_step');
    expect(result.currentStep).toBe('copy_file');
    expect(f.ledger.releaseLease).not.toHaveBeenCalled();
  });

  test('production/noncandidate run and request-confirmation mismatch stop before lease claim', async () => {
    const prod = fixture({ initialRun: run({ destinationEnvironment: 'production' }) });
    await expect(inspectPendingBasicFileReadback(prod.common)).rejects.toMatchObject({ code: 'run_not_candidate' });
    const wrongConfirm = fixture();
    await expect(recoverPendingBasicFileReadback({ ...wrongConfirm.common,
      confirmRequestNumber: '9000002', receiptPath: path.join(tempDir, 'no.json'), repoRoot: process.cwd(),
    })).rejects.toMatchObject({ code: 'request_confirmation_mismatch' });
    expect(prod.ledger.claimLease).not.toHaveBeenCalled();
    expect(wrongConfirm.ledger.claimLease).not.toHaveBeenCalled();
  });

  test('expired bundles produce a new-run diagnosis without claiming a lease or invoking the verifier', async () => {
    const expired = run({ bundleExportedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
    const f = fixture({ initialRun: expired });
    const inspection = await inspectPendingBasicFileReadback(f.common);
    expect(inspection).toMatchObject({
      status: 'blocked', reason: 'bundle_not_fresh', disposition: 'new_run_required',
      evidenceOnly: true, continuationAllowed: false,
    });
    const recovery = fixture({ initialRun: expired });
    await expect(recoverPendingBasicFileReadback({
      ...recovery.common, receiptPath: path.join(tempDir, 'expired.json'), repoRoot: process.cwd(),
    })).rejects.toMatchObject({ code: 'bundle_not_fresh' });
    expect(recovery.ledger.claimLease).not.toHaveBeenCalled();
    expect(recovery.verifyPendingBasicFileReadback).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, 'expired.json'))).toBe(false);
  });

  test('receipt creation failure releases the claimed lease and never calls the CAS', async () => {
    const f = fixture();
    const receiptPath = path.join(tempDir, 'exists.json');
    fs.writeFileSync(receiptPath, 'occupied');
    await expect(recoverPendingBasicFileReadback({
      ...f.common, receiptPath, repoRoot: process.cwd(),
    })).rejects.toMatchObject({ code: 'receipt_path_exists' });
    expect(f.ledger.recoverFileReadback).not.toHaveBeenCalled();
    expect(f.ledger.releaseLease).toHaveBeenCalledWith({
      runId: RUN_ID, leaseToken: f.claimedRun.leaseToken, leaseGeneration: f.claimedRun.leaseGeneration,
    });
  });

  test.each(['verifier_blocked', 'cas_conflict'])('releases its lease after %s without claiming successful recovery', async (failure) => {
    const f = fixture();
    if (failure === 'verifier_blocked') f.verifyPendingBasicFileReadback.mockResolvedValue({ status: 'blocked', reason: 'destination_content_mismatch' });
    else f.ledger.recoverFileReadback.mockResolvedValue(null);
    await expect(recoverPendingBasicFileReadback({
      ...f.common, receiptPath: path.join(tempDir, 'evidence.json'), repoRoot: process.cwd(),
    })).rejects.toMatchObject({ code: failure === 'verifier_blocked' ? 'destination_content_mismatch' : 'recovery_cas_conflict' });
    expect(f.ledger.releaseLease).toHaveBeenCalledWith({ runId: RUN_ID, leaseToken: f.claimedRun.leaseToken, leaseGeneration: f.claimedRun.leaseGeneration });
    if (failure === 'verifier_blocked') expect(f.ledger.recoverFileReadback).not.toHaveBeenCalled();
    else expect(JSON.parse(fs.readFileSync(path.join(tempDir, 'evidence.json'), 'utf8')).disposition).toBe('verified_same_step_cas_requested');
  });

  test('CLI modes require explicit Sandbox, exact run/request, and a private receipt for recovery', () => {
    const common = ['node', 'scripts/factory-file-readback.mjs', '--target=sandbox', `--run-id=${RUN_ID}`, '--confirm-request=9000001'];
    expect(parseFileReadbackArgs(common).recover).toBe(false);
    expect(parseFileReadbackArgs([...common, '--recover', '--receipt-out=/tmp/private.json']).recover).toBe(true);
    expect(parseFileReadbackArgs([...common, '--manifest=/tmp/manifest.json', '--bundle=/tmp/bundle.json']).manifestPath).toBe('/tmp/manifest.json');
    expect(() => parseFileReadbackArgs([...common, '--manifest=/tmp/manifest.json'])).toThrow();
    expect(() => parseFileReadbackArgs(['node', 'script', '--target=production', `--run-id=${RUN_ID}`, '--confirm-request=9000001'])).toThrow();
    expect(() => parseFileReadbackArgs([...common, '--recover'])).toThrow();
    expect(() => parseFileReadbackArgs([...common, '--actor=admin:44444444-4444-4444-8444-444444444444'])).toThrow();
    expect(() => parseFileReadbackArgs([...common, '--target=sandbox'])).toThrow();
  });
});
