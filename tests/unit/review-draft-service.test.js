/**
 * Service-level tests for ReviewDraftService.
 *
 * Covers the UUID boundary guard, the draftJson shape guard, and the
 * pass-through return shapes for get/upsert/delete/GC. The SQL itself (the
 * ON CONFLICT (suggestion_id) upsert, the interval GC) is not a unit-test
 * shape — mocks don't exercise real Postgres semantics.
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({
  sql: jest.fn(async () => ({ rows: [], rowCount: 0 })),
}));

import { sql } from '@vercel/postgres';
import ReviewDraftService from '../../lib/services/review-draft-service';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ReviewDraftService — suggestionId guard', () => {
  const badIds = [undefined, null, '', 'not-a-uuid', '550e8400e29b41d4a716446655440000', 123];

  test.each(badIds)('getBySuggestion rejects %p', async (id) => {
    await expect(ReviewDraftService.getBySuggestion(id)).rejects.toThrow(/UUID/);
    expect(sql).not.toHaveBeenCalled();
  });

  test.each(badIds)('upsertDraftJson rejects %p', async (id) => {
    await expect(
      ReviewDraftService.upsertDraftJson({ suggestionId: id, draftJson: {} }),
    ).rejects.toThrow(/UUID/);
    expect(sql).not.toHaveBeenCalled();
  });

  test.each(badIds)('deleteBySuggestion rejects %p', async (id) => {
    await expect(ReviewDraftService.deleteBySuggestion(id)).rejects.toThrow(/UUID/);
    expect(sql).not.toHaveBeenCalled();
  });
});

describe('ReviewDraftService.upsertDraftJson — draftJson guard', () => {
  test.each([null, 'str', 42, []])('rejects non-object draftJson %p', async (draftJson) => {
    await expect(
      ReviewDraftService.upsertDraftJson({ suggestionId: VALID_UUID, draftJson }),
    ).rejects.toThrow(/draftJson must be an object/);
    expect(sql).not.toHaveBeenCalled();
  });

  test('accepts a valid object and returns the row', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 7, suggestion_id: VALID_UUID }] });
    const row = await ReviewDraftService.upsertDraftJson({
      suggestionId: VALID_UUID,
      draftJson: { q2: '<p>hi</p>', impact: 3 },
    });
    expect(row).toEqual({ id: 7, suggestion_id: VALID_UUID });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  test('defaults draftJson to {} when omitted', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 8 }] });
    const row = await ReviewDraftService.upsertDraftJson({ suggestionId: VALID_UUID });
    expect(row).toEqual({ id: 8 });
  });
});

describe('ReviewDraftService — reads and deletes', () => {
  test('getBySuggestion returns the row when present', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 1, suggestion_id: VALID_UUID }] });
    expect(await ReviewDraftService.getBySuggestion(VALID_UUID)).toEqual({
      id: 1,
      suggestion_id: VALID_UUID,
    });
  });

  test('getBySuggestion returns null when absent', async () => {
    sql.mockResolvedValueOnce({ rows: [] });
    expect(await ReviewDraftService.getBySuggestion(VALID_UUID)).toBeNull();
  });

  test('deleteBySuggestion returns rowCount (idempotent 0)', async () => {
    sql.mockResolvedValueOnce({ rowCount: 0 });
    expect(await ReviewDraftService.deleteBySuggestion(VALID_UUID)).toBe(0);
    sql.mockResolvedValueOnce({ rowCount: 1 });
    expect(await ReviewDraftService.deleteBySuggestion(VALID_UUID)).toBe(1);
  });

  test('deleteExpired returns rows deleted', async () => {
    sql.mockResolvedValueOnce({ rowCount: 4 });
    expect(await ReviewDraftService.deleteExpired({ olderThanDays: 30 })).toBe(4);
  });
});
