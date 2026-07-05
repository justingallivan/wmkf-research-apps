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
