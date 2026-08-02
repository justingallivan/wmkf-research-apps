// Deterministic browser fixtures for the Workbench Reviewer Find panel.
//
// These fixtures deliberately use fictitious people and opaque request IDs.  They
// intercept every application API request in the browser context so the real
// Next.js page/components can run without reaching Dataverse, Postgres, Graph,
// proposal storage, providers, email, or background jobs.

const { createRequire } = require('module');

const requireFromHere = createRequire(__filename);
const { encode } = requireFromHere('next-auth/jwt');

// Keep this exactly aligned with the isolated launcher.  It is a fixed,
// non-production test secret; no developer or deployed session is reused.
const NEXTAUTH_SECRET = 'reviewer-find-e2e-throwaway-nextauth-secret-32-chars';
const REQUEST_A = '10000000-0000-4000-8000-000000000001';
const REQUEST_B = '20000000-0000-4000-8000-000000000002';
const REQUEST_NUMBERS = Object.freeze({
  [REQUEST_A]: '1000001',
  [REQUEST_B]: '1000002',
});

const CURRENT_STAGES = Object.freeze([
  'applicant_anchor',
  'identity',
  'institution_domains',
  'institution_coi',
  'coauthor_coi',
  'eligibility',
  'contact',
  'address_trust',
  'roster_persistence',
]);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function json(status, body) {
  return { status, body };
}

function currentPlan(candidateKey, overrides = {}) {
  return {
    candidateKey,
    cacheOutcome: 'hit',
    promotionAuthority: 'requires_promotion_checks',
    currentStages: [...CURRENT_STAGES],
    pendingStages: [],
    refreshes: [],
    evidenceCheckedDates: {
      identity: '2026-08-01T12:00:00.000Z',
      contact: '2026-08-01T12:00:00.000Z',
    },
    ...overrides,
  };
}

function candidate({
  candidateKey = 'person:reviewer-one',
  name = 'Dr. Fixture Reviewer',
  affiliation = 'Fixture University',
  email = 'fixture.reviewer@example.test',
  rosterUpdatedAt = '2026-08-02T09:00:00.000Z',
  ...overrides
} = {}) {
  return {
    candidateKey,
    name,
    affiliation,
    email,
    identityStatus: 'probable',
    verificationStatus: 'probable',
    verificationConfidence: 0.92,
    rosterUpdatedAt,
    publications: [],
    provenance: {
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: [],
    },
    ...overrides,
  };
}

function roster({
  requestId = REQUEST_A,
  authorityState = 'current',
  rosterVersion = 'fixture-roster-v1',
  active = [],
  excluded = [],
  ineligible = [],
  blocked = [],
  handled = [],
  candidatePlans = active.map((row) => currentPlan(row.candidateKey)),
  ...overrides
} = {}) {
  return {
    success: true,
    requestId,
    authorityState,
    rosterVersion,
    active,
    excluded,
    ineligible,
    blocked,
    handled,
    savedKeys: [],
    allNames: [...active, ...excluded, ...ineligible, ...blocked, ...handled]
      .map((row) => row.name)
      .filter(Boolean),
    warmValidation: {
      state: authorityState === 'current' ? 'current' : 'cached',
      candidatePlans,
    },
    ...overrides,
  };
}

function workbenchUrl(baseURL, requestId, sub = 'find') {
  return new URL(
    `/workbench/${requestId}?tab=reviewers&sub=${sub}&n=${REQUEST_NUMBERS[requestId]}`,
    baseURL,
  ).toString();
}

