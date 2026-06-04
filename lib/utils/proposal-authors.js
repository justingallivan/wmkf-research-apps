/**
 * Shared derivation of the proposal-author exclusion/COI set.
 *
 * The reviewer-finder pipeline must never propose a proposal author as a
 * reviewer, and must flag candidates who have co-authored with them. "Proposal
 * authors" = the PI (`proposalAuthors`, normalized from `principalInvestigator`)
 * PLUS the co-investigators (`coInvestigators`, extracted as the CO_INVESTIGATORS
 * cover-page field — defaults to "None" when absent).
 *
 * Two call sites derive this set and they MUST agree, or a reviewer who
 * co-authored with a co-PI reads as "clean" in one path and "conflicted" in the
 * other (the S213 discover.js ⇄ enrich-recommended.js drift this consolidates):
 *   - pages/api/reviewer-finder/discover.js   (standalone Find)
 *   - pages/api/workbench/enrich-recommended.js (Workbench recommended-reviewer)
 *
 * The NOT_SET filter drops the sentinel placeholders both fields can carry
 * ("Not specified" for the PI, "None" for co-PIs) so they never leak in as a
 * literal author name.
 */

const NOT_SET = (s) => !s || /^(not specified|not set|n\/a|none)$/i.test(String(s).trim());

/**
 * @param {object} [proposalInfo] - analyzeProposal() proposalInfo
 * @returns {string[]} de-duplicated author names (PI + co-investigators), [] if none
 */
export function deriveProposalAuthorNames(proposalInfo = {}) {
  const blob = [proposalInfo?.proposalAuthors, proposalInfo?.coInvestigators]
    .filter((s) => !NOT_SET(s))
    .join(', ');
  if (!blob) return [];
  const seen = new Set();
  const names = [];
  for (const raw of blob.split(',')) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
