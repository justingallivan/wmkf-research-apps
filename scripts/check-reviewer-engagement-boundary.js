#!/usr/bin/env node
/**
 * Reviewer Lifecycle Stage 7 boundary LAW gate.
 *
 * Stage 3 (3A-3K, docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md) moved every
 * production caller of the reviewer-suggestion adapter's four GENERIC
 * suggestion writers -- `updateLifecycle`, `patchFields` (alias of
 * `patchReviewReceipt`), `patchReviewReceipt`, `bulkUpdateByRequest` -- onto
 * named commands under `lib/services/reviewer-engagement/`, leaving exactly
 * two recorded receipt-sink callers outside that directory (Stage 5B skip
 * decision). Stage 7 makes that permanent law: any file under `lib/`,
 * `pages/`, `shared/` or `modules/` that BINDS one of the four generic
 * writers from `lib/dataverse/adapters/reviewer-suggestion` is a violation
 * unless it is (a) under `lib/services/reviewer-engagement/`, (b) the
 * adapter module itself, or (c) a tracked entry in RECORDED_IMPORTERS below.
 * `scripts/` is intentionally NOT scanned (D5: operational/backfill scripts
 * are recorded, not gated, in the build plan's Scripts census).
 *
 * "Binds" covers every form below, resolved through a MONOTONIC FIXPOINT (not
 * a fixed two-pass scan, so transitive chains of any length converge) built
 * on the import/require/dynamic-import source recognition and CJS/ESM export
 * detection shared with scripts/lib/ast-scan-core.js's other consumers; the
 * alias/method-extraction/barrel resolution itself is specific to this gate:
 *   - a named import/require-destructure of the writer directly;
 *   - a namespace import (or CJS whole-module require, or an awaited dynamic
 *     import()) of the adapter followed by a MEMBER ACCESS naming the writer
 *     (`suggestionAdapter.updateLifecycle(...)` -- the dominant call form in
 *     this repo);
 *   - a same-file ALIAS CHAIN of any length (`const a = adapter; const b = a;
 *     b.updateLifecycle(...)`) -- namespace and per-writer bindings both
 *     propagate across `const b = a` / `b = a` alias edges;
 *   - an EXTRACTED METHOD REFERENCE (`const u = adapter.updateLifecycle;
 *     u(...)`) OR a DESTRUCTURE off an object identifier (`const {
 *     updateLifecycle } = adapter`) -- either way `u`/`updateLifecycle`
 *     becomes a direct writer binding, including through a further alias;
 *   - a WHOLE-BARREL wrapper: `export * from '<adapter>'`, CJS
 *     `module.exports = require('<adapter>')`, or CJS spread `module.exports
 *     = { ...adapter }` (a shallow spread copies every property, including
 *     function references, so it is whole-namespace-equivalent here),
 *     transitively through another such barrel -- a file so marked
 *     (`fileIsNamespaceProxy`) is treated as an adapter source itself, so a
 *     NAMED import of a writer from it (not just a namespace import) is
 *     classified exactly like a named import from the adapter directly;
 *   - a NAMED one-hop re-export (`export { updateLifecycle } from
 *     '<adapter>'`) or CJS re-publish (`module.exports = { updateLifecycle }`
 *     / `exports.updateLifecycle = updateLifecycle`) through a wrapper,
 *     consumed by a named import/require of that wrapper -- and transitively,
 *     a wrapper-of-a-wrapper;
 *   - a COMPUTED member access on an adapter/alias/barrel namespace binding
 *     (`adapter['update' + 'Lifecycle']`, `adapter[name]`) fails CLOSED as an
 *     unresolvable-member violation UNLESS the computed key is a string
 *     literal that resolves to a name that is NOT one of the four writers
 *     (in which case it is simply not a writer binding at all);
 *   - a CLASS INSTANCE FIELD holding the adapter (`class X { adapter =
 *     require('<adapter>'); run() { return this.adapter.updateLifecycle(...);
 *     } }`, or the same field set via `this.field = require(...)`/an awaited
 *     dynamic import in the constructor) -- bound under a synthetic
 *     `this.<field>` key that flows through the SAME fixpoint a normal local
 *     does, including `const a = this.adapter; a.updateLifecycle()` and
 *     `helper(this.adapter).updateLifecycle()`. The key is FILE-scoped, not
 *     class-scoped: a second class in the same file with an unrelated
 *     `this.adapter` field is over-approximated as adapter-bound (documented
 *     limit; fails closed, never open);
 *   - a RENAMED member re-export -- `module.exports = { mutate:
 *     adapter.updateLifecycle }`, `exports.mutate = adapter.updateLifecycle`,
 *     or ESM `export const mutate = adapter.updateLifecycle;` -- publishes a
 *     writer under a NEW name, resolved the same way an extracted-method
 *     reference is (a virtual local method-bound to the writer, exported
 *     under the renamed key) so a consumer importing `mutate` is classified
 *     exactly like one importing `updateLifecycle` directly;
 *   - a DIRECT dynamic-import member access -- `(await
 *     import('<adapter>')).updateLifecycle(...)` (parenthesized/optional
 *     forms too) -- classified like a namespace member without needing an
 *     intermediate variable; a non-literal computed property on the result
 *     fails CLOSED, and a non-literal import SOURCE fails CLOSED only when the
 *     property is a writer name or itself non-literal (`(await
 *     import(p)).default` is the lazy-backend twin of a bare `require(p)` and
 *     stays green);
 *   - a GENERIC CATCH-ALL for any OTHER member-access object shape this gate
 *     does not otherwise resolve (e.g. a function call's return value): fails
 *     CLOSED, naming the file:line as an "unsupported adapter-bearing shape",
 *     ONLY when (a) the outer property this access itself names IS one of the
 *     four writers AND the object's subtree references an identifier (or a
 *     `this.<field>` key) this file's fixpoint resolved to an adapter/writer
 *     binding, OR (b) the outer property is NON-LITERAL and the object's
 *     subtree contains a literal adapter require()/import() ANYWHERE (a static
 *     non-writer property such as `require('<adapter>').findById(id)` is
 *     never recorded). A dynamic (non-literal) computed
 *     property on such an unresolvable object is NOT, by itself, sufficient --
 *     narrowed against a real false-positive class found in this repo
 *     (`suggestionAdapter.HONORARIUM_ELIGIBILITY_BY_VALUE[row.x]`: a
 *     dynamic-keyed lookup into a STATICALLY NAMED, definitely-not-a-writer
 *     sub-export of the adapter can never yield one of the four writers,
 *     regardless of the runtime key, so it is not recorded at all).
 * Non-literal require()/import() sources reachable in scope fail CLOSED ONLY
 * when they could plausibly be laundering a generic-writer binding -- a
 * destructure whose key names a writer directly off the require()/import()
 * call; a member access, an extracted-method reference, or a destructure-off-
 * an-identifier naming a writer off a local bound (whole) to such a source;
 * or that local re-published by identity (`module.exports = local`, or an
 * ESM/CJS named export of it) -- each of these ALSO fires through a same-file
 * ALIAS CHAIN of any length (`const a = require(p); const b = a;
 * b.updateLifecycle(...)`), not just the direct local. This is a DOCUMENTED
 * LIMIT, not a blanket rule: a bare non-literal require()/import() with no
 * writer-shaped use (the common "lazy backend" pattern -- a module-scope
 * local from an env-derived path, exporting only its OWN functions, e.g.
 * lib/services/settings-service.js, lib/dataverse/client.js) is intentionally
 * left GREEN rather than hard-failing on code this gate has no stake in.
 *
 * RECORDED_IMPORTERS is NOT self-limiting for growth: a stale entry (file
 * gone, or no longer binding the writer(s) it claims) fails the gate, so the
 * map cannot silently ROT -- but nothing here prevents a reviewed commit from
 * ADDING a new (file, writer) pair to it. Growth is guarded by a SEPARATE,
 * deliberate mechanism: tests/unit/reviewer-engagement-boundary-recorded-set.test.js
 * pins the map to its exact tracked contents (the same mechanism
 * reviewer-engagement-census.test.js uses for import censuses) -- widening
 * the exemption requires editing that pin in the same reviewed commit as the
 * new entry, exactly like extending an allowlist anywhere else in this repo.
 *
 * Modes:
 *   --report  Full listing of every in-scope generic-writer binding found,
 *             annotated with its exemption status (informational; exit 0).
 *   --json    Raw { file, writer, line, form, exempt, reason } entries.
 *   (default) LAW MODE: exits non-zero naming every un-exempted violation
 *             and every stale recorded-importer entry. Zero of both is the
 *             only passing state.
 *
 * Usage: node scripts/check-reviewer-engagement-boundary.js [--root <dir>] [--report] [--json]
 */

