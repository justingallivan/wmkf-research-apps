/**
 * Browser-safe constants for the admin Test Request Factory form
 * (shared/components/admin/TestRequestFactorySection.js and friends).
 *
 * Plain data only: no server import. The step keys are the Basic recipe's
 * STEP_ORDER from lib/services/test-requests/run-runner.js and the size limits
 * are TEST_REQUEST_PREVIEW_READ_LIMITS from admin-preview-service.js; a node
 * test (tests/unit/test-request-factory-config.test.js) pins both, because a
 * component must never import those server modules.
 */

export const BASIC_STEPS = Object.freeze([
  { key: 'fence_source', label: 'Check the source Request' },
  { key: 'create_request', label: 'Create the test Request' },
  { key: 'correct_meeting_date', label: 'Set the meeting date' },
  { key: 'provision_location', label: 'Create the document folder' },
  { key: 'copy_file', label: 'Copy the documents (one per step)' },
  { key: 'observe', label: 'Wait for background jobs (about a minute)' },
  { key: 'verify', label: 'Verify the new Request' },
].map(Object.freeze));

/** Run statuses (migration 054) with the words and chip tone the form shows. */
export const RUN_STATUSES = Object.freeze({
  prepared: Object.freeze({ label: 'Reserved, not started', tone: 'gray' }),
  creating: Object.freeze({ label: 'In progress', tone: 'blue' }),
  ready: Object.freeze({ label: 'Ready', tone: 'green' }),
  needs_attention: Object.freeze({ label: 'Needs attention', tone: 'amber' }),
  retiring: Object.freeze({ label: 'Retiring', tone: 'gray' }),
  retired: Object.freeze({ label: 'Retired', tone: 'gray' }),
});

/** The statuses the service resumes (admin-run-service.js RESUMABLE), with the button label for each. */
export const ADVANCE_LABELS = Object.freeze({
  prepared: 'Start',
  creating: 'Resume',
  needs_attention: 'Resume',
});

/** The size limits the clone enforces, in the units the copy uses. */
export const SIZE_LIMITS = Object.freeze({ maxFiles: 7, maxFileMb: 25, maxTotalMb: 50 });

export const STATUS_FIELDS = Object.freeze([
  Object.freeze({ key: 'phase1', column: 'wmkf_phaseistatus', label: 'Phase I status' }),
  Object.freeze({ key: 'phase2', column: 'wmkf_phaseiistatus', label: 'Phase II status' }),
]);

/** Journal statuses of a status change that is still open (the server refuses a different change meanwhile). */
export const OPEN_CHANGE_STATUSES = Object.freeze(['planned', 'dispatched', 'applied']);

export const CHANGE_STATUSES = Object.freeze({
  planned: Object.freeze({ label: 'Planned, not sent', tone: 'amber' }),
  dispatched: Object.freeze({ label: 'Sent, result not yet known', tone: 'amber' }),
  applied: Object.freeze({ label: 'Written, jobs still running', tone: 'amber' }),
  complete: Object.freeze({ label: 'Complete', tone: 'green' }),
  needs_attention: Object.freeze({ label: 'Needs attention', tone: 'amber' }),
});

/** Cycle fields are short strings on the server (32 characters). */
export const LIMITS = Object.freeze({ labelMax: 120, cycleFieldMax: 32, requestNumberMax: 10 });

/** Human labels for the document kinds in a source summary. Unknown kind: the raw kind. */
export const DOCUMENT_KIND_LABELS = Object.freeze({
  projectDescription: 'Project Description',
  biosketches: 'Biosketches',
  projectBudget: 'Project Budget',
  projectBudgetSpreadsheet: 'Project Budget spreadsheet',
  reviewerProposal: 'Reviewer proposal',
  proposalNarrative: 'Proposal narrative',
  proposalBibliography: 'Proposal bibliography',
});

/** The resource kinds and outcomes the run ledger can journal (run-ledger.js LEDGER_RESOURCE_KINDS / RESOURCE_OUTCOMES), in words. */
export const RESOURCE_KIND_LABELS = Object.freeze({
  dataverse_request: 'Test Request',
  dataverse_request_patch: 'Request field update',
  sharepoint_folder: 'Document folder',
  dataverse_document_location: 'Document folder record',
  sharepoint_file: 'Copied document',
  workflow_bypass: 'Workflow bypass marker',
  dataverse_request_document: 'Document record',
  foundation_baseline: 'Foundation record baseline',
  foundation_transition: 'Foundation record check',
});

export const RESOURCE_OUTCOME_LABELS = Object.freeze({
  planned: 'Planned',
  dispatched: 'Sent',
  verified: 'Verified',
  recovered: 'Recovered',
  conflict: 'Conflict',
  rejected: 'Rejected',
  ambiguous: 'Result not confirmed',
  failed: 'Failed',
});

/** Underscores to spaces, sentence case: the fallback for a code this config does not know. */
export function humanize(code) {
  const text = String(code ?? '').replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

export const labelFor = (map, code) => map[code] || humanize(code);
