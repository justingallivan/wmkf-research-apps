/**
 * Governed defaults for the Workbench "Share for the deliberation session"
 * composer. Dataverse settings with these keys override the built-in text;
 * blank or unavailable settings retain this safe fallback.
 */
export const DELIBERATION_SHARE_SUBJECT_KEY = 'email.deliberation_share.subject';
export const DELIBERATION_SHARE_BODY_KEY = 'email.deliberation_share.body';
export const DELIBERATION_SHARE_BRIEFING_HEADING_KEY = 'email.deliberation_share.briefing_heading';
export const DELIBERATION_SHARE_BRIEFING_LINK_TEXT_KEY = 'email.deliberation_share.briefing_link_text';
export const DELIBERATION_SHARE_BRIEFING_DESCRIPTION_KEY = 'email.deliberation_share.briefing_description';
export const DELIBERATION_SHARE_BRIEFING_EXPIRY_LEAD_IN_KEY = 'email.deliberation_share.briefing_expiry_lead_in';

export const DELIBERATION_SHARE_SEED_SUBJECT = 'Site Visit materials — {{requestNumber}}';
export const DELIBERATION_SHARE_SEED_BODY = 'The deliberation briefing page linked below has the Pre-Research Presentation Brief, every completed review, the proposal, and the research presentation materials.';
export const DELIBERATION_SHARE_SEED_BRIEFING_COPY = Object.freeze({
  heading: 'Briefing page:',
  linkText: 'Open the deliberation briefing',
  description: 'the Pre-Research Presentation Brief, every completed review, the proposal, and the research presentation materials, no login required.',
  expiryLeadIn: 'The link expires on',
});

export function renderDeliberationShareSubject(template, requestNumber) {
  const number = String(requestNumber || '').trim();
  const value = String(template || '').replaceAll('{{requestNumber}}', number);
  return number ? value : value.replace(/\s+[—–-]\s*$/, '').trim();
}
