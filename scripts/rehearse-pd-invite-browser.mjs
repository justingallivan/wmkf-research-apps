#!/usr/bin/env node
/**
 * Safe headed browser rehearsal for the Program Director reviewer-invite flow.
 *
 * Builds and starts a local production Next server, route-mocks the Workbench
 * reviewer-invite APIs at the browser boundary, and opens the real Candidates
 * UI. No Dataverse, Dynamics email, Blob, or SharePoint request is allowed
 * through for the mocked invitation/reviewer routes.
 *
 * Usage:
 *   npm run rehearse:reviewer-invite:browser
 *   node scripts/rehearse-pd-invite-browser.mjs --port 3110
 */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { setTimeout as delay } from 'timers/promises';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { buildContext } = require('../tests/e2e/helpers/reviewer-portal');

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_NUM = '1002788';
const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const PENDING_SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const ACCEPTED_SUGGESTION_ID = '33333333-3333-4333-8333-333333333333';
const REVIEW_TOKEN = 'pd-rehearsal-reviewer-token';
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'pd-rehearsal-nextauth-secret-32-chars';
const TEST_REVIEWER_EMAIL = process.env.PD_INVITE_REHEARSAL_EMAIL || 'berets.eyeful-0f@icloud.com';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

if (hasFlag('help') || hasFlag('h')) {
  console.log(`Usage: node scripts/rehearse-pd-invite-browser.mjs [--port 3110] [--keep-server]

Opens a headed browser on a local, mocked Program Director invitation flow.
Safe: no real Dataverse, Dynamics email, Blob, or SharePoint calls are made.`);
  process.exit(0);
}

if (process.env.EMERGENCY_AUTH_BYPASS === 'true') {
  console.error('Refusing to run with EMERGENCY_AUTH_BYPASS=true. This rehearsal does not need it.');
  process.exit(1);
}

const PORT = Number(arg('port', process.env.PD_INVITE_REHEARSAL_PORT || '3110'));
const BASE_URL = `http://localhost:${PORT}`;
const KEEP_SERVER = hasFlag('keep-server');

const candidate = {
  suggestionId: SUGGESTION_ID,
  name: 'Dr. New Candidate (not invited)',
  affiliation: 'Example University',
  email: TEST_REVIEWER_EMAIL,
  invited: false,
  accepted: false,
  declined: false,
  reasoning: 'Strong fit for the proposal area and available for this cycle.',
  keywords: 'cell biology; instrumentation',
  applicantRecommended: false,
  manualAdded: false,
  googleScholarUrl: 'https://scholar.google.com/',
  website: 'https://example.edu/faculty/capture-candidate',
};

const pendingCandidate = {
  suggestionId: PENDING_SUGGESTION_ID,
  name: 'Dr. Pending Invitee (already invited)',
  affiliation: 'Example Institute',
  email: 'pending.reviewer@example.edu',
  invited: true,
  accepted: false,
  declined: false,
  emailSentAt: '2026-07-01T00:00:00Z',
  reasoning: 'Already invited, still awaiting a response. Useful for testing the no-longer-needed release.',
  keywords: 'bioengineering; imaging',
  applicantRecommended: false,
  manualAdded: false,
  googleScholarUrl: 'https://scholar.google.com/',
  website: 'https://example.edu/faculty/pending-invitee',
};

const acceptedReviewer = {
  suggestionId: ACCEPTED_SUGGESTION_ID,
  name: 'Dr. Accepted Reviewer (awaiting materials)',
  affiliation: 'Example University',
  email: 'accepted.reviewer@example.edu',
  reviewStatus: 'accepted',
  tokenState: 'active',
  tokenExpiresAt: '2026-08-01T00:00:00Z',
  reminderCount: 0,
  notes: '',
};

