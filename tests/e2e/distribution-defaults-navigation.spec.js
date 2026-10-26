// Real Pages router + shipped composer, with all API/external requests intercepted.
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '22222222-2222-4222-8222-222222222222';
const pair = { subject: 'Brief {{requestNumber}}', body: 'Please review the briefing.' };
const path = `/workbench/${ID}?tab=staff-deliberations&n=123`;
async function setup(context, baseURL) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { name: 'Distribution fixture', email: 'pd@example.org', azureEmail: 'pd@example.org', userType: 'staff', profileId: 1, dynamicsSystemuserId: OWNER };
  const token = await encode({ secret: 'e2e-throwaway-nextauth-secret-32-chars', token: { ...user, sub: 'distribution-e2e', azureId: 'fixture', lastActivity: Date.now(), exp: expires } });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: new URL(baseURL).hostname, path: '/', httpOnly: true, sameSite: 'Lax', expires }]);
  const unexpected = [], writes = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const p = url.pathname;
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    // Profile context can persist its ordinary selected-profile preference; keep it fixture-only.
    if (p === '/api/user-preferences' && req.method() === 'POST') return json({ success: true });
    if (req.method() !== 'GET') { writes.push(p); return route.abort('blockedbyclient'); }
    if (p === '/api/auth/status') return json({ enabled: false });
    if (p === '/api/auth/session') return json({ user, expires: new Date(expires * 1000).toISOString() });
    if (p === '/api/app-access') return json({ apps: ['reviewers'], isSuperuser: false });
    if (p === '/api/user-profiles') return json({ profiles: [{ id: 1, name: user.name, isDefault: true }] });
    if (p === '/api/user-preferences') return json({ preferences: {} });
    if (p === '/api/workbench/board-writeups') return json({ canRelease: false, canArchive: false, cycles: [] });
    if (p === '/api/workbench/staffing') return json({ error: 'No fixture access' });
    if (p === '/api/workbench/resolve-request') return json({ success: true, requestId: ID, requestNumber: '123', title: 'Distribution fixture', programDirectorId: OWNER });
    if (p === '/api/workbench/pre-rp-brief') return json({ success: true, currentArtifact: { artifactId: '44444444-4444-4444-8444-444444444444', operationStatus: 100000001, lifecycleState: 100000000, receivedReviewCount: 1, file: { name: 'Brief.docx', webUrl: `${baseURL}/fixture-brief.docx` } }, writeupAccess: { canChange: true, identityLinked: true, canRegenerate: true } });
    if (p === '/api/workbench/reviewer-rollup') return json({ success: true, requests: [] });
    if (p === '/api/workbench/pre-site-visit') return json({ success: true, currentArtifact: null });
    if (p === '/api/workbench/site-visit/logistics') return json({ siteVisit: null, materials: [], presentationMaterialsStatus: 'disabled' });
    if (p === '/api/workbench/site-visit/recipients') return json({ staff: [], external: [] });
    if (p === '/api/workbench/site-visit/material-files') return json({ files: [] });
    if (p.endsWith('/distribution/history')) return json({ attempts: [], currentSourceEverSent: false });
    if (p.endsWith('/distribution/email-preferences')) return json({ ok: true, own: pair, shared: pair, effective: pair, source: 'personal', ownStatus: 'configured', canSave: true, canClear: true });
    unexpected.push(p); return route.abort('blockedbyclient');
  });
  return { unexpected, writes };
}
async function edit(page) {
  await page.getByRole('button', { name: 'Share…', exact: true }).click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Brief 123');
  await page.getByLabel('Message', { exact: true }).fill('Retained one-send edit');
}
for (const destination of ['tab', 'layout', 'back', 'confirm']) {
  test(`${destination}: real router warns once and preserves or discards intentionally`, async ({ page, context, baseURL }, info) => {
    const fixture = await setup(context, baseURL);
    await page.goto(`${baseURL}${path}&prior=1`);
    await expect(page.getByRole('button', { name: 'Share…', exact: true })).toBeVisible();
    await page.evaluate(nextPath => window.next.router.push(nextPath, undefined, { shallow: true }), path);
    await edit(page);
    const current = page.url();
    let prompts = 0;
    page.on('dialog', async dialog => { prompts++; expect(dialog.message()).toContain('unsaved email'); if (destination === 'confirm') await dialog.accept(); else await dialog.dismiss(); });
    if (destination === 'back') await page.evaluate(() => window.history.back());
    else if (destination === 'layout') {
      // Native dialog makes shell controls inert to pointer input. Invoke the actual
      // Link handler to exercise programmatic/shell navigation while it is mounted.
      await page.getByRole('link', { name: 'Workbench', exact: true, includeHidden: true }).first().evaluate(node => node.click());
    } else await page.getByRole('button', { name: 'Overview', exact: true, includeHidden: true }).evaluate(node => node.click());
    await expect.poll(() => prompts).toBe(1);
    if (destination === 'confirm') await expect(page).toHaveURL(/tab=overview/);
    else { await expect(page).toHaveURL(current); await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Retained one-send edit'); }
    expect(prompts).toBe(1); expect(fixture.writes).toEqual([]); expect(fixture.unexpected).toEqual([]);
    if (destination === 'tab') {
      await page.getByText('Your default wording', { exact: true }).click();
      await page.setViewportSize({ width: 1280, height: 1200 });
      await page.screenshot({ path: info.outputPath('distribution-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 640, height: 900 });
      await page.screenshot({ path: info.outputPath('distribution-narrow.png'), fullPage: true });
    }
  });
}
