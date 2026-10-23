// Exercises the real Workbench and reviewer portal with request-scoped rehearsal
// fixtures. Every API response is intercepted before reaching the local server.
const { test, expect } = require('@playwright/test');
const { createRequire } = require('module');
const { readFileSync } = require('fs');
const path = require('path');
const requireFromHere = createRequire(__filename);
const { encode } = requireFromHere('next-auth/jwt');
const { browserRequestDecision } = requireFromHere('../../scripts/lib/reviewer-rehearsal-launcher.cjs');
const { reviewFormSchema } = requireFromHere('../../lib/external/review-form-schema');
const QUESTION_SET = reviewFormSchema.fields;
const {
  PD_EMAIL,
  PD_ID,
  REQUEST_ID,
  REQUEST_NUM,
  REVIEW_TOKEN,
  SCENARIOS,
  installMocks,
  isMockedPassiveRequest,
  isMockedApiRequest,
} = requireFromHere('../../scripts/lib/reviewer-rehearsal-fixtures.cjs');

const PROGRAM_DIRECTOR_SYSTEMUSER_ID = PD_ID;
const NEXTAUTH_SECRET = 'e2e-throwaway-nextauth-secret-32-chars';

async function installStaffSession(context, baseURL) {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = await encode({
    secret: NEXTAUTH_SECRET,
    token: {
      sub: 'pd-e2e-user',
      name: 'Program Director',
      email: PD_EMAIL,
      azureId: 'pd-e2e-azure-id',
      userType: 'staff',
      profileId: 1,
      dynamicsSystemuserId: PROGRAM_DIRECTOR_SYSTEMUSER_ID,
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

async function installBoundary(context, baseURL, fixture) {
  const origin = new URL(baseURL).origin;
  // This is installed last, so allowed fixture API requests fall through only
  // to the exact method/path mock; all other API and cross-origin traffic stops.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const decision = browserRequestDecision(
      request.url(),
      origin,
      isMockedApiRequest(request, { baseUrl: baseURL, scenario: fixture.state.scenario }),
      request.method(),
      isMockedPassiveRequest(request, { baseUrl: baseURL, buildId: fixture.state.buildId }),
    );
    if (!decision.allow) {
      fixture.state.violations.push(`${request.method()} ${url.pathname} blocked by rehearsal boundary: ${decision.reason}`);
      return route.abort();
    }
    return route.fallback();
  });
}

function workbenchUrl(baseURL, sub = 'candidates') {
  return new URL(`/workbench/${REQUEST_ID}?tab=reviewers&sub=${sub}&n=${REQUEST_NUM}`, baseURL).toString();
}

async function prepare(page, context, testInfo, scenario) {
  const configuredBaseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
  const configured = new URL(configuredBaseURL);
  if (!['localhost', '127.0.0.1'].includes(configured.hostname)) throw new Error('review_rehearsal_requires_loopback_base_url');
  configured.hostname = '127.0.0.1';
  const baseURL = configured.toString().replace(/\/$/, '');
  const buildId = readFileSync(path.join(__dirname, '../../.next/BUILD_ID'), 'utf8').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(buildId)) throw new Error('review_rehearsal_build_id_invalid');
  await installStaffSession(context, baseURL);
  const fixture = installMocks(context, { baseUrl: baseURL, buildId, scenario });
  await installBoundary(context, baseURL, fixture);
  return { baseURL, fixture };
}

async function acknowledgePolicies(page) {
  const triggers = page.getByRole('button', { name: /read policy/i });
  for (let index = 0; index < 2; index += 1) {
    await triggers.first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /i have read and acknowledge/i }).click();
    await expect(dialog).toBeHidden();
  }
}

async function acceptBoardIdentity(page) {
  await page.getByLabel('Academic rank').fill('Professor');
  await page.getByLabel('Primary department').fill('Synthetic Department');
  await page.getByLabel('Main institution').fill('Example University');
}

