'use strict';

/**
 * Authoritative runtime adapter for the dormant independent identity evaluator.
 *
 * Only server-produced discovery/applicant candidates may enter this adapter.
 * It reconstructs the source-work input from the server candidate and refuses
 * browser or unknown authority labels. Most current candidates legitimately
 * return `not_evaluable`: today only an exact proposal-citation work has the
 * lineage needed by independent-identity/v1.
 */

const {
  METHODS,
  evaluateIndependentReviewerIdentity,
} = require('./independent-reviewer-identity');
const { reviewerCandidateKey } = require('../utils/reviewer-candidate-key');
const {
  PROVENANCE_KINDS,
  SEED_ROLES,
  buildReviewerProvenance,
} = require('../utils/reviewer-provenance');

const AUTHORITIES = new Set(['server_discovery', 'server_applicant']);

function workId(work = {}) {
  if (work.pmid) return `pmid:${String(work.pmid).trim()}`.toLowerCase();
  if (work.doi) return `doi:${String(work.doi).trim()}`.toLowerCase();
  if (work.arxivId) return `arxiv:${String(work.arxivId).trim()}`.toLowerCase();
  if (work.openAlexId) return `openalex:${String(work.openAlexId).trim()}`.toLowerCase();
  return null;
}

function proposalCitationWork(candidate = {}) {
  const provenance = buildReviewerProvenance(candidate);
  if (provenance.kind !== PROVENANCE_KINDS.CITED_REFERENCE
    || provenance.seedRole !== SEED_ROLES.CITED_AUTHOR
    || !provenance.sources.includes('reference_list')) return null;
  const grounded = new Set(provenance.groundingWorkIds.map((value) => String(value).trim().toLowerCase()));
  return (Array.isArray(candidate.publications) ? candidate.publications : [])
    .find((work) => workId(work) && grounded.has(workId(work))) || null;
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
