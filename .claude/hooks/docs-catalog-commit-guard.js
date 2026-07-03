#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Bash) guard — BLOCKS a `git commit` when staged top-level docs or
 * docs-catalog tooling changes leave docs/DOCS_CATALOG.md stale or invalid.
 *
 * Fires only on commit and only when relevant staged paths changed, so ordinary
 * code commits do not pay for the docs catalog check.
 */

const { execFileSync } = require('child_process');
const path = require('path');

function stagedPaths(root) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

// PreToolUse fires BEFORE the Bash command runs, so in a compound
// `git add X && git commit` nothing is staged yet and the index read alone
// misses X (S322: two stale-catalog commits passed this way). Path-like tokens
// from the command string close that gap; the union keeps the plain
// `git add` -> separate `git commit` flow covered by the index as before.
function pathsFromCommand(cmd) {
  return String(cmd)
    .split(/\s+/)
    .map((t) => t.replace(/^["']+|["']+$/g, ''))
    .filter((t) => /^[\w.@-]+(\/[\w.@-]+)*\.\w+$/.test(t) || /^[\w.@-]+\//.test(t));
}

function touchesCatalogSurface(rel) {
  if (/^docs\/[^/]+\.md$/.test(rel)) return true;
  if (rel === 'package.json') return true;
  if (rel === '.github/workflows/test.yml') return true;
  if (rel === '.claude/settings.json') return true;
  if (rel === '.claude/hooks/docs-catalog-format-guard.js') return true;
  if (rel === '.claude/hooks/docs-catalog-commit-guard.js') return true;
  if (rel === 'scripts/check-docs-catalog.js') return true;
  if (rel === 'scripts/generate-docs-catalog.js') return true;
  if (rel === 'scripts/seed-docs-frontmatter.js') return true;
  if (rel === 'scripts/lib/docs-catalog.js') return true;
  return false;
}

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const { isGitCommit } = require('./lib/git-commit-detect');
    const data = JSON.parse(input || '{}');
    if (!data || data.tool_name !== 'Bash') return;
    const cmd = (data.tool_input && data.tool_input.command) || '';
    if (!isGitCommit(cmd)) return;

    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const candidates = new Set([...stagedPaths(root), ...pathsFromCommand(cmd)]);
    const relevant = [...candidates].filter(touchesCatalogSurface);
    if (!relevant.length) return;

    try {
      execFileSync('npm', ['run', 'check:docs-catalog'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      });
    } catch (gateErr) {
      const out = `${gateErr.stdout || ''}${gateErr.stderr || ''}`.trim();
      console.error(
        'BLOCKED: docs catalog is stale or invalid for staged documentation changes.\n' +
        `Relevant staged path(s): ${relevant.join(', ')}\n` +
        out + '\n' +
        'Fix top-level docs frontmatter, run `npm run generate:docs-catalog`, then `npm run check:docs-catalog`, and re-commit.',
      );
      process.exit(2);
    }
  } catch {
    // Fail open: CI still runs check:docs-catalog.
  }
});
