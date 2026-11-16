// Real Workbench page, synthetic staff session and in-memory API fixtures only.
// Unknown APIs and external requests never reach application services.
const { test, expect } = require('@playwright/test');
const { encode } = require('next-auth/jwt');
const ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const SECRET = 'e2e-throwaway-nextauth-secret-32-chars';

test('Executive Summary saves, clears, rejects stale edits and protects dirty navigation in Workbench', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const user = { name: 'Summary Test Staff', email: 'summary@example.test', azureId: 'summary-fixture-azure-id', userType: 'staff', profileId: 1, dynamicsSystemuserId: ACTOR };
  const token = await encode({ secret: SECRET, token: { ...user, sub: 'summary-test', lastActivity: Date.now() } });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: new URL(baseURL).hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
  let text = 'Summary supplied at intake.';
  let version = 1;
  let writes = 0;
  const unexpected = [];
  const errors = [];
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.origin !== baseURL) { unexpected.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const key = `${req.method()} ${url.pathname}`;
    const responses = {
      'GET /api/auth/session': { user, expires: '2099-01-01T00:00:00Z' },
      'GET /api/auth/status': { enabled: false },
      'GET /api/workbench/staffing': { canManageSharedRoles: false, isSuperuser: false },
      'GET /api/workbench/board-writeups': { canRelease: false, canArchive: false, isSuperuser: false, cycles: [] },
      'GET /api/app-access': { apps: ['reviewers'], isSuperuser: false },
      'GET /api/user-profiles': { profiles: [{ id: 1, name: user.name, displayName: user.name, isDefault: true }] },
      'GET /api/user-preferences': { preferences: { _legacy_migration_complete: 'true' } },
      'GET /api/workbench/resolve-request': { success: true, requestId: ID, requestNumber: '1000001', title: 'Synthetic Summary rehearsal', cycleCode: 'J27', phaseLayout: true, programDirectorId: ACTOR, proposalInfo: { pi: 'Synthetic Investigator' }, phaseIStatus: null },
      'GET /api/workbench/reviewer-rollup': { success: true, counts: { candidates: 0, received: 0, completed: 0 }, needed: 3 },
      'GET /api/workbench/initial-assessment-rationale': { rationale: '' },
      'GET /api/workbench/staff-review-summary': { summary: '' },
      'GET /api/workbench/staff-visit-assessment': { assessment: '' },
      'GET /api/workbench/meeting-roster': { presentation: null },
    };
    if (Object.hasOwn(responses, key)) return send(responses[key]);
    if (url.pathname === '/api/workbench/request-narratives' && req.method() === 'GET') {
      expect(url.searchParams.get('requestId')).toBe(ID);
      return send({ success: true, requestId: ID, canEdit: true, version: `W/"${version}"`, lay_abstract: text });
    }
    if (url.pathname === '/api/workbench/request-narratives' && req.method() === 'PATCH') {
      const body = req.postDataJSON();
      expect(body.requestId).toBe(ID);
      expect(Object.keys(body.changes)).toEqual(['lay_abstract']);
      if (body.version !== `W/"${version}"`) return send({ error: 'The request changed. Your draft has been kept. Reload before saving again.' }, 409);
      text = body.changes.lay_abstract || null; version++; writes++;
      return send({ success: true, requestId: ID });
    }
    unexpected.push(key);
    return send({ error: 'Unmocked API refused' }, 503);
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`/workbench/${ID}?tab=overview`);
    const box = page.getByLabel('Executive Summary', { exact: true });
    await expect(box).toHaveValue(text);
    // The normal E2E server uses the legacy shell. A field-ready local server
    // also exercises the J27 shell without changing production settings.
    if (await page.getByRole('button', { name: 'Peer Review', exact: true }).count()) {
      await expect(page.getByRole('heading', { name: 'Initial assessment pending' })).toBeVisible();
      await expect(page.getByText('Request details', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: 'Request snapshot' })).toBeVisible();
    }
    await box.fill('Staff revision\nwith a second line.');
    expect(writes).toBe(0);
    await page.getByRole('button', { name: 'Save request text' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(box).toHaveValue('Staff revision\nwith a second line.');
    await box.fill('');
    await page.getByRole('button', { name: 'Save request text' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(box).toHaveValue('');
    expect(text).toBeNull();
    await box.fill('Keep my draft');
    text = 'Another staff member saved this.'; version++;
    await page.getByRole('button', { name: 'Save request text' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'request changed' })).toContainText('request changed');
    await expect(box).toHaveValue('Keep my draft');
    await expect(box).not.toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save request text' })).toBeDisabled();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Initial Assessment', exact: true }).click();
    await expect(box).toHaveValue('Keep my draft');
    await expect(page).toHaveURL(/tab=overview/);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reload saved text' }).click();
    await expect(box).toHaveValue('Another staff member saved this.');
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
    expect(writes).toBe(2);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: '/tmp/wmkf-executive-summary.png', fullPage: true });
  } finally { await context.close(); }
});