const fs = require('fs');
const path = require('path');
const {
  parseModule,
  walkAst,
  stringLiteralValue,
  importCallSourceNode,
  buildParentMap,
  propName,
  nodeLine,
  unwrapExpression,
  climbExpressionWrappers,
  isCommonJsExportTarget,
  toRel,
} = require('./lib/ast-scan-core');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['lib', 'pages', 'shared', 'modules'];
const JS_EXT_RE = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/;
const RESOLVE_EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '/index.js', '/index.ts'];

const ADAPTER_REL = 'lib/dataverse/adapters/reviewer-suggestion.js';
const ADAPTER_SOURCE_RE = /(?:^|\/)dataverse\/adapters\/reviewer-suggestion(?:\.js)?$/;
const EXEMPT_ENGAGEMENT_DIR = 'lib/services/reviewer-engagement/';

const GENERIC_WRITERS = ['updateLifecycle', 'patchFields', 'patchReviewReceipt', 'bulkUpdateByRequest'];
const GENERIC_WRITERS_SET = new Set(GENERIC_WRITERS);

// Tracked recorded-importer set (Stage 7 build plan, "the gate"). Each entry
// is a file OUTSIDE lib/services/reviewer-engagement/ that is allowed to bind
// specific generic writers, with a one-line rationale. A STALE entry (file
// gone, or no longer binding the named writer(s)) fails the gate below. This
// map may only be WIDENED in a reviewed commit that also updates the pin at
// tests/unit/reviewer-engagement-boundary-recorded-set.test.js -- that test,
// not this script, is what makes growth deliberate rather than silent.
const RECORDED_IMPORTERS = {
  // Stage 5B skip decision (census row 15): receipt sink, in-scope use of
  // patchReviewReceipt for the no-file mark-received path.
  'lib/services/review-manager/mark-received-no-file-service.js': ['patchReviewReceipt'],
  // Stage 5B skip decision (census row 16): receipt sink for the reviewer
  // upload flow's single-record receipt write.
  'lib/services/review-upload.js': ['patchReviewReceipt'],
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
    'Usage: node scripts/check-reviewer-engagement-boundary.js [--root <dir>] [--report] [--json]',
    '',
    'Default mode is LAW MODE (Reviewer Lifecycle Stage 7): any lib/pages/shared/modules',
    'file binding updateLifecycle/patchFields/patchReviewReceipt/bulkUpdateByRequest from',
    'lib/dataverse/adapters/reviewer-suggestion, outside lib/services/reviewer-engagement/,',
    'the adapter itself, or the RECORDED_IMPORTERS map, fails the gate. A recorded entry',
    'that no longer exists or no longer binds its writer(s) also fails ("stale recorded importer").',
    '--report prints every in-scope binding with its exemption status (exit 0).',
    '--json prints the raw binding entries.',
  ].join('\n');
}

function isExemptFile(rel) {
  return rel.startsWith(EXEMPT_ENGAGEMENT_DIR) || rel === ADAPTER_REL;
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
      files.push(full);
    }
  }
}

let virtualLocalCounter = 0;
function nextVirtualLocal() {
  virtualLocalCounter += 1;
  return `__reexport_local_${virtualLocalCounter}__`;
}

function resolvedPropertyName(node) {
  if (!node.computed) return { kind: 'static', name: propName(node.property) };
  if (node.property.type === 'StringLiteral') return { kind: 'static', name: node.property.value };
  return { kind: 'dynamic', name: null };
}

// Resolves a node to a "bindable key" usable everywhere a plain local-variable
// name is used elsewhere in this file (importedBindings / namespaceBinding /
// writerBinding / aliasEdges / memberAccesses.object / methodBindings.object):
//   - a plain Identifier -> its name, as always;
//   - `this.<field>` (non-computed) -> a synthetic per-field key, so a class
//     instance field holding the adapter (`adapter = require('<adapter>')` as
//     a ClassProperty, or `this.adapter = require(...)` in the constructor)
//     resolves through the SAME fixpoint a normal local does (Stage 7 second
//     correction round, Codex round 2 item 1).
// Returns null for anything else (a call result, another member chain, etc.)
// -- those fall through to the dynamic-import-member or generic fail-closed
// handling below.
function thisFieldKey(fieldName) {
  return `__this_field__${fieldName}`;
}
function bindableKeyOf(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    && !node.computed
    && node.object.type === 'ThisExpression') {
    const field = propName(node.property);
    return field ? thisFieldKey(field) : null;
  }
  return null;
}

