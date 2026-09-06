#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-reviewer-engagement-boundary.js.
 *
 * Builds an isolated fixture tree under a temp dir (registerRepoFixture) and
 * runs the gate with --root so real application files are never touched.
 * RECORDED_IMPORTERS is a hardcoded map keyed by REAL repo-relative paths
 * (lib/services/review-manager/mark-received-no-file-service.js,
 * lib/services/review-upload.js), so fixture files that exercise the
 * recorded-importer exemption and its stale-entry detection are written at
 * those EXACT relative paths under the temp root.
 *
 * RED fixtures prove every binding form the Stage 7 build plan names:
 *   (a) named import of updateLifecycle from a lib/services/foo.js
 *   (b) namespace import + member call adapter.patchFields(...)
 *   (c) destructured require() of patchReviewReceipt
 *   (d) dynamic import() then member access (bulkUpdateByRequest)
 *   (e) ESM `export { updateLifecycle } from '<adapter>'` wrapper consumed
 *       by a named import in a service
 *   (f) CJS re-publish wrapper (`module.exports = { patchReviewReceipt }`)
 *       consumed by a destructured require() in a service
 *   (g) a file under shared/ and one under modules/ (proves those roots
 *       are scanned, not just lib/ and pages/)
 *   (h) STALE RECORDED ENTRY: a fixture tree where a real recorded path
 *       (lib/services/review-upload.js) exists but no longer imports the
 *       writer it is recorded for -- exercised in its own scenario so it
 *       does not mask the valid-recorded-importer green case
 *   (i) non-literal source hard-fail (a destructure of a generic writer name
 *       from a dynamic require path)
 *
 * GREEN fixtures: a lib/services/reviewer-engagement/x.js importer; the two
 * recorded receipt sinks (valid); a file namespace-importing the adapter but
 * calling only narrow ops (setRequestMetadata, claimThankYou,
 * deselectLegacyDeclinedSuggestion); a scripts/ file importing
 * updateLifecycle directly (out of scope -- scripts/ is not scanned); a
 * green-only tree exits 0.
 *
 * LAW MODE: the default run must exit non-zero naming every red binding (no
 * baseline, no ratchet -- zero un-exempted bindings and zero stale entries is
 * the only passing state).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-reviewer-engagement-boundary.js');
const tempRoot = path.join(repoRoot, '.reviewer_engagement_boundary_selftest_tmp');

