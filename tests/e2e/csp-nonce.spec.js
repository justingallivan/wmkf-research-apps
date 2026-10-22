const { test, expect } = require('@playwright/test');

// Production build required: development permits inline scripts and masks this
// regression. This synthetic external URL is public and never writes records.
test('fresh page bootstraps under its request-specific CSP', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, reason: 'network' }),
  }));
  const violations = [];
  page.on('console', message => {
    if (/Content Security Policy|violates.*script-src/i.test(message.text())) violations.push(message.text());
  });
  const response = await page.goto('/external/review/e2e-csp-check');
  const policy = response.headers()['content-security-policy'];
  const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1]).not.toContain("'unsafe-inline'");
  expect(policy.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1]).not.toContain("'unsafe-eval'");
  const startupNonces = await page.locator('script').evaluateAll(scripts => scripts
    .filter(script => !script.src && script.textContent.trim()
      && !['application/json', 'application/ld+json'].includes(script.type.toLowerCase()))
    .map(script => script.nonce));
  // This must exercise deployed Turbopack's executable inline startup, not a
  // webpack build that omits it. The browser parser handles HTML case/spacing.
  expect(startupNonces.length).toBeGreaterThan(0);
  for (const startupNonce of startupNonces) expect(startupNonce).toBe(nonce);
  // Hydration replaces the server's loading state with the mocked API error.
  await expect(page.getByText('Network error. Please check your connection and try again.', { exact: true })).toBeVisible();
  expect(violations).toEqual([]);
});


test('fresh authenticated Admin HTML has the matching per-request nonce', async ({ request, page }) => {
  const { encode } = require('next-auth/jwt');
  const token = await encode({
    secret: 'e2e-throwaway-nextauth-secret-32-chars',
    token: { azureId: 'csp-synthetic-staff', userType: 'staff', lastActivity: Date.now() },
  });
  const nonces = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request.get('/admin?workspace=people&view=roles', {
      headers: { Cookie: `next-auth.session-token=${token}` },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    const nonce = response.headers()['content-security-policy']?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    const html = await response.text();
    expect(html).toContain('People &amp; Access');
    const startupNonces = await page.evaluate(html => {
      // DOMParser creates an inert document: response scripts are inspected,
      // never executed. It also handles all valid HTML tag/attribute forms.
      const document = new DOMParser().parseFromString(html, 'text/html');
      return Array.from(document.scripts)
        .filter(script => !script.src && script.textContent.trim()
          && !['application/json', 'application/ld+json'].includes(script.type.toLowerCase()))
        .map(script => script.nonce);
    }, html);
    expect(startupNonces.length).toBeGreaterThan(0);
    for (const startupNonce of startupNonces) expect(startupNonce).toBe(nonce);
    nonces.push(nonce);
  }
  expect(nonces[0]).not.toBe(nonces[1]);
});
