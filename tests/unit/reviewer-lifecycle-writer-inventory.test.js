/** @jest-environment node */

const { analyzeSource } = require('../../scripts/inventory-reviewer-lifecycle-writers.js');

const sourceFile = 'lib/services/census-fixture.js';

test('resolves named, namespace, local and literal property aliases without counting comments', () => {
  const result = analyzeSource(sourceFile, `
    import { updateLifecycle as correct } from '../dataverse/adapters/reviewer-suggestion.js';
    import * as suggestions from '../dataverse/adapters/reviewer-suggestion';
    const attach = suggestions.patchReviewReceipt;
    correct(id, updates);
    attach(id, pointer);
    suggestions['patchFields'](id, claim);
    // suggestions.updateLifecycle(id, fake);
    const example = "correct(id, fake)";
  `);
  expect(result.calls.map(({ binding, target }) => ({ binding, target }))).toEqual([
    { binding: 'correct', target: 'suggestion:updateLifecycle' },
    { binding: 'attach', target: 'suggestion:patchReviewReceipt' },
    { binding: "suggestions['patchFields']", target: 'suggestion:patchFields' },
  ]);
  expect(result.unresolved).toEqual([]);
});

test('resolves actual DI fallback and destructured default shapes used by merge and honorarium', () => {
  const result = analyzeSource(sourceFile, `
    import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
    import { runChangeset } from '../dataverse/core/changeset.js';
    function work({ suggestions = suggestionAdapter }, deps) {
      suggestions.setHonorariumRequest(id, honorarium);
      const sug = deps.suggestions || suggestionAdapter;
      sug.repointToPotentialReviewer(id, keeper);
      const runAtomic = deps.runAtomic || runChangeset;
      runAtomic(operations);
    }
  `);
  expect(result.calls.map((call) => call.target)).toEqual([
    'suggestion:setHonorariumRequest',
    'suggestion:repointToPotentialReviewer',
    'changeset:runChangeset',
  ]);
});

test('resolves require, destructuring and literal dynamic imports in administrative scripts', () => {
  const result = analyzeSource('scripts/census-fixture.mjs', `
    const adapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
    const { restore: reset } = adapter;
    const { patchFields: stamp } = require('../lib/dataverse/adapters/reviewer-suggestion');
    reset(id); stamp(id, fields); adapter.findById(id);
  `);
  expect(result.calls.map((call) => call.target)).toEqual([
    'suggestion:restore', 'suggestion:patchFields', 'suggestion:findById',
  ]);
});

test('reports computed calls through recognized bindings instead of silently treating them as absent', () => {
  const result = analyzeSource(sourceFile, `
    import * as suggestion from '../dataverse/adapters/reviewer-suggestion';
    suggestion[action](id, payload);
    unrelated[action](id, payload);
  `);
  expect(result.calls).toEqual([]);
  expect(result.unresolved).toEqual([{ file: sourceFile, line: 3, binding: 'suggestion[action]' }]);
});

test('does not call an unrelated arithmetic expression a dependency fallback', () => {
  const result = analyzeSource(sourceFile, `
    import { updateLifecycle } from '../dataverse/adapters/reviewer-suggestion';
    const unrelated = 1 + updateLifecycle;
    unrelated(id);
  `);
  expect(result.calls).toEqual([]);
});

test('reports parse failures and understands JSX in the JavaScript files it scans', () => {
  expect(analyzeSource(sourceFile, 'function broken( {').parseErrors.length).toBeGreaterThan(0);
  const valid = analyzeSource(sourceFile, `
    import { patchFields } from '../dataverse/adapters/reviewer-suggestion';
    const view = <button onClick={() => patchFields(id, fields)}>Update</button>;
  `);
  expect(valid.parseErrors).toEqual([]);
  expect(valid.calls.map((call) => call.target)).toEqual(['suggestion:patchFields']);
});
