import {
  renderRespondReminder,
  renderThankYou,
} from '../../lib/external/reviewer-reminder-email';
import { renderGranteeReminderHtml } from '../../lib/external/grantee-invite-email';

const signatureBlock = {
  name: 'Justin Gallivan',
  email: 'jgallivan@wmkeck.org',
  signature: 'Sincerely,\nJustin Gallivan\n---------------\nJustin Gallivan\nSenior Program Director',
};

test('automated reviewer thank-you puts the on-behalf/reply notice before the greeting', () => {
  const result = renderThankYou({
    subjectTemplate: 'Thank you for reviewing {{proposalTitle}}',
    bodyTemplate: 'Automatically sent on behalf of:\n\n{{greeting}},\n\nThank you.\n\n{{signature}}',
    reviewerName: 'Dr. Test2',
    title: 'To Explore the Universe',
    signatureBlock,
  });

  expect(result.html).not.toMatch(/Automatically sent on behalf of:/i);
  expect(result.html).toContain('This automated message was sent by the W. M. Keck Foundation on behalf of Justin Gallivan.');
  expect(result.html).toContain('Replies to this email will go directly to Justin Gallivan at jgallivan@wmkeck.org.');
  expect(result.html.indexOf('This automated message')).toBeLessThan(result.html.indexOf('Dear Dr. Test2'));
  expect(result.html).toContain('Sincerely,');
});

test('automatic reviewer reminder includes the personalized notice while preserving the secure-link action', () => {
  const result = renderRespondReminder({
    subjectTemplate: 'Reminder',
    bodyTemplate: '{{greeting}},\n\nPlease respond.\n\n{{signature}}',
    reviewerName: 'Professor Reiter',
    title: 'Electric antennae',
    signatureBlock,
    url: 'https://example.test/review-token',
  });

  expect(result.html).toContain('This automated reminder was sent by the W. M. Keck Foundation on behalf of Justin Gallivan.');
  expect(result.html.indexOf('This automated reminder')).toBeLessThan(result.html.indexOf('Dear Professor Reiter'));
  expect(result.html).toContain('https://example.test/review-token');
});

test('automatic grantee reminder removes a legacy marker and places the notice first', () => {
  const html = renderGranteeReminderHtml({
    bodyTemplate: 'Automatically sent on behalf of:\n\nDear Dr. {{granteeName}},\n\nPlease respond by COB {{dueDate}}.\n\n{{signature}}',
    piName: 'Jeremy Reiter',
    title: 'Electric antennae',
    signatureBlock,
    invitedDate: '2026-08-10T08:00:00Z',
    url: 'https://example.test/grantee-token',
  });

  expect(html).not.toMatch(/Automatically sent on behalf of:/i);
  expect(html).toContain('This automated reminder was sent by the W. M. Keck Foundation on behalf of Justin Gallivan.');
  expect(html.indexOf('This automated reminder')).toBeLessThan(html.indexOf('Dear Dr. Reiter'));
});
