/**
 * Per-cycle Phase I document map for the Workbench Proposal tab.
 *
 * D26 documents live in the request's SharePoint `Phase I` subfolder with
 * consistent filenames (Justin, S258). This is an INTERIM bridge for displaying
 * the historical D26 Phase I source set; automated proposal analysis now uses
 * the separate canonical `Reviewer Materials/Proposal_{Request#}.pdf` contract.
 * The converging target is direct Dataverse-table references, so these display
 * rules live here, keyed by cycle, NOT hard-coded in the route or UI. See
 * docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md and
 * .claude-memory/project-j27-doc-capture-evolution.md.
 *
 * `Application Cover Page.docx` is intentionally excluded — it's redundant with
 * the Dataverse-derived top section of the Proposal tab.
 */

const DEFAULT_CONFIG = {
  phaseFolder: 'Phase I',
  excludeFilenames: ['Application Cover Page.docx'],
  slots: [
    { key: 'projectDescription', label: 'Project Description', filename: 'ProjectDescription.pdf' },
    { key: 'biosketches', label: 'Biosketches', filename: 'Biosketches.pdf' },
    { key: 'projectBudget', label: 'Project Budget', filename: 'ProjectBudget.pdf' },
    { key: 'projectBudgetSpreadsheet', label: 'Project Budget spreadsheet', filename: 'Project Budget spreadsheet.xlsx' },
  ],
};

// Cycle-specific overrides go here (e.g. when J27 naming is known). Falls back
// to DEFAULT_CONFIG (the D26 convention) for any unmapped cycle.
export const PROPOSAL_DOCUMENT_CONFIG_BY_CYCLE = {
  // D26 uses the default; an explicit entry documents that it's intentional.
  D26: DEFAULT_CONFIG,
};

export function getProposalDocumentConfig(cycleCode) {
  return PROPOSAL_DOCUMENT_CONFIG_BY_CYCLE[cycleCode] || DEFAULT_CONFIG;
}
