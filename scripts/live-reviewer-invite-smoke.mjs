#!/usr/bin/env node
/**
 * Live reviewer invitation smoke-test wrapper.
 *
 * This script prepares and opens a REAL invitation smoke using a throwaway
 * reviewer candidate created by scripts/smoke-test-candidate.mjs. It never
 * clicks the final send button for you; the tester reviews the Workbench modal
 * and sends the real email manually.
 *
 * Safety:
 *   - requires LIVE_REVIEWER_EMAIL_SMOKE=true
 *   - requires --confirm-live-email for prepare/open
 *   - requires every target email to be in TEST_REVIEWER_EMAIL_ALLOWLIST
 *   - refuses EMERGENCY_AUTH_BYPASS=true
 *
 * Usage:
 *   TEST_REVIEWER_EMAIL_ALLOWLIST=you@example.org LIVE_REVIEWER_EMAIL_SMOKE=true \
 *     npm run smoke:reviewer-invite:live -- prepare --email you@example.org --confirm-live-email
 *
 *   npm run smoke:reviewer-invite:live -- open --base-url https://wmkfresearch.vercel.app --auth-state .auth/reviewer-invite-smoke.json --confirm-live-email
 *   npm run smoke:reviewer-invite:live -- cleanup
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { chromium } from 'playwright';

const STATE_PATH = path.join('scripts', '.smoke-test-candidate.json');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function help() {
  console.log(`Usage:
  node scripts/live-reviewer-invite-smoke.mjs prepare --email <allowlisted@test> [--request 1002788] --confirm-live-email
  node scripts/live-reviewer-invite-smoke.mjs open --base-url <app-url> [--auth-state .auth/reviewer-invite-smoke.json] --confirm-live-email
  node scripts/live-reviewer-invite-smoke.mjs cleanup
  node scripts/live-reviewer-invite-smoke.mjs status

Environment:
  LIVE_REVIEWER_EMAIL_SMOKE=true
  TEST_REVIEWER_EMAIL_ALLOWLIST=<comma-separated emails>

The final real email send is manual in the browser.`);
}

function splitAllowlist() {
  return String(process.env.TEST_REVIEWER_EMAIL_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function requireLiveGate() {
  if (process.env.EMERGENCY_AUTH_BYPASS === 'true') {
    throw new Error('Refusing to run with EMERGENCY_AUTH_BYPASS=true.');
  }
  if (process.env.LIVE_REVIEWER_EMAIL_SMOKE !== 'true') {
    throw new Error('Refusing to run: set LIVE_REVIEWER_EMAIL_SMOKE=true.');
  }
  if (!hasFlag('confirm-live-email')) {
    throw new Error('Refusing to run: add --confirm-live-email after verifying the target email is yours.');
  }
}

function assertAllowlisted(email) {
  const allowlist = splitAllowlist();
  if (!allowlist.length) {
    throw new Error('TEST_REVIEWER_EMAIL_ALLOWLIST is empty.');
  }
  if (!allowlist.includes(String(email || '').trim().toLowerCase())) {
    throw new Error(`Email ${email || '(missing)'} is not in TEST_REVIEWER_EMAIL_ALLOWLIST.`);
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { records: [] };
  }
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${process.execPath} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function prepare() {
  requireLiveGate();
  const email = arg('email');
  const request = arg('request', process.env.LIVE_REVIEWER_REQUEST_NUM || '1002788');
  if (!email || !/.+@.+\..+/.test(email)) throw new Error('prepare requires --email <test-address>');
  assertAllowlisted(email);

  await runNode(['scripts/smoke-test-candidate.mjs', 'create', email, request]);
  const state = readState();
  const row = state.records[0];
  if (row) {
    console.log('\nPrepared live reviewer invitation smoke candidate:');
    console.log(`  email: ${row.email}`);
    console.log(`  request: ${row.requestNum}`);
    console.log(`  suggestion: ${row.suggestionId}`);
    console.log('\nNext: run the open command, review the modal, and manually click Send invitation.');
  }
}

async function openWorkbench() {
  requireLiveGate();
  const state = readState();
  const row = state.records[0];
  if (!row) throw new Error('No smoke candidate state found. Run prepare first.');
  assertAllowlisted(row.email);

  const baseUrl = (arg('base-url', process.env.LIVE_REVIEWER_BASE_URL || '') || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('open requires --base-url <app-url> or LIVE_REVIEWER_BASE_URL.');

  const authState = arg('auth-state', process.env.PLAYWRIGHT_AUTH_STATE || '');
  const contextOptions = {};
  if (authState) {
    if (!fs.existsSync(authState)) throw new Error(`Auth state file not found: ${authState}`);
    contextOptions.storageState = authState;
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1240,820', '--window-position=80,80'],
  });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    const isExpectedInviteConfirm = dialog.type() === 'confirm'
      && /Send \d+ invitation/i.test(message)
      && message.includes('via Dynamics')
      && message.includes('real email');

    if (isExpectedInviteConfirm) {
      console.log(`[browser-dialog] accepting invitation send confirmation: ${message}`);
      await dialog.accept();
      return;
    }

    console.warn(`[browser-dialog] dismissing unexpected ${dialog.type()} dialog: ${message}`);
    await dialog.dismiss();
  });
  const url = `${baseUrl}/workbench/${row.requestId}?tab=reviewers&sub=candidates&n=${encodeURIComponent(row.requestNum)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  console.log('\nLive Workbench smoke browser is open:');
  console.log(`  ${url}`);
  console.log(`\nTarget test recipient: ${row.email}`);
  console.log('Review the candidate, send the invitation manually, then check your inbox.');
  console.log('Keep this terminal open while testing. Press Ctrl-C here when finished.');

  await new Promise((resolve) => {
    const stop = async () => {
      await browser.close().catch(() => {});
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function cleanup() {
  await runNode(['scripts/smoke-test-candidate.mjs', 'cleanup']);
}

function status() {
  const state = readState();
  if (!state.records.length) {
    console.log('No live reviewer invite smoke candidate is recorded.');
    return;
  }
  for (const row of state.records) {
    const allowlisted = splitAllowlist().includes(String(row.email || '').toLowerCase());
    console.log(`candidate: ${row.email} request=${row.requestNum} suggestion=${row.suggestionId} allowlisted=${allowlisted}`);
  }
}

const mode = process.argv[2];
try {
  if (hasFlag('help') || hasFlag('h') || !mode) {
    help();
  } else if (mode === 'prepare') {
    await prepare();
  } else if (mode === 'open') {
    await openWorkbench();
  } else if (mode === 'cleanup') {
    await cleanup();
  } else if (mode === 'status') {
    status();
  } else {
    help();
    process.exit(1);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
