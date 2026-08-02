// Browser E2E — external reviewer Stage 2a accept flow.
//
// Drives the REAL portal page + components with /context and /respond
// route-mocked (see helpers/reviewer-portal.js). Covers the browser/UX layer
// the jest/jsdom unit tests can't: scroll-gated policy modals, accept-gating,
// opt-out card hiding, client + server (422) error rendering, and the accept
// payload shape. No Dataverse is touched.

const { test, expect } = require('@playwright/test');
const { buildContext, mockPortal, portalUrl } = require('./helpers/reviewer-portal');

// Acknowledge both policy cards. Each ack flips that card's trigger from
// "Read policy →" to "View again", so the first remaining "Read policy →"
// always points at a not-yet-acked card — order-independent.
async function acknowledgeBothPolicies(page) {
  const triggers = page.getByRole('button', { name: /read policy/i });
  for (let i = 0; i < 2; i++) {
    await triggers.first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /i have read and acknowledge/i }).click();
    await expect(dialog).toBeHidden();
  }
}

// Board-writeup academic identity (S308) is required on every accept, independent
// of the honorarium choice (Stage2aView.handleAccept gates the POST on it). The
// fixture prefill leaves these blank — rank always starts blank in prod — so a
// spec that accepts must fill them first or the /respond POST never fires.
async function completeBoardIdentity(page) {
  await page.getByLabel('Academic rank').fill('Professor');
  await page.getByLabel('Primary department').fill('Department of Chemistry');
  await page.getByLabel('Main institution').fill('Example University');
}

