#!/usr/bin/env node
'use strict';
/**
 * Advisory gate: `J27:` marker convention ↔ docs/J27_TRANSITION_REGISTER.md.
 *
 * Built from docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md §7. Three
 * behaviors, nothing more:
 *
 *   1. LIST every `J27:` tagged site in the tracked tree. A tag is `J27:`
 *      followed by an optional register ID (`J27-###`). A tag WITH an id is
 *      a tag anywhere in a line. A tag WITHOUT an id is allowed by the
 *      convention ("followed by the register ID once one exists") and is
 *      listed as an unregistered marker (warning, exit 0) only when it sits
 *      in a comment: the line, after leading whitespace, begins with a
 *      code-comment leader (`//`, `/*`, `*`, `#`, `--`, `<!--`) and `J27:`
 *      follows that leader immediately (optionally after whitespace). A bare
 *      `J27:` in prose, inside bold (`**J27:**`), or mid-line is not a
 *      marker — it is prose using the term, not a site tag. This keeps
 *      cycle-label lead-ins ("- **J27:** …") and sentences ("for J27:
 *      whether …") from being counted.
 *      "Tracked tree" here is the index plus untracked files that are not
 *      ignored, so a tag is seen before it is staged; `outputs/`, `.next/`,
 *      and `node_modules/` are skipped (EXCLUDED_DIRS) because they hold
 *      local-only reports and build products, not sites.
 *   2. FAIL when a tag names a register ID that does not exist in the
 *      register (exit 1).
 *   3. FAIL when a register row's `site` no longer resolves to a file that
 *      contains its `excerpt` (exit 1).
 *
 * The register's `site` and `excerpt` cells are prose-shaped, not
 * machine-shaped (see plan §3). The stale-site rule is therefore tolerant:
 *   - Only backticked, path-like tokens in `site` are resolved. `file:47`,
 *     `file:1,36`, `file:60-61,71`, `file#Heading`, `(L68)` decorations are
 *     stripped. Bare basenames resolve through BARE_NAME_PREFIXES (memory,
 *     Atlas, wiki, audit shorthand) and then through the directory of the
 *     previous resolved token in the same row (sibling shorthand such as
 *     `scripts/find-2025-phase-i.js`, `find-phase-i-test-cases.js`).
 *     Tokens with `*` are globs matched against the tree; tokens starting
 *     with `/` are routes, not repo paths, and are ignored.
 *   - Only backticked fragments of `excerpt` are matched, each split on `…`
 *     / `...`, whitespace-normalized, and dropped below MIN_FRAGMENT_LENGTH.
 *     Files are compared with inner backticks and line-comment sigils
 *     (`//`, ` * `, `#`) removed and whitespace collapsed, so a register
 *     excerpt can quote a wrapped comment or a backticked identifier.
 *   - Resolution is PER SITE, not per row: every resolved file (and every
 *     glob match) must contain at least one excerpt fragment. The first
 *     resolved file containing none makes the row STALE, reported as
 *     `no excerpt fragment found in <that file>` (all such misses are
 *     listed, not just the first). A directory site passes on existence
 *     alone, same as before.
 *   - A row is also STALE when a path-like token resolves to nothing at all
 *     (the site is gone).
 *   - A row with no resolvable path or no backticked fragment is
 *     UNVERIFIABLE: counted and printed, never failed. Dataverse surfaces,
 *     "work queue item N", and plain-prose excerpts land here on purpose.
 *   - Rows whose disposition begins `rejected` or `done` are closed; their
 *     excerpt may have been corrected away (register C-1), so they are
 *     skipped.
 *
 * A register row that does not parse into the seven §3 columns is a
 * configuration error (exit 2), never a silent skip.
 *
 * Advisory at first (plan §7): registered in docs/CI_GATES_REFERENCE.md and
 * the /start battery, not wired into CI or hooks. Promotion to blocking is
 * an owner decision.
 *
 * Usage:
 *   node scripts/check-j27-register.js [--root <dir>] [--register <path>]
 *
 * `--root` and `--register` exist for the self-test. In `--root` mode the
 * tree is listed with `git ls-files` when the root is a git checkout and by
 * directory walk otherwise.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_REGISTER = 'docs/J27_TRANSITION_REGISTER.md';

// A tag: `J27:` then optional whitespace then optional register ID. The
// negative lookbehind drops the convention's own self-references, which are
// always written backtick-wrapped (`J27:` marker).
const TAG_RE = /(?<!`)J27:(?:\s*(J27-\d{3})\b)?/g;
// An id-less `J27:` counts as a marker only when the line, after leading
// whitespace, begins with one of these comment leaders and `J27:` follows
// immediately (optionally after whitespace). Prose and bold-label uses of
// the bare term are not markers.
const COMMENT_LEAD_RE = /^\s*(?:\/\/|\/\*|\*|#|--|<!--)\s*/;
const ROW_ID_RE = /^\| (J27-\d{3})\b/;
const REGISTER_COLUMNS = 7; // id · site · excerpt · Dep · Ev · Q · disposition

