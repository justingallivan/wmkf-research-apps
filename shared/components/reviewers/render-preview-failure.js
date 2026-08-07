/**
 * Shared wording for a failed /api/review-manager/render-emails preview call
 * (InviteEmailModal and ReviewerManagePanel both render previews through it).
 *
 * A FAILED preview request has sent no email and may always be retried — the
 * message must say so explicitly: the raw server errors this banner used to
 * echo ("Unable to verify application access; please retry") read as if the
 * invitation itself failed, and the bare fallback ("Failed to render
 * previews") gave the PD neither a cause nor a next step (owner report,
 * 2026-08-06).
 *
 * A SUCCESSFUL render is a different story when the template contains
 * `{{externalLink}}`: it mints a fresh reviewer JWT and overwrites the
 * recipient's durable token hash, so an older still-open preview can end up
 * carrying a dead link. Retrying a failed render is always safe; two
 * concurrent successful renders for the same recipient are not equivalent —
 * only the latest one's link stays valid. Both modals therefore serialize
 * render calls (single-flight, one fetch in flight per modal at a time), and
 * `send-emails-service.js` independently verifies the final edited draft's
 * embedded token immediately before dispatch, rejecting a recipient whose
 * link was superseded by a later render rather than trusting client state.
 */

export const RENDER_PREVIEW_NETWORK_MESSAGE =
  'Could not reach the server to build the email previews. No emails have been sent — check your connection and retry.';

export function renderPreviewFailureMessage({ status, serverMessage } = {}) {
  const base = serverMessage
    || `The server could not build the email previews${status ? ` (error ${status})` : ''}.`;
  return `${base} No emails have been sent — retrying is safe.`;
}
