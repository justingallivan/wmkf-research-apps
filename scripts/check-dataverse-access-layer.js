#!/usr/bin/env node
/**
 * Stage-8 Dataverse data-access law gate.
 *
 * Scans application code for DynamicsService transport calls, including local
 * aliases and injectable clients that default to DynamicsService. Default mode
 * enforces the permanent law: every raw call identity found in pages/, lib/,
 * shared/, or modules/ (outside the DAL internals and the exempt power tools)
 * must resolve to entity 'non-entity-transport' — the plan's permanent
 * DynamicsService surface (createAndSendEmail, addEmailAttachment,
 * createEmailActivity, logAiRun). Anything else (an entity-attributed call, an
 * unresolved alias, an unresolved changeset operation, an unattributable alias
 * use, or a call to a method this script does not recognize at all) fails the
 * gate. There is no allowlist file and no count ratchet anymore — Stage 8
 * deleted both; the law is unconditional.
 */

const fs = require('fs');
const path = require('path');
const {
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
} = require('./lib/ast-scan-core');

// Source-family recognizers bound to the dynamics-service module matcher.
// Single-node arity preserves every existing call site below.
const {
  isRequireCall,
  isDynamicImportOfSource: isDynamicsDynamicImportCall,
  isSourceModuleExpression: isDynamicsSourceModuleExpression,
  sourceExpressionKind,
} = createSourceRecognizers(isDynamicsModuleSource);

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['pages', 'lib', 'shared', 'modules'];
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
  // DynamicsService decomposition (S338 Stage 0): the extracted submodules
  // legitimately contain Dataverse transport primitives; they are the DAL
  // internals now, same status as lib/dataverse/core/. Files here import each
  // other freely. Non-exempt importers of this directory are caught below by
  // auditDynamicsSubmoduleImports (source-based, fail-closed).
  'lib/services/dynamics/',
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
    return parseModule(source);
  } catch (err) {
    throw new Error(`Dataverse access census parse error in ${rel}: ${err.message}`);
  }
}

function isDynamicsModuleSource(value) {
  return typeof value === 'string' && /(?:^|\/)dynamics-service(?:\.js)?$/.test(value);
}

// S338 Stage 0 (Q4/C5): decomposition submodule directory. Source-string match
// only — deliberately NOT alias-gated like isDynamicsModuleSource above, so it
// catches every import shape (named, namespace, default, require, dynamic
// import, re-export) regardless of what binding name the importer chooses.
// A bare `import { createRecord } from '.../dynamics/write-core.js'` would
// register no alias under collectImportAndRequireAliases and would otherwise
// slip the census entirely; this predicate + auditDynamicsSubmoduleImports
// below is the fail-closed backstop for that hole.
// Resolution-based submodule matcher (S338 Q4/C5, Lead directive). The raw AST
// source specifier only MEANS a module location after resolution against the
// importer's directory — matching the unresolved string fails for the relative
// forms a non-exempt lib/services sibling would actually write
// (`import { x } from './dynamics/http.js'`). So:
//   - LOCAL specifier (starts with '.'): pure path-math resolve to a repo-rel
//     POSIX path (no disk access, so self-test fixtures resolve too), then flag
//     if it is exactly lib/services/dynamics or under it.
//   - NON-relative (bare / root-relative): keep the literal-substring test as a
//     fallback covering any root-relative form.
// `root` is the scan root; `rel` is the importing file's repo-relative path.
function isDynamicsSubmoduleTarget(source, root, rel) {
  if (typeof source !== 'string' || source.length === 0) return false;
  if (source.startsWith('.')) {
    const importerDir = path.dirname(path.join(root, rel));
    const resolved = path.relative(root, path.resolve(importerDir, source))
      .split(path.sep)
      .join('/');
    return resolved === 'lib/services/dynamics' || resolved.startsWith('lib/services/dynamics/');
  }
  return /(?:^|\/)lib\/services\/dynamics\//.test(source);
}

