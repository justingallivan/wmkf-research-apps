/**
 * @jest-environment node
 *
 * Edge-case + interop coverage for lib/utils/chunk.js — the canonical
 * array-chunking helper consolidating the hand-rolled
 * `for (i += N) { slice(i, i+N) }` scaffold used at 17 sites
 * (docs/CHUNK_CONSOLIDATION_PLAN.md). Every behavior pinned here is the
 * contract the 17 mechanical swaps rely on staying byte-identical.
 */
import { chunk } from '../../../lib/utils/chunk.js';

describe('chunk (edge cases)', () => {
  test('partial tail: last sub-array is shorter than size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('empty array -> []', () => {
    expect(chunk([], 5)).toEqual([]);
  });

  test('size larger than array -> one sub-array containing everything', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  test('exact multiple: two full batches, order preserved, input not mutated', () => {
    const input = [1, 2, 3, 4];
    const out = chunk(input, 2);
    expect(out).toEqual([[1, 2], [3, 4]]);
    expect(input).toEqual([1, 2, 3, 4]); // not mutated
  });

  test.each([null, undefined, {}, 'str'])('non-array input %p -> TypeError', (bad) => {
    expect(() => chunk(bad, 2)).toThrow(TypeError);
  });

  test.each([0, -1, 2.5, NaN, '2'])('non-positive-integer size %p -> RangeError', (badSize) => {
    expect(() => chunk([1, 2, 3], badSize)).toThrow(RangeError);
  });
});

describe('chunk (CJS/ESM interop pin)', () => {
  test('CJS require resolves the named export and runs green', () => {
    // Mirrors the exercise-1 Stage Log step (require('…/core/odata.js') CJS +
    // import * as odata ESM both green) — this is the require-from-CJS path
    // that matters for lib/services/discovery-service.js (the one CJS
    // mechanical site, Stage 1 Cluster B, site 11).
    // eslint-disable-next-line global-require
    const { chunk: requiredChunk } = require('../../../lib/utils/chunk.js');
    expect(requiredChunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  test('ESM import (this file) resolves the same named export and runs green', () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});
