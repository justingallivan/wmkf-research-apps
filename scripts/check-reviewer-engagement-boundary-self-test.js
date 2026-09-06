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
 * Stage 7 correction round (Codex round 1, HIGH 1) added a second scenario,
 * runAliasAndBarrelAssertions, proving the fixpoint resolves:
 *   (a) a two-hop same-file alias chain (`const a = adapter; const b = a;
 *       b.updateLifecycle(...)`)
 *   (a') an extracted method reference, itself then aliased (`const u =
 *       adapter.patchReviewReceipt; const v = u; v(...)`)
 *   (b) an ESM `export *` barrel consumed by a NAMED import, INCLUDING
 *       transitively through a second barrel that `export *`s from the first
 *       (not the adapter directly)
 *   (b') a CJS whole-namespace re-publish barrel (`module.exports =
 *       require('<adapter>')`) consumed by a destructured require()
 *   (c) a computed member access with a non-literal key on a namespace
 *       binding (`adapter[key]`) -- fails CLOSED as an unresolvable member
 *   green counterpart to (c): a computed access whose key IS a string
 *       literal resolving to a NON-writer name (`adapter['findById']`)
 *
 * GREEN fixtures: a lib/services/reviewer-engagement/x.js importer; the two
 * recorded receipt sinks (valid); a file namespace-importing the adapter but
 * calling only narrow ops (setRequestMetadata, claimThankYou,
 * deselectLegacyDeclinedSuggestion); a scripts/ file importing
 * updateLifecycle directly (out of scope -- scripts/ is not scanned); a
 * green-only tree exits 0; a computed access resolving to a non-writer name
 * (above); and, in runUnresolvedFailClosedAssertions, a lazy-backend module
 * whose non-literal require() result is never member-accessed or
 * re-published with a writer-shaped name -- the DOCUMENTED LIMIT of the
 * narrowed non-literal-source rule (see the gate script's module docblock).
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

// Stage 7 correction round (Codex round 1, HIGH 1): alias chains, extracted
// method references, whole-barrel wrappers (ESM `export *` and CJS
// `module.exports = require(...)`), transitivity through a wrapper-of-a-
// wrapper, and computed member access must all resolve through the same
// fixpoint the direct/named forms use -- exercised in their own scenario so
// they don't perturb the exact-count assertion in runDetectionAssertions.
function setupAliasAndBarrelFixtures() {
  cleanup();
  writeAdapterAndRecordedSinks(true);

  // (a) two-hop alias chain: import * as adapter -> const a = adapter ->
  // const b = a -> b.updateLifecycle(...). Namespace binding must propagate
  // across BOTH alias edges before the member access resolves.
  write(tempRoot, 'lib/services/red-alias-chain.js', `
    import * as adapter from '../dataverse/adapters/reviewer-suggestion.js';
    const a = adapter;
    const b = a;
    export async function run(id) { return b.updateLifecycle(id, {}, {}); }
  `);

  // (a') extracted method reference, then aliased: const u =
  // adapter.patchReviewReceipt -> const v = u -> v(...). The extraction
  // itself binds `u` to the writer; the alias edge must carry that writer
  // binding to `v`.
  write(tempRoot, 'lib/services/red-extracted-method-alias.js', `
    import * as adapter from '../dataverse/adapters/reviewer-suggestion.js';
    const u = adapter.patchReviewReceipt;
    const v = u;
    export async function run(id) { return v(id, {}, {}); }
  `);

  // (b) ESM \`export *\` barrel -- a NAMED import from it must be classified
  // exactly like a named import from the adapter, even though the barrel
  // itself never names the writer anywhere in its own source text.
  write(tempRoot, 'lib/wrappers/star-barrel.js', `
    export * from '../dataverse/adapters/reviewer-suggestion.js';
  `);
  write(tempRoot, 'lib/services/red-star-barrel-consumer.js', `
    import { updateLifecycle } from '../wrappers/star-barrel.js';
    export async function run(id) { return updateLifecycle(id, {}, {}); }
  `);
  // Transitivity: a SECOND barrel that \`export *\`s from the FIRST barrel
  // (not the adapter directly) must be recognized too.
  write(tempRoot, 'lib/wrappers/star-barrel-2.js', `
    export * from './star-barrel.js';
  `);
  write(tempRoot, 'lib/services/red-star-barrel-2-consumer.js', `
    import { bulkUpdateByRequest } from '../wrappers/star-barrel-2.js';
    export async function run(id) { return bulkUpdateByRequest(id, {}, {}); }
  `);

  // (b') CJS whole-namespace re-publish barrel (\`module.exports =
  // require('<adapter>')\`), consumed by a destructured require().
  write(tempRoot, 'lib/wrappers/cjs-whole-republish.js', `
    module.exports = require('../dataverse/adapters/reviewer-suggestion.js');
  `);
  write(tempRoot, 'lib/services/red-cjs-whole-consumer.js', `
    const { updateLifecycle } = require('../wrappers/cjs-whole-republish.js');
    module.exports = { run: (id) => updateLifecycle(id, {}, {}) };
  `);

  // (a1) destructuring a writer directly off an object identifier (NOT off
  // the require() call itself, which the main detection scenario's (c)
  // fixture already covers): `const a = require(adapter); const {
  // patchReviewReceipt } = a;` (Stage 7 correction round, Opus A1).
  write(tempRoot, 'lib/services/red-destructure-from-adapter-local.js', `
    const a = require('../dataverse/adapters/reviewer-suggestion.js');
    const { patchReviewReceipt } = a;
    module.exports = { run: (id) => patchReviewReceipt(id, {}, {}) };
  `);

  // (a2) CJS SPREAD re-publish barrel (\`module.exports = { ...adapter }\`) --
  // a shallow spread of the adapter's namespace is whole-namespace-equivalent
  // for detection purposes (Stage 7 correction round, Opus A2, third shape).
  write(tempRoot, 'lib/wrappers/spread-barrel.js', `
    const adapter = require('../dataverse/adapters/reviewer-suggestion.js');
    module.exports = { ...adapter };
  `);
  write(tempRoot, 'lib/services/red-spread-barrel-consumer.js', `
    const { updateLifecycle } = require('../wrappers/spread-barrel.js');
    module.exports = { run: (id) => updateLifecycle(id, {}, {}) };
  `);

  // (c) computed member access on a namespace binding with a NON-literal key
  // -- cannot be resolved statically, so it fails CLOSED as an unresolvable
  // member rather than silently passing.
  write(tempRoot, 'lib/services/red-computed-member.js', `
    import * as adapter from '../dataverse/adapters/reviewer-suggestion.js';
    const key = 'updateLifecycle';
    export async function run(id) { return adapter[key](id, {}, {}); }
  `);

  // GREEN counterpart to (c): a computed access whose key IS a string
  // literal, resolving to a name that is NOT one of the four writers --
  // simply not a writer binding at all, must not be flagged.
  write(tempRoot, 'lib/services/green-computed-non-writer.js', `
    import * as adapter from '../dataverse/adapters/reviewer-suggestion.js';
    export async function run(id) { return adapter['findById'](id); }
  `);
}

function runAliasAndBarrelAssertions() {
  setupAliasAndBarrelFixtures();

  const run = runGate(['--json']);
  expect(run.status === 0, `--json exited ${run.status}\n${run.output}`);
  const entries = JSON.parse(run.output);
  const violations = entries.filter((e) => !e.exempt);
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }

  // (a) alias chain: file named, writer resolved to updateLifecycle.
  expect(byFile.has('lib/services/red-alias-chain.js'),
    `(a) alias-chain file not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  expect(byFile.get('lib/services/red-alias-chain.js').some((v) => v.writer === 'updateLifecycle'),
    `(a) alias-chain violation did not resolve to updateLifecycle: ${JSON.stringify(byFile.get('lib/services/red-alias-chain.js'))}`);

  // (a') extracted method + alias: file named, writer resolved to patchReviewReceipt.
  expect(byFile.has('lib/services/red-extracted-method-alias.js'),
    `(a') extracted-method-alias file not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  expect(byFile.get('lib/services/red-extracted-method-alias.js').some((v) => v.writer === 'patchReviewReceipt'),
    `(a') extracted-method-alias violation did not resolve to patchReviewReceipt: ${JSON.stringify(byFile.get('lib/services/red-extracted-method-alias.js'))}`);

  // (b) export * barrel: it never names any writer in its OWN source (a
  // whole-namespace re-export has no per-name text to bind), so it is not
  // itself an entry -- what matters is that a NAMED import of a writer FROM
  // it is classified exactly like a named import from the adapter.
  expect(byFile.has('lib/services/red-star-barrel-consumer.js'),
    `(b) star-barrel consumer not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  const starConsumer = byFile.get('lib/services/red-star-barrel-consumer.js').find((v) => v.writer === 'updateLifecycle');
  expect(starConsumer && starConsumer.wrapper === 'lib/wrappers/star-barrel.js',
    `(b) star-barrel consumer violation did not name the wrapper: ${JSON.stringify(starConsumer)}`);

  // (b, transitive) barrel-of-barrel: the SECOND barrel's consumer is
  // flagged even though neither barrel imports the adapter directly and
  // neither barrel names any writer in its own source.
  expect(byFile.has('lib/services/red-star-barrel-2-consumer.js'),
    `(b transitive) second-barrel consumer not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  const starConsumer2 = byFile.get('lib/services/red-star-barrel-2-consumer.js').find((v) => v.writer === 'bulkUpdateByRequest');
  expect(starConsumer2 && starConsumer2.wrapper === 'lib/wrappers/star-barrel-2.js',
    `(b transitive) second-barrel consumer violation did not name the wrapper: ${JSON.stringify(starConsumer2)}`);

  // (b') CJS whole-namespace re-publish barrel: same reasoning -- the
  // barrel's own source names no writer; its consumer is flagged.
  expect(byFile.has('lib/services/red-cjs-whole-consumer.js'),
    `(b') CJS whole-republish consumer not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  const cjsWholeConsumer = byFile.get('lib/services/red-cjs-whole-consumer.js').find((v) => v.writer === 'updateLifecycle');
  expect(cjsWholeConsumer && cjsWholeConsumer.wrapper === 'lib/wrappers/cjs-whole-republish.js',
    `(b') CJS whole-republish consumer violation did not name the wrapper: ${JSON.stringify(cjsWholeConsumer)}`);

  // (a1) destructure off an object identifier bound (whole) to the adapter.
  expect(byFile.has('lib/services/red-destructure-from-adapter-local.js'),
    `(a1) destructure-from-adapter-local file not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  expect(byFile.get('lib/services/red-destructure-from-adapter-local.js').some((v) => v.writer === 'patchReviewReceipt'),
    `(a1) destructure-from-adapter-local violation did not resolve to patchReviewReceipt: ${JSON.stringify(byFile.get('lib/services/red-destructure-from-adapter-local.js'))}`);

  // (a2) CJS spread re-publish barrel: consumer flagged, wrapper-attributed.
  expect(byFile.has('lib/services/red-spread-barrel-consumer.js'),
    `(a2) spread-barrel consumer not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  const spreadConsumer = byFile.get('lib/services/red-spread-barrel-consumer.js').find((v) => v.writer === 'updateLifecycle');
  expect(spreadConsumer && spreadConsumer.wrapper === 'lib/wrappers/spread-barrel.js',
    `(a2) spread-barrel consumer violation did not name the wrapper: ${JSON.stringify(spreadConsumer)}`);

  // (c) computed member on a namespace binding: file named, reported as an
  // unresolvable member (writer null), not silently passed.
  expect(byFile.has('lib/services/red-computed-member.js'),
    `(c) computed-member file not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  expect(byFile.get('lib/services/red-computed-member.js').some((v) => v.form === 'namespace-computed-member-unresolvable' && v.writer === null),
    `(c) computed-member violation was not reported as unresolvable: ${JSON.stringify(byFile.get('lib/services/red-computed-member.js'))}`);

  // GREEN: computed access resolving (statically) to a non-writer name.
  const allFiles = new Set(entries.map((e) => e.file));
  expect(!allFiles.has('lib/services/green-computed-non-writer.js'),
    'computed access resolving to a non-writer name (findById) wrongly flagged');

  console.log('PASS alias-chain / extracted-method / export-* barrel (incl. transitive) / CJS whole-republish / computed-member assertions');
}

// Stage 7 SECOND correction round (Codex round 2): class-held adapters,
// renamed CJS/ESM member re-exports, direct dynamic-import member access,
// and the generic fail-closed catch-all for any other complex object shape.
function setupClassBarrelDynamicImportFixtures() {
  cleanup();
  writeAdapterAndRecordedSinks(true);

  // (1) Class instance field holding the adapter (ClassProperty initializer),
  // accessed via \`this.field.writer\`.
  write(tempRoot, 'lib/services/red-class-field-direct-require.js', `
    class Runner {
      adapter = require('../dataverse/adapters/reviewer-suggestion.js');
      run(id) { return this.adapter.updateLifecycle(id, {}, {}); }
    }
    module.exports = { Runner };
  `);
  // (1') The same field bound via a CONSTRUCTOR assignment instead of a
  // ClassProperty initializer -- \`this.adapter = require(...)\`.
  write(tempRoot, 'lib/services/red-class-field-constructor-assign.js', `
    class Runner {
      constructor() {
        this.adapter = require('../dataverse/adapters/reviewer-suggestion.js');
      }
      run(id) { return this.adapter.patchReviewReceipt(id, {}, {}); }
    }
    module.exports = { Runner };
  `);

  // (2) Renamed CJS object-literal member re-export.
  write(tempRoot, 'lib/wrappers/cjs-renamed-object-wrapper.js', `
    const adapter = require('../dataverse/adapters/reviewer-suggestion.js');
    module.exports = { mutate: adapter.updateLifecycle };
  `);
  write(tempRoot, 'lib/services/red-cjs-renamed-object-consumer.js', `
    const { mutate } = require('../wrappers/cjs-renamed-object-wrapper.js');
    module.exports = { run: (id) => mutate(id, {}, {}) };
  `);

  // (2') Renamed CJS \`exports.name = \` member re-export.
  write(tempRoot, 'lib/wrappers/cjs-renamed-exports-wrapper.js', `
    const adapter = require('../dataverse/adapters/reviewer-suggestion.js');
    exports.mutate = adapter.patchReviewReceipt;
  `);
  write(tempRoot, 'lib/services/red-cjs-renamed-exports-consumer.js', `
    const { mutate } = require('../wrappers/cjs-renamed-exports-wrapper.js');
    module.exports = { run: (id) => mutate(id, {}, {}) };
  `);

  // (2'') ESM renamed member re-export: \`export const mutate = adapter.updateLifecycle;\`
  write(tempRoot, 'lib/wrappers/esm-renamed-const-wrapper.js', `
    import * as adapter from '../dataverse/adapters/reviewer-suggestion.js';
    export const mutate = adapter.bulkUpdateByRequest;
  `);
  write(tempRoot, 'lib/services/red-esm-renamed-const-consumer.js', `
    import { mutate } from '../wrappers/esm-renamed-const-wrapper.js';
    export async function run(id) { return mutate(id, {}, {}); }
  `);

  // (3) Direct dynamic-import member access, no intermediate variable.
  write(tempRoot, 'lib/services/red-direct-dynamic-import-member.js', `
    export async function run(id) {
      return (await import('../dataverse/adapters/reviewer-suggestion.js')).updateLifecycle(id, {}, {});
    }
  `);

  // GREEN: the exact real-repo false-positive class this round's narrowing
  // fixes -- a dynamic-keyed lookup into a STATICALLY NAMED, non-writer
  // sub-export of the adapter (must NOT be flagged), and a chained method
  // call off the adapter whose outer property is not a writer (also green).
  write(tempRoot, 'lib/services/green-adapter-constant-lookup.js', `
    import * as adapter from '../dataverse/adapters/reviewer-suggestion.js';
    export function label(row) {
      return adapter.RESPONSE_TYPE_BY_VALUE[row.wmkf_responsetype] ?? null;
    }
    export async function lookup(id) {
      return adapter.findById(id).catch(() => null);
    }
  `);
}

function runClassBarrelDynamicImportAssertions() {
  setupClassBarrelDynamicImportFixtures();

  const run = runGate(['--json']);
  expect(run.status === 0, `--json exited ${run.status}\n${run.output}`);
  const entries = JSON.parse(run.output);
  const violations = entries.filter((e) => !e.exempt);
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }

  // (1) class field access via this.field (ClassProperty initializer and,
  // separately, a constructor assignment).
  expect(byFile.has('lib/services/red-class-field-direct-require.js'),
    `(1) class-field file not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  expect(byFile.get('lib/services/red-class-field-direct-require.js').some((v) => v.writer === 'updateLifecycle'),
    `(1) class-field violation did not resolve to updateLifecycle: ${JSON.stringify(byFile.get('lib/services/red-class-field-direct-require.js'))}`);
  expect(byFile.has('lib/services/red-class-field-constructor-assign.js'),
    `(1') constructor-assigned class-field file not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  expect(byFile.get('lib/services/red-class-field-constructor-assign.js').some((v) => v.writer === 'patchReviewReceipt'),
    `(1') constructor-assigned class-field violation did not resolve to patchReviewReceipt: ${JSON.stringify(byFile.get('lib/services/red-class-field-constructor-assign.js'))}`);

  // (2) renamed CJS object-literal member re-export.
  expect(byFile.has('lib/services/red-cjs-renamed-object-consumer.js'),
    `(2) renamed-object consumer not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  const renamedObjectConsumer = byFile.get('lib/services/red-cjs-renamed-object-consumer.js').find((v) => v.writer === 'updateLifecycle');
  expect(renamedObjectConsumer && renamedObjectConsumer.wrapper === 'lib/wrappers/cjs-renamed-object-wrapper.js',
    `(2) renamed-object consumer violation did not name the wrapper: ${JSON.stringify(renamedObjectConsumer)}`);

  // (2') renamed CJS exports.name member re-export.
  expect(byFile.has('lib/services/red-cjs-renamed-exports-consumer.js'),
    `(2') renamed-exports consumer not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  const renamedExportsConsumer = byFile.get('lib/services/red-cjs-renamed-exports-consumer.js').find((v) => v.writer === 'patchReviewReceipt');
  expect(renamedExportsConsumer && renamedExportsConsumer.wrapper === 'lib/wrappers/cjs-renamed-exports-wrapper.js',
    `(2') renamed-exports consumer violation did not name the wrapper: ${JSON.stringify(renamedExportsConsumer)}`);

  // (2'') ESM renamed member re-export.
  expect(byFile.has('lib/services/red-esm-renamed-const-consumer.js'),
    `(2'') ESM renamed-const consumer not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  const renamedConstConsumer = byFile.get('lib/services/red-esm-renamed-const-consumer.js').find((v) => v.writer === 'bulkUpdateByRequest');
  expect(renamedConstConsumer && renamedConstConsumer.wrapper === 'lib/wrappers/esm-renamed-const-wrapper.js',
    `(2'') ESM renamed-const consumer violation did not name the wrapper: ${JSON.stringify(renamedConstConsumer)}`);

  // (3) direct dynamic-import member access.
  expect(byFile.has('lib/services/red-direct-dynamic-import-member.js'),
    `(3) direct dynamic-import member file not flagged\nviolations: ${JSON.stringify(violations, null, 2)}`);
  expect(byFile.get('lib/services/red-direct-dynamic-import-member.js').some((v) => v.writer === 'updateLifecycle' && v.form === 'dynamic-import-member'),
    `(3) direct dynamic-import member violation did not resolve to updateLifecycle: ${JSON.stringify(byFile.get('lib/services/red-direct-dynamic-import-member.js'))}`);

  // GREEN: the narrowed false-positive class (constant lookup + chained call).
  const allFiles = new Set(entries.map((e) => e.file));
  expect(!allFiles.has('lib/services/green-adapter-constant-lookup.js'),
    'dynamic-keyed constant lookup / chained non-writer call off the adapter wrongly flagged');

  console.log('PASS class-held adapter / renamed CJS+ESM member re-export / direct dynamic-import member assertions (with the narrowed-catch-all green)');
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

  // Stage 7 correction round (Opus A4): the OTHER two documented fail-closed
  // shapes, each in their own file so the failure message can be checked
  // per-file.
  //   - member access on an unresolved-bound local (no alias -- the direct
  //     shape the docblock names).
  write(tempRoot, 'lib/services/red-unresolved-member-access.js', `
    export async function run(modPath) {
      const a = require(modPath);
      return a.updateLifecycle('x', {}, {});
    }
  `);
  //   - identity re-export of an unresolved-bound local (its published
  //     identity could be an unknowable generic-writer source).
  write(tempRoot, 'lib/services/red-unresolved-identity-reexport.js', `
    export async function run(modPath) {
      const a = require(modPath);
      module.exports = a;
    }
  `);

  // Stage 7 correction round (Opus R1): the SAME two shapes, but reached
  // through a same-file ALIAS EDGE -- proves unresolvedBindings survives the
  // alias-closure fixpoint in collectFileInfo, not just the direct local.
  write(tempRoot, 'lib/services/red-unresolved-alias-member-access.js', `
    export async function run(modPath) {
      const a = require(modPath);
      const b = a;
      return b.updateLifecycle('x', {}, {});
    }
  `);
  write(tempRoot, 'lib/services/red-unresolved-alias-identity-reexport.js', `
    export async function run(modPath) {
      const a = require(modPath);
      const b = a;
      module.exports = b;
    }
  `);

  // Stage 7 correction round (Opus A1): destructuring a writer directly off
  // an UNRESOLVED-BOUND identifier (as opposed to destructuring straight off
  // the require() call, which red-unresolved-destructure.js already covers).
  write(tempRoot, 'lib/services/red-unresolved-destructure-from-identifier.js', `
    export async function run(modPath) {
      const a = require(modPath);
      const { updateLifecycle } = a;
      return updateLifecycle('x', {}, {});
    }
  `);

  // Stage 7 SECOND correction round (Codex round 2, item 3): a direct dynamic
  // import member access whose SOURCE is non-literal cannot be ruled out as
  // the adapter, so it fails closed regardless of the property name.
  write(tempRoot, 'lib/services/red-unresolved-dynamic-import-member.js', `
    export async function run(modPath, id) {
      return (await import(modPath)).updateLifecycle(id, {}, {});
    }
  `);
  // ...and the same for a non-literal (dynamic) PROPERTY on an otherwise
  // literal, adapter-matching dynamic import.
  write(tempRoot, 'lib/services/red-unresolved-dynamic-import-computed-property.js', `
    export async function run(key, id) {
      return (await import('../dataverse/adapters/reviewer-suggestion.js'))[key](id, {}, {});
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
  expect(/red-unresolved-member-access\.js:\d+/.test(run.output),
    `expected file:line for the unresolved member access, got:\n${run.output}`);
  expect(/red-unresolved-identity-reexport\.js:\d+/.test(run.output),
    `expected file:line for the unresolved identity re-export, got:\n${run.output}`);
  expect(/red-unresolved-alias-member-access\.js:\d+/.test(run.output),
    `expected file:line for the ALIASED unresolved member access, got:\n${run.output}`);
  expect(/red-unresolved-alias-identity-reexport\.js:\d+/.test(run.output),
    `expected file:line for the ALIASED unresolved identity re-export, got:\n${run.output}`);
  expect(/red-unresolved-destructure-from-identifier\.js:\d+/.test(run.output),
    `expected file:line for the destructure-from-identifier unresolved case, got:\n${run.output}`);
  expect(/red-unresolved-dynamic-import-member\.js:\d+/.test(run.output),
    `expected file:line for the non-literal dynamic-import member access, got:\n${run.output}`);
  expect(/red-unresolved-dynamic-import-computed-property\.js:\d+/.test(run.output),
    `expected file:line for the dynamic-import computed-property access, got:\n${run.output}`);
  expect(!run.output.includes('green-lazy-backend.js'),
    `lazy-backend GREEN fixture wrongly tripped fail-closed:\n${run.output}`);
  console.log('PASS non-literal source fails closed for every documented writer-shaped use (destructure, member access, identity re-export, each direct and aliased, plus dynamic-import member/computed-property); lazy-backend green');
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
  if (!mode) throw new Error('--mode requires one of: all, detection, alias-barrel, class-barrel-dynamic-import, stale, missing, unresolved, law, report, live');
  return mode;
}

function runMode(mode) {
  if (mode === 'all') {
    runDetectionAssertions();
    runAliasAndBarrelAssertions();
    runClassBarrelDynamicImportAssertions();
    runStaleRecordedImporterAssertions();
    runMissingRecordedImporterFileAssertions();
    runUnresolvedFailClosedAssertions();
    runLawModeAssertions();
    runReportAssertions();
    runLiveParseAssertion();
    return;
  }
  if (mode === 'detection') return runDetectionAssertions();
  if (mode === 'alias-barrel') return runAliasAndBarrelAssertions();
  if (mode === 'class-barrel-dynamic-import') return runClassBarrelDynamicImportAssertions();
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
