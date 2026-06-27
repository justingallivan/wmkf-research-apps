#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Write|Edit): scope-claim falsification reminder.
 *
 * When a durable artifact (docs/, .claude-memory/, or a top-level agent-instruction
 * file) is about to gain a SCOPE/QUANTITY claim, inject a non-blocking reminder to
 * verify by FALSIFICATION rather than confirmation.
 *
 * FAILS OPEN: any parse error / missing field / unexpected shape exits 0 silently,
 * so this can never block a legitimate edit. Stays quiet unless BOTH the path is in
 * scope AND the new text contains a quantifier signature.
 */
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const ti = (data && data.tool_input) || {};
    const fp = typeof ti.file_path === 'string' ? ti.file_path : '';
    if (!fp) return;

    const base = fp.split('/').pop();
    const inScope =
      /(^|\/)docs\//.test(fp) ||
      /(^|\/)\.claude-memory\//.test(fp) ||
      ['CLAUDE.md', 'SESSION_PROMPT.md', 'AGENTS.md'].indexOf(base) !== -1;
    if (!inScope) return;

    // Write -> content; Edit -> new_string.
    const text =
      (typeof ti.content === 'string' && ti.content) ||
      (typeof ti.new_string === 'string' && ti.new_string) ||
      '';
    if (!text) return;

    // Scope/quantity signatures: universal quantifiers + "the rest" / "source of
    // truth" + "N of M". Case-insensitive.
    const QUANT = /\b(only|all|none|every|never|always)\b|\bthe rest\b|\bsource of truth\b|\b\d+\s+of\s+\d+\b/i;
    if (!QUANT.test(text)) return;

    const msg =
      'Scope/quantity claim detected in a durable artifact. Verify it by running the ' +
      'DISCONFIRMING query (search the complement set / a counter-instance), and derive any ' +
      'denominator independently from the numerator. If no falsifying query is constructible, ' +
      'label the claim [ASSUMED] or narrow it.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch (e) {
    // fail open — never block an edit
  }
});
