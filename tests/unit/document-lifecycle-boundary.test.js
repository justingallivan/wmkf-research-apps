/** Permanent Stage8 architecture checks and negative fixtures run by npm test. */
const path = require('path');
const {
  analyzeSources, loadSources, FACADES, HASH, AGENDA, COMPOSITION, WRITERS, BINDINGS,
} = require('../helpers/document-lifecycle-boundary');

const INTERNAL = 'lib/services/pre-site-visit/artifact-model.js';
const HELPER = 'lib/utils/boundary-fixture.js';
const relative = (from, to) => {
  const result = path.posix.relative(path.posix.dirname(from), to);
  return result.startsWith('.') ? result : `./${result}`;
};
function fixture() {
  const sources = new Map();
  for (const file of [...FACADES, HASH, AGENDA, COMPOSITION, INTERNAL, ...WRITERS, ...BINDINGS]) sources.set(file, '');
  for (const file of WRITERS) sources.set(file, 'function save(dependencies) { dependencies.createDocument({}); }');
  for (const file of BINDINGS) sources.set(file, `${sources.get(file)}\nconst createDocument = requestDocumentAdapter.create;`);
  sources.set(HASH, "import crypto from 'crypto'; import JSZip from 'jszip';");
  sources.set(COMPOSITION, 'export const normalizeRecipients = () => [];');
  sources.set(AGENDA, `import { normalizeRecipients } from '${relative(AGENDA, COMPOSITION)}';`);
  return sources;
}
const errorsFor = (sources) => analyzeSources(sources).errors;
function expectError(sources, expected) {
  expect(errorsFor(sources)).toEqual(expect.arrayContaining([expect.stringContaining(expected)]));
}

test('live lifecycle imports, six scoped writer seams, and six adapter bindings stay intact', () => {
  const result = analyzeSources(loadSources(path.resolve(__dirname, '../..')));
  expect(result.errors).toEqual([]);
  expect(result.writerCounts).toEqual(Object.fromEntries(WRITERS.map((file) => [file, 1])));
  expect(result.bindingCounts).toEqual(Object.fromEntries(BINDINGS.map((file) => [file, 1])));
});
test('minimal complete fixture is accepted', () => expect(errorsFor(fixture())).toEqual([]));

