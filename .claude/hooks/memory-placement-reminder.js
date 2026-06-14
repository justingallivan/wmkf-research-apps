#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Write|Edit): MEMORY.md placement reminder.
 *
 * Fills the gap between two existing hooks:
 *   - agent-wiki-reminder.js nudges LEAF memory writes (.claude-memory/*.md)
 *     toward the wiki, but EXPLICITLY skips MEMORY.md.
 *   - memory-router-guard.js guards MEMORY.md but only BLOCKS once the router is
 *     already over budget — by then the bloat has happened.
 *
 * So nothing nudges the routing DECISION at the moment a net-new router line is
 * added to MEMORY.md. This hook does: when an edit ADDS a `- ` router line to
 * MEMORY.md (strictly more `- ` lines than before), it injects a placement
 * checklist forcing the "where does this fact actually live" decision — wiki
 * topic vs leaf memory vs an existing home — instead of dumping a line.
 *
 * Advisory only (additionalContext); placement is a judgment call that can't be
 * mechanically validated. The hard budget backstop stays memory-router-guard.js;
 * the shape backstop stays `npm run check:memory-router`. Fail-open on any error.
 */

const fs = require('fs');
const path = require('path');

// Count router entries the same way the budget gate measures prose lines: lines
// that start with "- " (the `- [Title](file.md) — hook` pointer form).
function routerLineCount(raw) {
  return raw.split('\n').filter((l) => l.startsWith('- ')).length;
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
    if (proposed == null) return; // can't reconstruct → fail open

    // Only nudge when the edit ADDS router entries. A net-neutral edit (rewording
    // an existing pointer) or a shrinking edit (compaction) is left alone.
    if (routerLineCount(proposed) <= routerLineCount(current)) return;

    const msg =
      'MEMORY.md is the auto-loaded ROUTER, not a store — adding a line here is a routing decision, ' +
      'not the default place to record a fact. Before this lands, decide WHERE the fact lives:\n' +
      '  1. Recurring DOMAIN detail (a feature area, data layer, external platform, lifecycle)? → it ' +
      'belongs in a docs/agent-wiki/topics/*.md page. Check docs/agent-wiki/index.md FIRST; add/update ' +
      'the topic — do NOT mint a memory for it.\n' +
      '  2. A durable lesson / preference / rationale (feedback or project type)? → write a LEAF file ' +
      '.claude-memory/<slug>.md (frontmatter + a VALID status), and make this MEMORY.md line a terse ' +
      'POINTER only (`- [Title](file.md) — hook`), never the content itself.\n' +
      '  3. Already covered? → grep .claude-memory/ AND the wiki index; UPDATE the existing leaf/topic ' +
      'instead of adding a new router line (reconcile/dedupe, do not append).\n' +
      'The router is read every session, so keep it a terse trigger index. memory-router-guard.js ' +
      'hard-blocks over-budget growth; this is the earlier nudge so it never gets there. Advisory.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch {
    // fail open; memory-router-guard + check:memory-router remain the backstops
  }
});