// Files that describe the convention itself, or are this gate. Their `J27:`
// literals are examples, not sites.
const EXCLUDED_FILES = new Set([
  'scripts/check-j27-register.js',
  'scripts/check-j27-register-self-test.js',
  'docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md',
]);
const EXCLUDED_DIRS = /(^|\/)(node_modules|\.git|\.next|outputs)(\/|$)/;

const PATH_EXT_RE = /\.(js|mjs|cjs|jsx|ts|tsx|json|md|sql|ya?ml)$/;
const BARE_NAME_PREFIXES = ['.claude-memory', 'docs/atlas', 'docs/agent-wiki/topics', 'docs/audits', 'docs'];
const MIN_FRAGMENT_LENGTH = 8;
const CLOSED_DISPOSITION_RE = /^\**\s*(rejected|done)\b/i;

function parseArgs(argv) {
  const out = { root: path.resolve(__dirname, '..'), register: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') { out.root = path.resolve(argv[i + 1]); i += 1; }
    else if (argv[i] === '--register') { out.register = path.resolve(argv[i + 1]); i += 1; }
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!out.register) out.register = path.join(out.root, DEFAULT_REGISTER);
  return out;
}

// ---------------------------------------------------------------- tree

function listTree(root) {
  let rels = null;
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    rels = out.split('\0').filter(Boolean);
  } catch (_e) {
    rels = [];
    (function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const rel = path.relative(root, full);
        if (EXCLUDED_DIRS.test(rel)) continue;
        if (ent.isDirectory()) walk(full);
        else if (ent.isFile()) rels.push(rel);
      }
    })(root);
  }
  return rels.filter((rel) => !EXCLUDED_DIRS.test(rel) && !EXCLUDED_FILES.has(rel)).sort();
}

function readText(full) {
  let st;
  try { st = fs.lstatSync(full); } catch (_e) { return null; }
  if (!st.isFile()) return null;
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) return null; // binary
  return buf.toString('utf8');
}

// ---------------------------------------------------------------- tags

function scanTags(root, rels) {
  const tags = [];
  for (const rel of rels) {
    const text = readText(path.join(root, rel));
    if (text === null || !text.includes('J27:')) continue;
    text.split('\n').forEach((line, i) => {
      const leadMatch = line.match(COMMENT_LEAD_RE);
      const commentJ27At = leadMatch ? leadMatch[0].length : -1;
      TAG_RE.lastIndex = 0;
      let m;
      while ((m = TAG_RE.exec(line)) !== null) {
        if (!m[1] && m.index !== commentJ27At) continue; // id-less marker not comment-led: prose, ignore
        tags.push({ rel, lineNo: i + 1, id: m[1] || null, text: line.trim().slice(0, 160) });
      }
    });
  }
  return tags;
}

