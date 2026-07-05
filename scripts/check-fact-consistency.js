#!/usr/bin/env node
/**
 * CI gate: bounded canonical scalar facts must not drift across live docs/memory.
 *
 * This is deliberately NOT a general semantic-consistency checker. It polices a
 * small registry of code-derived, drift-prone scalars and catches accidental
 * literal restatements in live documentation. The deeper structural follow-up is
 * normalization: reduce avoidable restatements to pointers. Until then, this
 * gate is the backstop for the remaining literals.
 *
 * De-specify-vs-update rule: de-specify exact counts when the number is not
 * locally operational; update and register an allowed restatement only when the
 * exact number is operationally needed in that document.
 *
 * The fact registry + derives live in `scripts/lib/canonical-facts.js` (shared
 * with `generate-canonical-counts.js` and `check-canonical-pointers.js`). The
 * normalization pattern: a pointer to `docs/CANONICAL_COUNTS.md#<fact-id>` is
 * the canonical source for each scalar; literal restatements in live prose are
 * still gated here for freshness; cross-document anchor rot is caught by
 * `check:canonical-pointers`.
 *
 * Historical exemptions are intentionally strict and single-line only. A stale
 * numeric claim is exempt only when the same line carries a structured marker:
 *   <!-- fact-consistency:ignore fact=<fact-id> as-of=YYYY-MM-DD -->
 * or the same marker with session=S166 or reason=historical/point-in-time.
 *
 * Modes:
 *   default     — value-drift scan + canonical-counts on-disk drift assertion
 *   --write     — regenerate docs/CANONICAL_COUNTS.md from the live registry
 */

const fs = require('fs');
const path = require('path');
const { repoRoot, CANONICAL_FACTS } = require('./lib/canonical-facts');
const { renderCanonicalCountsDoc, CANONICAL_COUNTS_REL } = require('./lib/canonical-counts-render');
const { isPointInTimeBasename } = require('./lib/point-in-time-files');
const { walkTree } = require('./lib/walk-files');

const WRITE = process.argv.includes('--write');

const SINGLE_FILES = ['CLAUDE.md', 'SESSION_PROMPT.md', 'README.md', 'GEMINI.md'];
const ROOTS = ['docs', '.claude-memory'];
const EXCLUDE_DIR = /(^|\/)(archive|node_modules)(\/|$)/;
// Point-in-time doc classification (audits, handoff reports, dated snapshots)
// lives in scripts/lib/point-in-time-files.js — single source of truth across
// the 4 doc-fan-in gates. To exempt a new naming convention, add it there.
// CANONICAL_COUNTS.md is the generated source of truth — its literals are checked
// by drift assertion against the registry, not by the prose pattern matcher.
const GENERATED_LITERAL_FILE = CANONICAL_COUNTS_REL;

function failConfig(message) {
  throw new Error(`fact-consistency configuration error: ${message}`);
}

function hasPointInTimeFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return Boolean(m && /^fact_consistency:\s*point-in-time\s*$/m.test(m[1]));
}

function collectFiles() {
  const out = [];
  const addIfLiveMarkdown = (full) => {
    const rel = path.relative(repoRoot, full);
    const ent = fs.lstatSync(full);
    if (ent.isSymbolicLink()) return;
    if (!full.endsWith('.md')) return;
    if (EXCLUDE_DIR.test(rel)) return;
    if (isPointInTimeBasename(path.basename(full))) return;
    if (rel === GENERATED_LITERAL_FILE) return;
    const text = fs.readFileSync(full, 'utf8');
    if (hasPointInTimeFrontmatter(text)) return;
    out.push(full);
  };

  for (const rel of SINGLE_FILES) {
    const full = path.join(repoRoot, rel);
    if (fs.existsSync(full)) addIfLiveMarkdown(full);
  }

  for (const rootRel of ROOTS) {
    const root = path.join(repoRoot, rootRel);
    if (!fs.existsSync(root)) continue;
    walkTree(root, { repoRoot, shouldExcludeRel: (rel) => EXCLUDE_DIR.test(rel), onFile: addIfLiveMarkdown });
  }
  return out;
}

