/**
 * @jest-environment node
 *
 * renderGranteeInviteHtml — escapes the staff body, renders paragraphs, and
 * appends the server-injected action button + fallback link for the grantee URL.
 */
import {
  buildGranteeReminderBodyText,
  renderGranteeInviteHtml,
} from '../../lib/external/grantee-invite-email';
import { GRANTEE_REMINDER_SEED_BODY } from '../../lib/seed/email-defaults/grantee-reminder';

const URL = 'https://app.example.org/external/grantee/JWT.123_abc';

test('includes the action button and a fallback copy-paste link to the url', () => {
  const html = renderGranteeInviteHtml({ bodyText: 'Hello.', url: URL });
  expect(html).toContain(`href="${URL}"`);
  expect(html).toContain('Open the Grantee Portal');
  expect(html).toContain('copy and paste this secure link');
  // url appears as both the button href and the visible fallback
  expect(html.match(new RegExp(URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')).length).toBeGreaterThanOrEqual(2);
});

test('renders blank-line-separated body as paragraphs and newlines as <br>', () => {
  const html = renderGranteeInviteHtml({ bodyText: 'Para one.\n\nPara two\nwith a break.', url: URL });
  expect((html.match(/<p /g) || []).length).toBeGreaterThanOrEqual(2);
  expect(html).toContain('with a break.');
  expect(html).toContain('<br>');
});

test('escapes HTML in the staff-authored body (no injection)', () => {
  const html = renderGranteeInviteHtml({ bodyText: 'Hi <script>alert(1)</script> & co', url: URL });
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&amp; co');
});

test('reminder body uses the resolved signature block instead of pdName/pdTitle', () => {
  const body = buildGranteeReminderBodyText({
    bodyTemplate: GRANTEE_REMINDER_SEED_BODY,
    piName: 'Raj',
    title: 'Neural signaling',
    signatureBlock: { signature: 'Connor Noda\nW. M. Keck Foundation' },
    invitedDate: '2026-06-08T00:00:00.000Z',
  });
  expect(body).toContain('Connor Noda\nW. M. Keck Foundation');
  expect(body).not.toContain('Program Director');
});
