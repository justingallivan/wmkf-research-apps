/**
 * Regeneration and shape tests for the Stage 1 institution-pair-consistency
 * fixtures (docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md, Wave 1A).
 *
 * These are gate fixtures, not application unit tests: they assert the
 * frozen sibling-pair generator reproduces its tracked output
 * byte-identically, and that both tracked case files conform to their
 * documented schema and expected-value vocabulary.
 */

const fs = require('fs');
const path = require('path');

const {
  buildRows,
  buildJsonl,
  OUTPUT_PATH,
} = require('../../../benchmarks/institution-pair-consistency/generate-sibling-pairs');

const CASES_DIR = path.join(
  __dirname,
  '../../../benchmarks/institution-pair-consistency/cases'
);
const SIBLING_PAIRS_PATH = path.join(CASES_DIR, 'uc-sibling-pairs.jsonl');
const REQUEST_1002903_PATH = path.join(CASES_DIR, 'request-1002903-pairs.jsonl');

function readJsonlRows(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.length > 0);
  return lines.map((line) => JSON.parse(line));
}

describe('institution-pair-consistency fixtures', () => {
  describe('uc-sibling-pairs.jsonl (frozen generator)', () => {
    it('exports the tracked output path pointing at the checked-in case file', () => {
      expect(OUTPUT_PATH).toBe(SIBLING_PAIRS_PATH);
    });

    it('reproduces the tracked case file byte-identically from the generator', () => {
      const regenerated = buildJsonl();
      const tracked = fs.readFileSync(SIBLING_PAIRS_PATH, 'utf8');
      expect(regenerated).toBe(tracked);
    });

    it('every row has an expected value in {same, distinct, related-surface}', () => {
      const rows = buildRows();
      expect(rows.length).toBeGreaterThan(0);
      const allowed = new Set(['same', 'distinct', 'related-surface']);
      for (const row of rows) {
        expect(allowed.has(row.expected)).toBe(true);
      }
    });

    it('every cross-campus pair (uc-cross-*) is expected "distinct"', () => {
      const rows = buildRows();
      const crossRows = rows.filter((row) => row.caseId.startsWith('uc-cross-'));
      expect(crossRows.length).toBeGreaterThan(0);
      for (const row of crossRows) {
        expect(row.expected).toBe('distinct');
      }
    });

    it('has no duplicate caseIds', () => {
      const rows = buildRows();
      const ids = rows.map((row) => row.caseId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('request-1002903-pairs.jsonl (tracked sanitized fixture)', () => {
    it('parses as JSONL with exactly 5 rows', () => {
      const rows = readJsonlRows(REQUEST_1002903_PATH);
      expect(rows).toHaveLength(5);
    });

    it('every row has expected value in {same, distinct} only', () => {
      const rows = readJsonlRows(REQUEST_1002903_PATH);
      const allowed = new Set(['same', 'distinct']);
      for (const row of rows) {
        expect(allowed.has(row.expected)).toBe(true);
      }
    });

    it('every row has the required schema fields', () => {
      const rows = readJsonlRows(REQUEST_1002903_PATH);
      for (const row of rows) {
        expect(typeof row.caseId).toBe('string');
        expect(typeof row.source).toBe('string');
        expect(typeof row.left).toBe('string');
        expect(typeof row.right).toBe('string');
        expect(typeof row.expected).toBe('string');
        expect(typeof row.notes).toBe('string');
      }
    });

    it('contains no person-name fields anywhere in the fixture', () => {
      const raw = fs.readFileSync(REQUEST_1002903_PATH, 'utf8');
      const forbiddenKeys = ['name', 'reviewerName', 'person', 'author', 'byline_author'];
      const rows = readJsonlRows(REQUEST_1002903_PATH);
      for (const row of rows) {
        for (const key of forbiddenKeys) {
          expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(false);
        }
      }
      // Belt-and-suspenders: the schema itself only carries institution
      // strings (left/right), never a dedicated name field.
      expect(raw).not.toMatch(/"name"\s*:/);
    });
  });
});
