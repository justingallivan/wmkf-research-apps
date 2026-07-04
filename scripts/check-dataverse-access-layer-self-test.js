#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-dataverse-access-layer.js.
 *
 * Builds an isolated fixture tree under a temp dir and runs the census with
 * --root so real application files are not modified. The fixtures cover the
 * Stage-0 binding contract: direct calls, in-file constants, default dependency
 * aliases, fallback aliases, aliased imports, changeset URL attribution, and
 * permanent path exemptions. They also cover the Stage-1 line-tolerant
 * allowlist ratchet: green baseline, count exceeds, stale allowlist entry, and
 * new unresolved raw access.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-dataverse-access-layer.js');
const tempRoot = path.join(repoRoot, '.dataverse_access_layer_selftest_tmp');
const { buildAllowlist } = require('./check-dataverse-access-layer.js');

function cleanup() {
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
}

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

function parseJsonOutput(output) {
  try {
    return JSON.parse(output);
  } catch (err) {
    throw new Error(`expected JSON output, got:\n${output}`);
  }
}

function hasEntry(entries, partial) {
  return entries.some((entry) => (
    Object.entries(partial).every(([key, value]) => entry[key] === value)
  ));
}

function collectFixtureEntries() {
  const jsonRun = runGate(['--json']);
  expect(jsonRun.status === 0, `--json exited ${jsonRun.status}\n${jsonRun.output}`);
  return parseJsonOutput(jsonRun.output);
}

function writeAllowlist(entries) {
  write(tempRoot, 'scripts/dataverse-access-allowlist.json', `${JSON.stringify({
    description: 'Self-test fixture allowlist; generated from temp-root census.',
    entries: buildAllowlist(entries),
  }, null, 2)}\n`);
}

function setupAllowlistedBaseline() {
  setupFixtures();
  const entries = collectFixtureEntries();
  writeAllowlist(entries);
  return entries;
}

function expectGreen(label) {
  const run = runGate();
  expect(run.status === 0, `${label} should pass, exited ${run.status}\n${run.output}`);
  expect(run.output === '', `${label} should be silent, got:\n${run.output}`);
}

function expectRed(label, assertions) {
  const run = runGate();
  expect(run.status !== 0, `${label} should fail but exited 0`);
  assertions(run.output);
  console.log(`PASS ${label}`);
}

function setupFixtures() {
  cleanup();

  write(tempRoot, 'pages/api/direct.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      return DynamicsService.queryRecords('akoya_requests', { top: 1 });
    }
  `);

  write(tempRoot, 'lib/services/constant-resolved.js', `
    import { DynamicsService } from './dynamics-service.js';
    const SUGGESTION_SET = 'wmkf_appreviewersuggestions';
    export async function load(id) {
      return DynamicsService.getRecord(SUGGESTION_SET, id);
    }
  `);

  write(tempRoot, 'lib/bill/default-dependency.js', `
    import { DynamicsService as DV } from '../services/dynamics-service.js';
    export async function save(input, deps = {}) {
      const { dynamics = DV } = deps;
      return dynamics.updateRecord('contacts', input.id, {});
    }
  `);

  write(tempRoot, 'lib/services/fallback-alias.js', `
    import { DynamicsService } from './dynamics-service.js';
    const ENTITY = 'wmkf_appreviewersuggestions';
    export async function unlink(deps, id) {
      const dyn = deps.dynamics || DynamicsService;
      return dyn.disassociate(ENTITY, id, 'wmkf_contact');
    }
  `);

  write(tempRoot, 'shared/utils/aliased-method.js', `
    import { DynamicsService as Dataverse } from '../../lib/services/dynamics-service.js';
    const REQUEST_SET = 'akoya_requests';
    export async function create(payload) {
      return Dataverse.createRecord(REQUEST_SET, payload);
    }
  `);

  write(tempRoot, 'pages/api/changeset.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    const ANSWERS = 'wmkf_appreviewanswers';
    export default async function handler(req, res) {
      const requestSet = 'akoya_requests';
      const operations = [
        { method: 'PATCH', url: answerUrl(ANSWERS, req.query.id), body: {} },
      ];
      operations.push({ method: 'PATCH', url: \`\${requestSet}(\${req.query.id})\`, body: {} });
      await DynamicsService.executeChangeset(operations);
      res.status(200).end();
    }
    function answerUrl(entitySet, id) {
      return \`\${entitySet}(\${id})\`;
    }
  `);

  write(tempRoot, 'pages/api/unresolved-changeset.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await DynamicsService.executeChangeset(buildOperations(req.body));
      res.status(200).end();
    }
  `);

  write(tempRoot, 'pages/api/dynamics-explorer/chat.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default async function handler() {
      return DynamicsService.queryRecords('should_not_count', {});
    }
  `);
}

