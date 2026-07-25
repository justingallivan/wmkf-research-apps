// Browser E2E — captured reviewer invite email → external portal accept.
//
// This composes the non-production email-capture contract with the real reviewer
// portal page. The send-emails route integration test proves capture mode returns
// this kind of HTML artifact; this browser spec proves the reviewer-facing UX
// path from the captured "Yes, I Can Review" button into Stage 2a accept works.

const { test, expect } = require('@playwright/test');
const { TOKEN, buildContext, mockPortal, portalUrl } = require('./helpers/reviewer-portal');

async function acknowledgeBothPolicies(page) {
  const triggers = page.getByRole('button', { name: /read policy/i });
  for (let i = 0; i < 2; i++) {
    await triggers.first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /i have read and acknowledge/i }).click();
    await expect(dialog).toBeHidden();
  }
}

// Board-writeup academic identity (S308) is required before the accept POST fires
// (Stage2aView.handleAccept); the fixture leaves it blank, so fill it first.
async function completeBoardIdentity(page) {
  await page.getByLabel('Academic rank').fill('Professor');
  await page.getByLabel('Primary department').fill('Department of Chemistry');
  await page.getByLabel('Main institution').fill('Example University');
}

test.describe('Reviewer captured invite rehearsal', () => {
  test('captured Yes, I Can Review button opens the portal and reviewer accepts', async ({ page }, testInfo) => {
    const { respondCalls } = await mockPortal(page, { context: buildContext() });
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    const reviewUrl = new URL(portalUrl(TOKEN), baseURL).toString();

    const capturedEmailHtml = `
      <main>
        <p>The W. M. Keck Foundation invites you to serve as a peer reviewer.</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td>
              <a href="${reviewUrl}?action=accept" style="display:inline-block;padding:12px 18px;">Yes, I Can Review</a>
            </td>
          </tr>
        </table>
        <p>This secure link is unique to you and was sent by W.M. Keck Foundation Program Director Dr. Program Director pd@wmkeck.org. Please contact them with any questions.</p>
        <p>If the button does not work, copy and paste this secure link into your browser:<br>
          <a href="${reviewUrl}">${reviewUrl}</a>
        </p>
      </main>
    `;

    await page.setContent(capturedEmailHtml);
    await page.getByRole('link', { name: 'Yes, I Can Review' }).click();

    await expect(page).toHaveURL(new RegExp(`/external/review/${TOKEN}\\?action=accept$`));
    await expect(page.getByText('A Study of Test-Driven Reviewer Onboarding')).toBeVisible();

    await acknowledgeBothPolicies(page);
    await completeBoardIdentity(page);
    await page.getByRole('button', { name: 'Accept and continue' }).click();

    await expect.poll(() => respondCalls.length).toBe(1);
    expect(respondCalls[0]).toMatchObject({
      action: 'accept',
      honorariumOptOut: false,
      policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true },
    });
    await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeHidden();
  });
});
