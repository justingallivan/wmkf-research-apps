/** Agenda wording only. Generated session details never belong in personal defaults. */
export const AGENDA_SUBJECT_LIMIT = 500;
export const AGENDA_OPENING_LIMIT = 20000;
export function validateAgendaTemplate(template) {
  const errors = [];
  if (!template || typeof template !== 'object' || Array.isArray(template)
    || Object.keys(template).some((key) => !['subject', 'body'].includes(key))) return { valid: false, errors: ['template'] };
  const { subject, body } = template;
  if (typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject) || subject.length > AGENDA_SUBJECT_LIMIT) errors.push('subject');
  if (typeof body !== 'string' || body.length > AGENDA_OPENING_LIMIT) errors.push('body');
  for (const [field, value] of Object.entries({ subject, body })) {
    if (typeof value !== 'string') continue;
    // Consume only whole, exactly double-braced tokens. Residual braces next to
    // a token catch triple-brace partial matches rather than rendering {date}.
    const remainder = value.replace(/(?<!\{)\{\{sessionDate\}\}(?!\})/g, '');
    if (remainder.includes('{{') || remainder.includes('}}')) errors.push(`placeholder:${field}`);
  }
  return { valid: errors.length === 0, errors, value: { subject, body } };
}
export function resolveAgendaTemplate(template, snapshot) {
  const checked = validateAgendaTemplate(template);
  if (!checked.valid) return checked;
  const date = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: snapshot.ianaTimeZone }).format(new Date(snapshot.scheduledStartIso));
  const value = { subject: template.subject.replaceAll('{{sessionDate}}', date).trim(), body: template.body.replaceAll('{{sessionDate}}', date).trim() };
  return validateAgendaTemplate(value);
}
