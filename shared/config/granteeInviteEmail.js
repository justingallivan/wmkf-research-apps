/**
 * Shared default copy + placeholder fill for the grantee-deliverables invitation
 * email (the Workbench Awardee tab). Single source of truth so both the Awardee
 * tab and Profile Settings (per-PD custom body editor, S272) import the same
 * default and the same fill logic.
 *
 * BODY-ONLY invariant: the body must NOT contain a signature or a closing
 * sign-off. The send/preview routes append the assigned-PD signature server-side
 * (`resolveSignatureForRequest` + `appendSignatureBlock`). The default therefore
 * ends at "Please do not hesitate to contact me…" — the `Thank you,` closing was
 * removed (S272, owner decision) so the server-appended signature is the sole
 * closing and there is no double sign-off. See docs/GRANTEE_INVITE_BODY_CUSTOM_PLAN.md
 * and the project-grantee-deliverable-email-voice memory.
 */

export const GRANTEE_INVITE_DEFAULT_SUBJECT =
  'Your W. M. Keck Foundation award — abstract for our website';

// Program-Director-voice default (owner-approved S271). Placeholders [Name],
// [title], and COB [date] are filled per-grantee by fillInviteBody. No closing
// line — the signature is appended server-side at send/preview.
export const GRANTEE_INVITE_DEFAULT_BODY =
  'Dear Professor [Name]:\n\n' +
  'Congratulations on your recent grant from the W. M. Keck Foundation. We plan to ' +
  'post an abstract on the Foundation’s website describing your award entitled “[title]”.\n\n' +
  'The draft abstract is based on information you provided in your proposal, lightly ' +
  'edited to conform to the style that the Foundation uses in its publications. Please ' +
  'use the secure link below to review it and make any changes no later than COB [date]. ' +
  'If we have not heard from you by this date, we will assume that we have your ' +
  'concurrence to post the draft as written.\n\n' +
  'To better highlight your work, we also encourage you to upload a high-resolution ' +
  'image related to your project, with a caption and credit. The link will walk you ' +
  'through the image and the permission to publish it.\n\n' +
  'As a reminder, in your application you and your institution agreed to acknowledge ' +
  'the Foundation’s support. Please recognize the “W. M. Keck Foundation” in ' +
  'publications and other scientific work related to this award, such as presentations ' +
  'and posters.\n\n' +
  'Please do not hesitate to contact me if you need additional information.';

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
