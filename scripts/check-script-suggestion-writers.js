#!/usr/bin/env node
'use strict';
/**
 * check:script-suggestion-writers — recorded-set gate for operational scripts
 * that write the reviewer-suggestion entity (`wmkf_appreviewersuggestions`)
 * outside the reviewer-engagement command layer.
 *
 * Owner decision D5 (Reviewer Lifecycle Stage 7 plan, 2026-09-06): Stage 7's
 * `check:reviewer-engagement-boundary` gates lib/pages/shared/modules only;
 * `scripts/` was recorded, not gated. This gate closes that gap the same way:
 * every scripts/ file that writes the suggestion entity must appear in the
 * tracked RECORDED_SCRIPT_WRITERS map below. A stale entry (file gone, or no
 * longer writing) fails; an unrecorded writer fails; GROWING the map is pinned
 * separately by tests/unit/script-suggestion-writers-recorded-set.test.js so
 * a silent addition fails there, not here.
 *
 * Writer shapes detected (entity-scoped, plain-text heuristics — scripts are
 * not part of the application import graph, so the AST fixpoint the Stage 7
 * gate uses is not needed; every rule below is documented in the self-test):
 *   dynamics-service   DynamicsService.updateRecord/deleteRecord/createRecord(
 *                      with the suggestion entity set as a string literal, or
 *                      an identifier assigned that literal in the same file.
 *   unresolved-target  the same DynamicsService write with a NON-literal first
 *                      argument in a file that names the entity anywhere —
 *                      fails CLOSED (a helper like deleteOrReport(entitySet, id)
 *                      can delete suggestion rows).
 *   raw-rest           a URL literal `wmkf_appreviewersuggestions(<id>)` with a
 *                      `method: 'PATCH' | 'DELETE'` within 400 chars (own-fetch
 *                      writers bypass the target interlock). Raw POST creates are
 *                      not detected: every script's OAuth token call is a POST.
 *   adapter-generic    updateLifecycle / patchReviewReceipt / patchFields /
 *                      bulkUpdateByRequest called on any binding in a file that
 *                      imports the reviewer-suggestion adapter.
 * Out of scope by name (not by pattern): `scripts/check-*` gate scripts and
 * their self-tests, whose fixture strings deliberately contain writer shapes.
 * Adapter NAMED ops (upsert, softDelete, restore, …) are not generic writers
 * and are not flagged. Read-only scripts are never flagged.
 *
 * Exit 1 on any unrecorded writer or stale record; 0 otherwise.
 *   node scripts/check-script-suggestion-writers.js [--report] [--root <dir>]
 */

const fs = require('fs');
const path = require('path');

const ENTITY_SET = 'wmkf_appreviewersuggestions';
const ENTITY_LOGICAL = 'wmkf_appreviewersuggestion';
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs']);
const GENERIC_WRITERS = ['updateLifecycle', 'patchReviewReceipt', 'patchFields', 'bulkUpdateByRequest'];

/**
 * Tracked recorded set: relative path → sorted writer shapes. Growth is pinned
 * by tests/unit/script-suggestion-writers-recorded-set.test.js.
 */
const RECORDED_SCRIPT_WRITERS = Object.freeze({
  'scripts/backfill-postgres-to-dataverse.js': ['adapter-generic'],
  'scripts/backfill-summary-blob-url-to-dataverse.js': ['dynamics-service'],
  'scripts/find-stage2a-candidates.js': ['dynamics-service'],
  'scripts/pr4-e2e-cleanup.js': ['unresolved-target'],
  'scripts/pr4-e2e-setup.js': ['dynamics-service'],
  'scripts/pr4-e2e.js': ['dynamics-service', 'unresolved-target'],
  'scripts/probe-merge-altkey-ordering.mjs': ['dynamics-service'],
  'scripts/reset-request-reviewers.mjs': ['dynamics-service'],
  'scripts/reset-reviewer-for-testing.js': ['dynamics-service'],
  'scripts/reset-stage2a-state.js': ['dynamics-service'],
  'scripts/restore-request-reviewers-selected.mjs': ['dynamics-service'],
  'scripts/smoke-reviewer-binding.js': ['dynamics-service', 'unresolved-target'],
  'scripts/smoke-test-candidate.mjs': ['dynamics-service'],
});

function walk(dir, root, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs, root, out); continue; }
    if (!entry.isFile() || !SCAN_EXT.has(path.extname(entry.name))) continue;
    out.push(path.relative(root, abs).split(path.sep).join('/'));
  }
  return out;
}