// Everything about a file the boundary analysis needs:
//   - importedBindings: local name -> { spec, imported, line } for every
//     binding introduced by a static import, `const x = require('<spec>')`
//     (incl. destructuring), or an awaited/assigned dynamic import(). `imported`
//     is the EXTERNAL name pulled from the source ('*' for a namespace/whole-CJS
//     import). `export { x as y } from '<spec>'` and `export * from '<spec>'`
//     synthesize a VIRTUAL local (never referenced elsewhere in the file) so the
//     same binding-resolution machinery covers re-export-from positions without
//     a separate code path.
//   - exportedBindings: external export name -> local name, for identity
//     re-exports (`export { local as external }`, `export default local`,
//     `module.exports = { external: local }`, `exports.external = local`,
//     and the virtual locals above for `export ... from`).
//   - exportsWholeNamespace: locals published via `module.exports = local`
//     (CJS whole-namespace re-publish) or a virtual local for `export * from`.
//   - aliasEdges: { from, to } same-file Identifier->Identifier edges from
//     `const to = from` / `to = from`, so namespace and writer bindings
//     propagate across an alias chain of any length in the fixpoint below.
//   - methodBindings: { local, object, property, line } for `const local =
//     object.property` / `local = object.property` (the "extracted method
//     reference" shape, `const u = adapter.updateLifecycle`) OR `const {
//     property: local } = object` (destructuring the writer directly off an
//     object identifier, `const { updateLifecycle } = adapter`) -- either
//     way, `property` resolves (statically) to a generic writer name and
//     `object` is later checked for a namespace binding in analyzeRoot.
//   - memberAccesses: { object, property, line } for every member access
//     (non-computed, or string-literal-computed) whose property name is one
//     of the four generic writers -- this is what turns a namespace binding
//     into a call/reference to a SPECIFIC writer.
//   - computedDynamicAccesses: { object, line } for a member access on an
//     Identifier object with a NON-literal computed property (`x[name]`,
//     `x['a' + 'b']`) -- cannot be resolved statically, so if `object` turns
//     out to be namespace-bound this fails CLOSED as an unresolvable member.
//   - unresolvedBindings: local name -> line, for a local bound (whole) to a
//     NON-LITERAL require()/import() source, so in-scope non-literal sources
//     can fail CLOSED (narrowly -- see the module docblock). Propagated
//     across the SAME alias edges as namespace/writer bindings (a same-file,
//     single-pass closure at the end of this function) so an alias chain
//     (`const a = require(p); const b = a`) cannot launder the unresolved
//     local before a member access or identity re-export is checked against it.
//   - unresolvedWriterDestructures: { writer, line } for a destructure whose
//     EXTERNAL key names a generic writer directly, off a non-literal source
//     (`const { updateLifecycle } = require(p)`) -- writer known, source
//     unknown, so this is an immediate fail-closed candidate.
function collectFileInfo(ast) {
  const importedBindings = new Map();
  const exportedBindings = new Map();
  const exportsWholeNamespace = new Set();
  const aliasEdges = [];
  const methodBindings = [];
  const memberAccesses = [];
  const computedDynamicAccesses = [];
  const dynamicImportMemberUnresolved = [];
  const directDynamicImportWriterAccesses = [];
  const complexMemberAccesses = [];
  const unresolvedBindings = new Map();
  const unresolvedWriterDestructures = [];
  const parentMap = buildParentMap(ast);

  // `name = require(...)` / `name = await import(...)` (late assignment) OR
  // `this.field = require(...)` / `this.field = await import(...)` (a
  // constructor binding a class instance field to the adapter -- Stage 7
  // second correction round, Codex round 2 item 1). bindableKeyOf resolves
  // both shapes to the same kind of key used everywhere else in this file.
  function assignedIdentifierTarget(callNode) {
    const climbed = climbExpressionWrappers(callNode, parentMap);
    const parent = parentMap.get(climbed);
    if (parent && parent.type === 'AssignmentExpression'
      && parent.operator === '='
      && parent.right === climbed) {
      return bindableKeyOf(parent.left);
    }
    return null;
  }

  function captureResolvedBinding(callNode, spec) {
    const line = nodeLine(callNode);
    const climbed = climbExpressionWrappers(callNode, parentMap);
    const parent = parentMap.get(climbed);
    if (parent && parent.type === 'VariableDeclarator' && parent.init === climbed) {
      bindRequireDestructure(parent.id, spec, line, importedBindings);
      return;
    }
    const target = assignedIdentifierTarget(callNode);
    if (target) importedBindings.set(target, { spec, imported: '*', line });
  }

  // Non-literal require()/import() sources are common outside the reviewer
  // engagement surface (the "lazy backend" pattern: a module-scope local
  // populated from an env-derived path, exporting only its OWN functions --
  // see lib/services/settings-service.js, lib/dataverse/client.js). Hard-
  // failing on every such source in scope would be noisy and untied to this
  // gate's actual concern, so only two narrow shapes are tracked as
  // candidates for the fail-closed check in analyzeRoot:
  //   - a destructure whose EXTERNAL key names a generic writer directly
  //     (`const { updateLifecycle } = require(p)`) -- recorded immediately
  //     as an unresolved-writer-destructure hit (writer known, source unknown).
  //   - the WHOLE bound local (Identifier pattern, or an ObjectPattern
  //     property whose key does NOT name a writer) -- recorded in
  //     unresolvedBindings so a later member access
  //     (`local.updateLifecycle(...)`) or identity re-export of `local` can
  //     still be caught downstream without hard-failing on unrelated lazy
  //     backends that never touch a generic-writer-shaped name. This is a
  //     DELIBERATE, DOCUMENTED LIMIT (see the module docblock), not an
  //     oversight: a lazy-backend local that is never member-accessed with a
  //     writer name and never re-published by identity stays green.
  function captureUnresolvedBinding(callNode) {
    const climbed = climbExpressionWrappers(callNode, parentMap);
    const parent = parentMap.get(climbed);
    const line = nodeLine(callNode);
    if (parent && parent.type === 'VariableDeclarator' && parent.init === climbed) {
      captureUnresolvedPattern(parent.id, line);
      return;
    }
    const target = assignedIdentifierTarget(callNode);
    if (target) unresolvedBindings.set(target, line);
  }

  function captureUnresolvedPattern(pattern, line) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      unresolvedBindings.set(pattern.name, line);
      return;
    }
    if (pattern.type === 'ObjectPattern') {
      for (const prop of pattern.properties || []) {
        if (prop.type === 'RestElement') { captureUnresolvedPattern(prop.argument, line); continue; }
        if (prop.type !== 'ObjectProperty' || !prop.value || prop.value.type !== 'Identifier') continue;
        const external = propName(prop.key);
        if (external && GENERIC_WRITERS_SET.has(external)) {
          unresolvedWriterDestructures.push({ writer: external, line });
        } else {
          unresolvedBindings.set(prop.value.name, line);
        }
      }
    }
  }

  // `const local = <expr>` / `local = <expr>` where <expr> (after unwrapping
  // parens/await/TS casts) is either a bare Identifier (alias edge) or a
  // MemberExpression on an Identifier OR `this.<field>` object (method-binding
  // candidate -- e.g. `const u = adapter.updateLifecycle` or `const u =
  // this.adapter.updateLifecycle`). Shared by the VariableDeclarator and
  // AssignmentExpression walkers below.
  function captureIdentifierRhs(localName, rhsNode, line) {
    const rhs = unwrapExpression(rhsNode);
    if (!rhs) return;
    // Bare Identifier OR `this.<field>` (post-merge Opus D1: `const a =
    // this.adapter; a.updateLifecycle()` must flow through the same alias
    // fixpoint a plain local does -- previously only the Identifier form did).
    const rhsKey = bindableKeyOf(rhs);
    if (rhsKey) {
      aliasEdges.push({ from: rhsKey, to: localName });
      return;
    }
    if (rhs.type === 'MemberExpression' || rhs.type === 'OptionalMemberExpression') {
      const objKey = bindableKeyOf(rhs.object);
      if (!objKey) return;
      const { kind, name } = resolvedPropertyName(rhs);
      if (kind === 'static' && name && GENERIC_WRITERS_SET.has(name)) {
        methodBindings.push({ local: localName, object: objKey, property: name, line });
      }
    }
  }

  // `const { updateLifecycle } = adapter;` / `const { updateLifecycle: ul } =
  // adapter;` -- destructuring a writer directly off an OBJECT IDENTIFIER
  // (as opposed to bindRequireDestructure, which destructures directly off a
  // require()/import() call). Folded into the SAME methodBindings shape as
  // the extracted-method-reference capture above, since both mean "this
  // local IS the named writer, contingent on `object` being namespace-bound"
  // -- analyzeRoot resolves them identically (Stage 7 correction round, Opus
  // A1).
  function captureObjectPatternFromIdentifier(pattern, objectName, line) {
    if (!pattern || pattern.type !== 'ObjectPattern') return;
    for (const prop of pattern.properties || []) {
      if (prop.type !== 'ObjectProperty' || !prop.value || prop.value.type !== 'Identifier') continue;
      const external = propName(prop.key);
      if (external && GENERIC_WRITERS_SET.has(external)) {
        methodBindings.push({ local: prop.value.name, object: objectName, property: external, line });
      }
    }
  }

  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration' && node.source) {
      for (const spec of node.specifiers || []) {
        if (!spec.local || !spec.local.name) continue;
        let imported = '*';
        if (spec.type === 'ImportDefaultSpecifier') imported = 'default';
        else if (spec.type === 'ImportSpecifier') imported = spec.imported ? (spec.imported.name || spec.imported.value) : spec.local.name;
        importedBindings.set(spec.local.name, { spec: node.source.value, imported, line: nodeLine(spec) });
      }
      return;
    }
    // `export { x as y } from 'spec'` / `export * from 'spec'` -- synthesize
    // a virtual local per published name so the generic resolution machinery
    // (localWriterBinding / localNamespaceBinding, computed downstream) sees
    // export-from positions exactly like a normal import + identity export.
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const spec of node.specifiers || []) {
        if (spec.type !== 'ExportSpecifier') continue;
        const sourceName = spec.local ? (spec.local.name || spec.local.value) : null;
        const externalName = spec.exported ? (spec.exported.name || spec.exported.value) : sourceName;
        if (!sourceName || !externalName) continue;
        const virtualLocal = nextVirtualLocal();
        importedBindings.set(virtualLocal, { spec: node.source.value, imported: sourceName, line: nodeLine(spec) });
        exportedBindings.set(externalName, virtualLocal);
      }
      return;
    }
    if (node.type === 'ExportAllDeclaration' && node.source) {
      const virtualLocal = nextVirtualLocal();
      importedBindings.set(virtualLocal, { spec: node.source.value, imported: '*', line: nodeLine(node) });
      exportsWholeNamespace.add(virtualLocal);
      return;
    }
    // `export { local }` / `export { local as external }` (no source).
    // NOTE: `export const x = ...` also parses as ExportNamedDeclaration with
    // NO source, but `specifiers` is an EMPTY ARRAY (truthy!) rather than
    // absent -- `.length` guards this branch so that shape falls through to
    // the declaration-export handling below instead of returning early here.
    if (node.type === 'ExportNamedDeclaration' && !node.source && node.specifiers && node.specifiers.length > 0) {
      for (const spec of node.specifiers) {
        if (spec.type === 'ExportSpecifier' && spec.local && spec.local.name) {
          const external = spec.exported ? (spec.exported.name || spec.exported.value) : spec.local.name;
          exportedBindings.set(external, spec.local.name);
        }
      }
      return;
    }
    // `export default local`.
    if (node.type === 'ExportDefaultDeclaration' && node.declaration && node.declaration.type === 'Identifier') {
      exportedBindings.set('default', node.declaration.name);
      return;
    }
    // CJS identity re-exports: `module.exports = local` (whole namespace),
    // `module.exports = { external: local }`, `exports.external = local`,
    // and the INLINE whole-namespace re-publish `module.exports =
    // require('<spec>')` (no intermediate variable -- HIGH 1(b'), Stage 7
    // correction round: synthesize a virtual local exactly like the
    // export-from cases above so it feeds the same fixpoint). ALSO a RENAMED
    // member re-export -- `module.exports = { mutate: adapter.updateLifecycle
    // }` / `exports.mutate = adapter.updateLifecycle` -- publishes a writer
    // under a NEW name (Stage 7 second correction round, Codex round 2 item
    // 2): synthesize a virtual local bound via methodBindings (exactly like
    // `const v = adapter.updateLifecycle` would) and export it under the
    // renamed key, so the SAME method-extraction + export fixpoint resolves it.
    if (node.type === 'AssignmentExpression' && isCommonJsExportTarget(node.left)) {
      const right = node.right;
      const targetProp = node.left.type !== 'Identifier' && propName(node.left.property);
      if (right.type === 'Identifier') {
        if (isModuleExportsRoot(node.left)) exportsWholeNamespace.add(right.name);
        else if (targetProp) exportedBindings.set(targetProp, right.name);
      } else if (right.type === 'ObjectExpression' && isModuleExportsRoot(node.left)) {
        for (const prop of right.properties || []) {
          if (prop.type === 'ObjectProperty' && prop.value && prop.value.type === 'Identifier') {
            const external = propName(prop.key);
            if (external) exportedBindings.set(external, prop.value.name);
          } else if (prop.type === 'ObjectProperty' && prop.value
            && (prop.value.type === 'MemberExpression' || prop.value.type === 'OptionalMemberExpression')) {
            const external = propName(prop.key);
            const objKey = bindableKeyOf(prop.value.object);
            const { kind, name } = resolvedPropertyName(prop.value);
            if (external && objKey && kind === 'static' && name && GENERIC_WRITERS_SET.has(name)) {
              const virtualLocal = nextVirtualLocal();
              methodBindings.push({ local: virtualLocal, object: objKey, property: name, line: nodeLine(prop) });
              exportedBindings.set(external, virtualLocal);
            }
          } else if (prop.type === 'SpreadElement' && prop.argument && prop.argument.type === 'Identifier') {
            // `module.exports = { ...adapter }` -- a shallow spread copies
            // every enumerable property (including function references)
            // onto the exported object, so for detection purposes it is
            // whole-namespace-equivalent to `module.exports = adapter`
            // (Stage 7 correction round, Opus A2).
            exportsWholeNamespace.add(prop.argument.name);
          }
        }
      } else if (isModuleExportsRoot(node.left)
        && right.type === 'CallExpression'
        && right.callee.type === 'Identifier'
        && right.callee.name === 'require'
        && right.arguments.length > 0) {
        const inlineSpec = stringLiteralValue(right.arguments[0]);
        if (inlineSpec != null) {
          const virtualLocal = nextVirtualLocal();
          importedBindings.set(virtualLocal, { spec: inlineSpec, imported: '*', line: nodeLine(node) });
          exportsWholeNamespace.add(virtualLocal);
        }
      } else if (targetProp
        && (right.type === 'MemberExpression' || right.type === 'OptionalMemberExpression')) {
        // `exports.mutate = adapter.updateLifecycle;`
        const objKey = bindableKeyOf(right.object);
        const { kind, name } = resolvedPropertyName(right);
        if (objKey && kind === 'static' && name && GENERIC_WRITERS_SET.has(name)) {
          const virtualLocal = nextVirtualLocal();
          methodBindings.push({ local: virtualLocal, object: objKey, property: name, line: nodeLine(node) });
          exportedBindings.set(targetProp, virtualLocal);
        }
      }
      return;
    }
    // `const mutate = adapter.updateLifecycle; export { mutate };` is already
    // covered generically (VariableDeclarator + the no-source `export {}`
    // branch above), but `export const mutate = adapter.updateLifecycle;`
    // exports the variable BY DECLARATION -- register the identity mapping
    // here so the VariableDeclarator capture below (which runs on the SAME
    // node via the normal walk) has something to publish through.
    if (node.type === 'ExportNamedDeclaration' && !node.source && node.declaration
      && node.declaration.type === 'VariableDeclaration') {
      for (const decl of node.declaration.declarations || []) {
        if (decl.id && decl.id.type === 'Identifier') exportedBindings.set(decl.id.name, decl.id.name);
      }
    }
    // Class instance field holding the adapter: `class X { adapter =
    // require('<adapter>'); }` (or an awaited dynamic import) -- bound under
    // the SAME synthetic `this.<field>` key a constructor assignment or a
    // `this.field.writer` member access uses (Stage 7 second correction
    // round, Codex round 2 item 1).
    if ((node.type === 'ClassProperty' || node.type === 'PropertyDefinition')
      && !node.computed && node.key && node.key.type === 'Identifier' && node.value) {
      const val = unwrapExpression(node.value);
      const fieldKey = thisFieldKey(node.key.name);
      const line = nodeLine(node);
      if (val && val.type === 'CallExpression' && val.callee.type === 'Identifier'
        && val.callee.name === 'require' && val.arguments.length > 0) {
        const spec = stringLiteralValue(val.arguments[0]);
        if (spec != null) importedBindings.set(fieldKey, { spec, imported: '*', line });
        else unresolvedBindings.set(fieldKey, line);
      } else {
        const dynSrc = val && importCallSourceNode(val);
        if (dynSrc) {
          const spec = stringLiteralValue(dynSrc);
          if (spec != null) importedBindings.set(fieldKey, { spec, imported: '*', line });
          else unresolvedBindings.set(fieldKey, line);
        }
      }
    }
    // Same-file alias edge / extracted-method binding: `const b = a` or
    // `const u = adapter.updateLifecycle`; or a writer destructured directly
    // off an object identifier: `const { updateLifecycle } = adapter`.
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
      captureIdentifierRhs(node.id.name, node.init, nodeLine(node));
    } else if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init) {
      const initKey = bindableKeyOf(unwrapExpression(node.init));
      if (initKey) {
        captureObjectPatternFromIdentifier(node.id, initKey, nodeLine(node));
      }
    }
    // `b = a` / `u = adapter.updateLifecycle` (plain assignment).
    if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier') {
      captureIdentifierRhs(node.left.name, node.right, nodeLine(node));
    }
    if (node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'
      && node.arguments.length > 0) {
      const spec = stringLiteralValue(node.arguments[0]);
      if (spec != null) {
        captureResolvedBinding(node, spec);
      } else {
        captureUnresolvedBinding(node);
      }
      return;
    }
    const dynSource = importCallSourceNode(node);
    if (dynSource) {
      const spec = stringLiteralValue(dynSource);
      if (spec != null) {
        captureResolvedBinding(node, spec);
      } else {
        captureUnresolvedBinding(node);
      }
      return;
    }
    // Member access naming a generic writer: `x.updateLifecycle`,
    // `x?.patchFields`, `x['patchReviewReceipt']`, or `this.field.writer`. A
    // computed access whose key is NOT a string literal (`x[name]`,
    // `x['a' + 'b']`) cannot be resolved statically -- tracked separately so
    // it can fail CLOSED if `x` turns out to be namespace-bound (analyzeRoot).
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      const objKey = bindableKeyOf(node.object);
      if (objKey) {
        const { kind, name } = resolvedPropertyName(node);
        if (kind === 'dynamic') {
          computedDynamicAccesses.push({ object: objKey, line: nodeLine(node) });
        } else if (name && GENERIC_WRITERS_SET.has(name)) {
          memberAccesses.push({ object: objKey, property: name, line: nodeLine(node) });
        }
        return;
      }
      // Direct (possibly awaited/parenthesized) dynamic-import member access:
      // `(await import('<adapter>')).updateLifecycle(...)` (Stage 7 second
      // correction round, Codex round 2 item 3).
      const unwrappedObj = unwrapExpression(node.object);
      const dynSrc = unwrappedObj && importCallSourceNode(unwrappedObj);
      if (dynSrc) {
        const spec = stringLiteralValue(dynSrc);
        const line = nodeLine(node);
        if (spec == null) {
          // Non-literal source: fail closed ONLY when the property could be a
          // writer (named writer, or non-literal). `(await import(p)).default`
          // is the lazy-backend twin of a bare `require(p)` and stays green
          // (post-merge Opus A1: the unconditional form hard-failed the gate on
          // code with no adapter relation).
          const { kind, name } = resolvedPropertyName(node);
          if (kind === 'dynamic' || (name && GENERIC_WRITERS_SET.has(name))) {
            dynamicImportMemberUnresolved.push({ line });
          }
        } else if (ADAPTER_SOURCE_RE.test(spec)) {
          const { kind, name } = resolvedPropertyName(node);
          if (kind === 'dynamic') {
            dynamicImportMemberUnresolved.push({ line });
          } else if (name && GENERIC_WRITERS_SET.has(name)) {
            directDynamicImportWriterAccesses.push({ writer: name, line });
          }
        }
        return;
      }
      // Generic fail-closed catch-all (item 1, second sentence, Stage 7
      // second correction round): any OTHER member access whose object
      // cannot be resolved to a known key at all. NARROWED against the real
      // tree: a raw "dynamic key anywhere near an adapter-bound identifier"
      // reading false-positived on ordinary constant-lookup code --
      // `suggestionAdapter.HONORARIUM_ELIGIBILITY_BY_VALUE[row.x]` -- where
      // the OUTER access is a dynamic-keyed lookup into a STATICALLY NAMED,
      // definitely-not-a-writer sub-property (`HONORARIUM_ELIGIBILITY_BY_VALUE`
      // is a resolved, distinct export of the adapter, not one of the four
      // writers, so indexing into IT can never yield `updateLifecycle`
      // etc. regardless of the key). A dynamic computed key is therefore
      // recorded here ONLY when the object subtree contains a LITERAL
      // adapter require()/import() (a rare, independently suspicious signal
      // regardless of the outer property name) -- not merely because some
      // adapter-bound identifier appears anywhere in the chain. A STATIC
      // outer property that IS one of the four writers is always recorded
      // (the intended catch: `something.updateLifecycle(...)` where
      // `something` cannot be resolved -- e.g. `getHelper(adapter).
      // updateLifecycle()`); a static property that is provably NOT a writer
      // (`.catch`, `.complete`, a lookup-table index) is never recorded at
      // all, regardless of the object. Resolved in analyzeRoot once the
      // fixpoint knows which identifiers in THIS file are adapter-bound.
      {
        const { kind, name } = resolvedPropertyName(node);
        const isWriterName = name && GENERIC_WRITERS_SET.has(name);
        // A literal adapter source in the subtree is decisive only when the
        // OUTER property is non-literal; a static non-writer property
        // (`require('<adapter>').findById(id)`) can never yield a writer and
        // stays green, matching the `(await import('<adapter>')).findById`
        // twin (post-merge Opus A2).
        const hasLiteralAdapterSource = kind === 'dynamic' && subtreeHasLiteralAdapterSource(node.object);
        if (isWriterName || hasLiteralAdapterSource) {
          complexMemberAccesses.push({
            line: nodeLine(node),
            hasLiteralAdapterSource,
            identifierRefs: collectIdentifierReferences(node.object),
          });
        }
      }
    }
  });

  // Same-file alias closure for unresolvedBindings (Stage 7 correction round,
  // Opus R1): a non-literal-source local's "unresolved" status must survive
  // an alias chain of any length (`const a = require(p); const b = a;`)
  // exactly like the namespace/writer bindings do in analyzeRoot -- this
  // fixpoint runs HERE (same-file only, no cross-file dependency) so a
  // member access or identity re-export of `b` is checked against the same
  // set that already has `a`.
  let unresolvedAliasChanged = true;
  while (unresolvedAliasChanged) {
    unresolvedAliasChanged = false;
    for (const { from, to } of aliasEdges) {
      if (unresolvedBindings.has(from) && !unresolvedBindings.has(to)) {
        unresolvedBindings.set(to, unresolvedBindings.get(from));
        unresolvedAliasChanged = true;
      }
    }
  }

  return {
    importedBindings, exportedBindings, exportsWholeNamespace, aliasEdges, methodBindings,
    memberAccesses, computedDynamicAccesses, dynamicImportMemberUnresolved,
    directDynamicImportWriterAccesses, complexMemberAccesses,
    unresolvedBindings, unresolvedWriterDestructures,
  };
}

