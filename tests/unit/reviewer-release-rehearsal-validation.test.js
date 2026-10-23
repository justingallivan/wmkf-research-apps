import { validateReleaseTemplate } from '../../lib/services/reviewer-release-personalization';
import { validateRehearsalReleaseTemplate } from '../../scripts/rehearsal/reviewer-release-validation';

jest.mock('../../lib/dataverse/adapters/user-preference', () => ({}));
jest.mock('../../lib/services/email-defaults', () => ({}));

test.each([
  ['withdraw', { subject: 'Thank you', body: '{{greeting}}\n{{proposalClause}}\n{{signature}}' }],
  ['release', { subject: 'Thank you', body: '{{reviewerName}} {{signature}}' }],
  ['withdraw', { subject: '', body: '{{greeting}}' }],
  ['withdraw', { subject: 'Two\nlines', body: 'Body' }],
  ['release', { subject: '{{reviewerName}}', body: 'Body' }],
  ['release', { subject: 'Thanks', body: 'Body {{externalLink}}' }],
  ['withdraw', { subject: 'Thanks', body: 'Body {{broken' }],
  ['release', { subject: 'Thanks', body: 'See www.example.org' }],
  ['withdraw', { subject: 'Thanks', body: 'Body', to: 'x@example.org' }],
  ['respond', { subject: 'Thanks', body: 'Body' }],
])('rehearsal and server agree on %s template validation %#', (kind, template) => {
  expect(validateRehearsalReleaseTemplate(kind, template)).toEqual(validateReleaseTemplate(kind, template));
});
