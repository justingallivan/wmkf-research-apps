/**
 * Pure canonical filename helpers for request-bound proposal documents.
 *
 * These helpers only name destinations. They do not establish that source
 * bytes are safe to copy. The Test Request factory copies these PDFs as-is and
 * renames them to the destination number (owner decision 2026-09-23).
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
