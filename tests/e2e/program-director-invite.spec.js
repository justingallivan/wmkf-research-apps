// Browser E2E — Program Director candidate invitation flow.
//
// Drives the real Workbench/Candidates UI through preview -> send -> captured
// reviewer link, with Workbench and reviewer APIs route-mocked at the browser
// context. No Dataverse, Dynamics email, Blob, or SharePoint calls are made.

const { test, expect } = require('@playwright/test');
const { createRequire } = require('module');
const { buildContext } = require('./helpers/reviewer-portal');

const requireFromHere = createRequire(__filename);
const { encode } = requireFromHere('next-auth/jwt');

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_NUM = '1002788';
const REVIEW_TOKEN = 'pd-e2e-reviewer-token';
const TEST_EMAIL = 'berets.eyeful-0f@icloud.com';
const NEXTAUTH_SECRET = 'e2e-throwaway-nextauth-secret-32-chars';

function workbenchUrl(baseURL) {
  return new URL(`/workbench/${REQUEST_ID}?tab=reviewers&sub=candidates&n=${REQUEST_NUM}`, baseURL).toString();
}

function makeCandidate(overrides = {}) {
  return {
    suggestionId: overrides.suggestionId || '11111111-1111-4111-8111-111111111111',
    name: overrides.name || 'Dr. Capture Candidate',
    affiliation: overrides.affiliation || 'Example University',
    email: Object.prototype.hasOwnProperty.call(overrides, 'email') ? overrides.email : TEST_EMAIL,
    invited: overrides.invited || false,
    accepted: false,
    declined: false,
    reasoning: 'Strong fit for the proposal area and available for this cycle.',
    keywords: 'cell biology; instrumentation',
    applicantRecommended: false,
    manualAdded: false,
    googleScholarUrl: 'https://scholar.google.com/',
    website: 'https://example.edu/faculty/capture-candidate',
    emailConfidence: overrides.emailConfidence || { level: 'high', reason: 'confirmed_identity' },
  };
}

async function installStaffSession(context, baseURL) {
  const expires = Math.floor(Date.now() / 1000) + (60 * 60);
  const token = await encode({
    secret: NEXTAUTH_SECRET,
    token: {
      sub: 'pd-e2e-user',
      name: 'Program Director',
      email: 'program.director@example.org',
      azureId: 'pd-e2e-azure-id',
      userType: 'staff',
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

function sseResult(result) {
  return [
    'event: progress',
    'data: {"current":1,"total":1,"message":"Captured invitation"}',
    '',
    'event: result',
    `data: ${JSON.stringify(result)}`,
    '',
    '',
  ].join('\n');
}

async function installInviteMocks(context, baseURL, { candidates = [makeCandidate()] } = {}) {
  const sentBodies = [];
  const renderBodies = [];
  let reviewerContext = buildContext({ longBody: false });
  const candidateById = new Map(candidates.map((c) => [c.suggestionId, c]));
  const reviewerUrl = new URL(`/external/review/${REVIEW_TOKEN}`, baseURL).toString();

  await context.route('**/api/auth/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await context.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await context.route('**/api/app-access', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apps: ['reviewers'], isSuperuser: false }) }));
  await context.route('**/api/user-profiles', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profiles: [{
          id: 1,
          name: 'Program Director',
          displayName: 'Program Director',
          isDefault: true,
          avatarColor: '#111827',
        }],
      }),
    }));
  await context.route('**/api/user-preferences**', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    const url = new URL(route.request().url());
    if (url.searchParams.get('key')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ value: '' }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: { email_signature: JSON.stringify({ signature: 'Program Director Signature' }) } }),
    });
  });
  await context.route('**/api/workbench/resolve-request**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: REQUEST_ID,
        requestNumber: REQUEST_NUM,
        title: 'A Study of Test-Driven Reviewer Onboarding',
        cycleLabel: 'J26',
        grantProgram: 'Research',
        institution: 'Example University',
        programDirectorId: null,
      }),
    }));
  await context.route('**/api/review-manager/reviewers**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        proposals: [{ proposalId: REQUEST_ID, proposalTitle: 'A Study of Test-Driven Reviewer Onboarding', reviewers: [] }],
      }),
    }));
  await context.route('**/api/reviewer-finder/my-candidates**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ proposals: [{ proposalId: REQUEST_ID, candidates }] }),
    }));
  await context.route('**/api/review-manager/render-emails', (route) => {
    const body = route.request().postDataJSON();
    renderBodies.push(body);
    const drafts = body.suggestionIds.map((suggestionId) => {
      const candidate = candidateById.get(suggestionId);
      if (!candidate?.email) {
        return {
          suggestionId,
          candidateName: candidate?.name || '(unnamed)',
          candidateEmail: '',
          skipped: 'no_email',
          body: 'No email address is available.',
        };
      }
      return {
        suggestionId,
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        subject: `Reviewer invitation for Request ${REQUEST_NUM}`,
        body: [
          'Dear Dr. Candidate,',
          '',
          'Please use your secure personal link:',
          reviewerUrl,
          '',
          'Review timeline:',
          '- Respond by {{respondBy}}',
          '- Proposal delivered on {{proposalDelivery}}',
          '- Review due by {{reviewDue}}',
          '',
          '{{signature}}',
        ].join('\n'),
        emailConfidence: candidate.emailConfidence,
      };
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ drafts }) });
  });
  await context.route('**/api/review-manager/send-emails', (route) => {
    const body = route.request().postDataJSON();
    sentBodies.push(body);
    const sent = body.drafts.map((draft) => {
      const candidate = candidateById.get(draft.suggestionId);
      return {
        suggestionId: draft.suggestionId,
        candidateName: candidate?.name,
        candidateEmail: candidate?.email,
        deliveryMode: 'capture',
        emailId: `captured-${draft.suggestionId}`,
        capturedEmail: {
          subject: draft.subject,
          from: 'pd@wmkeck.org',
          to: candidate?.email,
          htmlBody: [
            '<main>',
            '<p>The W. M. Keck Foundation invites you to serve as a peer reviewer.</p>',
            `<table role="presentation"><tr><td><a href="${reviewerUrl}">Start Review</a></td></tr></table>`,
            `<p>If the button does not work, copy and paste this link: <a href="${reviewerUrl}">${reviewerUrl}</a></p>`,
            '</main>',
          ].join(''),
        },
      };
    });
    const result = { sent, failed: [], skipped: [], stats: { sent: sent.length, failed: 0, skipped: 0, total: sent.length } };
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseResult(result) });
  });
  await context.route(`**/api/external/review/${REVIEW_TOKEN}/context`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reviewerContext) }));
  await context.route(`**/api/external/review/${REVIEW_TOKEN}/respond`, async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'accept') reviewerContext = buildContext({ view: 'accepted-pre-materials' });
    if (body.action === 'decline') reviewerContext = buildContext({ view: 'declined' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, idempotent: false, engagementState: reviewerContext.engagementState }),
    });
  });

  return { sentBodies, renderBodies, reviewerUrl };
}

