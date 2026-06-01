/**
 * Coverage for the applicant excluded-reviewer free-text parser
 * (Request Workbench Phase 3, option B — soft-block names only).
 *
 * The deterministic noise filter (isSubstantiveExclusionText) gates the LLM
 * call so the ~30/35 D26 requests with "N/A"-style text never hit Claude; the
 * JSON parser (parseJsonArray) is tolerant of fences / chatter and dedupes.
 *
 * @jest-environment node
 */

import { isSubstantiveExclusionText, parseJsonArray } from '../../lib/services/reviewer-exclusion-parser.js';

describe('isSubstantiveExclusionText — noise filter', () => {
  test.each([
    null,
    undefined,
    '',
    '   ',
    'N/A',
    'n/a',
    'N/A.',
    'N/a',
    'na',
    'none',
    'None.',
    'no',
    'nil',
    '"N/A"',
    '(none)',
    '---',
    '.',
  ])('treats %p as non-substantive (no LLM call)', (input) => {
    expect(isSubstantiveExclusionText(input)).toBe(false);
  });

  test.each([
    'Jane Doe',
    'exclude Drs. Thomas K. Wood (Pennsylvania State University) and Jens Hör (Helmholtz Institute)',
    'Name: Jane Doe\nReason for Exclusion: direct competitor',
    'John Smith - competitor',
  ])('treats %p as substantive (worth extracting)', (input) => {
    expect(isSubstantiveExclusionText(input)).toBe(true);
  });
});

describe('parseJsonArray — tolerant JSON extraction + dedup', () => {
  test('parses a clean JSON array', () => {
    const out = parseJsonArray('[{"name":"Jane Doe","affiliation":"MIT"}]');
    expect(out).toEqual([{ name: 'Jane Doe', affiliation: 'MIT' }]);
  });

  test('strips markdown code fences', () => {
    const out = parseJsonArray('```json\n[{"name":"Jane Doe","affiliation":null}]\n```');
    expect(out).toEqual([{ name: 'Jane Doe', affiliation: null }]);
  });

  test('ignores leading/trailing chatter around the array', () => {
    const out = parseJsonArray('Here is the result: [{"name":"John Smith"}] hope that helps');
    expect(out).toEqual([{ name: 'John Smith', affiliation: null }]);
  });

  test('dedupes case-insensitively by name and drops nameless entries', () => {
    const out = parseJsonArray('[{"name":"Jane Doe","affiliation":"MIT"},{"name":"jane doe"},{"affiliation":"x"},{"name":"  "}]');
    expect(out).toEqual([{ name: 'Jane Doe', affiliation: 'MIT' }]);
  });

  test('returns [] for an empty array', () => {
    expect(parseJsonArray('[]')).toEqual([]);
  });

  test('returns [] for unparseable / non-array output', () => {
    expect(parseJsonArray('not json at all')).toEqual([]);
    expect(parseJsonArray('{"name":"x"}')).toEqual([]);
    expect(parseJsonArray('')).toEqual([]);
    expect(parseJsonArray(null)).toEqual([]);
  });

  test('blanks an empty-string affiliation to null', () => {
    const out = parseJsonArray('[{"name":"Jane Doe","affiliation":"   "}]');
    expect(out).toEqual([{ name: 'Jane Doe', affiliation: null }]);
  });
});
