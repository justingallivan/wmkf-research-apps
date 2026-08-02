// Browser contract tests for the Workbench Reviewers -> Find warm path.
//
// The dedicated Reviewer Find Playwright config (added by the harness slice)
// runs this file from a credential-free root.  This spec additionally intercepts
// every /api request in the browser context, so it is safe to drive the real UI
// without depending on a live request, staff session, or provider.

const { test, expect } = require('@playwright/test');
const {
  REQUEST_A,
  REQUEST_B,
  candidate,
  currentPlan,
  deferred,
  installReviewerFindMocks,
  installStaffSession,
  json,
  roster,
  workbenchUrl,
} = require('./helpers/reviewer-find-workbench');

function noColdPaths(ledger) {
  return ledger.filter((entry) => /reviewer-finder\/(?:load-proposal|analyze|discover|enrich-contacts)|applicant-reviewers|proposal-documents|download-proposal|claude|provider|blob|email|job/i.test(entry.path));
}

function currentRoster(requestId, rows, version = `${requestId}-current`) {
  return roster({
    requestId,
    authorityState: 'current',
    rosterVersion: version,
    active: rows,
    candidatePlans: rows.map((row) => currentPlan(row.candidateKey)),
  });
}

async function openFind(page, context, testInfo, requestId = REQUEST_A, options = {}) {
  const baseURL = testInfo.project.use.baseURL || 'http://localhost:3101';
  await installStaffSession(context, baseURL);
  const mocks = await installReviewerFindMocks(context, baseURL, options);
  await page.goto(workbenchUrl(baseURL, requestId));
  await expect(page.getByText('Search for reviewers', { exact: true })).toBeVisible();
  return { baseURL, mocks };
}

