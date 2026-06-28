#!/usr/bin/env node
/**
 * CI gate: bare mentions of drained reviewer-domain Postgres tables in live
 * docs/memory must carry a drain-only / historical context annotation.
 *
 * Background: at the application runtime layer, none of the six reviewer-
 * domain Postgres tables (researchers, publications, researcher_keywords,
 * reviewer_suggestions, grant_cycles, proposal_searches) are read or
 * written by any code under pages/api/, lib/services/, lib/dataverse/, or
 * shared/. They are drain-only post-W3-W6 cutover (2026-05-12); live
 * source of truth is Dataverse (wmkf_potentialreviewer, which now carries
 * bibliometrics after the S213 appresearcher collapse, plus
 * wmkf_appreviewersuggestion and wmkf_appgrantcycle).
 *
 * S167 audit found a long tail of stale doc mentions that asserted these
 * tables as live application state. Three iterative audit passes failed
 * to converge on case-by-case fixes; this gate is the mechanical fan-in
 * (same architectural shape as check:fact-consistency / canonical-pointers).
 *
 * Detection (broadened S167 pass-5 per Codex, 7 shapes):
 *   - `\`name\``, `'name'`, `"name"`     — quoted code identifier
 *   - `Postgres name`                       — explicit Postgres prefix
 *   - `name.column`                         — dotted column reference
 *   - `name <db-noun>` (table/schema/row/...) — bare identifier + DB context
 *   - `<verb> name` (from/into/reads from/writes to/...) — SQL-shape
 *
 * Exemption (any one passes):
 *   - Same-line directional/historical keyword: drain / drained / drain-only /
 *     historical / RETIRED / formerly / legacy / superseded / post-W[3-6] /
 *     pre-cutover / "cutover (complete|shipped|done|finished)" / migrated /
 *     Migrates / collapsed / moved / Replaced / deleted / dropped / removed /
 *     reaped / backfilled / snapshot(s) / strikethrough (~~)
 *   - Same-line structured marker:
 *       <!-- drain-table:ignore [reason=<short-id>] -->
 *   - Whole-file ALLOWLIST_FILES entry (script-side; for migration plans,
 *     lessons-learned, migration-memory).
 *   - File-purpose marker in first 30 lines (visible in-doc):
 *       <!-- drain-table:file-purpose=<tag> -->
 *     Tag must be in FILE_MARKER_TAG_PATHS and the file's path must match
 *     one of that tag's allowed patterns; otherwise the gate errors at
 *     startup (configuration error). Currently the only registered tag is
 *     `atlas-state-page`, scoped to `docs/atlas/*.md` +
 *     `docs/APPLICATION_STATE_ATLAS.md`.
 *
 * Tightened S167 pass-5 per Codex: dropped overly permissive same-line
 * keywords (Dataverse alone, planned, future-work, "from Postgres", bare
 * W[3-6], wmkf_app prefix, spec'd) — they could co-occur with stale
 * current-state claims and falsely exempt them.
 *
 * Point-in-time docs (AUDIT_*, CODEX_HANDOFF_REPORT_*, etc.) are excluded
 * by the same rules as check:fact-consistency.
 *
 * If you legitimately need to mention one of these tables in NEW prose
 * without a drain annotation, that's a sign the ground-truth claim has
 * changed — confirm with code-level evidence before editing the gate.
 */

const fs = require('fs');
const path = require('path');
const { isPointInTimeBasename } = require('./lib/point-in-time-files');

const repoRoot = path.resolve(__dirname, '..');

const DRAINED_TABLES = [
  'researchers',
  'publications',
  'researcher_keywords',
  'reviewer_suggestions',
  'grant_cycles',
  'proposal_searches',
];

const SINGLE_FILES = ['CLAUDE.md', 'SESSION_PROMPT.md', 'README.md', 'GEMINI.md'];
const ROOTS = ['docs', '.claude-memory'];
const EXCLUDE_DIR = /(^|\/)(archive|node_modules)(\/|$)/;
// Point-in-time doc classification: see scripts/lib/point-in-time-files.js.

