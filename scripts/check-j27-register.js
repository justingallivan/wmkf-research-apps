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
 *   - `excerpt` fragments may be BOUND to a cited path (2026-09-08 schema
 *     amendment, plan §3/§7): `` `path/or/glob` → `fragment` `` (arrow is
 *     `→` or `->`) binds `fragment` to that path/glob. Unprefixed backticked
 *     fragments remain a shared BAG. Each backtick span (bound or bag) is
 *     split on `…` / `...`, whitespace-normalized, and dropped below
 *     MIN_FRAGMENT_LENGTH. Files are compared with inner backticks and
 *     line-comment sigils (`//`, ` * `, `#`) removed and whitespace
 *     collapsed, so an excerpt can quote a wrapped comment or a backticked
 *     identifier. A bound path resolves independently of `site`: an exact
 *     repo-relative path (`stripSiteDecoration` then existence), or, for a
 *     glob, every tracked file the glob (as written) matches.
 *   - Resolution is PER SITE, not per row: every resolved file (and every
 *     glob match) must contain a fragment.
 *       - If one or more bound fragments target this exact file (by path,
 *         or via a glob binding that matched it), the file must contain one
 *         of THOSE — the shared bag is never consulted for a bound file,
 *         even if a bag fragment happens to appear in it.
 *       - Otherwise the file falls back to the bag and is counted UNBOUND.
 *         A multi-site row (more than one resolved file) with any unbound
 *         file prints an info line (`unbound: <files>`) and a summary count
 *         (`N multi-site rows with unbound files`) — informational, never a
 *         failure. A single-file row is never reported as unbound.
 *   - The first resolved file/match with no matching fragment makes the row
 *     STALE, reported as `no excerpt fragment found in <that file>` (every
 *     miss is listed, not just the first).
 *   - A directory site no longer passes on existence (2026-09-08): it must
 *     be replaced by a specific file inside it, or the row is STALE with
 *     `directory site needs a file: <dir>`.
 *   - A row is also STALE when a path-like token resolves to nothing at all
 *     (the site is gone).
 *   - A row with no resolvable path or no fragment at all (bound + bag) is
 *     UNVERIFIABLE: counted and printed, never failed. Dataverse surfaces,
 *     "work queue item N", and plain-prose excerpts land here on purpose.
 *   - Rows whose disposition begins `rejected` or `done` are closed; their
 *     excerpt may have been corrected away (register C-1), so they are
 *     skipped. The disposition vocabulary is `open` · `scheduled` · `done` ·
 *     `rejected` (plan §3); a disposition starting with any other word
 *     (`closed`, for example) is NOT closed — the row is still checked —
 *     and prints an info line (`disposition not in vocabulary: <word>`).
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
// Binding arrow between a bound path/glob span and its fragment span:
// `` `path` → `fragment` `` or `` `path` -> `fragment` ``. Nothing but
// whitespace may sit between the two backtick spans.
const BIND_ARROW_RE = /^\s*(?:→|->)\s*$/;
// Plan §3 disposition vocabulary. Anything else (e.g. a bare `closed.`) is
// not a recognized word and is reported, never silently treated as closed.
const DISPOSITION_VOCAB = new Set(['open', 'scheduled', 'done', 'rejected']);

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

// A single backtick span, split on `…` / `...`, comparable()-normalized,
// dropped below MIN_FRAGMENT_LENGTH. Shared by bound and bag fragments.
function splitFragmentPieces(spanText) {
  const out = [];
  for (const piece of spanText.split(/…|\.\.\./)) {
    const frag = comparable(piece);
    if (frag.length >= MIN_FRAGMENT_LENGTH) out.push(frag);
  }
  return out;
}

// Legacy/plain fragment extraction (every backtick span is a bag fragment,
// no binding syntax). Kept for callers that only need the bag shape.
function excerptFragments(excerptCell) {
  const out = [];
  for (const span of backtickSpans(excerptCell)) out.push(...splitFragmentPieces(span));
  return out;
}

