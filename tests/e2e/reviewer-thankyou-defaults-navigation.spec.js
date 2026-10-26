// Real Profile Settings/Pages router. All APIs/external requests are fixture-only.
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const OWNER = 'abcdefab-1111-4111-8111-111111111111';
const pair = { subject: 'Shared thank-you {{proposalTitle}}', body: '{{greeting}}, thank you for {{proposalTitle}}. {{signature}}' };
const defaults = { ok: true, authenticatedProfileId: 1, ownerSystemId: OWNER, ownStatus: 'absent', configured: false, own: null, shared: pair, sharedStatus: 'available', source: 'shared', canSave: true, canClear: false };
async function setup(context, baseURL) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { name: 'Thank-you fixture', email: 'pd@example.org', azureEmail: 'pd@example.org', userType: 'staff', profileId: 1, dynamicsSystemuserId: OWNER };
  const token = await encode({ secret: 'e2e-throwaway-nextauth-secret-32-chars', token: { ...user, sub: 'thankyou-e2e', azureId: 'fixture', lastActivity: Date.now(), exp: expires } });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: new URL(baseURL).hostname, path: '/', httpOnly: true, sameSite: 'Lax', expires }]);
  const unexpected = [], writes = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const p = url.pathname;
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/api/user-preferences' && req.method() === 'POST') return json({ success: true }); // Fixture-only context initialization.
    if (req.method() !== 'GET') { writes.push(p); return route.abort('blockedbyclient'); }
    if (p === '/api/auth/status') return json({ enabled: false });
    if (p === '/api/auth/session') return json({ user, expires: new Date(expires * 1000).toISOString() });
    if (p === '/api/app-access') return json({ apps: ['reviewers'], isSuperuser: false });
    if (p === '/api/workbench/staffing') return json({ error: 'No fixture access' });
    if (p === '/api/workbench/board-writeups') return json({ canRelease: false, canArchive: false, cycles: [] });
    if (p === '/api/user-profiles') return json({ profiles: [{ id: 1, name: user.name, displayName: user.name, isDefault: true, lastUsedAt: '2026-10-26T12:00:00Z' }] });
    if (p === '/api/user-preferences') return json({ preferences: {} });
    if (p === '/api/email-defaults/grantee-invite') return json({ configured: true, subject: 'Grantee invitation', body: 'Existing invitation wording.' });
    if (p === '/api/reviewer-thankyou-email-preferences') return json(defaults);
    unexpected.push(p); return route.abort('blockedbyclient');
  });
  return { unexpected, writes };
}
async function open(page) {
  await page.getByText('Your default wording — automatic thank-you', { exact: true }).click();
  await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue(pair.subject);
}
async function edit(page) { await open(page); await page.getByLabel('Default subject', { exact: true }).fill('Retained automatic default'); }
test('independent automatic default loads without legacy writes', async ({ page, context, baseURL }, info) => {
  const fixture = await setup(context, baseURL); await page.goto(`${baseURL}/profile-settings`); await open(page);
  await expect(page.getByRole('button', { name: 'Save as my default', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Clear my default', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Default message', { exact: true })).toHaveValue(pair.body);
  expect(fixture.writes).toEqual([]); expect(fixture.unexpected).toEqual([]);
  await page.screenshot({ path: info.outputPath('automatic-thankyou-defaults.png'), fullPage: true });
});
test('collapse/reopen keeps dirty wording without fetching or prompting', async ({ page, context, baseURL }) => {
  const fixture = await setup(context, baseURL); await page.goto(`${baseURL}/profile-settings`); await edit(page);
  let prompts = 0; page.on('dialog', async d => { prompts++; await d.dismiss(); });
  const toggle = page.getByText('Your default wording — automatic thank-you', { exact: true }); await toggle.click(); await toggle.click();
  await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue('Retained automatic default'); expect(prompts).toBe(0); expect(fixture.writes).toEqual([]);
});
for (const choice of ['cancel', 'confirm', 'back']) test(`${choice}: deliberate departure preserves or discards the default draft`, async ({ page, context, baseURL }) => {
  const fixture = await setup(context, baseURL);
  if (choice === 'back') { await page.goto(`${baseURL}/profile-settings?previous=1`); await page.evaluate(() => window.next.router.push('/profile-settings')); }
  else await page.goto(`${baseURL}/profile-settings`);
  await edit(page); let prompts = 0;
  page.on('dialog', async d => { prompts++; expect(d.message()).toContain('unsaved default wording'); if (choice === 'confirm') await d.accept(); else await d.dismiss(); });
  if (choice === 'back') await page.evaluate(() => history.back());
  else await page.evaluate(() => window.next.router.push('/guide').catch(e => { if (!e.cancelled) throw e; }));
  await expect.poll(() => prompts).toBe(1);
  if (choice === 'confirm') {
    await expect(page).toHaveURL(`${baseURL}/guide`); await page.evaluate(() => window.next.router.push('/profile-settings')); await open(page);
    await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue(pair.subject);
  } else { await expect(page).toHaveURL(`${baseURL}/profile-settings`); await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue('Retained automatic default'); }
  expect(fixture.writes).toEqual([]);
});
test('pending save navigation explains it may already be saved and preserves draft on cancel', async ({ page, context, baseURL }) => {
  await setup(context, baseURL); await page.goto(`${baseURL}/profile-settings`); await edit(page);
  let release; const wait = new Promise(resolve => { release = resolve; });
  await page.route('**/api/reviewer-thankyou-email-preferences', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await wait; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...defaults, configured: true, ownStatus: 'configured', own: { ...pair, subject: 'Retained automatic default' }, source: 'personal', canClear: true }) });
  });
  const request = page.waitForRequest(req => req.url().endsWith('/reviewer-thankyou-email-preferences') && req.method() === 'PUT');
  await page.getByRole('button', { name: 'Save as my default', exact: true }).click(); await request;
  let prompts = 0; page.on('dialog', async d => { prompts++; expect(d.message()).toContain('may already be saved'); await d.dismiss(); });
  await page.evaluate(() => window.next.router.push('/guide').catch(e => { if (!e.cancelled) throw e; }));
  await expect.poll(() => prompts).toBe(1); await expect(page).toHaveURL(`${baseURL}/profile-settings`); await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue('Retained automatic default'); release();
  await expect(page.getByText('Saved for future automatic thank-yous.', { exact: true })).toBeVisible();
});
