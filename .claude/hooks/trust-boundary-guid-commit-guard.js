#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Bash) guard — BLOCKS a `git commit` when a client-supplied id reaches
 * a Dataverse record-id selector without a GUID guard
 * (scripts/check-trust-boundary-guid.js). This is the blocking enforcement for the
 * trust-boundary failure mode Codex repeatedly caught (S259): a guard applied to
 * one route but not its siblings ("fan-out"). The advisory self-review hook can
 * only remind; this converts the most damaging, statically-detectable case into a
 * hard stop — and, unlike the reminder, can't be ignored.
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
    const data = JSON.parse(input);
    if (!data || data.tool_name !== 'Bash') return;
    const cmd = (data.tool_input && data.tool_input.command) || '';
    // Only gate actual commits. `git commit --amend`, `-m`, heredoc, -F all contain "git commit".
    if (!/\bgit\s+commit\b/.test(cmd)) return;

    const root = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    try {
      execFileSync('node', [path.join(root, 'scripts/check-trust-boundary-guid.js')], {
        cwd: root, stdio: 'pipe', env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      });
    } catch (gateErr) {
      const out = `${gateErr.stdout || ''}${gateErr.stderr || ''}`.trim();
      console.error(
        'BLOCKED: trust-boundary-guid failed — a client-supplied id reaches a Dataverse selector without a GUID guard.\n'
        + out + '\n'
        + 'Add `if (!isGuid(<id>)) return res.status(400)...` (or allGuids for arrays) before the selector, then re-commit. '
        + '(Run `npm run check:trust-boundary-guid` to reproduce.)',
      );
      process.exit(2); // PreToolUse exit 2 → block the commit
    }
  } catch {
    // Fail open — never wedge commits on a guard bug.
  }
});