// Resolve a require()/dynamic-import() source ARGUMENT node to a target path,
// then test it. The value is the AST node; its meaning as a module path is only
// recoverable through the gate's string-resolution (resolveString handles
// const-bound identifiers and '+'-concatenation) or, for a template literal
// whose interpolation is opaque, via the STATIC leading quasi (the directory
// lives in the prefix even when the filename is dynamic). Fully-opaque sources
// (bare `require(pathVar)` with no resolvable binding, a function-call source,
// or a template with an opaque leading segment) resolve to null and are left
// UNFLAGGED — flagging every dynamic import repo-wide would false-positive on
// legitimate Next.js lazy-loading; the runtime assertTrustedDalContext backstops
// writes on that accepted residual tail.
function matchesDynamicSource(argNode, ctx, root, rel) {
  const resolved = resolveString(argNode, ctx);
  if (typeof resolved === 'string' && resolved.length > 0) {
    return isDynamicsSubmoduleTarget(resolved, root, rel);
  }
  const tpl = unwrapExpression(argNode);
  if (tpl && tpl.type === 'TemplateLiteral' && tpl.quasis.length > 0) {
    const prefix = tpl.quasis[0].value.cooked ?? tpl.quasis[0].value.raw ?? '';
    if (prefix.length > 0) return isDynamicsSubmoduleTarget(prefix, root, rel);
  }
  return false;
}

// Fail-closed audit (S338 Q4/C5): flags ANY non-exempt file's import of
// lib/services/dynamics/* regardless of specifier/binding shape OR specifier
// form (relative vs root-relative). Exempt files/dirs (EXEMPT_FILES/EXEMPT_DIRS,
// including the new lib/services/dynamics/ dir itself) never reach analyzeFile,
// so this only ever fires for genuinely non-exempt importers — see
// collectFiles/isExemptRel. Entity is a distinct string (never
// 'non-entity-transport'), so the violations filter in report()
// (entity !== 'non-entity-transport') always flags it — no allowlist path.
function auditDynamicsSubmoduleImports(ast, ctx, root, rel, entries) {
  const emitted = new WeakSet();
  const emit = (node) => {
    emitOnce(entries, emitted, makeEntry({
      rel,
      entity: 'dynamics-submodule-import',
      method: 'import',
      line: nodeLine(node),
      client: 'lib/services/dynamics',
      kind: 'dynamics-submodule-import',
    }), node);
  };
  // Static ESM import/export-from sources are always StringLiterals (template
  // literals aren't legal there), so a literal-string test is complete for them.
  const matchesStatic = (source) => isDynamicsSubmoduleTarget(source, root, rel);

  walkAst(ast, (node) => {
    // import ... from './dynamics/x.js' — named, default, and namespace
    // specifiers are all covered by matching the (resolved) source, not the
    // specifier shape.
    if (node.type === 'ImportDeclaration' && node.source && matchesStatic(node.source.value)) {
      emit(node);
      return;
    }

    // export { x } from '...' / export * from '...' (re-export)
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration')
      && node.source
      && matchesStatic(node.source.value)) {
      emit(node);
      return;
    }

    // require(<expr>) in any shape (destructure, bare, const-bound, concat,
    // template-prefix). NOTE: the file-scope isRequireCall is bound to the
    // dynamics-service source matcher, so it can't be reused here — detect a
    // require() call shape directly and let matchesDynamicSource (resolution +
    // template-prefix) do the targeting.
    if (node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'
      && node.arguments.length > 0
      && matchesDynamicSource(node.arguments[0], ctx, root, rel)) {
      emit(node);
      return;
    }

    // dynamic import(<expr>) — same resolution/template-prefix handling.
    const importSource = importCallSourceNode(node);
    if (importSource && matchesDynamicSource(importSource, ctx, root, rel)) {
      emit(node);
    }
  });
}

