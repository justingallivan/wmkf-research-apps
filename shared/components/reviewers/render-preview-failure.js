/**
 * Shared wording for a failed /api/review-manager/render-emails preview call
 * (InviteEmailModal and ReviewerManagePanel both render previews through it).
 *
 * Previews always render BEFORE anything sends, so every failure here is safe
 * to retry. The message must say so explicitly: the raw server errors this
 * banner used to echo ("Unable to verify application access; please retry")
 * read as if the invitation itself failed, and the bare fallback ("Failed to
 * render previews") gave the PD neither a cause nor a next step (owner report,
 * 2026-08-06).
 */

export const RENDER_PREVIEW_NETWORK_MESSAGE =
  'Could not reach the server to build the email previews. No emails have been sent — check your connection and retry.';

export function renderPreviewFailureMessage({ status, serverMessage } = {}) {
  const base = serverMessage
    || `The server could not build the email previews${status ? ` (error ${status})` : ''}.`;
  return `${base} No emails have been sent — retrying is safe.`;
}
