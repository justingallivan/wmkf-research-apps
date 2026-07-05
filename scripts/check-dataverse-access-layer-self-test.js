#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-dataverse-access-layer.js.
 *
 * Builds isolated fixture trees under a temp dir and runs the census with
 * --root so real application files are not modified. Two fixture families:
 *
 * 1. Census-behavior fixtures (setupFixtures/runFixtureAssertions): the
 *    Stage-0 binding contract via --json/--report — direct calls, in-file
 *    constants, default dependency aliases, fallback aliases, aliased
 *    imports, changeset URL attribution, and permanent path exemptions.
 *
 * 2. Stage-8 law-mode fixtures (runLaw*Assertion): default-mode pass/fail
 *    behavior now that the allowlist file and count ratchet are gone —
 *    a clean non-entity-transport-only tree passes; an entity-attributed
 *    call, an unresolved alias, an unresolved changeset operation, and an
 *    unrecognized method name on a Dynamics alias each fail; exempt paths
 *    still pass regardless of what they call.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-dataverse-access-layer.js');
const tempRoot = path.join(repoRoot, '.dataverse_access_layer_selftest_tmp');

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

function expectGreen(label) {
  const run = runGate();
  expect(run.status === 0, `${label} should pass, exited ${run.status}\n${run.output}`);
  expect(run.output === '', `${label} should be silent, got:\n${run.output}`);
  console.log(`PASS ${label}`);
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

// --- Stage-8 law-mode fixtures ---------------------------------------------

function runLawCleanAssertion() {
  cleanup();

  write(tempRoot, 'lib/services/notification-service.js', `
    import { DynamicsService } from './dynamics-service.js';
    export async function notify(input) {
      return DynamicsService.createAndSendEmail(input);
    }
  `);

  write(tempRoot, 'pages/api/grant-reporting/extract.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await DynamicsService.logAiRun({ requestGuid: req.body.id, taskType: 'extract' });
      res.status(200).end();
    }
  `);

  write(tempRoot, 'pages/api/test-email.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await DynamicsService.createEmailActivity({ subject: 's', body: 'b' });
      res.status(200).end();
    }
  `);

  expectGreen('clean non-entity-transport-only tree');
}

function runLawEntityAttributedAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/direct.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      return DynamicsService.queryRecords('akoya_requests', { top: 1 });
    }
  `);

  expectRed('entity-attributed raw call fails', (output) => {
    expect(output.includes('LAW VIOLATION'), output);
    expect(output.includes('pages/api/direct.js'), output);
    expect(output.includes('DynamicsService.queryRecords | akoya_requests'), output);
  });
}

function runLawUnresolvedAliasAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/new-unresolved.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      return DynamicsService.getRecord(req.query.entity, req.query.id);
    }
  `);

  expectRed('unresolved-alias call fails', (output) => {
    expect(output.includes('LAW VIOLATION'), output);
    expect(output.includes('pages/api/new-unresolved.js'), output);
    expect(output.includes('DynamicsService.getRecord | unresolved'), output);
  });
}

function runLawChangesetUnresolvedAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/unresolved-changeset.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await DynamicsService.executeChangeset(buildOperations(req.body));
      res.status(200).end();
    }
  `);

  expectRed('changeset-unresolved call fails', (output) => {
    expect(output.includes('LAW VIOLATION'), output);
    expect(output.includes('pages/api/unresolved-changeset.js'), output);
    expect(output.includes('DynamicsService.executeChangeset | changeset-unresolved'), output);
  });
}

function runLawUnknownMethodAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/new-method.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await DynamicsService.bulkArchiveRecords('akoya_requests');
      res.status(200).end();
    }
  `);

  expectRed('unknown method name fails rather than passing as non-entity-transport', (output) => {
    expect(output.includes('LAW VIOLATION'), output);
    expect(output.includes('pages/api/new-method.js'), output);
    expect(output.includes('DynamicsService.bulkArchiveRecords | unknown-method:bulkArchiveRecords'), output);
  });
}

function runLawExemptPathAssertion() {
  cleanup();

  write(tempRoot, 'pages/dynamics-explorer.js', `
    import { DynamicsService } from '../lib/services/dynamics-service.js';
    export default function Explorer() {
      return DynamicsService.queryRecords('akoya_requests', {});
    }
  `);

  write(tempRoot, 'pages/api/dynamics-explorer/chat.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default async function handler() {
      return DynamicsService.queryRecords('should_not_count', {});
    }
  `);

  write(tempRoot, 'lib/dataverse/adapters/contact.js', `
    import { DynamicsService } from '../../services/dynamics-service.js';
    export async function getById(id) {
      return DynamicsService.getRecord('contacts', id);
    }
  `);

  expectGreen('exempt power-tool and DAL-internal paths still pass');
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
  if (!mode) {
    throw new Error(
      '--mode requires one of: all, fixtures, clean, entity, unresolved-alias, '
      + 'changeset-unresolved, unknown-method, exempt',
    );
  }
  return mode;
}

function runMode(mode) {
  if (mode === 'all') {
    runFixtureAssertions();
    runLawCleanAssertion();
    runLawEntityAttributedAssertion();
    runLawUnresolvedAliasAssertion();
    runLawChangesetUnresolvedAssertion();
    runLawUnknownMethodAssertion();
    runLawExemptPathAssertion();
    runLiveParseAssertion();
    return;
  }
  if (mode === 'fixtures') return runFixtureAssertions();
  if (mode === 'clean') return runLawCleanAssertion();
  if (mode === 'entity') return runLawEntityAttributedAssertion();
  if (mode === 'unresolved-alias') return runLawUnresolvedAliasAssertion();
  if (mode === 'changeset-unresolved') return runLawChangesetUnresolvedAssertion();
  if (mode === 'unknown-method') return runLawUnknownMethodAssertion();
  if (mode === 'exempt') return runLawExemptPathAssertion();
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