function isDynamicsServiceSourceMember(node) {
  node = unwrapExpression(node);
  return node
    && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    && propName(node.property) === 'DynamicsService'
    && isDynamicsSourceModuleExpression(node.object);
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
    if (isRequireCall(init) || isDynamicsDynamicImportCall(init)) {
      if (node.id.type === 'ObjectPattern') {
        for (const prop of node.id.properties || []) {
          if (prop.type !== 'ObjectProperty') continue;
          if (propName(prop.key) === 'DynamicsService') {
            for (const name of bindingNames(prop.value)) {
              addAlias(aliases, name, isRequireCall(init) ? 'require' : 'dynamic-import');
            }
          }
        }
      } else if (node.id.type === 'Identifier') {
        namespaces.add(node.id.name);
        if (node.id.name === 'DynamicsService') {
          addAlias(aliases, node.id.name, isRequireCall(init) ? 'require' : 'dynamic-import');
        }
      }
      return;
    }

    if (init
      && (init.type === 'MemberExpression' || init.type === 'OptionalMemberExpression')
      && propName(init.property) === 'DynamicsService'
      && isDynamicsSourceModuleExpression(init.object)
      && node.id.type === 'Identifier') {
      addAlias(aliases, node.id.name, isRequireCall(unwrapExpression(init.object)) ? 'require-member' : 'dynamic-import-member');
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

  if (isDynamicsServiceSourceMember(node)) return true;

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
  if (isDynamicsServiceSourceMember(node)) {
    const sourceKind = sourceExpressionKind(node.object);
    return {
      client: sourceKind === 'dynamic-import'
        ? 'import(...).DynamicsService'
        : 'require(...).DynamicsService',
      kind: sourceKind,
    };
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

function makeUnattributableEntry({ rel, node, client, nodeType }) {
  return makeEntry({
    rel,
    entity: `unattributable-use:${nodeType}`,
    method: nodeType,
    line: nodeLine(node),
    client: client || 'DynamicsService',
    kind: 'unattributable-use',
  });
}

function isAssignmentAliasTarget(node, parentMap, ctx) {
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'AssignmentExpression') {
      if (parent.left !== cur || isCommonJsExportTarget(parent.left)) return false;
      return isAliasLikeExpression(parent.right, ctx.aliases, ctx.namespaces)
        || isDynamicClientExpression(parent.right);
    }
    cur = parent;
  }
  return false;
}

function isSourceAliasDeclarator(declarator) {
  if (!declarator || declarator.type !== 'VariableDeclarator' || !declarator.init) return false;
  const init = unwrapExpression(declarator.init);
  if (isDynamicsSourceModuleExpression(init)) {
    return declarator.id.type === 'Identifier' || declarator.id.type === 'ObjectPattern';
  }
  if (isDynamicsServiceSourceMember(init)) return declarator.id.type === 'Identifier';
  return false;
}

function isSanctionedAliasDeclarator(declarator, ctx) {
  if (!declarator || declarator.type !== 'VariableDeclarator' || !declarator.init) return false;
  if (isSourceAliasDeclarator(declarator)) return true;
  if (declarator.id.type !== 'Identifier') return false;
  return isAliasLikeExpression(declarator.init, ctx.aliases, ctx.namespaces)
    || isDynamicClientExpression(declarator.init);
}

function isNonExportedAliasCreationReference(node, parentMap, ctx) {
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;

    if (parent.type === 'VariableDeclarator' && parent.init && isWithin(node, parent.init, parentMap)) {
      if (isExportedVariableDeclarator(parent, parentMap)) return false;
      return isSanctionedAliasDeclarator(parent, ctx);
    }

    if (parent.type === 'AssignmentExpression' && parent.right === cur) {
      if (isCommonJsExportTarget(parent.left)) return false;
      return parent.left.type === 'Identifier'
        && (isAliasLikeExpression(parent.right, ctx.aliases, ctx.namespaces)
          || isDynamicClientExpression(parent.right));
    }

    if (parent.type === 'AssignmentPattern' && parent.right === cur) {
      return isAliasLikeExpression(parent.right, ctx.aliases, ctx.namespaces)
        || isDynamicClientExpression(parent.right);
    }

    cur = parent;
  }
  return false;
}

