/**
 * Ownership: helper wrapper module: existing reviewer-search-logic/sharedutils retain
 * canonical key/provenance policy; this module delegates to them for consumers.
 */
import { dedupeReviewerCandidates, reviewerCandidateKey } from '../reviewer-search-logic';
import { PROVENANCE_KINDS, provenanceKindOf } from '../../../../lib/utils/reviewer-provenance';

export function candKey(c) {
  return reviewerCandidateKey(c);
}

export function dedupeByName(list) {
  return dedupeReviewerCandidates(list);
}

export function isApplicantOriginCandidate(c) {
  return !!c && (c.isApplicantRecommended || provenanceKindOf(c) === PROVENANCE_KINDS.APPLICANT_SUGGESTED);
}
