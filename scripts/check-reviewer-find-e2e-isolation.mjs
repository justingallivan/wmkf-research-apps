#!/usr/bin/env node

/**
 * Sentinel self-test for the Reviewer Find Playwright launcher.
 *
 * The launcher is run as a separate process with deliberately dangerous parent
 * configuration. Its inspection mode reports only child key names and a
 * one-way fingerprint, never credential values. A pass proves the actual child
 * environment is a constructed allowlist rather than a filtered process.env.
 */

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(SCRIPT_DIR, 'reviewer-find-e2e-server.mjs');
const sentinel = 'reviewer-find-e2e-parent-sentinel-must-not-reach-child';
const PARENT_SENTINELS = Object.freeze({
  DYNAMICS_URL: `https://${sentinel}.example.test`,
  DYNAMICS_CLIENT_SECRET: sentinel,
  POSTGRES_URL: `postgres://${sentinel}`,
  BLOB_READ_WRITE_TOKEN: sentinel,
  CLAUDE_API_KEY: sentinel,
  SMTP_PASSWORD: sentinel,
  QSTASH_TOKEN: sentinel,
  NEXTAUTH_SECRET: sentinel,
});
const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const result = spawnSync(process.execPath, [launcher, '--inspect-child-env', '--port', '3217'], {
  cwd: path.resolve(SCRIPT_DIR, '..'),
  env: {
    ...process.env,
    ...PARENT_SENTINELS,
  },
  encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr || 'launcher inspection failed');
const report = JSON.parse(result.stdout);
assert.deepEqual(report.forbiddenChildKeys, [], 'a service credential or target leaked into the child');
assert.equal(report.syntheticNextAuth, true, 'the parent NextAuth sentinel was not replaced');
for (const key of Object.keys(PARENT_SENTINELS)) {
  if (key === 'NEXTAUTH_SECRET') {
    assert.notEqual(
      report.nextAuthFingerprint,
      fingerprint(PARENT_SENTINELS.NEXTAUTH_SECRET),
      'the parent NextAuth sentinel reached the child unchanged',
    );
  } else {
    assert.equal(report.childKeys.includes(key), false, `${key} parent sentinel leaked into the child`);
  }
}
assert.equal(report.localOnlyUrl, true, 'the child NextAuth URL is not local-only');
assert.equal(report.startupInstrumentationExcluded, true, 'effect-capable startup instrumentation entered the isolated root');

console.log('Reviewer Find E2E isolation self-test passed.');
