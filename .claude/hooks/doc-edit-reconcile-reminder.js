#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Edit): reconcile-don't-patch reminder for durable docs.
 *
 * When EDITING a durable artifact (docs/, .claude-memory/, or a top-level
 * agent-instruction file), inject a non-blocking reminder to read the WHOLE file
 * and grep the repo for the same fact, then fix every instance in one pass —
 * NOT just the grep-targeted line. This is the patch-the-flagged-line-instead-of-
 * reconciling-the-whole-file failure mode that cost S219 three Codex review rounds.
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
      'Durable-doc reconcile reminder: a changed fact can appear in frontmatter, status, recall ' +
      'rules, body, lead-ins, tails, and summaries. Before calling this complete: READ THE WHOLE ' +
      'FILE, GREP the repo for the same fact, and reconcile every live restatement in one pass. ' +
      'See feedback-reconcile-dont-append-docs.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // fail open — never block an edit
  }
});