test.each([
  ['static', (spec) => `import '${spec}';`],
  ['named re-export', (spec) => `export { item } from '${spec}';`],
  ['export all', (spec) => `export * from '${spec}';`],
  ['dynamic import', (spec) => `export async function load() { return import('${spec}'); }`],
  ['assigned nested require', (spec) => `function load() { const value = require('${spec}'); return value; }`],
])('%s cannot hide an internal-to-facade edge', (_name, source) => {
  const sources = fixture();
  sources.set(INTERNAL, source(relative(INTERNAL, FACADES[1])));
  sources.set(FACADES[1], `${sources.get(FACADES[1])}\nexport const item = 1;`);
  expectError(sources, 'internal facade dependency');
});
test.each(FACADES)('every real facade is guarded: %s', (facade) => {
  const sources = fixture();
  sources.set(INTERNAL, `import '${relative(INTERNAL, facade)}';`);
  expectError(sources, 'internal facade dependency');
});
test.each(['import(target)', 'require(target)'])('nonliteral scoped dependency fails: %s', (expression) => {
  const sources = fixture();
  sources.set(INTERNAL, `function load(target) { return ${expression}; }`);
  expectError(sources, 'nonliteral dependency');
});
test('comments and string literals are not imports or writes', () => {
  const sources = fixture();
  sources.set(INTERNAL, '// dependencies.createDocument({});\nconst text = "require(unknown)";');
  expect(errorsFor(sources)).toEqual([]);
});
test('neutral hash rejects transport dependencies', () => {
  const sources = fixture();
  const transport = 'lib/services/graph-service.js';
  sources.set(transport, 'export class GraphService {}');
  sources.set(HASH, `import { GraphService } from '${relative(HASH, transport)}';`);
  expectError(sources, 'hash dependency');
});
test('agenda cannot switch back to the distribution facade', () => {
  const sources = fixture();
  sources.set(AGENDA, `import '${relative(AGENDA, FACADES[2])}';`);
  expectError(sources, 'agenda imports distribution facade');
  expectError(sources, 'agenda must import composition');
});
test('required owner paths cannot silently disappear', () => {
  const sources = fixture(); sources.delete(HASH);
  expectError(sources, 'missing required module');
});
test('out-and-back cycle through an external helper fails', () => {
  const sources = fixture();
  sources.set(INTERNAL, `import '${relative(INTERNAL, HELPER)}';`);
  sources.set(HELPER, `export * from '${relative(HELPER, INTERNAL)}';`);
  expectError(sources, 'dependency cycle');
});
test('a reachable cycle outside the changed domains is not an unrelated migration obligation', () => {
  const sources = fixture();
  sources.set(INTERNAL, `import '${relative(INTERNAL, HELPER)}';`);
  sources.set(HELPER, "import './other.js';");
  sources.set('lib/utils/other.js', "import './boundary-fixture.js';");
  expect(errorsFor(sources)).toEqual([]);
});
test.each(['missing', 'default'])('missing %s import fails', (name) => {
  const sources = fixture();
  sources.set(HELPER, 'export const present = 1;');
  sources.set(INTERNAL, name === 'default'
    ? `import value from '${relative(INTERNAL, HELPER)}';`
    : `import { missing } from '${relative(INTERNAL, HELPER)}';`);
  expectError(sources, 'missing export');
});
test('named re-export cannot invent or expose all target names', () => {
  const sources = fixture();
  sources.set(HELPER, 'export const present = 1; export const secret = 2;');
  sources.set(INTERNAL, `export { missing as invented, present as renamed } from '${relative(INTERNAL, HELPER)}';`);
  expectError(sources, '(missing)');
  sources.set(INTERNAL, `export { present as renamed } from '${relative(INTERNAL, HELPER)}';`);
  sources.set(COMPOSITION, `${sources.get(COMPOSITION)}\nimport { secret } from '${relative(COMPOSITION, INTERNAL)}';`);
  expectError(sources, '(secret)');
});
test('an invalid transitive re-export cannot satisfy an owned import', () => {
  const sources = fixture();
  sources.set(HELPER, "export { missing as value } from './other.js';");
  sources.set('lib/utils/other.js', 'export const present = 1;');
  sources.set(INTERNAL, `import { value } from '${relative(INTERNAL, HELPER)}';`);
  expectError(sources, '(value)');
});
test('extensionless CommonJS object exports support named and default imports', () => {
  const sources = fixture();
  sources.set(HELPER, 'function value() {} module.exports = { value };');
  sources.set(INTERNAL, `import whole, { value } from '${relative(INTERNAL, HELPER).replace(/\.js$/, '')}';`);
  expect(errorsFor(sources)).toEqual([]);
});
test('unresolved relative imports fail', () => {
  const sources = fixture(); sources.set(INTERNAL, "import './absent';");
  expectError(sources, 'unresolved dependency');
});
test('an unregistered physical writer fails without adding an adapter binding', () => {
  const sources = fixture();
  sources.set(INTERNAL, 'export function save(dependencies) { return dependencies.createDocument({}); }');
  const result = analyzeSources(sources);
  expect(result.bindingCounts).toEqual(Object.fromEntries(BINDINGS.map((file) => [file, 1])));
  expectError(sources, `writer census: ${INTERNAL}`);
});
test('a duplicate call at a registered writer fails', () => {
  const sources = fixture(); const writer = WRITERS[1];
  sources.set(writer, `${sources.get(writer)}\nfunction extra(dependencies) { dependencies.createDocument({}); }`);
  expectError(sources, `writer census: ${writer} has 2`);
});
test('a missing registered physical writer fails', () => {
  const sources = fixture(); const writer = WRITERS[1];
  sources.set(writer, 'const createDocument = requestDocumentAdapter.create;');
  expectError(sources, `writer census: ${writer} has 0`);
});
test('a duplicate adapter binding fails without adding a physical call', () => {
  const sources = fixture();
  sources.set(INTERNAL, 'const extra = requestDocumentAdapter.create;');
  const result = analyzeSources(sources);
  expect(result.writerCounts).toEqual(Object.fromEntries(WRITERS.map((file) => [file, 1])));
  expectError(sources, `adapter binding census: ${INTERNAL}`);
});
test('computed literal create calls and adapter bindings are counted', () => {
  const sources = fixture();
  sources.set(INTERNAL, "function save(dependencies) { dependencies['createDocument']({}); } const extra = requestDocumentAdapter['create'];");
  expectError(sources, 'writer census');
  expectError(sources, 'adapter binding census');
});
