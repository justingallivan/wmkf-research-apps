#!/usr/bin/env node
'use strict';

/**
 * check:status-enum-parity — deterministic guard for the "producer-without-
 * consumer-sweep" defect class (S257 retro: a value added to a producer set —
 * an enum/status/templateType — but NOT to a consumer that maps/labels/buckets
 * it, so the new value silently falls through unstyled / uncounted / unhandled).
 *
 * This is the CONTROL behind the contract-reconcile "complement & fan-out" rule:
 * a written rule can't fire itself, so this gate enforces a registry of
 * producer↔consumer key-parity invariants and fails the commit when they drift.
 *
 * Extending it: when you add a producer set whose values must be mirrored by a
 * consumer (a label map, a filter bucket, a count rollup), add a REGISTRY entry.
 * Runtime-enforced pairs (derived inverses, runtime-throwing merges) need no entry.
 *
 *   node scripts/check-status-enum-parity.js              # the live gate
 *   node scripts/check-status-enum-parity.js --self-test  # guards the gate's own logic
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ── pure extractors (unit-tested via --self-test) ─────────────────────────────

// Top-level keys of `const NAME = { ... }` (identifier or quoted keys). Depth-aware:
// nested object values ({ label, cls }) are stripped so only the outer keys remain.
function extractObjectKeys(src, name) {
  const m = src.match(new RegExp(`(?:const|export const)\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) return null;
  let body = m[1];
  let prev;
  do { prev = body; body = body.replace(/\{[^{}]*\}/g, ''); } while (body !== prev);
  const keys = [];
  const re = /(?:^|\n|,)\s*['"]?([A-Za-z_][\w-]*)['"]?\s*:/g;
  let k;
  while ((k = re.exec(body))) keys.push(k[1]);
  return keys;
}

// String members of `const NAME = [ 'a', 'b' ]`.
function extractArrayStrings(src, name) {
  const m = src.match(new RegExp(`(?:const|export const)\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

// String literals returned by `function NAME(...) { ... }` (single-quoted returns).
function extractReturnedStrings(src, name) {
  const m = src.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) return null;
  return [...m[1].matchAll(/return\s+'([^']+)'/g)].map((x) => x[1]);
}

// producer keys must all appear in consumer keys (rule 'subset'); 'equal' also
// forbids consumer-only keys. Returns { missing, extra }.
function parity(producer, consumer, rule) {
  const cset = new Set(consumer);
  const pset = new Set(producer);
  const missing = producer.filter((k) => !cset.has(k));        // produced, not consumed
  const extra = rule === 'equal' ? consumer.filter((k) => !pset.has(k)) : [];
  return { missing, extra };
}

// ── registry of live invariants ───────────────────────────────────────────────

function registry() {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const checks = [];

  // 1. dashboard workRemaining stages → workbench STAGE_META chip labels (subset).
  //    The exact pair that bit S257 chunk 8: deriveWorkRemaining returned 'held' but
  //    STAGE_META had no entry, so the chip rendered an unstyled raw string.
  {
    const dash = read('pages/api/workbench/dashboard.js');
    const wb = read('pages/workbench.js');
    checks.push({
      name: 'workRemaining stages ⊆ STAGE_META chips',
      producer: 'deriveWorkRemaining() returns (dashboard.js)',
      consumer: 'STAGE_META keys (workbench.js)',
      produced: extractReturnedStrings(dash, 'deriveWorkRemaining'),
      consumed: extractObjectKeys(wb, 'STAGE_META'),
      rule: 'subset',
    });
  }

  // NOTE — reviewer email template parity (TEMPLATE_TYPES ↔ DEFAULT_TEMPLATES ↔
  // TEMPLATE_TYPE_LABELS) is intentionally NOT registered here: it's already enforced
  // at RUNTIME (mergeTemplates dereferences DEFAULT_TEMPLATES[type] and throws on a
  // missing type) and by tests/unit/email-template-store.test.js. Register a pair here
  // only when nothing else enforces it. (email-template-store is ESM → not require-able
  // from this plain-node gate anyway.)

  return checks;
}

function runLive() {
  const checks = registry();
  const failures = [];
  for (const c of checks) {
    if (!Array.isArray(c.produced) || !Array.isArray(c.consumed)) {
      failures.push(`${c.name}: could not extract keys (producer=${c.produced}, consumer=${c.consumed}) — extraction may need updating.`);
      continue;
    }
    const { missing, extra } = parity(c.produced, c.consumed, c.rule);
    if (missing.length || extra.length) {
      const bits = [];
      if (missing.length) bits.push(`produced but not consumed (${c.consumer}): ${missing.join(', ')}`);
      if (extra.length) bits.push(`consumed but not produced (${c.producer}): ${extra.join(', ')}`);
      failures.push(`${c.name} — ${bits.join('; ')}`);
    }
  }
  if (failures.length) {
    console.error('✗ status-enum-parity FAILED — a producer value has no matching consumer entry:');
    for (const f of failures) console.error(`  • ${f}`);
    console.error('Add the value to the consumer surface (label map / filter bucket / count), or register the pair if new.');
    process.exit(1);
  }
  console.log(`status-enum-parity OK — ${checks.length} producer↔consumer invariant(s) in sync.`);
}

function selfTest() {
  const cases = [];
  const ok = (label, cond) => cases.push([label, cond]);

  // extractors
  ok('extractObjectKeys', JSON.stringify(extractObjectKeys('const M = {\n  a: 1,\n  "b-c": 2,\n};', 'M')) === JSON.stringify(['a', 'b-c']));
  ok('extractArrayStrings', JSON.stringify(extractArrayStrings("const T = ['x', 'y'];", 'T')) === JSON.stringify(['x', 'y']));
  ok('extractReturnedStrings', JSON.stringify(extractReturnedStrings("function f(c) {\n  if (c) return 'held';\n  return 'find';\n}", 'f')) === JSON.stringify(['held', 'find']));
  ok('missing extractor → null', extractObjectKeys('const Z = 1;', 'M') === null);

  // parity logic — the core control
  ok('subset: producer value missing from consumer is flagged', parity(['a', 'held'], ['a'], 'subset').missing.join() === 'held');
  ok('subset: consumer-only key is allowed', parity(['a'], ['a', 'b'], 'subset').extra.length === 0);
  ok('equal: consumer-only key is flagged', parity(['a'], ['a', 'b'], 'equal').extra.join() === 'b');
  ok('clean parity → no violations', parity(['a', 'b'], ['b', 'a'], 'equal').missing.length === 0 && parity(['a', 'b'], ['b', 'a'], 'equal').extra.length === 0);

  // the synthetic miss this gate exists to catch (workRemaining adds 'held', STAGE_META doesn't)
  const dashFixture = "function deriveWorkRemaining(c) {\n  if (c.x) return 'review';\n  if (c.y) return 'held';\n  return 'find';\n}";
  const wbMissing = "const STAGE_META = {\n  review: {},\n  find: {},\n};";
  ok('catches held missing from STAGE_META', parity(extractReturnedStrings(dashFixture, 'deriveWorkRemaining'), extractObjectKeys(wbMissing, 'STAGE_META'), 'subset').missing.join() === 'held');
  const wbComplete = "const STAGE_META = {\n  review: {},\n  held: {},\n  find: {},\n};";
  ok('passes when STAGE_META has held', parity(extractReturnedStrings(dashFixture, 'deriveWorkRemaining'), extractObjectKeys(wbComplete, 'STAGE_META'), 'subset').missing.length === 0);

  let failed = 0;
  for (const [label, cond] of cases) {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
    if (!cond) failed++;
  }
  if (failed) { console.error(`status-enum-parity self-test FAILED — ${failed}/${cases.length}`); process.exit(1); }
  console.log(`status-enum-parity self-test OK — ${cases.length}/${cases.length}`);
}

if (process.argv.includes('--self-test')) selfTest();
else runLive();
