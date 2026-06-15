#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Bash) hook — pre-commit SELF-REVIEW checklist, fired at the commit
 * decision point and tailored to the STAGED diff.
 *
 * Motivation (S258): across a long build, Codex review repeatedly caught the same
 * self-catchable failure modes — most often a guard/validation applied in ONE place
 * but not its siblings, and contract facts asserted without reading the source.
 * Scattered per-edit reminders didn't prevent it; this fires once, at commit, with
 * the specific checks the staged files demand — so the fan-out is enumerated BEFORE
 * the review, not discovered during it.
 *
 * NON-BLOCKING (injects context, never exit 2): a checklist can't be machine-verified,
 * and a false block would wedge commits. FAILS OPEN on any error.
 */

const { execFileSync } = require('child_process');
const { isGitCommit, isAmend } = require('./lib/git-commit-detect');

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (!data || data.tool_name !== 'Bash') return;
    const cmd = (data.tool_input && data.tool_input.command) || '';
    if (!isGitCommit(cmd)) return;
    // Skip amends/no-op meta commits where a review checklist is noise.
    if (isAmend(cmd)) return;

    const root = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let staged = [];
    try {
      staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().split('\n').map((s) => s.trim()).filter(Boolean);
    } catch { return; }
    if (staged.length === 0) return;

    const isApi = staged.some((f) => /^pages\/api\/.*\.[jt]sx?$/.test(f));
    const isComponent = staged.some((f) => /\.(jsx|tsx)$/.test(f) || /^shared\/components\/.*\.js$/.test(f));
    const isService = staged.some((f) => /^lib\/(services|dataverse|db)\/.*\.[jt]s$/.test(f));
    const isDurableDoc = staged.some((f) => /^docs\//.test(f) || /^\.claude-memory\//.test(f) || /(CLAUDE|AGENTS|SESSION_PROMPT)\.md$/.test(f));

    // Only fire when the staged set is code/contract-bearing (skip pure chore/docs-only churn).
    if (!isApi && !isComponent && !isService && !isDurableDoc) return;

    const lines = [];
    lines.push('PRE-COMMIT SELF-REVIEW — confirm each before committing (these are the failure modes Codex kept catching; catch them here, not in a review round):');
    lines.push('1. VERIFY-DON\'T-ASSERT: every claim about how existing code/data behaves (a field, helper, return shape, enum) was confirmed by reading/grepping the source — not inferred. Label material claims [VERIFIED].');
    lines.push('2. FAN-OUT THE GUARD: any validation/guard/null-check/scope-check you added — grep for its SIBLINGS and confirm it is applied to ALL of them (the #1 repeat finding). Name the sibling sites you checked.');
    if (isApi) {
      lines.push('   • API routes staged: client input (requestId/ids/filters) is format-validated AND scoped to the authorized set before becoming a DB/SharePoint selector; raw upstream errors are sanitized; new/changed route reflected in docs/API_ROUTE_SECURITY_MATRIX.md (check:api-routes).');
    }
    if (isComponent) {
      lines.push('   • React components staged: every effect that fetches on a changing id resets + ignores stale responses (cancelled/token guard); external/LLM data is type-guarded before render (no object reaches a child).');
    }
    if (isService) {
      lines.push('   • Service/persistence staged: writes to shared durable state reason about concurrent interleavings (two writers, expiry mid-op, lost update); idempotency mechanism is NAMED, not assumed.');
    }
    if (isDurableDoc) {
      lines.push('   • Durable docs/memory staged: the fact was reconciled across EVERY restatement (grep the repo), not just the line in front of you.');
    }
    lines.push('3. SHIFT-LEFT: if a Codex/agent review is next, you should have already self-run the contract-reconcile + fan-out pass above so the review CONFIRMS rather than DISCOVERS.');

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: lines.join('\n') },
    }));
  } catch (e) {
    // fail open — never wedge a commit on a hook bug
  }
});
