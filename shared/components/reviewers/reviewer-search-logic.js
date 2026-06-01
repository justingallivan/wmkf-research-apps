/**
 * Pure helpers for the in-panel reviewer search (Workbench Find).
 * Kept separate from the React component so they can be unit-tested.
 */

/**
 * Merge contact-enrichment results (from /enrich-contacts) back onto the chosen
 * candidates by name, mirroring the standalone Reviewer Finder's save mapping.
 * The enrichment's contact + bibliometric fields take precedence and are also
 * promoted to the candidate top-level, because save-candidates.js reads them off
 * `candidate.*` (email/website/orcid/website/hIndex/i10Index/totalCitations/…),
 * NOT off `candidate.contactEnrichment.*`. The full contactEnrichment object is
 * also attached so the card can render source/year detail.
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
      facultyPageUrl: e.facultyPageUrl || c.facultyPageUrl,
      department: e.department || c.department,
      orcid: e.orcid || e.orcidId || c.orcid,
      orcidUrl: e.orcidUrl || c.orcidUrl,
      googleScholarId: e.googleScholarId || c.googleScholarId,
      googleScholarUrl: e.googleScholarUrl || c.googleScholarUrl,
      // Bibliometrics: prefer enrichment, but `?? c` so a real 0 isn't dropped.
      hIndex: e.hIndex ?? c.hIndex,
      i10Index: e.i10Index ?? c.i10Index,
      totalCitations: e.totalCitations ?? c.totalCitations,
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

/**
 * Normalize a reviewer name for exclusion matching: fold diacritics to their
 * base letter, then drop honorifics + punctuation.
 *
 * Diacritic folding is via Unicode NFKD (decompose) + combining-mark strip, so
 * "Jens Hör" → "jens hor" and matches a plain-ASCII "Jens Hor" — the previous
 * `[^a-z]` strip turned "hör" into "hr" and silently MISSED that match
 * (Codex stop-time review, S210). Mirrors `DeduplicationService.normalizeName`.
 *
 * NB: this folds accented letters (ö→o, é→e) and ß→ss, but deliberately does
 * NOT fold spelled-out transliteration digraphs (ö↔oe, ü↔ue): a blanket oe→o /
 * ue→u rule would mangle unrelated names ("Manuel"→"manl", "Moerner"→"morner")
 * and over-filter good candidates. Those rare variants are handled by the
 * editable exclude box in the search UI.
 */
export function normalizeReviewerName(name) {
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
