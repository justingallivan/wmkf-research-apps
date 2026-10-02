/**
 * Copy for the admin Test Request Factory form: the code to message map and
 * messageFor(error). Voice: the system is the subject, plain words, say what
 * did not happen, give the next action, never blame the user's access.
 * Error text is shown, never stored or logged by the browser.
 */

import { SIZE_LIMITS } from '../../config/testRequestFactory';

export const BLIP_COPY = "I'm having trouble reaching the server. This is usually a temporary blip. Please try again, and if the problem doesn't resolve, contact an administrator.";

const SIZE_COPY = `This Request's documents are too large to clone here (limit ${SIZE_LIMITS.maxFileMb} MB per file, ${SIZE_LIMITS.maxTotalMb} MB in total, ${SIZE_LIMITS.maxFiles} files). Choose a smaller source Request. Nothing was created.`;
const OWNER_REPLAY = "An earlier change to this status created, or may have created, a payment or status-tracking row. Repeating it needs the owner; it can't be done from this form.";
const FOUNDATION_COPY = "I couldn't confirm the Foundation's setup needed to clone this Request. This is usually a temporary blip. Please try again, and if the problem doesn't resolve, contact an administrator. Nothing was created.";
const CONTACT = 'Contact an administrator.';

// A string is the copy. A function receives the server's message (possibly empty) and returns the copy.
export const ERROR_COPY = Object.freeze({
  factory_form_disabled: 'Creating test Requests is switched off on this deployment, so nothing was changed.',
  factory_profile_required: "I couldn't tell which staff profile this is, so nothing was started. Sign in again and try again.",
  factory_actor_email_required: "Your staff email wasn't available to name the program director, so nothing was created. Sign in again and try again.",
  factory_isolation_off: `Test Request isolation isn't switched on for this deployment, so nothing was started. ${CONTACT}`,
  factory_ledger_unconfigured: `The run ledger isn't set up for this deployment, so nothing was started. ${CONTACT}`,
  factory_invalid_input: (message) => message || "Something in that request wasn't valid, so nothing was started. Check the details and try again.",
  factory_source_not_found: 'No Request has that number. Check the number and try again.',
  factory_source_ambiguous: `More than one Request has that number, so nothing was created. ${CONTACT}`,
  factory_source_mismatch: "The number you typed doesn't match the source Request, so nothing was reserved. Type the number shown above.",
  factory_source_not_grant: "That source isn't a Grant Request, so nothing was created. Choose a different source Request.",
  factory_draft_missing: 'The saved copy of the source is gone, so nothing was reserved. Look up the source Request again.',
  factory_draft_stale: 'The saved copy of the source is too old to use safely, so nothing was reserved. Look up the source Request again.',
  factory_target_mismatch: `This run's plan doesn't match this deployment, so nothing was advanced. ${CONTACT}`,
  factory_manifest_unsupported: `This run's plan isn't one this form can advance, so nothing was advanced. ${CONTACT}`,
  factory_run_not_found: "That run wasn't found, so nothing was changed. It may have been removed. Reload the list.",
  factory_run_not_production: "Only a production run can do that, so nothing was changed.",
  factory_run_not_ready: "That Request isn't ready yet, so its status wasn't changed. Finish creating it first.",
  factory_recovery_required: "This run's saved files are missing, so it can't continue from here. Don't look up the source again. Ask the owner to recover it from the command line.",
  factory_artifacts_missing: "The saved files for this run are missing, so nothing was downloaded.",
  factory_artifact_digest_mismatch: `This run's saved files don't match their record, so nothing was advanced. ${CONTACT}`,
  factory_artifact_exists: "The files for this run were already saved, but the run wasn't reserved, so this draft can't be confirmed again. Look up the source Request again. Nothing was created.",
  test_request_foundation_unavailable: FOUNDATION_COPY,
  test_request_grant_type_unavailable: FOUNDATION_COPY,
  factory_artifact_too_large: "This Request's saved files would be too large to store, so nothing was reserved. Choose a smaller source Request.",
  factory_artifact_invalid_id: `That reference wasn't valid, so nothing was changed. Look up the source Request again.`,
  factory_artifact_invalid_target: `The file store doesn't match this deployment, so nothing was changed. ${CONTACT}`,
  factory_store_unconfigured: `The file store isn't set up for this deployment, so nothing was started. ${CONTACT}`,
  factory_deadline_exceeded: "There wasn't enough time left to start that safely, so nothing was started. Try again.",
  test_request_run_conflict: 'Another process changed this run at the same time, so nothing was changed. Reload the run and try again.',
  test_request_run_fenced: 'Another process is working on this run, so nothing was changed. Try again in a few minutes.',
  test_request_run_destination_conflict: `The test Request for this run is already recorded differently, so nothing was changed. ${CONTACT}`,
  test_request_run_not_found: "That run wasn't found, so nothing was changed. Reload the list.",
  test_request_preview_sandbox_required: `The source lookup isn't pointed at the expected data, so nothing was created. ${CONTACT}`,
  test_request_preview_sharepoint_target_required: `The document store isn't the expected one, so nothing was created. ${CONTACT}`,
  test_request_preview_file_count_exceeded: SIZE_COPY,
  test_request_preview_file_too_large: SIZE_COPY,
  test_request_preview_total_size_exceeded: SIZE_COPY,
  test_request_preview_file_metadata_unavailable: "I couldn't confirm the size of one of this Request's documents, so nothing was created. Try again, and if it persists, choose another source Request.",
  test_request_preview_file_type_unsupported: "One of this Request's documents isn't a type that can be cloned here, so nothing was created. Choose another source Request.",
  test_request_preview_source_changed: 'The source Request changed while its documents were being read, so nothing was created. Look up the source Request again.',
  status_change_replay: OWNER_REPLAY,
  status_change_noop: 'The Request already has that status, so nothing was sent.',
  status_change_open: 'Another status change on this run is still open, so nothing new was sent. The journal has been reloaded; check that change first.',
  status_change_concurrent: 'Another caller moved this change on, so nothing new was sent. The journal has been reloaded.',
  status_change_conflict: 'The Request changed after it was read, so nothing was written. Reload the status and try again.',
  status_change_resume: "The Request's current value doesn't match this change, so it wasn't sent again. Ask the owner to inspect it.",
  status_change_effects: 'The change was written, but its emails, payments or jobs need a look. Check the journal and ask the owner to inspect it.',
  status_change_edge: "That change isn't allowed from the Request's current status, so nothing was sent.",
  status_change_refused: (message) => message || "That status change wasn't allowed, so nothing was sent.",
  status_change_in_progress: "This change is being sent, or was sent and its result isn't known yet. Don't retry it.",
  status_change_jobs_open: 'The change was written. Background jobs on the Request are still finishing; check again.',
  status_change_ambiguous: "The change was sent but its result couldn't be read. Check again; don't start a different change.",
});

