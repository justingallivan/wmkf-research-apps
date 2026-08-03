/**
 * Stable correlation key for one surfaced reviewer row.
 *
 * This is not an identity-resolution decision. It prevents two same-name
 * candidates from sharing client state or one durable roster row while
 * preferring real person anchors when discovery already has them.
 */

const { reviewerSaveKey } = require('./reviewer-save-key');

const AUTHORITATIVE_CANDIDATE_KEY_RE = /^(?:suggestion|person|orcid|openalex|scholar|seed):[^\s:]{1,512}$/i;
// Historical search results were persisted with reviewerSaveKey() before the
// evidence pipeline introduced person-anchored keys. Accept only that exact,
// server-generated composite shape when revalidating an existing roster row.
// Cold-search authority contracts deliberately do not use this compatibility.
const STORED_FALLBACK_CANDIDATE_KEY_RE = /^candidate:[^|\s:]+\|email:[^|\s]+\|orcid:[^|\s]+\|affiliation:[^|\s]+$/i;

function reviewerSuggestionCandidateKey(suggestionId) {
  const value = typeof suggestionId === 'string' ? suggestionId.trim().toLowerCase() : '';
  return value ? `suggestion:${encodeURIComponent(value)}` : null;
}

function canonicalStoredReviewerCandidateKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 560) return null;
  return AUTHORITATIVE_CANDIDATE_KEY_RE.test(key) || STORED_FALLBACK_CANDIDATE_KEY_RE.test(key)
    ? key
    : null;
}

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
    if (value) {
      return kind === 'suggestion'
        ? reviewerSuggestionCandidateKey(value)
        : `${kind}:${encodeURIComponent(value)}`;
    }
  }
  return reviewerSaveKey(candidate);
}

function withReviewerCandidateKey(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  return candidate.candidateKey
    ? candidate
    : { ...candidate, candidateKey: reviewerCandidateKey(candidate) };
}

module.exports = {
  canonicalStoredReviewerCandidateKey,
  reviewerCandidateKey,
  reviewerSuggestionCandidateKey,
  withReviewerCandidateKey,
};
