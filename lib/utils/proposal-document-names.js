/**
 * Pure canonical filename helpers for request-bound proposal documents.
 *
 * These helpers only name destinations. They do not establish that source
 * bytes are safe to copy: generated documents can contain the source request
 * identity and require a domain-specific transformer before reuse.
 */

function normalizeRequestNumber(requestNumber) {
  const normalized = String(requestNumber ?? '').trim();
  return normalized || null;
}

export function expectedReviewerProposalFilename(requestNumber) {
  const normalized = normalizeRequestNumber(requestNumber);
  return normalized ? `Proposal_${normalized}.pdf` : null;
}

export function expectedProposalNarrativeFilename(requestNumber) {
  const normalized = normalizeRequestNumber(requestNumber);
  return normalized ? `ProposalNarrative_${normalized}.pdf` : null;
}

export function expectedProposalBibliographyFilename(requestNumber) {
  const normalized = normalizeRequestNumber(requestNumber);
  return normalized ? `ProposalBibliography_${normalized}.pdf` : null;
}
