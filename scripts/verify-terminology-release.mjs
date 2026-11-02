#!/usr/bin/env node
/**
 * Read-only release verification: latest GitHub Production deployment + exact
 * local runtime-source match + synthetic checks of the real legacy distribution guards.
 * Does not load .env files, authenticate to the application, or send live error
 * requests. A passing result is deployment/source/guard evidence, not a live
 * HTTP/browser acceptance test. Run with --expected-sha=<full commit SHA>.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY = 'justingallivan/wmkf-research-apps';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_PATHS = ['lib', 'shared', 'pages', 'modules', 'package-lock.json', 'next.config.js', 'proxy.js', 'vercel.json', 'scripts/lib/use-extensionless.mjs'];

export function validateSha(sha) {
  assert.match(sha || '', /^[a-f0-9]{40}$/i, 'Pass --expected-sha=<full 40-character commit SHA>.');
  return sha.toLowerCase();
}

export function verifyDeployment(deployments, statuses, expectedSha) {
  const deployment = deployments[0];
  assert(deployment, 'No Production deployment was reported.');
  assert.equal(deployment.environment, 'Production', 'The latest deployment must be Production.');
  assert.equal(deployment.sha, validateSha(expectedSha), 'Latest Production deployment differs from the expected revision; do not accept an older successful deployment.');
  assert.equal(statuses[0]?.state, 'success', 'Latest Production deployment has not succeeded (or was made inactive).');
  return { id: deployment.id, sha: deployment.sha, state: 'success', statusRecordedAt: statuses[0].created_at || null };
}

export function verifyRuntimeMatch(changedPaths) {
  assert.equal(changedPaths.trim(), '', `Local runtime differs from the deployed revision:\n${changedPaths}`);
}

export function verifyManifestMatch(expected, current) {
  // Only this new operator command may differ from the deployed manifest.
  // All other scripts, dependencies and module semantics must match; the
  // lockfile is compared byte-for-byte by the runtime diff.
  const prior = { ...expected, scripts: { ...expected.scripts } };
  const local = { ...current, scripts: { ...current.scripts } };
  delete prior.scripts['verify:terminology'];
  delete local.scripts['verify:terminology'];
  assert.deepEqual(local, prior, 'Package metadata/dependencies differ from the deployed revision.');
}

export function verifySyntheticGuards(normalize) {
  const base = { to: 'synthetic@example.test', cc: [], subject: 'Synthetic verification', bodyText: 'Synthetic input only. No delivery.' };
  const checks = [];
  function reject(name, extra, code, message) {
    assert.throws(() => normalize({ ...base, ...extra }), error => {
      assert.equal(error.httpStatus, 400, name);
      assert.equal(error.code, code, name);
      assert.equal(error.message, message, name);
      assert.deepEqual(error.body, { error: message, code }, name);
      return true;
    }, `${name} must reject the synthetic input.`);
    checks.push({ name, status: 'passed', httpStatus: 400, code });
  }
  reject('retired material links', { selectedMaterialIds: ['11111111-1111-4111-8111-111111111111'] },
    'distribution_material_links_retired',
    'Material links are no longer sent by email; the proposal review packet contains the presentation materials. Reload and prepare the preview again.');
  for (const attachmentMode of ['docx', 'pdf', 'both']) {
    reject(`retired attachment mode: ${attachmentMode}`, { attachmentMode },
      'distribution_attachment_mode_invalid',
      'Attachments are no longer sent; use the proposal review packet. Reload and prepare the preview again.');
  }
  reject('unknown attachment mode', { attachmentMode: 'zip' },
    'distribution_attachment_mode_invalid', 'The attachment mode is not recognized.');
  for (const attachmentMode of [undefined, '', 'none']) {
    const result = normalize({ ...base, attachmentMode });
    assert.equal(result.attachmentMode, 'none');
    assert.deepEqual(result.selectedMaterialIds, []);
    assert.equal(result.includeCalendar, false);
    assert.equal(result.siteVisitId, null);
    assert.equal(result.subject, base.subject);
    assert.equal(result.bodyText, base.bodyText);
    assert.deepEqual(result.recipients, { to: [base.to], cc: [] });
    checks.push({ name: `current client: ${attachmentMode ?? 'omitted'} mode`, status: 'passed' });
  }
  const calendarId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  const calendar = normalize({ ...base, includeCalendar: true, siteVisitId: calendarId });
  assert.equal(calendar.includeCalendar, true);
  assert.equal(calendar.siteVisitId, calendarId.toLowerCase());
  checks.push({ name: 'current calendar selection', status: 'passed' });
  return checks;
}

function command(binary, args, cwd = ROOT) {
  return execFileSync(binary, args, { cwd, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function github(path) {
  try { return JSON.parse(command('gh', ['api', path])); }
  catch { throw new Error('GitHub read failed. Check gh OAuth authentication, repository access, and network connectivity.'); }
}

export function verifyCheckout(expectedSha, root = ROOT) {
  validateSha(expectedSha);
  command('git', ['cat-file', '-e', `${expectedSha}^{commit}`], root);
  const changes = [
    command('git', ['diff', '--name-only', expectedSha, '--', ...RUNTIME_PATHS], root),
    command('git', ['diff', '--cached', '--name-only', expectedSha, '--', ...RUNTIME_PATHS], root),
    command('git', ['ls-files', '--others', '--exclude-standard', '--', ...RUNTIME_PATHS], root),
  ];
  verifyRuntimeMatch(changes.filter(Boolean).join('\n'));
  const prior = JSON.parse(command('git', ['show', `${expectedSha}:package.json`], root));
  verifyManifestMatch(prior, JSON.parse(command('git', ['show', ':package.json'], root)));
  verifyManifestMatch(prior, JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')));
}

export async function main(args = process.argv.slice(2)) {
  assert.equal(args.length, 1, 'Usage: npm run verify:terminology -- --expected-sha=<full commit SHA>');
  assert(args[0].startsWith('--expected-sha='), 'Only --expected-sha is accepted.');
  const expectedSha = validateSha(args[0].slice('--expected-sha='.length));
  verifyCheckout(expectedSha);
  const deployments = github(`repos/${REPOSITORY}/deployments?environment=Production&per_page=1`);
  assert(Number.isSafeInteger(deployments[0]?.id) && deployments[0].id > 0, 'No valid Production deployment ID was reported.');
  const statuses = github(`repos/${REPOSITORY}/deployments/${deployments[0].id}/statuses?per_page=1`);
  const deployment = verifyDeployment(deployments, statuses, expectedSha);
  const originalFetch = globalThis.fetch;
  let syntheticGuardChecks;
  try {
    globalThis.fetch = () => { throw new Error('Network access is forbidden during synthetic guard checks.'); };
    const { normalizeComposeInput } = await import('../lib/services/pre-site-visit/distribution/composition.js');
    syntheticGuardChecks = verifySyntheticGuards(normalizeComposeInput);
  } finally { globalThis.fetch = originalFetch; }
  return {
    status: 'passed', observedAt: new Date().toISOString(), repository: REPOSITORY,
    deploymentEvidence: 'latest GitHub-reported Production deployment', deployment,
    runtimeSourceMatchesRevision: true, syntheticGuardChecks,
    liveApplicationRequests: false, liveErrorResponsesTested: false,
    limitation: 'No live HTTP/browser error requests were made; synthetic checks exercise the matching deployed source locally.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(report => { console.log(JSON.stringify(report, null, 2)); }).catch(error => {
    console.error(JSON.stringify({ status: 'failed', error: error.message }));
    process.exitCode = 1;
  });
}