test.describe('Program Director reviewer invitation flow', () => {
  test('sends a captured invitation and opens the reviewer link', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const { sentBodies, reviewerUrl } = await installInviteMocks(context, baseURL);

    await page.goto(workbenchUrl(baseURL));
    await expect(page.getByText('Dr. Capture Candidate')).toBeVisible();
    await page.getByLabel('Select Dr. Capture Candidate').check();
    await page.getByRole('button', { name: /send invitation \(1\)/i }).click();

    await expect(page.getByText('Invite reviewers (1)')).toBeVisible();
    await page.getByLabel('Days to respond').fill('10');
    await page.getByLabel('Proposal delivered on').fill('2026-07-08');
    await page.getByLabel('Review due by').fill('2026-07-22');

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Send 1 invitation now via Dynamics?');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Send 1 invitation' }).click();

    await expect(page.getByText(/captured 1 invitation email for rehearsal/i)).toBeVisible();
    await expect(page.locator('textarea[readonly]')).toHaveValue(/Start Review/);
    expect(sentBodies).toHaveLength(1);
    expect(sentBodies[0]).toMatchObject({
      templateType: 'invitation',
      attachmentUrls: [],
      markAsSent: true,
      allowResend: false,
      drafts: [{ suggestionId: '11111111-1111-4111-8111-111111111111' }],
      // Phase 1: respond-by is now a "days to respond" offset; the panel sends the
      // per-request campaign config alongside the drafts.
      campaignConfig: { respondOffsetDays: 10, reviewDueDate: '2026-07-22' },
    });
    // respond-by date is today + offset (relative), so it's not asserted as a fixed
    // string; the review-due fixed date and the secure link are.
    expect(sentBodies[0].drafts[0].body).toContain('July 22, 2026');
    expect(sentBodies[0].drafts[0].body).toContain(reviewerUrl);

    const reviewerPage = await context.newPage();
    await reviewerPage.goto(reviewerUrl);
    await expect(reviewerPage.getByText('A Study of Test-Driven Reviewer Onboarding')).toBeVisible();
    await expect(reviewerPage.getByRole('button', { name: 'Accept and continue' })).toBeVisible();
  });

  test('batch preview handles low-confidence email and no-email rows', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const low = makeCandidate({
      suggestionId: '22222222-2222-4222-8222-222222222222',
      name: 'Dr. Low Confidence',
      email: TEST_EMAIL,
      emailConfidence: { level: 'low', reason: 'manual' },
    });
    const missingEmail = makeCandidate({
      suggestionId: '33333333-3333-4333-8333-333333333333',
      name: 'Dr. Missing Email',
      email: '',
    });
    const { sentBodies } = await installInviteMocks(context, baseURL, { candidates: [low, missingEmail] });

    await page.goto(workbenchUrl(baseURL));
    await page.getByLabel('Select Dr. Low Confidence').check();
    await page.getByLabel('Select Dr. Missing Email').check();
    await page.getByRole('button', { name: /send invitation \(2\)/i }).click();

    await expect(page.getByText(/this address wasn’t verified/i)).toBeVisible();
    await expect(page.getByText(/Skipped \(no email address\)/i)).toBeVisible();

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain(TEST_EMAIL);
      expect(dialog.message()).toContain('could NOT be verified');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Confirm & send 1 invitation' }).click();

    await expect(page.getByText(/captured 1 invitation email for rehearsal/i)).toBeVisible();
    expect(sentBodies[0]).toMatchObject({
      confirmedLowConfidenceIds: ['22222222-2222-4222-8222-222222222222'],
      drafts: [{ suggestionId: '22222222-2222-4222-8222-222222222222' }],
    });
  });

  test('re-invite path sends with allowResend', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const invited = makeCandidate({ invited: true });
    const { sentBodies } = await installInviteMocks(context, baseURL, { candidates: [invited] });

    await page.goto(workbenchUrl(baseURL));
    await page.getByLabel('Select Dr. Capture Candidate').check();
    await page.getByRole('button', { name: 'Re-invite 1 already-invited' }).click();

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Send 1 invitation' }).click();

    await expect(page.getByText(/captured 1 invitation email for rehearsal/i)).toBeVisible();
    expect(sentBodies[0]).toMatchObject({ allowResend: true });
  });
});