async function installStaffSession(context, baseURL) {
  const expires = Math.floor(Date.now() / 1000) + (60 * 60);
  const token = await encode({
    secret: NEXTAUTH_SECRET,
    token: {
      sub: 'reviewer-find-e2e-staff',
      name: 'Reviewer Find Test Staff',
      email: 'reviewer-find-staff@example.test',
      azureId: 'reviewer-find-e2e-azure-id',
      userType: 'staff',
      dynamicsSystemuserId: '30000000-0000-4000-8000-000000000003',
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

function normalizePath(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function requestContext(requestId) {
  return {
    requestId,
    requestNumber: REQUEST_NUMBERS[requestId] || '1000999',
    title: requestId === REQUEST_B
      ? 'Fixture B: Reviewer Find Isolation'
      : 'Fixture A: Reviewer Find Isolation',
    cycleLabel: 'Browser test cycle',
    grantProgram: 'Research',
    institution: 'Fixture University',
    programDirectorId: '30000000-0000-4000-8000-000000000003',
  };
}

/**
 * Install strict, browser-side Workbench routes.
 *
 * `rosterHandler` receives `{ requestId, mode, rosterVersion, route }` and
 * returns either `{ status, body }` or a promise resolving to that shape.  It
 * is intentionally the only mutable scenario seam; all other app API calls are
 * either fixed harmless fixtures or failures.
 */
async function installReviewerFindMocks(context, baseURL, {
  rosterHandler,
  stageRefreshHandler = null,
} = {}) {
  const base = new URL(baseURL);
  const ledger = [];
  const unexpected = [];
  const external = [];

  const record = (route, extra = {}) => {
    const request = route.request();
    const parsed = new URL(request.url());
    const entry = {
      method: request.method(),
      path: `${parsed.pathname}${parsed.search}`,
      ...extra,
    };
    ledger.push(entry);
    return entry;
  };
  const fulfill = async (route, result) => {
    const normalized = result || json(500, { error: 'Reviewer Find fixture returned no response' });
    await route.fulfill({
      status: normalized.status || 200,
      contentType: 'application/json',
      body: JSON.stringify(normalized.body || {}),
    });
  };

  // Register broad guards first: Playwright routes are last-in-first-matched,
  // so the specific fixtures registered below win.  Static Next assets continue;
  // unknown APIs fail locally instead of falling through to the real server.
  await context.route('**/*', async (route) => {
    const target = new URL(route.request().url());
    if (target.origin !== base.origin) {
      external.push({ method: route.request().method(), url: route.request().url() });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await context.route('**/api/**', async (route) => {
    const entry = record(route, { unexpected: true });
    unexpected.push(entry);
    await fulfill(route, json(500, { error: `Unexpected Reviewer Find fixture API: ${entry.path}` }));
  });

  await context.route('**/api/auth/status', (route) => fulfill(route, json(200, { enabled: false })));
  await context.route('**/api/auth/session', (route) => fulfill(route, json(200, {
    user: {
      name: 'Reviewer Find Test Staff',
      email: 'reviewer-find-staff@example.test',
      userType: 'staff',
      dynamicsSystemuserId: '30000000-0000-4000-8000-000000000003',
    },
    expires: '2099-01-01T00:00:00.000Z',
  })));
  await context.route('**/api/app-access', (route) => fulfill(route, json(200, {
    apps: ['reviewers'], isSuperuser: true,
  })));
  await context.route('**/api/user-profiles', (route) => fulfill(route, json(200, {
    profiles: [{
      id: 1,
      name: 'Reviewer Find Test Staff',
      displayName: 'Reviewer Find Test Staff',
      isDefault: true,
      avatarColor: '#111827',
    }],
  })));
  await context.route('**/api/user-preferences**', async (route) => {
    record(route);
    if (route.request().method() === 'POST') return fulfill(route, json(200, { success: true }));
    const url = new URL(route.request().url());
    if (url.searchParams.get('key')) return fulfill(route, json(200, { value: '' }));
    return fulfill(route, json(200, { preferences: { email_signature: '' } }));
  });
  // The shared shell renders its alert-summary affordance on every staff page.
  // This is a known layout read, not Reviewer Find work; keep it fixture-local
  // so the strict catch-all still rejects every other unlisted API route.
  await context.route('**/api/admin/alerts**', async (route) => {
    record(route);
    return fulfill(route, json(200, { alerts: [], summary: { unread: 0 } }));
  });

  await context.route('**/api/workbench/dashboard**', async (route) => {
    record(route);
    const url = new URL(route.request().url());
    if (!url.searchParams.get('cycleCode')) {
      return fulfill(route, json(200, {
        cycles: [{ code: 'BROWSER', label: 'Browser test cycle', count: 2 }],
        defaultCycleCode: 'BROWSER',
      }));
    }
    return fulfill(route, json(200, {
      proposals: [REQUEST_A, REQUEST_B].map((requestId) => ({
        ...requestContext(requestId),
        projectLeader: 'Fixture PI',
        programDirector: 'Reviewer Find Test Staff',
        reviewers: [],
        workRemaining: 'find',
        canManage: false,
        advancing: true,
        setAside: false,
      })),
      rollup: { total: 2, stages: { find: 2 } },
    }));
  });
  await context.route('**/api/workbench/resolve-request**', async (route) => {
    const url = new URL(route.request().url());
    const requestId = url.searchParams.get('requestId');
    record(route, { requestId });
    return fulfill(route, json(200, requestContext(requestId)));
  });
  await context.route('**/api/review-manager/reviewers**', async (route) => {
    const url = new URL(route.request().url());
    const requestId = url.searchParams.get('proposalId');
    record(route, { requestId });
    return fulfill(route, json(200, {
      success: true,
      proposals: [{ proposalId: requestId, proposalTitle: requestContext(requestId).title, reviewers: [] }],
    }));
  });
  await context.route('**/api/reviewer-finder/my-candidates**', async (route) => {
    const url = new URL(route.request().url());
    const requestId = url.searchParams.get('requestId');
    record(route, { requestId });
    return fulfill(route, json(200, { proposals: [{ proposalId: requestId, candidates: [], removedCandidates: [] }] }));
  });
  await context.route('**/api/workbench/decline-referrals**', async (route) => {
    const url = new URL(route.request().url());
    record(route, { requestId: url.searchParams.get('requestId') });
    return fulfill(route, json(200, { referrals: [] }));
  });
  await context.route('**/api/workbench/reviewer-roster**', async (route) => {
    const url = new URL(route.request().url());
    const requestId = url.searchParams.get('requestId');
    const mode = url.searchParams.get('mode');
    const entry = record(route, {
      requestId,
      mode,
      rosterVersion: url.searchParams.get('rosterVersion'),
    });
    if (route.request().method() !== 'GET' || !['cached', 'reconciled'].includes(mode)) {
      unexpected.push({ ...entry, unexpected: true });
      return fulfill(route, json(500, { error: 'Unexpected Reviewer Find roster operation' }));
    }
    try {
      const result = await rosterHandler?.({
        requestId,
        mode,
        rosterVersion: url.searchParams.get('rosterVersion'),
        route,
      });
      return fulfill(route, result);
    } catch (error) {
      // A route intentionally held across client navigation may be cancelled by
      // the browser.  It is no longer a product failure and must not turn into a
      // fixture fall-through; all other handler failures remain visible.
      if (/target page|context.*closed|request.*interrupted/i.test(String(error?.message || error))) return;
      throw error;
    }
  });
  await context.route('**/api/workbench/reviewer-stage-refresh', async (route) => {
    const body = route.request().postDataJSON();
    record(route, { body });
    if (route.request().method() !== 'POST') {
      unexpected.push({ method: route.request().method(), path: normalizePath(route.request().url()), unexpected: true });
      return fulfill(route, json(500, { error: 'Unexpected reviewer-stage-refresh method' }));
    }
    const result = stageRefreshHandler
      ? await stageRefreshHandler({ body, route })
      : json(200, {
        outcome: 'recorded',
        candidateKey: body.candidateKey,
        requestedStage: body.stage,
        stageState: 'current',
        reasonCode: null,
      });
    return fulfill(route, result);
  });

  return {
    ledger,
    unexpected,
    external,
    paths: () => ledger.map((entry) => entry.path),
    rosterReads: () => ledger.filter((entry) => entry.path.startsWith('/api/workbench/reviewer-roster')),
    stageRefreshes: () => ledger.filter((entry) => entry.path === '/api/workbench/reviewer-stage-refresh'),
  };
}

module.exports = {
  NEXTAUTH_SECRET,
  REQUEST_A,
  REQUEST_B,
  REQUEST_NUMBERS,
  CURRENT_STAGES,
  candidate,
  currentPlan,
  deferred,
  installReviewerFindMocks,
  installStaffSession,
  json,
  roster,
  workbenchUrl,
};
