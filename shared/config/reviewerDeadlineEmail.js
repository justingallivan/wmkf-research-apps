/** Deadline-email copy contract. Empty body is an intentional value, not Clear. */
export const DEADLINE_BODY_TOKENS = ['greeting', 'reviewerName', 'proposalTitle', 'reviewDueDate', 'signature'];
export function validateDeadlineTemplate(template) {
  const errors = [];
  if (!template || typeof template !== 'object' || Array.isArray(template)
    || Object.keys(template).some((key) => !['subject', 'body'].includes(key))) return { valid: false, errors: ['template'] };
  const { subject, body } = template;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 500 || /[\r\n]/.test(subject)) errors.push('subject');
  if (typeof body !== 'string' || body.length > 12000) errors.push('body');
  for (const [field, value] of [['subject', subject], ['body', body]]) {
    if (typeof value !== 'string') continue;
    const clean = value.replace(/\{\{([A-Za-z]+)\}\}/g, '');
    if (clean.includes('{{') || clean.includes('}}')) errors.push(`malformed:${field}`);
    for (const match of value.matchAll(/\{\{([A-Za-z]+)\}\}/g)) {
      if (!(field === 'subject' ? ['proposalTitle'] : DEADLINE_BODY_TOKENS).includes(match[1])) errors.push(`unknown:${field}:${match[1]}`);
    }
  }
  return { valid: !errors.length, errors, value: { subject, body } };
}
