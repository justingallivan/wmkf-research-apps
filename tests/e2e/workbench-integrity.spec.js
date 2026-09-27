// Browser coverage for the Workbench Integrity tab. Every API call is served
// from fixtures; an unknown API request is aborted and recorded.
const { test, expect } = require('@playwright/test');
const { createRequire } = require('module');
const { encode } = createRequire(__filename)('next-auth/jwt');

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const NEXTAUTH_SECRET = 'e2e-throwaway-nextauth-secret-32-chars';
const INSTITUTION = 'Northwestern Center for Interdisciplinary Biomedical and Translational Research at the University of Example';
const PEOPLE = [{ contactId: '11111111-1111-4111-8111-111111111111', name: 'Ada Integrity Example', institution: INSTITUTION, role: 'PI' }];
const RESULT = {
  name: PEOPLE[0].name,
  institution: INSTITUTION,
  isCommonName: true,
  matchCount: 1,
  hasConcerns: true,
  sources: {
    retraction_watch: { searched: true, matches: [{
      title: 'A retracted public study', matchedAuthor: PEOPLE[0].name, confidence: 92, confidenceLevel: 'high',
      retractionNature: 'Retraction', reasons: ['Data concern'], doi: '10.1000/example',
      urls: 'https://retraction.example/one; https://retraction.example/two',
    }], error: null },
    pubpeer: { searched: true, summary: 'A source summary for human review.', resultCount: 1, hasConcerns: false, rawResults: [{ title: 'Public discussion', link: 'https://pubpeer.com/publication/example' }], error: null },
    news: { searched: false, summary: null, error: 'Fixture: source unavailable' },
  },
};
const RUN = { id: 'run-integrity-e2e', createdAt: '2026-09-26T18:00:00.000Z', screenedNames: [PEOPLE[0].name], results: [RESULT], matchCount: 1, status: 'pending' };

async function installStaffSession(context, baseURL) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const now = Date.now();
  const token = await encode({
    secret: NEXTAUTH_SECRET,
    token: { sub: 'integrity-e2e-user', name: 'Program Director', email: 'pd@example.org', azureId: 'integrity-e2e-azure-id', userType: 'staff', profileId: 1, dynamicsSystemuserId: '22222222-2222-4222-8222-222222222222', lastActivity: now, iat: Math.floor(now / 1000), exp: expires },
  });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: new URL(baseURL).hostname, path: '/', httpOnly: true, sameSite: 'Lax', expires }]);
}

async function installApiFixtures(context) {
  const unexpected = [];
  const runRequests = [];
  let releaseGet;
  const getHeld = new Promise((resolve) => { releaseGet = resolve; });
  let holdGet = true;
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const fulfill = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/auth/status') return fulfill({ enabled: false });
    if (pathname === '/api/auth/session') return fulfill({ user: { name: 'Program Director', email: 'pd@example.org', azureId: 'integrity-e2e-azure-id', userType: 'staff', profileId: 1, dynamicsSystemuserId: '22222222-2222-4222-8222-222222222222' }, expires: new Date(Date.now() + 3600000).toISOString() });
    if (pathname === '/api/app-access') return fulfill({ apps: ['reviewers', 'integrity-screener'], isSuperuser: false });
    if (pathname === '/api/user-profiles') return fulfill({ profiles: [{ id: 1, name: 'Program Director', displayName: 'Program Director', isDefault: true, avatarColor: '#111827' }] });
    if (pathname === '/api/user-preferences') return fulfill({ preferences: {} });
    if (pathname === '/api/workbench/resolve-request') return fulfill({ success: true, requestId: REQUEST_ID, requestNumber: '1002788', title: 'Integrity fixture request', cycleLabel: 'J26', grantProgram: 'Research', institution: INSTITUTION, programDirectorId: '22222222-2222-4222-8222-222222222222' });
    if (pathname === `/api/workbench/integrity/${REQUEST_ID}` && request.method() === 'GET') {
      if (holdGet) await getHeld;
      return fulfill({ requestId: REQUEST_ID, people: PEOPLE, latestRun: null });
    }
    if (pathname === `/api/workbench/integrity/${REQUEST_ID}/run` && request.method() === 'POST') {
      const body = request.postDataJSON();
      runRequests.push(body);
      return fulfill({ requestId: REQUEST_ID, people: PEOPLE, run: RUN });
    }
    unexpected.push(`${request.method()} ${pathname}`);
    return route.abort('blockedbyclient');
  });
  return {
    unexpected,
    runRequests,
    releaseGet() { holdGet = false; releaseGet(); },
  };
}

test('Integrity tab loads, confirms before spending, and renders saved findings responsively', async ({ page, context }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
  await installStaffSession(context, baseURL);
  const fixture = await installApiFixtures(context);
  await page.goto(`${baseURL}/workbench/${REQUEST_ID}?tab=integrity&n=1002788`);

  await expect(page.getByRole('status')).toHaveText('Loading integrity information…');
  fixture.releaseGet();
  await expect(page.getByText(PEOPLE[0].name, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'People to be screened' })).toContainText(INSTITUTION);

  let accepted = false;
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Claude and SerpAPI credits for each person');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Run screen' }).click();
  expect(fixture.runRequests).toHaveLength(0);

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('1 person');
    accepted = true;
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Run screen' }).click();
  await expect(page.getByText('Latest saved screen')).toBeVisible();
  await expect(page.getByText('1 item for human review · Incomplete screen')).toBeVisible();
  await expect(page.getByText('Fixture: source unavailable')).toBeVisible();
  await expect(page.getByText('A retracted public study')).toBeVisible();
  await expect(page.getByText('Common name — verify identity carefully')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Source' }).first()).toHaveAttribute('href', 'https://retraction.example/one');
  await expect(page.getByRole('link', { name: 'Public discussion' })).toHaveAttribute('href', 'https://pubpeer.com/publication/example');
  expect(accepted).toBe(true);
  expect(fixture.runRequests).toEqual([{}]);
  await page.screenshot({ path: '/tmp/integrity-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Run screen' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/integrity-mobile.png', fullPage: true });
  expect(fixture.unexpected).toEqual([]);
});
