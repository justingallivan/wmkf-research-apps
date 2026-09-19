/**
 * Stage 0 characterization: pure-unit tests for the restriction-guard helpers
 * (checkRestriction, splitChatExpandSegments, redactRestrictedFieldNames), now
 * extracted to lib/services/dynamics-explorer/restriction-guard.js, a leaf
 * module with no dependencies.
 *
 * Plan: docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_PLAN_2026-09-18.md
 * section 4, items 8-10.
 */

import {
  checkRestriction,
  splitChatExpandSegments,
  redactRestrictedFieldNames,
} from '../../lib/services/dynamics-explorer/restriction-guard';

describe('checkRestriction (Stage 0 characterization)', () => {
  test('table-level block: a restriction row with no field_name blocks the whole table', () => {
    const restrictions = [{ table_name: 'wmkf_secret_table', field_name: null }];
    expect(checkRestriction('query_records', { table_name: 'wmkf_secret_table' }, restrictions))
      .toBe('Table "wmkf_secret_table" is restricted');
  });

  test('field-level block via $select', () => {
    const restrictions = [{ table_name: 'akoya_request', field_name: 'a' }];
    expect(checkRestriction('query_records', { table_name: 'akoya_request', select: 'a,b' }, restrictions))
      .toBe('Field "a" is restricted');
  });

  test('field-level block via aggregate `field`', () => {
    const restrictions = [{ table_name: 'akoya_request', field_name: 'a' }];
    expect(checkRestriction('aggregate', { table_name: 'akoya_request', field: 'a' }, restrictions))
      .toBe('Field "a" is restricted');
  });

  test('field-level block via aggregate `group_by`', () => {
    const restrictions = [{ table_name: 'akoya_request', field_name: 'b' }];
    expect(checkRestriction('aggregate', { table_name: 'akoya_request', field: 'a', group_by: 'b' }, restrictions))
      .toBe('Field "b" is restricted');
  });

  test('table-level block via $expand navigation property (case-insensitive substring)', () => {
    const restrictions = [{ table_name: 'y', field_name: null }];
    const result = checkRestriction('query_records', { table_name: 'x', expand: 'Y' }, restrictions);
    expect(result).toBe('Table "y" is restricted (referenced via $expand "Y")');
  });

  test('field-level block via nested $select inside $expand, matched against the OUTER table', () => {
    const restrictions = [{ table_name: 'x', field_name: 'a' }];
    const result = checkRestriction(
      'query_records',
      { table_name: 'x', expand: 'y($select=a,b)' },
      restrictions,
    );
    expect(result).toBe('Field "a" is restricted (referenced via $expand nested $select)');
  });

  test('nested $select restriction does not fire when the restriction row names a different table', () => {
    const restrictions = [{ table_name: 'z', field_name: 'a' }];
    const result = checkRestriction(
      'query_records',
      { table_name: 'x', expand: 'y($select=a,b)' },
      restrictions,
    );
    expect(result).toBeNull();
  });

  test('negative case: $filter referencing a restricted field is NOT inspected (pre-existing gap, pinned deliberately)', () => {
    const restrictions = [{ table_name: 'x', field_name: 'a' }];
    const result = checkRestriction(
      'query_records',
      { table_name: 'x', filter: "a eq 'secret'" },
      restrictions,
    );
    expect(result).toBeNull();
  });

  test('no restrictions configured: always null', () => {
    expect(checkRestriction('query_records', { table_name: 'x' }, [])).toBeNull();
  });

  test('no table_name on input: always null even with restrictions configured', () => {
    const restrictions = [{ table_name: 'x', field_name: null }];
    expect(checkRestriction('query_records', {}, restrictions)).toBeNull();
  });
});

describe('splitChatExpandSegments (Stage 0 characterization)', () => {
  test('splits top-level commas, respecting nested parentheses', () => {
    expect(splitChatExpandSegments('a($select=x),b($filter=y(z))')).toEqual([
      'a($select=x)',
      'b($filter=y(z))',
    ]);
  });

  test('a bare comma-separated list with no parentheses splits normally', () => {
    expect(splitChatExpandSegments('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('a single segment with no commas returns one segment', () => {
    expect(splitChatExpandSegments('a($select=x;$filter=y)')).toEqual(['a($select=x;$filter=y)']);
  });
});

describe('redactRestrictedFieldNames (Stage 0 characterization)', () => {
  test('replaces every occurrence of a restricted field name with [restricted]', () => {
    const text = 'Filter by wmkf_secret or wmkf_secret again.';
    const result = redactRestrictedFieldNames(text, new Set(['wmkf_secret']));
    expect(result).toBe('Filter by [restricted] or [restricted] again.');
  });

  test('does not touch a restricted name that appears as a substring of a longer identifier', () => {
    const text = 'wmkf_secret_extended is unrelated to wmkf_secret.';
    const result = redactRestrictedFieldNames(text, new Set(['wmkf_secret']));
    expect(result).toBe('wmkf_secret_extended is unrelated to [restricted].');
  });

  test('leaves other text intact when the set is empty', () => {
    const text = 'nothing restricted here';
    expect(redactRestrictedFieldNames(text, new Set())).toBe(text);
  });

  test('returns falsy text unchanged', () => {
    expect(redactRestrictedFieldNames('', new Set(['x']))).toBe('');
    expect(redactRestrictedFieldNames(null, new Set(['x']))).toBeNull();
  });
});