test.describe('Reviewer Find warm revisit contract', () => {
  test('shows cached candidates before delayed reconciliation and does no cold work', async ({ page, context }, testInfo) => {
    const reviewer = candidate({ name: 'Dr. Cached Before Reconciled' });
    const reconciled = deferred();
    const { mocks } = await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => {
        if (mode === 'cached') return json(200, roster({
          requestId,
          authorityState: 'cached',
          rosterVersion: 'cached-v1',
          active: [reviewer],
          candidatePlans: [currentPlan(reviewer.candidateKey)],
        }));
        return reconciled.promise;
      },
    });

    await expect(page.getByText('Dr. Cached Before Reconciled', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Cached reviewer candidates are display-only while current status is checked.');
    expect(mocks.rosterReads().map((entry) => entry.mode)).toEqual(['cached', 'reconciled']);
    expect(noColdPaths(mocks.ledger)).toEqual([]);
    expect(mocks.unexpected).toEqual([]);
    expect(mocks.external).toEqual([]);

    reconciled.resolve(json(200, currentRoster(REQUEST_A, [reviewer], 'cached-v1')));
    await expect(page.getByRole('status')).toContainText('Reviewer status is current. Roster actions remain disabled in this rollout.');
    await expect(page.getByText('Dr. Cached Before Reconciled', { exact: true })).toBeVisible();
  });

  test('preserves cached cards after reconciliation failure and exposes the exact retry action', async ({ page, context }, testInfo) => {
    const reviewer = candidate({ name: 'Dr. Cached On Authority Error' });
    const { mocks } = await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => {
        if (mode === 'cached') return json(200, roster({
          requestId,
          authorityState: 'cached',
          rosterVersion: 'error-v1',
          active: [reviewer],
          candidatePlans: [currentPlan(reviewer.candidateKey)],
        }));
        return json(503, { success: false, error: 'Fixture authority unavailable' });
      },
    });

    await expect(page.getByText('Dr. Cached On Authority Error', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Reviewer status could not be checked. Cached candidates remain visible but all roster actions are disabled.');
    await expect(page.getByRole('button', { name: 'Retry reviewer status' })).toBeVisible();
    await expect(page.getByLabel('Select Dr. Cached On Authority Error')).toHaveCount(0);
    expect(noColdPaths(mocks.ledger)).toEqual([]);
    expect(mocks.unexpected).toEqual([]);
  });

  test('no-history stays idle until the exact Prepare search action', async ({ page, context }, testInfo) => {
    const { mocks } = await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => {
        if (mode === 'cached') return json(200, roster({ requestId, authorityState: 'cached', rosterVersion: 'empty-v1' }));
        return json(200, currentRoster(requestId, [], 'empty-v1'));
      },
    });

    await expect(page.getByRole('button', { name: 'Prepare search' })).toBeEnabled();
    await expect(page.getByText('Prepare a proposal only when you are ready to search for reviewers. Opening this request does not download or analyze a file.')).toBeVisible();
    await expect(page.getByText('Load a proposal document above to search for new reviewers. Candidates already found for this request appear below.')).toBeVisible();
    expect(noColdPaths(mocks.ledger)).toEqual([]);
    expect(mocks.ledger.filter((entry) => entry.method !== 'GET' && entry.path !== '/api/user-preferences')).toEqual([]);
    expect(mocks.unexpected).toEqual([]);
  });

  test('refreshes one stale inexpensive stage with the target-only request body', async ({ page, context }, testInfo) => {
    const reviewer = candidate({
      candidateKey: 'person:coauthor-stale',
      name: 'Dr. One Stale Coauthor Stage',
      rosterUpdatedAt: '2026-08-02T09:30:00.000Z',
    });
    const stalePlan = currentPlan(reviewer.candidateKey, {
      currentStages: CURRENT_STAGES_WITHOUT('coauthor_coi'),
      refreshes: [{ stage: 'coauthor_coi', reason: 'stage_missing' }],
    });
    const { mocks } = await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => {
        const body = roster({
          requestId,
          authorityState: mode === 'cached' ? 'cached' : 'current',
          rosterVersion: 'targeted-v1',
          active: [reviewer],
          candidatePlans: [stalePlan],
        });
        return json(200, body);
      },
    });

    await expect(page.getByText('Dr. One Stale Coauthor Stage', { exact: true })).toBeVisible();
    const refresh = page.getByRole('button', { name: 'Refresh coauthor COI evidence' });
    await expect(refresh).toBeVisible();
    expect(mocks.stageRefreshes()).toHaveLength(0);

    await refresh.click();
    await expect.poll(() => mocks.stageRefreshes().length).toBe(1);
    expect(mocks.stageRefreshes()[0].body).toEqual({
      requestId: REQUEST_A,
      candidateKey: 'person:coauthor-stale',
      stage: 'coauthor_coi',
      expectedUpdatedAt: '2026-08-02T09:30:00.000Z',
    });
    expect(mocks.unexpected).toEqual([]);
  });

  test('leaves a provider-dependent contact stage idle until its explicit action', async ({ page, context }, testInfo) => {
    const reviewer = candidate({
      candidateKey: 'person:contact-explicit',
      name: 'Dr. Explicit Contact Refresh',
      rosterUpdatedAt: '2026-08-02T10:00:00.000Z',
    });
    const stalePlan = currentPlan(reviewer.candidateKey, {
      currentStages: CURRENT_STAGES_WITHOUT('contact'),
      refreshes: [{ stage: 'contact', reason: 'stage_missing' }],
    });
    const { mocks } = await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => json(200, roster({
        requestId,
        authorityState: mode === 'cached' ? 'cached' : 'current',
        rosterVersion: 'contact-v1',
        active: [reviewer],
        candidatePlans: [stalePlan],
      })),
    });

    const refresh = page.getByRole('button', { name: 'Refresh contact evidence' });
    await expect(refresh).toBeVisible();
    expect(mocks.stageRefreshes()).toHaveLength(0);
    expect(noColdPaths(mocks.ledger)).toEqual([]);

    await refresh.click();
    await expect.poll(() => mocks.stageRefreshes().length).toBe(1);
    expect(mocks.stageRefreshes()[0].body).toMatchObject({
      requestId: REQUEST_A,
      candidateKey: 'person:contact-explicit',
      stage: 'contact',
    });
  });

  test('keeps same-name candidates separate through their authoritative anchors', async ({ page, context }, testInfo) => {
    const one = candidate({ candidateKey: 'person:same-name-one', name: 'Dr. Same Name', affiliation: 'First Fixture University' });
    const two = candidate({ candidateKey: 'person:same-name-two', name: 'Dr. Same Name', affiliation: 'Second Fixture University' });
    const plans = [
      currentPlan(one.candidateKey, {
        currentStages: ['identity'],
        evidenceCheckedDates: { identity: '2026-08-01T12:00:00.000Z' },
      }),
      currentPlan(two.candidateKey, {
        currentStages: ['identity'],
        evidenceCheckedDates: { identity: '2026-07-01T12:00:00.000Z' },
      }),
    ];
    await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => json(200, roster({
        requestId,
        authorityState: mode === 'cached' ? 'cached' : 'current',
        rosterVersion: 'same-name-v1',
        active: [one, two],
        candidatePlans: plans,
      })),
    });

    await expect(page.getByText('Dr. Same Name', { exact: true })).toHaveCount(2);
    await expect(page.getByText('First Fixture University', { exact: true })).toBeVisible();
    await expect(page.getByText('Second Fixture University', { exact: true })).toBeVisible();
    // Next keeps a hidden pre-transition tree briefly during the cached ->
    // reconciled handoff.  The user-visible cards must retain their own date;
    // hidden transition DOM is intentionally not treated as a second reviewer.
    await expect(page.locator('time[datetime="2026-08-01T12:00:00.000Z"]:visible')).toHaveCount(1);
    await expect(page.locator('time[datetime="2026-07-01T12:00:00.000Z"]:visible')).toHaveCount(1);
  });

  test('fails closed for unknown authority and malformed stage-plan complements', async ({ page, context }, testInfo) => {
    const reviewer = candidate({ candidateKey: 'person:unknown-complement', name: 'Dr. Unknown Complement' });
    const malformedPlan = currentPlan(reviewer.candidateKey, {
      currentStages: ['not_a_real_stage'],
      evidenceCheckedDates: {},
    });
    await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => json(200, roster({
        requestId,
        authorityState: mode === 'cached' ? 'cached' : 'not_a_real_authority',
        rosterVersion: 'unknown-v1',
        active: [reviewer],
        candidatePlans: [malformedPlan],
      })),
    });

    await expect(page.getByText('Dr. Unknown Complement', { exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Reviewer authority could not be fully reconciled.' })).toContainText('Retry before taking action.');
    await expect(page.getByText('The reviewer evidence plan was not recognized. Reload reviewer status; this row is read-only until the server plan is available.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload reviewer status' })).toBeVisible();
    await expect(page.getByLabel('Select Dr. Unknown Complement')).toHaveCount(0);
  });

  test('keeps late A responses from contaminating B -> A client navigation', async ({ page, context }, testInfo) => {
    const oldAReconciliation = deferred();
    const firstA = candidate({ name: 'Dr. Old A Response' });
    const freshA = candidate({ name: 'Dr. Fresh A Response' });
    const reviewerB = candidate({ name: 'Dr. Request B Reviewer', candidateKey: 'person:request-b' });
    let aCachedReads = 0;
    const { mocks } = await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => {
        if (requestId === REQUEST_A && mode === 'cached') {
          aCachedReads += 1;
          const rows = aCachedReads === 1 ? [firstA] : [freshA];
          return json(200, roster({
            requestId,
            authorityState: 'cached',
            rosterVersion: aCachedReads === 1 ? 'a-old' : 'a-fresh',
            active: rows,
            candidatePlans: rows.map((row) => currentPlan(row.candidateKey)),
          }));
        }
        if (requestId === REQUEST_A && mode === 'reconciled' && aCachedReads === 1) return oldAReconciliation.promise;
        if (requestId === REQUEST_A) return json(200, currentRoster(requestId, [freshA], 'a-fresh'));
        if (requestId === REQUEST_B && mode === 'cached') return json(200, roster({
          requestId,
          authorityState: 'cached',
          rosterVersion: 'b-v1',
          active: [reviewerB],
          candidatePlans: [currentPlan(reviewerB.candidateKey)],
        }));
        return json(200, currentRoster(requestId, [reviewerB], 'b-v1'));
      },
    });

    await expect(page.getByText('Dr. Old A Response', { exact: true })).toBeVisible();
    await page.getByText('← Back to dashboard', { exact: true }).click();
    await expect(page.getByText('#1000002', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /#1000002/i }).click();
    await expect(page).toHaveURL(new RegExp(`/workbench/${REQUEST_B}\\?tab=reviewers&n=1000002$`));
    await expect(page.getByText('Dr. Request B Reviewer', { exact: true })).toBeVisible();

    await page.getByText('← Back to dashboard', { exact: true }).click();
    await page.getByRole('button', { name: /#1000001/i }).click();
    await expect(page).toHaveURL(new RegExp(`/workbench/${REQUEST_A}\\?tab=reviewers&n=1000001$`));
    await expect(page.getByText('Dr. Fresh A Response', { exact: true })).toBeVisible();

    oldAReconciliation.resolve(json(200, currentRoster(REQUEST_A, [firstA], 'a-old')));
    await page.waitForTimeout(50);
    await expect(page.getByText('Dr. Fresh A Response', { exact: true })).toBeVisible();
    await expect(page.getByText('Dr. Old A Response', { exact: true })).toHaveCount(0);
    expect(mocks.unexpected).toEqual([]);
  });

  test('restarts after one roster snapshot conflict and latches after the second', async ({ page, context }, testInfo) => {
    const cached = candidate({ name: 'Dr. Initial Snapshot' });
    const fresh = candidate({ name: 'Dr. First Conflict Snapshot' });
    const freshest = candidate({ name: 'Dr. Second Conflict Snapshot' });
    let reconciledCalls = 0;
    const { mocks } = await openFind(page, context, testInfo, REQUEST_A, {
      rosterHandler: async ({ requestId, mode }) => {
        if (mode === 'cached') return json(200, roster({
          requestId,
          authorityState: 'cached',
          rosterVersion: 'snapshot-v1',
          active: [cached],
          candidatePlans: [currentPlan(cached.candidateKey)],
        }));
        reconciledCalls += 1;
        if (reconciledCalls === 1) return json(409, roster({
          requestId,
          authorityState: 'cached',
          rosterVersion: 'snapshot-v2',
          active: [fresh],
          candidatePlans: [currentPlan(fresh.candidateKey)],
          success: false,
          code: 'roster_snapshot_changed',
        }));
        return json(409, roster({
          requestId,
          authorityState: 'cached',
          rosterVersion: 'snapshot-v3',
          active: [freshest],
          candidatePlans: [currentPlan(freshest.candidateKey)],
          success: false,
          code: 'roster_snapshot_changed',
        }));
      },
    });

    await expect(page.getByText('Dr. Second Conflict Snapshot', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Reviewer roster changed again while checking current status. Retry to check this latest snapshot.');
    await expect(page.getByRole('button', { name: 'Retry reviewer status' })).toBeVisible();
    expect(mocks.rosterReads().filter((entry) => entry.mode === 'cached')).toHaveLength(1);
    expect(mocks.rosterReads().filter((entry) => entry.mode === 'reconciled')).toHaveLength(2);
  });
});

// Keep this local helper in the spec so each stale plan names exactly the stage
// it withholds.  The complement is explicit: all remaining stages are current.
function CURRENT_STAGES_WITHOUT(stage) {
  return [
    'applicant_anchor',
    'identity',
    'institution_domains',
    'institution_coi',
    'coauthor_coi',
    'eligibility',
    'contact',
    'address_trust',
    'roster_persistence',
  ].filter((value) => value !== stage);
}
