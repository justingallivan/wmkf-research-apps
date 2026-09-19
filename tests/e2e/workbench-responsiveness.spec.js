// Browser characterization for the Workbench responsiveness migration.
//
// Every /api request is handled here. Unknown API paths abort and are reported
// by the test, so these journeys cannot silently reach a live service.

const { test, expect } = require('@playwright/test');
const { createRequire } = require('module');

const requireFromHere = createRequire(__filename);
const { encode } = requireFromHere('next-auth/jwt');

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const NEXTAUTH_SECRET = 'e2e-throwaway-nextauth-secret-32-chars';
const PROGRAM_ID = '11111111-1111-4111-8111-111111111111';
const CYCLE = 'J26';

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function installStaffSession(context, baseURL) {
  const expires = Math.floor(Date.now() / 1000) + (60 * 60);
  const token = await encode({
    secret: NEXTAUTH_SECRET,
    token: {
      sub: 'workbench-responsiveness-e2e',
      name: 'Program Director',
      email: 'program.director@example.org',
      azureId: 'workbench-responsiveness-azure-id',
      userType: 'staff',
      profileId: 1,
      dynamicsSystemuserId: '77777777-7777-4777-8777-777777777777',
      lastActivity: Date.now(),
      iat: Math.floor(Date.now() / 1000),
      exp: expires,
    },
  });
  await context.addCookies([{
    name: 'next-auth.session-token',
    value: token,
    domain: new URL(baseURL).hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    expires,
  }]);
}

function contextBody(requestId = REQUEST_ID) {
  return {
    requestId,
    requestNumber: '1002788',
    title: 'A Study of Workbench Responsiveness',
    cycleLabel: 'June 2026',
    grantProgram: 'Research',
    institution: 'Example University',
    programDirectorId: '77777777-7777-4777-8777-777777777777',
    proposalInfo: { pi: 'Dr. Baseline', coPIs: [], requestedAmount: 1000, totalProjectBudget: 2000, abstract: 'Baseline proposal.' },
    aiContent: {},
  };
}

function rows(label = 'Baseline request') {
  return [{
    requestId: REQUEST_ID,
    requestNumber: '1002788',
    cycleLabel: 'June 2026',
    grantProgram: 'Research',
    institution: 'Example University',
    projectLeader: 'Dr. Baseline',
    programDirector: 'Program Director',
    workRemaining: 'find',
    reviewers: [],
    canManage: true,
    isMine: true,
    title: label,
    setAside: false,
    advancing: false,
  }];
}

async function installApiFixture(page, {
  holdCycleRows = false,
  holdCycles = false,
  holdContext = false,
  cycleRows = rows(),
} = {}) {
  const requests = [];
  const unexpected = [];
  let cycleRowsCount = 0;
  let contextReads = 0;
  let releaseCycleRows;
  let releaseContext;
  let releaseCycles;
  const cycleRowsReady = new Promise((resolve) => { releaseCycleRows = resolve; });
  const contextReady = new Promise((resolve) => { releaseContext = resolve; });
  const cyclesReady = new Promise((resolve) => { releaseCycles = resolve; });

  await page.context().route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push({ path, url: `${path}${url.search}`, method: request.method(), at: Date.now() });
    const fulfill = (body, status = 200) => route.fulfill(json(body, status));

    if (path === '/api/auth/status') return fulfill({ enabled: false });
    if (path === '/api/auth/session') {
      return fulfill({ user: {
        name: 'Program Director', email: 'program.director@example.org', userType: 'staff', profileId: 1,
        dynamicsSystemuserId: '77777777-7777-4777-8777-777777777777',
      }, expires: new Date(Date.now() + 3600000).toISOString() });
    }
    if (path === '/api/app-access') return fulfill({ apps: ['reviewers'], isSuperuser: false });
    if (path === '/api/user-profiles') {
      return fulfill({ profiles: [{ id: 1, name: 'Program Director', displayName: 'Program Director', isDefault: true, avatarColor: '#111827' }] });
    }
    if (path === '/api/user-preferences') {
      return fulfill({ preferences: { email_signature: JSON.stringify({ signature: 'Program Director Signature' }) } });
    }
    if (path === '/api/workbench/dashboard') {
      const hasCycle = url.searchParams.has('cycleCode');
      if (!hasCycle) {
        if (holdCycles) await cyclesReady;
        return fulfill({ success: true, programId: PROGRAM_ID, defaultCycleCode: CYCLE, programs: [{ programId: PROGRAM_ID, name: 'Research' }], cycles: [{ code: CYCLE, label: 'June 2026', myCount: 1, mySetAsideCount: 0 }] });
      }
      cycleRowsCount += 1;
      if (holdCycleRows && cycleRowsCount > 1) await cycleRowsReady;
      return fulfill({ success: true, programId: PROGRAM_ID, cycleCode: CYCLE, scope: url.searchParams.get('scope') || 'my', proposals: cycleRows, rollup: { total: cycleRows.length, stages: { find: cycleRows.length } } });
    }
    if (path === '/api/workbench/triage' && request.method() === 'POST') return fulfill({ success: true });
    if (path === '/api/workbench/resolve-request') {
      contextReads += 1;
      if (holdContext) await contextReady;
      return fulfill(contextBody(url.searchParams.get('requestId') || REQUEST_ID));
    }
    if (path === '/api/workbench/reviewer-rollup') return fulfill({ success: true, counts: { candidates: 2, invited: 1, accepted: 1, completed: 0 }, needed: 2, hint: 'One reviewer still needed.' });
    if (path === '/api/workbench/proposal-documents') return fulfill({
      success: true,
      reviewerMaterials: [],
      aiMaterials: [],
      slots: [],
      phaseIIDocuments: [{ library: 'Proposal', folder: 'Phase II', name: 'baseline.pdf', url: 'https://example.invalid/baseline.pdf' }],
      otherDocuments: [],
      errors: [],
    });
    if (path === '/api/workbench/consultant-feedback') return fulfill({ success: true, feedback: [], consultants: [] });
    if (path === '/api/workbench/consultant-feedback/consultants') return fulfill({ success: true, consultants: [] });

    unexpected.push(`${request.method()} ${path}${url.search}`);
    await route.abort('blockedbyclient');
  });

  return {
    requests,
    unexpected,
    releaseCycleRows: () => releaseCycleRows(),
    releaseContext: () => releaseContext(),
    releaseCycles: () => releaseCycles(),
    counts: () => ({ cycleRowsCount, contextReads }),
  };
}