function isDirectAliasCallReference(identifier, parentMap) {
  const parent = parentMap.get(identifier);
  return isMember(parent)
    && parent.object === identifier
    && !!propName(parent.property)
    && isCalleeOfCall(parent, parentMap);
}

function isDirectNamespaceCallReference(identifier, parentMap) {
  const serviceMember = parentMap.get(identifier);
  if (!isMember(serviceMember)
    || serviceMember.object !== identifier
    || propName(serviceMember.property) !== 'DynamicsService') {
    return false;
  }
  const methodMember = parentMap.get(serviceMember);
  return isMember(methodMember)
    && methodMember.object === serviceMember
    && !!propName(methodMember.property)
    && isCalleeOfCall(methodMember, parentMap);
}

function rootedMemberUseType(identifier, parentMap) {
  let cur = identifier;
  let parent = parentMap.get(cur);
  let rooted = null;
  while (isMember(parent) && parent.object === cur) {
    rooted = parent;
    cur = parent;
    parent = parentMap.get(cur);
  }
  return rooted ? rooted.type : identifier.type;
}

function patternMentionsDynamicsService(pattern) {
  if (!pattern) return false;
  if (pattern.type === 'Identifier') return pattern.name === 'DynamicsService';
  if (pattern.type === 'ObjectPattern') {
    return (pattern.properties || []).some((prop) => {
      if (prop.type === 'RestElement') return patternMentionsDynamicsService(prop.argument);
      return prop.type === 'ObjectProperty'
        && (propName(prop.key) === 'DynamicsService' || patternMentionsDynamicsService(prop.value));
    });
  }
  if (pattern.type === 'AssignmentPattern') return patternMentionsDynamicsService(pattern.left);
  if (pattern.type === 'RestElement') return patternMentionsDynamicsService(pattern.argument);
  if (pattern.type === 'ArrayPattern') return (pattern.elements || []).some(patternMentionsDynamicsService);
  return false;
}

function isUnresolvedDynamicImportSourceMember(node) {
  node = unwrapExpression(node);
  return node
    && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    && propName(node.property) === 'DynamicsService'
    && isUnresolvedDynamicImportCall(unwrapExpression(node.object));
}

function isUnresolvedDynamicImportDeclarator(declarator) {
  if (!declarator || declarator.type !== 'VariableDeclarator' || !declarator.init) return false;
  const init = unwrapExpression(declarator.init);
  if (isUnresolvedDynamicImportCall(init)) return patternMentionsDynamicsService(declarator.id);
  return isUnresolvedDynamicImportSourceMember(init);
}

function isSourceExpressionDirectCall(sourceNode, parentMap) {
  const sourceRoot = climbExpressionWrappers(sourceNode, parentMap);
  const serviceMember = parentMap.get(sourceRoot);
  if (!isMember(serviceMember)
    || serviceMember.object !== sourceRoot
    || propName(serviceMember.property) !== 'DynamicsService') {
    return false;
  }
  const methodMember = parentMap.get(serviceMember);
  return isMember(methodMember)
    && methodMember.object === serviceMember
    && !!propName(methodMember.property)
    && isCalleeOfCall(methodMember, parentMap);
}

function isSourceExpressionAliasCreation(sourceNode, parentMap) {
  let cur = sourceNode;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'VariableDeclarator' && parent.init && isWithin(sourceNode, parent.init, parentMap)) {
      return !isExportedVariableDeclarator(parent, parentMap) && isSourceAliasDeclarator(parent);
    }
    cur = parent;
  }
  return false;
}

