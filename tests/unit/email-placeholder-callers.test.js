/**
 * Public email-builder characterization for the shared placeholder operation.
 * Expected text is literal so these cases pin caller contracts independently
 * of the replacement algorithm.
 */

import {
  buildRespondReminderBodyText,
  buildReviewDueReminderBodyText,
  renderRespondReminder,
  renderReviewDueReminder,
  renderThankYou,
} from '../../lib/external/reviewer-reminder-email.js';
import {
  renderWithdrawSufficient,
} from '../../lib/external/reviewer-withdraw-email.js';
import {
  buildGranteeReminderBodyText,
  buildGranteeReminderDraftBodyText,
  renderGranteeReminderHtml,
} from '../../lib/external/grantee-invite-email.js';
import {
  renderAcceptanceConfirmationEmail,
} from '../../lib/services/reviewer-acceptance-email.js';

const SIGNATURE = { signature: 'Best,\nJordan Lee', customClosing: true };

test('respond-by and review-due builders substitute their bodies while renderers keep raw subjects', () => {
  const respondArgs = {
    bodyTemplate: 'Automatically sent on behalf of:\n{{greeting}}, {{reviewerName}} — {{proposalClause}}\n{{signature}}',
    reviewerName: 'Karl Deisseroth',
    title: 'Graphene',
    signatureBlock: SIGNATURE,
    subjectTemplate: 'Respond {{reviewerName}}',
    url: 'https://example.org/review/respond',
  };
  expect(buildRespondReminderBodyText(respondArgs)).toBe(
    'Dear Dr. Deisseroth, Karl Deisseroth — the proposal “Graphene”\nBest,\nJordan Lee',
  );
  expect(renderRespondReminder(respondArgs).subject).toBe('Respond {{reviewerName}}');
  const respondHtml = renderRespondReminder(respondArgs).html;
  expect(respondHtml).toContain('href="https://example.org/review/respond"');
  expect(respondHtml).toContain('Accept or decline');

  const reviewDueArgs = {
    bodyTemplate: '{{greeting}}, {{reviewerName}} — {{proposalClause}} — {{reviewDueDate}}\n{{signature}}',
    reviewerName: 'Karl Deisseroth',
    title: 'Graphene',
    reviewDueDate: '2026-09-09',
    signatureBlock: SIGNATURE,
    subjectTemplate: 'Due {{reviewDueDate}}',
  };
  expect(buildReviewDueReminderBodyText(reviewDueArgs)).toBe(
    'Dear Dr. Deisseroth, Karl Deisseroth — the proposal “Graphene” — September 9, 2026\nBest,\nJordan Lee',
  );
  expect(renderReviewDueReminder(reviewDueArgs).subject).toBe('Due {{reviewDueDate}}');
});

test('thank-you body strips only the legacy marker and maps both subject aliases', () => {
  const rendered = renderThankYou({
    subjectTemplate: 'Thank you — {{proposalTitle}} / [proposal title]',
    bodyTemplate: 'Automatically sent on behalf of:\n{{greeting}}\n{{proposalTitle}} / {{honorariumNote}}\n{{signature}}',
    reviewerName: 'Karl Deisseroth',
    title: 'Graphene',
    signatureBlock: SIGNATURE,
  });
  expect(rendered.subject).toBe('Thank you — Graphene / Graphene');
  expect(rendered.html).toContain('Dear Dr. Deisseroth');
  expect(rendered.html).toContain('Graphene /');
  expect(rendered.html).toContain('Best,<br>Jordan Lee');
  expect(rendered.html).not.toContain('{{honorariumNote}}');
  expect(rendered.html).not.toContain('Automatically sent on behalf of:');
});

test('withdrawal substitutes its body and preserves the configured subject literally', () => {
  const rendered = renderWithdrawSufficient({
    subjectTemplate: 'Released {{reviewerName}}',
    bodyTemplate: '{{greeting}}, {{reviewerName}} — {{proposalClause}}\n{{signature}}',
    reviewerName: 'Karl Deisseroth',
    title: 'Graphene',
    signatureBlock: SIGNATURE,
  });
  expect(rendered.subject).toBe('Released {{reviewerName}}');
  expect(rendered.html).toContain('Dear Dr. Deisseroth, Karl Deisseroth — the proposal “Graphene”');
  expect(rendered.html).toContain('Best,<br>Jordan Lee');
});

test('grantee reminder and draft keep their signature difference and render escaped HTML links', () => {
  const reminderArgs = {
    bodyTemplate: 'COB {{dueDate}}; {{dueDate}}; {{proposalTitle}}; {{granteeName}}; {{signature}}',
    piName: 'Dr. Elena Vasquez',
    title: 'Neural study',
    signatureBlock: { signature: 'Jordan Lee', customClosing: true },
    invitedDate: '2026-06-08T00:00:00.000Z',
  };
  expect(buildGranteeReminderBodyText(reminderArgs)).toBe(
    'COB June 22, 2026; June 22, 2026; Neural study; Vasquez; Jordan Lee',
  );
  expect(buildGranteeReminderDraftBodyText(reminderArgs)).toBe(
    'COB June 22, 2026; June 22, 2026; Neural study; Vasquez;',
  );
  const html = renderGranteeReminderHtml({
    ...reminderArgs,
    bodyTemplate: 'Reminder for <Vasquez> & team.',
    url: 'https://example.org/grantee/token?a=1&b=2',
    senderName: 'Jordan Lee',
    senderEmail: 'jordan@example.org',
  });
  expect(html).toContain('Reminder for &lt;Vasquez&gt; &amp; team.');
  expect(html).toContain('href="https://example.org/grantee/token?a=1&amp;b=2"');
  expect(html).toContain('This automated reminder was sent');
});

test('acceptance maps subject and body tokens and supports both withdrawal URL paths', () => {
  const base = {
    reviewer: { wmkf_name: 'Karl Deisseroth' },
    request: { akoya_title: 'Graphene', wmkf_reviewduedate: '2026-09-09' },
    suggestion: {},
    signatureBlock: SIGNATURE,
    programDirector: { name: 'Jordan Lee', email: 'jordan@example.org' },
    withdrawUrl: 'https://example.org/review/withdraw?a=1&b=2',
  };
  const rendered = renderAcceptanceConfirmationEmail({
    ...base,
    subjectTemplate: 'Accepted {{reviewerName}}: {{proposalTitle}} / {{programDirectorName}} / {{programDirectorEmail}} / {{withdrawUrl}} / {{requestNumber}}',
    bodyTemplate: '{{greeting}}, {{reviewerName}} — {{proposalTitle}} — {{reviewDueDate}} — {{programDirectorName}} — {{programDirectorEmail}} — {{withdrawUrl}} — {{signature}}',
  });
  expect(rendered.subject).toBe(
    'Accepted Karl Deisseroth: Graphene / Jordan Lee / jordan@example.org / https://example.org/review/withdraw?a=1&b=2 / ',
  );
  expect(rendered.body).toContain('Dear Dr. Deisseroth, Karl Deisseroth — Graphene — Your review is due on September 9, 2026.');
  expect(rendered.body).toContain('https://example.org/review/withdraw?a=1&amp;b=2');

  const appended = renderAcceptanceConfirmationEmail({
    ...base,
    subjectTemplate: 'Accepted',
    bodyTemplate: 'Dear {{greeting}}, review {{proposalTitle}}.',
  });
  expect(appended.body).toContain(
    'If something changes before proposal materials are released, you can withdraw from this review and suggest alternate reviewers using your secure link:',
  );
  expect(appended.body).toContain('https://example.org/review/withdraw?a=1&amp;b=2');
});