// Files whose purpose IS describing the migration history end-to-end.
// Allowlist is intentionally NARROW after Codex pass-5 review (S167):
//   - Atlas state pages (atlas/postgres-*.md) are NOT allowlisted, because
//     they need to stay current about drain status; per-line annotations
//     are the only way to detect when a state-page contradicts itself.
//   - Lifecycle/design memos are NOT allowlisted; their PG-shape claims
//     are not migration history, they are design assumptions that need
//     to be re-evaluated against current code.
//   - Only migration plans, lessons-learned meta-docs, and memory entries
//     specifically about the migration itself qualify.
// Add to this allowlist with deliberation — broadening hides drift.
const ALLOWLIST_FILES = new Set([
  // Migration plans — describing the cutover history is the doc's purpose.
  'docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md',
  'docs/POSTGRES_TO_DATAVERSE_MIGRATION.md',
  'docs/archive/REVIEWER_FINDER_DATAVERSE_CUTOVER_PLAN.md',
  // Historical design sketch with top supersession banner.
  'docs/REVIEWER_FINDER_FUTURE_ARCHITECTURE.md',
  // Meta-doc cataloging past drift / lessons-learned — the PG mentions
  // ARE the examples being corrected, not state claims.
  'docs/CLAUDE_REMEDIATION_PLAN.md',
  // Wave-4 migration contracts — PG↔DV parity reconciliation contracts.
  'docs/W4_RECONCILE_CONTRACT.md',
  'docs/W4_ANOMALY_TRIAGE.md',
  // Memory entries SPECIFICALLY about the migration itself.
  '.claude-memory/project-reviewer-postgres-to-dataverse-migration.md',
  '.claude-memory/project-w6-table-drop-pending.md',
  '.claude-memory/project-reviewer-finder-dataverse-entry-path.md',
  '.claude-memory/reviewer-identity-fragmentation.md',
  '.claude-memory/project-intake-portal-pilot-decisions-2026-05-06.md',
]);

// Detect the table reference. Six shapes (broadened S167 pass-5 per Codex):
//   `<name>`              — backticked code identifier
//   '<name>'              — single-quoted
//   "<name>"              — double-quoted
//   Postgres <name>       — explicit "Postgres X" phrasing
//   <name>.<column>       — dotted column reference (LHS is exact match)
//   <name> <db-noun>      — bare identifier + table/schema/row/pool/etc.
//   <verb> <name>         — SQL-shape: "reads from X", "writes to X", etc.
const TABLE_NAMES = DRAINED_TABLES.join('|');
const DB_CONTEXT_SUFFIX = '(?:table|tables|schema|column|columns|row|rows|record|records|pool|set|entry|entries)';
const SQL_VERB_PREFIX = '(?:from|into|joins?|inserts?\\s+into|updates?|deletes?\\s+from|reads?\\s+from|writes?\\s+to|stores?\\s+in|drops?|truncates?)';
const TABLE_RE = new RegExp(
  [
    `\`(${TABLE_NAMES})\``,
    `'(${TABLE_NAMES})'`,
    `"(${TABLE_NAMES})"`,
    `\\bPostgres\\s+(${TABLE_NAMES})\\b`,
    `\\b(${TABLE_NAMES})\\.\\w+`,
    `\\b(${TABLE_NAMES})\\s+${DB_CONTEXT_SUFFIX}\\b`,
    `${SQL_VERB_PREFIX}\\s+\`?(${TABLE_NAMES})\`?\\b`,
  ].join('|'),
  'gi',
);

// Same-line keywords/markers that exempt the mention as adequately
// annotated. Tightened S167 pass-5 per Codex: dropped overly permissive
// terms (Dataverse, planned, future-work, from Postgres, bare W[3-6],
// wmkf_app prefix, spec'd) because they can co-occur with stale
// current-state claims like "reads from Postgres X before Dataverse
// migration". Kept only DIRECTIONAL/HISTORICAL markers.
const SAME_LINE_OK = new RegExp(
  [
    // Drain markers — the mention is explicitly labeled retired.
    '\\b(drain|drained|drain-only|drained-only)\\b',
    '\\bhistorical\\b',
    '\\b(RETIRED|retired)\\b',
    '\\b(formerly|legacy)\\b',
    '\\b(superseded|superseding)\\b',
    // Directional cutover-history (must include "post-" or be a past verb).
    '\\bpost-W[3-6]\\b',
    '\\bpre-cutover\\b',
    '\\bcutover\\s+(complete|shipped|done|finished)\\b',
    '\\b(migrated|Migrates|migrates|collapsed|moved|Replaced|replaced|deleted|dropped|removed|reaped|reaping|backfilled)\\b',
    '\\b(snapshot|snapshots)\\b',
    // Strikethrough markdown is an explicit "this is gone" signal.
    '~~',
  ].join('|'),
);

// Same-line structured exemption marker. Optional `reason=` attr (not
// validated beyond presence; used as a hint for grep-driven audits).
const MARKER_RE = /<!--\s*drain-table:ignore(?:\s+reason=[\w-]+)?\s*-->/;

// File-purpose marker. Placed in the first 30 lines of a doc, declares the
// whole file as legitimately about the drained tables. Visible to readers
// (unlike a script-side allowlist) and requires deliberate authorship.
// Constrained S167 pass-6 per Codex: tags are a fixed allowlist, and each
// tag has a path-pattern allowlist — a marker outside its allowed paths is
// a configuration error, not a silent bypass. This prevents anyone from
// sprinkling the marker onto an unrelated file to silence drift.
const FILE_MARKER_RE = /<!--\s*drain-table:file-purpose=([\w-]+)\s*-->/;
const FILE_MARKER_SCAN_LINES = 30;