function sseResult(result) {
  return [
    'event: progress',
    `data: ${JSON.stringify({ current: result.stats.sent, total: result.stats.total, message: 'Captured email' })}`,
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

async function waitForBuild(child) {
  const code = await new Promise((resolve) => {
    child.on('exit', resolve);
  });
  if (code !== 0) {
    throw new Error(`next build exited with code ${code}`);
  }
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`next start exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${url}/api/auth/status`);
      if (res.ok) return;
    } catch {
      // server still warming
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function installMocks(context) {
  let reviewerContext = buildContext({ longBody: true });
  let candidates = [candidate, pendingCandidate];
  let reviewers = [acceptedReviewer];
  let campaignConfig = {
    respondOffsetDays: 7,
    reviewDueDate: '2026-07-22',
    respondReminderEnabled: true,
    respondReminderLeadDays: 1,
    reviewDueReminderEnabled: true,
    reviewDueReminderLeadDays: 3,
    desiredCount: 1,
    quotaNotifiedAt: null,
  };
  const reviewerUrl = `${BASE_URL}/external/review/${REVIEW_TOKEN}`;
  const recipientFor = (suggestionId) => (
    candidates.find((c) => c.suggestionId === suggestionId)
    || reviewers.find((r) => r.suggestionId === suggestionId)
  );

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
          reviewDeadline: campaignConfig.reviewDueDate,
          reviewers,
        }],
      }),
    }));
  await context.route('**/api/reviewer-finder/my-candidates**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ proposals: [{ proposalId: REQUEST_ID, candidates }] }),
    }));
  await context.route('**/api/review-manager/campaign-config**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requestId: REQUEST_ID, config: campaignConfig }),
      });
    }
    const body = route.request().postDataJSON();
    campaignConfig = { ...campaignConfig, ...body.config };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, requestId: REQUEST_ID, config: campaignConfig }),
    });
  });
  await context.route('**/api/review-manager/withdraw-sufficient', (route) => {
    const body = route.request().postDataJSON();
    const ids = new Set(body.suggestionIds || []);
    candidates = candidates.map((c) => (
      ids.has(c.suggestionId) ? { ...c, responseType: 'withdrawn_sufficient' } : c
    ));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        withdrawn: ids.size,
        results: [...ids].map((suggestionId) => ({ suggestionId, status: 'withdrawn_no_pd' })),
      }),
    });
  });
  await context.route('**/api/review-manager/render-emails', (route) => {
    const body = route.request().postDataJSON();
    const drafts = (body.suggestionIds || []).map((suggestionId) => {
      const recipient = recipientFor(suggestionId);
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
          ? 'Reviewer materials'
          : 'Reviewer invitation',
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
        emailConfidence: { level: 'high', reason: 'confirmed_identity' },
      };
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ drafts }),
    });
  });
  await context.route('**/api/review-manager/send-emails', (route) => {
    const body = route.request().postDataJSON();
    const sent = (body.drafts || []).map((draft) => {
      const recipient = recipientFor(draft.suggestionId);
      if (body.templateType === 'materials') {
        reviewers = reviewers.map((r) => (
          r.suggestionId === draft.suggestionId
            ? { ...r, reviewStatus: 'materials_sent', materialsSentAt: '2026-07-08T00:00:00Z' }
            : r
        ));
      } else if (body.templateType === 'invitation') {
        candidates = candidates.map((c) => (
          c.suggestionId === draft.suggestionId
            ? { ...c, invited: true, emailSentAt: '2026-07-08T00:00:00Z' }
            : c
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
            `<table role="presentation"><tr><td><a href="${reviewerUrl}">Respond to Invitation</a></td></tr></table>`,
            `<p>If the button does not work, copy and paste this link: <a href="${reviewerUrl}">${reviewerUrl}</a></p>`,
            '</main>',
          ].join(''),
        },
      };
    });
    const result = {
      sent,
      failed: [],
      skipped: [],
      stats: { sent: sent.length, failed: 0, skipped: 0, total: sent.length },
    };
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseResult(result) });
  });

  await context.route(`**/api/external/review/${REVIEW_TOKEN}/context`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reviewerContext) }));
  await context.route(`**/api/external/review/${REVIEW_TOKEN}/respond`, async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'accept') {
      reviewerContext = buildContext({ view: 'accepted-pre-materials' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, idempotent: false, engagementState: reviewerContext.engagementState }),
    });
  });
}

