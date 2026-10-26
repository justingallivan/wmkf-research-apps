/** Raw acceptance confirmation defaults. Legacy shared copy retains its own renderer contract. */
const BODY_TOKENS = ['{{greeting}}', '{{reviewerName}}', '{{proposalTitle}}', '{{reviewDueDate}}', '{{signature}}', '{{programDirectorName}}', '{{programDirectorEmail}}', '{{withdrawUrl}}'];
const LEGACY = ['[greeting]', '[reviewerName]', '[title]', '[reviewDueDate]', '[Program Director signature]', '[requestNumber]'];
export function validateReviewerAcceptanceTemplate(template) {
  if (!template || typeof template !== 'object' || Array.isArray(template)
      || Object.keys(template).length !== 2 || !Object.hasOwn(template, 'subject') || !Object.hasOwn(template, 'body')) {
    return { valid: false, errors: { template: 'Provide only subject and body.' } };
  }
  const errors = {};
  const subject = typeof template.subject === 'string' ? template.subject.trim() : '';
  const body = typeof template.body === 'string' ? template.body.trim() : '';
  if (!subject || subject.length > 300 || /[\r\n]/.test(subject)) errors.subject = 'Use a non-empty single-line subject, up to 300 characters.';
  if (!body || body.length > 20000) errors.body = 'Use a non-empty message, up to 20,000 characters.';
  for (const [field, value, tokens] of [['subject', subject, ['{{proposalTitle}}', '{{reviewerName}}']], ['body', body, BODY_TOKENS]]) {
    if (/[{}]/.test(tokens.reduce((text, token) => text.replaceAll(token, ''), value))) errors[field] = 'Use only the exact supported placeholders.';
    if (LEGACY.some(token => value.includes(token))) errors[field] = 'Replace legacy bracket placeholders with supported {{tokens}}.';
  }
  return { valid: !Object.keys(errors).length, errors, ...(!Object.keys(errors).length ? { value: { subject, body } } : {}) };
}
