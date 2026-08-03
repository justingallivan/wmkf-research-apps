#!/usr/bin/env node
/**
 * Save a headed Playwright browser auth state for live Workbench smoke tests.
 *
 * This does NOT bypass authentication. It opens a real browser, lets the tester
 * sign in normally, then stores cookies/local storage in a local ignored file.
 *
 * Usage:
 *   npm run smoke:reviewer-invite:auth -- --base-url https://wmkfresearch.vercel.app
 *   npm run smoke:reviewer-find:auth -- --base-url https://wmkfresearch.vercel.app
 */
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

if (hasFlag('help') || hasFlag('h')) {
  console.log(`Usage: node scripts/save-playwright-auth-state.mjs --base-url <app-url> [--state .auth/reviewer-invite-smoke.json] [--require-reviewers-access]

Opens a headed browser for normal Microsoft sign-in. After Enter, it verifies
the session before saving local auth state. --require-reviewers-access also
verifies the normal staff Reviewer Find entitlement.
The .auth/ directory is gitignored because it contains session cookies.`);
  process.exit(0);
}

if (process.env.EMERGENCY_AUTH_BYPASS === 'true') {
  console.error('Refusing to run with EMERGENCY_AUTH_BYPASS=true. Use real sign-in for auth-state capture.');
  process.exit(1);
}

const baseUrl = (arg('base-url', process.env.LIVE_REVIEWER_BASE_URL || '') || '').replace(/\/$/, '');
const requireReviewersAccess = hasFlag('require-reviewers-access');
const READINESS_TIMEOUT_MS = 60_000;
const READINESS_POLL_MS = 1_000;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_STATE_DIRECTORY = path.join(REPOSITORY_ROOT, '.auth');
const AUTH_STATE_DIRECTORY_MODE = 0o700;
const AUTH_STATE_FILE_MODE = 0o600;

function resolveAuthStatePath(value) {
  const requested = path.resolve(REPOSITORY_ROOT, value || '.auth/reviewer-invite-smoke.json');
  const relative = path.relative(AUTH_STATE_DIRECTORY, requested);
  if (
    !relative
    || path.dirname(relative) !== '.'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || path.extname(relative).toLowerCase() !== '.json'
  ) {
    throw new Error('Auth state path must be a JSON file directly under .auth/.');
  }
  return requested;
}

function ensureAuthStateTarget(statePath) {
  fs.mkdirSync(AUTH_STATE_DIRECTORY, {
    recursive: true,
    mode: AUTH_STATE_DIRECTORY_MODE,
  });
  const directory = fs.lstatSync(AUTH_STATE_DIRECTORY);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('Auth state directory must be a real local .auth/ directory.');
  }
  fs.chmodSync(AUTH_STATE_DIRECTORY, AUTH_STATE_DIRECTORY_MODE);

  try {
    const existing = fs.lstatSync(statePath);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('Auth state path must be a regular local file.');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const statePath = resolveAuthStatePath(
  arg('state', process.env.PLAYWRIGHT_AUTH_STATE || '.auth/reviewer-invite-smoke.json'),
);

if (!baseUrl) {
  console.error('Missing --base-url. Example: --base-url https://wmkfresearch.vercel.app');
  process.exit(1);
}

ensureAuthStateTarget(statePath);

async function readAuthReadiness(page) {
  return page.evaluate(async ({ needsReviewersAccess }) => {
    const readJson = async (relativePath) => {
      const response = await fetch(relativePath, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { ok: response.ok, body };
    };
    const session = await readJson('/api/auth/session');
    if (!session.ok || !session.body?.user) return { ready: false };
    if (!needsReviewersAccess) return { ready: true };
    const access = await readJson('/api/app-access');
    return {
      ready: access.ok && Array.isArray(access.body?.apps) && access.body.apps.includes('reviewers'),
    };
  }, { needsReviewersAccess: requireReviewersAccess });
}

async function waitForVerifiedReadiness(page) {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await page.goto(`${baseUrl}/workbench`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      const readiness = await readAuthReadiness(page);
      if (readiness.ready) return true;
    } catch {
      // Microsoft may still be completing its normal redirect. Do not save
      // storage state until an authenticated first-party session is confirmed.
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_POLL_MS));
  }
  return false;
}

const browser = await chromium.launch({
  headless: false,
  args: ['--window-size=1240,820', '--window-position=80,80'],
});
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${baseUrl}/workbench`, { waitUntil: 'domcontentloaded' });

console.log('\nA browser is open for normal staff sign-in.');
console.log('After you are signed in and can see the Workbench, return here and press Enter.');
console.log('Enter starts a bounded verification; it does not save credentials by itself.');
const rl = createInterface({ input, output });
await rl.question('Press Enter after sign-in is complete...');
rl.close();

const ready = await waitForVerifiedReadiness(page);
if (!ready) {
  await browser.close();
  console.error(requireReviewersAccess
    ? 'Reviewer Find access was not verified within 60 seconds; auth state was not saved.'
    : 'A signed-in staff session was not verified within 60 seconds; auth state was not saved.');
  process.exit(1);
}

await context.storageState({ path: statePath });
fs.chmodSync(statePath, AUTH_STATE_FILE_MODE);
await browser.close();

console.log(`Saved Playwright auth state to ${statePath}`);
console.log('Keep this file local. It contains active browser session data.');
