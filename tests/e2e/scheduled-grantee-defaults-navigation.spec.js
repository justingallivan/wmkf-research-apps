// Real Pages router + shipped scheduled-email page. Every API is fixture-only.
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const OWNER = 'abcdefab-1111-4111-8111-111111111111';
const pair = { subject: 'Shared reminder', body: 'Dear {{granteeName}}, please review {{proposalTitle}} by {{dueDate}}.' };
const defaults = { ok: true, ownerSystemId: OWNER, ownStatus: 'absent', shared: pair, own: null, source: 'shared', canSave: true, canClear: false };
async function setup(context, baseURL) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { name: 'Scheduled defaults fixture', email: 'pd@example.org', azureEmail: 'pd@example.org', userType: 'staff', profileId: 1, dynamicsSystemuserId: OWNER };
  const token = await encode({ secret: 'e2e-throwaway-nextauth-secret-32-chars', token: { ...user, sub: 'scheduled-defaults-e2e', azureId: 'fixture', lastActivity: Date.now(), exp: expires } });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: new URL(baseURL).hostname, path: '/', httpOnly: true, sameSite: 'Lax', expires }]);
  const unexpected = [], writes = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const p = url.pathname;
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/api/user-preferences' && req.method() === 'POST') return json({ success: true });
    if (req.method() !== 'GET') { writes.push(p); return route.abort('blockedbyclient'); }
    if (p === '/api/auth/status') return json({ enabled: false });
    if (p === '/api/auth/session') return json({ user, expires: new Date(expires * 1000).toISOString() });
    if (p === '/api/workbench/staffing') return json({ error: 'No fixture access' });
    if (p === '/api/workbench/board-writeups') return json({ canRelease: false, canArchive: false, cycles: [] });
    if (p === '/api/app-access') return json({ apps: ['reviewers'], isSuperuser: false });
    if (p === '/api/user-profiles') return json({ profiles: [{ id: 1, name: user.name, isDefault: true }] });
    if (p === '/api/user-preferences') return json({ preferences: {} });
    if (p === '/api/email-automation-preferences') return json({ preference: { reviewAll: false } });
    if (p === '/api/scheduled-emails/vip-flags') return json({ flags: [] });
    if (p === '/api/scheduled-emails/email-preferences') return json(defaults);
    if (p === '/api/scheduled-emails') return json({ messages: [1, 2].map(n => ({ id: `m${n}`, status: 'scheduled', version: 1, workflowType: 'grantee_abstract_reminder', subject: `Stored row ${n}`, bodyText: `Stored message ${n}`, recipientName: `Recipient ${n}`, previewHtml: '<p>Frozen preview</p>', toRecipients: ['pi@example.org'], ccRecipients: [], recipientContactIds: [] })) });
    unexpected.push(p); return route.abort('blockedbyclient');
  });
  return { unexpected, writes };
}
async function edit(page) {
  await page.getByText('Your default wording — grantee reminders', { exact: true }).click();
  await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue(pair.subject);
  await page.getByLabel('Default subject', { exact: true }).fill('Retained future default');
}
test('shallow selection retains dirty defaults, updates URL, and never prompts', async ({ page, context, baseURL }) => {
  const fixture = await setup(context, baseURL); await page.goto(`${baseURL}/scheduled-emails`); await edit(page);
  let prompts = 0; page.on('dialog', async dialog => { prompts++; await dialog.dismiss(); });
  await page.getByText('Recipient 2', { exact: true }).click();
  await expect(page).toHaveURL(/message=m2/); await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue('Retained future default');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Stored row 2');
  expect(prompts).toBe(0); expect(fixture.writes).toEqual([]); expect(fixture.unexpected).toEqual([]);
});
for (const destination of ['cancel', 'back', 'confirm']) {
  test(`${destination}: departure warns once and preserves or discards defaults intentionally`, async ({ page, context, baseURL }, info) => {
    const fixture = await setup(context, baseURL);
    if (destination === 'back') {
      await page.goto(`${baseURL}/scheduled-emails?prior=1`);
      await page.evaluate(() => window.next.router.push('/scheduled-emails', undefined, { shallow: false }));
    } else await page.goto(`${baseURL}/scheduled-emails`);
    await edit(page);
    let prompts = 0; page.on('dialog', async dialog => { prompts++; expect(dialog.message()).toContain('unsaved default wording'); if (destination === 'confirm') await dialog.accept(); else await dialog.dismiss(); });
    // Back to the prior full page is a true departure (not shallow selection).
    if (destination === 'back') await page.evaluate(() => window.history.back());
    else await page.evaluate(() => window.next.router.push('/workbench').catch(error => { if (!error.cancelled) throw error; }));
    await expect.poll(() => prompts).toBe(1);
    if (destination === 'confirm') await expect(page).toHaveURL(/\/workbench$/);
    else {
      await expect(page).toHaveURL(`${baseURL}/scheduled-emails`);
      await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue('Retained future default');
    }
    expect(prompts).toBe(1); expect(fixture.writes).toEqual([]);
    if (destination === 'cancel') await page.screenshot({ path: info.outputPath('scheduled-defaults-desktop.png'), fullPage: true });
  });
}
test('pending default write warns that it may already be saved, without losing the local draft', async ({ page, context, baseURL }) => {
  await setup(context, baseURL); await page.goto(`${baseURL}/scheduled-emails`); await edit(page);
  let release; const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/scheduled-emails/email-preferences', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await pending; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...defaults, ownStatus: 'configured', own: { ...pair, subject: 'Retained future default' }, source: 'personal', canClear: true }) });
  });
  const request = page.waitForRequest(req => req.url().endsWith('/email-preferences') && req.method() === 'PUT');
  await page.getByRole('button', { name: 'Save as my default' }).click(); await request;
  let prompts = 0; page.on('dialog', async dialog => { prompts++; expect(dialog.message()).toContain('may already be saved'); await dialog.dismiss(); });
  await page.evaluate(() => window.next.router.push('/workbench').catch(error => { if (!error.cancelled) throw error; }));
  await expect.poll(() => prompts).toBe(1); await expect(page).toHaveURL(`${baseURL}/scheduled-emails`);
  await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue('Retained future default'); release();
  await expect(page.getByText('Saved for future reminders. Existing messages are unchanged.', { exact: true })).toBeVisible();
});

test('select then cancel router Back restores the latest message URL and retains default edits', async ({ page, context, baseURL }) => {
  await setup(context, baseURL); await page.goto(`${baseURL}/scheduled-emails?prior=1`);
  await page.evaluate(() => window.next.router.push('/scheduled-emails?message=m1', undefined, { shallow: false }));
  await edit(page); await page.getByText('Recipient 2', { exact: true }).click(); await expect(page).toHaveURL(/message=m2/);
  let prompts = 0; page.on('dialog', async dialog => { prompts++; expect(dialog.message()).toContain('unsaved default wording'); await dialog.dismiss(); });
  await page.evaluate(() => window.history.back()); await expect.poll(() => prompts).toBe(1);
  await expect(page).toHaveURL(`${baseURL}/scheduled-emails?message=m2`);
  await expect(page.getByLabel('Default subject', { exact: true })).toHaveValue('Retained future default');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Stored row 2');
});