test.describe('Reviewer Stage 2a accept flow', () => {
  test('renders the invitation from mocked context (proposal + prefill + address card)', async ({ page }) => {
    await mockPortal(page, { context: buildContext() });
    await page.goto(portalUrl());

    await expect(page.getByText('A Study of Test-Driven Reviewer Onboarding')).toBeVisible();
    await expect(page.locator('input[value="Jane"]').first()).toBeVisible(); // prefilled first name
    await expect(page.getByLabel('Phone number')).toBeVisible();          // address card shown (taking honorarium)
    await expect(page.getByLabel('Phone number')).toHaveValue('+1 555 123 4567');
  });

  test('Accept is disabled until both policies are acknowledged', async ({ page }) => {
    const { respondCalls } = await mockPortal(page, { context: buildContext() });
    await page.goto(portalUrl());

    // The accept button is gated `disabled` until both policies are acked.
    const accept = page.getByRole('button', { name: 'Accept and continue' });
    await expect(accept).toBeDisabled();
    expect(respondCalls).toHaveLength(0);

    await acknowledgeBothPolicies(page);
    await completeBoardIdentity(page);
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect.poll(() => respondCalls.length).toBe(1);
    expect(respondCalls[0].action).toBe('accept');
  });

  test('response actions stay visible in the viewport on long forms', async ({ page }) => {
    await mockPortal(page, { context: buildContext({ longBody: true }) });
    await page.goto(portalUrl());

    const inViewport = await page.getByRole('button', { name: 'Accept and continue' }).evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(inViewport).toBe(true);
  });

  test('address + phone are required client-side when taking the honorarium', async ({ page }) => {
    // Empty address → the client must block submit and never POST.
    const emptyAddress = { line1: '', line2: '', city: '', state: '', postalCode: '', country: '', phone: '' };
    const { respondCalls } = await mockPortal(page, { context: buildContext({ address: emptyAddress }) });
    await page.goto(portalUrl());

    await acknowledgeBothPolicies(page);
    await completeBoardIdentity(page);
    await page.getByRole('button', { name: 'Accept and continue' }).click();

    await expect(page.getByText(/complete your mailing address/i)).toBeVisible();
    await expect(page.getByLabel('Phone number')).toHaveAttribute('aria-invalid', 'true');
    expect(respondCalls).toHaveLength(0);
  });

  test('opting out of the honorarium hides the address card', async ({ page }) => {
    await mockPortal(page, { context: buildContext() });
    await page.goto(portalUrl());

    await expect(page.getByLabel('Phone number')).toBeVisible();
    await page.getByRole('checkbox').check(); // "I'd prefer to decline the honorarium."
    await expect(page.getByLabel('Phone number')).toBeHidden();
  });

  test('accept with honorarium opt-out sends no payment address', async ({ page }) => {
    const { respondCalls } = await mockPortal(page, { context: buildContext() });
    await page.goto(portalUrl());

    await acknowledgeBothPolicies(page);
    await completeBoardIdentity(page);
    await page.getByRole('checkbox').check(); // "I'd prefer to decline the honorarium."
    await page.getByRole('button', { name: 'Accept and continue' }).click();

    await expect.poll(() => respondCalls.length).toBe(1);
    expect(respondCalls[0]).toMatchObject({
      action: 'accept',
      honorariumOptOut: true,
      policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true },
    });
    expect(respondCalls[0]).not.toHaveProperty('address');
  });

  test('decline path captures structured referrals without soliciting prose', async ({ page }) => {
    const { respondCalls } = await mockPortal(page, { context: buildContext() });
    await page.goto(portalUrl());

    await page.getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByText("Sorry to hear you can't take this on")).toBeVisible();

    await page.getByLabel('Name as published').fill('Sarah Chen');
    await page.getByLabel('Institution').fill('Stanford University');
    await page.getByLabel('Email').fill('suggested@example.edu');
    await page.getByRole('button', { name: /add another reviewer/i }).click();
    await page.getByLabel('Name as published').nth(1).fill('Alex Rivera');
    await page.getByLabel('Institution').nth(1).fill('UCLA');
    await page.getByLabel('Reason for declining').selectOption('too-busy');
    await expect(page.getByLabel(/anything else/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /submit without explanation/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Submit decline' }).click();

    await expect.poll(() => respondCalls.length).toBe(1);
    expect(respondCalls[0]).toMatchObject({
      action: 'decline',
      decline: {
        reasonPicklist: 'too-busy',
        referrals: [
          { name: 'Sarah Chen', institution: 'Stanford University', email: 'suggested@example.edu' },
          { name: 'Alex Rivera', institution: 'UCLA', email: '' },
        ],
      },
    });
    await expect(page.getByText("Thank you. We've recorded your decline.")).toBeVisible();
  });

  test('decline can be submitted with no reason or referral details', async ({ page }) => {
    const { respondCalls } = await mockPortal(page, { context: buildContext() });
    await page.goto(portalUrl());

    await page.getByRole('button', { name: 'Decline' }).click();
    await page.getByRole('button', { name: 'Submit decline' }).click();

    await expect.poll(() => respondCalls.length).toBe(1);
    expect(respondCalls[0]).toEqual({ action: 'decline', decline: {} });
  });

  test('policy modal enforces the scroll-to-acknowledge gate', async ({ page }) => {
    await mockPortal(page, { context: buildContext({ longBody: true }) });
    await page.goto(portalUrl());

    await page.getByRole('button', { name: /read policy/i }).first().click();
    const dialog = page.getByRole('dialog');
    const ack = dialog.getByRole('button', { name: /scroll to acknowledge|i have read and acknowledge/i });
    await expect(ack).toBeDisabled();
    await expect(ack).toHaveText(/scroll to acknowledge/i);

    // Scroll the modal body to the bottom → ack enables.
    await dialog.evaluate((el) => {
      const body = el.querySelector('.overflow-y-auto');
      if (body) body.scrollTop = body.scrollHeight;
    });
    await expect(ack).toBeEnabled();
    await expect(ack).toHaveText(/i have read and acknowledge/i);
  });

  test('a complete accept POSTs the correct payload and transitions off Stage 2a', async ({ page }) => {
    const { respondCalls } = await mockPortal(page, { context: buildContext() });
    await page.goto(portalUrl());

    await acknowledgeBothPolicies(page);
    await completeBoardIdentity(page);
    await page.getByRole('button', { name: 'Accept and continue' }).click();

    await expect.poll(() => respondCalls.length).toBe(1);
    const body = respondCalls[0];
    expect(body.action).toBe('accept');
    expect(body.honorariumOptOut).toBe(false);
    expect(body.address).toMatchObject({ line1: '123 Main St', city: 'Townsville', postalCode: '94000', country: 'US', phone: '+1 555 123 4567' });
    expect(body.policyAcks).toMatchObject({ 'reviewer-coi': true, 'reviewer-ai-use': true });

    // The immediate post-accept view is purely confirmatory.
    await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeHidden();
    await expect(page.getByRole('heading', { name: /confirmed as a reviewer/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'I can no longer review' })).toBeHidden();

    // Returning later through the same secure link restores the quieter
    // self-service withdrawal option.
    await page.reload();
    await expect(page.getByRole('button', { name: 'I can no longer review' })).toBeVisible();
  });

  test('a server 422 payment_contact_required renders inline (defensive path)', async ({ page }) => {
    // The client pre-validates, so to exercise the server-422 branch we let the
    // form pass (full address) but make /respond return the 422.
    const { respondCalls } = await mockPortal(page, {
      context: buildContext(),
      respond: async (route, body) => {
        if (body.action === 'accept') {
          return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'payment_contact_required', fields: ['phone'] }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      },
    });
    await page.goto(portalUrl());

    await acknowledgeBothPolicies(page);
    await completeBoardIdentity(page);
    await page.getByRole('button', { name: 'Accept and continue' }).click();

    await expect.poll(() => respondCalls.length).toBe(1);
    await expect(page.getByText(/complete your mailing address and phone number/i)).toBeVisible();
    await expect(page.getByLabel('Phone number')).toHaveAttribute('aria-invalid', 'true');
  });
});
