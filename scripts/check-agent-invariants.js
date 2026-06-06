#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveLink(linkPath) {
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return null;
    return fs.realpathSync(linkPath);
  } catch {
    return null;
  }
}

function expectedMemoryPath(repoRoot) {
  const slug = repoRoot.replace(/\//g, '-').replace(/_/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
}

function checkAgentInvariants(repoRoot, { trackedOnly = false } = {}) {
  const expected = [
    {
      name: 'AGENTS.md',
      path: path.join(repoRoot, 'AGENTS.md'),
      target: path.join(repoRoot, 'CLAUDE.md'),
      tracked: true,
    },
  ];

  if (!trackedOnly) {
    expected.push(
      {
        name: '.agents/skills',
        path: path.join(repoRoot, '.agents', 'skills'),
        target: path.join(repoRoot, '.claude', 'skills'),
        tracked: false,
      },
      {
        name: 'Claude memory store',
        path: expectedMemoryPath(repoRoot),
        target: path.join(repoRoot, '.claude-memory'),
        tracked: false,
      },
    );
  }

  return expected.map((item) => {
    const actual = resolveLink(item.path);
    const target = fs.realpathSync.native ? fs.realpathSync.native(item.target) : fs.realpathSync(item.target);
    return {
      ...item,
      actual,
      ok: actual === target,
      expectedTarget: target,
    };
  });
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const trackedOnly = process.argv.includes('--tracked-only');
  const results = checkAgentInvariants(repoRoot, { trackedOnly });
  const failures = results.filter((result) => !result.ok);

  if (failures.length === 0) {
    console.log(`Agent invariants OK: ${results.length} symlink(s)`);
    return 0;
  }

  console.error('Agent instruction invariant failure:');
  for (const result of failures) {
    const actual = result.actual || 'not a symlink / missing';
    console.error(`  - ${result.name}: expected ${result.expectedTarget}; found ${actual}`);
  }
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  checkAgentInvariants,
  expectedMemoryPath,
  resolveLink,
};
