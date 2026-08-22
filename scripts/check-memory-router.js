#!/usr/bin/env node
/**
 * scripts/check-memory-router.js
 *
 * CI gate for the Claude memory router (`.claude-memory/MEMORY.md`) and topic
 * files, per docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md.
 *
 * MEMORY.md is auto-loaded at session start (Claude Code reads only the first
 * 200 lines / 25KB). The reorg made it a compact ROUTER, not a prose index.
 * This gate keeps it from silently bloating back over budget and keeps the
 * routing links + topic-file metadata honest.
 *
 * Hard failures (exit 1):
 *   1. MEMORY.md missing.
 *   2. MEMORY.md > MAX_LINES lines.
 *   3. MEMORY.md > TARGET_BYTES bytes. (Hardened 2026-06-10: the old comfort
 *      target is now a hard cap so router creep fails instead of warning. The
 *      legacy MAX_BYTES ceiling is retained as an exported constant but is no
 *      longer reachable — anything over TARGET fails first.)
 *   4. A `*.md` link in MEMORY.md does not resolve.
 *   5. A topic file (.claude-memory/*.md except MEMORY.md) has no YAML
 *      frontmatter, no `status:` key WITHIN that frontmatter, or an unrecognized
 *      status value. The check is scoped to the leading `---` block so body prose
 *      mentioning "status:" cannot satisfy it.
 *   6. A `- ` router entry whose prose (file refs + separators stripped) is
 *      longer than MAX_PROSE_LEN chars — a dense operational summary that
 *      belongs in the agent wiki, not the router. File-ref lists are not
 *      counted, so a line may route to many memory files.
 *
 * Soft warning (does not fail): MEMORY.md over WARN_BYTES but still under the
 * TARGET_BYTES hard cap — early pressure signal so the next domain's detail is
 * routed to the agent wiki before the hard cap blocks an edit.
 *
 * Run with `--self-test` to exercise the validators against synthetic fixtures
 * (see check-memory-router-self-test.js, which shells out with that flag).
 *
 * Wire into .github/workflows/test.yml alongside the other check:* gates.
 */

const fs = require('fs');
const path = require('path');

const MEM_DIR = path.join(__dirname, '..', '.claude-memory');
const MEMORY_MD = path.join(MEM_DIR, 'MEMORY.md');

// Thresholds are single-sourced from scripts/lib/memory-router-thresholds.js
// (docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md Phase 1). Re-exported below for
// API stability — the write-time guard and the self-test import them from
// this module.
const {
  MAX_LINES,
  MAX_BYTES,
  TARGET_BYTES,
  WARN_BYTES,
  NOTICE_BYTES,
  MAX_PROSE_LEN,
} = require('./lib/memory-router-thresholds.js');
const VALID_STATUS = new Set(['active', 'stale', 'closed', 'superseded']);

/**
 * Validate a single memory store. Pure function over a directory so the
 * self-test can point it at a fixture dir. Returns { errors:[], warnings:[] }.
 */