// Does ANY node in `node`'s subtree contain a literal require()/import() of
// the adapter? (Item 1, second sentence, Stage 7 second correction round --
// part of the generic fail-closed catch-all for a member-access object shape
// this gate does not otherwise recognize.) A raw ADAPTER_SOURCE_RE test
// (rather than resolving the relative path) is deliberate: this runs inside
// collectFileInfo, before analyzeRoot has a fileSet/rel context to resolve
// against, and the raw pattern already matches every real adapter import in
// this repo (all relative, ending in the adapter's filename).
function subtreeHasLiteralAdapterSource(node) {
  let found = false;
  walkAst(node, (n) => {
    if (found) return false;
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier'
      && n.callee.name === 'require' && n.arguments.length > 0) {
      const spec = stringLiteralValue(n.arguments[0]);
      if (spec && ADAPTER_SOURCE_RE.test(spec)) { found = true; return false; }
    }
    const dynSrc = importCallSourceNode(n);
    if (dynSrc) {
      const spec = stringLiteralValue(dynSrc);
      if (spec && ADAPTER_SOURCE_RE.test(spec)) { found = true; return false; }
    }
    return undefined;
  });
  return found;
}

// Every Identifier NAME referenced as a VALUE (not a property/key name)
// anywhere in `node`'s subtree -- used by the generic fail-closed catch-all
// to test, post-fixpoint, whether the object subtree of an unrecognized
// member-access shape mentions any identifier this file already knows is
// adapter-bound.
function collectIdentifierReferences(node) {
  const out = new Set();
  walkAst(node, (n, parent) => {
    // `this.<field>` contributes its synthetic binding key so a class-held
    // adapter passed through an unresolvable shape (`helper(this.adapter)
    // .updateLifecycle()`) is caught like its plain-local twin (Opus D1).
    const thisKey = bindableKeyOf(n);
    if (thisKey && n.type !== 'Identifier') { out.add(thisKey); return; }
    if (n.type !== 'Identifier') return;
    if (parent) {
      if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression')
        && parent.property === n && !parent.computed) return;
      if (parent.type === 'ObjectProperty' && parent.key === n && !parent.computed) return;
      if ((parent.type === 'ClassProperty' || parent.type === 'PropertyDefinition' || parent.type === 'ClassMethod' || parent.type === 'ObjectMethod')
        && parent.key === n && !parent.computed) return;
    }
    out.add(n.name);
  });
  return out;
}

