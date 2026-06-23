/**
 * @jest-environment node
 */
import { parseForceKeys } from '../../scripts/lib/parse-force-keys.mjs';

describe('parseForceKeys', () => {
  const validKeys = ['k1', 'k2', 'k3'];

  test('--force-keys=all forces every key', () => {
    const result = parseForceKeys(['node', 'script', '--force-keys=all'], validKeys);
    expect(result.forceAll).toBe(true);
    expect([...result.forceKeys]).toEqual([]);
  });

  test('--force-keys=k1,k2 returns the requested valid key set', () => {
    const result = parseForceKeys(['node', 'script', '--force-keys=k1,k2'], validKeys);
    expect(result.forceAll).toBe(false);
    expect(result.forceKeys).toEqual(new Set(['k1', 'k2']));
  });

  test('unknown key throws with the bad key name', () => {
    expect(() => parseForceKeys(['--force-keys=k1,bad-key'], validKeys)).toThrow(/bad-key/);
  });

  test('no flag returns no forced keys', () => {
    const result = parseForceKeys([], validKeys);
    expect(result.forceAll).toBe(false);
    expect([...result.forceKeys]).toEqual([]);
  });

  test('trims whitespace in comma-separated keys', () => {
    const result = parseForceKeys(['--force-keys= k1, k2 ,k3 '], validKeys);
    expect(result.forceAll).toBe(false);
    expect(result.forceKeys).toEqual(new Set(['k1', 'k2', 'k3']));
  });
});
