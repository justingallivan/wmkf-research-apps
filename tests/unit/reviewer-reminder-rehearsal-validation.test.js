import { validateReminderTemplate } from '../../lib/services/reviewer-reminder-personalization';
import { validateRehearsalTemplate } from '../../scripts/rehearsal/reviewer-reminder-validation';

jest.mock('../../lib/dataverse/adapters/user-preference', () => ({}));
jest.mock('../../lib/services/email-defaults', () => ({}));
jest.mock('../../lib/services/external-token', () => ({}));

test.each([
  ['respond', { subject: 'Reminder', body: '{{greeting}}\n{{signature}}' }],
  ['respond', { subject: '', body: '{{greeting}}' }],
  ['respond', { subject: '{{reviewerName}}', body: 'Please respond.' }],
  ['respond', { subject: 'Reminder', body: 'Please respond {{unknown}}' }],
  ['respond', { subject: 'Reminder', body: 'Please respond {{broken' }],
  ['respond', { subject: 'Reminder', body: 'https://example.org' }],
  ['reviewdue', { subject: 'Review due', body: '{{greeting}} Due {{reviewDueDate}}' }],
  ['reviewdue', { subject: 'Review due', body: 'Please review.' }],
  ['reviewdue', { subject: 'Review due', body: '{{reviewDueDate}} /external/review/token' }],
  ['reviewdue', { subject: 'Review due', body: '{{reviewDueDate}} {{externalLink}}' }],
])('rehearsal and server agree on %s template validation %#', (kind, template) => {
  expect(validateRehearsalTemplate(kind, template)).toEqual(validateReminderTemplate(kind, template));
});
