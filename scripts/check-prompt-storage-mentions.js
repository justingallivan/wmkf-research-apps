#!/usr/bin/env node
/**
 * CI gate: bare mentions of `wmkf_prompt_template` (a proposed-but-never-
 * materialized Dataverse entity) in live docs/memory must carry a
 * historical / superseded / "renamed-to-wmkf_ai_prompt" annotation.
 *
 * Background: the prompt-storage Dataverse table that actually shipped is
 * `wmkf_ai_prompt` (entity set `wmkf_ai_prompts`), not `wmkf_prompt_template`.
 * The latter name appears only in stale planning docs and historical code
 * comments. The Executor service (`lib/services/execute-prompt.js`) reads
 * current prompt rows from `wmkf_ai_prompts` and writes audit rows to
 * `wmkf_ai_runs`. (Codex-verified ground truth, task-mpdhwc2b S167.)
 *
 * S167 audit pass-9 found this drift family (separate from drain-table)
 * across at least 11 docs. This gate is the mechanical fan-in to prevent
 * re-introduction — same architectural shape as check:drain-table-mentions.
 *
 * Detection (7 shapes, mirrors check:drain-table-mentions):
 *   `\`name\``, `'name'`, `"name"`, `Dataverse name`, `name.<col>`,
 *   `name <db-noun>`, `<verb> name`.
 *
 * Exemption (any one passes):
 *   - Same-line directional/historical keyword (historical / retired /
 *     formerly / legacy / superseded / renamed / "never materialized" /
 *     proposed / proposed-but-never-shipped / pre-rename / replaced(-by) /
 *     replaces / strikethrough ~~). Intentionally NOT exempted: bare
 *     `draft`, `pre-shipped`, `Dataverse`, `wmkf_ai_prompt`, or any other
 *     non-directional marker — each can co-occur with a stale claim.
 *   - Same-line structured marker:
 *       <!-- prompt-storage:ignore [reason=<short-id>] -->
 *   - Allowlist entry (script-side; for the historical-record docs).
 *   - File-purpose marker (constrained tag + path):
 *       <!-- prompt-storage:file-purpose=<tag> -->
 *     Registered tags: `design-history` (docs/PROMPT_STORAGE_DESIGN.md
 *     etc — docs whose purpose is recording the rename history).
 */

const fs = require('fs');
const path = require('path');
const { isPointInTimeBasename } = require('./lib/point-in-time-files');

const repoRoot = path.resolve(__dirname, '..');

// Stale prompt-storage entity names that should NOT appear as live claims.
// Scope is intentionally bounded to ENTITY names (not field names): the
// proposed field names `wmkf_output_schema` / `wmkf_variables` / `wmkf_body`
// were also renamed (to `wmkf_ai_promptoutputschema` / `wmkf_ai_promptvariables`
// / `wmkf_ai_promptbody`), but those identifiers are too generic to gate
// without false-positives — e.g. `wmkf_body` is a legitimate field on the
// unrelated `wmkf_policyversion` entity (see REVIEWER_STAGE_2A_BUILD_PLAN.md).
// The field-name rename was applied to design docs in the same sweep as the
// entity-name fix; future drift is a doc-maintenance concern, not gated.
const STALE_ENTITIES = [
  'wmkf_prompt_template',
  'wmkf_prompt_templates',
  'wmkf_prompttemplate',
];

const SINGLE_FILES = ['CLAUDE.md', 'SESSION_PROMPT.md', 'README.md', 'GEMINI.md'];
const ROOTS = ['docs', '.claude-memory'];
const EXCLUDE_DIR = /(^|\/)(archive|node_modules)(\/|$)/;
// Point-in-time doc classification: see scripts/lib/point-in-time-files.js.

// Narrow whole-file allowlist (script-side). For prompt-storage these are
// historical-record docs explicitly documenting the rename.
const ALLOWLIST_FILES = new Set([
  // DEVELOPMENT_LOG.md is a session-by-session history; mentions of
  // wmkf_prompt_template are correct historical records of past sessions.
  'DEVELOPMENT_LOG.md',
]);

