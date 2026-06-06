/**
 * reviewer-name-match — the SINGLE source of truth for reviewer-name
 * normalization + exact (normalized) exclusion matching, shared by the
 * server (`/api/reviewer-finder/discover` dedup, `reviewer-roster-store`) and
 * the client (`reviewer-search-logic.js` re-exports these). CommonJS so the
 * CJS API routes / store can `require` it and the ESM client module can import
 * it — one implementation, no drift between where Claude is soft-blocked, where
 * `/discover` hard-filters, and where the roster dedup key is computed.
 *
 * Pure: no I/O, no deps.
 */

/**
 * Normalize a reviewer name for exclusion / dedup matching: fold diacritics to
 * their base letter, then drop honorifics + punctuation.
 *
 * Diacritic folding is via Unicode NFKD (decompose) + combining-mark strip, so
 * "Jens Hör" → "jens hor" and matches a plain-ASCII "Jens Hor" (a previous
 * `[^a-z]` strip turned "hör" into "hr" and silently MISSED that match — Codex
 * S210). Mirrors `DeduplicationService.normalizeName`.
 *
 * NB: folds accented letters (ö→o, é→e) and ß→ss, but deliberately does NOT
 * fold spelled-out transliteration digraphs (ö↔oe, ü↔ue): a blanket oe→o / ue→u
 * rule would mangle unrelated names ("Manuel"→"manl") and over-filter.
 */
function normalizeReviewerName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .replace(/ß/g, 'ss') // sharp-s (ß) does not NFKD-decompose
    .toLowerCase()
    .replace(/^(dr|prof|professor|mr|mrs|ms)\.?\s+/i, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a Set of normalized excluded names (drops blanks). */
function buildExcludedSet(excludedNames) {
  return new Set(
    (Array.isArray(excludedNames) ? excludedNames : [])
      .map(normalizeReviewerName)
      .filter(Boolean),
  );
}

/**
 * Partition items into { kept, removed } by EXACT normalized-name match against
 * `excludedNames`. `getName` extracts the name from each item (default `x.name`).
 * Exact (not fuzzy) so it never over-filters — and intentionally distinct from
 * the fuzzy `DeduplicationService.filterProposalAuthors` (`areNamesSimilar`),
 * which serves a different purpose and must NOT be merged with this.
 */
function partitionByExcluded(items, excludedNames, getName = (x) => x && x.name) {
  const list = Array.isArray(items) ? items : [];
  const exSet = buildExcludedSet(excludedNames);
  if (exSet.size === 0) return { kept: list, removed: [] };
  const kept = [];
  const removed = [];
  for (const item of list) {
    if (exSet.has(normalizeReviewerName(getName(item)))) removed.push(item);
    else kept.push(item);
  }
  return { kept, removed };
}

module.exports = { normalizeReviewerName, buildExcludedSet, partitionByExcluded };
