#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Write|Edit) — BLOCKS writing tool-call scaffolding tags into files.
 *
 * Fail-CLOSED on detection (exit 2): unlike an advisory reminder, this prevents
 * the leak that the S291 incident exposed (stray </content>/</invoke> landing at
 * the end of a written doc). It is mechanically checkable and not gameable, so it
 * actually blocks rather than nags. It fails OPEN only when it cannot inspect the
 * input (parse error / no content), which never lets a detected leak through.
 *
 * Mirrors the leak signature used by scripts/check-scaffolding-tokens.js: a tag
 * ALONE on a line, outside a fenced code block. Inline/backticked mentions and
 * fenced examples are allowed (a doc may legitimately discuss these tags).
 */

const TAG_NAMES = ['content', 'invoke', 'parameter', 'function_calls'];
const TAG_ATOM = '<\\/?(?:' + TAG_NAMES.join('|') + '|antml:[a-zA-Z_]+)(?:\\s[^>]*)?>';
// A leaked line is ENTIRELY one or more scaffolding tags (after trimming), outside
// a fenced block. Catches `</content>` and adjacent `</content></invoke>`. Inline
// /backticked/fenced mentions are allowed. Mirrors scripts/check-scaffolding-tokens.js.
const TAG_LINE_RE = new RegExp('^\\s*(?:' + TAG_ATOM + '\\s*)+$');

function leakedLines(content) {
  if (typeof content !== 'string') return [];
  const hits = [];
  let inFence = false;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (TAG_LINE_RE.test(trimmed)) hits.push(`line ${i + 1}: ${trimmed}`);
  }
  return hits;
}

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (!data || !['Write', 'Edit'].includes(data.tool_name)) return;
    const ti = data.tool_input || {};
    // Write -> content; Edit -> new_string.
    const payload = typeof ti.content === 'string' ? ti.content
      : (typeof ti.new_string === 'string' ? ti.new_string : null);
    if (payload === null) return;
    const hits = leakedLines(payload);
    if (hits.length === 0) return;
    console.error(
      `Refusing ${data.tool_name}: tool-call scaffolding tag(s) detected in the content —\n  ` +
      hits.join('\n  ') +
      `\nThese leak from the tool parameter. Remove them. If a doc must mention these tags, ` +
      `keep them inline/backticked or inside a fenced code block (not alone on a line).`
    );
    process.exit(2);
  } catch {
    // Fail open: cannot inspect input. check:scaffolding-tokens is the CI backstop.
  }
});
