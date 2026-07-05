#!/usr/bin/env node
/**
 * Stage 3 import-boundary law (docs/BYPASS_STRIP_PLAN.md Stage 3).
 *
 * After the S333 bypass-strip mechanical conversion (Stages 1-2), the ONLY
 * sanctioned importer of `bypassDynamicsRestrictions` in application code is
 * `lib/dataverse/core/context.js` (the `withDalContext` wrapper). This gate
 * prevents a direct bypass import/call from reappearing, and closes the two
 * evasion holes the plan's adversarial review found: an empty/unresolvable
 * `restrictions` array passed to `withDynamicsContext` (functionally
 * identical bypass, `lib/services/dynamics-context.js:67-76`), and the
 * SCRIPT-ONLY `enterDynamicsBypassForScript` persistent-context idiom
 * appearing outside `scripts/`.
 *
 * Scans `pages/`, `lib/`, `shared/`, `modules/` (never `scripts/` or
 * `tests/` — matching scripts/check-dataverse-access-layer.js SCAN_DIRS) and
 * fails on any of three shapes:
 *
 *   1. Any import/require/dynamic-import/re-export/inline-member-access of
 *      `bypassDynamicsRestrictions`, outside `lib/dataverse/core/context.js`.
 *      Detection keys on the IMPORTED/DESTRUCTURED NAME, not the resolved
 *      module source — only `lib/services/dynamics-context.js` exports a
 *      symbol with this name, so a non-literal/unresolvable require or
 *      import() source is caught for free (fail-closed) rather than needing
 *      separate source-resolution machinery. Namespace/member access
 *      (`ctx.bypassDynamicsRestrictions`) IS scoped to a literal-resolved
 *      dynamics-context source, since an arbitrary namespace object's
 *      `.bypassDynamicsRestrictions` property access is only meaningful when
 *      the namespace itself came from that module.
 *   2. Any `withDynamicsContext(...)` call whose `restrictions` property is
 *      a literal empty array (`[]`) — functionally identical bypass — or any
 *      other non-literal-array expression this gate cannot prove is
 *      non-empty (fail CLOSED), EXCEPT the sanctioned Explorer loaded-
 *      restrictions caller under `pages/api/dynamics-explorer/`
 *      (`chat.js:124`, restrictions from `getActiveRestrictions()`) —
 *      mirroring check-dataverse-access-layer.js's EXEMPT_DIRS precedent,
 *      for THIS rule only (the Explorer is not exempt from rules 1 or 3).
 *   3. Any import/require/dynamic-import/inline-member-access of
 *      `enterDynamicsBypassForScript` (its SCRIPT-ONLY contract,
 *      lib/services/dynamics-context.js:154-178) appearing in a scanned
 *      file — these dirs are never `scripts/`, so any occurrence at all is a
 *      violation. Comment-only mentions (e.g. core/context.js:59,
 *      dynamics-service.js:222) are AST-invisible and never trip this.
 *
 * `withDalContext` calls are always allowed. Direct LAW mode — the S333
 * mechanical strip already reduced the live census to 0, so there is no
 * ratchet/report period; this lands as fail-closed law immediately.
 */

const fs = require('fs');
const path = require('path');
const { walkTree } = require('./lib/walk-files');
const {
  parseModule,
  walkAst,
  propName,
  bindingNames,
  stringLiteralValue,
  unwrapExpression,
  importCallSourceNode,
  nodeLine,
  toRel,
} = require('./lib/ast-scan-core');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['pages', 'lib', 'shared', 'modules'];
const JS_EXT_RE = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/;
const EXCLUDE_DIR = /(^|\/)(node_modules|\.next)(\/|$)/;

// Rule 1's one sanctioned importer.
const BYPASS_SANCTIONED_FILE = 'lib/dataverse/core/context.js';
// Rule 2's sanctioned exemptions: the Explorer's loaded-restrictions caller
// (Decision 6), and dynamics-context.js itself — the canonical primitive
// (`bypassDynamicsRestrictions` = `withDynamicsContext({ restrictions: [] }, fn)`)
// necessarily contains the empty-restrictions shape this rule forbids
// everywhere else, mirroring check-odata-escape.js's own-primitive exemption.
const EXPLORER_EXEMPT_DIR = 'pages/api/dynamics-explorer/';
const DYNAMICS_CONTEXT_DEFINITION_FILE = 'lib/services/dynamics-context.js';

const BYPASS_NAME = 'bypassDynamicsRestrictions';
const SCRIPT_ONLY_NAME = 'enterDynamicsBypassForScript';
const DYNAMICS_CONTEXT_SOURCE_RE = /(?:^|\/)dynamics-context(?:\.js)?$/;

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root requires a directory');
      args.root = path.resolve(value);
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
    'Usage: node scripts/check-dynamics-context-boundary.js [--root <dir>] [--json]',
    '',
    'Fails on: (1) any bypassDynamicsRestrictions import/require/dynamic-import/',
    're-export/member-access outside lib/dataverse/core/context.js; (2) any',
    'withDynamicsContext(...) call whose restrictions is a literal empty array or',
    'any other non-empty-provable expression, outside the Explorer carve-out; (3) any',
    'enterDynamicsBypassForScript reference outside scripts/. withDalContext is',
    'always allowed. LAW mode: no ratchet, no allowlist.',
  ].join('\n');
}