async function sendInvitation(page, reviewerName) {
  await page.getByLabel(`Select ${reviewerName}`).check();
  await page.getByRole('button', { name: /send invitation \(1\)/i }).click();
  await expect(page.getByText('Invite reviewers (1)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /reviewer campaign timeline/i }).click();
  await page.getByLabel('Days to respond').fill('7');
  await page.getByLabel('Proposals released to reviewers').fill('2099-07-15');
  await page.getByLabel('Reviews due').fill('2099-07-22');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Send 1 invitation' }).click();
}

test.describe('private reviewer rehearsal edge fixtures', () => {
  test('Workbench landing page opens the synthetic request row through the exact document route', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.BASELINE);
    await page.goto(workbenchUrl(baseURL));
    await page.getByRole('link', { name: '← Back to Workbench' }).click();
    await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible();
    const requestLink = page.getByRole('link', { name: '#1002788', exact: true });
    await expect(requestLink).toBeVisible();
    await requestLink.click();
    await expect(page).toHaveURL(new RegExp(`/workbench/${REQUEST_ID}\\?tab=reviewers&n=${REQUEST_NUM}`));
    await expect(page.getByRole('button', { name: /track reviewers/i })).toBeVisible();
    await expect(page.getByText('Dr. Accepted Reviewer')).toBeVisible();
    await page.getByRole('button', { name: /^Invite Reviewers/ }).first().click();
    await expect(page.getByText('Dr. Saved Reviewer')).toBeVisible();
    expect(fixture.state.calls.filter((call) => call.pathname === '/api/workbench/dashboard').length).toBeGreaterThanOrEqual(2);
    expect(fixture.state.violations).toEqual([]);
  });

  test('campaign settings save 7 to 10, reopen, and rehydrate after reload', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.BASELINE);
    await page.goto(workbenchUrl(baseURL));
    await page.getByRole('button', { name: /campaign settings/i }).click();
    await expect(page.getByText('Campaign settings', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Days to respond')).toHaveValue('7');
    await page.getByLabel('Days to respond').fill('10');
    await page.getByLabel('Review due date').fill('2099-08-15');
    await page.getByLabel('Reviewer quota').fill('4');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Campaign settings', { exact: true })).toBeHidden();
    expect(fixture.state.campaignConfig).toMatchObject({ respondOffsetDays: 10, reviewDueDate: '2099-08-15', desiredCount: 4 });

    await page.getByRole('button', { name: /campaign settings/i }).click();
    await expect(page.getByLabel('Days to respond')).toHaveValue('10');
    await expect(page.getByLabel('Review due date')).toHaveValue('2099-08-15');
    await page.reload();
    await page.getByRole('button', { name: /campaign settings/i }).click();
    await expect(page.getByLabel('Days to respond')).toHaveValue('10');
    await expect(page.getByLabel('Review due date')).toHaveValue('2099-08-15');
    await expect(page.getByLabel('Reviewer quota')).toHaveValue('4');
    expect(fixture.state.calls.filter((call) => call.pathname === '/api/review-manager/campaign-config' && call.method === 'GET').length).toBeGreaterThanOrEqual(3);
    expect(fixture.state.violations).toEqual([]);
  });

  test('pending withdrawal is reflected in candidate status after reload', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.BASELINE);
    await page.goto(workbenchUrl(baseURL, 'candidates'));
    const pendingRow = page.getByRole('listitem').filter({ hasText: 'Dr. Pending Reviewer' });
    await expect(pendingRow).toBeVisible();
    await page.getByLabel('Select Dr. Pending Reviewer').check();
    await page.getByRole('button', { name: 'Release invitee (1)', exact: true }).click();
    await page.getByRole('radio', { name: 'No longer needed' }).check();
    await expect(page.getByRole('button', { name: 'Release (1)', exact: true })).toBeEnabled();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Release (1)', exact: true }).click();
    await expect(pendingRow).toContainText('Released — no longer needed');
    expect(fixture.state.candidateRows.find((row) => row.name === 'Dr. Pending Reviewer')).toMatchObject({ responseType: 'withdrawn_sufficient' });
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: 'Dr. Pending Reviewer' })).toContainText('Released — no longer needed');
    expect(fixture.state.violations).toEqual([]);
  });

  test('reviewer authoring autosaves, rehydrates, submits, and stays read-only on return', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.REVIEWER_AUTHORING);
    const url = new URL(`/external/review/${REVIEW_TOKEN}`, baseURL).toString();
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Submit your review', level: 2 })).toBeVisible();

    const firstRichText = QUESTION_SET.find((field) => field.type === 'richtext');
    await page.getByLabel(firstRichText.label).fill('A synthetic answer saved before returning.');
    await expect.poll(() => fixture.state.reviewDraft?.[firstRichText.key], { timeout: 5000 })
      .toContain('A synthetic answer saved before returning.');
    await page.reload();
    await expect(page.getByLabel(firstRichText.label)).toContainText('A synthetic answer saved before returning.');

    for (const field of QUESTION_SET) {
      if (!field.required) continue;
      if (field.type === 'richtext') {
        await page.getByLabel(field.label).fill(`Synthetic answer for ${field.key}.`);
      } else if (field.type === 'picklist') {
        await page.getByLabel(field.options[0].label).check();
      } else if (field.type === 'multiselect') {
        await page.getByLabel(field.options[0].label).check();
      } else if (field.type === 'string') {
        await page.getByLabel(field.label).fill(`Synthetic ${field.label}.`);
      }
    }

    const submittedSetVersion = fixture.state.reviewerContext.questionSetVersion;
    await page.getByRole('button', { name: 'Submit review' }).click();
    await expect(page.getByText('Review received')).toBeVisible();
    expect(fixture.state.reviewSubmit.setVersion).toBe(submittedSetVersion);
    expect(fixture.state.reviewSubmit.answers[firstRichText.key]).toContain('Synthetic answer for');
    expect(fixture.state.reviewDraft).toBeNull();
    expect(fixture.state.reviewerContext.submission).toEqual({ receivedAt: '2099-06-30T12:05:00Z', filename: null });
    await expect(page.locator('.ProseMirror')).toHaveCount(0);

    await page.reload();
    await expect(page.getByText('Thank you for submitting your review. If you need to correct or add anything, please contact your Program Director.', { exact: true })).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit review' })).toHaveCount(0);
    const finalDraft = await page.evaluate(async (token) => {
      const response = await fetch(`/api/external/review/${token}/draft`);
      return { status: response.status, body: await response.json() };
    }, REVIEW_TOKEN);
    expect(finalDraft).toEqual({ status: 200, body: { ok: true, draftJson: null, submitted: true } });
    const lockedDraft = await page.evaluate(async (token) => {
      const response = await fetch(`/api/external/review/${token}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftJson: { foreseenImpacts: '<p>too late</p>' } }),
      });
      return { status: response.status, body: await response.json() };
    }, REVIEW_TOKEN);
    expect(lockedDraft.status).toBe(409);
    expect(lockedDraft.body).toMatchObject({ ok: false, reason: 'review_received_locked' });
    expect(fixture.state.violations).toEqual([]);
  });

  test('saved Find exclusion handles the real 409 and reloads the complete roster snapshot', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.SAVED_FIND_EXCLUSION);
    await page.goto(workbenchUrl(baseURL, 'find'));
    await expect(page.getByText('Dr. Saved Reviewer', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Not a fit: Dr. Saved Reviewer' }).click();
    await expect(page.getByText('This reviewer is already on Invite. Remove them from this request on the Invite tab.')).toBeVisible();
    expect(fixture.state.rosterMutations).toHaveLength(1);
    expect(fixture.state.rosterMutations[0]).toMatchObject({ requestId: REQUEST_ID, action: 'exclude' });
    expect(fixture.state.calls.filter((call) => call.pathname === '/api/workbench/reviewer-roster' && call.method === 'GET').length).toBeGreaterThanOrEqual(2);
    expect(fixture.state.roster.savedKeys).toEqual(['candidate:dr.saved reviewer']);
    expect(fixture.state.violations).toEqual([]);
  });

  test('invitation-specific Cancel leaves the preview intact and a later confirmation captures one email', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.BASELINE);
    await page.goto(workbenchUrl(baseURL, 'candidates'));
    await page.getByLabel('Select Dr. Saved Reviewer').check();
    await page.getByRole('button', { name: /send invitation \(1\)/i }).click();
    await expect(page.getByText('Invite reviewers (1)', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /reviewer campaign timeline/i }).click();
    await page.getByLabel('Days to respond').fill('7');
    await page.getByLabel('Proposals released to reviewers').fill('2099-07-15');
    await page.getByLabel('Reviews due').fill('2099-07-22');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Send 1 invitation' }).click();
    await expect(page.getByRole('button', { name: 'Send 1 invitation' })).toBeVisible();
    expect(fixture.state.sentBodies).toEqual([]);
    expect(fixture.state.capturedEmails).toEqual([]);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Send 1 invitation' }).click();
    await expect(page.getByText(/captured 1 invitation email for rehearsal/i)).toBeVisible();
    expect(fixture.state.sentBodies).toHaveLength(1);
    expect(fixture.state.capturedEmails).toHaveLength(1);
    expect(fixture.state.violations).toEqual([]);
  });

  test('staff dismisses a decline referral and the dismissal survives reload', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.DECLINE_RESET);
    await page.goto(workbenchUrl(baseURL, 'invite'));
    await expect(page.getByText('Dr. Suggested Reviewer')).toBeVisible();
    await expect(page.getByText(/suggested by Dr. Declining Reviewer/i)).toBeVisible();
    const referral = page.getByRole('listitem').filter({ hasText: 'Dr. Suggested Reviewer' });
    await referral.getByRole('button', { name: /dismiss/i }).click();
    await expect(page.getByText('Dr. Suggested Reviewer')).toBeHidden();
    expect(fixture.state.declineMutations).toEqual([{
      requestId: REQUEST_ID,
      suggestionId: '11111111-1111-4111-8111-111111111111',
      referralVersion: 'v1',
      referralIndex: 0,
    }]);
    await page.reload();
    await expect(page.getByText('Dr. Suggested Reviewer')).toBeHidden();
    expect(fixture.state.violations).toEqual([]);
  });

  for (const [scenario, expectedSendCopy, expectedReason] of [
    [SCENARIOS.MANUAL_COI_BLOCKED, /confirmed current institution conflicts with this proposal/i, 'manual_institution_coi'],
    [SCENARIOS.MANUAL_COI_UNAVAILABLE, /first-invitation institution check is unavailable/i, 'manual_institution_coi_unavailable'],
    [SCENARIOS.MANUAL_COI_UNKNOWN_ALLOWED, /captured 1 invitation email for rehearsal/i, null],
  ]) {
    test(`manual Add stays sparse and the ${scenario} outcome appears at first invitation`, async ({ page, context }, testInfo) => {
      const { baseURL, fixture } = await prepare(page, context, testInfo, scenario);
      if (scenario === SCENARIOS.MANUAL_COI_UNKNOWN_ALLOWED) {
        await page.goto(workbenchUrl(baseURL, 'find'));
        await page.getByLabel('Name', { exact: true }).fill('Dr. Synthetic Reviewer');
        await page.getByLabel('Email', { exact: true }).fill('synthetic.reviewer@example.test');
        await page.getByLabel('Affiliation', { exact: true }).fill('Example University');
        await page.getByRole('button', { name: 'Add reviewer', exact: true }).click();
        await expect(page.getByText('Added Dr. Synthetic Reviewer to Candidates.', { exact: true })).toBeVisible();
        expect(fixture.state.manualAdds).toHaveLength(1);
        expect(fixture.state.manualAdds[0]).toMatchObject({
          requestId: REQUEST_ID,
          name: 'Dr. Synthetic Reviewer',
          email: 'synthetic.reviewer@example.test',
          resolution: { mode: 'create_new' },
        });
        expect(fixture.state.manualResponses[0].status).toBe(200);
        expect(fixture.state.manualResponses[0].payload).toMatchObject({
          candidate: { manualAdded: true, invitable: true, sources: ['staff_manual'] },
          created: { person: true, suggestion: true },
        });
        expect(fixture.state.candidateRows.find((row) => row.name === 'Dr. Synthetic Reviewer').mainInstitution).toBeUndefined();
        expect(fixture.state.candidateRows.find((row) => row.name === 'Dr. Synthetic Reviewer').affiliation).toBe('Example University');
      } else {
        expect(fixture.state.manualAdds).toEqual([]);
        expect(fixture.state.candidateRows[0]).toMatchObject({ manualAdded: true, sources: ['staff_manual'] });
        expect(fixture.state.candidateRows[0].mainInstitution).toBe(expectedReason === 'manual_institution_coi' ? 'Example University' : undefined);
      }

      // The browser rehearsal simulates the first-invitation SSE contract; the
      // service and COI gate have their own unit coverage.
      await page.goto(workbenchUrl(baseURL, 'candidates'));
      await expect(page.getByText('Dr. Synthetic Reviewer', { exact: true })).toBeVisible();
      await sendInvitation(page, 'Dr. Synthetic Reviewer');
      await expect(page.getByText(expectedSendCopy)).toBeVisible();
      const manualRow = fixture.state.candidateRows.find((row) => row.name === 'Dr. Synthetic Reviewer');
      if (expectedReason) {
        expect(fixture.state.sentBodies).toHaveLength(1);
        expect(fixture.state.transitions).toContainEqual({ type: 'manual-first-invite-skipped', reason: expectedReason, count: 1 });
        expect(manualRow).toMatchObject({ invited: false });
      } else {
        expect(fixture.state.transitions).toContainEqual({ type: 'manual-first-invite-allowed', mainInstitution: '' });
        expect(manualRow).toMatchObject({ invited: true });
        expect(fixture.state.capturedEmails).toHaveLength(1);
      }
      expect(fixture.state.violations).toEqual([]);
    });
  }

  test('partial materials availability is shown during a real draft preview without blocking it', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.MATERIALS_PARTIAL);
    await page.goto(workbenchUrl(baseURL, 'invite'));
    await expect(page.getByText('Dr. Accepted Reviewer')).toBeVisible();
    await page.getByRole('button', { name: /release proposal to reviewers \(1\)/i }).click();
    await expect(page.getByRole('heading', { name: 'Release proposal to reviewers', exact: true })).toBeVisible();
    await expect(page.getByText(/couldn’t verify reviewer materials availability/i)).toBeVisible();
    await page.getByRole('button', { name: /preview 1 email/i }).click();
    await expect(page.getByText(/review and personalize each email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send 1 email/i })).toBeEnabled();
    expect(fixture.state.renderBodies).toMatchObject([{ templateType: 'materials', suggestionIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'] }]);
    expect(fixture.state.renderBodies[0].suggestionIds).not.toContain('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /send 1 email/i }).click();
    await expect(page.getByText('Sent for delivery.')).toBeVisible();
    expect(fixture.state.sentBodies).toHaveLength(1);
    expect(fixture.state.sentBodies[0].drafts.map((draft) => draft.suggestionId)).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    expect(fixture.state.sentBodies[0].drafts[0].body).toContain('Synthetic materials for Synthetic reviewer rehearsal');
    expect(fixture.state.sentBodies[0].drafts[0].body).toContain(`/external/review/${REVIEW_TOKEN}`);
    expect(fixture.state.materialsSentIds).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    expect(fixture.state.reviewerRows.find((row) => row.suggestionId === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toMatchObject({ reviewStatus: 'materials_sent' });
    expect(fixture.state.reviewerRows.find((row) => row.suggestionId === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toMatchObject({ reviewStatus: 'pending', invited: true });
    expect(fixture.state.violations).toEqual([]);
  });

  test('PD drift exposes the policy skip explanation and leaves invitation state unchanged', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.PD_DRIFT);
    await page.goto(workbenchUrl(baseURL));
    await sendInvitation(page, 'Dr. Saved Reviewer');
    await expect(page.getByText(/assigned Program Director changed while this invitation was being prepared/i)).toBeVisible();
    expect(fixture.state.sentBodies).toHaveLength(1);
    expect(fixture.state.candidateRows[0]).toMatchObject({ invited: false });
    expect(fixture.state.previewSnapshots[0]).toMatchObject({ programDirectorId: PD_ID });
    expect(fixture.state.currentProgramDirectorId).not.toBe(PD_ID);
    expect(fixture.state.transitions).toEqual([{
      type: 'pd-drift-skipped',
      previewProgramDirectorId: PD_ID,
      currentProgramDirectorId: fixture.state.currentProgramDirectorId,
      assignmentChanged: true,
      count: 1,
    }]);
    expect(fixture.state.violations).toEqual([]);
  });

  test('captured paired Yes/No links drive the portal, and fixture reset clears the decline in memory', async ({ page, context }, testInfo) => {
    const { baseURL, fixture } = await prepare(page, context, testInfo, SCENARIOS.BASELINE);
    await page.goto(workbenchUrl(baseURL));
    await sendInvitation(page, 'Dr. Saved Reviewer');
    await expect(page.getByText(/captured 1 invitation email for rehearsal/i)).toBeVisible();
    expect(fixture.state.candidateRows[0]).toMatchObject({ invited: true });
    expect(fixture.state.reviewerRows.find((row) => row.suggestionId === '11111111-1111-4111-8111-111111111111')).toMatchObject({ invited: true, tokenState: 'active' });
    expect(fixture.state.campaignConfig).toMatchObject({ respondOffsetDays: 7, reviewDueDate: '2099-07-22' });

    const capturedHtml = fixture.state.capturedEmails[0].htmlBody;
    expect(capturedHtml).toContain('Yes, I Can Review');
    expect(capturedHtml).toContain('No, I Cannot Review');

    await page.setContent(capturedHtml);
    await page.getByRole('link', { name: 'No, I Cannot Review' }).click();
    await expect(page).toHaveURL(new RegExp(`/external/review/${REVIEW_TOKEN}\\?action=decline$`));
    await expect(page.getByText("Sorry to hear you can't take this on")).toBeVisible();
    await page.getByRole('button', { name: 'Submit decline' }).click();
    await expect(page.getByText("Thank you. We've recorded your decline.")).toBeVisible();
    expect(fixture.state.transitions).toContainEqual({ type: 'reviewer-decline', action: 'decline' });
    expect(fixture.state.reviewerContext.engagementState).toMatchObject({ declined: true });
    expect(fixture.state.candidateRows.find((row) => row.suggestionId === '11111111-1111-4111-8111-111111111111')).toMatchObject({ declined: true, responseType: 'declined' });
    expect(fixture.state.reviewerRows.find((row) => row.suggestionId === '11111111-1111-4111-8111-111111111111')).toMatchObject({ reviewStatus: 'declined', responseType: 'declined' });

    fixture.reset();
    expect(fixture.state.resetCount).toBe(1);
    expect(fixture.state.reviewerContext.engagementState).toMatchObject({ accepted: false, declined: false });
    await page.setContent(capturedHtml);
    await page.getByRole('link', { name: 'Yes, I Can Review' }).click();
    await expect(page).toHaveURL(new RegExp(`/external/review/${REVIEW_TOKEN}\\?action=accept$`));
    await acknowledgePolicies(page);
    await acceptBoardIdentity(page);
    await page.getByRole('button', { name: 'Accept and continue' }).click();
    await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeHidden();
    expect(fixture.state.transitions).toContainEqual({ type: 'reviewer-accept', action: 'accept' });
    expect(fixture.state.transitions).not.toContainEqual({ type: 'reviewer-decline', action: 'decline' });
    expect(fixture.state.candidateRows.find((row) => row.suggestionId === '11111111-1111-4111-8111-111111111111')).toMatchObject({ invited: true, accepted: true, responseType: 'accepted' });
    expect(fixture.state.reviewerRows.find((row) => row.suggestionId === '11111111-1111-4111-8111-111111111111')).toMatchObject({ reviewStatus: 'accepted', responseType: 'accepted' });
    await page.goto(workbenchUrl(baseURL, 'candidates'));
    await expect(page.getByRole('listitem').filter({ hasText: 'Dr. Saved Reviewer' })).toContainText('Accepted');
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: 'Dr. Saved Reviewer' })).toContainText('Accepted');
    await page.goto(workbenchUrl(baseURL, 'invite'));
    await expect(page.getByRole('button', { name: /release proposal to reviewers \(2\)/i })).toBeVisible();
    await page.getByRole('button', { name: /release proposal to reviewers \(2\)/i }).click();
    await expect(page.getByRole('heading', { name: 'Release proposal to reviewers', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /preview 2 emails/i }).click();
    await expect(page.getByRole('button', { name: /send 2 emails/i })).toBeEnabled();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /send 2 emails/i }).click();
    await expect(page.getByText('Sent for delivery.')).toBeVisible();
    expect(fixture.state.sentBodies.at(-1).drafts.map((draft) => draft.suggestionId)).toEqual([
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(fixture.state.sentBodies.at(-1).drafts.find((draft) => draft.suggestionId === '11111111-1111-4111-8111-111111111111').body)
      .toContain('Synthetic materials for Synthetic reviewer rehearsal');
    await page.goto(new URL(`/external/review/${REVIEW_TOKEN}`, baseURL).toString());
    await expect(page.getByRole('heading', { name: 'Submit your review', level: 2 })).toBeVisible();
    expect(fixture.state.reviewerContext.engagementState.view).toBe('stage2b');
    expect(fixture.state.violations).toEqual([]);
  });
});
