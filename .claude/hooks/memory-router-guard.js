#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Write|Edit): memory-router write-time guardrail.
 *
 * Enforces the .claude-memory/MEMORY.md router budget AT WRITE TIME, so the
 * session that bloats the router is the one that fixes it — instead of a red
 * `check:memory-router` gate landing on some later session at startup (the
 * failure mode that let the router creep back over budget in under a week).
 *
 * Thresholds are single-sourced from scripts/check-memory-router.js. The hook
 * only BLOCKS an edit that makes the router strictly WORSE (a net-new budget
 * breach); any edit that shrinks or holds steady passes, so a compaction edit
 * is never trapped even if the file is already over budget.
 *
 * Detail that won't fit a terse router line belongs in a docs/agent-wiki
 * topic page — the block message says so. Fail-open on any error; the
 * check:memory-router gate stays the backstop and also catches harness/auto-
 * memory writes that don't go through the Write/Edit tools.
 */

const fs = require('fs');
const path = require('path');

let THRESH;
try {
  THRESH = require('../../scripts/check-memory-router.js');
} catch {
  THRESH = {};
}
const TARGET_BYTES = THRESH.TARGET_BYTES || 12 * 1024;
const MAX_LINES = THRESH.MAX_LINES || 150;
const MAX_PROSE_LEN = THRESH.MAX_PROSE_LEN || 200;

// Same prose measurement as the gate: drop `.md` refs + separators, then size.
function proseLen(line) {
  return line
    .replace(/[A-Za-z0-9._/-]+\.md/g, '')
    .replace(/[;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

function violations(raw) {
  const out = [];
  const bytes = Buffer.byteLength(raw, 'utf8');
  const lines = raw.split('\n');
  if (bytes > TARGET_BYTES) out.push(`bytes ${bytes}>${TARGET_BYTES}`);
  if (lines.length > MAX_LINES) out.push(`lines ${lines.length}>${MAX_LINES}`);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('- ')) continue;
    const len = proseLen(lines[i]);
    if (len > MAX_PROSE_LEN) out.push(`prose@L${i + 1} ${len}>${MAX_PROSE_LEN}`);
  }
  return out;
}

function applyEdit(current, ti) {
  const oldS = ti.old_string;
  const newS = typeof ti.new_string === 'string' ? ti.new_string : '';
  if (typeof oldS !== 'string' || !current.includes(oldS)) return null; // let the Edit itself error/no-op
  return ti.replace_all ? current.split(oldS).join(newS) : current.replace(oldS, newS);
}

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    if (!data || (data.tool_name !== 'Write' && data.tool_name !== 'Edit')) return;
    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const ti = data.tool_input || {};
    if (typeof ti.file_path !== 'string') return;
    const rel = path.relative(root, path.resolve(ti.file_path)).replace(/\\/g, '/');
    if (rel !== '.claude-memory/MEMORY.md') return;

    const memPath = path.resolve(root, '.claude-memory/MEMORY.md');
    const current = fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : '';

    let proposed;
    if (data.tool_name === 'Write') {
      proposed = typeof ti.content === 'string' ? ti.content : null;
    } else {
      proposed = applyEdit(current, ti);
    }
    if (proposed == null) return; // can't reconstruct the result → fail open

    const before = new Set(violations(current));
    const net = violations(proposed).filter((v) => !before.has(v));
    if (net.length === 0) return; // edit does not worsen the router → allow

    const bytes = Buffer.byteLength(proposed, 'utf8');
    console.error(
      `MEMORY.md router budget: this ${data.tool_name} would breach the auto-loaded router contract ` +
      `[${net.join('; ')}] (caps: ${TARGET_BYTES}B / ${MAX_LINES} lines / ${MAX_PROSE_LEN}-char prose per \`- \` line; ` +
      `result ${bytes}B). The router is read every session — keep it a terse trigger index. ` +
      `Move domain detail into a docs/agent-wiki/topics/*.md page and route to it with one short line ` +
      `(see docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md Phase 5). Note: \`.md\` file-ref lists are NOT counted, ` +
      `so a line may route to many files. A net-neutral or shrinking edit is always allowed.`
    );
    process.exit(2);
  } catch {
    // fail open; check:memory-router gate is the backstop
  }
});