// File-purpose marker mechanism — same shape as check:drain-table-mentions.
const FILE_MARKER_RE = /<!--\s*prompt-storage:file-purpose=([\w-]+)\s*-->/;
const FILE_MARKER_SCAN_LINES = 30;
const FILE_MARKER_TAG_PATHS = {
  'design-history': [
    // Docs whose purpose IS recording the rename history.
    /^docs\/PROMPT_STORAGE_DESIGN\.md$/,
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

// Detection regex — 7 shapes (same as check:drain-table-mentions).
const NAMES = STALE_ENTITIES.join('|');
const DB_CONTEXT_SUFFIX = '(?:table|tables|schema|column|columns|row|rows|record|records|entity|entries|set)';
const SQL_VERB_PREFIX = '(?:from|into|joins?|inserts?\\s+into|updates?|deletes?\\s+from|reads?\\s+from|writes?\\s+to|stores?\\s+in|fetches?\\s+from|drops?|truncates?|queries|queried)';
const ENTITY_RE = new RegExp(
  [
    `\`(${NAMES})\``,
    `'(${NAMES})'`,
    `"(${NAMES})"`,
    `\\bDataverse\\s+(${NAMES})\\b`,
    `\\b(${NAMES})\\.\\w+`,
    `\\b(${NAMES})\\s+${DB_CONTEXT_SUFFIX}\\b`,
    `${SQL_VERB_PREFIX}\\s+\`?(${NAMES})\`?\\b`,
  ].join('|'),
  'gi',
);

// Same-line keywords that exempt the mention as adequately annotated.
// Tightened (same lessons as drain-table gate): only directional/historical
// markers. NOT exempted: bare "Dataverse" (a stale claim can mention the
// Dataverse target while still asserting wmkf_prompt_template as live),
// "wmkf_ai_prompt" alone (could be in a contradictory sentence).
// Tightened S167 post-pass-N per Codex: `draft` is too permissive (matches
// "create draft rows in `wmkf_prompt_template`"). Removed. Same architectural
// concern as the drain-table gate's pass-6 keyword pruning.
const SAME_LINE_OK = new RegExp(
  [
    '\\b(historical|RETIRED|retired|formerly|legacy)\\b',
    '\\b(superseded|superseding|renamed|renamed-to|replaced(-by)?|replaces)\\b',
    '\\bproposed(-but-never-(shipped|materialized))?\\b',
    '\\bnever\\s+(materialized|shipped|landed)\\b',
    '\\bpre-rename\\b',
    '~~',
  ].join('|'),
);

const MARKER_RE = /<!--\s*prompt-storage:ignore(?:\s+reason=[\w-]+)?\s*-->/;

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
          `prompt-storage-mentions configuration error: ${rel} declares file-purpose=${markerTag} but the path is not in that tag's allowed list. Either remove the marker or extend FILE_MARKER_TAG_PATHS with a deliberate justification.`,
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

function findMentions(line) {
  ENTITY_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = ENTITY_RE.exec(line)) !== null) {
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
      throw new Error(`prompt-storage-mentions configuration error: allowlist file does not exist: ${rel}. Remove it from ALLOWLIST_FILES or restore the file.`);
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
      const mentions = findMentions(line);
      if (mentions.length === 0) return;
      if (lineIsExempt(line)) return;
      const seen = new Set();
      for (const m of mentions) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        violations.push({
          rel,
          lineNo: i + 1,
          name: m.name,
          text: line.trim().slice(0, 180),
        });
      }
    });
  }

  if (violations.length > 0) {
    console.error(
      `prompt-storage-mentions FAILED: ${violations.length} unannotated mention(s) of a proposed-but-never-materialized prompt-storage entity (wmkf_prompt_template).\n` +
      `The live Dataverse prompt-storage entity is wmkf_ai_prompt (entity set wmkf_ai_prompts) — see lib/services/execute-prompt.js:31. The wmkf_prompt_template name was a 2025-era proposal that never shipped.\n` +
      `Each mention must carry a same-line historical/renamed/superseded annotation, OR a structured marker:\n` +
      `  <!-- prompt-storage:ignore reason=<short-reason> -->\n` +
      `If a mention belongs to a doc whose PURPOSE is documenting the rename history (docs/PROMPT_STORAGE_DESIGN.md), add a visible top-of-file marker:\n` +
      `  <!-- prompt-storage:file-purpose=design-history -->\n` +
      `(The marker's allowed paths are constrained by FILE_MARKER_TAG_PATHS; adding it to a non-matching path is a configuration error.)\n`,
    );
    for (const v of violations) {
      console.error(`  ✗ ${v.rel}:${v.lineNo} — stale entity ${v.name}`);
      console.error(`      ${v.text}`);
    }
    process.exit(1);
  }

  console.log(`prompt-storage-mentions OK — ${files.length} live doc/memory file(s) scanned; ${ALLOWLIST_FILES.size} allowlisted file(s) skipped; all stale-entity mentions carry context annotations.`);
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}
