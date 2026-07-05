#!/usr/bin/env node
/**
 * CI gate: repo file-path references in live memory + agent-wiki docs must point
 * at paths that EXIST. A reference to a renamed/removed code file (the "rename
 * the code, the doc lags" drift — see feedback-rename-code-not-just-docs) is
 * flagged unless that path is near a removed/planned/historical annotation, or
 * the line carries a structured ignore marker.
 *
 * Why this gate: the fan-in doc gates (fact-consistency, prompt-storage-mentions,
 * drain-table-mentions) catch registered scalars and specific stale entity
 * names, but NOT arbitrary dangling code-path references. The 2026-06-23
 * memory/wiki audit found that class was the single largest source of staleness
 * (DEFAULT_BODY moved out of AwardeeTab, proposal-readiness.js removed,
 * dataverse-identity-map-service.js renamed, watch_paths shared/prompts → …).
 * Those are 100% mechanically checkable: the path either exists or it doesn't.
 *
 * IMPORTANT — the breaking change is usually a CODE commit, not a doc edit (a
 * file gets renamed; the doc that names it is untouched). So this runs repo-wide
 * in CI on every push, NOT as a doc-scoped pre-commit guard (which would miss the
 * commit that introduces the drift).
 *
 * Scope: .claude-memory/**.md + docs/agent-wiki/**.md (the live retrieval
 * surfaces agents trust). Broader docs/ (design plans) legitimately carry
 * planned/illustrative paths and are intentionally out of scope for v1.
 *
 * What's checked: a repo-relative file path `<prefix>/<…>.<ext>` where
 *   prefix ∈ {lib,pages,shared,scripts,modules,tests,docs} and
 *   ext ∈ {js,jsx,ts,tsx,mjs,cjs,sql,json,md,sh}. A trailing `:<line>` ref is
 *   ignored. Glob/brace patterns (`*`, `{`, `}`) never match (no extension /
 *   excluded char), so `pages/api/**` and `lib/x/*.js` are skipped by design.
 *   Next.js dynamic segments (`[token]`, `[...nextauth]`) are literal on disk
 *   and ARE checked.
 *
 * Exemption (any one passes):
 *   - same-line removal/planned/historical keyword near that ref (removed, deleted, retired,
 *     renamed, superseded, formerly, legacy, withdrawn, "no longer", "does not
 *     exist", "doesn't exist", absent, "never (created|existed|shipped)",
 *     planned, "to be created", "to live at", "will live", future, ~~strike~~)
 *   - structured marker: <!-- doc-symbol-refs:ignore [reason=<id>] -->
 *   - point-in-time doc (shared classifier) / archive / allowlist file
 *   - the path is .gitignored: a generated/output artifact (e.g. a tool's
 *     `scripts/*.json` dump) is never committed, so it legitimately does NOT
 *     exist in a clean checkout — locally it might (artifact present on disk),
 *     in CI it never will. Existence-checking it is meaningless, so a doc that
 *     correctly names a gitignored artifact must not fail the gate. `git
 *     check-ignore` matches such paths even when the file is absent.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isPointInTimeBasename } = require('./lib/point-in-time-files');
const { walkTree } = require('./lib/walk-files');

const repoRoot = path.resolve(__dirname, '..');

const ROOTS = ['.claude-memory', 'docs/agent-wiki'];
const SINGLE_FILES = [];
const EXCLUDE_DIR = /(^|\/)(archive|node_modules|_doc_symbol_refs_selftest_tmp)(\/|$)/;
const KEYWORD_PROXIMITY_CHARS = 120;

// Whole-file allowlist (script-side). Empty for now; add only with a deliberate
// justification (e.g. a doc whose purpose is recording removed paths).
const ALLOWLIST_FILES = new Set([]);

// Path-reference detector. Group 1 = the repo path (without any trailing :line).
//  - (?<![\w./-]) : not preceded by a path/word char → excludes URLs and
//    sub-paths (`apps/lib/x.js`, `my-lib/x.js`, `a.lib/x.js` won't false-match).
//  - char class excludes `*` `{` `}` so globs/brace-expansions never match.
const PATH_PREFIXES = ['lib', 'pages', 'shared', 'scripts', 'modules', 'tests', 'docs'];
const EXT = '(?:jsx|tsx|json|mjs|cjs|sql|md|sh|ts|js)';
const PATH_RE = new RegExp(
  `(?<![\\w./-])((?:\\.\\/)?(?:${PATH_PREFIXES.join('|')})\\/[A-Za-z0-9_.\\/\\[\\]-]*?\\.${EXT})\\b`,
  'g',
);

const SAME_LINE_OK = new RegExp(
  [
    // removal / historical (the doc is correctly describing a path that is gone)
    '\\b(removed|deleted|retired|renamed|renamed-to|superseded|superseding|formerly|legacy|withdrawn|moved|dropped|abandoned|inert|unused|gone|historical|unbuilt)\\b',
    '\\bno longer\\b',
    "\\b(does not|doesn't|did not|didn't) exist\\b",
    '\\b(absent|nonexistent|non-existent)\\b',
    '\\bnever\\s+(created|existed|shipped|materialized|landed)\\b',
    // planned / not-yet-created (the doc is naming a future path)
    '\\b(planned|future|to be created|to-be-created|to live at|will live|would live|scaffold|name it|recreate|not yet (created|built)|not built)\\b',
    '~~',
  ].join('|'),
  'i',
);

const MARKER_RE = /<!--\s*doc-symbol-refs:ignore(?:\s+reason=[\w-]+)?\s*-->/;

function hasPointInTimeFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return Boolean(m && /^fact_consistency:\s*point-in-time\s*$/m.test(m[1]));
}

function collectFiles() {
  const out = [];
  const addIfLive = (full) => {
    const rel = path.relative(repoRoot, full);
    const ent = fs.lstatSync(full);
    if (ent.isSymbolicLink()) return;
    if (!full.endsWith('.md')) return;
    if (shouldExcludeRelPath(rel)) return;
    if (isPointInTimeBasename(path.basename(full))) return;
    if (ALLOWLIST_FILES.has(rel)) return;
    const text = fs.readFileSync(full, 'utf8');
    if (hasPointInTimeFrontmatter(text)) return;
    out.push(full);
  };

  for (const rel of SINGLE_FILES) {
    const full = path.join(repoRoot, rel);
    if (fs.existsSync(full)) addIfLive(full);
  }
  for (const rootRel of ROOTS) {
    const root = path.join(repoRoot, rootRel);
    if (!fs.existsSync(root)) {
      throw new Error(`doc-symbol-refs configuration error: required scan root is missing: ${rootRel}. Restore it or update ROOTS deliberately.`);
    }
    walkTree(root, { repoRoot, shouldExcludeRel: shouldExcludeRelPath, onFile: addIfLive });
  }
  return out;
}

function findPathRefs(line) {
  PATH_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = PATH_RE.exec(line)) !== null) {
    out.push({
      ref: normalizeRepoRef(m[1]),
      start: m.index,
      end: m.index + m[1].length,
    });
  }
  return out;
}

function normalizeRepoRef(ref) {
  return ref.startsWith('./') ? ref.slice(2) : ref;
}

function shouldExcludeRelPath(rel) {
  if (process.env.DOC_SYMBOL_REFS_INCLUDE_SELFTEST_TMP === '1' && /(^|\/)_doc_symbol_refs_selftest_tmp(\/|$)/.test(rel)) {
    return false;
  }
  return EXCLUDE_DIR.test(rel);
}

function refIsExempt(line, start, end) {
  if (MARKER_RE.test(line)) return true;
  const windowStart = Math.max(0, start - KEYWORD_PROXIMITY_CHARS);
  const windowEnd = Math.min(line.length, end + KEYWORD_PROXIMITY_CHARS);
  return SAME_LINE_OK.test(line.slice(windowStart, windowEnd));
}

// Of the given repo-relative paths, return the subset git considers ignored.
// `git check-ignore --stdin` matches paths against .gitignore rules WITHOUT
// requiring the file to exist, so this works in a clean CI checkout where the
// generated artifact is absent. Exit codes: 0 = some ignored (stdout lists
// them), 1 = none ignored, 128 = error (not a repo, etc.). On error we return
// the empty set — i.e. fail CLOSED: a real dangling ref is still reported rather
// than silently suppressed.
function gitIgnoredRefs(refs) {
  const unique = [...new Set(refs)];
  if (unique.length === 0) return new Set();
  let out;
  try {
    out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: repoRoot,
      input: unique.join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch (e) {
    if (e.status === 1) return new Set(); // none ignored — normal, not an error
    return new Set(); // 128 / other → fail closed (suppress nothing)
  }
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}

function assertAllowlistFilesExist() {
  for (const rel of ALLOWLIST_FILES) {
    const full = path.join(repoRoot, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`doc-symbol-refs configuration error: allowlist file does not exist: ${rel}. Remove it from ALLOWLIST_FILES or restore the file.`);
    }
  }
}

function main() {
  assertAllowlistFilesExist();
  const files = collectFiles();
  const candidateViolations = [];
  let refsChecked = 0;

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const matches = findPathRefs(line);
      if (matches.length === 0) return;
      const seen = new Set();
      for (const match of matches) {
        const { ref } = match;
        if (seen.has(ref)) continue;
        seen.add(ref);
        // Skip abbreviation segments (`docs/.../DESIGN.md`) and parent-dir hops
        // (`../`) — these are non-literal/relative, not checkable as repo paths.
        // (Next.js spread routes `[...nextauth]` are a bracketed segment, not a
        // pure-dots segment, so they are NOT skipped here.)
        if (/(^|\/)\.{2,3}(\/|$)/.test(ref)) continue;
        refsChecked += 1;
        if (fs.existsSync(path.join(repoRoot, ref))) continue;
        if (refIsExempt(line, match.start, match.end)) continue;
        candidateViolations.push({ rel, lineNo: i + 1, ref, text: line.trim().slice(0, 180) });
      }
    });
  }

  // A path that doesn't exist on disk but IS gitignored is a generated/output
  // artifact, not a dangling code reference — it's never in a clean checkout by
  // design. Drop those before reporting (single batched git call).
  const ignored = gitIgnoredRefs(candidateViolations.map((v) => v.ref));
  const violations = candidateViolations.filter((v) => !ignored.has(v.ref));
  const skippedGitignored = candidateViolations.length - violations.length;

  if (violations.length > 0) {
    console.error(
      `doc-symbol-refs FAILED: ${violations.length} dangling repo path reference(s) in live memory/agent-wiki docs.\n` +
      `Each references a file path that does NOT exist — usually because the code was renamed/removed and the doc lagged (feedback-rename-code-not-just-docs).\n` +
      `Fix the reference to the current path, OR if the doc is correctly describing a removed/planned path, annotate it on the same line (e.g. "removed", "renamed to …", "planned") or add a marker:\n` +
      `  <!-- doc-symbol-refs:ignore reason=<short-reason> -->\n`,
    );
    for (const v of violations) {
      console.error(`  ✗ ${v.rel}:${v.lineNo} — missing path ${v.ref}`);
      console.error(`      ${v.text}`);
    }
    process.exit(1);
  }

  const skipNote = skippedGitignored > 0 ? `; ${skippedGitignored} gitignored artifact ref(s) skipped` : '';
  console.log(`doc-symbol-refs OK — ${files.length} live doc/memory file(s) scanned; ${refsChecked} path reference(s) checked, all resolve${skipNote}.`);
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}