const serverEnv = {
  ...process.env,
  NEXTAUTH_URL: BASE_URL,
  NEXTAUTH_SECRET,
  EXTERNAL_LINK_SECRET: process.env.EXTERNAL_LINK_SECRET || 'pd-rehearsal-external-link-secret-32-chars',
  REVIEWER_PORTAL_BASE_URL: BASE_URL,
};

const startEnv = {
  ...serverEnv,
  // Keep the local rehearsal on the repo's non-production auth-off path. This
  // avoids EMERGENCY_AUTH_BYPASS and avoids requiring a real Microsoft login.
  NODE_ENV: 'development',
  AUTH_REQUIRED: 'false',
};

let server;
const build = spawn('npx', ['next', 'build', '--webpack'], {
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});

build.stdout.on('data', (chunk) => process.stdout.write(`[next-build] ${chunk}`));
build.stderr.on('data', (chunk) => process.stderr.write(`[next-build] ${chunk}`));

function startServer() {
  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    env: startEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stdout.write(`[next-start] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[next-start] ${chunk}`));
}

function killServer() {
  if (server && server.exitCode == null) {
    server.kill('SIGTERM');
  }
}

/*
 * Keep the startup path aligned with playwright.config.js for the build step.
 * `next dev --webpack` currently fails on the instrumentation.js node-only
 * import chain, while `next build --webpack && next start` serves the same pages
 * cleanly. NODE_ENV=development is local-only so the normal auth-off dev switch
 * works without EMERGENCY_AUTH_BYPASS.
 */
async function prepareServer() {
  await waitForBuild(build);
  startServer();
}

let browser;
let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  if (browser) await browser.close().catch(() => {});
  if (!KEEP_SERVER) killServer();
}
process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });

try {
  await prepareServer();
  await waitForServer(BASE_URL, server);
  browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1240,820', '--window-position=80,80'],
  });
  const context = await browser.newContext({ viewport: { width: 1240, height: 740 } });
  await installMocks(context);
  const page = await context.newPage();
  page.on('dialog', async (dialog) => {
    console.log(`[browser-dialog] ${dialog.type()}: ${dialog.message()}`);
    console.log('Respond to this dialog in the browser window to continue.');
  });
  const workbenchUrl = `${BASE_URL}/workbench/${REQUEST_ID}?tab=reviewers&sub=candidates&n=${REQUEST_NUM}`;
  await page.goto(workbenchUrl, { waitUntil: 'domcontentloaded' });
  console.log('\nProgram Director invite rehearsal is open:');
  console.log(`  ${workbenchUrl}`);
  console.log('\nSafe mocks are active for Workbench invite APIs and the reviewer portal APIs.');
  console.log('Try these sandboxed UI paths:');
  console.log('  1. Candidates: select Dr. New Candidate (not invited) -> Send invitation -> fill dates -> Send.');
  console.log('  2. Campaign settings: edit Days to respond / Review due date -> Save.');
  console.log('  3. Invite tab: Release to reviewers -> Preview -> Send.');
  console.log('  4. Candidates: select Dr. Pending Invitee (already invited) -> Release as no longer needed.');
  console.log('     Pending invitees are nudged automatically by the respond-by reminder cron; there is no manual re-invite button.');
  console.log('  5. Open the captured local reviewer link to inspect the reviewer-facing accept page.');
  console.log('\nPress Ctrl-C in this terminal when finished.');
  await new Promise(() => {});
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  await shutdown();
  process.exit(1);
}
