#!/usr/bin/env node
/**
 * Save a headed Playwright browser auth state for live Workbench smoke tests.
 *
 * This does NOT bypass authentication. It opens a real browser, lets the tester
 * sign in normally, then stores cookies/local storage in a local ignored file.
 *
 * Usage:
 *   npm run smoke:reviewer-invite:auth -- --base-url https://wmkfresearch.vercel.app
 */
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { chromium } from 'playwright';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

if (hasFlag('help') || hasFlag('h')) {
  console.log(`Usage: node scripts/save-playwright-auth-state.mjs --base-url <app-url> [--state .auth/reviewer-invite-smoke.json]

Opens a headed browser for normal Microsoft sign-in and saves local auth state.
The .auth/ directory is gitignored because it contains session cookies.`);
  process.exit(0);
}

if (process.env.EMERGENCY_AUTH_BYPASS === 'true') {
  console.error('Refusing to run with EMERGENCY_AUTH_BYPASS=true. Use real sign-in for auth-state capture.');
  process.exit(1);
}

const baseUrl = (arg('base-url', process.env.LIVE_REVIEWER_BASE_URL || '') || '').replace(/\/$/, '');
const statePath = arg('state', process.env.PLAYWRIGHT_AUTH_STATE || '.auth/reviewer-invite-smoke.json');

if (!baseUrl) {
  console.error('Missing --base-url. Example: --base-url https://wmkfresearch.vercel.app');
  process.exit(1);
}

fs.mkdirSync(path.dirname(statePath), { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ['--window-size=1240,820', '--window-position=80,80'],
});
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${baseUrl}/workbench`, { waitUntil: 'domcontentloaded' });

console.log('\nA browser is open for normal staff sign-in.');
console.log('After you are signed in and can see the Workbench, return here and press Enter.');
const rl = createInterface({ input, output });
await rl.question('Press Enter after sign-in is complete...');
rl.close();

await context.storageState({ path: statePath });
await browser.close();

console.log(`Saved Playwright auth state to ${statePath}`);
console.log('Keep this file local. It contains active browser session data.');
