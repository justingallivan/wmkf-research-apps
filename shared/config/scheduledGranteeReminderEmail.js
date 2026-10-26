/** Raw future defaults only; existing stored message edits keep their own contract. */
const TOKENS = ['{{granteeName}}', '{{proposalTitle}}', '{{dueDate}}', '{{signature}}'];
const LEGACY = ['[Name]', '[title]', 'COB [date]', '[Program Director signature]'];
export function validateScheduledGranteeReminderTemplate(template) {
  const errors = {};
  if (!template || typeof template !== 'object' || Array.isArray(template)
    || Object.keys(template).length !== 2 || !Object.hasOwn(template, 'subject') || !Object.hasOwn(template, 'body')) {
    return { valid: false, errors: { template: 'Provide only subject and body.' } };
  }
  const subject = typeof template.subject === 'string' ? template.subject.trim() : '';
  const body = typeof template.body === 'string' ? template.body.trim() : '';
  if (!subject || subject.length > 300 || /[\r\n{}]/.test(subject)) errors.subject = 'Use a non-empty single-line subject, up to 300 characters, without placeholders.';
  if (body.length < 10 || body.length > 20000) errors.body = 'Use a message of 10–20,000 characters.';
  else if (TOKENS.slice(0, 3).some(token => !body.includes(token))) errors.body = 'Include {{granteeName}}, {{proposalTitle}} and {{dueDate}}.';
  else if (/[{}]/.test(TOKENS.reduce((text, token) => text.replaceAll(token, ''), body))) errors.body = 'Only the exact supported message placeholders are allowed.';
  else if (LEGACY.some(token => body.includes(token))) errors.body = 'Replace legacy bracket placeholders with the supported {{tokens}}.';
  return { valid: !Object.keys(errors).length, errors, ...(!Object.keys(errors).length ? { value: { subject, body } } : {}) };
}
