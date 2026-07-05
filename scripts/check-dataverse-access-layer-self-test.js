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
 *    clean non-entity-transport-only direct/alias/dynamic-import calls pass;
 *    entity-attributed calls, unresolved aliases, unresolved changesets,
 *    unknown methods, exported/re-exported aliases, method extraction/binding,
 *    client/namespace pass-through, computed method strings, inline source
 *    misuse, and unresolved dynamic imports fail; exempt paths still pass
 *    regardless of what they call.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-dataverse-access-layer.js');
const tempRoot = path.join(repoRoot, '.dataverse_access_layer_selftest_tmp');

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('.dataverse_access_layer_selftest_tmp');

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

function runLawCrossModuleReexportAssertion() {
  cleanup();

  write(tempRoot, 'lib/services/exported-dynamics-alias.js', `
    import { DynamicsService } from './dynamics-service.js';
    export const D = DynamicsService;
  `);

  write(tempRoot, 'pages/api/use-exported-alias.js', `
    import { D } from '../../lib/services/exported-dynamics-alias.js';
    export default async function handler(req, res) {
      await D.createAndSendEmail({ subject: 's' });
      res.status(200).end();
    }
  `);

  expectRed('cross-module re-exported alias fails at exporting file', (output) => {
    expect(output.includes('LAW VIOLATION'), output);
    expect(output.includes('lib/services/exported-dynamics-alias.js'), output);
    expect(output.includes('export.export | unattributable-use:export'), output);
  });
}

function runLawExportAliasAssertion() {
  cleanup();

  write(tempRoot, 'shared/export-alias.js', `
    import { DynamicsService } from '../lib/services/dynamics-service.js';
    export const D = DynamicsService;
  `);

  expectRed('exported in-file alias fails', (output) => {
    expect(output.includes('shared/export-alias.js'), output);
    expect(output.includes('unattributable-use:export'), output);
  });
}

function runLawDestructuredMethodAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/destructured-method.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      const { createRecord } = DynamicsService;
      await createRecord('contacts', {});
      res.status(200).end();
    }
  `);

  expectRed('destructured method extraction fails', (output) => {
    expect(output.includes('pages/api/destructured-method.js'), output);
    expect(output.includes('unattributable-use:Identifier'), output);
  });
}

function runLawExtractedMethodAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/extracted-method.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      const create = DynamicsService.createRecord;
      await create('contacts', {});
      res.status(200).end();
    }
  `);

  expectRed('extracted method reference fails', (output) => {
    expect(output.includes('pages/api/extracted-method.js'), output);
    expect(output.includes('unattributable-use:MemberExpression'), output);
  });
}

function runLawBoundMethodAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/bound-method.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      const create = DynamicsService.createRecord.bind(DynamicsService);
      await create('contacts', {});
      res.status(200).end();
    }
  `);

  expectRed('bound method reference fails', (output) => {
    expect(output.includes('pages/api/bound-method.js'), output);
    expect(output.includes('unattributable-use:MemberExpression'), output);
  });
}

function runLawClientArgumentAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/client-argument.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await sink(DynamicsService);
      res.status(200).end();
    }
    async function sink(client) {
      return client.createAndSendEmail({ subject: 's' });
    }
  `);

  expectRed('client passed as function argument fails', (output) => {
    expect(output.includes('pages/api/client-argument.js'), output);
    expect(output.includes('unattributable-use:Identifier'), output);
  });
}

function runLawComputedConcatMethodAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/computed-concat.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await DynamicsService['create' + 'Record']('contacts', {});
      res.status(200).end();
    }
  `);

  expectRed('computed-concat method call fails closed', (output) => {
    expect(output.includes('pages/api/computed-concat.js'), output);
    expect(output.includes('unattributable-use:MemberExpression'), output);
  });
}

function runLawDynamicImportUnresolvedAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/dynamic-import-unresolved.js', `
    export default async function handler(req, res) {
      const { DynamicsService } = await import(req.query.source);
      await DynamicsService.createAndSendEmail({ subject: 's' });
      res.status(200).end();
    }
  `);

  expectRed('unresolved dynamic import alias fails', (output) => {
    expect(output.includes('pages/api/dynamic-import-unresolved.js'), output);
    expect(output.includes('unattributable-use:dynamic-import'), output);
  });
}

function runLawEsmSourceReexportAssertion() {
  cleanup();

  write(tempRoot, 'shared/reexport-from-source.js', `
    export { DynamicsService } from '../lib/services/dynamics-service.js';
  `);

  expectRed('ESM source re-export fails', (output) => {
    expect(output.includes('shared/reexport-from-source.js'), output);
    expect(output.includes('unattributable-use:reexport-from-source'), output);
  });
}

function runLawCjsRequireReexportAssertion() {
  cleanup();

  write(tempRoot, 'shared/cjs-reexport.js', `
    module.exports = require('../lib/services/dynamics-service.js');
  `);

  expectRed('CJS require re-export fails', (output) => {
    expect(output.includes('shared/cjs-reexport.js'), output);
    expect(output.includes('unattributable-use:reexport-from-source'), output);
  });
}

function runLawCjsObjectReexportAssertion() {
  cleanup();

  write(tempRoot, 'shared/cjs-object-reexport.js', `
    module.exports = {
      DynamicsService: require('../lib/services/dynamics-service.js').DynamicsService,
    };
  `);

  expectRed('CJS object-literal source re-export fails', (output) => {
    expect(output.includes('shared/cjs-object-reexport.js'), output);
    expect(output.includes('unattributable-use:reexport-from-source'), output);
  });
}

function runLawInlineRequireAttributedAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/inline-require-attributed.js', `
    export default async function handler(req, res) {
      await require('../../lib/services/dynamics-service.js').DynamicsService.createRecord('contacts', {});
      res.status(200).end();
    }
  `);

  expectRed('inline require direct call is entity-attributed', (output) => {
    expect(output.includes('pages/api/inline-require-attributed.js'), output);
    expect(output.includes('require(...).DynamicsService.createRecord | contacts'), output);
    expect(!output.includes('unattributable-use:inline-require'), output);
  });
}

function runLawInlineRequireComputedAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/inline-require-computed.js', `
    export default async function handler(req, res) {
      await require('../../lib/services/dynamics-service.js').DynamicsService['create' + 'Record']('contacts', {});
      res.status(200).end();
    }
  `);

  expectRed('inline require computed method fails as unattributable', (output) => {
    expect(output.includes('pages/api/inline-require-computed.js'), output);
    expect(output.includes('unattributable-use:inline-require'), output);
  });
}

function runLawEsmNamespaceReexportAssertion() {
  cleanup();

  write(tempRoot, 'shared/namespace-reexport.js', `
    import * as dyn from '../lib/services/dynamics-service.js';
    export { dyn };
  `);

  expectRed('ESM namespace re-export fails', (output) => {
    expect(output.includes('shared/namespace-reexport.js'), output);
    expect(output.includes('unattributable-use:export'), output);
  });
}

function runLawCjsNamespaceContainerExportAssertion() {
  cleanup();

  write(tempRoot, 'shared/cjs-namespace-container.js', `
    const dyn = require('../lib/services/dynamics-service.js');
    module.exports = { dyn };
  `);

  expectRed('CJS namespace container export fails', (output) => {
    expect(output.includes('shared/cjs-namespace-container.js'), output);
    expect(output.includes('unattributable-use:export'), output);
  });
}

function runLawNamespaceArgumentAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/namespace-argument.js', `
    const dyn = require('../../lib/services/dynamics-service.js');
    export default async function handler(req, res) {
      await sink(dyn);
      res.status(200).end();
    }
    async function sink(moduleNamespace) {
      return moduleNamespace.DynamicsService.createAndSendEmail({ subject: 's' });
    }
  `);

  expectRed('namespace argument pass-through fails', (output) => {
    expect(output.includes('pages/api/namespace-argument.js'), output);
    expect(output.includes('unattributable-use:Identifier'), output);
  });
}

function runLawSanctionedDirectCallAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/sanctioned-direct.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    export default async function handler(req, res) {
      await DynamicsService.createAndSendEmail({ subject: 's' });
      res.status(200).end();
    }
  `);

  expectGreen('sanctioned direct non-entity call passes');
}

function runLawNonExportedAliasGreenAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/non-exported-alias.js', `
    import { DynamicsService } from '../../lib/services/dynamics-service.js';
    const D = DynamicsService;
    export default async function handler(req, res) {
      await D.createAndSendEmail({ subject: 's' });
      res.status(200).end();
    }
  `);

  expectGreen('tracked non-exported in-file alias call passes');
}

function runLawDynamicImportDirectGreenAssertion() {
  cleanup();

  write(tempRoot, 'pages/api/dynamic-import-direct.js', `
    export default async function handler(req, res) {
      const dyn = await import('../../lib/services/dynamics-service.js');
      await dyn.DynamicsService.createAndSendEmail({ subject: 's' });
      res.status(200).end();
    }
  `);

  expectGreen('resolvable awaited dynamic-import direct call passes');
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
      + 'changeset-unresolved, unknown-method, exempt, sanctioned-direct, alias-green, '
      + 'dynamic-import-green, cross-module-reexport, export-alias, destructured-method, '
      + 'extracted-method, bound-method, client-argument, computed-concat, '
      + 'dynamic-import-unresolved, esm-source-reexport, cjs-require-reexport, '
      + 'cjs-object-reexport, inline-require-attributed, inline-require-computed, '
      + 'esm-namespace-reexport, cjs-namespace-container, namespace-argument',
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
    runLawCrossModuleReexportAssertion();
    runLawExportAliasAssertion();
    runLawDestructuredMethodAssertion();
    runLawExtractedMethodAssertion();
    runLawBoundMethodAssertion();
    runLawClientArgumentAssertion();
    runLawComputedConcatMethodAssertion();
    runLawDynamicImportUnresolvedAssertion();
    runLawEsmSourceReexportAssertion();
    runLawCjsRequireReexportAssertion();
    runLawCjsObjectReexportAssertion();
    runLawInlineRequireAttributedAssertion();
    runLawInlineRequireComputedAssertion();
    runLawEsmNamespaceReexportAssertion();
    runLawCjsNamespaceContainerExportAssertion();
    runLawNamespaceArgumentAssertion();
    runLawSanctionedDirectCallAssertion();
    runLawNonExportedAliasGreenAssertion();
    runLawDynamicImportDirectGreenAssertion();
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
  if (mode === 'cross-module-reexport') return runLawCrossModuleReexportAssertion();
  if (mode === 'export-alias') return runLawExportAliasAssertion();
  if (mode === 'destructured-method') return runLawDestructuredMethodAssertion();
  if (mode === 'extracted-method') return runLawExtractedMethodAssertion();
  if (mode === 'bound-method') return runLawBoundMethodAssertion();
  if (mode === 'client-argument') return runLawClientArgumentAssertion();
  if (mode === 'computed-concat') return runLawComputedConcatMethodAssertion();
  if (mode === 'dynamic-import-unresolved') return runLawDynamicImportUnresolvedAssertion();
  if (mode === 'esm-source-reexport') return runLawEsmSourceReexportAssertion();
  if (mode === 'cjs-require-reexport') return runLawCjsRequireReexportAssertion();
  if (mode === 'cjs-object-reexport') return runLawCjsObjectReexportAssertion();
  if (mode === 'inline-require-attributed') return runLawInlineRequireAttributedAssertion();
  if (mode === 'inline-require-computed') return runLawInlineRequireComputedAssertion();
  if (mode === 'esm-namespace-reexport') return runLawEsmNamespaceReexportAssertion();
  if (mode === 'cjs-namespace-container') return runLawCjsNamespaceContainerExportAssertion();
  if (mode === 'namespace-argument') return runLawNamespaceArgumentAssertion();
  if (mode === 'sanctioned-direct') return runLawSanctionedDirectCallAssertion();
  if (mode === 'alias-green') return runLawNonExportedAliasGreenAssertion();
  if (mode === 'dynamic-import-green') return runLawDynamicImportDirectGreenAssertion();
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
