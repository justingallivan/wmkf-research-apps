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
const PROGRAM_DIRECTOR_EMAIL = 'program.director@example.org';
const PROGRAM_DIRECTOR_SYSTEMUSER_ID = '77777777-7777-4777-8777-777777777777';
const NEXTAUTH_SECRET = 'e2e-throwaway-nextauth-secret-32-chars';

function workbenchUrl(baseURL, sub = 'candidates') {
  return new URL(`/workbench/${REQUEST_ID}?tab=reviewers&sub=${sub}&n=${REQUEST_NUM}`, baseURL).toString();
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
      email: PROGRAM_DIRECTOR_EMAIL,
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
    'event: complete',
    `data: ${JSON.stringify({
      message: `Sent ${result.stats.sent} of ${result.stats.total} email(s)`,
      sent: result.stats.sent,
      failed: result.stats.failed,
      skipped: result.stats.skipped,
    })}`,
    '',
    '',
  ].join('\n');
}

function makeReviewer(overrides = {}) {
  return {
    suggestionId: overrides.suggestionId || '44444444-4444-4444-8444-444444444444',
    name: overrides.name || 'Dr. Accepted Reviewer',
    affiliation: overrides.affiliation || 'Example University',
    email: Object.prototype.hasOwnProperty.call(overrides, 'email') ? overrides.email : TEST_EMAIL,
    reviewStatus: overrides.reviewStatus || 'accepted',
    tokenState: overrides.tokenState || 'active',
    tokenExpiresAt: overrides.tokenExpiresAt || '2026-08-01T00:00:00Z',
    reminderCount: overrides.reminderCount || 0,
    notes: overrides.notes || '',
  };
}

