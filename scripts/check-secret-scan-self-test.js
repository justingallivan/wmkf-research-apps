#!/usr/bin/env node
'use strict';

/**
 * Binding self-test for scripts/check-secret-scan.js.
 *
 * Unit-tests the detector, then writes temporary fixtures into a tracked
 * location and asserts the real gate fails on a synthetic real-looking secret,
 * passes on fake/test-marked placeholders, and passes on the live baseline.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { scanText, readTrackedSecretNames, assignmentRegexFor } = require('./check-secret-scan.js');

const repoRoot = path.resolve(__dirname, '..');
const gatePath = path.join(repoRoot, 'scripts', 'check-secret-scan.js');
const failures = [];
function check(name, cond) { if (!cond) failures.push(name); }

const secretNames = readTrackedSecretNames();
const assignmentRe = assignmentRegexFor(secretNames);
const scan = (text) => scanText(text, 'fixture.env', { secretNames, assignmentRe });

const anthroPrefix = 'sk-ant-api03-';
const highEntropy = 'A7b9_CdEfGhIjKlMnOpQrStUvWxYz0123456789_-LmNoPqRsTuVwXyZaBcDeFgHiJkL9876543210_QwErTyUiOpAsDfGhJkLzXcVbNm';
const realAnthropic = anthroPrefix + highEntropy;
const fakeAnthropic = anthroPrefix + 'test-placeholder-short';
const realBlob = 'vercel_blob_rw_storealpha_' + highEntropy;
const fakeBlob = 'vercel_blob_rw_TESTSTORE_teststubsecret';
const realGenericSecret = 'NxtAuth-' + highEntropy;

check('real-looking Anthropic key is flagged', scan('CLAUDE_API_KEY=' + realAnthropic).length === 1);
check('short/test Anthropic fixture is ignored', scan('CLAUDE_API_KEY=' + fakeAnthropic).length === 0);
check('real-looking Vercel Blob token is flagged', scan('INTAKE_BLOB_RW_TOKEN=' + realBlob).length === 1);
check('test Vercel Blob token is ignored', scan('INTAKE_BLOB_RW_TOKEN=' + fakeBlob).length === 0);
check('secret-named env assignment with high entropy is flagged', scan('NEXTAUTH_SECRET=' + realGenericSecret).length === 1);
check('placeholder env assignment is ignored', scan('NEXTAUTH_SECRET=your_nextauth_secret_here').length === 0);
check('AWS example marker is ignored', scan('AWS_KEY=AKIAIOSFODNN7EXAMPLE').length === 0);
check('AWS access key shape is flagged', scan('AWS_KEY=AKIA1B2C3D4E5F6G7H8I').length === 1);
check('private key header is flagged', scan('-----BEGIN PRIVATE KEY-----').length === 1);
check('placeholder private key header is ignored', scan('example: -----BEGIN PRIVATE KEY-----').length === 0);

const tmpRel = path.join('docs', 'agent-wiki', '_secret_scan_selftest_tmp');
const tmpAbs = path.join(repoRoot, tmpRel);
function cleanup() { if (fs.existsSync(tmpAbs)) fs.rmSync(tmpAbs, { recursive: true, force: true }); }
function runGate() {
  try {
    return { status: 0, output: execSync(`node ${JSON.stringify(gatePath)}`, {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SECRET_SCAN_INCLUDE_SELFTEST_TMP: tmpRel },
    }) };
  } catch (e) { return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') }; }
}

try {
  cleanup();
  fs.mkdirSync(tmpAbs, { recursive: true });

  fs.writeFileSync(path.join(tmpAbs, 'leaked.env'), `CLAUDE_API_KEY=${realAnthropic}\n`);
  const dirty = runGate();
  check('gate FAILS on a real-looking temp secret', dirty.status !== 0);

  fs.writeFileSync(path.join(tmpAbs, 'leaked.env'), `CLAUDE_API_KEY=${fakeAnthropic}\nINTAKE_BLOB_RW_TOKEN=${fakeBlob}\n`);
  const cleanFixture = runGate();
  check('gate PASSES on fake/test-marked temp secrets', cleanFixture.status === 0);
} finally {
  cleanup();
}

let baselineStatus = 0;
let baselineOut = '';
try {
  baselineOut = execSync(`node ${JSON.stringify(gatePath)}`, {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) { baselineStatus = e.status || 1; baselineOut = (e.stdout || '') + (e.stderr || ''); }
check('live baseline is clean', baselineStatus === 0);

if (failures.length) {
  console.error('secret-scan self-test FAILED:\n  - ' + failures.join('\n  - '));
  if (baselineStatus !== 0) console.error('\nBaseline gate output:\n' + baselineOut);
  process.exit(1);
}
console.log('secret-scan self-test OK — real-looking secrets flagged, fake fixtures allowed, baseline clean.');
