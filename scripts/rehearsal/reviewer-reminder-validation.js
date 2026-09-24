// Keep the isolated rehearsal's input behavior aligned with
// validateReminderTemplate in lib/services/reviewer-reminder-personalization.js.
// The runtime validator cannot be bundled here because it imports server-only
// Dataverse and token modules; the parity test checks representative cases.
const TOKENS = {
  respond: new Set(['greeting', 'reviewerName', 'proposalClause', 'signature']),
  reviewdue: new Set(['greeting', 'reviewerName', 'proposalClause', 'reviewDueDate', 'signature']),
};

export function validateRehearsalTemplate(kind, template) {
  const allowed = TOKENS[kind];
  const errors = [];
  if (!allowed || !template || typeof template !== 'object' || Array.isArray(template)
      || Object.keys(template).some((key) => !['subject', 'body'].includes(key))) {
    return { valid: false, errors: ['template'] };
  }
  const { subject, body } = template;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 500 || /[\r\n]/.test(subject)) errors.push('subject');
  if (typeof body !== 'string' || !body.trim() || body.length > 12000) errors.push('body');
  for (const [field, value] of [['subject', subject], ['body', body]]) {
    if (typeof value !== 'string') continue;
    const clean = value.replace(/\{\{([A-Za-z]+)\}\}/g, '');
    if (clean.includes('{{') || clean.includes('}}')) errors.push(`malformed:${field}`);
    for (const match of value.matchAll(/\{\{([A-Za-z]+)\}\}/g)) {
      if (field === 'subject' || !allowed.has(match[1])) errors.push(`unknown:${field}:${match[1]}`);
    }
  }
  if (kind === 'reviewdue') {
    if (typeof body === 'string' && !body.includes('{{reviewDueDate}}') && !body.includes('[review due date]')) errors.push('required:reviewDueDate');
    if (/\{\{externalLink\}\}|\/external\/review\//i.test(`${subject || ''}\n${body || ''}`)) errors.push('reviewer_link');
  }
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(`${subject || ''}\n${body || ''}`)) errors.push('link');
  return { valid: errors.length === 0, errors, value: { subject, body } };
}
