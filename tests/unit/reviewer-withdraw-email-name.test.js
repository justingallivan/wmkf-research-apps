/**
 * @jest-environment node
 *
 * Regression: a trailing/doubled space in the stored `wmkf_name` must not leak
 * into the greeting as "Dear Name ," — the rendered name is display-normalized.
 */

const { buildWithdrawSufficientBodyText } = require('../../lib/external/reviewer-withdraw-email');

const TEMPLATE =
  'Dear [Reviewer Name],\n\n' +
  'Thank you so much for your willingness to review [proposal] for the W. M. Keck Foundation.\n\n' +
  '[Program Director signature]';

describe('buildWithdrawSufficientBodyText name normalization', () => {
  test('trailing space in wmkf_name does not render "Name ,"', () => {
    const body = buildWithdrawSufficientBodyText({
      bodyTemplate: TEMPLATE,
      reviewerName: 'Test Case ',
      title: 'To Explore the Universe',
      signatureBlock: { signature: 'Sincerely,\nJustin Gallivan' },
    });
    expect(body).toContain('Dear Test Case,');
    expect(body).not.toContain('Test Case ,');
  });

  test('collapses internal doubled whitespace', () => {
    const body = buildWithdrawSufficientBodyText({
      bodyTemplate: TEMPLATE,
      reviewerName: 'Test  Case',
      title: null,
      signatureBlock: null,
    });
    expect(body).toContain('Dear Test Case,');
  });

  test('empty name falls back to "Reviewer"', () => {
    const body = buildWithdrawSufficientBodyText({
      bodyTemplate: TEMPLATE,
      reviewerName: '   ',
      title: null,
      signatureBlock: null,
    });
    expect(body).toContain('Dear Reviewer,');
  });
});