function isUnresolvedDynamicImportRelevant(sourceNode, parentMap) {
  const sourceRoot = climbExpressionWrappers(sourceNode, parentMap);
  const serviceMember = parentMap.get(sourceRoot);
  if (isMember(serviceMember)
    && serviceMember.object === sourceRoot
    && propName(serviceMember.property) === 'DynamicsService') {
    return true;
  }

  let cur = sourceNode;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'VariableDeclarator' && parent.init && isWithin(sourceNode, parent.init, parentMap)) {
      return isUnresolvedDynamicImportDeclarator(parent);
    }
    cur = parent;
  }
  return false;
}

function expressionContainsRecognizedBinding(node, ctx) {
  let found = false;
  walkAst(node, (child, parent) => {
    if (found) return false;
    if (child.type === 'Identifier'
      && !isPropertyKeyIdentifier(child, parent)
      && (ctx.aliases.has(child.name) || ctx.namespaces.has(child.name))) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

function expressionContainsDynamicsSourceExpression(node) {
  let found = false;
  walkAst(node, (child) => {
    if (found) return false;
    if (isDynamicsSourceModuleExpression(child) || isDynamicsServiceSourceMember(child)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

function variableDeclarationExportsRecognizedBinding(declaration, ctx) {
  if (!declaration || declaration.type !== 'VariableDeclaration') return false;
  return (declaration.declarations || []).some((declarator) => (
    declarator.init
    && (isAliasLikeExpression(declarator.init, ctx.aliases, ctx.namespaces)
      || isDynamicClientExpression(declarator.init)
      || isDynamicsSourceModuleExpression(declarator.init)
      || isDynamicsServiceSourceMember(declarator.init))
  ));
}

function defaultExportExpressionIsRecognizedBinding(node, ctx) {
  const expression = unwrapExpression(node);
  if (!expression) return false;
  if (expression.type === 'Identifier') {
    return ctx.aliases.has(expression.name) || ctx.namespaces.has(expression.name);
  }
  if (expression.type === 'ObjectExpression' || expression.type === 'ArrayExpression') {
    return expressionContainsRecognizedBinding(expression, ctx)
      || expressionContainsDynamicsSourceExpression(expression);
  }
  return isAliasLikeExpression(expression, ctx.aliases, ctx.namespaces)
    || isDynamicClientExpression(expression)
    || isDynamicsSourceModuleExpression(expression)
    || isDynamicsServiceSourceMember(expression);
}

function emitOnce(entries, emitted, entry, node) {
  if (emitted.has(node)) return;
  emitted.add(node);
  entries.push(entry);
}

function auditExportAndReexportUse(node, parentMap, ctx, rel, entries, emitted) {
  if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration')
    && node.source
    && isDynamicsModuleSource(node.source.value)) {
    emitOnce(entries, emitted, makeUnattributableEntry({
      rel,
      node,
      client: 'export',
      nodeType: 'reexport-from-source',
    }), node);
    return;
  }

  if (node.type === 'ExportNamedDeclaration' && !node.source) {
    if (variableDeclarationExportsRecognizedBinding(node.declaration, ctx)) {
      emitOnce(entries, emitted, makeUnattributableEntry({
        rel,
        node,
        client: 'export',
        nodeType: 'export',
      }), node);
      return;
    }
    for (const spec of node.specifiers || []) {
      if (spec.type === 'ExportSpecifier'
        && spec.local
        && (ctx.aliases.has(spec.local.name) || ctx.namespaces.has(spec.local.name))) {
        emitOnce(entries, emitted, makeUnattributableEntry({
          rel,
          node: spec,
          client: spec.local.name,
          nodeType: 'export',
        }), spec);
      }
    }
    return;
  }

  if (node.type === 'ExportDefaultDeclaration'
    && node.declaration
    && defaultExportExpressionIsRecognizedBinding(node.declaration, ctx)) {
    emitOnce(entries, emitted, makeUnattributableEntry({
      rel,
      node,
      client: 'export',
      nodeType: expressionContainsDynamicsSourceExpression(node.declaration) ? 'reexport-from-source' : 'export',
    }), node);
    return;
  }

  if (node.type === 'AssignmentExpression' && isCommonJsExportTarget(node.left)) {
    if (expressionContainsDynamicsSourceExpression(node.right)) {
      emitOnce(entries, emitted, makeUnattributableEntry({
        rel,
        node,
        client: 'module.exports',
        nodeType: 'reexport-from-source',
      }), node);
      return;
    }
    if (expressionContainsRecognizedBinding(node.right, ctx)) {
      emitOnce(entries, emitted, makeUnattributableEntry({
        rel,
        node,
        client: 'module.exports',
        nodeType: 'export',
      }), node);
    }
  }
}

function auditSourceExpressionUse(node, parentMap, rel, entries, emitted) {
  if (!isRequireCall(node) && !isDynamicsDynamicImportCall(node) && !isUnresolvedDynamicImportCall(node)) return;

  if (isInsideCommonJsExportRight(node, parentMap)) return;

  if (isUnresolvedDynamicImportCall(node)) {
    if (!isUnresolvedDynamicImportRelevant(node, parentMap)) return;
    emitOnce(entries, emitted, makeUnattributableEntry({
      rel,
      node,
      client: 'import(...)',
      nodeType: 'dynamic-import',
    }), node);
    return;
  }

  if (isSourceExpressionDirectCall(node, parentMap) || isSourceExpressionAliasCreation(node, parentMap)) return;

  emitOnce(entries, emitted, makeUnattributableEntry({
    rel,
    node,
    client: isRequireCall(node) ? 'require(...)' : 'import(...)',
    nodeType: 'inline-require',
  }), node);
}

function auditRecognizedIdentifierUse(node, parent, parentMap, ctx, rel, entries, emitted) {
  if (node.type !== 'Identifier') return;
  const isAlias = ctx.aliases.has(node.name);
  const isNamespace = ctx.namespaces.has(node.name);
  if (!isAlias && !isNamespace) return;

  if (isPropertyKeyIdentifier(node, parent)
    || isBindingIdentifier(node, parentMap)
    || isAssignmentAliasTarget(node, parentMap, ctx)
    || isInsideExportAliasSyntax(node, parentMap)
    || isInsideCommonJsExportRight(node, parentMap)) {
    return;
  }

  if (isAlias && isDirectAliasCallReference(node, parentMap)) return;
  if (isNamespace && isDirectNamespaceCallReference(node, parentMap)) return;
  if (isNonExportedAliasCreationReference(node, parentMap, ctx)) return;

  emitOnce(entries, emitted, makeUnattributableEntry({
    rel,
    node,
    client: node.name,
    nodeType: rootedMemberUseType(node, parentMap),
  }), node);
}

function auditUnattributableUses(ast, ctx, rel, parentMap) {
  const entries = [];
  const emitted = new WeakSet();
  walkAst(ast, (node, parent) => {
    auditExportAndReexportUse(node, parentMap, ctx, rel, entries, emitted);
    auditSourceExpressionUse(node, parentMap, rel, entries, emitted);
    auditRecognizedIdentifierUse(node, parent, parentMap, ctx, rel, entries, emitted);
  });
  return entries;
}

function analyzeFile(root, fullPath) {
  const rel = toRel(root, fullPath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const ast = parseFile(source, rel);
  const { aliases, namespaces } = collectAllAliases(ast);
  const stringCtx = collectStringBindings(ast);
  const operationBindings = collectOperationBindings(ast);
  const ctx = { ...stringCtx, aliases, namespaces, operationBindings };
  const parentMap = buildParentMap(ast);
  const entries = [];

  entries.push(...auditUnattributableUses(ast, ctx, rel, parentMap));
  auditDynamicsSubmoduleImports(ast, ctx, root, rel, entries);

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
