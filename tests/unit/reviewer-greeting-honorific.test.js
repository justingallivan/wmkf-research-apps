/**
 * @jest-environment node
 *
 * Regression: every reviewer email greets "Dear Dr. <LastName>", not the robotic
 * full name.
 *
 * Staff reported (2026-07-16) that the invitation opened "Dear Dr. Deisseroth"
 * while every automated follow-up opened "Dear Karl Deisseroth". `{{greeting}}`
 * already existed and already meant the honorific form in the invitation path;
 * the release/reminder/thank-you/acceptance renderers either rendered a full name
 * into it or did not offer the token at all.
 *
 * Also pins the release-email copy: that email only ever reaches reviewers who
 * never responded (withdraw-sufficient-service.js isStillPending), so it must not
 * thank them for a "willingness to review" they never expressed.
 */

const { buildReviewerGreeting, buildTemplateData } = require('../../lib/utils/email-generator');
const { buildWithdrawSufficientBodyText } = require('../../lib/external/reviewer-withdraw-email');
const {
  buildRespondReminderBodyText,
  buildReviewDueReminderBodyText,
  buildThankYouBodyText,
} = require('../../lib/external/reviewer-reminder-email');
const { renderAcceptanceConfirmationEmail } = require('../../lib/services/reviewer-acceptance-email');
const {
  REVIEWER_WITHDRAW_SEED_BODY,
  REVIEWER_ACCEPTANCE_SEED_BODY,
} = require('../../lib/seed/email-defaults/reviewer-actions');
const {
  REVIEWER_REMINDER_RESPOND_BY_SEED_BODY,
  REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY,
} = require('../../lib/seed/email-defaults/reviewer-reminders');

const NAME = 'Karl Deisseroth';

describe('buildReviewerGreeting', () => {
  test('defaults to Dr. and uses the surname alone', () => {
    expect(buildReviewerGreeting(NAME)).toBe('Dear Dr. Deisseroth');
  });

  test.each([
    ['Mrs. Jane Roe', 'Dear Mrs. Roe'],
    ['Mrs Jane Roe', 'Dear Mrs. Roe'],
    ['Mr. John Roe', 'Dear Mr. Roe'],
    ['Mr John Roe', 'Dear Mr. Roe'],
    ['Ms. Jane Roe', 'Dear Ms. Roe'],
    ['Ms Jane Roe', 'Dear Ms. Roe'],
    ['Dr. Jane Roe', 'Dear Dr. Roe'],
    ['Dr Jane Roe', 'Dear Dr. Roe'],
    ['Prof. Jane Roe', 'Dear Professor Roe'],
    ['Prof Jane Roe', 'Dear Professor Roe'],
  ])('respects dotted and undotted stored honorifics: %s', (storedName, expected) => {
    expect(buildReviewerGreeting(storedName)).toBe(expected);
  });

  test('ignores generational and degree suffixes', () => {
    expect(buildReviewerGreeting('Kevin Weeks Jr.')).toBe('Dear Dr. Weeks');
    expect(buildReviewerGreeting('Jane Roe, Ph.D.')).toBe('Dear Dr. Roe');
  });

  test('falls back rather than rendering "Dear Dr. ,"', () => {
    for (const degenerate of ['', '   ', null, undefined]) {
      expect(buildReviewerGreeting(degenerate)).toBe('Dear Reviewer');
    }
  });

  test('a mononym greets the single name, not an empty surname', () => {
    expect(buildReviewerGreeting('Prince')).toBe('Dear Dr. Prince');
  });

  test('carries no trailing punctuation — templates supply it', () => {
    expect(buildReviewerGreeting(NAME)).not.toMatch(/[,:]$/);
  });
});

describe('{{greeting}} renders the honorific form on every reviewer email', () => {
  const signatureBlock = { signature: 'Thank you,\nJordan', customClosing: true };

  test('release / no-longer-needed', () => {
    const body = buildWithdrawSufficientBodyText({
      bodyTemplate: REVIEWER_WITHDRAW_SEED_BODY,
      reviewerName: NAME,
      title: 'Genomic Lithography',
      signatureBlock,
    });
    expect(body).toContain('Dear Dr. Deisseroth,');
    expect(body).not.toContain(`Dear ${NAME}`);
  });

  test('respond-by reminder', () => {
    const body = buildRespondReminderBodyText({
      bodyTemplate: REVIEWER_REMINDER_RESPOND_BY_SEED_BODY,
      reviewerName: NAME,
      title: 'Genomic Lithography',
      signatureBlock,
    });
    expect(body).toContain('Dear Dr. Deisseroth,');
    expect(body).not.toContain(`Dear ${NAME}`);
  });

  test('review-due reminder', () => {
    const body = buildReviewDueReminderBodyText({
      bodyTemplate: REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY,
      reviewerName: NAME,
      title: 'Genomic Lithography',
      reviewDueDate: '2026-09-01',
      signatureBlock,
    });
    expect(body).toContain('Dear Dr. Deisseroth,');
    expect(body).not.toContain(`Dear ${NAME}`);
  });

  test('thank-you', () => {
    const body = buildThankYouBodyText({
      bodyTemplate: '{{greeting}},\n\nThank you for reviewing {{proposalTitle}}.\n\n{{signature}}',
      reviewerName: NAME,
      title: 'Genomic Lithography',
      signatureBlock,
    });
    expect(body).toContain('Dear Dr. Deisseroth,');
  });

  test('acceptance confirmation', () => {
    const { body } = renderAcceptanceConfirmationEmail({
      subjectTemplate: 'Review accepted',
      bodyTemplate: REVIEWER_ACCEPTANCE_SEED_BODY,
      reviewer: { wmkf_name: NAME },
      request: { akoya_title: 'Genomic Lithography' },
      signatureBlock,
      programDirector: { name: 'Jordan Lee', email: 'jordan.lee@example.org' },
      withdrawUrl: 'https://example.org/w',
    });
    expect(body).toContain('Dear Dr. Deisseroth,');
  });

  test('invitation path still agrees (single shared definition)', () => {
    const data = buildTemplateData({ name: NAME }, {}, {});
    expect(data.greeting).toBe('Dear Dr. Deisseroth');
  });
});

