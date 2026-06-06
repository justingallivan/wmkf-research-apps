/**
 * Pure helpers for the in-panel reviewer search (Workbench Find).
 * Kept separate from the React component so they can be unit-tested.
 */

// Name normalization + exact-exclusion live in the CJS util so the server
// (/discover dedup, reviewer-roster-store) and this client module share ONE
// implementation. Re-exported below so existing client imports keep working.
import { normalizeReviewerName as _normalizeReviewerName, partitionByExcluded } from '../../../lib/utils/reviewer-name-match';
import { mayPersistIdentity } from '../../../lib/services/reviewer-identity-resolver';

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
      // Current-affiliation pin (S224 #16): enrichment may have replaced the
      // discovery affiliation with an identity-trusted ORCID/Scholar current
      // one. Promote it + its provenance so the card shows "per ORCID" and the
      // client re-rank scores the same affiliation the server persisted.
      affiliation: e.affiliation || c.affiliation,
      affiliationSource: e.affiliationSource || c.affiliationSource,
      // Recency rank input: enrichment carries the discovery value through so the
      // client re-rank matches the server (`?? c` so a real 0 isn't dropped).
      publicationCount5yr: e.publicationCount5yr ?? c.publicationCount5yr,
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
 * Normalize a reviewer name for exclusion / dedup matching. Re-exported from the
 * shared CJS util (`lib/utils/reviewer-name-match`) so the client, the
 * `/discover` server dedup, and the roster store all use ONE implementation.
 */
export const normalizeReviewerName = _normalizeReviewerName;

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
  return partitionByExcluded(candidates, excludedNames, (c) => c && c.name);
}

/**
 * Prune an enriched candidate down to the fields `CandidateCard` actually
 * renders, for durable storage in `reviewer_find_roster` (S224). Keeps the card
 * fully renderable after reload while dropping the heavy raw enrichment internals
 * (tierResults, identity-resolver anchors). The SINGLE source for the roster DTO
 * shape so the server store + client merge agree.
 */
export function pruneCandidateForRoster(c) {
  if (!c || typeof c !== 'object') return c;
  const e = c.contactEnrichment || {};
  // Capture the identity-resolver verdict NOW (before it's dropped) as safe
  // boolean persist-permission flags, so a candidate saved AFTER a roster reload
  // (when contactEnrichment.identity / tierResults are gone) still honors the
  // resolver gate (Codex post-impl HIGH). Mirror save-candidates' block logic:
  //   blockByIdentity = identity present AND verdict < probable
  //   blockScholar    = blockByIdentity OR the Scholar profile was name/inst-skipped
  const identity = e.identity || null;
  const scholarSkipped = !!e.tierResults?.scholar_profile?.skipped;
  const identityPersistAllowed = !identity || mayPersistIdentity(identity.status);
  const scholarPersistAllowed = identityPersistAllowed && !scholarSkipped;
  return {
    // Render-safe persist flags consumed by save-candidates for roster-reloaded rows.
    identityPersistAllowed,
    scholarPersistAllowed,
    // A render-safe contactEnrichment SUBSET so CandidateCard's `enr.*` reads
    // (emailSource/emailYear/priorAffiliation/affiliationSource/links/metrics)
    // still work after reload. NEVER the raw internals (identity/tierResults).
    contactEnrichment: {
      email: e.email || null,
      emailSource: e.emailSource || null,
      emailYear: e.emailYear || null,
      website: e.website || null,
      orcid: e.orcid || e.orcidId || null,
      orcidId: e.orcidId || null,
      orcidUrl: e.orcidUrl || null,
      googleScholarUrl: e.googleScholarUrl || null,
      googleScholarId: e.googleScholarId || null,
      affiliationSource: e.affiliationSource || null,
      priorAffiliation: e.priorAffiliation || null,
      hIndex: e.hIndex ?? null,
      totalCitations: e.totalCitations ?? null,
    },
    name: c.name,
    affiliation: c.affiliation || null,
    affiliationSource: c.affiliationSource || e.affiliationSource || null,
    seniorityEstimate: c.seniorityEstimate || null,
    verificationConfidence: typeof c.verificationConfidence === 'number' ? c.verificationConfidence : null,
    // Source / provenance flags the card branches on.
    isClaudeSuggestion: !!c.isClaudeSuggestion,
    source: c.source || null,
    isApplicantRecommended: !!c.isApplicantRecommended,
    // COI + mismatch detail.
    hasInstitutionCOI: !!c.hasInstitutionCOI,
    institutionCOIDetails: c.institutionCOIDetails || null,
    hasCoauthorCOI: !!c.hasCoauthorCOI,
    coauthorships: Array.isArray(c.coauthorships) ? c.coauthorships : [],
    institutionMismatch: !!c.institutionMismatch,
    suggestedInstitution: c.suggestedInstitution || null,
    expertiseMismatch: !!c.expertiseMismatch,
    expertiseAreas: Array.isArray(c.expertiseAreas) ? c.expertiseAreas : null,
    keywords: Array.isArray(c.keywords) ? c.keywords : null,
    reasoning: c.reasoning || c.generatedReasoning || null,
    // Contact + bibliometrics (prefer the merged top-level, fall back to enrichment).
    email: c.email || e.email || null,
    emailSource: e.emailSource || null,
    emailYear: e.emailYear || null,
    website: c.website || e.website || null,
    orcid: c.orcid || e.orcid || e.orcidId || null,
    orcidUrl: c.orcidUrl || e.orcidUrl || null,
    googleScholarUrl: c.googleScholarUrl || e.googleScholarUrl || null,
    googleScholarId: c.googleScholarId || e.googleScholarId || null,
    priorAffiliation: e.priorAffiliation || null,
    hIndex: c.hIndex ?? e.hIndex ?? null,
    totalCitations: c.totalCitations ?? e.totalCitations ?? null,
    publicationCount5yr: Number.isFinite(c.publicationCount5yr) ? c.publicationCount5yr : (e.publicationCount5yr ?? null),
    publications: Array.isArray(c.publications)
      ? c.publications.slice(0, 10).map((p) => ({ title: p && p.title, year: p && p.year, url: p && p.url }))
      : [],
    relevanceScore: typeof c.relevanceScore === 'number' ? c.relevanceScore : null,
  };
}