function isOutOfScope(rel) {
  const base = path.posix.basename(rel);
  return base.startsWith('check-');
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Identifier → entity name resolved from a same-file assignment: a string
 * literal (`const SUGG = 'wmkf_appreviewersuggestions'`) or a
 * `resolveEntitySetName('<logical>')` call (`const set = await
 * DynamicsService.resolveEntitySetName('wmkf_appreviewanswer')`). Anything
 * else stays unresolved.
 */
function entityAliases(source) {
  const out = new Map();
  const litRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([A-Za-z_][\w]*)['"`]/g;
  let m;
  while ((m = litRe.exec(source))) out.set(m[1], m[2]);
  const resolveRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:[A-Za-z_$][\w$.]*\.)?resolveEntitySetName\(\s*['"`]([A-Za-z_][\w]*)['"`]\s*\)/g;
  while ((m = resolveRe.exec(source))) out.set(m[1], m[2]);
  return out;
}

function isSuggestionEntityName(name) {
  return name === ENTITY_SET || name === ENTITY_LOGICAL;
}

/** Nearest window heuristic for own-fetch REST writers (documented limit). */
const RAW_REST_WINDOW = 400;

function classify(source) {
  const shapes = new Set();
  const mentionsEntity = source.includes(ENTITY_SET) || source.includes(ENTITY_LOGICAL);
  const aliases = entityAliases(source);

  // dynamics-service / unresolved-target
  const writeRe = /DynamicsService\s*\.\s*(updateRecord|deleteRecord|createRecord)\s*\(\s*([^,)]+)/g;
  let m;
  while ((m = writeRe.exec(source))) {
    const arg = m[2].trim();
    const literal = arg.match(/^['"`]([^'"`]+)['"`]$/);
    if (literal) {
      if (isSuggestionEntityName(literal[1])) shapes.add('dynamics-service');
      continue; // a different entity literal is not this gate's concern
    }
    if (/^[A-Za-z_$][\w$]*$/.test(arg) && aliases.has(arg)) {
      if (isSuggestionEntityName(aliases.get(arg))) shapes.add('dynamics-service');
      continue; // resolved to another entity
    }
    if (mentionsEntity) shapes.add('unresolved-target'); // fail closed
  }

  // raw-rest: a URL literal naming a suggestion row with a PATCH/DELETE method
  // within RAW_REST_WINDOW chars. (A raw POST create is not detected — every
  // script's OAuth token request is a POST, so POST cannot discriminate.)
  const fragRe = new RegExp(`${escapeRe(ENTITY_SET)}\\(`, 'g');
  while ((m = fragRe.exec(source))) {
    const window = source.slice(Math.max(0, m.index - RAW_REST_WINDOW), m.index + RAW_REST_WINDOW);
    if (/method\s*:\s*['"](PATCH|DELETE)['"]/.test(window)) { shapes.add('raw-rest'); break; }
  }

  // adapter-generic
  if (/adapters\/reviewer-suggestion(\.js)?['"]/.test(source)) {
    for (const w of GENERIC_WRITERS) {
      if (new RegExp(`\\b${w}\\s*\\(`).test(source)) { shapes.add('adapter-generic'); break; }
    }
  }
  return [...shapes].sort();
}

function run({ root, report }) {
  const files = walk(path.join(root, 'scripts'), root, []).sort();
  const found = {};
  for (const rel of files) {
    if (isOutOfScope(rel)) continue;
    const shapes = classify(fs.readFileSync(path.join(root, rel), 'utf8'));
    if (shapes.length) found[rel] = shapes;
  }

  const errors = [];
  for (const [rel, shapes] of Object.entries(found)) {
    const recorded = RECORDED_SCRIPT_WRITERS[rel];
    if (!recorded) {
      errors.push(`UNRECORDED writer: ${rel} [${shapes.join(', ')}] — route it through an adapter named op, or add it to RECORDED_SCRIPT_WRITERS AND the recorded-set pin test in the same reviewed commit`);
    } else if (recorded.slice().sort().join('|') !== shapes.join('|')) {
      errors.push(`SHAPE DRIFT: ${rel} recorded [${recorded.join(', ')}] but now [${shapes.join(', ')}]`);
    }
  }
  for (const rel of Object.keys(RECORDED_SCRIPT_WRITERS)) {
    if (!fs.existsSync(path.join(root, rel))) errors.push(`STALE record: ${rel} no longer exists — remove it from RECORDED_SCRIPT_WRITERS and the pin test`);
    else if (!found[rel]) errors.push(`STALE record: ${rel} no longer writes the suggestion entity — remove it from RECORDED_SCRIPT_WRITERS and the pin test`);
  }

  if (report) {
    console.log(`script-suggestion-writers census (${Object.keys(found).length} writer file(s), ${Object.keys(RECORDED_SCRIPT_WRITERS).length} recorded):`);
    for (const [rel, shapes] of Object.entries(found)) {
      console.log(`  - ${rel} [${shapes.join(', ')}] -- ${RECORDED_SCRIPT_WRITERS[rel] ? 'RECORDED' : 'UNRECORDED'}`);
    }
  }
  return { found, errors };
}

function parseArgs(argv) {
  const out = { root: path.resolve(__dirname, '..'), report: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--report') out.report = true;
    else if (argv[i] === '--root') { out.root = path.resolve(argv[i + 1]); i += 1; }
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const { found, errors } = run(args);
  if (errors.length) {
    console.error(`script-suggestion-writers FAILED: ${errors.length} violation(s).`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log(`script-suggestion-writers OK — ${Object.keys(found).length} recorded scripts/ writer(s) of ${ENTITY_SET}, 0 unrecorded, 0 stale.`);
}

module.exports = { RECORDED_SCRIPT_WRITERS, classify, run, ENTITY_SET };
