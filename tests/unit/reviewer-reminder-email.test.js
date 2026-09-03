/**
 * Link-free review-due reminder rendering contract.
 */

const {
  HONORARIUM_NOTE_TEXT,
  REVIEW_DUE_ACCESS_INSTRUCTION,
  renderReviewDueReminder,
  renderThankYou,
  resolveHonorariumNote,
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

describe('thank-you honorarium note', () => {
  const BODY = '{{greeting}},\n\nThank you for your review of “{{proposalTitle}}”.\n\n{{honorariumNote}}\n\nWith gratitude,\n\n{{signature}}';
  function thankYou(honorariumOptOut) {
    return renderThankYou({
      subjectTemplate: 'Thanks — {{proposalTitle}}',
      bodyTemplate: BODY,
      reviewerName: 'Dr. Reviewer',
      title: 'A Proposal',
      signatureBlock: { name: 'Dr. PD', email: 'pd@example.org', signature: 'Dr. PD' },
      honorariumOptOut,
    });
  }

  test('resolveHonorariumNote omits the line only for a strict true', () => {
    expect(resolveHonorariumNote(true)).toBe('');
    for (const v of [false, null, undefined, 'true', 1]) expect(resolveHonorariumNote(v)).toBe(HONORARIUM_NOTE_TEXT);
  });

  test('opted out → line and token absent, paragraphs stay contiguous', () => {
    const { html } = thankYou(true);
    expect(html).not.toContain('honorarium');
    expect(html).not.toContain('{{honorariumNote}}');
    expect(html).not.toMatch(/<p[^>]*><\/p>/);
    expect(html).toContain('A Proposal');
    expect(html).toContain('With gratitude,');
  });

  test.each([false, null, undefined])('not opted out (%p) → honorarium line present once', (v) => {
    const { html } = thankYou(v);
    expect(html.match(new RegExp(HONORARIUM_NOTE_TEXT.replace(/\./g, '\\.'), 'g'))).toHaveLength(1);
    expect(html).not.toContain('{{honorariumNote}}');
  });

  test('a stored body without the token renders unchanged', () => {
    const { html } = renderThankYou({
      subjectTemplate: 'Thanks',
      bodyTemplate: '{{greeting}},\n\nThank you.\n\n{{signature}}',
      reviewerName: 'Dr. Reviewer',
      title: 'A Proposal',
      signatureBlock: { name: 'Dr. PD', email: 'pd@example.org', signature: 'Dr. PD' },
      honorariumOptOut: false,
    });
    expect(html).not.toContain('honorarium');
  });
});
