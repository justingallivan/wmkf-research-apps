#!/usr/bin/env node
'use strict';

/**
 * check:scaffolding-tokens
 *
 * Fails when a tool-call scaffolding tag leaks into a tracked text file. These
 * leak from a tool `content`/`new_string` parameter (S291: stray `</content>` and
 * `</invoke>` landed at the end of docs/NOMENCLATURE_GLOSSARY.md and survived all
 * green gates — none looked for scaffolding garbage).
 *
 * LEAK SIGNATURE: a scaffolding tag ALONE on a line (after trimming), OUTSIDE a
 * fenced code block. This is what an accidental tool-output leak looks like. A
 * doc that legitimately *mentions* the tags inline / backticked / inside a fence
 * (e.g. a review note "stray `</content>` tags → fixed") is NOT flagged — that
 * was an explicit false-positive to avoid (docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md
 * documents exactly such a past fix and must keep passing).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

const TAG_NAMES = ['content', 'invoke', 'parameter', 'function_calls'];
const TAG_ATOM = '<\\/?(?:' + TAG_NAMES.join('|') + '|antml:[a-zA-Z_]+)(?:\\s[^>]*)?>';
// Leak signature: a line that is ENTIRELY one or more scaffolding tags (after
// trimming) — catches `</content>` and adjacent `</content></invoke>`. A line
// with real prose, an inline/backticked mention, or a fenced example is NOT
// flagged (a doc may legitimately discuss these tags). Scope: accidental
// tool-output leaks, not adversarial evasion (tags split across lines or unicode
// lookalikes are intentionally out of scope — they are not how a leak manifests).
const TAG_LINE_RE = new RegExp('^\\s*(?:' + TAG_ATOM + '\\s*)+$');
const TAG_GLOBAL_RE = new RegExp(TAG_ATOM, 'g');

const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.yml', '.yaml', '.sql', '.py', '.sh', '.css', '.html',
]);

/** Scan one file's content. Returns [{ line, text }] of leaked bare-line tags. */
function scanText(content) {
  const hits = [];
  let inFence = false;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (TAG_LINE_RE.test(trimmed)) {
      const tags = trimmed.match(TAG_GLOBAL_RE) || [trimmed];
      for (const t of tags) hits.push({ line: i + 1, text: t });
    }
  }
  return hits;
}

function trackedTextFiles() {
  const out = execSync('git ls-files -z', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean).filter((rel) => TEXT_EXT.has(path.extname(rel).toLowerCase()));
}

function main() {
  const files = trackedTextFiles();

  // Self-test opt-in: also scan an untracked temp dir of fixtures.
  if (process.env.SCAFFOLD_TOKENS_INCLUDE_SELFTEST_TMP) {
    const tmp = path.join(repoRoot, process.env.SCAFFOLD_TOKENS_INCLUDE_SELFTEST_TMP);
    if (fs.existsSync(tmp)) {
      (function rec(dir) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) rec(full);
          else if (TEXT_EXT.has(path.extname(ent.name).toLowerCase())) files.push(path.relative(repoRoot, full));
        }
      })(tmp);
    }
  }

  const problems = [];
  for (const rel of files) {
    let content;
    try { content = fs.readFileSync(path.join(repoRoot, rel), 'utf8'); } catch { continue; }
    for (const hit of scanText(content)) problems.push(`${rel}:${hit.line}: leaked scaffolding tag "${hit.text}"`);
  }

  if (problems.length) {
    console.error('✗ scaffolding-tokens: leaked tool-call scaffolding tag(s) in tracked files:\n');
    for (const p of problems) console.error('  ✗ ' + p);
    console.error('\nRemove the stray tag(s). If a doc legitimately discusses these tags, keep them inline/backticked or inside a fenced code block.');
    process.exit(1);
  }
  console.log(`scaffolding-tokens OK — scanned ${files.length} tracked text file(s), no leaked tags.`);
}

module.exports = { scanText, TAG_LINE_RE };

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('✗ scaffolding-tokens: ' + (e.message || e)); process.exit(1); }
}
