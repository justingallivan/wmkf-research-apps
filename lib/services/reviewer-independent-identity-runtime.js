'use strict';

/**
 * Authoritative runtime adapter for the dormant independent identity evaluator.
 *
 * Only server-produced discovery/applicant candidates may enter this adapter.
 * It refuses browser or unknown authority labels. No current producer creates
 * an unforgeable server-only proposal-citation marker, so source work remains
 * null and current candidates legitimately return `not_evaluable`.
 */

const {
  METHODS,
  evaluateIndependentReviewerIdentity,
} = require('./independent-reviewer-identity');
const { reviewerCandidateKey } = require('../utils/reviewer-candidate-key');
const AUTHORITIES = new Set(['server_discovery', 'server_applicant']);

function proposalCitationWork() {
  // Discovery begins with browser-carried Stage 1 suggestions, and no current
  // server producer emits an unforgeable proposal-citation marker. Candidate
  // provenance therefore cannot authorize source-work lineage even when its
  // fields look internally consistent. Keep this null until a server-only
  // marker is produced after the request boundary and bound into the receipt.
  return null;
}

async function evaluateServerCandidateIndependentIdentity({
  requestId,
  candidate,
  authority,
  signal,
  providers,
  now,
} = {}) {
  const candidateKey = reviewerCandidateKey(candidate);
  if (!AUTHORITIES.has(authority) || !requestId || !candidateKey) return null;
  const sourceWork = proposalCitationWork(candidate);
  const method = sourceWork
    ? METHODS.PUBMED_MULTI_WORK_AUTHOR
    : METHODS.EXACT_WORK_UNIQUE_AUTHOR;
  return evaluateIndependentReviewerIdentity({
    requestBinding: requestId,
    candidateKey,
    method,
  }, {
    signal,
    providers,
    now,
    loadServerInputs: async ({ requestBinding, candidateKey: loadedCandidateKey }) => ({
      requestBinding,
      candidateKey: loadedCandidateKey,
      allowedMethods: [method],
      candidateName: candidate.name,
      sourceWork,
      sourceWorkLineage: sourceWork ? 'proposal_citation' : null,
      sourceOrcid: null,
      sourceOrcidLineage: null,
      crmOrcid: null,
      crmOrcidLineage: null,
      staffIdentityConfirmed: candidate.pdIdentityConfirmed === true,
      providerState: 'complete',
      providerObservedAt: new Date(typeof now === 'function' ? now() : Date.now()).toISOString(),
    }),
  });
}

module.exports = {
  AUTHORITIES,
  evaluateServerCandidateIndependentIdentity,
  proposalCitationWork,
};