// Parse the excerpt cell into { bound: [{ pathToken, fragments }], bag: [...] }.
// A bound pair is two adjacent backtick spans with only a bind arrow (and
// optional whitespace) between them: `` `path` → `fragment` ``. Every other
// backtick span is a bag fragment.
function parseExcerptBindings(excerptCell) {
  const spanRe = /`([^`]+)`/g;
  const spans = [];
  let m;
  while ((m = spanRe.exec(excerptCell)) !== null) {
    spans.push({ text: m[1], start: m.index, end: m.index + m[0].length });
  }
  const bound = [];
  const consumed = new Set();
  for (let i = 0; i < spans.length - 1; i += 1) {
    if (consumed.has(i) || consumed.has(i + 1)) continue;
    const between = excerptCell.slice(spans[i].end, spans[i + 1].start);
    if (!BIND_ARROW_RE.test(between)) continue;
    const fragments = splitFragmentPieces(spans[i + 1].text);
    if (fragments.length > 0) bound.push({ pathToken: spans[i].text, fragments });
    consumed.add(i);
    consumed.add(i + 1);
  }
  const bag = [];
  for (let i = 0; i < spans.length; i += 1) {
    if (consumed.has(i)) continue;
    bag.push(...splitFragmentPieces(spans[i].text));
  }
  return { bound, bag };
}

// Resolve a bound path/glob token independently of `site`: an exact
// repo-relative path (stripSiteDecoration then existence as a file), or,
// for a glob, every tracked file the glob (as written) matches. Returns a
// list of relative file paths; empty if the token does not resolve.
function resolveBoundPathToken(root, rels, rawToken) {
  const token = stripSiteDecoration(rawToken);
  if (!token || token.startsWith('/')) return [];
  if (token.includes('*')) {
    const re = globToRegExp(token);
    return rels.filter((rel) => re.test(rel));
  }
  const full = path.join(root, token);
  try { return fs.statSync(full).isFile() ? [token] : []; } catch (_e) { return []; }
}

function fileContainsAnyFragment(root, rel, fragments) {
  if (fragments.length === 0) return false;
  const text = readText(path.join(root, rel));
  if (text === null) return false;
  const hay = comparable(text);
  return fragments.some((f) => hay.includes(f));
}

function leadingDispositionWord(disposition) {
  const m = disposition.match(/^\**\s*([A-Za-z]+)/);
  return m ? m[1] : '';
}

function checkRow(root, rels, row) {
  const dispositionWord = leadingDispositionWord(row.disposition);
  const dispositionWarning = dispositionWord && !DISPOSITION_VOCAB.has(dispositionWord.toLowerCase())
    ? dispositionWord
    : null;
  if (CLOSED_DISPOSITION_RE.test(row.disposition)) return { status: 'closed', dispositionWarning };
  const { resolved, missing } = resolveSitePaths(root, rels, row.site);
  if (missing.length > 0) return { status: 'stale', reason: `site path missing: ${missing.join(', ')}`, dispositionWarning };

  const { bound, bag } = parseExcerptBindings(row.excerpt);
  const boundFilesMap = new Map(); // rel file -> fragments[] bound to it
  for (const b of bound) {
    for (const rel of resolveBoundPathToken(root, rels, b.pathToken)) {
      if (!boundFilesMap.has(rel)) boundFilesMap.set(rel, []);
      boundFilesMap.get(rel).push(...b.fragments);
    }
  }
  const totalFragmentCount = bag.length + bound.reduce((n, b) => n + b.fragments.length, 0);
  if (resolved.length === 0 || totalFragmentCount === 0) return { status: 'unverifiable', dispositionWarning };

  const dirMisses = [];
  const fragMisses = [];
  const unbound = [];
  for (const rel of resolved) {
    let isDir = false;
    try { isDir = fs.statSync(path.join(root, rel)).isDirectory(); } catch (_e) { /* treated as miss below */ }
    if (isDir) { dirMisses.push(rel); continue; }
    const boundFragments = boundFilesMap.get(rel);
    if (boundFragments && boundFragments.length > 0) {
      if (!fileContainsAnyFragment(root, rel, boundFragments)) fragMisses.push(rel);
    } else {
      if (resolved.length > 1) unbound.push(rel);
      if (!fileContainsAnyFragment(root, rel, bag)) fragMisses.push(rel);
    }
  }

  const reasonParts = [];
  if (dirMisses.length > 0) reasonParts.push(`directory site needs a file: ${dirMisses.join(', ')}`);
  if (fragMisses.length > 0) reasonParts.push(`no excerpt fragment found in ${fragMisses.join(', ')}`);
  if (reasonParts.length > 0) {
    return { status: 'stale', reason: reasonParts.join('; '), dispositionWarning, unbound };
  }
  return { status: 'ok', dispositionWarning, unbound };
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
  let unboundRowCount = 0;
  let dispositionWarningCount = 0;
  for (const row of rows) {
    const result = checkRow(root, rels, row);
    counts[result.status] += 1;
    if (result.status === 'stale') {
      errors.push(`${row.id} (register line ${row.lineNo}) — ${result.reason}`);
      console.log(`  ✗ ${row.id} stale — ${result.reason}`);
    } else if (result.status === 'unverifiable') {
      console.log(`  ? ${row.id} unverifiable (no resolvable path or no backticked excerpt)`);
    }
    if (result.unbound && result.unbound.length > 0) {
      unboundRowCount += 1;
      console.log(`  ? ${row.id} unbound: ${result.unbound.join(', ')}`);
    }
    if (result.dispositionWarning) {
      dispositionWarningCount += 1;
      console.log(`  ? ${row.id} disposition not in vocabulary: ${result.dispositionWarning}`);
    }
  }
  console.log(`j27-register rows: ${counts.ok} ok, ${counts.stale} stale, ${counts.unverifiable} unverifiable, ${counts.closed} closed.`);
  if (unboundRowCount > 0) {
    console.log(`j27-register: ${unboundRowCount} multi-site rows with unbound files.`);
  }
  if (dispositionWarningCount > 0) {
    console.log(`j27-register: ${dispositionWarningCount} row(s) with a disposition outside the vocabulary (open, scheduled, done, rejected).`);
  }

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

module.exports = {
  splitRow, stripSiteDecoration, excerptFragments, parseExcerptBindings, resolveBoundPathToken,
  leadingDispositionWord, parseRegister, checkRow, scanTags, listTree,
};
