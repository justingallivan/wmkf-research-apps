#!/usr/bin/env node

/**
 * Explicit opt-in launcher for the writeup-regeneration Sandbox service test.
 * It never supplies credentials or creates fixtures; it passes private paths
 * and the isolated local Postgres URL to one Jest test, which independently
 * validates the registered Sandbox target before importing application writers.
 *
 * This launcher is inert unless --execute is present. Use only after the
 * parent has reviewed the fixture and approved execution.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_TEST = path.join(ROOT, 'tests/integration/writeup-regeneration-sandbox.test.js');

function option(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function insideRepo(candidate) {
  const relative = path.relative(ROOT, path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

const args = process.argv.slice(2);
if (!args.includes('--execute')) {
  console.error('Refusing to start the service rehearsal without the explicit --execute flag.');
  process.exit(2);
}

const manifest = option('manifest');
const budget = option('budget');
const report = option('report');
const ledgerUrl = option('ledger-url');
if (![manifest, budget, report, ledgerUrl].every(Boolean)) {
  console.error('Usage: node scripts/rehearse-writeup-regeneration-sandbox.mjs --execute --manifest=/private/tmp/fixture.json --budget=/private/tmp/provider-budget.json --report=/private/tmp/result.json --ledger-url=postgres://127.0.0.1/...');
  process.exit(2);
}
for (const [label, candidate] of [['fixture manifest', manifest], ['provider budget', budget], ['report', report]]) {
  if (!path.isAbsolute(candidate) || insideRepo(candidate)) {
    console.error(`The ${label} must be an absolute path outside the repository.`);
    process.exit(2);
  }
}
let parsedLedger;
try { parsedLedger = new URL(ledgerUrl); } catch {
  console.error('The isolated rehearsal Postgres URL is invalid.');
  process.exit(2);
}
if (!['localhost', '127.0.0.1', '::1'].includes(parsedLedger.hostname)) {
  console.error('The rehearsal ledger must use a local loopback Postgres host.');
  process.exit(2);
}

const child = spawnSync(process.execPath, [
  path.join(ROOT, 'node_modules/jest/bin/jest.js'),
  '--runInBand', '--runTestsByPath', TARGET_TEST,
], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    WRITEUP_REGENERATION_SANDBOX_EXECUTE: 'on',
    WRITEUP_REGENERATION_SANDBOX_MANIFEST: path.resolve(manifest),
    WRITEUP_REGENERATION_PROVIDER_BUDGET: path.resolve(budget),
    WRITEUP_REGENERATION_SANDBOX_REPORT: path.resolve(report),
    WRITEUP_REGENERATION_LEDGER_URL: ledgerUrl,
  },
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