function isModuleExportsRoot(target) {
  return target.type === 'MemberExpression'
    && target.object.type === 'Identifier'
    && target.object.name === 'module'
    && propName(target.property) === 'exports';
}

// `const a = require(spec)` -> local a imports '*'; `const { y: z } = require(spec)`
// -> local z imports external y.
function bindRequireDestructure(id, spec, line, importedBindings) {
  if (!id) return;
  if (id.type === 'Identifier') {
    importedBindings.set(id.name, { spec, imported: '*', line });
    return;
  }
  if (id.type === 'ObjectPattern') {
    for (const prop of id.properties || []) {
      if (prop.type === 'ObjectProperty' && prop.value && prop.value.type === 'Identifier') {
        const external = propName(prop.key);
        if (external) importedBindings.set(prop.value.name, { spec, imported: external, line });
      }
    }
  }
}

function resolveLocalSpec(fromRel, spec, fileSet) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return null;
  const baseDir = path.posix.dirname(fromRel);
  const joined = path.posix.normalize(path.posix.join(baseDir, spec));
  for (const ext of RESOLVE_EXTS) {
    const candidate = ext.startsWith('/') ? path.posix.normalize(joined + ext) : joined + ext;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function isAdapterMatch(resolvedOrRaw) {
  return typeof resolvedOrRaw === 'string' && ADAPTER_SOURCE_RE.test(resolvedOrRaw);
}

function analyzeRoot(root) {
  const files = collectFiles(root);
  const relPaths = files.map((f) => toRel(root, f));
  const fileSet = new Set(relPaths);
  const infoByFile = new Map();

  for (const full of files) {
    const rel = toRel(root, full);
    const source = fs.readFileSync(full, 'utf8');
    let ast;
    try {
      ast = parseModule(source);
    } catch (err) {
      throw new Error(`reviewer-engagement-boundary parse error in ${rel}: ${err.message}`);
    }
    infoByFile.set(rel, collectFileInfo(ast));
  }

  // Per-file MUTABLE state, grown monotonically by the fixpoint below:
  //   - namespaceBinding: local -> { wrapper } (wrapper is the resolved
  //     wrapper file the namespace binding traces through, or null for a
  //     direct adapter import/alias/extraction) -- "this local IS the
  //     adapter's whole namespace (or a namespace-equivalent barrel's)".
  //   - writerBinding: local -> { writer, line, form, wrapper } -- "this
  //     local IS (a reference to) the named generic writer".
  //   - fileIsNamespaceProxy: this file's own published identity re-publishes
  //     the adapter's whole namespace (`export * from adapter`, CJS
  //     `module.exports = require(adapter)`, or the same from another proxy).
  //   - writerNamedExports: external export name -> writer, for a NAMED
  //     one-hop (or transitively wrapper-of-wrapper) re-export/re-publish.
  //   - namespaceNamedExports: external export name -> true, for a NAMED
  //     export whose local is itself a namespace binding.
  const state = new Map();
  for (const rel of relPaths) {
    state.set(rel, {
      namespaceBinding: new Map(),
      writerBinding: new Map(),
      fileIsNamespaceProxy: false,
      writerNamedExports: new Map(),
      namespaceNamedExports: new Set(),
    });
  }

  function matchPathFor(fromRel, spec) {
    const resolved = resolveLocalSpec(fromRel, spec, fileSet);
    return { resolved, matchPath: resolved || spec };
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const rel of relPaths) {
      const info = infoByFile.get(rel);
      const st = state.get(rel);

      // 1. Import-derived bindings: direct adapter, or cross-file through an
      // already-established wrapper (writerNamedExports / namespaceNamedExports
      // / fileIsNamespaceProxy on the TARGET, which may itself have grown on a
      // prior iteration -- this is what makes wrapper-of-wrapper converge).
      for (const [local, entry] of info.importedBindings) {
        const { resolved, matchPath } = matchPathFor(rel, entry.spec);
        if (isAdapterMatch(matchPath)) {
          if (entry.imported === '*') {
            if (!st.namespaceBinding.has(local)) {
              st.namespaceBinding.set(local, { wrapper: null });
              changed = true;
            }
          } else if (GENERIC_WRITERS_SET.has(entry.imported)) {
            if (!st.writerBinding.has(local)) {
              st.writerBinding.set(local, { writer: entry.imported, line: entry.line, form: 'direct-import', wrapper: null });
              changed = true;
            }
          }
          continue;
        }
        if (!resolved) continue; // unresolved handled separately (fail-closed)
        const target = state.get(resolved);
        if (!target) continue;
        if (entry.imported === '*') {
          if (target.fileIsNamespaceProxy && !st.namespaceBinding.has(local)) {
            st.namespaceBinding.set(local, { wrapper: resolved });
            changed = true;
          }
        } else if (target.fileIsNamespaceProxy && GENERIC_WRITERS_SET.has(entry.imported)) {
          // A whole-namespace barrel (`export * from '<adapter>'` / CJS
          // `module.exports = require('<adapter>')`) never names any writer
          // in its OWN source, so it has no writerNamedExports entry -- but
          // it republishes EVERY name the adapter does, so a NAMED import of
          // a writer from it is classified exactly like a named import from
          // the adapter itself (HIGH 1(b), Stage 7 correction round).
          if (!st.writerBinding.has(local)) {
            st.writerBinding.set(local, {
              writer: entry.imported, line: entry.line, form: 'via-wrapper', wrapper: resolved,
            });
            changed = true;
          }
        } else {
          if (target.writerNamedExports.has(entry.imported) && !st.writerBinding.has(local)) {
            st.writerBinding.set(local, {
              writer: target.writerNamedExports.get(entry.imported),
              line: entry.line,
              form: 'via-wrapper',
              wrapper: resolved,
            });
            changed = true;
          }
          if (target.namespaceNamedExports.has(entry.imported) && !st.namespaceBinding.has(local)) {
            st.namespaceBinding.set(local, { wrapper: resolved });
            changed = true;
          }
        }
      }

      // 2. Same-file alias-edge propagation (any chain length, across
      // fixpoint iterations): namespace and writer bindings both transfer.
      for (const { from, to } of info.aliasEdges) {
        if (st.namespaceBinding.has(from) && !st.namespaceBinding.has(to)) {
          st.namespaceBinding.set(to, st.namespaceBinding.get(from));
          changed = true;
        }
        if (st.writerBinding.has(from) && !st.writerBinding.has(to)) {
          const src = st.writerBinding.get(from);
          st.writerBinding.set(to, { ...src, form: 'alias' });
          changed = true;
        }
      }

      // 3. Extracted-method bindings: `const u = adapter.updateLifecycle`
      // where `adapter` is (by now) a namespace binding in THIS file.
      for (const mb of info.methodBindings) {
        if (st.namespaceBinding.has(mb.object) && !st.writerBinding.has(mb.local)) {
          const origin = st.namespaceBinding.get(mb.object);
          st.writerBinding.set(mb.local, {
            writer: mb.property, line: mb.line, form: 'method-extraction', wrapper: origin.wrapper,
          });
          changed = true;
        }
      }

      // 4. This file's own publication surface, given what's known so far.
      if (!st.fileIsNamespaceProxy) {
        for (const local of info.exportsWholeNamespace) {
          if (st.namespaceBinding.has(local)) { st.fileIsNamespaceProxy = true; changed = true; break; }
        }
      }
      for (const [external, local] of info.exportedBindings) {
        if (st.writerBinding.has(local) && !st.writerNamedExports.has(external)) {
          st.writerNamedExports.set(external, st.writerBinding.get(local).writer);
          changed = true;
        }
        if (st.namespaceBinding.has(local) && !st.namespaceNamedExports.has(external)) {
          st.namespaceNamedExports.add(external);
          changed = true;
        }
      }
    }
  }

  // Fail closed, but NARROWLY -- see the module docblock's documented limit.
  const unresolvedFailures = [];
  for (const rel of relPaths) {
    const info = infoByFile.get(rel);
    for (const d of info.unresolvedWriterDestructures) {
      unresolvedFailures.push(`${rel}:${d.line} (non-literal source destructures generic writer '${d.writer}')`);
    }
    for (const access of info.memberAccesses) {
      if (info.unresolvedBindings.has(access.object)) {
        unresolvedFailures.push(`${rel}:${access.line} (member access '${access.property}' on a non-literal-source local)`);
      }
    }
    // Extracted-method / destructure-from-identifier bindings (methodBindings)
    // whose OBJECT is a non-literal-source local: `const a = require(p);
    // const { updateLifecycle } = a;` or `const u = a.updateLifecycle;` --
    // same hazard as a direct member access, just via a different syntax
    // (Stage 7 correction round, Opus A1).
    for (const mb of info.methodBindings) {
      if (info.unresolvedBindings.has(mb.object)) {
        unresolvedFailures.push(`${rel}:${mb.line} (writer '${mb.property}' extracted/destructured from a non-literal-source local)`);
      }
    }
    const identityExportedLocals = new Set([
      ...info.exportsWholeNamespace,
      ...[...info.exportedBindings.values()],
    ]);
    for (const local of identityExportedLocals) {
      if (info.unresolvedBindings.has(local)) {
        unresolvedFailures.push(`${rel}:${info.unresolvedBindings.get(local)} (non-literal-source local '${local}' re-published by identity)`);
      }
    }
    // A dynamic-import member access whose source is non-literal, OR whose
    // property could not be resolved statically -- `(await import(p)).x` or
    // `(await import('<adapter>'))[dynamicKey]` -- cannot be ruled out as a
    // generic-writer binding (Stage 7 second correction round, Codex round 2
    // item 3).
    for (const d of info.dynamicImportMemberUnresolved) {
      unresolvedFailures.push(`${rel}:${d.line} (member access on a dynamic import() with a non-literal source or non-literal property)`);
    }
  }
  if (unresolvedFailures.length > 0) {
    throw new Error(
      'reviewer-engagement-boundary: unresolved-boundary-source -- a non-literal require()/import() '
      + 'source in scope could be laundering a generic-writer binding, so the census would fail OPEN. '
      + 'Make the source a string literal (or route it through a lib/services/reviewer-engagement/ command):\n'
      + unresolvedFailures.map((f) => `  + ${f}`).join('\n'),
    );
  }

  // Final detection pass, now that the fixpoint has converged: direct/alias/
  // extracted writer bindings, namespace member accesses, and computed
  // (unresolvable) member accesses on a namespace binding.
  const allEntries = [];
  const rawWritersByFile = new Map();
  function record(rel, writer, line, form, wrapper) {
    if (!rawWritersByFile.has(rel)) rawWritersByFile.set(rel, new Set());
    if (writer) rawWritersByFile.get(rel).add(writer);
    allEntries.push({ file: rel, writer, line, form, wrapper: wrapper || null });
  }

  for (const rel of relPaths) {
    const info = infoByFile.get(rel);
    const st = state.get(rel);
    const seen = new Set();
    const push = (writer, line, form, wrapper) => {
      const key = `${writer}|${line}|${form}|${wrapper || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      record(rel, writer, line, form, wrapper);
    };

    for (const [, binding] of st.writerBinding) {
      push(binding.writer, binding.line, binding.form, binding.wrapper);
    }
    for (const access of info.memberAccesses) {
      if (st.namespaceBinding.has(access.object)) {
        const origin = st.namespaceBinding.get(access.object);
        push(access.property, access.line, 'namespace-member', origin.wrapper);
      }
    }
    for (const access of info.computedDynamicAccesses) {
      if (st.namespaceBinding.has(access.object)) {
        const origin = st.namespaceBinding.get(access.object);
        push(null, access.line, 'namespace-computed-member-unresolvable', origin.wrapper);
      }
    }
    // Direct dynamic-import member access resolved at collect time --
    // `(await import('<adapter>')).updateLifecycle(...)` (item 3).
    for (const access of info.directDynamicImportWriterAccesses) {
      push(access.writer, access.line, 'dynamic-import-member', null);
    }
    // Generic fail-closed catch-all (item 1): a member-access object shape
    // this gate does not otherwise recognize, whose subtree either contains
    // a literal adapter require()/import() or references an identifier this
    // file's fixpoint resolved to a namespace or writer binding.
    const boundNames = new Set([...st.namespaceBinding.keys(), ...st.writerBinding.keys()]);
    for (const cm of info.complexMemberAccesses) {
      let adapterBearing = cm.hasLiteralAdapterSource;
      if (!adapterBearing) {
        for (const id of cm.identifierRefs) {
          if (boundNames.has(id)) { adapterBearing = true; break; }
        }
      }
      if (adapterBearing) {
        push(null, cm.line, 'unsupported-adapter-bearing-shape', null);
      }
    }
  }
  allEntries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || String(a.writer).localeCompare(String(b.writer)));

  // Exemption: reviewer-engagement/*, the adapter itself, or a RECORDED_IMPORTERS
  // (file, writer) pair. An unresolvable computed-member entry (writer: null)
  // can never match a RECORDED_IMPORTERS writer name, so it is exempt ONLY via
  // isExemptFile -- a computed writer access is never a legitimate recorded use.
  function isRecordedExempt(file, writer) {
    if (!writer) return false;
    const writers = RECORDED_IMPORTERS[file];
    return !!writers && writers.includes(writer);
  }
  const annotated = allEntries.map((e) => {
    let exempt = false;
    let reason = null;
    if (isExemptFile(e.file)) { exempt = true; reason = 'reviewer-engagement/ or adapter'; } else if (isRecordedExempt(e.file, e.writer)) { exempt = true; reason = 'recorded importer'; }
    return { ...e, exempt, reason };
  });
  const violations = annotated.filter((e) => !e.exempt);

  // Stale recorded-importer check: an entry whose file no longer exists, or
  // no longer binds the writer(s) it claims, is a failure -- a growth in the
  // map (a NEW entry) is guarded separately by
  // tests/unit/reviewer-engagement-boundary-recorded-set.test.js, not here.
  const staleFailures = [];
  for (const [file, writers] of Object.entries(RECORDED_IMPORTERS)) {
    if (!fileSet.has(file)) {
      staleFailures.push(`recorded importer file no longer exists: ${file}`);
      continue;
    }
    const raw = rawWritersByFile.get(file) || new Set();
    const missing = writers.filter((w) => !raw.has(w));
    if (missing.length > 0) {
      staleFailures.push(`recorded importer ${file} no longer binds: ${missing.join(', ')} (stale recorded importer)`);
    }
  }

  return { annotated, violations, staleFailures };
}

function formatReport({ annotated }) {
  const lines = [
    'Reviewer-engagement boundary census (law mode since Stage 7 -- 0 un-exempted violations, 0 stale entries)',
    `Total generic-writer bindings found in scope: ${annotated.length}`,
  ];
  if (annotated.length > 0) {
    lines.push('', '## Bindings');
    for (const e of annotated) {
      const status = e.exempt ? `EXEMPT (${e.reason})` : 'VIOLATION';
      const wrapper = e.wrapper ? ` via ${e.wrapper}` : '';
      const writer = e.writer || '(unresolvable)';
      lines.push(`  - ${e.file}:${e.line} binds ${writer} [${e.form}${wrapper}] -- ${status}`);
    }
  }
  return lines.join('\n');
}

function checkLaw({ violations, staleFailures }) {
  if (violations.length === 0 && staleFailures.length === 0) return 0;

  console.error('reviewer-engagement-boundary LAW VIOLATION:');
  if (violations.length > 0) {
    console.error(`  Un-exempted generic-writer binding(s) (${violations.length}):`);
    for (const v of violations.slice(0, 60)) {
      const wrapper = v.wrapper ? ` via ${v.wrapper}` : '';
      const writer = v.writer || '(unresolvable)';
      console.error(`    + ${v.file}:${v.line} binds ${writer} [${v.form}${wrapper}]`);
    }
    if (violations.length > 60) console.error(`    ... ${violations.length - 60} more`);
  }
  if (staleFailures.length > 0) {
    console.error(`  Stale recorded-importer entrie(s) (${staleFailures.length}):`);
    for (const s of staleFailures) console.error(`    + ${s}`);
  }
  console.error('  Route the write through a lib/services/reviewer-engagement/ command,');
  console.error('  or update RECORDED_IMPORTERS in scripts/check-reviewer-engagement-boundary.js');
  console.error('  AND tests/unit/reviewer-engagement-boundary-recorded-set.test.js together');
  console.error('  with a one-line rationale if this is a genuine, reviewed exception.');
  console.error('  (docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md, Stage 7 — the gate.)');
  return 1;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const result = analyzeRoot(args.root);
  if (args.json) {
    console.log(JSON.stringify(result.annotated, null, 2));
  }
  if (args.report) {
    console.log(formatReport(result));
  }
  if (args.report || args.json) return 0;
  return checkLaw(result);
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
  analyzeRoot,
  formatReport,
  checkLaw,
  GENERIC_WRITERS,
  RECORDED_IMPORTERS,
  ADAPTER_REL,
  EXEMPT_ENGAGEMENT_DIR,
};
