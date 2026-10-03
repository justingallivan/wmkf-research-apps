/**
 * Domain-local canonicalization for review-document manifests and fingerprints.
 * Preserves the historical Object.fromEntries / sorted-own-key behavior.
 * This helper is pure and synchronous; callers retain their own hash wrappers.
 */

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}
