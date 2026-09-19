'use strict';

/**
 * Reviewer search ownership boundaries. The real-tree assertion protects the
 * completed module layout; synthetic invalid modules verify detector failures.
 * Fixtures are isolated under os.tmpdir() and always cleaned up.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const babel = require(require.resolve('@babel/parser', { paths: [process.cwd()] }));

const FACADE_BASENAME = 'ReviewerSearchSection.js';
const CONTROLLER_BASENAME = 'useReviewerSearchController.js';
const EXPECTED_PUBLIC_EXPORTS = new Set([
  'default',
  'CandidateCard',
  'addressTrustFailureMessage',
]);

// These are the planned view leaves.  The name rule covers later view leaves
// without classifying use* operation hooks as views.
const VIEW_BASENAMES = new Set([
  'SearchControls.js',
  'SearchResults.js',
  'SearchContactModals.js',
  'HandledReviewers.js',
  'ApplicantReviewerStatus.js',
  'CandidateCard.js',
  'IdentityComparisonPanel.js',
  'SearchPrimitives.js',
]);

const CANONICAL_MODULES = new Set([
  'shared/components/reviewers/reviewer-search-logic.js',
  'lib/utils/reviewer-candidate-key.js',
]);
const OPERATION_DECLARATION_NAMES = new Set([
  'applyRosterSnapshot',
  'reloadRoster',
  'retryRosterLoad',
  'runSearch',
  'enrichRecommended',
  'saveCandidates',
  'saveCandidate',
  'excludeCandidate',
  'excludeUnverifiedCandidate',
  'promoteCandidate',
  'removePreviousResults',
  'setManualContact',
  'applyAuthoritativeRosterCandidate',
  'persistManualContact',
  'reviewAddressConflict',
  'retryAddressCheck',
  'requestAddressRepair',
  'useLead',
  'openIdentityConfirmation',
  'confirmIdentityContact',
  'refreshExpiredVerification',
  'saveSelected',
  'exportSelected',
  'removeCandidate',
  'verifyAddressContact',
  'refreshAddressVerification',
  'refreshContact',
  'refreshApplicant',
  'repairCandidate',
  'exportCandidates',
]);

function parseModule(source, filename) {
  return babel.parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: filename,
    errorRecovery: false,
    plugins: [
      'jsx',
      'dynamicImport',
      'optionalChaining',
      'nullishCoalescingOperator',
      'objectRestSpread',
      'topLevelAwait',
    ],
  }).program;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object' && value.type) walk(value, visit);
  }
}

function stringLiteralValue(node) {
  return node && (node.type === 'StringLiteral' || node.type === 'Literal')
    ? node.value
    : null;
}

function importSources(program) {
  const sources = [];
  walk(program, (node) => {
    if (node.type === 'ImportDeclaration') {
      const source = stringLiteralValue(node.source);
      if (source) sources.push({ source, node });
    }
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      const source = stringLiteralValue(node.source);
      if (source) sources.push({ source, node });
    }
    if (
      node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'
      && node.arguments.length === 1
    ) {
      const source = stringLiteralValue(node.arguments[0]);
      if (source) sources.push({ source, node });
    }
  });
  return sources;
}

function exportedNames(program) {
  const names = new Set();
  walk(program, (node) => {
    if (node.type === 'ExportDefaultDeclaration') names.add('default');
    if (node.type !== 'ExportNamedDeclaration') return;
    if (node.declaration) {
      if (node.declaration.type === 'VariableDeclaration') {
        node.declaration.declarations.forEach((item) => {
          if (item.id.type === 'Identifier') names.add(item.id.name);
        });
      } else if (node.declaration.id && node.declaration.id.name) {
        names.add(node.declaration.id.name);
      }
    }
    for (const specifier of node.specifiers || []) {
      if (specifier.exported && specifier.exported.name) names.add(specifier.exported.name);
      else if (specifier.exported && specifier.exported.value) names.add(specifier.exported.value);
    }
  });
  return names;
}

function allSourceFiles(root) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name)) result.push(full);
    }
  };
  visit(root);
  return result;
}

function relativeModulePath(fromFile, source) {
  if (!source.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), source);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || base;
}

function sourceHasForbiddenCall(program, names) {
  let found = false;
  walk(program, (node) => {
    if (found || node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (callee.type === 'Identifier' && names.has(callee.name)) found = true;
    if (
      callee.type === 'MemberExpression'
      && !callee.computed
      && callee.object.type === 'Identifier'
      && callee.object.name === 'React'
      && callee.property.type === 'Identifier'
      && names.has(callee.property.name)
    ) found = true;
  });
  return found;
}

function isOperationModule(file) {
  const base = path.basename(file);
  return /^use[A-Z]/.test(base)
    || /(?:Actions?|Discovery|Promotion|Roster|Export|Contact|Controller|Projection)/.test(base);
}

function isViewModule(file) {
  const base = path.basename(file);
  return VIEW_BASENAMES.has(base)
    || (!/^use[A-Z]/.test(base) && /(?:Card|Controls|Results|Modals|Handled|Status|Presentation|Primitives)/.test(base));
}

function canonicalRelativeImport(fromFile, source, projectRoot) {
  const resolved = relativeModulePath(fromFile, source);
  if (!resolved) return null;
  const relative = path.relative(projectRoot, resolved).split(path.sep).join('/');
  return CANONICAL_MODULES.has(relative) ? relative : null;
}

function functionDeclarations(program) {
  const declarations = [];
  walk(program, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      declarations.push({ name: node.id.name, node });
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const init = node.init;
      const directFunction = init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression'
        ? init
        : (init?.type === 'CallExpression'
          && init.callee.type === 'Identifier'
          && ['useCallback', 'useMemo'].includes(init.callee.name)
          && (init.arguments[0]?.type === 'ArrowFunctionExpression' || init.arguments[0]?.type === 'FunctionExpression')
          ? init.arguments[0]
          : null);
      if (directFunction) declarations.push({ name: node.id.name, node: directFunction });
    }
  });
  return declarations;
}

function declarationReferences(program, names) {
  let hit = false;
  walk(program, (node) => {
    if (hit) return;
    if (node.type === 'Identifier' && names.has(node.name)) hit = true;
  });
  return hit;
}

function assertPublicFacade(projectRoot) {
  const facade = path.join(projectRoot, 'shared/components/reviewers', FACADE_BASENAME);
  assert.ok(fs.existsSync(facade), `public facade missing: ${facade}`);
  const exports = exportedNames(parseModule(fs.readFileSync(facade, 'utf8'), facade));
  for (const expected of EXPECTED_PUBLIC_EXPORTS) {
    assert.ok(exports.has(expected), `public export removed: ${expected}`);
  }
}

function assertNoOperationBackImports(projectRoot, searchDir) {
  const facade = path.join(path.dirname(searchDir), FACADE_BASENAME);
  const controller = path.join(searchDir, CONTROLLER_BASENAME);
  const modules = allSourceFiles(searchDir);
  const graph = new Map(modules.map((file) => [file, []]));
  for (const file of modules) {
    const program = parseModule(fs.readFileSync(file, 'utf8'), file);
    for (const { source } of importSources(program)) {
      const resolved = relativeModulePath(file, source);
      if (resolved && graph.has(resolved)) graph.get(file).push(resolved);
      if (!isOperationModule(file)) continue;
      const target = resolved && path.resolve(resolved);
      assert.notEqual(target, path.resolve(facade), `operation back-imports facade: ${file} -> ${source}`);
      assert.notEqual(target, path.resolve(controller), `operation back-imports controller: ${file} -> ${source}`);
    }
  }

  // A DFS catches an indirect cycle, including operation -> view -> controller.
  const visiting = new Set();
  const visited = new Set();
  const dfs = (file, stack = []) => {
    if (visiting.has(file)) {
      const cycle = [...stack, file].map((item) => path.basename(item)).join(' -> ');
      throw new Error(`search module cycle: ${cycle}`);
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const next of graph.get(file) || []) dfs(next, [...stack, file]);
    visiting.delete(file);
    visited.add(file);
  };
  modules.forEach((file) => dfs(file));
}

function assertNoServerSearchImports(projectRoot, searchDir) {
  const searchRoot = path.resolve(searchDir);
  // Ordinary pages are client/server entrypoints that may import the view tree.
  // Only server consumers are in scope: API pages plus server-owned roots.
  const roots = ['pages/api', 'lib', 'modules', 'server']
    .map((relative) => path.join(projectRoot, relative))
    .filter((dir) => fs.existsSync(dir));
  for (const file of roots.flatMap(allSourceFiles)) {
    const program = parseModule(fs.readFileSync(file, 'utf8'), file);
    for (const { source } of importSources(program)) {
      const resolved = relativeModulePath(file, source);
      const pointsIntoSearch = Boolean(resolved && (path.resolve(resolved) === searchRoot
        || path.resolve(resolved).startsWith(`${searchRoot}${path.sep}`)));
      assert.equal(pointsIntoSearch, false, `server consumer imports search/: ${file} -> ${source}`);
    }
  }
}

function assertViewsArePure(searchDir) {
  for (const file of allSourceFiles(searchDir).filter(isViewModule)) {
    const program = parseModule(fs.readFileSync(file, 'utf8'), file);
    assert.equal(
      sourceHasForbiddenCall(program, new Set(['fetch'])),
      false,
      `view performs fetch: ${file}`,
    );
    // CandidateCard has a bounded local focus/expansion effect. Other Stage 2
    // views must remain markup-only and cannot own workflow effects.
    if (path.basename(file) !== 'CandidateCard.js') {
      assert.equal(
        sourceHasForbiddenCall(program, new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect'])),
        false,
        `view owns workflow effect: ${file}`,
      );
    }
  }
}

function directCandidateKeyWrapper(declaration, localName) {
  const fn = declaration.node;
  const statements = fn.body?.body;
  if (!Array.isArray(statements) || statements.length !== 1 || statements[0].type !== 'ReturnStatement') return false;
  const returned = statements[0].argument;
  if (!returned || returned.type !== 'CallExpression' || returned.callee.type !== 'Identifier'
    || returned.callee.name !== localName || returned.arguments.length !== 1) return false;
  const parameter = fn.params?.[0];
  const argument = returned.arguments[0];
  return parameter?.type === 'Identifier' && argument.type === 'Identifier' && argument.name === parameter.name;
}

function assertNoDuplicateCanonicalImplementations(projectRoot, searchDir) {
  for (const file of allSourceFiles(searchDir)) {
    const program = parseModule(fs.readFileSync(file, 'utf8'), file);
    const canonicalKeyLocals = new Set();
    for (const { node, source } of importSources(program)) {
      const canonical = canonicalRelativeImport(file, source, projectRoot);
      if (!canonical || node.type !== 'ImportDeclaration') continue;
      for (const specifier of node.specifiers || []) {
        if (specifier.imported?.name === 'reviewerCandidateKey') canonicalKeyLocals.add(specifier.local.name);
      }
    }
    for (const declaration of functionDeclarations(program)) {
      const { name } = declaration;
      const isCandidateKey = /^(?:candKey|candidateKey|canonicalCandidateKey|reviewerCandidateKey)$/.test(name);
      const isCanonicalReadiness = /^(?:isCandidateSelectable|getCandidate(?:Email|Promotion|Reason).*|classifyReadiness)$/.test(name);
      const isPrune = /^prune(?:Candidate|.*Roster|.*Contact|.*Identity|.*Eligibility)/.test(name);
      if (isCandidateKey) {
        const allowedThinWrapper = path.basename(file) === 'candidateKeys.js'
          && canonicalKeyLocals.size === 1
          && directCandidateKeyWrapper(declaration, [...canonicalKeyLocals][0]);
        assert.equal(allowedThinWrapper, true, `duplicate candidate-key implementation: ${file}:${name}`);
      }
      assert.equal(isCanonicalReadiness, false, `duplicate readiness implementation: ${file}:${name}`);
      assert.equal(isPrune, false, `duplicate prune implementation: ${file}:${name}`);
    }
  }
}

function assertControllerHasNoOperationBodies(searchDir) {
  const controller = path.join(searchDir, CONTROLLER_BASENAME);
  assert.ok(fs.existsSync(controller), `controller missing: ${controller}`);
  const program = parseModule(fs.readFileSync(controller, 'utf8'), controller);
  for (const { name } of functionDeclarations(program)) {
    const operationName = OPERATION_DECLARATION_NAMES.has(name)
      || /^(?:run|save|refresh|enrich|verify|confirm|exclude|remove|repair|export)[A-Z]/.test(name);
    assert.equal(operationName, false, `controller owns operation body: ${name}`);
  }
  const calls = new Set();
  walk(program, (node) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') calls.add(node.callee.name);
  });
  assert.equal(calls.has('fetch'), false, 'controller owns transport operation: fetch');
  assert.equal(calls.has('readSseStream'), false, 'controller owns transport operation: readSseStream');
}

function assertBoundary(projectRoot) {
  const searchDir = path.join(projectRoot, 'shared/components/reviewers/search');
  assert.ok(fs.existsSync(searchDir), `P9 target missing: ${searchDir}`);
  for (const relative of CANONICAL_MODULES) {
    assert.ok(fs.existsSync(path.join(projectRoot, relative)), `canonical source missing: ${relative}`);
  }
  assertPublicFacade(projectRoot);
  assertNoOperationBackImports(projectRoot, searchDir);
  assertNoServerSearchImports(projectRoot, searchDir);
  assertViewsArePure(searchDir);
  assertNoDuplicateCanonicalImplementations(projectRoot, searchDir);
  assertControllerHasNoOperationBodies(searchDir);
}

function writeFixture(root, files) {
  for (const [relative, source] of Object.entries(files)) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source);
  }
}

function runSelfTests() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-reviewer-search-p9-'));
  const base = path.join(temp, 'repo');
  writeFixture(base, {
    'shared/components/reviewers/ReviewerSearchSection.js': `
      export { CandidateCard, addressTrustFailureMessage } from './search/CandidateCard.js';
      export default function ReviewerSearchSection() {}
    `,
    'shared/components/reviewers/search/CandidateCard.js': `import { useEffect } from 'react'; export function CandidateCard() { useEffect(() => {}, []); return null; }`,
    'shared/components/reviewers/search/SearchResults.js': `export function SearchResults() { return null; }`,
    'shared/components/reviewers/search/candidateKeys.js': `
      import { reviewerCandidateKey } from '../../../../lib/utils/reviewer-candidate-key.js';
      export function candKey(candidate) { return reviewerCandidateKey(candidate); }
    `,
    'shared/components/reviewers/search/useReviewerRoster.js': `
      import { candKey } from './candidateKeys.js';
      export function useReviewerRoster() { return candKey; }
    `,
    'shared/components/reviewers/search/useReviewerSearchController.js': `
      import useReviewerRoster from './useReviewerRoster.js';
      export default function useReviewerSearchController() {
        const { reloadRoster } = useReviewerRoster();
        return { reloadRoster };
      }
    `,
    'shared/components/reviewers/reviewer-search-logic.js': `export function isCandidateSelectable() { return true; }`,
    'lib/utils/reviewer-candidate-key.js': `export function reviewerCandidateKey() { return 'canonical'; }`,
    'pages/allowed.js': `import Card from '../shared/components/reviewers/search/CandidateCard.js'; export default Card;`,
  });

  // Baseline fixture passes all detectors.
  assert.doesNotThrow(() => assertBoundary(base));

  const cases = [
    {
      name: 'public export removal',
      mutate: () => fs.writeFileSync(path.join(base, 'shared/components/reviewers/ReviewerSearchSection.js'), 'export default function ReviewerSearchSection() {}'),
      restore: () => writeFixture(base, { 'shared/components/reviewers/ReviewerSearchSection.js': `export { CandidateCard, addressTrustFailureMessage } from './search/CandidateCard.js'; export default function ReviewerSearchSection() {}` }),
      check: assertPublicFacade,
    },
    {
      name: 'operation back-import',
      mutate: () => fs.writeFileSync(path.join(base, 'shared/components/reviewers/search/useReviewerRoster.js'), `import Facade from '../ReviewerSearchSection.js'; export function useReviewerRoster() { return Facade; }`),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerRoster.js': `import { candKey } from './candidateKeys.js'; export function useReviewerRoster() { return candKey; }` }),
      check: (root) => assertNoOperationBackImports(root, path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'indirect operation cycle',
      mutate: () => writeFixture(base, {
        'shared/components/reviewers/search/useReviewerRoster.js': `import { useReviewerDiscovery } from './useReviewerDiscovery.js'; export function useReviewerRoster() { return useReviewerDiscovery; }`,
        'shared/components/reviewers/search/useReviewerDiscovery.js': `import { useReviewerRoster } from './useReviewerRoster.js'; export function useReviewerDiscovery() { return useReviewerRoster; }`,
      }),
      restore: () => writeFixture(base, {
        'shared/components/reviewers/search/useReviewerRoster.js': `import { candKey } from './candidateKeys.js'; export function useReviewerRoster() { return candKey; }`,
        'shared/components/reviewers/search/useReviewerDiscovery.js': `export function useReviewerDiscovery() { return { runSearch() {} }; }`,
      }),
      check: (root) => assertNoOperationBackImports(root, path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'server search import',
      mutate: () => writeFixture(base, { 'pages/api/invalid.js': `import Search from '../../shared/components/reviewers/search/CandidateCard.js'; export default Search;` }),
      restore: () => fs.rmSync(path.join(base, 'pages/api/invalid.js'), { force: true }),
      check: (root) => assertNoServerSearchImports(root, path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'workflow effect in Stage 2 view',
      mutate: () => writeFixture(base, { 'shared/components/reviewers/search/SearchResults.js': `import { useEffect } from 'react'; export function SearchResults() { useEffect(() => {}, []); return null; }` }),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/SearchResults.js': `export function SearchResults() { return null; }` }),
      check: (root) => assertViewsArePure(path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'fetch in CandidateCard',
      mutate: () => writeFixture(base, { 'shared/components/reviewers/search/CandidateCard.js': `import { useEffect } from 'react'; export function CandidateCard() { useEffect(() => fetch('/bad'), []); return null; }` }),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/CandidateCard.js': `import { useEffect } from 'react'; export function CandidateCard() { useEffect(() => {}, []); return null; }` }),
      check: (root) => assertViewsArePure(path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'duplicate key',
      mutate: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerRoster.js': `export function reviewerCandidateKey(candidate) { return candidate.name; }` }),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerRoster.js': `import { candKey } from './candidateKeys.js'; export function useReviewerRoster() { return candKey; }` }),
      check: (root) => assertNoDuplicateCanonicalImplementations(root, path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'non-direct candidate-key wrapper',
      mutate: () => writeFixture(base, { 'shared/components/reviewers/search/candidateKeys.js': `import { reviewerCandidateKey } from '../../../../lib/utils/reviewer-candidate-key.js'; export function candKey(candidate) { return reviewerCandidateKey({ ...candidate }); }` }),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/candidateKeys.js': `import { reviewerCandidateKey } from '../../../../lib/utils/reviewer-candidate-key.js'; export function candKey(candidate) { return reviewerCandidateKey(candidate); }` }),
      check: (root) => assertNoDuplicateCanonicalImplementations(root, path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'duplicate prune',
      mutate: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerRoster.js': `export const pruneCandidateForRoster = (candidate) => candidate;` }),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerRoster.js': `import { candKey } from './candidateKeys.js'; export function useReviewerRoster() { return candKey; }` }),
      check: (root) => assertNoDuplicateCanonicalImplementations(root, path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'duplicate readiness',
      mutate: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerRoster.js': `export function isCandidateSelectable(candidate) { return Boolean(candidate); }` }),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerRoster.js': `import { candKey } from './candidateKeys.js'; export function useReviewerRoster() { return candKey; }` }),
      check: (root) => assertNoDuplicateCanonicalImplementations(root, path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'controller operation body',
      mutate: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerSearchController.js': `export default function useReviewerSearchController() { const runSearch = async () => fetch('/api/reviewer-finder/discover'); return { runSearch }; }` }),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerSearchController.js': `import useReviewerRoster from './useReviewerRoster.js'; export default function useReviewerSearchController() { const { reloadRoster } = useReviewerRoster(); return { reloadRoster }; }` }),
      check: (root) => assertControllerHasNoOperationBodies(path.join(root, 'shared/components/reviewers/search')),
    },
    {
      name: 'controller non-transport operation body',
      mutate: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerSearchController.js': `import { useCallback } from 'react'; export default function useReviewerSearchController() { const applyRosterSnapshot = useCallback((snapshot) => { setRosterActive(snapshot.active); }, []); return { applyRosterSnapshot }; }` }),
      restore: () => writeFixture(base, { 'shared/components/reviewers/search/useReviewerSearchController.js': `import useReviewerRoster from './useReviewerRoster.js'; export default function useReviewerSearchController() { const { reloadRoster } = useReviewerRoster(); return { reloadRoster }; }` }),
      check: (root) => assertControllerHasNoOperationBodies(path.join(root, 'shared/components/reviewers/search')),
    },
  ];

  for (const scenario of cases) {
    scenario.mutate();
    assert.throws(() => scenario.check(base), undefined, `${scenario.name} detector stayed green`);
    scenario.restore();
  }

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`P9 self-test passed: ${cases.length} invalid boundary mutations rejected`);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) runSelfTests();
  else assertBoundary(path.resolve(process.env.WMKF_PROJECT_ROOT || path.join(__dirname, '../..')));
}

// Run both the real-tree contract and detector mutations in the unit suite.
if (typeof test === 'function') {
  test('reviewer-search boundary contract', () => {
    assertBoundary(path.resolve(process.env.WMKF_PROJECT_ROOT || path.join(__dirname, '../..')));
  });
  test('reviewer-search boundary synthetic mutations', () => {
    runSelfTests();
  });
}

module.exports = {
  assertBoundary,
  assertPublicFacade,
  assertNoOperationBackImports,
  assertNoServerSearchImports,
  assertViewsArePure,
  assertNoDuplicateCanonicalImplementations,
  assertControllerHasNoOperationBodies,
  runSelfTests,
};
