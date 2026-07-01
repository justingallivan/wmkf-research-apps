/**
 * Placeholder fill logic for the grantee-deliverables invitation email (the
 * Workbench Awardee tab). Default copy lives in the admin-editable settings
 * store, seeded from lib/seed/email-defaults/grantee-invite.js; runtime code
 * imports only the logic in this file.
 *
 * BODY-ONLY invariant: the body must NOT contain the SIGNATURE block (PD name /
 * title / Foundation line) — the send/preview routes append the assigned-PD
 * signature server-side (`resolveSignatureForRequest` + `appendSignatureBlock`),
 * so a signature in the body would duplicate it. The body MAY end with a closing
 * salutation lead-in (e.g. "Thank you,"); the appended signature follows it.
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
  const granteeName = surnameFromName(piName);
  return String(baseTemplate || '')
    .replaceAll('{{granteeName}}', granteeName || '{{granteeName}}')
    .replaceAll('[Name]', granteeName || '[Name]')
    .replaceAll('{{proposalTitle}}', title || '{{proposalTitle}}')
    .replaceAll('[title]', title || '[title]')
    .replaceAll('COB {{dueDate}}', `COB ${formatCobDate(baseDate)}`)
    .replaceAll('COB [date]', `COB ${formatCobDate(baseDate)}`);
}

export function fillInviteSubject(baseTemplate, { title } = {}) {
  return String(baseTemplate || '')
    .replaceAll('{{proposalTitle}}', title || '{{proposalTitle}}')
    .replaceAll('[title]', title || '[title]');
}
