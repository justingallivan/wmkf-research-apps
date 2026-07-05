#!/usr/bin/env node
/**
 * Fixture-based self-test for scripts/check-odata-escape.js
 * (docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md, Stage 3).
 *
 * Builds an isolated fake-root fixture tree (containing its own lib/, pages/
 * subdirs, exactly the shape the gate's SCAN_DIRS expects) via
 * scripts/lib/selftest-fixture.js's registerRepoFixture -- the canonical
 * scaffold/disposer helper -- nested under lib/ (one of the gate's own
 * scanned roots, per this build's brief) as
 * lib/.odata_escape_selftest_tmp/. The gate is invoked with
 * --root <fixture-dir> (mirroring check-route-service-boundary-self-test.js's
 * --root mechanic) so it scans ONLY the fixture tree, never the real repo,
 * and the fixture's hand-rolled-escape content can never trip the live gate
 * on itself. registerRepoFixture's entry-cleanup + crash/exit hooks bound the
 * brief window where the fixture directory exists inside lib/.
 *
 * Proves:
 *   (a) RED  -- a hand-rolled `.replace(/'/g, "''")` escape in a fixture file
 *       turns the gate red, naming file:line.
 *   (a2) RED -- the single-quoted-replacement variant `.replace(/'/g,'\'\'')`
 *       on a `String(x)` receiver is ALSO caught (the exact variants
 *       Stages 0-2 removed).
 *   (b) GREEN -- removing the hand-rolled escapes turns the gate green again.
 *   (c) DECOYS NOT FLAGGED -- an HTML entity escape (`&#39;`), an XML entity
 *       escape (`&apos;`), a doc-comment mention of the pattern, the
 *       canonical odata.js file, and the dynamics-explorer exempt dir are all
 *       present in the fixture tree and NONE of them trip the gate.
 *   (d) cleanup per the registerRepoFixture contract (cleans on entry, best-
 *       effort crash/exit insurance, explicit disposal in `finally`).
 *
 * Gate and self-test never run in parallel with each other (this script
 * shells out to the gate synchronously, one invocation at a time).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-odata-escape.js');
const FIXTURE_REL = 'lib/.odata_escape_selftest_tmp';
const tempRoot = path.join(repoRoot, FIXTURE_REL);

const { cleanup } = registerRepoFixture(FIXTURE_REL);

function write(rel, body) {
  const full = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function runGate() {
  try {
    const output = execFileSync('node', [gate, '--root', tempRoot], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (err) {
    return { status: err.status ?? 1, output: (err.stdout || '') + (err.stderr || '') };
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function setupBaseFixtures() {
  cleanup();

  // Decoys that must NEVER be flagged.
  write('lib/services/html-escape-decoy.js', `
    function escapeHtml(s) {
      return String(s).replace(/'/g, '&#39;');
    }
    module.exports = { escapeHtml };
  `);
  write('lib/services/xml-escape-decoy.js', `
    function xmlEscape(s) {
      return String(s).replace(/'/g, '&apos;');
    }
    module.exports = { xmlEscape };
  `);
  write('lib/dataverse/adapters/comment-only-decoy.js', `
    /**
     * The number is escaped for the OData string literal exactly as the raw
     * callers do (\`String(x).replace(/'/g, "''")\`), never GUID-treated.
     */
    function lookup(x) { return x; }
    module.exports = { lookup };
  `);

  // The canonical primitive itself -- necessarily contains the pattern this
  // law forbids everywhere else; must never be flagged.
  write('lib/dataverse/core/odata.js', `
    function escape(value) {
      return String(value).replace(/'/g, "''");
    }
    module.exports = { escape };
  `);

  // Exempt dynamics-explorer dir -- a direct hand-rolled escape here must
  // still not be flagged.
  write('pages/api/dynamics-explorer/chat.js', `
    const escaped = identifier.replace(/'/g, "''");
    module.exports = { escaped };
  `);
}

function writeRedFixtures() {
  write('lib/services/hand-rolled-escape.js', `
    function findRow(key) {
      const filter = \`wmkf_settingkey eq '\${key.replace(/'/g, "''")}'\`;
      return filter;
    }
    module.exports = { findRow };
  `);
  // (a2) single-quoted-replacement variant + String(x) wrapper receiver.
  write('lib/services/hand-rolled-escape-variant.js', `
    function findRow(key) {
      const filter = \`wmkf_settingkey eq '\${String(key).replace(/'/g,'\\'\\'')}'\`;
      return filter;
    }
    module.exports = { findRow };
  `);
}

function removeRedFixtures() {
  fs.rmSync(path.join(tempRoot, 'lib/services/hand-rolled-escape.js'), { force: true });
  fs.rmSync(path.join(tempRoot, 'lib/services/hand-rolled-escape-variant.js'), { force: true });
}

function runRedAssertion() {
  setupBaseFixtures();
  writeRedFixtures();

  const run = runGate();
  expect(run.status !== 0, `expected RED (non-zero exit) with hand-rolled escapes present, got 0:\n${run.output}`);
  expect(run.output.includes('lib/services/hand-rolled-escape.js'),
    `expected the mechanical .replace(/'/g, "''") fixture to be named:\n${run.output}`);
  expect(run.output.includes('lib/services/hand-rolled-escape-variant.js'),
    `expected the single-quoted-replacement / String(x) variant fixture to be named:\n${run.output}`);
  expect(!run.output.includes('html-escape-decoy.js'), `HTML decoy wrongly flagged:\n${run.output}`);
  expect(!run.output.includes('xml-escape-decoy.js'), `XML decoy wrongly flagged:\n${run.output}`);
  expect(!run.output.includes('comment-only-decoy.js'), `comment-only decoy wrongly flagged:\n${run.output}`);
  expect(!run.output.includes('+ lib/dataverse/core/odata.js'), `canonical odata.js wrongly flagged:\n${run.output}`);
  expect(!run.output.includes('dynamics-explorer'), `dynamics-explorer exempt dir wrongly flagged:\n${run.output}`);

  console.log('PASS red assertion (mechanical + variant hand-rolled escapes flagged; decoys, canonical file, and exempt dir clean)');
}

function runGreenAssertion() {
  setupBaseFixtures();
  writeRedFixtures();
  removeRedFixtures();

  const run = runGate();
  expect(run.status === 0, `expected GREEN (exit 0) after removing hand-rolled escapes, got ${run.status}:\n${run.output}`);
  expect(/OK — \d+ file\(s\) scanned/.test(run.output), `expected the one-line OK summary, got:\n${run.output}`);
  console.log('PASS green assertion (gate clears once hand-rolled escapes are removed)');
}

try {
  runRedAssertion();
  runGreenAssertion();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
} finally {
  cleanup();
}
