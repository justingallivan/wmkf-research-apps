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

// A real-shape UUIDv4 (variant nibble = 8/9/a/b; version nibble = 4)
// — service-level precondition requires this shape exactly.
const VALID_UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';

const validArgs = (overrides = {}) => ({
  contactOid: 'oid-1',
  accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  formKey: 'phase-ii-2026-06',
  draftJson: { idempotency_key: VALID_UUID_V4, projectTitle: 'X' },
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

  // Shape rejection (must throw + must never reach SQL). Round-10
  // tightened the contract from "non-empty string" to "UUIDv4-shaped
  // string" — whitespace, control chars, arbitrary text, and even
  // mostly-correct UUIDs that fail the v4 variant/version nibbles
  // are all rejected.
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['tab + space only', '\t \t'],
    ['control char in middle', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'],
    ['arbitrary text', 'not-a-uuid'],
    ['UUIDv1 shape (version nibble = 1, not 4)', '550e8400-e29b-11d4-a716-446655440000'],
    ['UUIDv4 wrong variant (variant nibble = 7)', '550e8400-e29b-41d4-7716-446655440000'],
    ['too short', '550e8400-e29b-41d4-a716-44665544'],
    ['too long', '550e8400-e29b-41d4-a716-446655440000-extra'],
    ['1KB string', 'a'.repeat(1024)],
    ['number', 123],
    ['boolean', true],
    ['array', []],
    ['object', {}],
  ])('rejects draftJson with idempotency_key=%s', async (_label, key) => {
    await expect(
      IntakeDraftService.upsertDraftJson(
        validArgs({ draftJson: { idempotency_key: key, projectTitle: 'X' } }),
      ),
    ).rejects.toThrow(/idempotency_key must be a UUIDv4 string/);
    // SQL must never have been reached on the bad-input path
    expect(sql).not.toHaveBeenCalled();
  });

  test('rejects draftJson with idempotency_key missing entirely', async () => {
    await expect(
      IntakeDraftService.upsertDraftJson(
        validArgs({ draftJson: { projectTitle: 'X' } }),
      ),
    ).rejects.toThrow(/idempotency_key must be a UUIDv4 string/);
    expect(sql).not.toHaveBeenCalled();
  });

  test('accepts a real UUIDv4 idempotency_key', async () => {
    const row = await IntakeDraftService.upsertDraftJson(validArgs());
    expect(row).toEqual({ id: 1 });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  test('accepts uppercase UUIDv4 (case-insensitive matching)', async () => {
    const upper = VALID_UUID_V4.toUpperCase();
    const row = await IntakeDraftService.upsertDraftJson(
      validArgs({ draftJson: { idempotency_key: upper, projectTitle: 'X' } }),
    );
    expect(row).toEqual({ id: 1 });
  });
});
