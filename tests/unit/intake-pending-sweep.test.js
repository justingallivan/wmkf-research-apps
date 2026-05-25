/**
 * Tests for MaintenanceService.sweepIntakePending (S184 chunk 6).
 *
 * Critical race-safety property: removePending is called BEFORE del,
 * so a concurrent /attach.promoteToClean (which atomically moves the
 * entry from pending_attachments to attachments and reuses the SAME
 * opaque pathname per S184 A5) cannot result in deleted clean bytes.
 * Codex chunk-6 pre-impl Q3+Q7.
 *
 * @jest-environment node
 */

jest.mock('@vercel/blob', () => ({
  list: jest.fn(),
  del: jest.fn(),
}));
jest.mock('../../lib/services/intake-draft-service', () => ({
  listPendingOlderThan: jest.fn(),
  removePending: jest.fn(),
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  log: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../lib/utils/intake-blob', () => ({
  getIntakeBlobToken: jest.fn(() => 'vercel_blob_rw_fake_token'),
}));
// Heavy dependencies of MaintenanceService unrelated to this method:
jest.mock('../../lib/services/database-service', () => ({}));
jest.mock('../../lib/services/settings-service', () => ({ listSettings: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { del } = require('@vercel/blob');
const IntakeDraftService = require('../../lib/services/intake-draft-service');
const IntakeAuditService = require('../../lib/services/intake-audit-service');
const { getIntakeBlobToken } = require('../../lib/utils/intake-blob');
const MaintenanceService = require('../../lib/services/maintenance-service');

const DRAFT_ID = 42;
const PATHNAME_A = 'drafts/42/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const PATHNAME_B = 'drafts/42/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

const STALE_ENTRY = (overrides = {}) => ({
  attachmentId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  fieldKey: 'pi_biosketch',
  filename: 'orphan.pdf',
  pathname: PATHNAME_A,
  createdAt: '2026-05-24T15:00:00.000Z',
  validUntil: '2026-05-24T16:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  getIntakeBlobToken.mockReturnValue('vercel_blob_rw_fake_token');
  IntakeDraftService.removePending.mockResolvedValue({ removed: true });
  del.mockResolvedValue(undefined);
});

describe('sweepIntakePending — happy paths', () => {
  test('empty stale list → {deleted:0, scanned:0, errors:0}', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([]);
    const result = await MaintenanceService.sweepIntakePending();
    expect(result).toEqual({
      deleted: 0, scanned: 0, errors: 0,
      blobDelErrors: 0, removePendingErrors: 0,
    });
    expect(del).not.toHaveBeenCalled();
    expect(IntakeAuditService.log).not.toHaveBeenCalled();
  });

  test('one stale entry → removePending + del + audit', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.deleted).toBe(1);
    expect(result.scanned).toBe(1);
    expect(result.errors).toBe(0);
    expect(IntakeDraftService.removePending).toHaveBeenCalledWith(
      DRAFT_ID, STALE_ENTRY().attachmentId,
    );
    expect(del).toHaveBeenCalledWith(PATHNAME_A, expect.objectContaining({
      token: 'vercel_blob_rw_fake_token',
    }));
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'draft.attach_orphan_swept',
        actorType: 'system',
        actorOid: null,
        targetId: DRAFT_ID,
      }),
    );
  });

  test('two stale entries → both processed', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
      { draftId: 99, entry: STALE_ENTRY({ attachmentId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', pathname: PATHNAME_B }) },
    ]);
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.deleted).toBe(2);
    expect(result.scanned).toBe(2);
    expect(del).toHaveBeenCalledTimes(2);
    expect(IntakeAuditService.log).toHaveBeenCalledTimes(2);
  });
});

