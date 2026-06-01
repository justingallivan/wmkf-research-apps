#!/usr/bin/env node
/**
 * Doc currency drift detector — CI gate.
 *
 * Surfaces docs that claim outdated state, beyond what age + status-verb
 * scanning catches. Configured via the DRIFT_PATTERNS array below — each
 * entry is a string pattern + a reason + an optional `allow` list of
 * filename basenames where the pattern is intentional (Atlas teaching
 * pages, schema-file-name references, historical narrative).
 *
 * Usage:
 *   node scripts/check-doc-currency.js
 *
 * Exit code:
 *   0 — no hits
 *   1 — drift found; investigate each hit, either fix the doc or add the
 *       basename to the pattern's `allow` list with a one-line reason.
 *
 * Promoted to a CI gate in S141 (2026-05-08). Before then this was a
 * manual flagging tool. When adding a new pattern, also add the basename
 * of any intentional historical reference to its `allow` list — most
 * "code-name drift" hits in atlas/ pages and historical-narrative
 * sections are intentional teaching references, not regressions.
 */

const fs = require('fs');
const path = require('path');

const DOCS_DIRS = ['docs'];
// Skip prefixes are normalized to no trailing slash; comparison uses
// exact-match-or-startsWith(prefix + path.sep) so a directory named
// `docs/archive` matches but `docs/archive_old` would not.
const SKIP_DIRS = ['docs/archive', 'docs/security-audit'];

// Each pattern: { id, kind, needle (string or RegExp), reason, allow (optional) }
// `allow` is a list of filename basenames where the pattern is expected
// (e.g., a doc that explicitly catalogs the wrong-form name as a known
// drift example).
const DRIFT_PATTERNS = [
  // 1. Code-name drift — wrong/renamed custom-entity names
  // The underscored forms are also used as schema *file* names in
  // `lib/dataverse/schema/wave2/` (e.g., `wmkf_app_researcher.json`).
  // Atlas pages and the migration plans intentionally reference both
  // names to teach the gotcha; allow list covers those.
  {
    id: 'codename-wmkf_app_researcher',
    kind: 'code-name drift',
    needle: /wmkf_app_researcher\b/g,
    reason:
      'Entity is named `wmkf_appresearcher` (no underscore after prefix) per Atlas. The underscored form was a documented prior failure pattern.',
    allow: [
      'CLAUDE_COVERAGE_LESSONS.md',
      'CLAUDE_REMEDIATION_PLAN.md',
      'POSTGRES_TO_DATAVERSE_MIGRATION.md',
      'REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md',
      'DOC_TRIAGE_2026-05-07.md',
      // References the real schema-as-code filename
      // lib/dataverse/schema/wave2/wmkf_app_researcher.json (deployed entity is
      // wmkf_appresearcher); the doc explicitly clarifies the file-vs-entity split.
      'APPRESEARCHER_COLLAPSE_PLAN.md',
      'check-doc-currency.js',
    ],
  },
  {
    id: 'codename-wmkf_app_publication',
    kind: 'code-name drift',
    needle: /wmkf_app_publication\b(?!_author)/g,
    reason:
      'Entity is named `wmkf_apppublication` (no underscore after prefix) per Atlas.',
    allow: [
      'CLAUDE_COVERAGE_LESSONS.md',
      'POSTGRES_TO_DATAVERSE_MIGRATION.md',
      'REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md',
      'dataverse-wmkf-apppublication-and-appgrantcycle.md',
      'postgres-publications.md',
      // References the real schema-as-code filename
      // lib/dataverse/schema/wave2/wmkf_app_publication.json (deployed entity
      // is wmkf_apppublication).
      'APPRESEARCHER_COLLAPSE_PLAN.md',
    ],
  },
  {
    id: 'codename-wmkf_ai_run-stale-cols',
    kind: 'code-name drift',
    needle: /wmkf_prompt_was_overridden|wmkf_run_source(?!\w)/g,
    reason:
      'Live field names are `wmkf_ai_promptoverridden` and `wmkf_ai_runsource`. The underscored / no-prefix names were stale doc artifacts; columns already exist in production per execute-prompt.js.',
    allow: ['DOC_TRIAGE_2026-05-07.md', 'check-doc-currency.js'],
  },

  // 2. Table-liveness mismatch — Atlas-marked dead tables described as live
  // Patterns require the descriptor to follow the table name within ~80
  // chars and use a word-boundary so "Short-lived" / "Short-live" don't
  // false-positive on "live".
  {
    id: 'liveness-publications-as-live',
    kind: 'table-liveness mismatch',
    needle: /\bpublications\b[^.\n]{0,80}\b(load-bearing|currently active|currently live|primary table)\b/gi,
    reason:
      'Atlas marks Postgres `publications` as 0 rows / dead. Docs describing it as load-bearing are stale.',
    // AUDIT_S154_MEMORY_CODEX.md quotes the stale "still load-bearing" memory claim verbatim in order to mark it STALE — historical audit record, not an assertion.
    allow: ['DOC_TRIAGE_2026-05-07.md', 'check-doc-currency.js', 'AUDIT_S154_MEMORY_CODEX.md'],
  },
  {
    id: 'liveness-search_cache-as-live',
    kind: 'table-liveness mismatch',
    needle: /\bsearch_cache\b[^.\n]{0,80}\b(load-bearing|currently active|currently live|primary table)\b/gi,
    reason:
      'Atlas marks Postgres `search_cache` as dead/empty. Docs describing it as load-bearing are stale.',
    allow: ['DOC_TRIAGE_2026-05-07.md', 'check-doc-currency.js'],
  },

  // 3. Source-of-truth drift
  // The earlier regex was directionally wrong (matched the correct
  // statement). Replaced with a positive claim regex: any sentence
  // asserting "prompt-resolver reads/queries wmkf_ai_prompt" without
  // mentioning the wmkf_ai_run scratch row contract. The
  // (?!.*\b(does not|doesn't|never|no longer)\b) lookahead before the
  // verb prevents the regex from firing on negated statements like
  // "prompt-resolver does not read wmkf_ai_prompt" — which would
  // otherwise satisfy the pattern and mask a real stale-doc claim.
  {
    id: 'sot-prompt-resolver-reads-prompt-table',
    kind: 'source-of-truth drift',
    needle: /prompt-resolver(?:\.js)?(?![^\n.]{0,40}\b(?:does not|doesn't|never|no longer)\b)[^\n.]{0,40}\b(reads?|queries|fetches)\b[^\n.]{0,40}\bwmkf_ai_prompt\b(?![^\n.]{0,80}wmkf_ai_run)/gi,
    reason:
      'Atlas notes prompt-resolver.js reads from a `wmkf_ai_run` scratch row, not from `wmkf_ai_prompt` directly. Docs claiming the latter without naming the scratch row are stale.',
  },

  // 4. Path-contract drift — non-canonical SharePoint folders
  {
    id: 'path-reviewer-uploads-wrong-shape',
    kind: 'path-contract drift',
    needle: /Reviewer_Upload\b(?!s\/\{)/g,
    reason:
      'Canonical path is `Reviewer_Uploads/{reviewerSubfolder}` (plural, with subfolder). Singular or other shapes are stale.',
    allow: ['check-doc-currency.js'],
  },
  {
    id: 'path-reviewer-downloads-wrong-shape',
    kind: 'path-contract drift',
    needle: /Reviewer_Download\b(?!s\/)/g,
    reason:
      'Canonical path is `Reviewer_Downloads/`. Singular forms are stale.',
    allow: ['check-doc-currency.js'],
  },
];

function isSkippedDir(full) {
  // Match exact dir or any descendant of a skipped dir.
  return SKIP_DIRS.some((p) => full === p || full.startsWith(p + path.sep));
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedDir(full)) continue;
      yield* walk(full);
    } else if (entry.isFile() && full.endsWith('.md')) {
      yield full;
    }
  }
}

