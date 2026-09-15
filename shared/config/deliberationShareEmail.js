/**
 * Governed defaults for the Workbench "Share for the deliberation session"
 * composer. Dataverse settings with these keys override the built-in text;
 * blank or unavailable settings retain this safe fallback.
 */
export const DELIBERATION_SHARE_SUBJECT_KEY = 'email.deliberation_share.subject';
export const DELIBERATION_SHARE_BODY_KEY = 'email.deliberation_share.body';

export const DELIBERATION_SHARE_SEED_SUBJECT = 'Site Visit materials — {{requestNumber}}';
export const DELIBERATION_SHARE_SEED_BODY = 'The deliberation briefing page linked below has the Site Visit writeup, every completed review, the proposal, and the research presentation materials.';

export function renderDeliberationShareSubject(template, requestNumber) {
  const number = String(requestNumber || '').trim();
  const value = String(template || '').replaceAll('{{requestNumber}}', number);
  return number ? value : value.replace(/\s+[—–-]\s*$/, '').trim();
}
