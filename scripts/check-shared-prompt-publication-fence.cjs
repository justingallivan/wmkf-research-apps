#!/usr/bin/env node
/**
 * Offline PR #553 fence counterexamples. No imports of application services,
 * env files, credentials or network APIs. Executes the existing PURE runtime
 * budget resolver extracted by AST, then models prospective commit protocols.
 * Model checks are algorithm evidence, NOT Dataverse transaction proof.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib/services/execute-prompt.js'), 'utf8');
const ast = parser.parse(source, { sourceType: 'module' });
const fn = ast.program.body.find(node => node.type === 'ExportNamedDeclaration'
  && node.declaration?.type === 'FunctionDeclaration'
  && node.declaration.id?.name === 'resolveMaxTokensForCall')?.declaration;
assert(fn, 'Actual exported resolver must be found');
const resolve = vm.runInNewContext(`(${source.slice(fn.start, fn.end)})`, Object.create(null), { timeout: 1000 });
const evidence = { readOnlyOffline: true, source: 'lib/services/execute-prompt.js', function: 'resolveMaxTokensForCall', checks: [] };
function record(name, facts) { evidence.checks.push({ name, ...facts }); }

// Each writer validates a different old snapshot, then both commit.
const initial = { modelCeiling: 64000, budget: 16000 };
const raisedBudget = 48000;
const loweredCeiling = 32000;
assert(raisedBudget <= initial.modelCeiling);
assert(initial.budget <= loweredCeiling);
const raced = { modelCeiling: loweredCeiling, budget: raisedBudget };
assert(raced.budget > raced.modelCeiling);
const capped = resolve({ configuredMaxTokens: 8000, maxTokensOverride: raced.budget, model: 'offline-fixture', maxOutputTokens: raced.modelCeiling });
assert.equal(capped, 32000);
record('check-then-write-budget-model-race', { savedPairCompatible: false, providerOverrideAfterActualRuntimeGuard: capped, conclusion: 'Provider ceiling protected, saved-pair consistency NOT protected; override is capped, not always rejected.' });
assert.throws(() => resolve({ configuredMaxTokens: 48000, maxTokensOverride: null, model: 'offline-fixture', maxOutputTokens: 32000 }), /exceeds reviewed limit/);
record('actual-runtime-row-budget', { conclusion: 'Oversized stored row budget without override is rejected.' });
assert.throws(() => resolve({ configuredMaxTokens: 8000, maxTokensOverride: 48000, model: 'offline-fixture', maxOutputTokens: 32000, minimumEffectiveMaxTokensExclusive: 32000 }), /must exceed prior attempt budget/);
record('actual-runtime-strict-retry-floor', { conclusion: 'Capped retry at the prior-attempt floor is rejected.' });

// A one-time equality read cannot enforce latest accepted policy AT COMMIT.
let activePolicy = 'p1';
const checked = activePolicy;
assert.equal(checked, 'p1');
activePolicy = 'p2';
assert.notEqual(checked, activePolicy);
record('mutable-policy-equality-read', { checkedPolicy: checked, policyAtLaterCommit: activePolicy, conclusion: 'Read-time equality alone does not prove commit-time freshness.' });

// Prospective budget-scoped CAS, with model validation bound to original rev.
for (const first of ['budget', 'model']) {
  const state = { revision: 0, ...initial };
  const expected = 0;
  if (first === 'budget') state.budget = raisedBudget;
  else state.modelCeiling = loweredCeiling;
  state.revision++;
  const secondCanCommit = state.revision === expected;
  assert.equal(secondCanCommit, false);
  assert(state.budget <= state.modelCeiling);
  record(`modeled-budget-CAS-${first}-first`, { secondCanCommit, savedPairCompatible: true, conclusion: 'Original-revision CAS rejects the stale second commit; platform implementation still untested.' });
}

// Pinned policy has no runtime activation writer; deployment drains old writes.
const installedArtifact = Object.freeze({ version: 1, hash: 'fixture-reviewed-v1' });
const accepts = request => request.version === installedArtifact.version && request.hash === installedArtifact.hash;
assert(accepts({ version: 1, hash: 'fixture-reviewed-v1' }));
assert(!accepts({ version: 1, hash: 'fixture-other-artifact' }));
assert(!accepts({ version: 2, hash: 'fixture-reviewed-v2' }));
record('modeled-deployment-pinned-policy', { conclusion: 'Exact version+artifact hash pin rejects stale/unknown policy; safe replacement requires disabled writers and drained in-flight calls. No mutable policy activation is offered.' });
const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1) {
  assert(process.argv[outputIndex + 1], '--output requires a file path');
  fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify(evidence, null, 2));
