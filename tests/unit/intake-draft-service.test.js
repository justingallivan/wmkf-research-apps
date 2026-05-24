/**
 * Service-level tests for IntakeDraftService.
 *
 * Today: covers the new upsertDraftJson pre-condition (Codex S183-round-9
 * LOW). The SQL race-safety of the jsonb_set + COALESCE + NULLIF construct
 * is intrinsically not a unit-test shape (mocks don't exercise SQL races
 * or PG JSONB null semantics); the SQL itself IS the test for those.
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({
  // Tagged-template stub. Returns an empty rowset by default; per-test
  // overrides can swap this out via jest.spyOn or reassignment.
  sql: jest.fn(async () => ({ rows: [{ id: 1 }] })),
}));

import { sql } from '@vercel/postgres';
import IntakeDraftService from '../../lib/services/intake-draft-service';

const validArgs = (overrides = {}) => ({
  contactOid: 'oid-1',
  accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  formKey: 'phase-ii-2026-06',
  draftJson: { idempotency_key: 'fixed-uuid', projectTitle: 'X' },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockResolvedValue({ rows: [{ id: 1 }] });
});

describe('IntakeDraftService.upsertDraftJson — required-arg validation', () => {
  test('missing contactOid throws', async () => {
    await expect(
      IntakeDraftService.upsertDraftJson(validArgs({ contactOid: '' })),
    ).rejects.toThrow(/contactOid/);
  });

  test('missing accountId throws', async () => {
    await expect(
      IntakeDraftService.upsertDraftJson(validArgs({ accountId: '' })),
    ).rejects.toThrow(/accountId/);
  });

  test('missing formKey throws', async () => {
    await expect(
      IntakeDraftService.upsertDraftJson(validArgs({ formKey: '' })),
    ).rejects.toThrow(/formKey/);
  });
});

describe('IntakeDraftService.upsertDraftJson — idempotency_key pre-condition', () => {
  // Codex S183-round-9 LOW: the SQL passes EXCLUDED.draft_json->
  // 'idempotency_key' into jsonb_set's new-value position. If that's
  // SQL NULL (key missing) AND the existing row also lacks the key,
  // jsonb_set receives NULL and would clobber draft_json. Service-level
  // pre-condition rejects the bad input at the boundary so the SQL
  // never sees it.

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['number', 123],
    ['boolean', true],
    ['array', []],
    ['object', {}],
  ])('rejects draftJson with idempotency_key=%s', async (_label, key) => {
    await expect(
      IntakeDraftService.upsertDraftJson(
        validArgs({ draftJson: { idempotency_key: key, projectTitle: 'X' } }),
      ),
    ).rejects.toThrow(/idempotency_key must be a non-empty string/);
    // SQL must never have been reached on the bad-input path
    expect(sql).not.toHaveBeenCalled();
  });

  test('rejects draftJson with idempotency_key missing entirely', async () => {
    await expect(
      IntakeDraftService.upsertDraftJson(
        validArgs({ draftJson: { projectTitle: 'X' } }),
      ),
    ).rejects.toThrow(/idempotency_key must be a non-empty string/);
    expect(sql).not.toHaveBeenCalled();
  });

  test('accepts a non-empty string idempotency_key', async () => {
    const row = await IntakeDraftService.upsertDraftJson(validArgs());
    expect(row).toEqual({ id: 1 });
    expect(sql).toHaveBeenCalledTimes(1);
  });
});