test.describe('Workbench responsiveness baseline characterization', () => {
  test('request list baseline waterfalls cycle metadata before rows and blanks during triage refresh', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const fixture = await installApiFixture(page, { holdCycleRows: true, holdCycles: true });

    await page.goto(`${baseURL}/workbench?programId=${PROGRAM_ID}&cycleCode=${CYCLE}`);
    await expect.poll(() => fixture.requests.some((entry) => entry.path === '/api/workbench/dashboard')).toBe(true);
    await expect(page.getByText('Loading…')).toBeVisible();
    expect(fixture.counts().cycleRowsCount).toBe(0);
    fixture.releaseCycles();
    await expect(page.getByText('#1002788')).toBeVisible();

    await page.locator('select[title="Set triage status"]').selectOption('advancing');
    await expect(page.getByText('Loading…')).toBeVisible();
    await expect(page.getByText('#1002788')).toBeHidden();
    fixture.releaseCycleRows();
    await expect(page.getByText('#1002788')).toBeVisible();
    expect(fixture.counts().cycleRowsCount).toBe(2);
    expect(fixture.requests.filter((entry) => entry.path === '/api/workbench/triage')).toHaveLength(1);
    expect(fixture.requests.filter((entry) => entry.path === '/api/workbench/dashboard' && !entry.url.includes('cycleCode='))).toHaveLength(1);
    expect(fixture.unexpected).toEqual([]);
  });

  test('request context baseline holds Overview rollup and Proposal documents behind context', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const fixture = await installApiFixture(page, { holdContext: true });

    await page.goto(`${baseURL}/workbench/${REQUEST_ID}?tab=overview&n=1002788`);
    await expect(page.getByText('Loading overview…')).toBeVisible();
    await expect.poll(() => fixture.counts().contextReads).toBe(1);
    await expect.poll(() => fixture.requests.some((entry) => entry.path === '/api/workbench/reviewer-rollup')).toBe(false);

    const proposalPage = await context.newPage();
    await proposalPage.goto(`${baseURL}/workbench/${REQUEST_ID}?tab=proposal&n=1002788`);
    await expect(proposalPage.getByText('Loading proposal…')).toBeVisible();
    await expect.poll(() => fixture.counts().contextReads).toBe(2);
    await expect.poll(() => fixture.requests.some((entry) => entry.path === '/api/workbench/proposal-documents')).toBe(false);

    fixture.releaseContext();
    await expect(page.getByText('One reviewer still needed.')).toBeVisible();
    await expect(proposalPage.getByText('baseline.pdf')).toBeVisible();

    expect(fixture.requests.filter((entry) => entry.path === '/api/workbench/reviewer-rollup')).toHaveLength(1);
    expect(fixture.requests.filter((entry) => entry.path === '/api/workbench/proposal-documents')).toHaveLength(1);
    expect(fixture.unexpected).toEqual([]);
  });
});
