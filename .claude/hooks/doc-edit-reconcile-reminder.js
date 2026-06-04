#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Edit): reconcile-don't-patch reminder for durable docs.
 *
 * When EDITING a durable artifact (docs/, .claude-memory/, or a top-level
 * agent-instruction file), inject a non-blocking reminder to read the WHOLE file
 * and grep the repo for the same fact, then fix every instance in one pass —
 * NOT just the grep-targeted line. This is the "read the line, not the file"
 * failure mode that cost S219 three Codex review rounds.
 *
 * Fires on Edit only (Write = new file / full rewrite is less prone to the bug).
 * FAILS OPEN: any parse error / missing field exits 0 silently — never blocks an edit.
 */
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (!data || data.tool_name !== 'Edit') return;
    const ti = data.tool_input || {};
    const fp = typeof ti.file_path === 'string' ? ti.file_path : '';
    if (!fp) return;

    const base = fp.split('/').pop();
    const inScope =
      /(^|\/)docs\//.test(fp) ||
      /(^|\/)\.claude-memory\//.test(fp) ||
      ['CLAUDE.md', 'SESSION_PROMPT.md', 'AGENTS.md'].indexOf(base) !== -1;
    if (!inScope) return;

    const msg =
      'Reconcile, don\'t patch (durable-doc Edit): a fact usually appears in MORE than the line ' +
      'you are changing (frontmatter description/status, recall rule, body, lead-ins, tails, ' +
      'summaries). Before calling this fix done: confirm you have READ THE WHOLE FILE — not a ' +
      'grep-targeted slice — and GREPPED the repo for the same fact, then fix EVERY instance in ' +
      'one pass. A partial fix that leaves a contradiction elsewhere is worse than none. ' +
      'See feedback-reconcile-dont-append-docs.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // fail open — never block an edit
  }
});
