'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { isForbiddenTrackedPath } = require('./validate-publication-boundary');

const REPO_ROOT = path.resolve(__dirname, '../..');
const BENCHMARK_ROOT = 'benchmarks/institution-resolution-readiness';

function trackedFiles(repoRoot = REPO_ROOT) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  return result.stdout.split('\0').filter(Boolean);
}

function assertNoForbiddenTrackedArtifacts({ repoRoot = REPO_ROOT, privateRoot = null } = {}) {
  const tracked = trackedFiles(repoRoot);
  const benchmarkFiles = tracked.filter((file) => file === BENCHMARK_ROOT || file.startsWith(`${BENCHMARK_ROOT}/`));
  const violations = benchmarkFiles.filter((file) => {
    const relative = file.slice(BENCHMARK_ROOT.length).replace(/^\//, '');
    return isForbiddenTrackedPath(relative, privateRoot);
  });
  if (privateRoot) {
    const normalizedPrivate = String(privateRoot).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    violations.push(...tracked.filter((file) => file === normalizedPrivate || file.startsWith(`${normalizedPrivate}/`)));
  }
  const unique = [...new Set(violations)];
  if (unique.length) {
    throw new Error(`forbidden private evaluation artifacts are tracked:\n- ${unique.join('\n- ')}`);
  }
  return benchmarkFiles.length;
}

if (require.main === module) {
  const privateRootFlag = process.argv.find((arg) => arg.startsWith('--private-root='));
  const privateRoot = privateRootFlag ? privateRootFlag.slice('--private-root='.length) : null;
  const count = assertNoForbiddenTrackedArtifacts({ privateRoot });
  process.stdout.write(`Checked ${count} tracked readiness-harness files.\n`);
}

module.exports = {
  assertNoForbiddenTrackedArtifacts,
  trackedFiles,
};