describe('sweepIntakePending — race + error paths', () => {
  test('concurrent /attach promoted entry: removePending returns {removed:false} → NO del, NO audit (race-safety)', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    IntakeDraftService.removePending.mockResolvedValue({ removed: false });
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.deleted).toBe(0);
    expect(result.scanned).toBe(1);
    expect(del).not.toHaveBeenCalled();   // <-- the critical race-safety assertion
    expect(IntakeAuditService.log).not.toHaveBeenCalled();
  });

  test('removePending throws → removePendingErrors++ + NO del + NO audit', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    IntakeDraftService.removePending.mockRejectedValue(new Error('pg blip'));
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.removePendingErrors).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.deleted).toBe(0);
    expect(del).not.toHaveBeenCalled();
    expect(IntakeAuditService.log).not.toHaveBeenCalled();
  });

  test('del 404 → swallowed (counted as success, no blobDelErrors)', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    del.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.deleted).toBe(1);
    expect(result.blobDelErrors).toBe(0);
    expect(IntakeAuditService.log).toHaveBeenCalled();
  });

  test('del transient error → blobDelErrors++ but entry still counted as deleted (removed from JSONB)', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    del.mockRejectedValue(new Error('blob 5xx'));
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.deleted).toBe(1);
    expect(result.blobDelErrors).toBe(1);
    expect(result.errors).toBe(1);
    expect(IntakeAuditService.log).toHaveBeenCalled(); // audit still fires
  });

  test('INTAKE_BLOB_RW_TOKEN unset → skip del, still removePending + audit', async () => {
    getIntakeBlobToken.mockImplementation(() => { throw new Error('not set'); });
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.deleted).toBe(1);
    expect(del).not.toHaveBeenCalled();
    expect(IntakeAuditService.log).toHaveBeenCalled();
  });
});

describe('sweepIntakePending — additional edge cases (Codex Q5)', () => {
  test('mixed two-entry: one race-loss + one normal completion', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY({ attachmentId: 'aaa', pathname: PATHNAME_A }) },
      { draftId: 99, entry: STALE_ENTRY({ attachmentId: 'bbb', pathname: PATHNAME_B }) },
    ]);
    IntakeDraftService.removePending
      .mockResolvedValueOnce({ removed: false })  // first: race-lost
      .mockResolvedValueOnce({ removed: true });  // second: normal
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.deleted).toBe(1);
    expect(result.scanned).toBe(2);
    // Exactly one del + one audit (the second entry only).
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(PATHNAME_B, expect.any(Object));
    expect(IntakeAuditService.log).toHaveBeenCalledTimes(1);
  });

  test('isBlobNotFound: status-only-404 (no "not found" in message) is swallowed', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    del.mockRejectedValue(Object.assign(new Error('some-other-message'), { status: 404 }));
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.blobDelErrors).toBe(0);
    expect(result.deleted).toBe(1);
  });

  test('isBlobNotFound: message-only-404 (no status) is swallowed', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    del.mockRejectedValue(new Error('blob: 404 not found at this pathname'));
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.blobDelErrors).toBe(0);
    expect(result.deleted).toBe(1);
  });

  test('listPendingOlderThan throws → propagates (cron handler catches at the wrapper)', async () => {
    IntakeDraftService.listPendingOlderThan.mockRejectedValue(new Error('pg connection refused'));
    await expect(MaintenanceService.sweepIntakePending()).rejects.toThrow(/connection refused/);
  });

  test('entry without pathname → skip del, still removePending + audit', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY({ pathname: undefined }) },
    ]);
    const result = await MaintenanceService.sweepIntakePending();
    expect(result.deleted).toBe(1);
    expect(del).not.toHaveBeenCalled();
    expect(IntakeAuditService.log).toHaveBeenCalled();
  });
});

describe('sweepIntakePending — contract details', () => {
  test('default cutoff is 2 hours back from now', async () => {
    const before = Date.now();
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([]);
    await MaintenanceService.sweepIntakePending();
    const after = Date.now();
    const passedCutoff = IntakeDraftService.listPendingOlderThan.mock.calls[0][0];
    const cutoffMs = new Date(passedCutoff).getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 2 * 3600_000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 2 * 3600_000);
  });

  test('audit metadata has A3 split + cutoffIso for forensics', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([
      { draftId: DRAFT_ID, entry: STALE_ENTRY() },
    ]);
    await MaintenanceService.sweepIntakePending();
    expect(IntakeAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { filename: 'orphan.pdf' },
        metadata: expect.objectContaining({
          draftId: DRAFT_ID,
          attachmentId: STALE_ENTRY().attachmentId,
          fieldKey: 'pi_biosketch',
          pathname: PATHNAME_A,
          createdAt: '2026-05-24T15:00:00.000Z',
          validUntil: '2026-05-24T16:00:00.000Z',
          cutoffIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      }),
    );
  });

  test('result shape includes both granular and total `errors` for cron formatter compat', async () => {
    IntakeDraftService.listPendingOlderThan.mockResolvedValue([]);
    const result = await MaintenanceService.sweepIntakePending();
    expect(result).toHaveProperty('deleted');
    expect(result).toHaveProperty('scanned');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('blobDelErrors');
    expect(result).toHaveProperty('removePendingErrors');
  });
});
