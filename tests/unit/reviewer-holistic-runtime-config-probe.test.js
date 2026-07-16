/**
 * @jest-environment node
 */
import {
  canonicalize,
  runtimeConfigDiff,
  sha256Canonical,
} from '../../scripts/probe-reviewer-holistic-runtime-config.mjs';

describe('reviewer holistic runtime-config probe helpers', () => {
  test('canonical hashing is stable across object-key order', () => {
    expect(canonicalize({ z: 1, a: { d: 4, b: 2 } })).toEqual({ a: { b: 2, d: 4 }, z: 1 });
    expect(sha256Canonical({ z: 1, a: 2 })).toBe(sha256Canonical({ a: 2, z: 1 }));
  });

  test('runtimeConfigDiff identifies only changed or missing fields', () => {
    expect(runtimeConfigDiff(
      { promptVersion: '2', modelIds: ['m1'], reviewerCount: 15 },
      { reviewerCount: 15, modelIds: ['m1'], promptVersion: '2' },
    )).toEqual([]);
    expect(runtimeConfigDiff(
      { promptVersion: '2', reviewerCount: 15 },
      { promptVersion: '3', reviewerCount: 15, temperature: 0.3 },
    )).toEqual([
      { key: 'promptVersion', expected: '2', actual: '3' },
      { key: 'temperature', expected: undefined, actual: 0.3 },
    ]);
  });
});
