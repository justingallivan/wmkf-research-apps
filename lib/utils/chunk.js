/**
 * Split `array` into consecutive sub-arrays of at most `size` elements, in order.
 * Fail-closed on bad input (matches the guarded-swap precedent in
 * docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md): a hand-rolled loop with a non-array or
 * a size <= 0 either throws on `.length`/`.slice` or (size 0) spins forever, so a
 * loud throw is a strictly safer superset, never a behavior regression for a real caller.
 */
export function chunk(array, size) {
  if (!Array.isArray(array)) throw new TypeError('chunk: array must be an array');
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('chunk: size must be a positive integer');
  }
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/**
 * Run `fn` over `items` with at most `limit` calls in flight; results come back
 * in input order. `limit` 1 (the default) is the plain sequential loop. After a
 * rejection no further items start, and the first rejection is thrown once the
 * calls already in flight settle.
 */
export async function mapBounded(items, fn, limit = 1) {
  if (!Array.isArray(items)) throw new TypeError('mapBounded: items must be an array');
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('mapBounded: limit must be a positive integer');
  const results = new Array(items.length);
  let next = 0;
  let failure = null;
  async function worker() {
    while (!failure && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failure ||= { error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure.error;
  return results;
}