function renderFourActionBodies(signatureBlock) {
  return {
    release: buildWithdrawSufficientBodyText({
      bodyTemplate: REVIEWER_WITHDRAW_SEED_BODY,
      reviewerName: NAME,
      title: 'Genomic Lithography',
      signatureBlock,
    }),
    respondReminder: buildRespondReminderBodyText({
      bodyTemplate: REVIEWER_REMINDER_RESPOND_BY_SEED_BODY,
      reviewerName: NAME,
      title: 'Genomic Lithography',
      signatureBlock,
    }),
    reviewDueReminder: buildReviewDueReminderBodyText({
      bodyTemplate: REVIEWER_REMINDER_REVIEW_DUE_SEED_BODY,
      reviewerName: NAME,
      title: 'Genomic Lithography',
      reviewDueDate: '2026-09-01',
      signatureBlock,
    }),
    acceptance: renderAcceptanceConfirmationEmail({
      subjectTemplate: 'Review accepted',
      bodyTemplate: REVIEWER_ACCEPTANCE_SEED_BODY,
      reviewer: { wmkf_name: NAME },
      request: { akoya_title: 'Genomic Lithography' },
      signatureBlock,
      programDirector: { name: 'Jordan Lee', email: 'jordan.lee@example.org' },
      withdrawUrl: 'https://example.org/w',
    }).body,
  };
}

describe('conditional closing composition across all four reviewer action bodies', () => {
  test('a signature explicitly marked with a closing is preserved without a second closing', () => {
    const bodies = renderFourActionBodies({
      signature: 'Thank you,\nJordan Lee\nW. M. Keck Foundation',
      customClosing: true,
    });
    for (const [bodyName, body] of Object.entries(bodies)) {
      expect({ bodyName, body }).toEqual({
        bodyName,
        body: expect.stringContaining('Thank you,'),
      });
      expect((body.match(/Thank you,/g) || [])).toHaveLength(1);
      expect(body).not.toContain('With appreciation,');
    }
  });

  test('an arbitrary custom closing is preserved verbatim', () => {
    const bodies = renderFourActionBodies({
      signature: 'Best wishes,\nJordan Lee\nW. M. Keck Foundation',
      customClosing: true,
    });
    for (const body of Object.values(bodies)) {
      expect((body.match(/Best wishes,/g) || [])).toHaveLength(1);
      expect(body).not.toContain('With appreciation,');
    }
  });

  test.each([
    ['generated bare name', { signature: 'Jordan Lee\nW. M. Keck Foundation', customClosing: false }],
    ['fallback', null],
  ])('a %s signature receives one default closing', (_label, signatureBlock) => {
    const bodies = renderFourActionBodies(signatureBlock);
    for (const body of Object.values(bodies)) {
      expect((body.match(/With appreciation,/g) || [])).toHaveLength(1);
    }
  });
});

describe('{{reviewerName}} keeps its full-name meaning', () => {
  // Live templates edited by staff still use {{reviewerName}}; changing what it
  // renders would silently rewrite their copy.
  test('release email renders the full name for the legacy token', () => {
    const body = buildWithdrawSufficientBodyText({
      bodyTemplate: 'Dear {{reviewerName}},',
      reviewerName: NAME,
      title: null,
      signatureBlock: null,
    });
    expect(body).toBe(`Dear ${NAME},`);
  });
});

describe('release email copy', () => {
  const body = buildWithdrawSufficientBodyText({
    bodyTemplate: REVIEWER_WITHDRAW_SEED_BODY,
    reviewerName: NAME,
    title: 'Genomic Lithography',
    signatureBlock: { signature: 'Thank you,\nJordan', customClosing: true },
  });

  test('does not assume the reviewer ever accepted', () => {
    expect(body).not.toContain('willingness to review');
    expect(body).toContain('Thank you for considering our request to review');
  });

  test('says "a full slate of reviewers"', () => {
    expect(body).toContain('a full slate of reviewers');
    expect(body).not.toContain('a full panel');
  });
});
