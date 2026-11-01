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
// Plan §11 (Step C2): the review-bundle link line under the briefing link.
export const DELIBERATION_SHARE_REVIEW_BUNDLE_LINK_TEXT_KEY = 'email.deliberation_share.review_bundle_link_text';

export const DELIBERATION_SHARE_SEED_SUBJECT = 'Proposal review packet — {{requestNumber}}';
export const DELIBERATION_SHARE_SEED_BODY = 'The proposal review packet linked below has the proposal discussion brief, every completed review, the proposal, and the presentation materials.';
export const DELIBERATION_SHARE_SEED_BRIEFING_COPY = Object.freeze({
  heading: 'Proposal review packet:',
  linkText: 'Open the proposal review packet',
  description: 'the proposal discussion brief, every completed review, the proposal, and the presentation materials, no login required.',
  expiryLeadIn: 'The link expires on',
  reviewBundleLinkText: 'Download all reviews (PDF)',
});

export function renderDeliberationShareSubject(template, requestNumber) {
  const number = String(requestNumber || '').trim();
  const value = String(template || '').replaceAll('{{requestNumber}}', number);
  return number ? value : value.replace(/\s+[—–-]\s*$/, '').trim();
}

/** Personal raw pair only. Compose literals and Admin settings retain their own contracts. */
export function validateDeliberationShareTemplate(template) {
  const errors = [];
  if (!template || typeof template !== 'object' || Array.isArray(template)
    || Object.keys(template).length !== 2 || !Object.hasOwn(template, 'subject') || !Object.hasOwn(template, 'body')) {
    return { valid: false, errors: ['Provide only subject and body.'] };
  }
  const { subject, body } = template;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 500 || /[\r\n]/.test(subject)) errors.push('Subject is required, on one line, up to 500 characters.');
  if (typeof body !== 'string' || !body.trim() || body.length > 20000) errors.push('Message is required, up to 20,000 characters.');
  // Any remaining brace is a malformed or unsupported placeholder, including triple braces.
  if (typeof subject === 'string' && /[{}]/.test(subject.replaceAll('{{requestNumber}}', ''))) errors.push('Only {{requestNumber}} is supported in the subject.');
  if (typeof body === 'string' && /[{}]/.test(body)) errors.push('Message placeholders are not supported.');
  return { valid: errors.length === 0, errors, ...(errors.length ? {} : { value: { subject, body } }) };
}
