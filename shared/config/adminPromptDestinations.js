/**
 * Read-only output destinations for Admin prompt cards. Direct Executor writes
 * come from the loaded row's outputSchema, never from this catalog. Caller
 * destinations below describe source behavior, not deployment/feature activation
 * or evidence that a particular run succeeded. Catalog edits cannot change them.
 * This lists business output, not every usage/audit row or downstream export.
 * Update alongside the cited callers when their persistence contract changes.
 */
const returned = {
  summary: 'Returned to the calling application or next analysis stage. Any later save is controlled by that workflow.',
  fields: [],
};
const reference = {
  summary: 'Stored reference. Current application routes do not execute this stored prompt; external flow destinations are not verified here.',
  fields: [],
};

export const ADMIN_PROMPT_CALLER_DESTINATIONS = Object.freeze({
  // cycle-dossier-worker.js checkpointResult: JSON in private Blob, refs in PG.
  'cycle-dossier.entry': {
    summary: 'Scientific dossier JSON in private Blob storage; the workflow later produces DOCX/PDF files and publishes them to SharePoint.',
    fields: ['cycle_dossier_runs.data'],
  },
  'cycle-dossier.research-plan': {
    summary: 'Research checkpoint JSON in private Blob storage, used by the dossier entry stage.',
    fields: ['cycle_dossier_runs.data'],
  },
  // scripts/test-echo-parity.js reads the Executor run output as its oracle.
  'executor.echo-parity': { summary: 'Diagnostic output in the Dataverse AI Run log.', fields: ['wmkf_ai_run.wmkf_ai_rawoutput'] },
  // Tool routes return results; this does not describe separate user save/export actions.
  'expense-reporter.extract-document': returned,
  'expense-reporter.extract-image': returned,
  // pages/api/expertise-finder/match.js + expertise-finder/batch-match-service.js.
  'expertise-finder.match': { summary: 'Match results in Postgres.', fields: ['expertise_matches.match_results'] },
  // field-primer/generate-service.js generateForRequest vs generateStandalone.
  'field-primer.generate': {
    summary: 'Request → AI Field Primer when generated for a grant; standalone generation returns the result without a grant-field write.',
    fields: ['akoya_request.wmkf_ai_fieldprimer'],
  },
  'funding-gap.analyze': returned,
  'funding-gap.extract': returned,
  // workbench/grantee-deliverables/generate-service.js.
  'grantee-abstract.generate': { summary: 'Request → Formatted Abstract, saved by the Awardee workflow.', fields: ['akoya_request.wmkf_abstractformatted'] },
  // cron/generate-grantee-titles-service.js processRow (fresh ETag + empty check).
  'grantee-title.generate': {
    summary: 'Request → WMKF Project Description. The scheduled job fills this field only when empty.',
    fields: ['akoya_request.wmkf_wmkfprojectdescription'],
  },
  // initial-assessment/artifact-service.js renders the response to SharePoint.
  'initial-assessment.generate': {
    summary: 'Initial Assessment DOCX in SharePoint; Request Document stores the file identity, not the narrative text in a Request field.',
    fields: ['wmkf_requestdocument.wmkf_sharepointdriveid', 'wmkf_requestdocument.wmkf_sharepointitemid'],
  },
  'literature-analyzer.compare': returned,
  'literature-analyzer.extract-paper': returned,
  'literature-analyzer.synthesize': returned,
  // meeting-tracker-transcription/fragment-review.js → alignment-service.js
  // → transcription-pilot/store.js completeAlignment.
  'meeting-transcript.fragment-review': {
    summary: 'Review warnings in the private transcription job’s speaker-alignment JSON; does not rewrite the transcript.',
    fields: ['transcription_jobs.speaker_alignment'],
  },
  // post-presentation-materials/transcript-summary-service.js and summary-draft-store.js.
  'meeting-transcript.presentation-summary': {
    summary: 'Presentation summary draft in Postgres. Staff publication creates a SharePoint TXT file and a Request Document record.',
    fields: ['meeting_transcript_summary_drafts.summary_text'],
  },
  'meeting-transcript.speaker-alignment': {
    summary: 'Speaker names and alignment evidence in the private transcription job, saved by the transcription workflow.',
    fields: ['transcription_jobs.speaker_names', 'transcription_jobs.speaker_alignment'],
  },
  // post-presentation-materials/discussion-sentiment-store.js completeRun.
  'meeting-transcript.staff-discussion-sentiment': {
    summary: 'Staff discussion analysis in Postgres.', fields: ['staff_discussion_sentiments.record'],
  },
  'meeting-transcript.staff-discussion-summary': {
    summary: 'Staff-only discussion summary draft in Postgres. Staff publication creates a SharePoint TXT file and a Request Document record.',
    fields: ['meeting_transcript_summary_drafts.summary_text'],
  },
  'multi-perspective.initial-analysis': returned,
  'multi-perspective.integrator': returned,
  'multi-perspective.neutral': returned,
  'multi-perspective.optimist': returned,
  'multi-perspective.proposal-summary': returned,
  'multi-perspective.skeptic': returned,
  'peer-review-summarizer.analyze': returned,
  'peer-review-summarizer.questions': returned,
  // Owner decision 2026-11-04; records intent, not a live Retired status.
  'phase-i.checkin': { summary: 'Deprecated. No active output destination is documented for this stored prompt.', fields: [] },
  // These Executor writebacks are read dynamically from the loaded row below.
  'phase-i.summary': { summary: 'The Executor saves the summary to the destination configured in this prompt.', fields: [] },
  'phase-ii.extract-structured': reference,
  'phase-ii.qa': reference,
  'phase-ii.refine': reference,
  'phase-ii.summarize': reference,
  // pre-site-visit/artifact-service.js → artifact-model.js proposalCorePatch.
  'pre-site-visit.proposal-core.generate': {
    summary: 'Draft writeup sections on Request Document; the workflow also creates the SharePoint DOCX.',
    fields: [
      'wmkf_requestdocument.wmkf_presiteproposalcorejson',
      'wmkf_requestdocument.wmkf_presiteexecutivesummary',
      'wmkf_requestdocument.wmkf_presiteimpactoverview',
      'wmkf_requestdocument.wmkf_presitemethodologyoverview',
      'wmkf_requestdocument.wmkf_presitepersonneloverview',
      'wmkf_requestdocument.wmkf_presitekeckfundingrationale',
      'wmkf_requestdocument.wmkf_presitebackgroundandimpact',
      'wmkf_requestdocument.wmkf_presitedetailedmethodology',
      'wmkf_requestdocument.wmkf_presitepersonneldetails',
    ],
  },
  // review-panel-worker.js → review-panel-store.js finalizeAttempt.
  'review-panel.chair': {
    summary: 'AI panel synthesis in Postgres; the workflow also creates private DOCX/PDF reports.',
    fields: ['review_panel_seat_attempts.result_json', 'review_panel_entries.data'],
  },
  'review-panel.seat': { summary: 'Each AI reviewer’s report in Postgres.', fields: ['review_panel_seat_attempts.result_json'] },
  'review-synthesis.generate': { summary: 'The Executor saves the review synthesis to the destination configured in this prompt.', fields: [] },
  // reviewer-finder/analyze.js and discover.js return SSE results. Separate save
  // actions and Workbench enrichment may persist selected results afterwards.
  'reviewer-finder.analyze': returned,
  'reviewer-finder.score-candidates': returned,
});