function checkFile(file, hits) {
  const content = fs.readFileSync(file, 'utf8');
  const basename = path.basename(file);
  for (const pat of DRIFT_PATTERNS) {
    if (pat.allow && pat.allow.includes(basename)) continue;
    const matches = content.match(pat.needle);
    if (matches && matches.length > 0) {
      hits.push({
        file,
        patternId: pat.id,
        kind: pat.kind,
        count: matches.length,
        reason: pat.reason,
        sample: matches[0].slice(0, 80),
      });
    }
  }
}

function main() {
  const hits = [];
  for (const dir of DOCS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      checkFile(file, hits);
    }
  }

  if (hits.length === 0) {
    console.log('✓ No drift markers found across', DRIFT_PATTERNS.length, 'patterns.');
    return;
  }

  console.log(`Found ${hits.length} drift hit(s) across ${DRIFT_PATTERNS.length} patterns:\n`);

  const byKind = {};
  for (const hit of hits) {
    (byKind[hit.kind] = byKind[hit.kind] || []).push(hit);
  }

  for (const kind of Object.keys(byKind).sort()) {
    console.log(`## ${kind} (${byKind[kind].length})\n`);
    for (const hit of byKind[kind]) {
      console.log(`  ${hit.file}`);
      console.log(`    pattern: ${hit.patternId} (×${hit.count})`);
      console.log(`    sample:  ${hit.sample}`);
      console.log(`    reason:  ${hit.reason}\n`);
    }
  }

  console.log(
    '\nEach hit is either drift (fix the doc) or an intentional historical/teaching reference (add the basename to the pattern\'s `allow` list with a one-line reason). Failing the gate without a clear root-cause is the wrong outcome — investigate each hit.'
  );
  process.exit(1);
}

main();
