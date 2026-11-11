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

/**
 * Accepted `AI Materials` names for governed proposal input. D26 flows write
 * the canonical names above; J27 flows write Connor's GOApply names (owner
 * decision 2026-10-26; Connor confirmed the `.pdf` extension). Readers accept
 * exactly one present name and fail closed when more than one is present.
 */
export function acceptedProposalNarrativeFilenames(requestNumber) {
  const normalized = normalizeRequestNumber(requestNumber);
  return normalized
    ? [expectedProposalNarrativeFilename(normalized), `Project-Narrative_${normalized}.pdf`]
    : [];
}

export function acceptedProposalBibliographyFilenames(requestNumber) {
  const normalized = normalizeRequestNumber(requestNumber);
  return normalized
    ? [expectedProposalBibliographyFilename(normalized), `Bibliography_${normalized}.pdf`]
    : [];
}

/**
 * The places the governed narrative readers accept, for the message shown when
 * none (or more than one) is present, or the one present has no usable text. Mirrors `governedInputCandidates` in
 * lib/services/workbench-proposal-documents.js: `AI Materials` under either
 * name, or `Submission-Documents` under the J27 name.
 */
export function proposalNarrativeNotFoundDetail(requestNumber) {
  const [d26Name, j27Name] = acceptedProposalNarrativeFilenames(requestNumber);
  if (!d26Name) return 'The request has no request number.';
  return `It is read from exactly one of these, and the file must contain readable text: `
    + `AI Materials/${d26Name}, AI Materials/${j27Name} or Submission-Documents/${j27Name}.`;
}
