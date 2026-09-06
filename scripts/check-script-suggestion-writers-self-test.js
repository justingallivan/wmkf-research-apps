#!/usr/bin/env node
'use strict';
/**
 * Self-test for check:script-suggestion-writers. Builds a temp `--root` fixture
 * tree (never touches the real scripts/ dir) and proves, shape by shape:
 *   RED   dynamics-service via literal; via same-file alias; via logical-name
 *         literal; deleteRecord; createRecord
 *   RED   unresolved-target (helper param) in a file naming the entity
 *   RED   raw-rest PATCH and DELETE against a suggestion-row URL
 *   RED   adapter-generic (updateLifecycle / patchReviewReceipt) with the
 *         adapter imported
 *   GREEN read-only script; adapter NAMED op (upsert/softDelete); write to a
 *         different entity literal; alias resolved to a different entity;
 *         resolveEntitySetName resolved to a different entity; raw-rest GET-only
 *         with the token POST present; the entity fragment only as @odata.bind
 *         with no PATCH/DELETE nearby; scripts/check-* out of scope by name
 *   STALE recorded file missing → red; recorded file no longer writing → red
 *   SHAPE recorded shapes drift → red
 *   Green-only tree with the recorded set satisfied → exit 0
 * Runs the gate via child_process so the exit code is what CI sees.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-script-suggestion-writers.js');
const { classify } = require(GATE);

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}

const ADAPTER_IMPORT = "import * as suggestionAdapter from '../lib/dataverse/adapters/reviewer-suggestion.js';\n";
const DS_IMPORT = "import { DynamicsService } from '../lib/services/dynamics-service.js';\n";
const TOKEN_POST = "const tok = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });\n";

const RED = {
  'literal update': `${DS_IMPORT}await DynamicsService.updateRecord('wmkf_appreviewersuggestions', id, { wmkf_selected: false });\n`,
  'alias update': `${DS_IMPORT}const SUGG = 'wmkf_appreviewersuggestions';\nawait DynamicsService.updateRecord(SUGG, id, {});\n`,
  'logical-name literal': `${DS_IMPORT}await DynamicsService.updateRecord('wmkf_appreviewersuggestion', id, {});\n`,
  'literal delete': `${DS_IMPORT}await DynamicsService.deleteRecord("wmkf_appreviewersuggestions", id);\n`,
  'literal create': `${DS_IMPORT}await DynamicsService.createRecord(\`wmkf_appreviewersuggestions\`, {});\n`,
  'unresolved helper param': `${DS_IMPORT}// cleans up wmkf_appreviewersuggestions rows\nasync function deleteOrDeactivate(entitySet, id) { await DynamicsService.deleteRecord(entitySet, id); }\n`,
  'raw-rest PATCH': `${TOKEN_POST}await fetch(\`\${base}/api/data/v9.2/wmkf_appreviewersuggestions(\${id})\`, { method: 'PATCH', headers: h, body: JSON.stringify(p) });\n`,
  'raw-rest DELETE': `${TOKEN_POST}const r = await fetch(\`\${base}/wmkf_appreviewersuggestions(\${id})\`, {\n  method: 'DELETE', headers: h });\n`,
  'adapter-generic updateLifecycle': `${ADAPTER_IMPORT}await suggestionAdapter.updateLifecycle(id, { invited: true });\n`,
  'adapter-generic patchReviewReceipt destructured': `import { patchReviewReceipt } from '../lib/dataverse/adapters/reviewer-suggestion';\nawait patchReviewReceipt(id, {});\n`,
};
const EXPECT_SHAPE = {
  'literal update': ['dynamics-service'], 'alias update': ['dynamics-service'], 'logical-name literal': ['dynamics-service'],
  'literal delete': ['dynamics-service'], 'literal create': ['dynamics-service'],
  'unresolved helper param': ['unresolved-target'],
  'raw-rest PATCH': ['raw-rest'], 'raw-rest DELETE': ['raw-rest'],
  'adapter-generic updateLifecycle': ['adapter-generic'], 'adapter-generic patchReviewReceipt destructured': ['adapter-generic'],
};
const GREEN = {
  'read-only': `${DS_IMPORT}const { records } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', { select: 'wmkf_selected' });\n`,
  'adapter named ops': `${ADAPTER_IMPORT}await suggestionAdapter.upsert({});\nawait suggestionAdapter.softDelete(id, {});\n`,
  'other entity literal': `${DS_IMPORT}// reads wmkf_appreviewersuggestions first\nawait DynamicsService.updateRecord('wmkf_potentialreviewerses', id, {});\n`,
  'alias to other entity': `${DS_IMPORT}const PR = 'wmkf_potentialreviewerses';\nconst SUGG = 'wmkf_appreviewersuggestions';\nawait DynamicsService.updateRecord(PR, id, {});\n`,
  'resolveEntitySetName other entity': `${DS_IMPORT}const answers = await DynamicsService.resolveEntitySetName('wmkf_appreviewanswer');\nconst sug = await DynamicsService.getRecord('wmkf_appreviewersuggestions', id);\nawait DynamicsService.deleteRecord(answers, a.id);\n`,
  'raw GET only with token POST': `${TOKEN_POST}const sug = await get(token, \`/wmkf_appreviewersuggestions(\${id})?$select=wmkf_selected\`);\n`,
  'odata.bind fragment, no nearby write': `${TOKEN_POST}const body = { 'wmkf_AppReviewerSuggestion@odata.bind': \`/wmkf_appreviewersuggestions(\${id})\` };\n${'// filler\n'.repeat(60)}const ops = [{ method: 'PATCH', url: \`wmkf_reviewquestions(\${q})\` }];\n`,
};

console.log('check-script-suggestion-writers self-test');
console.log('classify():');
for (const [label, src] of Object.entries(RED)) {
  const got = classify(src);
  check(`RED ${label} → [${EXPECT_SHAPE[label]}]`, JSON.stringify(got) === JSON.stringify(EXPECT_SHAPE[label]), `got [${got}]`);
}
for (const [label, src] of Object.entries(GREEN)) {
  const got = classify(src);
  check(`GREEN ${label}`, got.length === 0, `got [${got}]`);
}

// ── Gate runs over a temp root ────────────────────────────────────────────
function runGate(root) {
  try {
    const out = execFileSync('node', [GATE, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}
function makeRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssw-selftest-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), src);
  return root;
}
const { RECORDED_SCRIPT_WRITERS } = require(GATE);
const recordedNames = Object.keys(RECORDED_SCRIPT_WRITERS);

// A tree that satisfies the recorded set exactly: every recorded file present
// and writing with exactly its recorded shapes.
function satisfyingFiles() {
  const files = {};
  for (const [rel, shapes] of Object.entries(RECORDED_SCRIPT_WRITERS)) {
    let src = DS_IMPORT + ADAPTER_IMPORT;
    if (shapes.includes('dynamics-service')) src += RED['literal update'];
    if (shapes.includes('unresolved-target')) src += RED['unresolved helper param'];
    if (shapes.includes('raw-rest')) src += RED['raw-rest PATCH'];
    if (shapes.includes('adapter-generic')) src += "await suggestionAdapter.updateLifecycle(id, {});\n";
    files[rel] = src;
  }
  return files;
}

console.log('gate runs (--root temp tree):');
{
  const root = makeRoot({ ...satisfyingFiles(), 'scripts/readonly-probe.mjs': GREEN['read-only'], 'scripts/check-something-self-test.js': RED['literal update'] });
  const r = runGate(root);
  check('green-only tree (recorded set satisfied, read-only + check-* present) exits 0', r.code === 0, r.out);
}
{
  const root = makeRoot({ ...satisfyingFiles(), 'scripts/new-raw-writer.mjs': RED['raw-rest PATCH'] });
  const r = runGate(root);
  check('unrecorded writer exits 1 and is named', r.code === 1 && /UNRECORDED writer: scripts\/new-raw-writer\.mjs \[raw-rest\]/.test(r.out), r.out);
}
{
  const files = satisfyingFiles(); delete files[recordedNames[0]];
  const r = runGate(makeRoot(files));
  check('recorded file missing → STALE, exits 1', r.code === 1 && new RegExp(`STALE record: ${recordedNames[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} no longer exists`).test(r.out), r.out);
}
{
  const files = satisfyingFiles(); files[recordedNames[0]] = GREEN['read-only'];
  const r = runGate(makeRoot(files));
  check('recorded file no longer writing → STALE, exits 1', r.code === 1 && /STALE record: .* no longer writes/.test(r.out), r.out);
}
{
  const files = satisfyingFiles(); files[recordedNames[0]] = DS_IMPORT + RED['literal update'] + RED['raw-rest PATCH'] + RED['unresolved helper param'];
  const r = runGate(makeRoot(files));
  check('recorded shapes drift → SHAPE DRIFT, exits 1', r.code === 1 && /SHAPE DRIFT/.test(r.out), r.out);
}
{
  const r = runGate(makeRoot({}));
  check('empty scripts/ dir → every record stale, exits 1', r.code === 1 && (r.out.match(/STALE record/g) || []).length === recordedNames.length, r.out);
}

if (failures) {
  console.error(`\ncheck-script-suggestion-writers self-test FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log('\ncheck-script-suggestion-writers self-test OK.');
