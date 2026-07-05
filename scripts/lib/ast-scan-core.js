#!/usr/bin/env node
/**
 * Shared, source-family-agnostic AST scanner primitives.
 *
 * Extracted from scripts/check-dataverse-access-layer.js so that BOTH the
 * Dataverse access-layer law gate and the Route→Service boundary census gate
 * (scripts/check-route-service-boundary.js) share one hardened scanner core
 * rather than re-implementing (and drifting) evadable per-file import matchers.
 *
 * What lives here:
 *   - Babel parse + AST walk plumbing (parseModule, walkAst, SKIP_AST_KEYS).
 *   - Node shape helpers (propName, bindingNames, memberObjectAndProperty,
 *     stringLiteralValue, unwrapExpression, nodeLine, isMember/isCall/…).
 *   - Import/require/dynamic-import SOURCE recognition, parameterized by an
 *     `isModuleSource(value)` predicate via createSourceRecognizers() — this is
 *     the "dynamic-import recognition / inline-require recognition" primitive
 *     both gates inherit, so neither can be evaded by ordinary indirection.
 *   - Export/re-export/binding-scope helpers used by the sanctioned-reference
 *     audit (isCommonJsExportTarget, isInsideExportAliasSyntax, …).
 *
 * What does NOT live here (stays in each gate): the DynamicsService-specific
 * alias-flow + entity attribution (dataverse gate) and the boundary-source
 * reachability/re-export taint (route gate). Those are the gate-specific
 * semantics layered on top of this shared core.
 */

const parser = require('@babel/parser');

const PARSER_PLUGINS = ['jsx', 'typescript', 'dynamicImport', 'importAttributes'];

const SKIP_AST_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'tokens',
]);

function parseModule(source) {
  return parser.parse(source, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: PARSER_PLUGINS,
  });
}

function walkAst(node, enter, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  if (enter(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (SKIP_AST_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, enter, node);
    } else if (value && typeof value.type === 'string') {
      walkAst(value, enter, node);
    }
  }
}

function propName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return String(node.value);
  return null;
}

function bindingNames(pattern, out = []) {
  if (!pattern) return out;
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern.name);
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties || []) {
        if (prop.type === 'ObjectProperty') bindingNames(prop.value, out);
        else if (prop.type === 'RestElement') bindingNames(prop.argument, out);
      }
      break;
    case 'ArrayPattern':
      for (const item of pattern.elements || []) {
        if (!item) continue;
        bindingNames(item.type === 'RestElement' ? item.argument : item, out);
      }
      break;
    case 'AssignmentPattern':
      bindingNames(pattern.left, out);
      break;
    case 'RestElement':
      bindingNames(pattern.argument, out);
      break;
    case 'TSParameterProperty':
      bindingNames(pattern.parameter, out);
      break;
    default:
      break;
  }
  return out;
}

function memberObjectAndProperty(callee) {
  if (!callee) return null;
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return null;
  const property = callee.computed ? propName(callee.property) : propName(callee.property);
  if (!property) return null;
  return { object: callee.object, property };
}

function stringLiteralValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
  }
  return null;
}

function unwrapExpression(node) {
  let cur = node;
  while (cur && (
    cur.type === 'AwaitExpression'
    || cur.type === 'TSAsExpression'
    || cur.type === 'TSTypeAssertion'
    || cur.type === 'TSNonNullExpression'
    || cur.type === 'ParenthesizedExpression'
  )) {
    cur = cur.type === 'AwaitExpression' ? cur.argument : cur.expression;
  }
  return cur;
}

function importCallSourceNode(node) {
  if (!node) return null;
  if (node.type === 'ImportExpression') return node.source || null;
  if (node.type === 'CallExpression' && node.callee.type === 'Import') return node.arguments[0] || null;
  return null;
}

function isDynamicImportCall(node) {
  return !!importCallSourceNode(node);
}

function isUnresolvedDynamicImportCall(node) {
  const source = importCallSourceNode(node);
  return !!source && stringLiteralValue(source) == null;
}

function addAlias(aliases, name, kind) {
  if (!name) return false;
  const prev = aliases.get(name);
  if (prev === kind) return false;
  if (prev && prev !== 'dynamic-client' && kind === 'dynamic-client') return false;
  aliases.set(name, prev || kind);
  return !prev;
}

function nodeLine(node) {
  return node && node.loc && node.loc.start ? node.loc.start.line : 0;
}

function buildParentMap(ast) {
  const parents = new WeakMap();
  walkAst(ast, (node, parent) => {
    if (parent) parents.set(node, parent);
  });
  return parents;
}

function isMember(node) {
  return node && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression');
}

function isCall(node) {
  return node && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression');
}

function isFunctionNode(node) {
  return node && (
    node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression'
    || node.type === 'ObjectMethod'
    || node.type === 'ClassMethod'
  );
}

function isCalleeOfCall(node, parentMap) {
  const parent = parentMap.get(node);
  return isCall(parent) && parent.callee === node;
}