const FIELD_LABELS = {
  'akoya_request.wmkf_ai_summary': 'Request → AI Summary',
  'akoya_request.wmkf_reviewsynthesisjson': 'Request → Review Synthesis JSON',
};

/** Read declarations only. Unsupported/malformed targets never become claimed writes. */
export function describePromptDestinations(prompt) {
  const caller = Object.hasOwn(ADMIN_PROMPT_CALLER_DESTINATIONS, prompt.name)
    ? ADMIN_PROMPT_CALLER_DESTINATIONS[prompt.name] : null;
  let schema;
  let configurationIssue = null;
  try {
    schema = typeof prompt.outputSchema === 'string'
      ? JSON.parse(prompt.outputSchema) : prompt.outputSchema;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('missing_schema');
  } catch {
    configurationIssue = 'Output configuration is unavailable or invalid; configured writeback could not be determined.';
  }
  const configured = [];
  if (!configurationIssue && schema.outputs !== undefined && !Array.isArray(schema.outputs)) {
    configurationIssue = 'Output declarations are invalid; configured writeback could not be determined.';
  } else if (!configurationIssue) {
    for (const output of schema.outputs || []) {
      const target = output?.target;
      if (target?.kind === 'none') continue;
      if (target?.kind !== 'akoya_request' || typeof target.field !== 'string' || !/^[a-z][a-z0-9_]*$/i.test(target.field)
        || (target.jsonPath != null && (typeof target.jsonPath !== 'string' || !/^\$\.\w+$/.test(target.jsonPath)))) {
        configurationIssue = 'An output target is unsupported or incomplete; its write destination could not be determined.';
        continue;
      }
      const field = `akoya_request.${target.field}`;
      const technical = field + (target.jsonPath ? ` (${target.jsonPath})` : '');
      if (!configured.some(item => item.technical === technical)) {
        configured.push({ label: Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field] : 'Request field', technical });
      }
    }
  }
  return {
    configured, configurationIssue, caller,
    fallback: caller ? null : 'Caller-managed destination is not documented here. For Power Automate prompts, check the flow’s save steps.',
  };
}