// ---------------------------------------------------------------- register

// Split a markdown table row on `|`, ignoring pipes inside backtick spans.
function splitRow(line) {
  const cells = [];
  let cur = '';
  let inCode = false;
  for (const ch of line) {
    if (ch === '`') { inCode = !inCode; cur += ch; }
    else if (ch === '|' && !inCode) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  // Leading and trailing pipes yield empty first/last cells.
  return cells.slice(1, -1).map((c) => c.trim());
}

function parseRegister(registerPath) {
  const text = readText(registerPath);
  if (text === null) throw new Error(`j27-register configuration error: register not found: ${registerPath}`);
  const rows = [];
  const seen = new Set();
  text.split('\n').forEach((line, i) => {
    const m = line.match(ROW_ID_RE);
    if (!m) return;
    const cells = splitRow(line);
    if (cells.length !== REGISTER_COLUMNS) {
      throw new Error(`j27-register configuration error: ${path.basename(registerPath)}:${i + 1} row ${m[1]} has ${cells.length} cells, expected ${REGISTER_COLUMNS}`);
    }
    if (seen.has(m[1])) {
      throw new Error(`j27-register configuration error: ${path.basename(registerPath)}:${i + 1} duplicate register id ${m[1]}`);
    }
    seen.add(m[1]);
    rows.push({ id: m[1], lineNo: i + 1, site: cells[1], excerpt: cells[2], disposition: cells[6] });
  });
  return rows;
}

function backtickSpans(cell) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(cell)) !== null) out.push(m[1]);
  return out;
}

