#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Bash) guard — BLOCKS a `git commit` when status/enum producer↔consumer
 * parity is broken (scripts/check-status-enum-parity.js). This is the deterministic
 * control behind the contract-reconcile "complement & fan-out" rule: a written rule
 * can't fire itself, so the commit is the enforcement point.
 *
 * Fires only on commit (not every Bash call) to stay cheap. Fails OPEN on its own
 * errors — the /start gate run remains the backstop.
 */

const { execFileSync } = require('child_process');
const path = require('path');

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    // require INSIDE the try so a missing/broken helper fails OPEN (the catch
    // swallows it) rather than crashing the process with a non-2 exit whose
    // block/allow behavior is undefined for a PreToolUse hook (Codex S259 #1).
    const { isGitCommit } = require('./lib/git-commit-detect');
    const data = JSON.parse(input);
    if (!data || data.tool_name !== 'Bash') return;
    const cmd = (data.tool_input && data.tool_input.command) || '';
    // Only gate actual commits (any global-option form; not commit-tree/-graph).
    // `git commit --amend`, `-m`, heredoc, -F all count.
    if (!isGitCommit(cmd)) return;

    const root = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    try {
      execFileSync('node', [path.join(root, 'scripts/check-status-enum-parity.js')], {
        cwd: root, stdio: 'pipe', env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      });
    } catch (gateErr) {
      const out = `${gateErr.stdout || ''}${gateErr.stderr || ''}`.trim();
      console.error(
        'BLOCKED: status-enum-parity failed — a producer value has no matching consumer entry.\n'
        + out + '\n'
        + 'Add the value to the consumer surface (label map / filter bucket / count), then re-commit. '
        + '(Run `npm run check:status-enum-parity` to reproduce.)',
      );
      process.exit(2); // PreToolUse exit 2 → block the commit
    }
  } catch {
    // Fail open — never wedge commits on a guard bug.
  }
});
