/**
 * Proposal-tab document layout by cycle: the D26 Phase I slot map, and the
 * individual-files layout for single-submission cycles (J27 onward).
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

import { parseCycleCode } from '../../lib/utils/cycle-code.js';

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

// Single-submission cycles (J27 onward) have no `Phase I` folder: GOApply
// originals sit in `Submission-Documents` and the flows write
// `{Type}_{Request#}` files to `AI Materials` (Connor, 2026-10-26). The
// Proposal tab lists those individual files instead of labeled slots. The
// rule is "this cycle or any later one", so a new cycle needs no entry here.
export const SINGLE_SUBMISSION_LAYOUT = 'single-submission';
const FIRST_SINGLE_SUBMISSION_CYCLE = 'J27';
const SINGLE_SUBMISSION_CONFIG = {
  layout: SINGLE_SUBMISSION_LAYOUT,
  phaseFolder: null,
  excludeFilenames: [],
  slots: [],
};

function cycleOrder(cycleCode) {
  const parsed = parseCycleCode(cycleCode);
  return parsed ? parsed.year * 12 + parsed.month : null;
}

// Explicit per-cycle entries win. Cycles before J27, and requests with no
// readable cycle, keep DEFAULT_CONFIG (the D26 convention).
export const PROPOSAL_DOCUMENT_CONFIG_BY_CYCLE = {
  // D26 uses the default; an explicit entry documents that it's intentional.
  D26: DEFAULT_CONFIG,
};

export function getProposalDocumentConfig(cycleCode) {
  const explicit = PROPOSAL_DOCUMENT_CONFIG_BY_CYCLE[cycleCode];
  if (explicit) return explicit;
  const order = cycleOrder(cycleCode);
  return order !== null && order >= cycleOrder(FIRST_SINGLE_SUBMISSION_CYCLE)
    ? SINGLE_SUBMISSION_CONFIG
    : DEFAULT_CONFIG;
}