// Strip `:47`, `:1,36`, `:60-61,71`, `#Heading`, and a trailing `/`.
function stripSiteDecoration(token) {
  return token.replace(/#.*$/, '').replace(/:[\d,\-]+$/, '').replace(/\/$/, '').trim();
}

function isPathLike(token) {
  return token.includes('/') || PATH_EXT_RE.test(token);
}

function existsUnder(root, rel) {
  try { return fs.statSync(path.join(root, rel)).isFile() || fs.statSync(path.join(root, rel)).isDirectory(); }
  catch (_e) { return false; }
}

function globToRegExp(glob) {
  const escaped = glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${escaped}$`);
}

function resolveSitePaths(root, rels, siteCell) {
  const resolved = [];
  const missing = [];
  let lastDir = null;
  for (const span of backtickSpans(siteCell)) {
    const token = stripSiteDecoration(span);
    if (!token || !isPathLike(token) || token.startsWith('/')) continue;
    if (token.includes('*')) {
      const re = globToRegExp(token);
      const hits = rels.filter((rel) => re.test(rel));
      if (hits.length > 0) resolved.push(...hits);
      else missing.push(token);
      continue;
    }
    const candidates = [token];
    if (!token.includes('/')) {
      for (const prefix of BARE_NAME_PREFIXES) candidates.push(path.posix.join(prefix, token));
      if (lastDir) candidates.push(path.posix.join(lastDir, token));
    }
    const hit = candidates.find((c) => existsUnder(root, c));
    if (hit) {
      resolved.push(hit);
      lastDir = path.posix.dirname(hit);
    } else {
      missing.push(token);
    }
  }
  return { resolved, missing };
}

function normalizeWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Comparable text: drop inner backticks and per-line comment sigils, then
// collapse whitespace, so wrapped `// …` / ` * …` comments match a one-line
// register excerpt.
function comparable(text) {
  return normalizeWs(
    text
      .split('\n')
      .map((line) => line.replace(/^\s*(\/\/|\*|#+)\s?/, ''))
      .join('\n')
      .replace(/`/g, ''),
  );
}

function excerptFragments(excerptCell) {
  const out = [];
  for (const span of backtickSpans(excerptCell)) {
    for (const piece of span.split(/…|\.\.\./)) {
      const frag = comparable(piece);
      if (frag.length >= MIN_FRAGMENT_LENGTH) out.push(frag);
    }
  }
  return out;
}

function fileContainsAnyFragment(root, rel, fragments) {
  const full = path.join(root, rel);
  let st;
  try { st = fs.statSync(full); } catch (_e) { return false; }
  if (st.isDirectory()) return true; // directory site: existence is the claim
  const text = readText(full);
  if (text === null) return false;
  const hay = comparable(text);
  return fragments.some((f) => hay.includes(f));
}

function checkRow(root, rels, row) {
  if (CLOSED_DISPOSITION_RE.test(row.disposition)) return { status: 'closed' };
  const { resolved, missing } = resolveSitePaths(root, rels, row.site);
  const fragments = excerptFragments(row.excerpt);
  if (missing.length > 0) return { status: 'stale', reason: `site path missing: ${missing.join(', ')}` };
  if (resolved.length === 0 || fragments.length === 0) return { status: 'unverifiable' };
  // Per-site resolution: every resolved file (each glob match included) must
  // contain at least one fragment on its own. A row is not "ok" just because
  // some other cited file in the same row still has a match.
  const misses = resolved.filter((rel) => !fileContainsAnyFragment(root, rel, fragments));
  if (misses.length === 0) return { status: 'ok' };
  return { status: 'stale', reason: `no excerpt fragment found in ${misses.join(', ')}` };
}

// ---------------------------------------------------------------- main

function main() {
  const { root, register } = parseArgs(process.argv.slice(2));
  const rows = parseRegister(register);
  const ids = new Set(rows.map((r) => r.id));
  const rels = listTree(root);
  const tags = scanTags(root, rels);

  const errors = [];
  const warnings = [];

  console.log(`j27-register: ${tags.length} tagged site(s) in ${rels.length} tracked file(s); ${rows.length} register row(s).`);
  for (const t of tags) {
    if (t.id && !ids.has(t.id)) {
      errors.push(`${t.rel}:${t.lineNo} — tag names unknown register id ${t.id}`);
      console.log(`  ✗ ${t.rel}:${t.lineNo} → ${t.id} (unknown)`);
    } else if (!t.id) {
      warnings.push(`${t.rel}:${t.lineNo} — J27: marker without a register id`);
      console.log(`  ? ${t.rel}:${t.lineNo} → (no id)  ${t.text}`);
    } else {
      console.log(`  · ${t.rel}:${t.lineNo} → ${t.id}`);
    }
  }

  const counts = { ok: 0, stale: 0, unverifiable: 0, closed: 0 };
  for (const row of rows) {
    const result = checkRow(root, rels, row);
    counts[result.status] += 1;
    if (result.status === 'stale') {
      errors.push(`${row.id} (register line ${row.lineNo}) — ${result.reason}`);
      console.log(`  ✗ ${row.id} stale — ${result.reason}`);
    } else if (result.status === 'unverifiable') {
      console.log(`  ? ${row.id} unverifiable (no resolvable path or no backticked excerpt)`);
    }
  }
  console.log(`j27-register rows: ${counts.ok} ok, ${counts.stale} stale, ${counts.unverifiable} unverifiable, ${counts.closed} closed.`);

  if (warnings.length > 0) {
    console.log(`j27-register: ${warnings.length} marker(s) without a register id — add the id once the row exists.`);
  }
  if (errors.length > 0) {
    console.error(`j27-register FAILED: ${errors.length} problem(s).`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('Fix: tag only ids that exist in docs/J27_TRANSITION_REGISTER.md; update a stale row\'s site/excerpt (or its disposition) when the code moved.');
    process.exit(1);
  }
  console.log('j27-register OK.');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message || e);
    process.exit(2);
  }
}

module.exports = { splitRow, stripSiteDecoration, excerptFragments, parseRegister, checkRow, scanTags, listTree };
