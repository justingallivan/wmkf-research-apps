/** @jest-environment node */
import { normalizeComposeInput } from '../../lib/services/pre-site-visit/distribution/composition.js';
import { validateSha, verifyDeployment, verifyRuntimeMatch, verifyManifestMatch, verifySyntheticGuards } from '../../scripts/verify-terminology-release.mjs';

const SHA = '73d270b935e136928502e28829e7522b41cc5cb9';
const OTHER = '78c965b1848c23f8f9e74bc6858e410b7ad6217e';
const deployment = { id: 123, environment: 'Production', sha: SHA };

test('accepts only a full pinned commit SHA', () => {
  expect(validateSha(SHA.toUpperCase())).toBe(SHA);
  for (const value of ['', 'main', SHA.slice(0, 9), '--help']) expect(() => validateSha(value)).toThrow();
});

test('requires the latest reported Production deployment at the pinned SHA', () => {
  expect(verifyDeployment([deployment], [{ state: 'success', created_at: '2026-11-02T03:11:01Z' }], SHA))
    .toMatchObject({ id: 123, sha: SHA, state: 'success' });
  // An older successful expected deployment must not mask a newer revision.
  expect(() => verifyDeployment([{ ...deployment, sha: OTHER }, deployment], [{ state: 'success' }], SHA)).toThrow();
  expect(() => verifyDeployment([{ ...deployment, environment: 'Preview' }], [{ state: 'success' }], SHA)).toThrow();
  expect(() => verifyDeployment([], [], SHA)).toThrow();
});

test.each(['pending', 'queued', 'in_progress', 'failure', 'error', 'inactive'])('does not accept latest deployment status %s or fall back to an old success', state => {
  expect(() => verifyDeployment([deployment], [{ state }, { state: 'success' }], SHA)).toThrow();
});

test('missing deployment status fails closed', () => {
  expect(() => verifyDeployment([deployment], [], SHA)).toThrow();
});

test('runtime drift is rejected rather than testing unrelated local code', () => {
  expect(() => verifyRuntimeMatch('')).not.toThrow();
  expect(() => verifyRuntimeMatch('lib/services/pre-site-visit/distribution/composition.js\n')).toThrow();
});

test('only the verifier command alias may differ in package metadata', () => {
  const prior = { name: 'app', dependencies: { next: '16.0.0' }, type: 'commonjs', scripts: { test: 'jest' } };
  const current = { ...prior, scripts: { ...prior.scripts, 'verify:terminology': 'node verifier.mjs' } };
  expect(() => verifyManifestMatch(prior, current)).not.toThrow();
  expect(() => verifyManifestMatch(prior, { ...current, dependencies: { next: '17.0.0' } })).toThrow();
  expect(() => verifyManifestMatch(prior, { ...current, type: 'module' })).toThrow();
  expect(() => verifyManifestMatch(prior, { ...current, scripts: { ...current.scripts, test: 'changed command' } })).toThrow();
});

test('the actual runtime guards and current-client/calendar complements pass all nine checks without network access', () => {
  const original = global.fetch;
  global.fetch = jest.fn(() => { throw new Error('Unexpected network request'); });
  try {
    const checks = verifySyntheticGuards(normalizeComposeInput);
    expect(checks).toHaveLength(9);
    expect(checks.every(check => check.status === 'passed')).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  } finally { global.fetch = original; }
});

test.each(['code', 'httpStatus', 'message', 'body'])('the verifier detects a changed legacy error %s', field => {
  const changed = input => {
    try { return normalizeComposeInput(input); }
    catch (error) {
      error[field] = field === 'httpStatus' ? 409 : field === 'body' ? { error: 'changed', code: error.code } : 'changed';
      throw error;
    }
  };
  expect(() => verifySyntheticGuards(changed)).toThrow();
});

test('accepting retired requests instead of rejecting them is detected', () => {
  expect(() => verifySyntheticGuards(() => ({ attachmentMode: 'none' }))).toThrow();
});

test('dropping the current calendar choice is detected', () => {
  const changed = input => {
    const result = normalizeComposeInput(input);
    if (input.includeCalendar) result.includeCalendar = false;
    return result;
  };
  expect(() => verifySyntheticGuards(changed)).toThrow();
});

// Exercise real git states so a source match cannot silently overlook staged
// edits or untracked runtime files. All writes stay in a disposable local repo.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyCheckout } from '../../scripts/verify-terminology-release.mjs';

function fixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), 'terminology-verifier-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Synthetic verifier test');
  git('config', 'user.email', 'synthetic@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(root, 'no-hooks'));
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'lib/runtime.js'), 'original\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-verifier', scripts: {}, dependencies: {} }));
  git('add', '.');
  git('commit', '-m', 'Synthetic fixture');
  return { root, git, sha: git('rev-parse', 'HEAD') };
}

test.each(['working tree', 'index only', 'untracked runtime', 'package dependency'])('checkout matching rejects %s drift', kind => {
  const fixture = fixtureRepository();
  try {
    expect(() => verifyCheckout(fixture.sha, fixture.root)).not.toThrow();
    if (kind === 'working tree') writeFileSync(join(fixture.root, 'lib/runtime.js'), 'changed\n');
    if (kind === 'index only') {
      writeFileSync(join(fixture.root, 'lib/runtime.js'), 'changed\n');
      fixture.git('add', 'lib/runtime.js');
      writeFileSync(join(fixture.root, 'lib/runtime.js'), 'original\n');
    }
    if (kind === 'untracked runtime') writeFileSync(join(fixture.root, 'lib/untracked.js'), 'unexpected\n');
    if (kind === 'package dependency') writeFileSync(join(fixture.root, 'package.json'), JSON.stringify({ name: 'synthetic-verifier', scripts: {}, dependencies: { unexpected: '1.0.0' } }));
    expect(() => verifyCheckout(fixture.sha, fixture.root)).toThrow();
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
