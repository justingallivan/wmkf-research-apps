/**
 * Tests for MaintenanceService.cleanupIntakePrivateBlobs (S187 #7).
 *
 * Covers the active-set query (union of 3 sources, scoped correctly),
 * retention cutoff, private-store token wiring, dryRun, and the soft-fail
 * paths (missing token, missing/invalid uploadedAt, not-found-on-delete).
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('@vercel/blob', () => ({ list: jest.fn(), del: jest.fn() }));
jest.mock('../../lib/utils/intake-blob', () => ({ getIntakeBlobToken: jest.fn() }));
// Stubs for the other deps maintenance-service imports — none are called by
// cleanupIntakePrivateBlobs but the module imports them at the top.
jest.mock('../../lib/services/database-service', () => ({ DatabaseService: {} }));
jest.mock('../../lib/services/settings-service', () => ({ listSettings: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: jest.fn() }));
jest.mock('../../lib/services/intake-draft-service', () => ({}));
jest.mock('../../lib/services/intake-audit-service', () => ({ log: jest.fn() }));

const { sql } = require('@vercel/postgres');
const { list, del } = require('@vercel/blob');
const { getIntakeBlobToken } = require('../../lib/utils/intake-blob');
const MaintenanceService = require('../../lib/services/maintenance-service');

const TOKEN = 'private-store-rw-token-fixture';
const NOW = Date.UTC(2026, 4, 25, 18, 0, 0); // 2026-05-25T18:00:00Z
const HOUR_MS = 3600 * 1000;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
  sql.mockReset();
  list.mockReset();
  del.mockReset();
  getIntakeBlobToken.mockReset().mockReturnValue(TOKEN);
});

afterEach(() => {
  jest.useRealTimers();
});

function blobAt(pathname, hoursAgo, extra = {}) {
  return {
    pathname,
    size: 1024,
    uploadedAt: new Date(NOW - hoursAgo * HOUR_MS).toISOString(),
    ...extra,
  };
}

describe('cleanupIntakePrivateBlobs — missing token', () => {
  it('fails soft with errors=1 and no list()/del() calls when token unavailable', async () => {
    getIntakeBlobToken.mockImplementationOnce(() => { throw new Error('INTAKE_BLOB_RW_TOKEN not set'); });
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(r.errors).toBe(1);
    expect(r.deleted).toBe(0);
    expect(list).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(r.details[0]).toMatch(/INTAKE_BLOB_RW_TOKEN missing/);
  });
});

describe('cleanupIntakePrivateBlobs — active-set query shape', () => {
  it('selects from all three sources with correct status + request_id scoping', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    list.mockResolvedValueOnce({ blobs: [], cursor: undefined });
    await MaintenanceService.cleanupIntakePrivateBlobs({});

    expect(sql).toHaveBeenCalledTimes(1);
    const [stringsArr] = sql.mock.calls[0];
    const template = Array.isArray(stringsArr) ? stringsArr.join('?') : '';
    // Pre-submit drafts only (request_id IS NULL)
    expect(template).toMatch(/intake_drafts[\s\S]*WHERE request_id IS NULL[\s\S]*attachments/i);
    // pending_attachments source
    expect(template).toMatch(/pending_attachments/i);
    // submission_jobs source — non-terminal status + jsonb_typeof guard
    expect(template).toMatch(/submission_jobs[\s\S]*status NOT IN[\s\S]*completed[\s\S]*failed[\s\S]*cancelled/i);
    expect(template).toMatch(/jsonb_typeof\(payload->'attachments'\)\s*=\s*'array'/i);
    // UNION ALL (per Codex Q3)
    expect((template.match(/UNION ALL/gi) || []).length).toBe(2);
  });
});

describe('cleanupIntakePrivateBlobs — retention + active-set filter', () => {
  it('skips blob newer than retention cutoff', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    list.mockResolvedValueOnce({
      blobs: [blobAt('drafts/1/aaa', 1)], // 1h ago — well under 72h default
      cursor: undefined,
    });
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(r.skipped).toBe(1);
    expect(r.deleted).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });

  it('skips blob whose pathname is in the active set', async () => {
    sql.mockResolvedValueOnce({ rows: [{ pathname: 'drafts/1/active' }] });
    list.mockResolvedValueOnce({
      blobs: [blobAt('drafts/1/active', 100)], // 100h ago — past cutoff but active
      cursor: undefined,
    });
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(r.skipped).toBe(1);
    expect(r.deleted).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes orphan blobs older than cutoff AND not in active set', async () => {
    sql.mockResolvedValueOnce({ rows: [{ pathname: 'drafts/1/keep' }] });
    list.mockResolvedValueOnce({
      blobs: [
        blobAt('drafts/1/keep', 100),   // active → skip
        blobAt('drafts/2/orphan', 100), // orphan + old → reap
        blobAt('drafts/3/recent', 1),   // not in active, but new → skip (retention)
      ],
      cursor: undefined,
    });
    del.mockResolvedValueOnce(undefined);
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(r.deleted).toBe(1);
    expect(r.skipped).toBe(2);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('drafts/2/orphan', { token: TOKEN });
  });
});

describe('cleanupIntakePrivateBlobs — submitted-draft-with-terminal-job scenario (Codex finding #4)', () => {
  it('reaps the byte: post-submit draft attachments[] is NOT in active set, terminal job is excluded', async () => {
    // Active-set query returns NOTHING because:
    //   - draft has request_id set (post-submit), excluded by WHERE request_id IS NULL
    //   - corresponding submission_jobs row is status='completed' (terminal), excluded
    sql.mockResolvedValueOnce({ rows: [] });
    list.mockResolvedValueOnce({
      blobs: [blobAt('drafts/42/done-submission', 100)],
      cursor: undefined,
    });
    del.mockResolvedValueOnce(undefined);
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(r.deleted).toBe(1);
    expect(del).toHaveBeenCalledWith('drafts/42/done-submission', { token: TOKEN });
  });
});

describe('cleanupIntakePrivateBlobs — defensive paths', () => {
  it('skips listing entries with missing/invalid uploadedAt rather than crashing', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    list.mockResolvedValueOnce({
      blobs: [
        { pathname: 'drafts/x/no-date', size: 100, uploadedAt: undefined },
        { pathname: 'drafts/y/bad-date', size: 100, uploadedAt: 'not-a-date' },
        blobAt('drafts/z/ok', 100),
      ],
      cursor: undefined,
    });
    del.mockResolvedValueOnce(undefined);
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(r.skipped).toBe(2);
    expect(r.deleted).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('not-found on del() counts as skipped, not error', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    list.mockResolvedValueOnce({ blobs: [blobAt('drafts/1/gone', 100)], cursor: undefined });
    del.mockRejectedValueOnce(Object.assign(new Error('Blob not found'), { status: 404 }));
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(r.skipped).toBe(1);
    expect(r.deleted).toBe(0);
    expect(r.errors).toBe(0);
  });

  it('non-404 del() failure counts as error, sweep continues', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    list.mockResolvedValueOnce({
      blobs: [blobAt('drafts/1/fail', 100), blobAt('drafts/2/ok', 100)],
      cursor: undefined,
    });
    del.mockRejectedValueOnce(new Error('transient 503'));
    del.mockResolvedValueOnce(undefined);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
      expect(r.deleted).toBe(1);
      expect(r.errors).toBe(1);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('cleanupIntakePrivateBlobs — dryRun', () => {
  it('counts as deleted without calling del()', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    list.mockResolvedValueOnce({ blobs: [blobAt('drafts/1/orphan', 100)], cursor: undefined });
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({ dryRun: true });
    expect(r.deleted).toBe(1);
    expect(del).not.toHaveBeenCalled();
    expect(r.details[0]).toMatch(/DRY RUN/);
  });
});

describe('cleanupIntakePrivateBlobs — token wiring', () => {
  it('passes the private-store token to BOTH list() and del() + scoping prefix on list()', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    list.mockResolvedValueOnce({ blobs: [blobAt('drafts/1/x', 100)], cursor: undefined });
    del.mockResolvedValueOnce(undefined);
    await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, prefix: 'drafts/' }));
    expect(del).toHaveBeenCalledWith('drafts/1/x', { token: TOKEN });
  });
});

describe('cleanupIntakePrivateBlobs — paging', () => {
  it('walks multiple pages via cursor', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    list
      .mockResolvedValueOnce({ blobs: [blobAt('p1/a', 100)], cursor: 'c1' })
      .mockResolvedValueOnce({ blobs: [blobAt('p2/b', 100)], cursor: undefined });
    del.mockResolvedValue(undefined);
    const r = await MaintenanceService.cleanupIntakePrivateBlobs({});
    expect(list).toHaveBeenCalledTimes(2);
    expect(r.deleted).toBe(2);
  });
});