function validateStore(memDir) {
  const errors = [];
  const warnings = [];
  const memoryMd = path.join(memDir, 'MEMORY.md');

  if (!fs.existsSync(memoryMd)) {
    errors.push(`MEMORY.md missing at ${memoryMd}`);
    return { errors, warnings };
  }

  const raw = fs.readFileSync(memoryMd, 'utf8');
  const bytes = Buffer.byteLength(raw, 'utf8');
  const lines = raw.split('\n').length;

  if (lines > MAX_LINES) errors.push(`MEMORY.md is ${lines} lines (hard cap ${MAX_LINES}).`);
  if (bytes > TARGET_BYTES) {
    errors.push(`MEMORY.md is ${bytes} bytes (over the ${TARGET_BYTES}-byte cap).`);
  } else if (bytes > WARN_BYTES) {
    warnings.push(`MEMORY.md is ${bytes} bytes, within ${TARGET_BYTES - bytes}B of the ${TARGET_BYTES}B hard cap — route the next domain's detail to a docs/agent-wiki/topics/ page, not a new router line.`);
  } else if (bytes >= NOTICE_BYTES) {
    warnings.push(`MEMORY.md is ${bytes} bytes, at/over the ${NOTICE_BYTES}-byte routine-audit trigger — run the router diet per docs/MEMORY_HYGIENE_RUNBOOK.md §10 before the ${WARN_BYTES}-byte warn band.`);
  }

  // Router-prose density: a `- ` entry whose prose (file refs + separators
  // stripped) exceeds MAX_PROSE_LEN is a dense operational summary that belongs
  // in the agent wiki, not the router. Long file-ref lists are NOT counted.
  const allLines = raw.split('\n');
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (!line.startsWith('- ')) continue;
    const prose = line
      .replace(/[A-Za-z0-9._/-]+\.md/g, '')
      .replace(/[;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (prose.length > MAX_PROSE_LEN) {
      errors.push(`MEMORY.md line ${i + 1} exceeds the ${MAX_PROSE_LEN}-char router-prose cap (prose ${prose.length}): move detail to the agent wiki.`);
    }
  }

  // 4. Every *.md link in MEMORY.md must resolve (relative to memDir).
  const refs = new Set(raw.match(/[A-Za-z0-9._/-]+\.md/g) || []);
  for (const ref of refs) {
    if (ref === 'MEMORY.md') continue;
    const resolved = path.resolve(memDir, ref);
    if (!fs.existsSync(resolved)) errors.push(`MEMORY.md links a missing file: ${ref}`);
  }

  // 5. Every topic file must declare a recognized status IN its frontmatter.
  //    The check is scoped to the leading `---` block (top-level or nested under
  //    `metadata:`), NOT the whole file: prose that merely mentions "status:"
  //    must not satisfy the requirement, and a file with no frontmatter at all is
  //    caught. (Hardened 2026-06-10 after an auto-memory write reached main with
  //    no frontmatter status; the old unscoped /m regex could be fooled by body text.)
  const topicFiles = fs.readdirSync(memDir)
    .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
  const valid = [...VALID_STATUS].join(', ');
  for (const f of topicFiles) {
    const body = fs.readFileSync(path.join(memDir, f), 'utf8');
    const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) {
      errors.push(`${f}: missing YAML frontmatter (need a \`---\` block with a \`status:\` key, one of ${valid}).`);
      continue;
    }
    const m = fm[1].match(/^\s*status:\s*(.+?)\s*$/m);
    if (!m) {
      errors.push(`${f}: no \`status:\` key in frontmatter (expected one of ${valid}).`);
      continue;
    }
    const value = m[1].replace(/^['"]|['"]$/g, '');
    if (!VALID_STATUS.has(value)) {
      errors.push(`${f}: unrecognized status \`${value}\` (expected one of ${valid}).`);
    }
  }

  return { errors, warnings };
}

/**
 * Count unique root-level topic files directly referenced by the router.
 * Duplicate references and links to docs/wiki hubs do not inflate this metric.
 */
function countUniqueDirectLeafRefs(raw, topicFiles) {
  const topicSet = new Set(topicFiles);
  const direct = new Set();
  for (const ref of raw.match(/[A-Za-z0-9._/-]+\.md/g) || []) {
    const normalized = path.posix.normalize(ref);
    if (normalized === 'MEMORY.md' || normalized.includes('/')) continue;
    if (topicSet.has(normalized)) direct.add(normalized);
  }
  return direct.size;
}

function main() {
  // --self-test points the validator at a fixture dir passed as the next arg.
  const selfTestIdx = process.argv.indexOf('--self-test');
  const memDir = selfTestIdx !== -1 && process.argv[selfTestIdx + 1]
    ? path.resolve(process.argv[selfTestIdx + 1])
    : MEM_DIR;

  const { errors, warnings } = validateStore(memDir);

  for (const w of warnings) console.warn(`warning: ${w}`);

  if (errors.length) {
    console.error('memory-router gate FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(path.join(memDir, 'MEMORY.md'), 'utf8');
  const topicFiles = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
  const uniqueLeafRefs = countUniqueDirectLeafRefs(raw, topicFiles);
  console.log(`memory-router OK — MEMORY.md ${Buffer.byteLength(raw, 'utf8')} bytes / ${raw.split('\n').length} lines / ${uniqueLeafRefs} unique direct leaf ref(s); ${topicFiles.length} topic file(s), all links resolve + all carry a valid status.`);
}

module.exports = { validateStore, countUniqueDirectLeafRefs, MAX_LINES, MAX_BYTES, TARGET_BYTES, WARN_BYTES, NOTICE_BYTES, MAX_PROSE_LEN, VALID_STATUS };

if (require.main === module) main();
