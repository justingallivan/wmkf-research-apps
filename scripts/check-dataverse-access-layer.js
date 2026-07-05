#!/usr/bin/env node
/**
 * Stage-8 Dataverse data-access law gate.
 *
 * Scans application code for DynamicsService transport calls, including local
 * aliases and injectable clients that default to DynamicsService. Default mode
 * enforces the permanent law: every raw call identity found in pages/, lib/,
 * shared/ (outside the DAL internals and the exempt power tools) must resolve
 * to entity 'non-entity-transport' — the plan's permanent DynamicsService
 * surface (createAndSendEmail, addEmailAttachment, createEmailActivity,
 * logAiRun). Anything else (an entity-attributed call, an unresolved alias, an
 * unresolved changeset operation, or a call to a method this script does not
 * recognize at all) fails the gate. There is no allowlist file and no count
 * ratchet anymore — Stage 8 deleted both; the law is unconditional.
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['pages', 'lib', 'shared'];
const JS_EXT_RE = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/;

const EXEMPT_FILES = new Set([
  'pages/dynamics-explorer.js',
  'pages/dataverse-bulk-export.js',
  'lib/services/dynamics-service.js',
  // Explorer power-tool helper: sole importer is pages/api/dynamics-explorer/chat.js
  // (exempt dir); its one raw call is a resolveLogicalName metadata lookup (S329 tail 3).
  'lib/services/dynamics-explorer-taxonomy.js',
]);

const EXEMPT_DIRS = [
  'pages/api/dynamics-explorer/',
  'pages/api/dataverse-export/',
  'lib/services/dataverse-export/',
  'lib/dataverse/core/',
  'lib/dataverse/adapters/',
];

const ENTITY_ARG_METHODS = new Set([
  'queryRecords',
  'getRecord',
  'countRecords',
  'aggregateRecords',
  'queryAllRecords',
  'createRecord',
  'updateRecord',
  'updateIfEmpty',
  'deleteRecord',
  'disassociate',
  'getEntityAttributes',
  'getEntityRelationships',
  'resolveLogicalName',
  'resolveEntitySetName',
  'getPrimaryIdAttribute',
  'getEntityKey',
]);

// The plan's permanent DynamicsService surface (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
// "Permanent exemptions" + Appendix A's non-entity-transport bucket). This is a CLOSED
// list of method names, not "anything not in ENTITY_ARG_METHODS": a future DynamicsService
// method this script has never seen must fail closed (see resolveEntityForCall) rather than
// silently default to non-entity-transport just because nobody taught the census its name.
const NON_ENTITY_TRANSPORT_METHODS = new Set([
  'createAndSendEmail',
  'addEmailAttachment',
  'createEmailActivity',
  'logAiRun',
]);

const LOGICAL_TO_ENTITY_SET = {
  akoya_request: 'akoya_requests',
  akoya_concept: 'akoya_concepts',
  akoya_requestpayment: 'akoya_requestpayments',
  contact: 'contacts',
  account: 'accounts',
  email: 'emails',
  annotation: 'annotations',
  akoya_program: 'akoya_programs',
  akoya_phase: 'akoya_phases',
  akoya_goapplystatustracking: 'akoya_goapplystatustrackings',
  activitypointer: 'activitypointers',
  wmkf_potentialreviewers: 'wmkf_potentialreviewerses',
  wmkf_donors: 'wmkf_donorses',
  wmkf_bbstatus: 'wmkf_bbstatuses',
  wmkf_grantprogram: 'wmkf_grantprograms',
  wmkf_type: 'wmkf_types',
  wmkf_supporttype: 'wmkf_supporttypes',
  wmkf_programlevel2: 'wmkf_programlevel2s',
  wmkf_granteedeliverable: 'wmkf_granteedeliverables',
  systemuser: 'systemusers',
  sharepointdocumentlocation: 'sharepointdocumentlocations',
  wmkf_appreviewanswer: 'wmkf_appreviewanswers',
  wmkf_appreviewersuggestion: 'wmkf_appreviewersuggestions',
  wmkf_appreviewquestion: 'wmkf_appreviewquestions',
  wmkf_policy: 'wmkf_policies',
  wmkf_ai_prompt: 'wmkf_ai_prompts',
  wmkf_ai_run: 'wmkf_ai_runs',
};

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

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, report: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root requires a directory');
      args.root = path.resolve(value);
    } else if (arg === '--report') {
      args.report = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/check-dataverse-access-layer.js [--root <dir>] [--report] [--json]',
    '',
    'Default mode fails on any raw call identity whose entity is not non-entity-transport',
    '(the permanent DynamicsService surface: createAndSendEmail, addEmailAttachment,',
    'createEmailActivity, logAiRun). No allowlist file, no count ratchet -- this is the law.',
    '--report prints a per-entity rollup.',
    '--json prints the raw {file, entity, method, line, kind, clientMethod, callIdentity} entries.',
  ].join('\n');
}

function toRel(root, full) {
  return path.relative(root, full).split(path.sep).join('/');
}

function isExemptRel(rel) {
  if (EXEMPT_FILES.has(rel)) return true;
  return EXEMPT_DIRS.some((dir) => rel.startsWith(dir));
}

function collectFiles(root) {
  const files = [];
  for (const relDir of SCAN_DIRS) {
    const base = path.join(root, relDir);
    if (!fs.existsSync(base)) continue;
    walkDir(base);
  }
  return files.sort((a, b) => toRel(root, a).localeCompare(toRel(root, b)));

  function walkDir(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink && ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.next') continue;
        walkDir(full);
        continue;
      }
      if (!ent.isFile() || !JS_EXT_RE.test(ent.name)) continue;
      const rel = toRel(root, full);
      if (!isExemptRel(rel)) files.push(full);
    }
  }
}

function parseFile(source, rel) {
  try {
    return parser.parse(source, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['jsx', 'typescript', 'dynamicImport', 'importAttributes'],
    });
  } catch (err) {
    throw new Error(`Dataverse access census parse error in ${rel}: ${err.message}`);
  }
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

function isDynamicsModuleSource(value) {
  return typeof value === 'string' && /(?:^|\/)dynamics-service(?:\.js)?$/.test(value);
}

function isRequireCall(node) {
  return node
    && node.type === 'CallExpression'
    && node.callee.type === 'Identifier'
    && node.callee.name === 'require'
    && node.arguments.length > 0
    && isDynamicsModuleSource(stringLiteralValue(node.arguments[0]));
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

function addAlias(aliases, name, kind) {
  if (!name) return false;
  const prev = aliases.get(name);
  if (prev === kind) return false;
  if (prev && prev !== 'dynamic-client' && kind === 'dynamic-client') return false;
  aliases.set(name, prev || kind);
  return !prev;
}

function collectImportAndRequireAliases(ast) {
  const aliases = new Map();
  const namespaces = new Set();

  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration' && isDynamicsModuleSource(node.source && node.source.value)) {
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportSpecifier' && propName(spec.imported) === 'DynamicsService') {
          addAlias(aliases, spec.local.name, 'import');
        } else if (spec.type === 'ImportDefaultSpecifier') {
          addAlias(aliases, spec.local.name, 'default-import');
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          namespaces.add(spec.local.name);
        }
      }
    }

    if (node.type !== 'VariableDeclarator' || !node.init) return;
    const init = unwrapExpression(node.init);
    if (isRequireCall(init)) {
      if (node.id.type === 'ObjectPattern') {
        for (const prop of node.id.properties || []) {
          if (prop.type !== 'ObjectProperty') continue;
          if (propName(prop.key) === 'DynamicsService') {
            for (const name of bindingNames(prop.value)) addAlias(aliases, name, 'require');
          }
        }
      } else if (node.id.type === 'Identifier') {
        namespaces.add(node.id.name);
        if (node.id.name === 'DynamicsService') addAlias(aliases, node.id.name, 'require');
      }
      return;
    }

    if (init
      && (init.type === 'MemberExpression' || init.type === 'OptionalMemberExpression')
      && propName(init.property) === 'DynamicsService'
      && isRequireCall(unwrapExpression(init.object))
      && node.id.type === 'Identifier') {
      addAlias(aliases, node.id.name, 'require-member');
    }
  });

  if (aliases.has('DynamicsService') || namespaces.size > 0) {
    addAlias(aliases, 'DynamicsService', aliases.get('DynamicsService') || 'direct');
  }
  return { aliases, namespaces };
}

function isAliasLikeExpression(node, aliases, namespaces) {
  node = unwrapExpression(node);
  if (!node || typeof node.type !== 'string') return false;

  if (node.type === 'Identifier') return aliases.has(node.name) || node.name === 'DynamicsService';

  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    && propName(node.property) === 'DynamicsService'
    && node.object.type === 'Identifier'
    && namespaces.has(node.object.name)) {
    return true;
  }

  if (node.type === 'LogicalExpression') {
    return isAliasLikeExpression(node.left, aliases, namespaces)
      || isAliasLikeExpression(node.right, aliases, namespaces)
      || isDynamicClientExpression(node.left)
      || isDynamicClientExpression(node.right);
  }

  if (node.type === 'ConditionalExpression') {
    return isAliasLikeExpression(node.consequent, aliases, namespaces)
      || isAliasLikeExpression(node.alternate, aliases, namespaces)
      || isDynamicClientExpression(node.consequent)
      || isDynamicClientExpression(node.alternate);
  }

  return false;
}

function isDynamicClientExpression(node) {
  node = unwrapExpression(node);
  if (!node) return false;
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    && propName(node.property) === 'dynamics') {
    return true;
  }
  if (node.type === 'LogicalExpression' || node.type === 'ConditionalExpression') {
    return isDynamicClientExpression(node.left)
      || isDynamicClientExpression(node.right)
      || isDynamicClientExpression(node.test)
      || isDynamicClientExpression(node.consequent)
      || isDynamicClientExpression(node.alternate);
  }
  return false;
}

function inspectPatternAliases(pattern, aliases, namespaces) {
  let changed = false;
  if (!pattern) return changed;

  if (pattern.type === 'ObjectPattern') {
    for (const prop of pattern.properties || []) {
      if (prop.type === 'RestElement') {
        changed = inspectPatternAliases(prop.argument, aliases, namespaces) || changed;
        continue;
      }
      if (prop.type !== 'ObjectProperty') continue;
      const key = propName(prop.key);
      const value = prop.value;
      if (value.type === 'AssignmentPattern') {
        const kind = isAliasLikeExpression(value.right, aliases, namespaces)
          ? 'fallback-alias'
          : (key === 'dynamics' ? 'dynamic-client' : null);
        if (kind) {
          for (const name of bindingNames(value.left)) changed = addAlias(aliases, name, kind) || changed;
        }
        changed = inspectPatternAliases(value.left, aliases, namespaces) || changed;
      } else {
        if (key === 'dynamics') {
          for (const name of bindingNames(value)) changed = addAlias(aliases, name, 'dynamic-client') || changed;
        }
        changed = inspectPatternAliases(value, aliases, namespaces) || changed;
      }
    }
  } else if (pattern.type === 'AssignmentPattern') {
    if (isAliasLikeExpression(pattern.right, aliases, namespaces)) {
      for (const name of bindingNames(pattern.left)) changed = addAlias(aliases, name, 'fallback-alias') || changed;
    }
    changed = inspectPatternAliases(pattern.left, aliases, namespaces) || changed;
  } else if (pattern.type === 'ArrayPattern') {
    for (const item of pattern.elements || []) changed = inspectPatternAliases(item, aliases, namespaces) || changed;
  }

  return changed;
}

function collectAllAliases(ast) {
  const { aliases, namespaces } = collectImportAndRequireAliases(ast);
  let changed = true;
  while (changed) {
    changed = false;
    walkAst(ast, (node) => {
      if (node.type === 'VariableDeclarator') {
        changed = inspectPatternAliases(node.id, aliases, namespaces) || changed;
        if (node.id.type === 'Identifier' && node.init) {
          if (isAliasLikeExpression(node.init, aliases, namespaces)) {
            changed = addAlias(aliases, node.id.name, isDynamicClientExpression(node.init) ? 'fallback-alias' : 'alias') || changed;
          } else if (isDynamicClientExpression(node.init)) {
            changed = addAlias(aliases, node.id.name, 'dynamic-client') || changed;
          }
        }
      } else if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
        if (isAliasLikeExpression(node.right, aliases, namespaces)) {
          changed = addAlias(aliases, node.left.name, isDynamicClientExpression(node.right) ? 'fallback-alias' : 'alias') || changed;
        } else if (isDynamicClientExpression(node.right)) {
          changed = addAlias(aliases, node.left.name, 'dynamic-client') || changed;
        }
      } else if (node.type === 'FunctionDeclaration'
        || node.type === 'FunctionExpression'
        || node.type === 'ArrowFunctionExpression'
        || node.type === 'ObjectMethod'
        || node.type === 'ClassMethod') {
        for (const param of node.params || []) {
          changed = inspectPatternAliases(param, aliases, namespaces) || changed;
        }
      }
    });
  }
  return { aliases, namespaces };
}

function collectStringBindings(ast) {
  const stringNodes = new Map();
  const objectNodes = new Map();
  const entitySetHints = new Map();

  walkAst(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !node.init) return;
    const init = unwrapExpression(node.init);
    if (!init) return;
    if (init.type === 'ObjectExpression') {
      const props = new Map();
      for (const prop of init.properties || []) {
        if (prop.type !== 'ObjectProperty') continue;
        const key = propName(prop.key);
        if (key) props.set(key, prop.value);
      }
      objectNodes.set(node.id.name, props);
    } else {
      stringNodes.set(node.id.name, init);
      const hinted = resolveEntitySetNameInitializer(init);
      if (hinted) entitySetHints.set(node.id.name, hinted);
    }
  });

  return { stringNodes, objectNodes, entitySetHints };
}

function resolveEntitySetNameInitializer(node) {
  node = unwrapExpression(node);
  if (!node || (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression')) return null;
  const callee = memberObjectAndProperty(node.callee);
  if (!callee || callee.property !== 'resolveEntitySetName') return null;
  const value = stringLiteralValue(unwrapExpression(node.arguments[0]));
  return value ? logicalToEntitySet(value) : null;
}

function logicalToEntitySet(value) {
  if (!value) return value;
  if (LOGICAL_TO_ENTITY_SET[value]) return LOGICAL_TO_ENTITY_SET[value];
  if (Object.values(LOGICAL_TO_ENTITY_SET).includes(value)) return value;
  return value;
}

function resolveString(node, ctx, seen = new Set()) {
  node = unwrapExpression(node);
  if (!node || typeof node.type !== 'string' || seen.has(node)) return null;
  seen.add(node);

  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral') {
    let out = '';
    for (let i = 0; i < node.quasis.length; i++) {
      out += node.quasis[i].value.cooked ?? node.quasis[i].value.raw;
      if (i < node.expressions.length) {
        const part = resolveString(node.expressions[i], ctx, seen);
        if (part == null) return null;
        out += part;
      }
    }
    return out;
  }
  if (node.type === 'Identifier') {
    if (ctx.entitySetHints && ctx.entitySetHints.has(node.name)) return ctx.entitySetHints.get(node.name);
    const bound = ctx.stringNodes.get(node.name);
    return bound ? resolveString(bound, ctx, seen) : null;
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    if (node.object.type === 'Identifier') {
      const props = ctx.objectNodes.get(node.object.name);
      const key = propName(node.property);
      if (props && key && props.has(key)) return resolveString(props.get(key), ctx, seen);
    }
    return null;
  }
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const callee = memberObjectAndProperty(node.callee);
    if (callee && callee.property === 'resolveEntitySetName' && isDynamicsObject(callee.object, ctx)) {
      const value = resolveString(node.arguments[0], ctx, seen);
      return value ? logicalToEntitySet(value) : null;
    }
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = resolveString(node.left, ctx, seen);
    const right = resolveString(node.right, ctx, seen);
    return left != null && right != null ? `${left}${right}` : null;
  }
  return null;
}

function isDynamicsObject(node, ctx) {
  node = unwrapExpression(node);
  if (!node) return null;
  if (node.type === 'Identifier' && ctx.aliases.has(node.name)) {
    return { client: node.name, kind: ctx.aliases.get(node.name) };
  }
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    && propName(node.property) === 'DynamicsService'
    && node.object.type === 'Identifier'
    && ctx.namespaces.has(node.object.name)) {
    return { client: `${node.object.name}.DynamicsService`, kind: 'namespace' };
  }
  return null;
}

function callbackReturnObject(fn) {
  if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return null;
  if (fn.body.type === 'ObjectExpression') return fn.body;
  if (fn.body.type === 'BlockStatement') {
    for (const stmt of fn.body.body || []) {
      if (stmt.type === 'ReturnStatement' && stmt.argument && stmt.argument.type === 'ObjectExpression') return stmt.argument;
    }
  }
  return null;
}

function operationObjectsFromExpression(node) {
  node = unwrapExpression(node);
  if (!node) return { ops: [], unresolved: true };
  if (node.type === 'ArrayExpression') {
    const ops = [];
    let unresolved = false;
    for (const element of node.elements || []) {
      if (!element) continue;
      const value = element.type === 'SpreadElement' ? element.argument : element;
      if (value.type === 'ObjectExpression') ops.push(value);
      else unresolved = true;
    }
    return { ops, unresolved };
  }
  if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression')
    && node.callee
    && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')
    && propName(node.callee.property) === 'map') {
    const obj = callbackReturnObject(node.arguments[0]);
    return obj ? { ops: [obj], unresolved: false } : { ops: [], unresolved: true };
  }
  return { ops: [], unresolved: true };
}

function collectOperationBindings(ast) {
  const bindings = new Map();

  walkAst(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !node.init) return;
    const { ops, unresolved } = operationObjectsFromExpression(node.init);
    if (ops.length || (unwrapExpression(node.init) || {}).type === 'ArrayExpression') {
      bindings.set(node.id.name, { ops: [...ops], unresolved });
    }
  });

  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
    const callee = memberObjectAndProperty(node.callee);
    if (!callee || callee.property !== 'push' || callee.object.type !== 'Identifier') return;
    const name = callee.object.name;
    if (!bindings.has(name)) bindings.set(name, { ops: [], unresolved: false });
    const binding = bindings.get(name);
    for (const arg of node.arguments || []) {
      if (arg.type === 'ObjectExpression') binding.ops.push(arg);
      else binding.unresolved = true;
    }
  });

  return bindings;
}

function objectPropertyValue(objectNode, key) {
  if (!objectNode || objectNode.type !== 'ObjectExpression') return null;
  for (const prop of objectNode.properties || []) {
    if (prop.type === 'ObjectProperty' && propName(prop.key) === key) return prop.value;
  }
  return null;
}

function parseEntityFromUrlText(text) {
  if (!text) return null;
  const cleaned = text.trim().replace(/^['"]|['"]$/g, '');
  const apiMatch = cleaned.match(/\/api\/data\/v[\d.]+\/([A-Za-z0-9_]+)(?:\(|\/|\?|$)/);
  if (apiMatch) return apiMatch[1];
  const relativeMatch = cleaned.match(/^\/?([A-Za-z0-9_]+)(?:\(|\/|\?|$)/);
  return relativeMatch ? relativeMatch[1] : null;
}

function parseEntityFromUrlExpression(node, ctx) {
  node = unwrapExpression(node);
  if (!node) return null;

  const resolved = resolveString(node, ctx);
  if (resolved) return parseEntityFromUrlText(resolved);

  if (node.type === 'TemplateLiteral') {
    const firstQuasi = node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw ?? '';
    const literalEntity = parseEntityFromUrlText(firstQuasi);
    if (literalEntity) return literalEntity;
    if (firstQuasi === '' || firstQuasi === '/') {
      const firstExpr = node.expressions[0];
      const firstValue = resolveString(firstExpr, ctx);
      const nextQuasi = node.quasis[1]?.value?.cooked ?? node.quasis[1]?.value?.raw ?? '';
      if (firstValue && /^[(/?]/.test(nextQuasi)) return firstValue;
    }
  }

  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const firstArg = node.arguments && node.arguments[0];
    const value = resolveString(firstArg, ctx);
    if (value) return value;
  }

  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = parseEntityFromUrlExpression(node.left, ctx);
    if (left) return left;
  }

  return null;
}

function resolveOperations(node, ctx) {
  node = unwrapExpression(node);
  if (!node) return { ops: [], unresolved: true };
  if (node.type === 'Identifier' && ctx.operationBindings.has(node.name)) {
    return ctx.operationBindings.get(node.name);
  }
  if (node.type === 'ArrayExpression' || node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    return operationObjectsFromExpression(node);
  }
  return { ops: [], unresolved: true };
}

function resolveEntityForCall(method, args, ctx) {
  if (ENTITY_ARG_METHODS.has(method)) {
    const value = resolveString(args[0], ctx);
    return value ? logicalToEntitySet(value) : 'unresolved';
  }
  if (NON_ENTITY_TRANSPORT_METHODS.has(method)) return 'non-entity-transport';
  // A method name this census has never classified. Fail closed instead of
  // defaulting to non-entity-transport: an unrecognized method could be a new
  // entity-taking DynamicsService API the census hasn't been taught yet.
  return `unknown-method:${method}`;
}

function makeIdentity({ rel, line, client, kind, method, entity, suffix }) {
  const base = `${rel}:${line}:${kind}:${client}.${method}`;
  return suffix ? `${base}:${suffix}:${entity}` : `${base}:${entity}`;
}

function makeEntry({ rel, entity, method, line, client, kind, comparisonKind, suffix }) {
  return {
    file: rel,
    entity,
    method,
    line,
    kind: comparisonKind || kind,
    clientMethod: `${client}.${method}`,
    callIdentity: makeIdentity({
      rel,
      line,
      client,
      kind,
      method,
      entity,
      suffix,
    }),
  };
}

function analyzeFile(root, fullPath) {
  const rel = toRel(root, fullPath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const ast = parseFile(source, rel);
  const { aliases, namespaces } = collectAllAliases(ast);
  const stringCtx = collectStringBindings(ast);
  const operationBindings = collectOperationBindings(ast);
  const ctx = { ...stringCtx, aliases, namespaces, operationBindings };
  const entries = [];

  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
    const callee = memberObjectAndProperty(node.callee);
    if (!callee) return;
    const dyn = isDynamicsObject(callee.object, ctx);
    if (!dyn) return;

    const method = callee.property;
    const line = node.loc && node.loc.start ? node.loc.start.line : 0;

    if (method === 'executeChangeset') {
      const { ops, unresolved } = resolveOperations(node.arguments[0], ctx);
      let emitted = false;
      ops.forEach((op, index) => {
        const urlNode = objectPropertyValue(op, 'url');
        const operationMethod = resolveString(objectPropertyValue(op, 'method'), ctx) || 'operation';
        const entity = parseEntityFromUrlExpression(urlNode, ctx) || 'changeset-unresolved';
        entries.push(makeEntry({
          rel,
          entity,
          method,
          line,
          client: dyn.client,
          kind: dyn.kind,
          comparisonKind: `${dyn.kind}:changeset-op:${operationMethod}`,
          suffix: `op${index + 1}:${operationMethod}`,
        }));
        emitted = true;
      });
      if (!emitted || unresolved) {
        const entity = 'changeset-unresolved';
        entries.push(makeEntry({
          rel,
          entity,
          method,
          line,
          client: dyn.client,
          kind: dyn.kind,
          comparisonKind: `${dyn.kind}:changeset-unresolved`,
          suffix: 'unresolved',
        }));
      }
      return;
    }

    const entity = resolveEntityForCall(method, node.arguments || [], ctx);
    entries.push(makeEntry({
      rel,
      entity,
      method,
      line,
      client: dyn.client,
      kind: dyn.kind,
    }));
  });

  return entries;
}

function collectCensus(root = DEFAULT_ROOT) {
  const entries = [];
  for (const file of collectFiles(root)) entries.push(...analyzeFile(root, file));
  return entries.sort((a, b) => (
    a.file.localeCompare(b.file)
    || a.line - b.line
    || a.method.localeCompare(b.method)
    || a.entity.localeCompare(b.entity)
    || a.callIdentity.localeCompare(b.callIdentity)
  ));
}

function buildRollup(entries) {
  const byEntity = new Map();
  for (const entry of entries) {
    if (!byEntity.has(entry.entity)) {
      byEntity.set(entry.entity, { entity: entry.entity, calls: 0, files: new Set(), methods: new Map() });
    }
    const row = byEntity.get(entry.entity);
    row.calls++;
    row.files.add(entry.file);
    row.methods.set(entry.method, (row.methods.get(entry.method) || 0) + 1);
  }
  return [...byEntity.values()]
    .map((row) => ({
      entity: row.entity,
      calls: row.calls,
      files: row.files.size,
      methods: [...row.methods.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([method, count]) => `${method}:${count}`)
        .join(', '),
    }))
    .sort((a, b) => b.calls - a.calls || a.entity.localeCompare(b.entity));
}

function formatReport(entries) {
  const rollup = buildRollup(entries);
  const files = new Set(entries.map((e) => e.file));
  const lines = [
    'Dataverse access census',
    `Total call identities: ${entries.length}`,
    `Caller files: ${files.size}`,
    `Entity buckets: ${rollup.length}`,
    '',
    '| Entity | Calls | Files | Methods |',
    '|---|---:|---:|---|',
  ];
  for (const row of rollup) {
    lines.push(`| ${row.entity} | ${row.calls} | ${row.files} | ${row.methods} |`);
  }
  return lines.join('\n');
}

function formatViolationRow(entry) {
  return `${entry.file}:${entry.line} | ${entry.kind} | ${entry.clientMethod} | ${entry.entity}`;
}

function sortViolations(rows) {
  return rows.sort((a, b) => (
    a.file.localeCompare(b.file)
    || a.line - b.line
    || a.clientMethod.localeCompare(b.clientMethod)
    || a.entity.localeCompare(b.entity)
  ));
}

// Stage 8 law: every raw call identity found by the census must be
// non-entity-transport (the plan's permanent DynamicsService surface). Any
// entity-attributed call, any unresolved alias/changeset call, and any call to
// a method name this script does not recognize (see resolveEntityForCall) are
// all violations -- there is no allowlist and no count ratchet left to exempt
// them file-by-file.
function checkLaw(entries) {
  const violations = sortViolations(entries.filter((entry) => entry.entity !== 'non-entity-transport'));
  if (violations.length === 0) return 0;

  console.error('dataverse-access-layer LAW VIOLATION:');
  console.error(`  raw transport use outside the permanent non-entity-transport surface (${violations.length}):`);
  for (const row of violations.slice(0, 50)) {
    console.error(`    + ${formatViolationRow(row)}`);
  }
  if (violations.length > 50) console.error(`    ... ${violations.length - 50} more`);
  return 1;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const entries = collectCensus(args.root);
  if (args.json) {
    console.log(JSON.stringify(entries, null, 2));
  }
  if (args.report) {
    console.log(formatReport(entries));
  }
  if (args.report || args.json) return 0;
  return checkLaw(entries);
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err.message || err);
    process.exit(2);
  }
}

module.exports = {
  collectCensus,
  buildRollup,
  checkLaw,
  formatReport,
  parseEntityFromUrlText,
};
