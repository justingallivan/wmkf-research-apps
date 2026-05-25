/**
 * Service-level tests for IntakeDraftService's pending-attachment
 * helpers (S184 chunk 3). Mocked @vercel/postgres — these tests
 * verify return-shape contracts and parameter validation. The actual
 * SQL race-safety (EvalPlanQual on UPDATE WHERE re-evaluation, JSONB
 * aggregation semantics, timestamptz cast on JSONB strings) is
 * intrinsically not unit-testable with mocks; integration tests in
 * chunks 4 + 5 exercise real Postgres.
 *
 * Spec: docs/INTAKE_ATTACH_CHUNK3_DESIGN.md
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => {
  const sql = jest.fn(async () => ({ rows: [] }));
  return { sql };
});

import { sql } from '@vercel/postgres';
import IntakeDraftService from '../../lib/services/intake-draft-service';

const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_ATTACHMENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const DRAFT_ID = 42;

const pendingEntry = (overrides = {}) => ({
  attachmentId: ATTACHMENT_ID,
  fieldKey: 'budget_justification_attachment',
  filename: 'budget.pdf',
  pathname: `drafts/${DRAFT_ID}/${ATTACHMENT_ID}`,
  contentType: 'application/pdf',
  maxBytes: 10485760,
  createdAt: '2026-05-24T20:00:00.000Z',
  validUntil: '2026-05-24T21:00:00.000Z',
  ...overrides,
});

const cleanRow = (overrides = {}) => ({
  attachmentId: ATTACHMENT_ID,
  fieldKey: 'budget_justification_attachment',
  filename: 'budget.pdf',
  pathname: `drafts/${DRAFT_ID}/${ATTACHMENT_ID}`,
  blob_url: 'https://blob.vercel-storage.com/x',
  sha256: 'a'.repeat(64),
  size: 1234,
  contentType: 'application/pdf',
  scan_result: 'clean',
  scanner: 'cloudmersive',
  scanned_at: '2026-05-24T20:00:30.000Z',
  ...overrides,
});

afterEach(() => {
  sql.mockReset();
  sql.mockImplementation(async () => ({ rows: [] }));
});

describe('getById', () => {
  test('returns the row when found', async () => {
    const row = { id: DRAFT_ID, contact_oid: 'oid-x', account_id: 'acct-x' };
    sql.mockResolvedValueOnce({ rows: [row] });
    const result = await IntakeDraftService.getById(DRAFT_ID);
    expect(result).toEqual(row);
  });

  test('returns null when not found', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    const result = await IntakeDraftService.getById(999);
    expect(result).toBeNull();
  });
});

describe('appendPending', () => {
  test('happy path returns the new pending array', async () => {
    const entry = pendingEntry();
    sql.mockResolvedValueOnce({ rows: [{ pending_attachments: [entry] }] });
    const result = await IntakeDraftService.appendPending(DRAFT_ID, entry);
    expect(result).toEqual({ pending: [entry] });
  });

  test('idempotent on duplicate attachmentId — array still contains it once', async () => {
    // SQL would CASE-return the unchanged array; the helper just
    // surfaces whatever the DB returned. Caller can re-check membership.
    const entry = pendingEntry();
    sql.mockResolvedValueOnce({ rows: [{ pending_attachments: [entry] }] });
    const result = await IntakeDraftService.appendPending(DRAFT_ID, entry);
    expect(result.pending.filter(e => e.attachmentId === ATTACHMENT_ID)).toHaveLength(1);
  });

  test('draft not found → null', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    const result = await IntakeDraftService.appendPending(999, pendingEntry());
    expect(result).toBeNull();
  });

  test('throws on entry missing attachmentId', async () => {
    await expect(
      IntakeDraftService.appendPending(DRAFT_ID, { fieldKey: 'x' }),
    ).rejects.toThrow(/attachmentId/);
  });
});

describe('selectPendingForDraft', () => {
  test('happy path returns the pending array', async () => {
    const entries = [pendingEntry(), pendingEntry({ attachmentId: OTHER_ATTACHMENT_ID })];
    sql.mockResolvedValueOnce({ rows: [{ pending_attachments: entries }] });
    const result = await IntakeDraftService.selectPendingForDraft(DRAFT_ID);
    expect(result).toEqual(entries);
  });

  test('empty pending → []', async () => {
    sql.mockResolvedValueOnce({ rows: [{ pending_attachments: [] }] });
    const result = await IntakeDraftService.selectPendingForDraft(DRAFT_ID);
    expect(result).toEqual([]);
  });

  test('draft not found → null', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    const result = await IntakeDraftService.selectPendingForDraft(999);
    expect(result).toBeNull();
  });
});

describe('promoteToClean', () => {
  const CARDINALITY = { fieldKey: 'pi_biosketch', cap: 1 };

  test('happy path: UPDATE returns 1 row → {promoted: true}', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: DRAFT_ID }] });
    const result = await IntakeDraftService.promoteToClean(
      DRAFT_ID, ATTACHMENT_ID, cleanRow(), CARDINALITY,
    );
    expect(result).toEqual({ promoted: true });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  test('race already promoted: 0 rows, probe shows in attachments[]', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ in_attachments: true, in_pending: false, field_count: '1' }] });
    const result = await IntakeDraftService.promoteToClean(
      DRAFT_ID, ATTACHMENT_ID, cleanRow(), CARDINALITY,
    );
    expect(result).toEqual({ promoted: false, reason: 'race_already_promoted' });
  });

  test('cap exceeded race: 0 rows, probe shows still in pending + field at cap', async () => {
    // Cardinality gate blocked UPDATE; entry still pending.
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ in_attachments: false, in_pending: true, field_count: '1' }] });
    const result = await IntakeDraftService.promoteToClean(
      DRAFT_ID, ATTACHMENT_ID, cleanRow(), CARDINALITY,
    );
    expect(result).toEqual({
      promoted: false, reason: 'cap_exceeded_race', fieldCount: 1, cap: 1,
    });
  });

  test('pending swept: 0 rows, probe shows in neither', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ in_attachments: false, in_pending: false, field_count: '0' }] });
    const result = await IntakeDraftService.promoteToClean(
      DRAFT_ID, ATTACHMENT_ID, cleanRow(), CARDINALITY,
    );
    expect(result).toEqual({ promoted: false, reason: 'pending_not_found' });
  });

  test('draft not found: 0 rows, probe returns no row', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await IntakeDraftService.promoteToClean(
      999, ATTACHMENT_ID, cleanRow(), CARDINALITY,
    );
    expect(result).toEqual({ promoted: false, reason: 'draft_not_found' });
  });

  test('throws on missing attachmentId', async () => {
    await expect(
      IntakeDraftService.promoteToClean(DRAFT_ID, '', cleanRow(), CARDINALITY),
    ).rejects.toThrow(/attachmentId/);
  });

  test('throws on missing fieldCardinality', async () => {
    await expect(
      IntakeDraftService.promoteToClean(DRAFT_ID, ATTACHMENT_ID, cleanRow()),
    ).rejects.toThrow(/fieldCardinality/);
  });

  test('throws on fieldCardinality cap < 1', async () => {
    await expect(
      IntakeDraftService.promoteToClean(
        DRAFT_ID, ATTACHMENT_ID, cleanRow(), { fieldKey: 'x', cap: 0 },
      ),
    ).rejects.toThrow(/fieldCardinality/);
  });

  test('field_count returned as a numeric string from PG is coerced to Number (Codex Q4)', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ in_attachments: false, in_pending: true, field_count: '7' }] });
    const result = await IntakeDraftService.promoteToClean(
      DRAFT_ID, ATTACHMENT_ID, cleanRow(), { fieldKey: 'co_investigator_biosketches', cap: 5 },
    );
    expect(result.fieldCount).toBe(7); // not '7'
    expect(typeof result.fieldCount).toBe('number');
  });

  test('cap parameter is passed into the SQL bind values', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: DRAFT_ID }] });
    await IntakeDraftService.promoteToClean(
      DRAFT_ID, ATTACHMENT_ID, cleanRow(), { fieldKey: 'pi_biosketch', cap: 5 },
    );
    // Tagged-template invocation: interpolated values follow the strings array.
    const interpolated = sql.mock.calls[0].slice(1);
    expect(interpolated).toContain('pi_biosketch');
    expect(interpolated).toContain(5);
  });
});

describe('removePending', () => {
  test('happy path: 1 row updated → {removed: true}', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: DRAFT_ID }] });
    const result = await IntakeDraftService.removePending(DRAFT_ID, ATTACHMENT_ID);
    expect(result).toEqual({ removed: true });
  });

  test('entry absent: 0 rows → {removed: false}', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    const result = await IntakeDraftService.removePending(DRAFT_ID, ATTACHMENT_ID);
    expect(result).toEqual({ removed: false });
  });

  test('throws on missing attachmentId', async () => {
    await expect(
      IntakeDraftService.removePending(DRAFT_ID, ''),
    ).rejects.toThrow(/attachmentId/);
  });
});

describe('listPendingOlderThan', () => {
  const cutoff = '2026-05-24T19:00:00.000Z';

  test('happy path: flat list of {draftId, entry}', async () => {
    const entry1 = pendingEntry();
    const entry2 = pendingEntry({ attachmentId: OTHER_ATTACHMENT_ID });
    sql.mockResolvedValueOnce({
      rows: [
        { draft_id: 1, entry: entry1 },
        { draft_id: 2, entry: entry2 },
      ],
    });
    const result = await IntakeDraftService.listPendingOlderThan(cutoff);
    expect(result).toEqual([
      { draftId: 1, entry: entry1 },
      { draftId: 2, entry: entry2 },
    ]);
  });

  test('empty result: []', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    const result = await IntakeDraftService.listPendingOlderThan(cutoff);
    expect(result).toEqual([]);
  });

  test('cutoff string passed to SQL unchanged (no in-helper clock read)', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    await IntakeDraftService.listPendingOlderThan(cutoff);
    // Tagged-template invocation: first arg is the strings array, the
    // interpolated values follow. The cutoff should appear in the args.
    const callArgs = sql.mock.calls[0];
    const interpolated = callArgs.slice(1);
    expect(interpolated).toContain(cutoff);
  });

  test('throws on missing cutoffIso', async () => {
    await expect(IntakeDraftService.listPendingOlderThan('')).rejects.toThrow(/cutoffIso/);
    await expect(IntakeDraftService.listPendingOlderThan(null)).rejects.toThrow(/cutoffIso/);
  });
});
