/**
 * Static guard for the decomposed document lifecycle modules. Deliberately bounded
 * to literal ESM/CommonJS edges and the existing createDocument/adapter seams;
 * this is an architecture regression check, not a general JavaScript security scan.
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const DOMAIN_DIRS = ['initial-assessment', 'pre-site-visit', 'final-writeup', 'documents']
  .map((name) => `lib/services/${name}/`);
const FACADES = [
  'lib/services/initial-assessment/artifact-service.js',
  'lib/services/pre-site-visit/artifact-service.js',
  'lib/services/pre-site-visit/distribution-service.js',
  'lib/services/final-writeup/transition-service.js',
];
const HASH = 'lib/services/documents/governed-docx-hash.js';
const AGENDA = 'lib/services/meeting-tracker/agenda-service.js';
const COMPOSITION = 'lib/services/pre-site-visit/distribution/composition.js';
const WRITERS = [FACADES[0], 'lib/services/initial-assessment/controls-service.js',
  FACADES[1], 'lib/services/pre-site-visit/reopen-service.js',
  'lib/services/pre-site-visit/distribution/retained-snapshot.js', FACADES[3]];
const BINDINGS = [FACADES[0], 'lib/services/initial-assessment/controls-service.js',
  'lib/services/pre-site-visit/artifact-dependencies.js',
  'lib/services/pre-site-visit/reopen-service.js',
  'lib/services/pre-site-visit/distribution/dependencies.js',
  'lib/services/final-writeup/transition-dependencies.js'];
const isScoped = (file) => DOMAIN_DIRS.some((dir) => file.startsWith(dir));
const isInternal = (file) => (
  /^lib\/services\/(initial-assessment|pre-site-visit)\/artifact-(model|reader|lineage|upload-recovery|dependencies)\.js$/.test(file)
  || file.startsWith('lib/services/pre-site-visit/distribution/')
  || /^lib\/services\/final-writeup\/transition-(model|dependencies|state|claims)\.js$/.test(file)
);
const literal = (node) => node?.type === 'StringLiteral' ? node.value : null;
const memberName = (node) => node?.computed ? literal(node.property) : node?.property?.name;
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'tokens', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function parse(source) {
  return parser.parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
}
function edgesOf(ast) {
  const edges = [];
  walk(ast, (node) => {
    if (node.type === 'ImportDeclaration' || ((node.type === 'ExportNamedDeclaration'
      || node.type === 'ExportAllDeclaration') && node.source)) {
      edges.push({ node, spec: literal(node.source) });
    } else if (node.type === 'ImportExpression') {
      edges.push({ node, spec: literal(node.source) });
    } else if (node.type === 'CallExpression' && (node.callee.type === 'Import'
      || (node.callee.type === 'Identifier' && node.callee.name === 'require'))) {
      edges.push({ node, spec: literal(node.arguments[0]) });
    }
  });
  return edges;
}
function candidates(file, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  return [base, ...['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json'].map((ext) => base + ext), `${base}/index.js`];
}
function loadSources(root) {
  const sources = new Map();
  function collect(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) collect(file);
      else if (/\.(js|mjs|cjs|ts|tsx)$/.test(file)) load(file);
    }
  }
  function load(file) {
    if (sources.has(file)) return;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    sources.set(file, source);
    if (file.endsWith('.json')) return;
    for (const { spec } of edgesOf(parse(source))) {
      if (!spec?.startsWith('.')) continue;
      const target = candidates(file, spec).find((name) => {
        const absolute = path.join(root, name);
        return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
      });
      if (target) load(target);
    }
  }
  DOMAIN_DIRS.forEach((dir) => collect(dir.slice(0, -1)));
  load(AGENDA);
  return sources;
}
function analyzeSources(sources) {
  const errors = [];
  const asts = new Map();
  const graph = new Map();
  const resolve = (file, spec) => candidates(file, spec).find((name) => sources.has(name));
  const roots = [...sources.keys()].filter((file) => isScoped(file) || file === AGENDA);
  for (const file of [...FACADES, HASH, AGENDA, COMPOSITION, ...WRITERS, ...BINDINGS]) {
    if (!sources.has(file)) errors.push(`missing required module: ${file}`);
  }
  for (const [file, source] of sources) {
    if (file.endsWith('.json')) continue;
    const ast = parse(source);
    asts.set(file, ast);
    const edges = edgesOf(ast).map((edge) => ({ ...edge,
      target: edge.spec?.startsWith('.') ? resolve(file, edge.spec) : null }));
    graph.set(file, edges);
    for (const edge of edges) {
      if (roots.includes(file) && edge.spec == null) errors.push(`nonliteral dependency: ${file}`);
      if (edge.spec?.startsWith('.') && !edge.target) errors.push(`unresolved dependency: ${file} -> ${edge.spec}`);
      if (isInternal(file) && FACADES.includes(edge.target)) errors.push(`internal facade dependency: ${file} -> ${edge.target}`);
      if (file === HASH && !['crypto', 'node:crypto', 'jszip'].includes(edge.spec)) errors.push(`hash dependency: ${edge.spec}`);
      if (file === AGENDA && edge.target === FACADES[2]) errors.push('agenda imports distribution facade');
    }
  }
  if (!(graph.get(AGENDA) || []).some((edge) => edge.target === COMPOSITION)) errors.push('agenda must import composition');
  // Follow transitive helpers outside the domains, but report only cycles that
  // return to a scoped root; unrelated existing cycles are not this migration.
  for (const root of roots) {
    const seen = new Set();
    function visit(file, trail) {
      if (file === root && trail.length) { errors.push(`dependency cycle: ${[...trail, root].join(' -> ')}`); return; }
      if (seen.has(file)) return;
      seen.add(file);
      for (const edge of graph.get(file) || []) if (edge.target) visit(edge.target, [...trail, file]);
    }
    visit(root, []);
  }
  function exportsOf(file, seen = new Set()) {
    if (seen.has(file)) return new Set();
    const next = new Set([...seen, file]);
    if (file.endsWith('.json')) return new Set(['default']);
    const names = new Set();
    for (const node of asts.get(file)?.program.body || []) {
      if (node.type === 'ExportDefaultDeclaration') names.add('default');
      if (node.type === 'ExportNamedDeclaration') {
        for (const specifier of node.specifiers) {
          const target = node.source && resolve(file, node.source.value);
          const imported = specifier.local?.name || specifier.local?.value;
          if (!node.source || specifier.type === 'ExportNamespaceSpecifier'
            || (target && exportsOf(target, next).has(imported))) {
            names.add(specifier.exported.name || specifier.exported.value);
          }
        }
        if (node.declaration?.id) names.add(node.declaration.id.name);
        for (const declaration of node.declaration?.declarations || []) {
          walk(declaration.id, (id) => { if (id.type === 'Identifier') names.add(id.name); });
        }
      }
      if (node.type === 'ExportAllDeclaration') {
        const target = resolve(file, node.source.value);
        if (target) for (const name of exportsOf(target, next)) if (name !== 'default') names.add(name);
      }
      const assignment = node.expression;
      if (assignment?.type === 'AssignmentExpression' && assignment.left.type === 'MemberExpression'
        && assignment.left.object.name === 'module' && memberName(assignment.left) === 'exports') {
        names.add('default');
        if (assignment.right.type === 'ObjectExpression') {
          for (const property of assignment.right.properties) {
            const name = property.computed ? literal(property.key) : property.key?.name || property.key?.value;
            if (name) names.add(name);
          }
        }
      }
    }
    return names;
  }
  for (const file of roots) for (const edge of graph.get(file) || []) {
    if (!edge.target) continue;
    const available = exportsOf(edge.target);
    for (const specifier of edge.node.specifiers || []) {
      if (['ImportNamespaceSpecifier', 'ExportNamespaceSpecifier'].includes(specifier.type)) continue;
      const requested = specifier.type === 'ImportDefaultSpecifier' ? 'default'
        : (specifier.imported || specifier.local)?.name || (specifier.imported || specifier.local)?.value;
      if (requested && !available.has(requested)) errors.push(`missing export: ${file} -> ${edge.target} (${requested})`);
    }
  }
  const writerCounts = new Map();
  const bindingCounts = new Map();
  for (const file of roots.filter(isScoped)) {
    let writes = 0; let bindings = 0;
    walk(asts.get(file), (node) => {
      const isAdapterCreate = node.type === 'MemberExpression'
        && node.object.name === 'requestDocumentAdapter' && memberName(node) === 'create';
      if (isAdapterCreate) bindings += 1;
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && (memberName(node.callee) === 'createDocument'
          || (node.callee.object.name === 'requestDocumentAdapter' && memberName(node.callee) === 'create'))) writes += 1;
    });
    if (writes) writerCounts.set(file, writes);
    if (bindings) bindingCounts.set(file, bindings);
    if (writes !== (WRITERS.includes(file) ? 1 : 0)) errors.push(`writer census: ${file} has ${writes}`);
    if (bindings !== (BINDINGS.includes(file) ? 1 : 0)) errors.push(`adapter binding census: ${file} has ${bindings}`);
  }
  return { errors, writerCounts: Object.fromEntries(writerCounts), bindingCounts: Object.fromEntries(bindingCounts), modules: roots.length };
}
module.exports = { analyzeSources, loadSources, FACADES, HASH, AGENDA, COMPOSITION, WRITERS, BINDINGS };