function isRestrictionsRuleExemptRel(rel) {
  return rel.startsWith(EXPLORER_EXEMPT_DIR) || rel === DYNAMICS_CONTEXT_DEFINITION_FILE;
}

function collectFiles(root) {
  const files = [];
  for (const relDir of SCAN_DIRS) {
    const base = path.join(root, relDir);
    if (!fs.existsSync(base)) continue;
    walkTree(base, {
      repoRoot: root,
      shouldExcludeRel: (rel) => EXCLUDE_DIR.test(rel),
      onFile: (full) => {
        if (!JS_EXT_RE.test(full)) return;
        const rel = toRel(root, full);
        if (EXCLUDE_DIR.test(rel)) return;
        files.push(full);
      },
    });
  }
  return files.sort();
}

function makeViolation(rel, node, rule, detail) {
  return { file: rel, line: nodeLine(node), rule, detail };
}

// ─── Rule 1: bypassDynamicsRestrictions import boundary ───────────────────

function isDynamicsContextLiteralSource(node) {
  const source = unwrapExpression(node);
  if (!source) return false;
  if (source.type === 'CallExpression' && source.callee.type === 'Identifier' && source.callee.name === 'require') {
    return DYNAMICS_CONTEXT_SOURCE_RE.test(stringLiteralValue(source.arguments[0]) || '');
  }
  const importSource = importCallSourceNode(source);
  if (importSource) return DYNAMICS_CONTEXT_SOURCE_RE.test(stringLiteralValue(importSource) || '');
  return false;
}

function objectPatternBindsName(pattern, name) {
  if (!pattern || pattern.type !== 'ObjectPattern') return false;
  return (pattern.properties || []).some((prop) => (
    prop.type === 'ObjectProperty' && propName(prop.key) === name
  ));
}

function auditBypassImportBoundary(ast, rel, violations) {
  walkAst(ast, (node) => {
    // import { bypassDynamicsRestrictions [as alias] } from '<any source>'
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportSpecifier' && propName(spec.imported) === BYPASS_NAME) {
          violations.push(makeViolation(rel, spec, 'bypass-import', `import { ${BYPASS_NAME} } from '${node.source.value}'`));
        }
      }
      return;
    }

    // export { bypassDynamicsRestrictions [as alias] } from '<source>'
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ExportSpecifier' && propName(spec.local) === BYPASS_NAME) {
          violations.push(makeViolation(rel, spec, 'bypass-reexport', `export { ${BYPASS_NAME} } from '${node.source.value}'`));
        }
      }
      return;
    }

    // export * from '<dynamics-context source>' — namespace re-export; can only
    // be checked by literal source match (no specifier name to key on).
    if (node.type === 'ExportAllDeclaration' && node.source
      && DYNAMICS_CONTEXT_SOURCE_RE.test(node.source.value || '')) {
      violations.push(makeViolation(rel, node, 'bypass-reexport', `export * from '${node.source.value}'`));
      return;
    }

    // const { bypassDynamicsRestrictions } = require(...) | await import(...)
    if (node.type === 'VariableDeclarator' && node.init && objectPatternBindsName(node.id, BYPASS_NAME)) {
      const init = unwrapExpression(node.init);
      const isRequire = init && init.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'require';
      const isDynamicImport = !!importCallSourceNode(init);
      if (isRequire || isDynamicImport) {
        violations.push(makeViolation(rel, node.id, isRequire ? 'bypass-require' : 'bypass-dynamic-import',
          `destructures ${BYPASS_NAME} from ${isRequire ? 'require(...)' : 'import(...)'}`));
      }
      return;
    }

    // require(...).bypassDynamicsRestrictions(...) / import(...).then(m => m.bypassDynamicsRestrictions)
    // inline member access directly off a require/dynamic-import call — any source.
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
      && propName(node.property) === BYPASS_NAME) {
      const obj = unwrapExpression(node.object);
      const isRequire = obj && obj.type === 'CallExpression' && obj.callee.type === 'Identifier' && obj.callee.name === 'require';
      const isDynamicImport = !!importCallSourceNode(obj);
      if (isRequire || isDynamicImport) {
        violations.push(makeViolation(rel, node, 'bypass-inline-member', `${isRequire ? 'require(...)' : 'import(...)'}.${BYPASS_NAME}`));
        return;
      }
      // Namespace/member access: `ctx.bypassDynamicsRestrictions` where `ctx`
      // is a whole-module binding literal-resolved to the dynamics-context
      // source (import * as ctx / const ctx = require('...dynamics-context')).
      if (obj && obj.type === 'Identifier') {
        // resolved lazily below via the namespace-binding pass.
      }
    }
  });

  // Namespace bindings: `import * as X from '<dynamics-context>'` or
  // `const X = require('<dynamics-context>')` (whole-module reference, no
  // destructuring) — literal-source-scoped, then flag any `X.bypassDynamicsRestrictions`.
  const namespaceNames = new Set();
  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration' && DYNAMICS_CONTEXT_SOURCE_RE.test(node.source.value || '')) {
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportNamespaceSpecifier') namespaceNames.add(spec.local.name);
      }
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init
      && isDynamicsContextLiteralSource(node.init)) {
      namespaceNames.add(node.id.name);
    }
  });
  if (namespaceNames.size > 0) {
    walkAst(ast, (node) => {
      if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
        && node.object.type === 'Identifier'
        && namespaceNames.has(node.object.name)
        && propName(node.property) === BYPASS_NAME) {
        violations.push(makeViolation(rel, node, 'bypass-namespace-member', `${node.object.name}.${BYPASS_NAME}`));
      }
    });
  }
}

