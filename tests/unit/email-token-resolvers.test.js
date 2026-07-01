/**
 * @jest-environment node
 */

import {
  buildRespondReminderBodyText,
  buildReviewDueReminderBodyText,
} from '../../lib/external/reviewer-reminder-email';
import { buildWithdrawSufficientBodyText } from '../../lib/external/reviewer-withdraw-email';
import { renderAcceptanceConfirmationEmail } from '../../pages/api/external/review/[token]/respond';

const signatureBlock = { signature: 'Dr. PD\nW. M. Keck Foundation' };

test('reviewer respond-by reminder resolves legacy aliases and mustache identically', () => {
  const args = { reviewerName: 'Dr. External Reviewer', title: 'Token Scoped Proposal', signatureBlock };
  const legacy = 'Dear [Reviewer Name], review [proposal]. Also [proposal title clause].\n[Program Director signature]';
  const mustache = 'Dear {{reviewerName}}, review {{proposalClause}}. Also {{proposalClause}}.\n{{signature}}';
  expect(buildRespondReminderBodyText({ ...args, bodyTemplate: mustache }))
    .toBe(buildRespondReminderBodyText({ ...args, bodyTemplate: legacy }));
});

test('reviewer review-due reminder resolves legacy aliases and mustache identically', () => {
  const args = {
    reviewerName: 'Dr. External Reviewer',
    title: 'Token Scoped Proposal',
    reviewDueDate: '2026-08-15',
    signatureBlock,
  };
  const legacy = 'Dear [Reviewer Name], review [proposal title clause] by [review due date].\n[Program Director signature]';
  const mustache = 'Dear {{reviewerName}}, review {{proposalClause}} by {{reviewDueDate}}.\n{{signature}}';
  expect(buildReviewDueReminderBodyText({ ...args, bodyTemplate: mustache }))
    .toBe(buildReviewDueReminderBodyText({ ...args, bodyTemplate: legacy }));
});

test('reviewer withdraw resolves all legacy aliases and mustache equivalents', () => {
  const args = { reviewerName: 'Dr. External Reviewer', title: 'Token Scoped Proposal', signatureBlock };
  const canonical = buildWithdrawSufficientBodyText({
    ...args,
    bodyTemplate: '{{greeting}}\n{{reviewerName}}\n{{proposalClause}}\n{{signature}}',
  });
  for (const bodyTemplate of [
    '[greeting]\n[Reviewer Name]\n[proposal]\n[Program Director signature]',
    '[greeting]\n[reviewerName]\n[proposal title clause]\n[signature]',
    '[greeting]\n[Reviewer Name]\n[title]\n[Program Director signature]',
  ]) {
    expect(buildWithdrawSufficientBodyText({ ...args, bodyTemplate })).toBe(canonical);
  }
});

test('acceptance confirmation resolves legacy and mustache forms and strips request number', () => {
  const args = {
    reviewer: { wmkf_name: 'Dr. External Reviewer' },
    request: { akoya_title: 'Token Scoped Proposal', wmkf_reviewduedate: '2026-08-15' },
    signatureBlock,
  };
  const legacy = renderAcceptanceConfirmationEmail({
    ...args,
    subjectTemplate: 'Accepted: [title] [requestNumber]',
    bodyTemplate: 'Dear [reviewerName],\n[title]\n[reviewDueDate]\n[Program Director signature]\n[requestNumber]',
  });
  const mustache = renderAcceptanceConfirmationEmail({
    ...args,
    subjectTemplate: 'Accepted: {{proposalTitle}} {{requestNumber}}',
    bodyTemplate: 'Dear {{reviewerName}},\n{{proposalTitle}}\n{{reviewDueDate}}\n{{signature}}\n{{requestNumber}}',
  });
  expect(mustache).toEqual(legacy);
  expect(mustache.subject).toBe('Accepted: Token Scoped Proposal ');
  expect(mustache.body).not.toContain('requestNumber');
  expect(mustache.body).toContain('Your review is due on August 15, 2026.');
});