function isExpressionWrapper(parent, child) {
  return parent && (
    (parent.type === 'AwaitExpression' && parent.argument === child)
    || ((parent.type === 'ParenthesizedExpression'
      || parent.type === 'TSAsExpression'
      || parent.type === 'TSTypeAssertion'
      || parent.type === 'TSNonNullExpression') && parent.expression === child)
  );
}

function climbExpressionWrappers(node, parentMap) {
  let cur = node;
  let parent = parentMap.get(cur);
  while (isExpressionWrapper(parent, cur)) {
    cur = parent;
    parent = parentMap.get(cur);
  }
  return cur;
}

function isWithin(node, ancestor, parentMap) {
  let cur = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = parentMap.get(cur);
  }
  return false;
}

function isModuleExportsMember(node) {
  if (!isMember(node)) return false;
  if (node.object.type === 'Identifier'
    && node.object.name === 'module'
    && propName(node.property) === 'exports') {
    return true;
  }
  return isModuleExportsMember(node.object);
}

function isCommonJsExportTarget(node) {
  if (!isMember(node)) return false;
  if (node.object.type === 'Identifier' && node.object.name === 'exports') return true;
  return isModuleExportsMember(node);
}

function isInsideCommonJsExportRight(node, parentMap) {
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'AssignmentExpression') {
      return parent.right === cur && isCommonJsExportTarget(parent.left);
    }
    cur = parent;
  }
  return false;
}

function isInsideExportAliasSyntax(node, parentMap) {
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (cur !== node && (isFunctionNode(cur) || cur.type === 'ClassDeclaration' || cur.type === 'ClassExpression')) {
      return false;
    }
    if (parent.type === 'ExportSpecifier') return true;
    if (parent.type === 'ExportDefaultDeclaration') return parent.declaration === cur;
    if (parent.type === 'ExportNamedDeclaration') {
      return parent.declaration === cur && cur.type === 'VariableDeclaration';
    }
    cur = parent;
  }
  return false;
}

function isPropertyKeyIdentifier(node, parent) {
  return (isMember(parent) && parent.property === node && !parent.computed)
    || ((parent && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassMethod'))
      && parent.key === node
      && !parent.computed);
}

function isBindingIdentifier(node, parentMap) {
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'ImportSpecifier'
      || parent.type === 'ImportDefaultSpecifier'
      || parent.type === 'ImportNamespaceSpecifier') {
      return parent.local === node || parent.imported === node;
    }
    if (parent.type === 'AssignmentPattern') {
      if (parent.right === cur) return false;
      cur = parent;
      continue;
    }
    if (parent.type === 'VariableDeclarator') return parent.id === cur;
    if (isFunctionNode(parent) && (parent.params || []).includes(cur)) return true;
    if (parent.type === 'CatchClause' && parent.param === cur) return true;
    cur = parent;
  }
  return false;
}

function isExportedVariableDeclarator(declarator, parentMap) {
  const declaration = parentMap.get(declarator);
  const parent = declaration && parentMap.get(declaration);
  return parent && parent.type === 'ExportNamedDeclaration';
}

function toRel(root, full) {
  const path = require('path');
  return path.relative(root, full).split(path.sep).join('/');
}

/**
 * Build the source-family recognizers bound to an `isModuleSource(value)`
 * predicate. Both gates create one of these; the dataverse gate binds it to its
 * dynamics-service matcher, the route gate binds it to the adapter ∪
 * dynamics-service boundary matcher. Recognizers keep single-node arity so the
 * gate's existing call sites do not change.
 */
function createSourceRecognizers(isModuleSource) {
  function isRequireCall(node) {
    return node
      && node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'
      && node.arguments.length > 0
      && isModuleSource(stringLiteralValue(node.arguments[0]));
  }

  function isDynamicImportOfSource(node) {
    const source = importCallSourceNode(node);
    return !!source && isModuleSource(stringLiteralValue(source));
  }

  function isSourceModuleExpression(node) {
    node = unwrapExpression(node);
    return isRequireCall(node) || isDynamicImportOfSource(node);
  }

  function sourceExpressionKind(node) {
    node = unwrapExpression(node);
    if (isRequireCall(node)) return 'inline-require';
    if (isDynamicImportCall(node)) return 'dynamic-import';
    return 'source-expression';
  }

  return {
    isRequireCall,
    isDynamicImportOfSource,
    isSourceModuleExpression,
    sourceExpressionKind,
  };
}

module.exports = {
  PARSER_PLUGINS,
  SKIP_AST_KEYS,
  parseModule,
  walkAst,
  propName,
  bindingNames,
  memberObjectAndProperty,
  stringLiteralValue,
  unwrapExpression,
  importCallSourceNode,
  isDynamicImportCall,
  isUnresolvedDynamicImportCall,
  addAlias,
  nodeLine,
  buildParentMap,
  isMember,
  isCall,
  isFunctionNode,
  isCalleeOfCall,
  isExpressionWrapper,
  climbExpressionWrappers,
  isWithin,
  isModuleExportsMember,
  isCommonJsExportTarget,
  isInsideCommonJsExportRight,
  isInsideExportAliasSyntax,
  isPropertyKeyIdentifier,
  isBindingIdentifier,
  isExportedVariableDeclarator,
  toRel,
  createSourceRecognizers,
};
