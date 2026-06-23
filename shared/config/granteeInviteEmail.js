/**
 * Placeholder fill logic for the grantee-deliverables invitation email (the
 * Workbench Awardee tab). Default copy lives in the admin-editable settings
 * store, seeded from lib/seed/email-defaults/grantee-invite.js; runtime code
 * imports only the logic in this file.
 *
 * BODY-ONLY invariant: the body must NOT contain a signature or a closing
 * sign-off. The send/preview routes append the assigned-PD signature server-side
 * (`resolveSignatureForRequest` + `appendSignatureBlock`). Default body copy
 * should end before any sign-off so the server-appended signature is the sole closing.
 * See docs/GRANTEE_INVITE_BODY_CUSTOM_PLAN.md and the
 * project-grantee-deliverable-email-voice memory.
 */

export function formatCobDate(base = new Date()) {
  const d = new Date(base);
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function surnameFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Fill the per-grantee placeholders into ANY base template (the shared default OR
 * a PD's saved custom body). EVERY occurrence of each token is replaced (replaceAll),
 * so a custom body that repeats a placeholder fills all of them; a deleted token
 * simply leaves a gap rather than throwing.
 */
export function fillInviteBody(baseTemplate, { piName, title, baseDate } = {}) {
  return String(baseTemplate || '')
    .replaceAll('[Name]', surnameFromName(piName) || '[Name]')
    .replaceAll('[title]', title || '[title]')
    .replaceAll('COB [date]', `COB ${formatCobDate(baseDate)}`);
}