function parseIgnoreMarkers(line) {
  const out = [];
  const re = /<!--\s*fact-consistency:ignore\s+([^>]+?)\s*-->/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const attrs = {};
    const attrRe = /([a-z-]+)=("[^"]+"|'[^']+'|[^\s]+)/g;
    let a;
    while ((a = attrRe.exec(m[1])) !== null) {
      attrs[a[1]] = a[2].replace(/^['"]|['"]$/g, '');
    }
    out.push(attrs);
  }
  return out;
}

function markerHasRequiredContext(attrs) {
  if (!attrs) return false;
  if (attrs['as-of'] && /^\d{4}-\d{2}-\d{2}$/.test(attrs['as-of'])) return true;
  if (attrs.session && /^S\d{3}$/.test(attrs.session)) return true;
  if (attrs.reason && /^(historical|point-in-time)$/.test(attrs.reason)) return true;
  return false;
}

function isExempt(line, factId) {
  const markers = parseIgnoreMarkers(line);
  if (markers.length === 0) return false;
  return markers.some((attrs) => attrs.fact === factId && markerHasRequiredContext(attrs));
}

// Pointer-form unwrap: the keep-number-plus-link normalization pattern wraps
// each gated literal as `[N](docs/CANONICAL_COUNTS.md#fact-id)`. Without
// unwrapping, the `\d+` would be followed by `]` instead of whitespace and
// every number-plus-context regex would silently miss the pointer form,
// turning the conversion into a gate bypass. We rewrite `[N](url)` → `N` on
// a copy of the line before pattern matching; the original line is still
// used for violation reporting so the user sees the actual pointer text.
// Empty URL `[N]()` is intentionally still unwrapped — a stale value wrapped
// that way should still be flagged.
function normalizeForMatching(line) {
  return line.replace(/\[(\d+)\]\([^)]*\)/g, '$1');
}

function assertPatternFixtures(facts) {
  for (const fact of facts) {
    for (const sample of fact.knownMissFixtures || []) {
      const matched = fact.patterns.some((pattern) => pattern.find(sample).length > 0);
      if (!matched) failConfig(`known miss fixture for ${fact.id} is not matched: ${sample}`);
    }
    for (const sample of fact.knownNonMatches || []) {
      const matched = fact.patterns.some((pattern) => pattern.find(sample).length > 0);
      if (matched) failConfig(`known non-match fixture for ${fact.id} is matched: ${sample}`);
    }
  }
}

function assertCanonicalCountsInSync(facts) {
  const fullPath = path.join(repoRoot, CANONICAL_COUNTS_REL);
  const existingText = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
  const expected = renderCanonicalCountsDoc(facts, { existingText });
  if (WRITE) {
    fs.writeFileSync(fullPath, expected);
    return { regenerated: true };
  }
  if (!fs.existsSync(fullPath)) {
    return { regenerated: false, error: `${CANONICAL_COUNTS_REL} is missing. Run \`npm run check:fact-consistency -- --write\` to generate it.` };
  }
  const actual = existingText;
  if (actual !== expected) {
    return { regenerated: false, error: `${CANONICAL_COUNTS_REL} is out of sync with the live registry. Run \`npm run check:fact-consistency -- --write\` to refresh it.` };
  }
  return { regenerated: false };
}

function main() {
  assertPatternFixtures(CANONICAL_FACTS);
  const facts = CANONICAL_FACTS.map((f) => ({ ...f, live: f.derive() }));

  const sync = assertCanonicalCountsInSync(facts);
  if (sync.error) {
    console.error(`fact-consistency FAILED: ${sync.error}`);
    process.exit(1);
  }
  if (sync.regenerated) {
    console.log(`fact-consistency: regenerated ${CANONICAL_COUNTS_REL}.`);
  }

  const files = collectFiles();
  const violations = [];

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const normalized = normalizeForMatching(line);
      for (const fact of facts) {
        for (const pattern of fact.patterns) {
          for (const m of pattern.find(normalized)) {
            if (m.asserted === fact.live) continue;
            if (isExempt(line, fact.id)) continue;
            violations.push({
              rel,
              lineNo: i + 1,
              factId: fact.id,
              pattern: pattern.name,
              asserted: m.asserted,
              live: fact.live,
              text: line.trim().slice(0, 180),
            });
          }
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error(
      `fact-consistency FAILED: ${violations.length} stale restatement(s) of a canonical fact.\n` +
      `A code-derived scalar drifted in a live doc/memory file. De-specify the\n` +
      `count unless it is locally operational; otherwise update it to the live\n` +
      `value. Historical mentions require same-line structured markers such as\n` +
      `<!-- fact-consistency:ignore fact=app-definition-count as-of=2026-05-19 -->.\n`,
    );
    for (const v of violations) {
      console.error(`  ✗ ${v.rel}:${v.lineNo} — fact ${v.factId} (${v.pattern}): doc says ${v.asserted}, live is ${v.live}`);
      console.error(`      ${v.text}`);
    }
    process.exit(1);
  }

  const summary = facts.map((f) => `${f.id}=${f.live}`).join(', ');
  console.log(`fact-consistency OK — ${files.length} live doc/memory file(s) scanned; canonical facts current (${summary}).`);
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}