async function installInviteMocks(context, baseURL, {
  candidates = [makeCandidate()],
  reviewers = [],
  withdrawStatuses = {},
  campaignConfig = {
    respondOffsetDays: 10,
    reviewDueDate: '2099-07-22',
    respondReminderEnabled: false,
    respondReminderLeadDays: null,
    reviewDueReminderEnabled: false,
    reviewDueReminderLeadDays: null,
    desiredCount: null,
    quotaNotifiedAt: null,
  },
} = {}) {
  const sentBodies = [];
  const renderBodies = [];
  const campaignReads = [];
  const campaignWrites = [];
  const withdrawBodies = [];
  const withdrawRenderBodies = [];
  let candidatesState = candidates.map((c) => ({ ...c }));
  let reviewersState = reviewers.map((r) => ({ ...r }));
  let campaignState = { ...campaignConfig };
  let reviewerContext = buildContext({ longBody: false });
  const findRecipient = (suggestionId) => {
    const candidate = candidatesState.find((c) => c.suggestionId === suggestionId);
    if (candidate) return candidate;
    return reviewersState.find((r) => r.suggestionId === suggestionId);
  };
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
        proposals: [{
          proposalId: REQUEST_ID,
          proposalTitle: 'A Study of Test-Driven Reviewer Onboarding',
          reviewDeadline: campaignState.reviewDueDate,
          reviewers: reviewersState,
        }],
      }),
    }));
  await context.route('**/api/reviewer-finder/my-candidates**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ proposals: [{ proposalId: REQUEST_ID, candidates: candidatesState }] }),
    }));
  await context.route('**/api/review-manager/campaign-config**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      campaignReads.push(new URL(req.url()).searchParams.get('requestId'));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requestId: REQUEST_ID, config: campaignState }),
      });
    }
    const body = req.postDataJSON();
    campaignWrites.push(body);
    campaignState = { ...campaignState, ...body.config };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, requestId: REQUEST_ID, config: campaignState }),
    });
  });
  await context.route('**/api/review-manager/campaign-timeline-defaults', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        key: 'reviewer.campaign_timeline_defaults',
        timeline: {
          cycleLabel: 'J99',
          inviteStartDate: '2099-06-17',
          respondOffsetDays: 14,
          proposalReleaseDate: '2099-07-08',
          reviewDueDate: '2099-08-05',
        },
        isDefault: false,
        malformed: false,
      }),
    }));
  await context.route('**/api/review-manager/render-withdraw-emails', (route) => {
    const body = route.request().postDataJSON();
    withdrawRenderBodies.push(body);
    const drafts = body.suggestionIds.map((suggestionId) => {
      const recipient = findRecipient(suggestionId);
      return {
        suggestionId,
        status: 'ok',
        name: recipient?.name || 'Reviewer',
        to: recipient?.email || '',
        from: PROGRAM_DIRECTOR_EMAIL,
        senderId: PROGRAM_DIRECTOR_SYSTEMUSER_ID,
        subject: `Thank you — Request ${REQUEST_NUM}`,
        bodyText: `Dear ${recipient?.name || 'Reviewer'},\n\nThank you for considering this review.\n\nProgram Director`,
      };
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, drafts }),
    });
  });
  await context.route('**/api/review-manager/withdraw-sufficient', (route) => {
    const body = route.request().postDataJSON();
    withdrawBodies.push(body);
    const ids = new Set(body.suggestionIds || []);
    const incompleteId = [...ids].find((suggestionId) => {
      const override = body.overrides?.[suggestionId];
      return !override?.subject?.trim()
        || !override?.bodyText?.trim()
        || !override?.to?.trim()
        || !override?.from?.trim()
        || !override?.senderId?.trim();
    });
    if (incompleteId) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'each selected suggestion requires complete subject, bodyText, to, from, and senderId overrides',
        }),
      });
    }
    const results = [...ids].map((suggestionId) => ({
      suggestionId,
      status: withdrawStatuses[suggestionId] || 'withdrawn_emailed',
    }));
    const withdrawnIds = new Set(results
      .filter(({ status }) => status.startsWith('withdrawn_'))
      .map(({ suggestionId }) => suggestionId));
    candidatesState = candidatesState.map((c) => (
      withdrawnIds.has(c.suggestionId) ? { ...c, responseType: 'withdrawn_sufficient' } : c
    ));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        withdrawn: withdrawnIds.size,
        results,
      }),
    });
  });
  await context.route('**/api/review-manager/render-emails', (route) => {
    const body = route.request().postDataJSON();
    renderBodies.push(body);
    const drafts = body.suggestionIds.map((suggestionId) => {
      const recipient = findRecipient(suggestionId);
      if (!recipient?.email) {
        return {
          suggestionId,
          candidateName: recipient?.name || '(unnamed)',
          candidateEmail: '',
          skipped: 'no_email',
          body: 'No email address is available.',
        };
      }
      return {
        suggestionId,
        candidateName: recipient.name,
        candidateEmail: recipient.email,
        subject: body.templateType === 'materials'
          ? `Reviewer materials for Request ${REQUEST_NUM}`
          : `Reviewer invitation for Request ${REQUEST_NUM}`,
        body: body.templateType === 'materials'
          ? [
            'Dear Reviewer,',
            '',
            'The proposal materials are ready.',
            reviewerUrl,
            '',
            'Review due: {{reviewDueDate}}',
          ].join('\n')
          : [
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
        emailConfidence: recipient.emailConfidence,
      };
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ drafts }) });
  });
  await context.route('**/api/review-manager/send-emails', (route) => {
    const body = route.request().postDataJSON();
    sentBodies.push(body);
    const sent = body.drafts.map((draft) => {
      const recipient = findRecipient(draft.suggestionId);
      if (body.templateType === 'materials') {
        reviewersState = reviewersState.map((r) => (
          r.suggestionId === draft.suggestionId
            ? { ...r, reviewStatus: 'materials_sent', materialsSentAt: '2026-07-08T00:00:00Z' }
            : r
        ));
      }
      return {
        suggestionId: draft.suggestionId,
        candidateName: recipient?.name,
        candidateEmail: recipient?.email,
        deliveryMode: 'capture',
        emailId: `captured-${draft.suggestionId}`,
        capturedEmail: {
          subject: draft.subject,
          from: 'pd@wmkeck.org',
          to: recipient?.email,
          htmlBody: [
            '<main>',
            '<p>The W. M. Keck Foundation invites you to serve as a peer reviewer.</p>',
            `<table role="presentation"><tr><td><a href="${reviewerUrl}?action=accept">Yes, I Can Review</a></td></tr></table>`,
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

  return {
    sentBodies,
    renderBodies,
    campaignReads,
    campaignWrites,
    withdrawBodies,
    withdrawRenderBodies,
    reviewerUrl,
  };
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

    // exact:true (case-sensitive, whole-string) targets the modal title
    // "Invite reviewers (1)" only; without it, getByText also matches the
    // Workbench sub-tab header "Invite Reviewers (1)" (ReviewerInvitePanel)
    // behind the modal → strict-mode violation.
    await expect(page.getByText('Invite reviewers (1)', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /reviewer campaign timeline/i }).click();
    await expect(page.getByLabel('Days to respond')).toHaveValue('10');
    await expect(page.getByLabel('Reviews due')).toHaveValue('2099-07-22');
    await expect(page.getByLabel('Proposals released to reviewers')).toHaveValue('2099-07-08');
    await page.getByLabel('Days to respond').fill('10');
    await page.getByLabel('Proposals released to reviewers').fill('2099-07-08');
    await page.getByLabel('Reviews due').fill('2099-07-22');

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Send 1 invitation now via Dynamics?');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Send 1 invitation' }).click();

    await expect(page.getByText(/captured 1 invitation email for rehearsal/i)).toBeVisible();
    await expect(page.locator('textarea[readonly]')).toHaveValue(/Yes, I Can Review/);
    expect(sentBodies).toHaveLength(1);
    expect(sentBodies[0]).toMatchObject({
      templateType: 'invitation',
      attachmentUrls: [],
      markAsSent: true,
      allowResend: false,
      drafts: [{ suggestionId: '11111111-1111-4111-8111-111111111111' }],
      // Phase 1: respond-by is now a "days to respond" offset; the panel sends the
      // per-request campaign config alongside the drafts.
      campaignConfig: { respondOffsetDays: 10, reviewDueDate: '2099-07-22' },
    });
    // respond-by date is today + offset (relative), so it's not asserted as a fixed
    // string; the review-due fixed date and the secure link are.
    expect(sentBodies[0].drafts[0].body).toContain('July 22, 2099');
    expect(sentBodies[0].drafts[0].body).toContain(reviewerUrl);

    const reviewerPage = await context.newPage();
    await reviewerPage.goto(reviewerUrl);
    await expect(reviewerPage.getByText('A Study of Test-Driven Reviewer Onboarding')).toBeVisible();
    await expect(reviewerPage.getByRole('button', { name: 'Accept and continue' })).toBeVisible();
  });

  test('batch preview flags low-confidence email and blocks no-email rows', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const low = makeCandidate({
      suggestionId: '22222222-2222-4222-8222-222222222222',
      name: 'Dr. Low Confidence',
      email: TEST_EMAIL,
      emailConfidence: { level: 'low', action: 'quick_check', reason: 'manual' },
    });
    const missingEmail = makeCandidate({
      suggestionId: '33333333-3333-4333-8333-333333333333',
      name: 'Dr. Missing Email',
      email: '',
    });
    const { sentBodies } = await installInviteMocks(context, baseURL, { candidates: [low, missingEmail] });

    await page.goto(workbenchUrl(baseURL));

    // A no-email candidate can't be invited: ReviewerInvitePanel disables its
    // Select checkbox and shows an inline "no email — can't invite" note (it now
    // blocks selection rather than accepting the row and skipping it in preview).
    await expect(page.getByLabel('Select Dr. Missing Email')).toBeDisabled();
    await expect(page.getByText(/no email.*can.t invite/i)).toBeVisible();

    // The low-confidence (unverified-email) candidate is still invitable → count 1.
    await page.getByLabel('Select Dr. Low Confidence').check();
    await page.getByRole('button', { name: /send invitation \(1\)/i }).click();

    // Batch preview flags the address for a quick check; the no-email row never reaches it.
    await expect(page.getByText(/quick check recommended/i)).toBeVisible();

    // Send is gated until each low-confidence address is explicitly confirmed. The
    // confirm checkbox's accessible name starts with the candidate name; anchor to
    // avoid the panel's "Select Dr. Low Confidence" checkbox behind the modal.
    await page.getByRole('checkbox', { name: /^Dr\. Low Confidence/ }).check();

    // With the low-confidence address acknowledged in-modal, the final send shows
    // the generic Dynamics confirm (the per-address "could NOT be verified" warning
    // now lives on the checkbox above, not in this dialog).
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Send 1 invitation now via Dynamics?');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Confirm & send 1 invitation' }).click();

    await expect(page.getByText(/captured 1 invitation email for rehearsal/i)).toBeVisible();
    expect(sentBodies[0]).toMatchObject({
      confirmedLowConfidenceIds: ['22222222-2222-4222-8222-222222222222'],
      drafts: [{ suggestionId: '22222222-2222-4222-8222-222222222222' }],
    });
  });

  // Note: there is no manual "Re-invite already-invited" UI affordance — the
  // automated respond-by reminder (cron reviewer-reminders) nudges pending
  // invitees. The server-side `allowResend` re-mint contract is still covered by
  // tests/unit/reviewer-invite.test.js and tests/integration/send-emails-route.test.js.

  test('edits reviewer-engagement campaign settings without Dataverse', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const { campaignReads, campaignWrites } = await installInviteMocks(context, baseURL, {
      campaignConfig: {
        respondOffsetDays: 7,
        reviewDueDate: '2099-07-22',
        respondReminderEnabled: true,
        respondReminderLeadDays: 1,
        reviewDueReminderEnabled: false,
        reviewDueReminderLeadDays: null,
        desiredCount: 2,
        quotaNotifiedAt: null,
      },
    });

    await page.goto(workbenchUrl(baseURL));
    await page.getByRole('button', { name: /campaign settings/i }).click();
    await expect(page.locator('.fixed').getByText('Campaign settings')).toBeVisible();
    await expect(page.getByLabel('Days to respond')).toHaveValue('7');
    await expect(page.getByLabel('Review due date')).toHaveValue('2099-07-22');

    await page.getByLabel('Days to respond').fill('14');
    await page.getByLabel('Review due date').fill('2099-08-05');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Save' })).toBeHidden();
    expect(campaignReads).toEqual([REQUEST_ID]);
    expect(campaignWrites).toEqual([{
      requestId: REQUEST_ID,
      config: { respondOffsetDays: 14, reviewDueDate: '2099-08-05', desiredCount: 2 },
    }]);
  });

  test('releases accepted reviewers through the materials email path', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const accepted = makeReviewer();
    const { sentBodies, renderBodies } = await installInviteMocks(context, baseURL, { reviewers: [accepted] });

    await page.goto(workbenchUrl(baseURL, 'invite'));
    await expect(page.getByText('Dr. Accepted Reviewer')).toBeVisible();
    await page.getByRole('button', { name: /release proposal to reviewers \(1\)/i }).click();
    await expect(page.getByText('Generate Materials Emails')).toBeVisible();

    await page.getByRole('button', { name: /preview 1 email/i }).click();
    await expect(page.getByText(/review and personalize each email/i)).toBeVisible();
    await expect(page.locator('input[placeholder="Subject"]')).toHaveValue('Reviewer materials for Request 1002788');

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Send 1 email now via Dynamics?');
      await dialog.accept();
    });
    await page.getByRole('button', { name: /send 1 email/i }).click();

    await expect(page.getByText('1 sent')).toBeVisible();
    expect(renderBodies[0]).toMatchObject({
      templateType: 'materials',
      suggestionIds: [accepted.suggestionId],
    });
    expect(sentBodies[0]).toMatchObject({
      templateType: 'materials',
      markAsSent: true,
      attachmentUrls: [],
      drafts: [{ suggestionId: accepted.suggestionId }],
    });
  });

  test('releases still-pending invitees as no longer needed', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const pending = makeCandidate({
      suggestionId: '55555555-5555-4555-8555-555555555555',
      name: 'Dr. Pending Invitee',
      invited: true,
    });
    const { withdrawBodies, withdrawRenderBodies } = await installInviteMocks(
      context,
      baseURL,
      { candidates: [pending] },
    );

    await page.goto(workbenchUrl(baseURL));
    await expect(page.getByText('Dr. Pending Invitee')).toBeVisible();
    await page.getByLabel('Select Dr. Pending Invitee').check();

    await page.getByRole('button', { name: /review & release 1 as no longer needed/i }).click();
    await expect(page.getByText('Review release emails')).toBeVisible();
    await expect.poll(() => withdrawRenderBodies.length).toBe(1);

    const modal = page.locator('.fixed').filter({ hasText: 'Review release emails' });
    await modal.getByLabel('Subject').fill('Reviewed release subject');
    await modal.getByLabel('Message').fill('Dear Dr. Pending Invitee,\n\nWe have completed the reviewer slate. Thank you.');

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Send and release 1 reviewer?');
      await dialog.accept();
    });
    await modal.getByRole('button', { name: /send and release 1/i }).click();

    await expect.poll(() => withdrawBodies.length).toBe(1);
    expect(withdrawBodies[0]).toEqual({
      requestId: REQUEST_ID,
      suggestionIds: [pending.suggestionId],
      overrides: {
        [pending.suggestionId]: {
          subject: 'Reviewed release subject',
          bodyText: 'Dear Dr. Pending Invitee,\n\nWe have completed the reviewer slate. Thank you.',
          to: TEST_EMAIL,
          from: PROGRAM_DIRECTOR_EMAIL,
          senderId: PROGRAM_DIRECTOR_SYSTEMUSER_ID,
        },
      },
    });
    await expect(page.getByText('Released — no longer needed')).toBeVisible();
  });

  test('names an email failure in a partial-success release', async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL || 'http://localhost:3100';
    await installStaffSession(context, baseURL);
    const emailed = makeCandidate({
      suggestionId: '55555555-5555-4555-8555-555555555555',
      name: 'Dr. Emailed Reviewer',
      invited: true,
    });
    const failed = makeCandidate({
      suggestionId: '66666666-6666-4666-8666-666666666666',
      name: 'Dr. Failed Reviewer',
      email: 'failed@example.org',
      invited: true,
    });
    await installInviteMocks(context, baseURL, {
      candidates: [emailed, failed],
      withdrawStatuses: {
        [emailed.suggestionId]: 'withdrawn_emailed',
        [failed.suggestionId]: 'withdrawn_email_failed',
      },
    });

    await page.goto(workbenchUrl(baseURL));
    await page.getByLabel('Select Dr. Emailed Reviewer').check();
    await page.getByLabel('Select Dr. Failed Reviewer').check();
    await page.getByRole('button', { name: /review & release 2 as no longer needed/i }).click();

    const modal = page.locator('.fixed').filter({ hasText: 'Review release emails' });
    // exact: the draft textarea also contains the name ("Dear Dr. Failed Reviewer,"),
    // so a substring match resolves to two elements and trips strict mode.
    await expect(modal.getByText('Dr. Failed Reviewer', { exact: true })).toBeVisible();
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Send and release 2 reviewers?');
      await dialog.accept();
    });
    await modal.getByRole('button', { name: /send and release 2/i }).click();

    await expect(modal.getByText(/1 emailed\. 1 issue:/i)).toBeVisible();
    await expect(modal.getByText(/Dr\. Failed Reviewer — The reviewer was released, but the email failed/i)).toBeVisible();
    await expect(modal).toBeVisible();
  });
});
