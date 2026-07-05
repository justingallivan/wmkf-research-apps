#!/usr/bin/env node
/**
 * CI gate: a memory/agent-wiki line that describes a repo path as PLANNED / not
 * built yet, where that path NOW EXISTS, is a stale build claim — the thing got
 * built and nobody flipped the prose. Flip it to past tense ("now lives at",
 * "shipped at", …) or annotate.
 *
 * This is the exact COMPLEMENT of check-doc-symbol-refs:
 *
 *                 path absent                 path present
 *   no keyword    doc-symbol-refs flags       OK (live reference)
 *   planned kwd   OK (genuinely planned)      ← THIS GATE flags (it got built)
 *
 * The two gates together cover the full lifecycle of a "planned path" reference:
 * a doc may name a future path (planned + absent = fine); when that path is
 * created the claim must flip, or this gate fires; if the planned annotation is
 * dropped while the path is still absent, doc-symbol-refs fires.
 *
 * Why this gate: the 2026-06-23 memory/wiki audit's second-largest stale class
 * (after dangling paths) was "not built yet / design-only / TODO" notes for work
 * that had since shipped (project-awardee-onboarding said the Awardee workflow
 * was design-only while AwardeeTab.js + 8 grantee-deliverables routes existed;
 * updateIfEmpty was called a "future TODO" while defined at dynamics-service.js).
 * All were fixed by hand; this guards against recurrence.
 *
 * IMPORTANT — like doc-symbol-refs, the breaking change is usually a CODE commit
 * (a planned file gets created), not a doc edit. So this runs repo-wide in CI on
 * every push, NOT as a doc-scoped pre-commit guard. /start is a backstop.
 *
 * Scope: .claude-memory/**.md + docs/agent-wiki/**.md (same live retrieval
 * surfaces as doc-symbol-refs). Point-in-time / archive / allowlist excluded.
 *
 * PRECISION over recall (a noisy gate gets ignored): the pending keyword must
 * GOVERN the path (tight proximity window), the path must EXIST, and there must
 * be NO completion marker on the line. Prose "not built" claims that don't name
 * a path are out of scope (same limitation doc-symbol-refs has). gitignored
 * artifacts are skipped (their on-disk presence is non-deterministic across
 * checkouts — see doc-symbol-refs).
 *
 * Exemption (any one passes):
 *   - a completion marker anywhere on the line (now built/exists/lives/shipped,
 *     is built, already exists, lives at, shipped at, implemented, landed, in
 *     place, wired up, VERIFIED, ✅, …) — the line correctly describes a now-built path
 *   - structured marker: <!-- build-claim-freshness:ignore [reason=<id>] -->
 *   - point-in-time doc (shared classifier) / archive / allowlist file
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isPointInTimeBasename } = require('./lib/point-in-time-files');
const { walkTree } = require('./lib/walk-files');

const repoRoot = path.resolve(__dirname, '..');

const ROOTS = ['.claude-memory', 'docs/agent-wiki'];
const EXCLUDE_DIR = /(^|\/)(archive|node_modules|_build_claim_freshness_selftest_tmp)(\/|$)/;
// The pending keyword must be within this many chars of the path ref to count as
// governing it (precision). Mirrors doc-symbol-refs' KEYWORD_PROXIMITY_CHARS.
const PENDING_PROXIMITY_CHARS = 100;

// Whole-file allowlist (script-side). Empty for now; add only with a deliberate
// justification.
const ALLOWLIST_FILES = new Set([]);

// Path-reference detector — identical to doc-symbol-refs (kept self-contained).
const PATH_PREFIXES = ['lib', 'pages', 'shared', 'scripts', 'modules', 'tests', 'docs'];
const EXT = '(?:jsx|tsx|json|mjs|cjs|sql|md|sh|ts|js)';
const PATH_RE = new RegExp(
  `(?<![\\w./-])((?:\\.\\/)?(?:${PATH_PREFIXES.join('|')})\\/[A-Za-z0-9_.\\/\\[\\]-]*?\\.${EXT})\\b`,
  'g',
);

// PENDING — the path must be the DIRECT OBJECT of a pending construction, not
// merely near a pending word. Two shapes, anchored to the path:
//
//   (before)  "<pending verb phrase> [at|:] `PATH`"   e.g. "to live at `lib/x.js`"
//   (after)   "`PATH` (<pending tag>)"                e.g. "`lib/x.js` (planned)"
//
// Anchoring kills the dominant false-positive classes a proximity window hits:
// bare "planned" topic labels, design-doc references that happen to sit near a
// path, and multi-path lines where the keyword governs a DIFFERENT path. Bare
// "future"/"not yet"/standalone "planned" are intentionally NOT pending tags.
//
// PENDING_BEFORE matches the END of the pre-path substring (the verb phrase, then
// an optional "at"/":" and opening delimiters right up to the path).
const PENDING_BEFORE_RE = new RegExp(
  '(?:' + [
    'to\\s+live\\s+at',
    '(?:will|would)\\s+live(?:\\s+at)?',
    '(?:to|will|would)\\s+be\\s+(?:built|created|added|written|implemented|wired)(?:\\s+(?:at|in|as))?',
    'yet\\s+to\\s+be\\s+(?:built|created|written|implemented)(?:\\s+(?:at|in|as))?',
    'name\\s+it',
    'recreate',
    'scaffold(?:\\s+(?:a|the|out))?',
    'new\\s+(?:file|helper|module|script|route|component)(?:\\s+(?:at|in))?',
    'planned(?:\\s+(?:at|file|home))?',
  ].join('|') + ')[\\s:`\'"(\\u2192\\-]*$',
  'i',
);
// PENDING_AFTER matches the START of the post-path substring: optional closing
// delimiters, then a parenthetical/dash-led pending tag.
const PENDING_AFTER_RE = new RegExp(
  '^\\s*[`\'")]*\\s*[\\(\\u2014:-]+\\s*(?:' + [
    'planned',
    'not\\s+(?:yet\\s+)?(?:built|created|implemented|wired)',
    'unbuilt',
    'design[- ]only',
    'to\\s+be\\s+(?:built|created)',
    'stub(?:bed)?',
    'TODO',
  ].join('|') + ')\\b',
  'i',
);

// DONE — completion markers. Generous on purpose: an extra exemption lowers
// recall but raises precision, which is the safe direction for a guard. Phrases
// are affirmative-completion forms chosen NOT to match inside the negative
// PENDING phrases (e.g. "now built" / "is built" never appear inside "not built").
const DONE_RE = new RegExp(
  [
    '\\bnow\\s+(built|exists|lives|sends|has|calls|carries|wired|in\\s+place|covers|runs|reads|writes|returns|handles)\\b',
    '\\b(is|are)\\s+(built|shipped|live|wired|done|implemented|in\\s+place)\\b',
    '\\balready\\s+(built|exists|shipped|wired|implemented|in\\s+place)\\b',
    '\\b(built|lives|shipped|wired)\\s+at\\b',
    '\\b(shipped|landed|implemented|wired\\s+up)\\b',
    '\\bin\\s+place\\b',
    '\\bVERIFIED\\b',
    '✅',
  ].join('|'),
  'i',
);

const MARKER_RE = /<!--\s*build-claim-freshness:ignore(?:\s+reason=[\w-]+)?\s*-->/;

function hasPointInTimeFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return Boolean(m && /^fact_consistency:\s*point-in-time\s*$/m.test(m[1]));
}

function shouldExcludeRelPath(rel) {
  if (process.env.BUILD_CLAIM_FRESHNESS_INCLUDE_SELFTEST_TMP === '1' && /(^|\/)_build_claim_freshness_selftest_tmp(\/|$)/.test(rel)) {
    return false;
  }
  return EXCLUDE_DIR.test(rel);
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

  for (const rootRel of ROOTS) {
    const root = path.join(repoRoot, rootRel);
    if (!fs.existsSync(root)) {
      throw new Error(`build-claim-freshness configuration error: required scan root is missing: ${rootRel}. Restore it or update ROOTS deliberately.`);
    }
    walkTree(root, { repoRoot, shouldExcludeRel: shouldExcludeRelPath, onFile: addIfLive });
  }
  return out;
}

function normalizeRepoRef(ref) {
  return ref.startsWith('./') ? ref.slice(2) : ref;
}

function findPathRefs(line) {
  PATH_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = PATH_RE.exec(line)) !== null) {
    out.push({ ref: normalizeRepoRef(m[1]), start: m.index, end: m.index + m[1].length });
  }
  return out;
}

// Of the given repo-relative paths, return the subset git considers ignored.
// Same rationale + fail-closed behavior as doc-symbol-refs.
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
    if (e.status === 1) return new Set();
    return new Set();
  }
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}

// True when the path at [start,end) is the direct object of a pending
// construction — a pending verb phrase immediately before it, or a pending tag
// immediately after it. The pre-/post-path slices are bounded so the anchored
// regexes stay cheap.
function pathDescribedAsPending(line, start, end) {
  const pre = line.slice(Math.max(0, start - PENDING_PROXIMITY_CHARS), start);
  if (PENDING_BEFORE_RE.test(pre)) return true;
  const post = line.slice(end, Math.min(line.length, end + PENDING_PROXIMITY_CHARS));
  return PENDING_AFTER_RE.test(post);
}

function assertAllowlistFilesExist() {
  for (const rel of ALLOWLIST_FILES) {
    const full = path.join(repoRoot, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`build-claim-freshness configuration error: allowlist file does not exist: ${rel}.`);
    }
  }
}

function main() {
  assertAllowlistFilesExist();
  const files = collectFiles();
  const candidates = [];
  let refsChecked = 0;

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const matches = findPathRefs(line);
      if (matches.length === 0) return;
      if (MARKER_RE.test(line)) return;
      if (DONE_RE.test(line)) return; // line already describes a now-built path
      const seen = new Set();
      for (const match of matches) {
        const { ref } = match;
        if (seen.has(ref)) continue;
        seen.add(ref);
        if (/(^|\/)\.{2,3}(\/|$)/.test(ref)) continue; // ellipsis / parent-hop, non-literal
        refsChecked += 1;
        // Only EXISTING paths can be stale build claims (absent ones are
        // doc-symbol-refs' job).
        if (!fs.existsSync(path.join(repoRoot, ref))) continue;
        if (!pathDescribedAsPending(line, match.start, match.end)) continue;
        candidates.push({ rel, lineNo: i + 1, ref, text: line.trim().slice(0, 180) });
      }
    });
  }

  // A gitignored path's on-disk presence is non-deterministic across checkouts,
  // so we can't reliably call it "built" — skip (consistent with doc-symbol-refs).
  const ignored = gitIgnoredRefs(candidates.map((v) => v.ref));
  const violations = candidates.filter((v) => !ignored.has(v.ref));

  if (violations.length > 0) {
    console.error(
      `build-claim-freshness FAILED: ${violations.length} stale build claim(s) in live memory/agent-wiki docs.\n` +
      `Each describes a path as planned / not-built-yet, but that path NOW EXISTS — the work shipped and the prose lagged.\n` +
      `Flip the claim to past tense (e.g. "now lives at …", "shipped at …", "is built"), OR if the line is correctly\n` +
      `describing something still pending, add a marker:\n` +
      `  <!-- build-claim-freshness:ignore reason=<short-reason> -->\n`,
    );
    for (const v of violations) {
      console.error(`  ✗ ${v.rel}:${v.lineNo} — "planned" claim but ${v.ref} exists`);
      console.error(`      ${v.text}`);
    }
    process.exit(1);
  }

  console.log(`build-claim-freshness OK — ${files.length} live doc/memory file(s) scanned; ${refsChecked} path reference(s) checked, no stale "planned/not-built" claims for existing paths.`);
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}