// ─── Rule 2: empty/unresolvable-restrictions withDynamicsContext ──────────

function restrictionsPropertyValue(objectExpr) {
  if (!objectExpr || objectExpr.type !== 'ObjectExpression') return { found: false };
  for (const prop of objectExpr.properties || []) {
    if (prop.type === 'ObjectProperty' && propName(prop.key) === 'restrictions') {
      return { found: true, value: prop.value };
    }
  }
  return { found: false };
}

function auditWithDynamicsContextRestrictions(ast, rel, violations, isExempt) {
  walkAst(ast, (node) => {
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
    if (node.callee.type !== 'Identifier' || node.callee.name !== 'withDynamicsContext') return;

    const firstArg = node.arguments && node.arguments[0];
    const { found, value } = restrictionsPropertyValue(unwrapExpression(firstArg));

    if (!found) {
      if (!isExempt) violations.push(makeViolation(rel, node, 'unresolved-restrictions', 'withDynamicsContext(...) — no literal restrictions property found'));
      return;
    }
    const resolved = unwrapExpression(value);
    if (resolved && resolved.type === 'ArrayExpression') {
      if ((resolved.elements || []).length === 0 && !isExempt) {
        violations.push(makeViolation(rel, node, 'empty-restrictions', 'withDynamicsContext({ restrictions: [] }, ...)'));
      }
      return; // non-empty literal array: legitimately restricted, always OK.
    }
    if (!isExempt) {
      violations.push(makeViolation(rel, node, 'unresolved-restrictions', 'withDynamicsContext(...) — non-literal restrictions expression'));
    }
  });
}

// ─── Rule 3: enterDynamicsBypassForScript outside scripts/ ────────────────

function auditScriptOnlyOutsideScripts(ast, rel, violations) {
  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportSpecifier' && propName(spec.imported) === SCRIPT_ONLY_NAME) {
          violations.push(makeViolation(rel, spec, 'script-only-outside-scripts', `import { ${SCRIPT_ONLY_NAME} }`));
        }
      }
      return;
    }
    if (node.type === 'VariableDeclarator' && node.init && objectPatternBindsName(node.id, SCRIPT_ONLY_NAME)) {
      violations.push(makeViolation(rel, node.id, 'script-only-outside-scripts', `destructures ${SCRIPT_ONLY_NAME}`));
      return;
    }
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
      && propName(node.property) === SCRIPT_ONLY_NAME) {
      violations.push(makeViolation(rel, node, 'script-only-outside-scripts', `*.${SCRIPT_ONLY_NAME}`));
    }
  });
}

// ─── Driver ─────────────────────────────────────────────────────────────

function analyzeFile(root, fullPath, violations) {
  const rel = toRel(root, fullPath);
  const source = fs.readFileSync(fullPath, 'utf8');
  let ast;
  try {
    ast = parseModule(source);
  } catch (err) {
    throw new Error(`dynamics-context-boundary parse error in ${rel}: ${err.message}`);
  }

  if (rel !== BYPASS_SANCTIONED_FILE) {
    auditBypassImportBoundary(ast, rel, violations);
  }
  auditWithDynamicsContextRestrictions(ast, rel, violations, isRestrictionsRuleExemptRel(rel));
  auditScriptOnlyOutsideScripts(ast, rel, violations);
}

function collectViolations(root = DEFAULT_ROOT) {
  const violations = [];
  const files = collectFiles(root);
  for (const file of files) analyzeFile(root, file, violations);
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { violations, fileCount: files.length };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const { violations, fileCount } = collectViolations(args.root);

  if (args.json) {
    console.log(JSON.stringify(violations, null, 2));
    return violations.length > 0 ? 1 : 0;
  }

  if (violations.length > 0) {
    console.error(`dynamics-context-boundary LAW VIOLATION (${violations.length}):`);
    for (const v of violations.slice(0, 50)) {
      console.error(`  + ${v.file}:${v.line} | ${v.rule} | ${v.detail}`);
    }
    if (violations.length > 50) console.error(`    ... ${violations.length - 50} more`);
    return 1;
  }

  console.log(`dynamics-context-boundary OK — ${fileCount} file(s) scanned; 0 violations.`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err.message || err);
    process.exit(2);
  }
}

module.exports = { collectViolations, collectFiles, main };
