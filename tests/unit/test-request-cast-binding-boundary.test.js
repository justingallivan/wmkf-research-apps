/**
 * @jest-environment node
 *
 * Boundary pin for the Factory-only production suggestion writer
 * (docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md,
 * Design B third bullet): cast-binding-runner.js binds a synthetic person
 * that the ordinary adapter refuses, so no ordinary module may import it.
 * Allowed importers: lib/services/test-requests/, the Factory CLI, and tests.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE = 'lib/services/test-requests/cast-binding-runner.js';
const ALLOWED = [/^lib\/services\/test-requests\//, /^scripts\/rehearse-test-request-sandbox\.mjs$/, /^tests\//];
const SOURCE = /\.(?:c|m)?[jt]sx?$/;
const REFERENCE = /cast-binding-runner(?:\.js)?['"`]/;

function trackedAndUntrackedSources() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter((file) => SOURCE.test(file) && !file.startsWith('node_modules/') && file !== MODULE);
}

describe('cast-binding-runner import boundary', () => {
  test('the module exists where the boundary expects it', () => {
    expect(fs.existsSync(path.join(ROOT, MODULE))).toBe(true);
  });

  test('only the Factory, its CLI and tests reference it', () => {
    const files = trackedAndUntrackedSources();
    expect(files.length).toBeGreaterThan(100);
    const importers = files.filter((file) => {
      const full = path.join(ROOT, file);
      return fs.existsSync(full) && REFERENCE.test(fs.readFileSync(full, 'utf8'));
    });
    const outside = importers.filter((file) => !ALLOWED.some((rule) => rule.test(file)));
    expect(outside).toEqual([]);
  });

  test('the reference pattern catches an import from an ordinary module', () => {
    expect(REFERENCE.test("import { runCastBinding } from '../test-requests/cast-binding-runner.js';")).toBe(true);
    expect(REFERENCE.test("const m = await import('../../lib/services/test-requests/cast-binding-runner')")).toBe(true);
  });
});
