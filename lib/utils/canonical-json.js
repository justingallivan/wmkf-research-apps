// @ts-check
/**
 * Canonical JSON serialization for structural equality checks.
 *
 * Two JSON-compatible values that differ only in object-key order or in the
 * whitespace of their original serialization should compare equal — e.g. a
 * prompt-variable contract re-saved by a form that rebuilds the object in a
 * different key order, or a pretty-printed vs. minified schema string. This
 * sorts object keys recursively (arrays keep their element order) before
 * stringifying, so `canonicalJson(a) === canonicalJson(b)` is true iff `a`
 * and `b` are structurally identical.
 */

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = sortKeysDeep(value[key]);
      return out;
    }, {});
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

module.exports = { canonicalJson, sortKeysDeep };
