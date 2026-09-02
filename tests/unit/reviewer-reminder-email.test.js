/**
 * Link-free review-due reminder rendering contract.
 */

const {
  REVIEW_DUE_ACCESS_INSTRUCTION,
  renderReviewDueReminder,
} = require('../../lib/external/reviewer-reminder-email');

function render(bodyTemplate) {
  return renderReviewDueReminder({
    subjectTemplate: 'Review reminder',
    bodyTemplate,
    reviewerName: 'Dr. Reviewer',
    title: 'A Proposal',
    reviewDueDate: '2026-09-09',
    signatureBlock: { name: 'Dr. PD', email: 'pd@example.org', signature: 'Dr. PD' },
  });
}

test('removes stale link directions while preserving the already-submitted reassurance', () => {
  const { html } = render(
    '{{greeting}},\n\nYour secure link below opens the review. If you have already submitted, thank you — no further action is needed.\n\n{{signature}}',
  );

  expect(html).toContain('If you have already submitted, thank you — no further action is needed.');
  expect(html).toContain(REVIEW_DUE_ACCESS_INSTRUCTION);
  expect(html).not.toContain('secure link below');
});

test('removes plural stale link directions and appends exactly one canonical instruction', () => {
  const { html } = render(
    '{{greeting}},\n\nThe links in this message replace earlier links.\n\n{{signature}}',
  );

  expect(html).not.toContain('replace earlier');
  expect(html.match(/original review materials email/g)).toHaveLength(1);
});

test.each([
  'Paste this URL: https://reviews.example.org/external/review/token.value.sig',
  'Use {{externalLink}} to continue.',
])('refuses structural reviewer-link content: %s', (bodyTemplate) => {
  expect(() => render(bodyTemplate)).toThrow(/body cannot contain a reviewer URL/i);
});

test.each([
  'Continue at https://reviews.example.org/external/review/token.value.sig',
  'Review reminder {{externalLink}}',
])('refuses reviewer-link content in the subject: %s', (subjectTemplate) => {
  expect(() => renderReviewDueReminder({
    subjectTemplate,
    bodyTemplate: 'Your review is due soon.',
    reviewerName: 'Dr. Reviewer',
    title: 'A Proposal',
    reviewDueDate: '2026-09-09',
    signatureBlock: { name: 'Dr. PD', email: 'pd@example.org', signature: 'Dr. PD' },
  })).toThrow(/subject cannot contain a reviewer URL/i);
});