const ATTENTION_DEFAULT = 'This step stopped and needs a look before it is retried. Retrying is safe: the run picks up where it stopped and never creates a second Request.';
const ATTENTION_OWNER = "This step's result could not be confirmed, so the form can't tell whether retrying is safe. Ask the owner before retrying.";
// Keyed by the run's stored needs-attention reason (a LEDGER_REASON_CODES token). Anything unlisted gets the default.
export const ATTENTION_COPY = Object.freeze({
  ambiguous_create_outcome: "The request to create the test Request was sent, but its result could not be confirmed. Don't retry; ask the owner to resolve it, because retrying could create a second Request.",
  preallocated_request_present_not_owned: "A Request with this run's reserved identity already exists but this run did not create it. Don't retry; ask the owner.",
  location_preexisting: "A document folder record for this Request already exists and this run did not create it. Don't retry; ask the owner.",
  source_fence_failed: 'The source Request no longer matched what was read, so the run stopped at its first check. Look up the source Request again and start a new run.',
  timeout: 'A service took too long to answer during this step. Retrying is safe: the run picks up where it stopped.',
  network: 'The connection dropped during this step. Retrying is safe: the run picks up where it stopped.',
  file_ambiguous_unrecovered: ATTENTION_OWNER,
  file_journal_unverified: ATTENTION_OWNER,
  goverify_deactivation_uncertain: ATTENTION_OWNER,
  goverify_restore_unverified: ATTENTION_OWNER,
  goverify_restore_failed: ATTENTION_OWNER,
});

/** Plain copy for a needs-attention run, from its stored reason (an optional " (http 503)" suffix is ignored). */
export function attentionCopyFor(reason) {
  const token = typeof reason === 'string' ? reason.split(' ')[0] : '';
  return ATTENTION_COPY[token] || ATTENTION_DEFAULT;
}

/** The code on an ApiRequestError payload (or a plain `code`), else null. */
export function codeOf(error) {
  const code = error?.payload?.code ?? error?.code;
  return typeof code === 'string' && code ? code : null;
}

/**
 * The text to show for a failed request. An abort returns '' (an abort is not
 * an error and shows nothing). A known code maps to its copy; an unknown code
 * with a server message shows that message; anything without a code (the
 * generic 500, a platform timeout, a network failure) is the blip copy. A raw
 * code is never the only text.
 */
export function messageFor(error) {
  if (error?.name === 'AbortError') return '';
  const code = codeOf(error);
  if (!code) return BLIP_COPY;
  const serverMessage = typeof error.payload?.error === 'string' ? error.payload.error : (typeof error.message === 'string' ? error.message : '');
  const entry = ERROR_COPY[code];
  if (typeof entry === 'function') return entry(serverMessage);
  if (entry) return entry;
  return serverMessage || BLIP_COPY;
}
