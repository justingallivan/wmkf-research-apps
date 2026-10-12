/**
 * Golden-string helper for the tool-prompt byte-regression tests (convergence plan Stage 6).
 *
 * The goldens in tests/fixtures/tool-prompt-golden/<app>.json were recorded from the retired
 * hand-written builders under deterministic nonces, keyed by the full jest test name. They keep
 * byte-level protection for the bundled row definitions after the old builders were deleted.
 * Update a golden only for an intentional prompt change (re-record by hand and say why).
 */
import fs from 'fs';
import path from 'path';

const cache = new Map();
function load(app) {
  if (!cache.has(app)) {
    const file = path.join(__dirname, '../fixtures/tool-prompt-golden', `${app}.json`);
    cache.set(app, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return cache.get(app);
}

/** Assert `actual` is byte-equal to the golden recorded under the current test's full name. */
export function expectGolden(app, actual) {
  const key = expect.getState().currentTestName;
  const goldens = load(app);
  expect(Object.keys(goldens)).toContain(key);
  expect(actual).toBe(goldens[key]);
}

export const goldenCount = (app) => Object.keys(load(app)).length;
