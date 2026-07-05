#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Write|Edit): scope-claim falsification reminder.
 *
 * When a durable artifact (docs/, .claude-memory/, or a top-level agent-instruction
 * file) is about to gain a SCOPE/QUANTITY claim, inject a non-blocking reminder to
 * verify by FALSIFICATION rather than confirmation.
 *
 * Narrow blocker: plan docs may not combine an unresolved count assumption/TBD with
 * unqualified derived-count/coverage claims on the same subject. That visible
 * cross-document consistency failure was not catchable by the old edit-local
 * reminder. Escape hatches must live in the artifact: keep the derived claim
 * [ASSUMED] or add [DERIVED-FROM: <file:line/probe>; independent of TBD count].
 *
 * FAILS OPEN on parse/helper errors. Stays quiet unless BOTH the path is in scope
 * AND the text contains a quantifier signature.
 */
const path = require('path');

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const ti = (data && data.tool_input) || {};
    const fp = typeof ti.file_path === 'string' ? ti.file_path : '';
    if (!fp) return;

    const base = fp.split('/').pop();
    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const {
      findAssumptionQuantityLeaks,
      isPlanDoc,
      proposedTextForTool,
      repoRelative,
    } = require('./lib/document-guards');
    const rel = repoRelative(root, fp);
    const inScope =
      /^docs\//.test(rel) ||
      /^\.claude-memory\//.test(rel) ||
      ['CLAUDE.md', 'SESSION_PROMPT.md', 'AGENTS.md'].indexOf(base) !== -1;
    if (!inScope) return;

    // Write -> content; Edit -> new_string.
    const text =
      (typeof ti.content === 'string' && ti.content) ||
      (typeof ti.new_string === 'string' && ti.new_string) ||
      '';
    if (!text) return;

    const proposed = proposedTextForTool(data, root);
    if (proposed && isPlanDoc(rel, proposed)) {
      const leaks = findAssumptionQuantityLeaks(proposed);
      if (leaks.length) {
        const details = leaks.slice(0, 3).map(({ uncertainty, claim }) =>
          `  - ${rel}:${uncertainty.lineNumber} leaves a count uncertain, while ${rel}:${claim.lineNumber} makes an unqualified numeric count/coverage claim.`
        ).join('\n');
        console.error(
          'BLOCKED: plan document mixes unresolved quantity uncertainty with unqualified derived counts.\n' +
          `${details}\n` +
          'Keep downstream counts visibly [ASSUMED], or add a line-local ' +
          '[DERIVED-FROM: <file:line/probe>; independent of TBD count] marker.'
        );
        process.exit(2);
      }
    }

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