const { cleanup } = registerRepoFixture('.reviewer_engagement_boundary_selftest_tmp');

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function runGate(args = []) {
  try {
    const output = execSync(`node ${JSON.stringify(gate)} --root ${JSON.stringify(tempRoot)} ${args.join(' ')}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (err) {
    return { status: err.status || 1, output: (err.stdout || '') + (err.stderr || '') };
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// Every fixture scenario needs the adapter itself + the two real recorded
// receipt-sink paths (valid, unless a scenario deliberately breaks one).
function writeAdapterAndRecordedSinks(includeValidRecordedSinks = true) {
  write(tempRoot, 'lib/dataverse/adapters/reviewer-suggestion.js', `
    export function updateLifecycle(id, updates, opts) { return { id, updates, opts }; }
    export function patchReviewReceipt(id, payload, opts) { return { id, payload, opts }; }
    export const patchFields = patchReviewReceipt;
    export function bulkUpdateByRequest(requestId, updates, opts) { return { requestId, updates, opts }; }
    export function setRequestMetadata(requestId, updates, opts) { return { requestId, updates, opts }; }
    export function claimThankYou(id, sentAt, opts) { return { id, sentAt, opts }; }
    export function deselectLegacyDeclinedSuggestion(id, opts) { return { id, opts }; }
    export function findById(id) { return { id }; }
  `);
  if (includeValidRecordedSinks) {
    write(tempRoot, 'lib/services/review-manager/mark-received-no-file-service.js', `
      import { patchReviewReceipt } from '../../dataverse/adapters/reviewer-suggestion.js';
      export async function markReceived(id) { return patchReviewReceipt(id, {}, {}); }
    `);
    write(tempRoot, 'lib/services/review-upload.js', `
      import { patchReviewReceipt } from '../dataverse/adapters/reviewer-suggestion.js';
      export async function upload(id) { return patchReviewReceipt(id, {}, {}); }
    `);
  }
}

const RED_ENTRIES = [
  { file: 'lib/services/foo.js', writer: 'updateLifecycle' },
  { file: 'lib/services/bar-namespace.js', writer: 'patchFields' },
  { file: 'lib/services/baz-require.js', writer: 'patchReviewReceipt' },
  { file: 'lib/services/qux-dynamic.js', writer: 'bulkUpdateByRequest' },
  // The wrapper files themselves bind the writer (via ESM re-export / CJS
  // re-publish) -- they are violations in their own right, not just their
  // consumers below.
  { file: 'lib/wrappers/esm-reexport-wrapper.js', writer: 'updateLifecycle' },
  { file: 'lib/services/red-esm-wrapper-consumer.js', writer: 'updateLifecycle' },
  { file: 'lib/wrappers/cjs-republish-wrapper.js', writer: 'patchReviewReceipt' },
  { file: 'lib/services/red-cjs-wrapper-consumer.js', writer: 'patchReviewReceipt' },
  { file: 'shared/components/red-shared.js', writer: 'updateLifecycle' },
  { file: 'modules/red-modules.js', writer: 'updateLifecycle' },
];

function setupDetectionFixtures() {
  cleanup();
  writeAdapterAndRecordedSinks(true);

  // GREEN: reviewer-engagement/ importer.
  write(tempRoot, 'lib/services/reviewer-engagement/close-review.js', `
    import { updateLifecycle } from '../../dataverse/adapters/reviewer-suggestion.js';
    export async function closeReview(id) { return updateLifecycle(id, {}, {}); }
  `);

  // GREEN: namespace import of the adapter, narrow ops only -- must NOT trip.
  write(tempRoot, 'lib/services/reviewer-finder/my-candidates-service.js', `
    import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion.js';
    export async function run(id) {
      await suggestionAdapter.setRequestMetadata(id, {}, {});
      await suggestionAdapter.claimThankYou(id, 'x', {});
      await suggestionAdapter.deselectLegacyDeclinedSuggestion(id, {});
      return suggestionAdapter.findById(id);
    }
  `);

  // (a) named import of updateLifecycle from a plain lib/services/ file.
  write(tempRoot, 'lib/services/foo.js', `
    import { updateLifecycle } from '../dataverse/adapters/reviewer-suggestion.js';
    export async function run(id) { return updateLifecycle(id, {}, {}); }
  `);

  // (b) namespace import + member call.
  write(tempRoot, 'lib/services/bar-namespace.js', `
    import * as adapter from '../dataverse/adapters/reviewer-suggestion.js';
    export async function run(id) { return adapter.patchFields(id, {}, {}); }
  `);

  // (c) destructured require().
  write(tempRoot, 'lib/services/baz-require.js', `
    const { patchReviewReceipt } = require('../dataverse/adapters/reviewer-suggestion.js');
    module.exports = { run: (id) => patchReviewReceipt(id, {}, {}) };
  `);

  // (d) dynamic import() then member access.
  write(tempRoot, 'lib/services/qux-dynamic.js', `
    export async function run(id) {
      const m = await import('../dataverse/adapters/reviewer-suggestion.js');
      return m.bulkUpdateByRequest(id, {}, {});
    }
  `);

  // (e) ESM named re-export wrapper, consumed by a named import.
  write(tempRoot, 'lib/wrappers/esm-reexport-wrapper.js', `
    export { updateLifecycle } from '../dataverse/adapters/reviewer-suggestion.js';
  `);
  write(tempRoot, 'lib/services/red-esm-wrapper-consumer.js', `
    import { updateLifecycle } from '../wrappers/esm-reexport-wrapper.js';
    export async function run(id) { return updateLifecycle(id, {}, {}); }
  `);

  // (f) CJS re-publish wrapper, consumed by a destructured require().
  write(tempRoot, 'lib/wrappers/cjs-republish-wrapper.js', `
    const { patchReviewReceipt } = require('../dataverse/adapters/reviewer-suggestion.js');
    module.exports = { patchReviewReceipt };
  `);
  write(tempRoot, 'lib/services/red-cjs-wrapper-consumer.js', `
    const { patchReviewReceipt } = require('../wrappers/cjs-republish-wrapper.js');
    module.exports = { run: (id) => patchReviewReceipt(id, {}, {}) };
  `);

  // (g) shared/ and modules/ roots.
  write(tempRoot, 'shared/components/red-shared.js', `
    import { updateLifecycle } from '../../dataverse/adapters/reviewer-suggestion.js';
    export async function run(id) { return updateLifecycle(id, {}, {}); }
  `);
  write(tempRoot, 'modules/red-modules.js', `
    import { updateLifecycle } from '../lib/dataverse/adapters/reviewer-suggestion.js';
    export async function run(id) { return updateLifecycle(id, {}, {}); }
  `);

  // GREEN: scripts/ is NOT scanned (D5) -- a direct writer import here must
  // never appear in the gate's output even though it plainly binds one.
  write(tempRoot, 'scripts/backfill-thing.js', `
    import { updateLifecycle } from '../lib/dataverse/adapters/reviewer-suggestion.js';
    updateLifecycle('x', {}, {});
  `);
}

function runDetectionAssertions() {
  setupDetectionFixtures();

  const run = runGate(['--json']);
  expect(run.status === 0, `--json exited ${run.status}\n${run.output}`);
  const entries = JSON.parse(run.output);
  const violations = entries.filter((e) => !e.exempt);
  const violationKeys = new Set(violations.map((v) => `${v.file}|${v.writer}`));

  for (const red of RED_ENTRIES) {
    expect(violationKeys.has(`${red.file}|${red.writer}`),
      `RED binding not flagged: ${red.file} (${red.writer})\nviolations: ${JSON.stringify(violations, null, 2)}`);
  }
  expect(violations.length === RED_ENTRIES.length,
    `expected exactly ${RED_ENTRIES.length} violations, got ${violations.length}: ${JSON.stringify(violations, null, 2)}`);

  // Every entry recorded against the two real receipt sinks and the
  // reviewer-engagement importer must be marked exempt, not violating.
  const exemptFiles = entries.filter((e) => e.exempt).map((e) => e.file);
  expect(exemptFiles.includes('lib/services/review-manager/mark-received-no-file-service.js'),
    'recorded receipt sink (mark-received-no-file-service.js) not marked exempt');
  expect(exemptFiles.includes('lib/services/review-upload.js'),
    'recorded receipt sink (review-upload.js) not marked exempt');
  expect(exemptFiles.includes('lib/services/reviewer-engagement/close-review.js'),
    'reviewer-engagement/ importer not marked exempt');

  // The narrow-ops namespace importer and the scripts/ file must not appear
  // at all (no entry, exempt or otherwise).
  const allFiles = new Set(entries.map((e) => e.file));
  expect(!allFiles.has('lib/services/reviewer-finder/my-candidates-service.js'),
    'narrow-ops namespace importer wrongly appeared in the census');
  expect(!allFiles.has('scripts/backfill-thing.js'),
    'scripts/ file wrongly appeared in the census (out of scope per D5)');

  // Wrapper attribution: (e)/(f) name the wrapper file.
  const esmViolation = violations.find((v) => v.file === 'lib/services/red-esm-wrapper-consumer.js');
  expect(esmViolation && esmViolation.wrapper === 'lib/wrappers/esm-reexport-wrapper.js',
    `ESM wrapper violation did not name the wrapper: ${JSON.stringify(esmViolation)}`);
  const cjsViolation = violations.find((v) => v.file === 'lib/services/red-cjs-wrapper-consumer.js');
  expect(cjsViolation && cjsViolation.wrapper === 'lib/wrappers/cjs-republish-wrapper.js',
    `CJS wrapper violation did not name the wrapper: ${JSON.stringify(cjsViolation)}`);

  console.log(`PASS detection assertions (${violations.length} violations, recorded/engagement/narrow-ops/scripts greens confirmed)`);
}

function runStaleRecordedImporterAssertions() {
  cleanup();
  writeAdapterAndRecordedSinks(false);
  // One recorded path is valid...
  write(tempRoot, 'lib/services/review-manager/mark-received-no-file-service.js', `
    import { patchReviewReceipt } from '../../dataverse/adapters/reviewer-suggestion.js';
    export async function markReceived(id) { return patchReviewReceipt(id, {}, {}); }
  `);
  // ...the other exists but no longer imports the writer it is recorded for.
  write(tempRoot, 'lib/services/review-upload.js', `
    export async function upload(id) { return { id }; }
  `);

  const run = runGate([]);
  expect(run.status !== 0, `stale recorded importer should fail the gate, exited 0:\n${run.output}`);
  expect(run.output.includes('stale recorded importer'),
    `expected a stale-recorded-importer failure, got:\n${run.output}`);
  expect(run.output.includes('lib/services/review-upload.js'),
    `stale-entry failure did not name review-upload.js:\n${run.output}`);
  expect(!run.output.includes('lib/services/review-manager/mark-received-no-file-service.js'),
    `valid recorded entry wrongly implicated in the stale failure:\n${run.output}`);
  console.log('PASS stale-recorded-importer assertions (file exists but no longer binds its recorded writer)');
}

function runMissingRecordedImporterFileAssertions() {
  cleanup();
  writeAdapterAndRecordedSinks(false);
  // Neither recorded file exists at all under this root.
  const run = runGate([]);
  expect(run.status !== 0, `missing recorded importer files should fail the gate, exited 0:\n${run.output}`);
  expect(run.output.includes('recorded importer file no longer exists'),
    `expected a missing-recorded-importer-file failure, got:\n${run.output}`);
  expect(run.output.includes('lib/services/review-manager/mark-received-no-file-service.js'),
    `missing-file failure did not name mark-received-no-file-service.js:\n${run.output}`);
  expect(run.output.includes('lib/services/review-upload.js'),
    `missing-file failure did not name review-upload.js:\n${run.output}`);
  console.log('PASS missing-recorded-importer-file assertions (recorded path absent entirely)');
}

// (i) Non-literal require()/import() sources must fail CLOSED only when they
// could plausibly be laundering a generic-writer binding -- a destructure
// whose external key names a writer directly. A plain lazy-backend shape
// (module-scope local from a non-literal path, own functions exported) must
// NOT trip this gate.
function runUnresolvedFailClosedAssertions() {
  cleanup();
  writeAdapterAndRecordedSinks(true);

  write(tempRoot, 'lib/services/red-unresolved-destructure.js', `
    export async function run(modPath) {
      const { updateLifecycle } = require(modPath);
      return updateLifecycle('x', {}, {});
    }
  `);

  // GREEN: lazy-backend shape -- non-literal require() held in a module-scope
  // local, only OWN functions exported. Must not trip fail-closed.
  write(tempRoot, 'lib/services/green-lazy-backend.js', `
    let _impl;
    function load(modPath) { _impl = require(modPath); }
    function getThing(id) { return _impl.getById(id); }
    module.exports = { load, getThing };
  `);

  const run = runGate([]);
  expect(run.status !== 0, `unresolved writer-destructure source should fail closed, exited 0:\n${run.output}`);
  expect(run.output.includes('unresolved-boundary-source'),
    `expected unresolved-boundary-source error, got:\n${run.output}`);
  expect(/red-unresolved-destructure\.js:\d+/.test(run.output),
    `expected file:line for the non-literal destructure, got:\n${run.output}`);
  expect(!run.output.includes('green-lazy-backend.js'),
    `lazy-backend GREEN fixture wrongly tripped fail-closed:\n${run.output}`);
  console.log('PASS non-literal source fails closed only for a writer-shaped destructure; lazy-backend green');
}

// LAW MODE: the default run fails closed on every red binding and every
// stale entry; a green-only tree exits 0.
function runLawModeAssertions() {
  setupDetectionFixtures();

  const red = runGate([]);
  expect(red.status !== 0, `law mode should fail with violations present, exited 0:\n${red.output}`);
  expect(red.output.includes('LAW VIOLATION'), `expected LAW VIOLATION message, got:\n${red.output}`);
  for (const entry of RED_ENTRIES) {
    expect(red.output.includes(entry.file), `law failure did not name ${entry.file}:\n${red.output}`);
  }
  expect(!red.output.includes('reviewer-engagement/close-review.js'),
    `law failure wrongly named the reviewer-engagement/ GREEN fixture:\n${red.output}`);
  expect(!red.output.includes('my-candidates-service.js'),
    `law failure wrongly named the narrow-ops GREEN fixture:\n${red.output}`);

  // Green-only tree: strip every red/wrapper file; remaining greens pass.
  for (const entry of RED_ENTRIES) {
    fs.rmSync(path.join(tempRoot, entry.file), { force: true });
  }
  fs.rmSync(path.join(tempRoot, 'lib/wrappers'), { recursive: true, force: true });
  fs.rmSync(path.join(tempRoot, 'scripts'), { recursive: true, force: true });
  const green = runGate([]);
  expect(green.status === 0, `law mode should pass on a green-only tree, got:\n${green.output}`);

  console.log(`PASS law-mode assertions (${RED_ENTRIES.length} reds named, greens clean, green-only tree exits 0)`);
}

function runReportAssertions() {
  setupDetectionFixtures();
  const run = runGate(['--report']);
  expect(run.status === 0, `--report exited ${run.status}\n${run.output}`);
  expect(run.output.includes('Reviewer-engagement boundary census'), 'report missing header');
  expect(run.output.includes('law mode since Stage 7'), 'report missing law-mode banner');
  expect(run.output.includes('VIOLATION'), 'report missing violation markers');
  expect(run.output.includes('EXEMPT'), 'report missing exempt markers');
  console.log('PASS report assertions');
}

function runLiveParseAssertion() {
  const output = execSync(`node ${JSON.stringify(gate)} --report`, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  expect(output.includes('Reviewer-engagement boundary census'), 'live --report did not print census header');
  const lawRun = (() => {
    try {
      execSync(`node ${JSON.stringify(gate)}`, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0 };
    } catch (err) {
      return { status: err.status || 1, output: (err.stdout || '') + (err.stderr || '') };
    }
  })();
  expect(lawRun.status === 0, `live repo should be law-clean after Stage 7, got:\n${lawRun.output || ''}`);
  console.log('PASS live repo census parses and is law-clean');
}

function parseMode(argv) {
  const modeIndex = argv.indexOf('--mode');
  if (modeIndex === -1) return 'all';
  const mode = argv[modeIndex + 1];
  if (!mode) throw new Error('--mode requires one of: all, detection, stale, missing, unresolved, law, report, live');
  return mode;
}

function runMode(mode) {
  if (mode === 'all') {
    runDetectionAssertions();
    runStaleRecordedImporterAssertions();
    runMissingRecordedImporterFileAssertions();
    runUnresolvedFailClosedAssertions();
    runLawModeAssertions();
    runReportAssertions();
    runLiveParseAssertion();
    return;
  }
  if (mode === 'detection') return runDetectionAssertions();
  if (mode === 'stale') return runStaleRecordedImporterAssertions();
  if (mode === 'missing') return runMissingRecordedImporterFileAssertions();
  if (mode === 'unresolved') return runUnresolvedFailClosedAssertions();
  if (mode === 'law') return runLawModeAssertions();
  if (mode === 'report') return runReportAssertions();
  if (mode === 'live') return runLiveParseAssertion();
  throw new Error(`unknown --mode ${mode}`);
}

try {
  runMode(parseMode(process.argv.slice(2)));
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
} finally {
  cleanup();
}
