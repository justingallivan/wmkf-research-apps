/**
 * Pure helpers for the in-panel reviewer search (Workbench Find).
 * Kept separate from the React component so they can be unit-tested.
 */

/**
 * Merge contact-enrichment results (from /enrich-contacts) back onto the chosen
 * candidates by name, mirroring the standalone Reviewer Finder's save mapping:
 * the enrichment's email/website take precedence, and the full contactEnrichment
 * object is attached for save-candidates to persist.
 *
 * @param {object[]} candidates
 * @param {Array<{name: string, contactEnrichment: object}>|null|undefined} enrichmentResults
 * @returns {object[]}
 */
export function mergeEnrichment(candidates, enrichmentResults) {
  if (!Array.isArray(candidates)) return [];
  if (!Array.isArray(enrichmentResults) || enrichmentResults.length === 0) return candidates;
  const byName = new Map();
  for (const r of enrichmentResults) {
    if (r && r.name && r.contactEnrichment) byName.set(r.name, r.contactEnrichment);
  }
  return candidates.map((c) => {
    const e = byName.get(c.name);
    if (!e) return c;
    return {
      ...c,
      contactEnrichment: e,
      email: e.email || c.email,
      website: e.website || c.website,
    };
  });
}

/**
 * Render a 0–1 or 0–100 score as an integer percentage, or null if absent.
 * Discovery returns relevanceScore as 0–100 and verificationConfidence as 0–1.
 */
export function asPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

/** Normalize a reviewer name for exclusion matching: drop honorifics + punctuation. */
export function normalizeReviewerName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^(dr|prof|professor|mr|mrs|ms)\.?\s+/i, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a comma/newline-separated exclude textbox into a clean name list. */
export function parseExcludeList(text) {
  if (!text) return [];
  return String(text)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Drop any candidate whose name normalizes to an excluded name. Exact (not fuzzy)
 * normalized match so it never over-filters. This is what makes the panel's
 * "applicant-excluded names are blocked from the results" claim TRUE — /discover
 * searches databases independently of the Claude soft-block, so excluded people
 * must be filtered client-side too (Codex S210, Finding 3).
 *
 * @returns {{ kept: object[], removed: object[] }}
 */
export function filterExcluded(candidates, excludedNames) {
  const list = Array.isArray(candidates) ? candidates : [];
  const ex = (Array.isArray(excludedNames) ? excludedNames : [])
    .map(normalizeReviewerName)
    .filter(Boolean);
  if (ex.length === 0) return { kept: list, removed: [] };
  const exSet = new Set(ex);
  const kept = [];
  const removed = [];
  for (const c of list) {
    if (exSet.has(normalizeReviewerName(c.name))) removed.push(c);
    else kept.push(c);
  }
  return { kept, removed };
}
