/**
 * Stable correlation key for one surfaced reviewer row.
 *
 * This is not an identity-resolution decision. It prevents two same-name
 * candidates from sharing client state or one durable roster row while
 * preferring real person anchors when discovery already has them.
 */

const { reviewerSaveKey } = require('./reviewer-save-key');

function reviewerCandidateKey(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const existing = typeof candidate.candidateKey === 'string'
    ? candidate.candidateKey.trim()
    : '';
  if (existing) return existing;

  const enrichment = candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object'
    ? candidate.contactEnrichment
    : {};
  const anchors = [
    ['suggestion', candidate.suggestionId],
    ['person', candidate.potentialReviewerId || candidate.seedResolvedPotentialReviewerId],
    ['orcid', candidate.orcid || enrichment.orcidId || enrichment.orcid],
    ['openalex', candidate.openAlexId || candidate.openAlexAuthorId],
    ['scholar', candidate.googleScholarId || enrichment.googleScholarId],
    ['seed', candidate.seedIdentityMatchKey],
  ];
  for (const [kind, raw] of anchors) {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (value) return `${kind}:${encodeURIComponent(value)}`;
  }
  return reviewerSaveKey(candidate);
}

function withReviewerCandidateKey(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  return candidate.candidateKey
    ? candidate
    : { ...candidate, candidateKey: reviewerCandidateKey(candidate) };
}

module.exports = { reviewerCandidateKey, withReviewerCandidateKey };