// Tag → list of path patterns (regex) where the tag is acceptable.
const FILE_MARKER_TAG_PATHS = {
  'atlas-state-page': [
    /^docs\/atlas\/.+\.md$/,
    /^docs\/APPLICATION_STATE_ATLAS\.md$/,
  ],
};

function fileMarkerForText(text) {
  const head = text.split('\n').slice(0, FILE_MARKER_SCAN_LINES).join('\n');
  const m = head.match(FILE_MARKER_RE);
  return m ? m[1] : null;
}

function fileMarkerAcceptable(tag, rel) {
  const patterns = FILE_MARKER_TAG_PATHS[tag];
  if (!patterns) return false;
  return patterns.some((p) => p.test(rel));
}

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
    if (EXCLUDE_DIR.test(rel)) return;
    if (isPointInTimeBasename(path.basename(full))) return;
    if (ALLOWLIST_FILES.has(rel)) return;
    const text = fs.readFileSync(full, 'utf8');
    if (hasPointInTimeFrontmatter(text)) return;
    const markerTag = fileMarkerForText(text);
    if (markerTag) {
      if (!fileMarkerAcceptable(markerTag, rel)) {
        throw new Error(
          `drain-table-mentions configuration error: ${rel} declares file-purpose=${markerTag} but the path is not in that tag's allowed list. Either remove the marker or extend FILE_MARKER_TAG_PATHS with a deliberate justification.`,
        );
      }
      return;
    }
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

function findTableMentions(line) {
  TABLE_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = TABLE_RE.exec(line)) !== null) {
    // The regex has multiple alternations, each capturing the table name in
    // its own group. Pick the first defined capture (skip m[0] which is the
    // whole match).
    const name = m.slice(1).find((g) => typeof g === 'string');
    out.push({ raw: m[0], name, index: m.index });
  }
  return out;
}

function lineIsExempt(line) {
  if (MARKER_RE.test(line)) return true;
  if (SAME_LINE_OK.test(line)) return true;
  return false;
}

function assertAllowlistFilesExist() {
  for (const rel of ALLOWLIST_FILES) {
    const full = path.join(repoRoot, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`drain-table-mentions configuration error: allowlist file does not exist: ${rel}. Remove it from ALLOWLIST_FILES or restore the file.`);
    }
  }
}

function main() {
  assertAllowlistFilesExist();
  const files = collectFiles();
  const violations = [];

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const mentions = findTableMentions(line);
      if (mentions.length === 0) return;
      if (lineIsExempt(line)) return;
      // De-duplicate by table name per line so a line that mentions the
      // same table twice doesn't trigger two violations.
      const seen = new Set();
      for (const m of mentions) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        violations.push({
          rel,
          lineNo: i + 1,
          table: m.name,
          text: line.trim().slice(0, 180),
        });
      }
    });
  }

  if (violations.length > 0) {
    console.error(
      `drain-table-mentions FAILED: ${violations.length} unannotated mention(s) of a drained reviewer-domain Postgres table.\n` +
      `Each drained table mention must carry a same-line drain/historical/post-W context annotation, OR a structured marker:\n` +
      `  <!-- drain-table:ignore reason=<short-reason> -->\n` +
      `Live source of truth is Dataverse: wmkf_potentialreviewer (identity + bibliometrics) / wmkf_appreviewersuggestion / wmkf_appgrantcycle.\n` +
      `If a mention belongs to a doc whose PURPOSE is describing drained tables:\n` +
      `  - Atlas state pages (docs/atlas/*.md, docs/APPLICATION_STATE_ATLAS.md): add a visible top-of-file marker\n` +
      `      <!-- drain-table:file-purpose=atlas-state-page -->\n` +
      `    (The marker's allowed paths are constrained by FILE_MARKER_TAG_PATHS — adding the marker to a non-matching path\n` +
      `    is a configuration error, not a silent bypass.)\n` +
      `  - Migration plans / lessons-learned / migration-memory: add the file to ALLOWLIST_FILES in this script with a\n` +
      `    justification comment. Allowlist is intentionally narrow; do not broaden it to silence drift in state docs.\n`
    );
    for (const v of violations) {
      console.error(`  ✗ ${v.rel}:${v.lineNo} — drained table ${v.table}`);
      console.error(`      ${v.text}`);
    }
    process.exit(1);
  }

  console.log(`drain-table-mentions OK — ${files.length} live doc/memory file(s) scanned; ${ALLOWLIST_FILES.size} allowlisted files skipped; all drained-table mentions carry context annotations.`);
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}