function runFixtureAssertions() {
  setupFixtures();

  const defaultRun = runGate();
  expect(defaultRun.status === 0, `default mode should pass without an allowlist\n${defaultRun.output}`);
  expect(defaultRun.output === '', `default mode without an allowlist should be silent, got:\n${defaultRun.output}`);

  const jsonRun = runGate(['--json']);
  expect(jsonRun.status === 0, `--json exited ${jsonRun.status}\n${jsonRun.output}`);
  const entries = parseJsonOutput(jsonRun.output);

  expect(hasEntry(entries, {
    file: 'pages/api/direct.js',
    entity: 'akoya_requests',
    method: 'queryRecords',
  }), 'direct DynamicsService call was not attributed');

  expect(hasEntry(entries, {
    file: 'lib/services/constant-resolved.js',
    entity: 'wmkf_appreviewersuggestions',
    method: 'getRecord',
  }), 'constant entity argument was not resolved');

  expect(hasEntry(entries, {
    file: 'lib/bill/default-dependency.js',
    entity: 'contacts',
    method: 'updateRecord',
  }), 'defaulted dependency alias was not detected');

  expect(hasEntry(entries, {
    file: 'lib/services/fallback-alias.js',
    entity: 'wmkf_appreviewersuggestions',
    method: 'disassociate',
  }), 'fallback alias was not detected');

  expect(hasEntry(entries, {
    file: 'shared/utils/aliased-method.js',
    entity: 'akoya_requests',
    method: 'createRecord',
  }), 'import alias method call was not detected');

  expect(hasEntry(entries, {
    file: 'pages/api/changeset.js',
    entity: 'wmkf_appreviewanswers',
    method: 'executeChangeset',
  }), 'changeset helper URL entity was not attributed');

  expect(hasEntry(entries, {
    file: 'pages/api/changeset.js',
    entity: 'akoya_requests',
    method: 'executeChangeset',
  }), 'changeset template URL entity was not attributed');

  expect(hasEntry(entries, {
    file: 'pages/api/unresolved-changeset.js',
    entity: 'changeset-unresolved',
    method: 'executeChangeset',
  }), 'unparseable changeset operations were not marked unresolved');

  expect(!entries.some((entry) => entry.entity === 'should_not_count'), 'permanent exempt file was scanned');

  const reportRun = runGate(['--report']);
  expect(reportRun.status === 0, `--report exited ${reportRun.status}\n${reportRun.output}`);
  expect(reportRun.output.includes('| akoya_requests |'), 'report did not include per-entity rollup');

  console.log(`PASS fixture census assertions (${entries.length} entries)`);
}

function runAllowlistBaselineAssertion() {
  const entries = setupAllowlistedBaseline();
  expectGreen('allowlisted baseline');
  console.log(`PASS allowlisted baseline (${buildAllowlist(entries).length} allowlist entries)`);
}

function runCountExceedsAssertion() {
  setupAllowlistedBaseline();
  write(tempRoot, 'pages/api/direct.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await DynamicsService.queryRecords('akoya_requests', { top: 1 });
      return DynamicsService.queryRecords('akoya_requests', { top: 1 });
    }
  `);

  expectRed('count-exceeds drift assertion', (output) => {
    expect(output.includes('raw access keys not in allowlist or above allowed count'), output);
    expect(output.includes('pages/api/direct.js | import | DynamicsService.queryRecords | akoya_requests'), output);
    expect(output.includes('current 2, allowlist 1'), output);
  });
}

function runStaleEntryAssertion() {
  setupAllowlistedBaseline();
  write(tempRoot, 'pages/api/direct.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      res.status(200).json({ ok: true });
    }
  `);

  expectRed('stale-entry drift assertion', (output) => {
    expect(output.includes('allowlist entries above current census; shrink required'), output);
    expect(output.includes('pages/api/direct.js | import | DynamicsService.queryRecords | akoya_requests'), output);
    expect(output.includes('current 0, allowlist 1'), output);
  });
}

function runNewUnresolvedAssertion() {
  setupAllowlistedBaseline();
  write(tempRoot, 'pages/api/new-unresolved.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      return DynamicsService.getRecord(req.query.entity, req.query.id);
    }
  `);

  expectRed('new-unresolved drift assertion', (output) => {
    expect(output.includes('new unresolved raw access keys not in Stage-0 allowlist'), output);
    expect(output.includes('pages/api/new-unresolved.js | import | DynamicsService.getRecord | unresolved'), output);
  });
}

function runLiveParseAssertion() {
  const output = execSync(`node ${JSON.stringify(gate)} --report`, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  expect(output.includes('Dataverse access census'), 'live --report did not print census header');
  console.log('PASS live repo census parses');
}

function parseMode(argv) {
  const modeIndex = argv.indexOf('--mode');
  if (modeIndex === -1) return 'all';
  const mode = argv[modeIndex + 1];
  if (!mode) throw new Error('--mode requires one of: all, green, count-exceeds, stale-entry, new-unresolved');
  return mode;
}

function runMode(mode) {
  if (mode === 'all') {
    runFixtureAssertions();
    runAllowlistBaselineAssertion();
    runCountExceedsAssertion();
    runStaleEntryAssertion();
    runNewUnresolvedAssertion();
    runLiveParseAssertion();
    return;
  }
  if (mode === 'green') return runAllowlistBaselineAssertion();
  if (mode === 'count-exceeds') return runCountExceedsAssertion();
  if (mode === 'stale-entry') return runStaleEntryAssertion();
  if (mode === 'new-unresolved') return runNewUnresolvedAssertion();
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
