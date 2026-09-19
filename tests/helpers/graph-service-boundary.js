/**
 * Static boundary checker for the staged GraphService extraction.
 *
 * This is intentionally a small source-map analyzer. It is not a general
 * dependency graph framework: the migration owns only the GraphService
 * closure and its staged method/state inventory.
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json'];
const DEFAULT_ALIASES = {
  '@/': '',
  '@shared/': 'shared/',
  '@pages/': 'pages/',
};

function parseSource(source, filename = 'fixture.js') {
  try {
    return parser.parse(source, {
      sourceType: 'unambiguous',
      sourceFilename: filename,
      plugins: ['jsx', 'typescript', 'dynamicImport', 'importMeta'],
    });
  } catch (error) {
    error.message = `Unable to parse ${filename}: ${error.message}`;
    throw error;
  }
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'tokens', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function stringLiteral(node) {
  return node?.type === 'StringLiteral' || node?.type === 'Literal' ? node.value : null;
}

function dependencyEdges(ast) {
  const edges = [];
  walk(ast, node => {
    if ((node.type === 'ImportDeclaration'
      || node.type === 'ExportNamedDeclaration'
      || node.type === 'ExportAllDeclaration') && node.source) {
      edges.push({ node, spec: stringLiteral(node.source), kind: node.type });
      return;
    }
    if (node.type === 'ImportExpression') {
      edges.push({ node, spec: stringLiteral(node.source), kind: 'dynamic-import' });
      return;
    }
    if (node.type === 'CallExpression'
      && (node.callee.type === 'Import'
        || (node.callee.type === 'Identifier' && node.callee.name === 'require'))) {
      edges.push({ node, spec: stringLiteral(node.arguments[0]), kind: node.callee.type === 'Import' ? 'dynamic-import' : 'require' });
    }
  });
  return edges;
}

function candidates(file, spec, aliases = DEFAULT_ALIASES) {
  let base;
  const alias = Object.entries(aliases).find(([prefix]) => spec.startsWith(prefix));
  if (alias) base = path.posix.normalize(path.posix.join(alias[1], spec.slice(alias[0].length)));
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  else return [];
  return [base, ...DEFAULT_EXTENSIONS.map(ext => `${base}${ext}`), ...DEFAULT_EXTENSIONS.map(ext => `${base}/index${ext}`)];
}

function resolveInMap(file, spec, sources, aliases) {
  return candidates(file, spec, aliases).find(candidate => sources.has(candidate)) || null;
}

function isLocalSpec(spec, aliases = DEFAULT_ALIASES) {
  return typeof spec === 'string' && (spec.startsWith('.') || Object.keys(aliases).some(prefix => spec.startsWith(prefix)));
}

function isGraphModule(file, graphDir) {
  return file === graphDir || file.startsWith(`${graphDir}/`);
}

function topLevelDeclarations(ast) {
  const vars = new Map();
  const methods = new Map();
  for (const node of ast.program.body) {
    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      methods.set(node.id.name, (methods.get(node.id.name) || 0) + 1);
    }
    const variableNode = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (variableNode?.type === 'VariableDeclaration') {
      for (const declaration of variableNode.declarations) {
        if (declaration.id.type !== 'Identifier') continue;
        vars.set(declaration.id.name, (vars.get(declaration.id.name) || 0) + 1);
        if (declaration.init?.type === 'ArrowFunctionExpression'
          || declaration.init?.type === 'FunctionExpression') {
          methods.set(declaration.id.name, (methods.get(declaration.id.name) || 0) + 1);
        }
      }
    }
    const classNode = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration' && node.declaration.id?.name) {
      methods.set(node.declaration.id.name, (methods.get(node.declaration.id.name) || 0) + 1);
    }
    if (classNode?.type === 'ClassDeclaration' || classNode?.type === 'ClassExpression') {
      for (const method of classNode.body.body) {
        if (method.static && method.key?.type === 'Identifier') methods.set(method.key.name, (methods.get(method.key.name) || 0) + 1);
      }
    }
  }
  return { vars, methods };
}

function sourceMapFromRoot(root, entry = 'lib/services/graph-service.js', aliases = DEFAULT_ALIASES) {
  const sources = new Map();
  const resolveFile = (file, spec) => {
    const names = candidates(file, spec, aliases);
    return names.find(name => {
      const absolute = path.join(root, name);
      return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    }) || null;
  };
  function load(file) {
    if (sources.has(file)) return;
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return;
    const source = fs.readFileSync(absolute, 'utf8');
    sources.set(file, source);
    if (/\.json$/.test(file)) return;
    for (const edge of dependencyEdges(parseSource(source, file))) {
      if (!isLocalSpec(edge.spec, aliases)) continue;
      const target = resolveFile(file, edge.spec);
      if (target) load(target);
    }
  }
  load(entry);
  return sources;
}

function loadTrackedRuntimeSources(root, dirs = ['lib', 'pages', 'shared', 'modules', 'scripts']) {
  const sources = new Map();
  function collect(dir) {
    const absoluteDir = path.join(root, dir);
    if (!fs.existsSync(absoluteDir)) return;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) collect(file);
      else if (/\.(js|mjs|cjs|ts|tsx)$/.test(file)) sources.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
    }
  }
  dirs.forEach(collect);
  return sources;
}

function analyzeSources(sources, options = {}) {
  const {
    facade = 'lib/services/graph-service.js',
    graphDir = 'lib/services/graph',
    aliases = DEFAULT_ALIASES,
    inventory = {},
    movedOwners = {},
    delegates = {},
  } = options;
  const errors = [];
  const asts = new Map();
  const graph = new Map();
  const localFiles = [...sources.keys()];
  for (const [file, source] of sources) {
    if (/\.json$/.test(file)) continue;
    const ast = parseSource(source, file);
    asts.set(file, ast);
    const edges = dependencyEdges(ast).map(edge => ({
      ...edge,
      target: isLocalSpec(edge.spec, aliases) ? resolveInMap(file, edge.spec, sources, aliases) : null,
    }));
    graph.set(file, edges);
    for (const edge of edges) {
      if (isGraphModule(file, graphDir) && edge.spec == null) errors.push(`nonliteral dependency: ${file}`);
      if (edge.target && isGraphModule(edge.target, graphDir) && file !== facade && !isGraphModule(file, graphDir)) {
        errors.push(`external runtime import of Graph internals: ${file} -> ${edge.target}`);
      }
      if (isGraphModule(file, graphDir) && edge.target === facade) errors.push(`internal facade dependency: ${file} -> ${facade}`);
      if (isGraphModule(file, graphDir) && edge.target
        && isGraphModule(edge.target, graphDir)
        && !new Set([`${graphDir}/constants.js`, `${graphDir}/paths.js`, `${graphDir}/http.js`]).has(edge.target)) {
        errors.push(`operation-to-operation dependency: ${file} -> ${edge.target}`);
      }
    }
    if (isGraphModule(file, graphDir) && file !== `${graphDir}/http.js`) {
      walk(ast, node => {
        if (node.type === 'ThisExpression') errors.push(`receiver access in Graph module: ${file}`);
        const callee = node.type === 'CallExpression' ? node.callee : null;
        const globalFetch = callee?.type === 'MemberExpression'
          && callee.object?.type === 'Identifier'
          && callee.object.name === 'globalThis'
          && ((callee.computed && callee.property?.type === 'StringLiteral' && callee.property.value === 'fetch')
            || (!callee.computed && callee.property?.type === 'Identifier' && callee.property.name === 'fetch'));
        if (callee?.type === 'Identifier' && callee.name === 'fetch' || globalFetch) {
          errors.push(`raw fetch outside graph http owner: ${file}`);
        }
      });
    }
  }

  // A missing local edge in an unrelated file is outside this migration, but
  // every helper reachable from the facade is part of the checked closure.
  const facadeClosure = new Set([facade]);
  function collectClosure(file) {
    for (const edge of graph.get(file) || []) {
      if (!edge.target || facadeClosure.has(edge.target)) continue;
      facadeClosure.add(edge.target);
      collectClosure(edge.target);
    }
  }
  if (graph.has(facade)) collectClosure(facade);
  for (const file of facadeClosure) {
    for (const edge of graph.get(file) || []) {
      if (isLocalSpec(edge.spec, aliases) && !edge.target) errors.push(`unresolved local edge: ${file} -> ${edge.spec}`);
    }
  }

  // Follow the facade closure and report only cycles that involve the staged
  // Graph modules; unrelated repository cycles are outside this checker.
  const graphRoots = [facade, ...localFiles.filter(file => isGraphModule(file, graphDir))];
  const cycleKeys = new Set();
  function findCycles(root, file, trail, active) {
    if (active.has(file)) {
      const start = trail.indexOf(file);
      const cycle = [...trail.slice(start), file];
      if (cycle.some(item => item === facade || isGraphModule(item, graphDir))) {
        const key = cycle.join(' -> ');
        if (!cycleKeys.has(key)) errors.push(`Graph dependency cycle: ${key}`);
        cycleKeys.add(key);
      }
      return;
    }
    const nextActive = new Set(active).add(file);
    for (const edge of graph.get(file) || []) if (edge.target) {
      findCycles(root, edge.target, [...trail, file], nextActive);
    }
  }
  for (const root of graphRoots) if (graph.has(root)) findCycles(root, root, [], new Set());

  const declarations = new Map([...asts.entries()].map(([file, ast]) => [file, topLevelDeclarations(ast)]));
  const ownerCandidates = localFiles.filter(file => file === facade || isGraphModule(file, graphDir));
  for (const name of inventory.methods || []) {
    const owners = ownerCandidates.filter(file => {
      if (file === facade && movedOwners[name] && delegates[name]) return false;
      return (declarations.get(file)?.methods.get(name) || 0) > 0;
    });
    if (owners.length !== 1) errors.push(`method owner ${name}: expected one owner, found ${owners.join(', ') || 'none'}`);
    if (movedOwners[name] && owners[0] !== movedOwners[name]) errors.push(`method owner ${name}: expected ${movedOwners[name]}, found ${owners[0] || 'none'}`);
  }

  for (const [name, target] of Object.entries(delegates)) {
    const facadeAst = asts.get(facade);
    const classNode = facadeAst?.program.body.find(node => (
      node.type === 'ClassDeclaration' || node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'ClassDeclaration'
    ));
    const body = classNode?.type === 'ExportNamedDeclaration' ? classNode.declaration.body.body : classNode?.body.body;
    const method = body?.find(node => node.type === 'ClassMethod' && node.static && node.key?.name === name);
    if (!method) {
      errors.push(`missing facade delegate: ${name}`);
      continue;
    }
    const expectedTarget = typeof target === 'string' ? target : target?.target;
    const expectedBinding = typeof target === 'object' ? target?.binding : null;
    const namedBindings = new Set(expectedBinding ? [expectedBinding] : []);
    const namespaceBindings = new Set();
    for (const edge of graph.get(facade) || []) {
      if (edge.target !== expectedTarget || edge.node.type !== 'ImportDeclaration') continue;
      for (const specifier of edge.node.specifiers || []) {
        if (!specifier.local?.name) continue;
        if (specifier.type === 'ImportNamespaceSpecifier') namespaceBindings.add(specifier.local.name);
        if (specifier.type === 'ImportSpecifier'
          && (specifier.imported?.name || specifier.imported?.value) === name) namedBindings.add(specifier.local.name);
      }
    }
    const statement = method.body.body.length === 1 ? method.body.body[0] : null;
    const call = statement?.type === 'ReturnStatement' && statement.argument?.type === 'CallExpression'
      ? statement.argument : null;
    const callee = call?.callee;
    const namedCall = callee?.type === 'Identifier' && namedBindings.has(callee.name);
    const namespaceCall = callee?.type === 'MemberExpression'
      && !callee.computed && callee.property?.name === name
      && namespaceBindings.has(callee.object?.name);
    const receiverForwarded = call?.arguments?.[0]?.type === 'ThisExpression';
    const hasCall = Boolean(call && (namedCall || namespaceCall) && receiverForwarded);
    if (!hasCall || !graph.has(facade) || ![...graph.get(facade)].some(edge => edge.target === expectedTarget)) {
      errors.push(`invalid facade delegate: ${name} -> ${expectedTarget}`);
    }
  }
  for (const name of inventory.state || []) {
    const owners = ownerCandidates.filter(file => (declarations.get(file)?.vars.get(name) || 0) > 0);
    if (owners.length !== 1) errors.push(`state owner ${name}: expected one owner, found ${owners.join(', ') || 'none'}`);
    if (movedOwners[name] && owners[0] !== movedOwners[name]) errors.push(`state owner ${name}: expected ${movedOwners[name]}, found ${owners[0] || 'none'}`);
  }

  return { errors, graph, asts, localFiles };
}

module.exports = {
  DEFAULT_ALIASES,
  analyzeSources,
  candidates,
  dependencyEdges,
  parseSource,
  resolveInMap,
  sourceMapFromRoot,
  loadTrackedRuntimeSources,
};
