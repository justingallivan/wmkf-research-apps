#!/usr/bin/env node
/**
 * CI gate: pointers to docs/CANONICAL_COUNTS.md must target registered fact ids.
 *
 * This is the rot-detection companion to `check:fact-consistency`. The fact-
 * consistency gate verifies that literal numerals in live docs match the live
 * derive. This gate verifies that the markdown pointers wrapping those numerals
 * — the `(docs/CANONICAL_COUNTS.md#<anchor>)` link targets — both (a) name a
 * fact id present in the CANONICAL_FACTS registry, and (b) resolve to an
 * `## <fact-id>` heading in the generated doc.
 *
 * Failure modes caught:
 *   - typo or stale anchor that no longer exists in the registry
 *   - fact id that was renamed or retired
 *   - canonical doc out of sync with the registry (heading missing)
 *
 * Scope mirrors `check:fact-consistency`: live docs/memory, with point-in-time
 * and audit files excluded. The generated CANONICAL_COUNTS.md itself is
 * excluded (its content is asserted by `check:fact-consistency`).
 */

const fs = require('fs');
const path = require('path');
const { repoRoot, CANONICAL_FACTS } = require('./lib/canonical-facts');
const { CANONICAL_COUNTS_REL } = require('./lib/canonical-counts-render');

const SINGLE_FILES = ['CLAUDE.md', 'SESSION_PROMPT.md', 'README.md', 'GEMINI.md'];
const ROOTS = ['docs', '.claude-memory'];
const EXCLUDE_DIR = /(^|\/)(archive|node_modules)(\/|$)/;
const POINT_IN_TIME_BASENAMES = new Set([
  'DOC_TRIAGE_2026-05-07.md',
  'RECONCILIATION_REPORT.md',
]);
// Date-suffixed audit/handoff docs are point-in-time snapshots. Prefix-match
// both the old naming (DOCS_GROUND_TRUTH_AUDIT_<date>.md) and the standardized
// naming (AUDIT_<topic>_<date>.md) so a new audit doc doesn't need a
// hardcoded per-gate exception.
const POINT_IN_TIME_PREFIXES = ['AUDIT_', 'DOCS_GROUND_TRUTH_AUDIT_', 'CODEX_HANDOFF_REPORT_'];

function hasPointInTimeFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return Boolean(m && /^fact_consistency:\s*point-in-time\s*$/m.test(m[1]));
}

function isPointInTimeBasename(base) {
  return POINT_IN_TIME_BASENAMES.has(base) || POINT_IN_TIME_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function collectFiles() {
  const out = [];
  const addIfLive = (full) => {
    const rel = path.relative(repoRoot, full);
    const ent = fs.lstatSync(full);
    if (ent.isSymbolicLink()) return;
    if (!full.endsWith('.md')) return;
    if (EXCLUDE_DIR.test(rel)) return;
    if (isPointInTimeBasename(path.basename(full))) return;
    if (rel === CANONICAL_COUNTS_REL) return;
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
    if (!fs.existsSync(root)) continue;
    (function walkDir(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const rel = path.relative(repoRoot, full);
        if (ent.isDirectory()) {
          if (!EXCLUDE_DIR.test(rel)) walkDir(full);
        } else {
          addIfLive(full);
        }
      }
    })(root);
  }
  return out;
}

function collectHeadingAnchors() {
  const full = path.join(repoRoot, CANONICAL_COUNTS_REL);
  if (!fs.existsSync(full)) {
    throw new Error(`${CANONICAL_COUNTS_REL} is missing. Run \`npm run check:fact-consistency -- --write\` to generate it.`);
  }
  const text = fs.readFileSync(full, 'utf8');
  const anchors = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+([A-Za-z0-9-]+)\s*$/);
    if (m) anchors.add(m[1]);
  }
  return anchors;
}

// Matches markdown link targets ending in `CANONICAL_COUNTS.md#<anchor>` inside
// `(...)`. Captures the anchor. The path prefix is intentionally permissive so
// repo-relative (`docs/CANONICAL_COUNTS.md`), same-dir (`CANONICAL_COUNTS.md`,
// for links from inside `docs/`), and `./`/`/`-prefixed forms all resolve.
// Requires `(`, `/`, or `./` immediately before `CANONICAL_COUNTS.md` so a
// suffix-match like `MY_CANONICAL_COUNTS.md` cannot accidentally match.
const POINTER_RE = /\((?:[^()]*?[/]|\.?\/)?CANONICAL_COUNTS\.md#([A-Za-z0-9-]+)\)/g;

function findPointers(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    POINTER_RE.lastIndex = 0;
    let m;
    while ((m = POINTER_RE.exec(line)) !== null) {
      out.push({ anchor: m[1], lineNo: i + 1, text: line.trim().slice(0, 180) });
    }
  });
  return out;
}

function main() {
  const registry = new Set(CANONICAL_FACTS.map((f) => f.id));
  const anchors = collectHeadingAnchors();

  // Registry/anchor parity: every registered fact must have an anchor in the doc.
  const missingAnchors = [...registry].filter((id) => !anchors.has(id));
  if (missingAnchors.length > 0) {
    console.error(`canonical-pointers FAILED: ${CANONICAL_COUNTS_REL} is missing anchors for registered fact id(s): ${missingAnchors.join(', ')}.`);
    console.error('Run `npm run check:fact-consistency -- --write` to refresh the canonical-counts doc.');
    process.exit(1);
  }
  // The reverse — anchors present but not in registry — would indicate stale
  // content in the generated doc; the fact-consistency drift check catches that
  // (on-disk text must match the rendered registry output).

  const files = collectFiles();
  const violations = [];
  let pointerCount = 0;

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const ptr of findPointers(text)) {
      pointerCount += 1;
      if (!registry.has(ptr.anchor)) {
        violations.push({
          rel,
          lineNo: ptr.lineNo,
          anchor: ptr.anchor,
          reason: 'anchor is not a registered fact id in CANONICAL_FACTS',
          text: ptr.text,
        });
        continue;
      }
      if (!anchors.has(ptr.anchor)) {
        violations.push({
          rel,
          lineNo: ptr.lineNo,
          anchor: ptr.anchor,
          reason: `anchor missing from ${CANONICAL_COUNTS_REL}`,
          text: ptr.text,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`canonical-pointers FAILED: ${violations.length} broken pointer(s) to ${CANONICAL_COUNTS_REL}.`);
    for (const v of violations) {
      console.error(`  ✗ ${v.rel}:${v.lineNo} — #${v.anchor}: ${v.reason}`);
      console.error(`      ${v.text}`);
    }
    process.exit(1);
  }

  console.log(`canonical-pointers OK — ${files.length} live file(s) scanned, ${pointerCount} pointer(s) verified against ${registry.size} registered fact id(s).`);
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}
