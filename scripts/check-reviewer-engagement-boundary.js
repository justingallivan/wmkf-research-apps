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
 * "Binds" covers every form the census helper in scripts/lib/ast-scan-core.js
 * recognizes: a named import/require-destructure of the writer directly; a
 * namespace import (or CJS whole-module require, or an awaited dynamic
 * import()) of the adapter followed by a MEMBER ACCESS naming the writer
 * (`suggestionAdapter.updateLifecycle(...)` -- the dominant call form in this
 * repo); and ONE HOP of ESM re-export (`export { updateLifecycle } from
 * '<adapter>'`) or CJS re-publish (`module.exports = { updateLifecycle }` /
 * `exports.updateLifecycle = updateLifecycle`) through a wrapper module,
 * consumed by a named (non-namespace) import/require of that wrapper.
 * Non-literal require()/import() sources reachable in scope fail CLOSED
 * (hard error), mirroring check-route-service-boundary.js.
 *
 * RECORDED_IMPORTERS may only shrink honestly: an entry whose file no longer
 * exists, or no longer binds the writer(s) it claims, is ALSO a gate failure
 * ("stale recorded importer"), so the map cannot silently rot as the census
 * changes underneath it. Adding an entry does not, by itself, make the gate
 * pass on a NEW violation -- it only exempts the exact (file, writer) pair
 * recorded, and stale-entry detection means a bogus/unjustified addition
 * still shows up as a mismatch once no matching binding exists.
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
  climbExpressionWrappers,
  isCommonJsExportTarget,
  isInsideCommonJsExportRight,
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
// specific generic writers, with a one-line rationale. This map may only
// SHRINK: a stale entry (file gone, or no longer binding the named writer(s))
// is a gate failure, not a silent pass.
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
//   - memberAccesses: { object, property, line } for every non-computed (or
//     string-literal-computed) member access whose property name is one of
//     the four generic writers -- this is what turns a namespace import into
//     a binding of a SPECIFIC writer.
//   - unresolved / unresolvedBindings: non-literal require()/import() sources
//     and the locals they bind, so in-scope non-literal sources fail CLOSED.
function collectFileInfo(ast) {
  const importedBindings = new Map();
  const exportedBindings = new Map();
  const exportsWholeNamespace = new Set();
  const memberAccesses = [];
  const unresolved = [];
  const unresolvedBindings = new Map();
  const unresolvedWriterDestructures = [];
  const parentMap = buildParentMap(ast);

  function assignedIdentifierTarget(callNode) {
    const climbed = climbExpressionWrappers(callNode, parentMap);
    const parent = parentMap.get(climbed);
    if (parent && parent.type === 'AssignmentExpression'
      && parent.operator === '='
      && parent.right === climbed
      && parent.left.type === 'Identifier') {
      return parent.left.name;
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
  //     backends that never touch a generic-writer-shaped name.
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
    if (node.type === 'ExportNamedDeclaration' && !node.source && node.specifiers) {
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
    // `module.exports = { external: local }`, `exports.external = local`.
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
          }
        }
      }
      return;
    }
    if (node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'
      && node.arguments.length > 0) {
      const spec = stringLiteralValue(node.arguments[0]);
      if (spec != null) {
        captureResolvedBinding(node, spec);
      } else {
        unresolved.push({ kind: 'require', line: nodeLine(node), reexport: isInsideCommonJsExportRight(node, parentMap) });
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
        unresolved.push({ kind: 'dynamic-import', line: nodeLine(node), reexport: isInsideCommonJsExportRight(node, parentMap) });
        captureUnresolvedBinding(node);
      }
      return;
    }
    // Member access naming a generic writer: `x.updateLifecycle`,
    // `x?.patchFields`, or `x['patchReviewReceipt']`.
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      if (node.object.type !== 'Identifier') return;
      let property = null;
      if (!node.computed) property = propName(node.property);
      else if (node.property.type === 'StringLiteral') property = node.property.value;
      if (property && GENERIC_WRITERS_SET.has(property)) {
        memberAccesses.push({ object: node.object.name, property, line: nodeLine(node) });
      }
    }
  });

  return {
    importedBindings, exportedBindings, exportsWholeNamespace, memberAccesses,
    unresolved, unresolvedBindings, unresolvedWriterDestructures,
  };
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

  // Pass 1: per-file DIRECT binding of a generic writer from the adapter
  // (named import/require or namespace/whole-module + member access), plus
  // the export surfaces ("writerNamedExports", "fileIsNamespaceProxy") a
  // SECOND file can reach through one hop of re-export/re-publish.
  const perFile = new Map();
  for (const rel of relPaths) {
    const info = infoByFile.get(rel);
    const localWriterBinding = new Map(); // local -> writer
    const localNamespaceBinding = new Set(); // local bound to the adapter's whole namespace

    for (const [local, entry] of info.importedBindings) {
      const resolved = resolveLocalSpec(rel, entry.spec, fileSet);
      const matchPath = resolved || entry.spec;
      if (!isAdapterMatch(matchPath)) continue;
      if (entry.imported === '*') localNamespaceBinding.add(local);
      else if (GENERIC_WRITERS_SET.has(entry.imported)) localWriterBinding.set(local, entry.imported);
    }

    const detected = []; // { writer, line, form }
    for (const [local, writer] of localWriterBinding) {
      const entry = info.importedBindings.get(local);
      detected.push({ writer, line: entry.line, form: 'direct-import' });
    }
    for (const access of info.memberAccesses) {
      if (localNamespaceBinding.has(access.object)) {
        detected.push({ writer: access.property, line: access.line, form: 'namespace-member' });
      }
    }

    const writerNamedExports = new Map(); // external -> writer
    const namespaceNamedExports = new Set(); // external names bound to the adapter's whole namespace
    for (const [external, local] of info.exportedBindings) {
      if (localWriterBinding.has(local)) writerNamedExports.set(external, localWriterBinding.get(local));
      if (localNamespaceBinding.has(local)) namespaceNamedExports.add(external);
    }
    let fileIsNamespaceProxy = false;
    for (const local of info.exportsWholeNamespace) {
      if (localNamespaceBinding.has(local)) { fileIsNamespaceProxy = true; break; }
    }

    perFile.set(rel, {
      info, localWriterBinding, localNamespaceBinding, detected,
      writerNamedExports, namespaceNamedExports, fileIsNamespaceProxy,
    });
  }

  // Pass 2: single-hop cross-file resolution -- a file importing a NAMED
  // binding (or namespace) from an IN-REPO wrapper that itself re-publishes a
  // generic writer (or the adapter's whole namespace).
  for (const rel of relPaths) {
    const state = perFile.get(rel);
    const namespaceLocalsFromWrapper = new Set();
    for (const [local, entry] of state.info.importedBindings) {
      const resolved = resolveLocalSpec(rel, entry.spec, fileSet);
      if (!resolved || isAdapterMatch(resolved)) continue; // handled in pass 1, or unresolvable
      const target = perFile.get(resolved);
      if (!target) continue;
      if (entry.imported !== '*') {
        if (target.writerNamedExports.has(entry.imported)) {
          state.detected.push({
            writer: target.writerNamedExports.get(entry.imported),
            line: entry.line,
            form: 'via-wrapper',
            wrapper: resolved,
          });
        }
        if (target.namespaceNamedExports.has(entry.imported)) namespaceLocalsFromWrapper.add(local);
      } else if (target.fileIsNamespaceProxy) {
        namespaceLocalsFromWrapper.add(local);
      }
      if (namespaceLocalsFromWrapper.has(local)) {
        // stash the wrapper for message attribution
        state._namespaceWrapperOf = state._namespaceWrapperOf || new Map();
        state._namespaceWrapperOf.set(local, resolved);
      }
    }
    for (const access of state.info.memberAccesses) {
      if (namespaceLocalsFromWrapper.has(access.object)) {
        state.detected.push({
          writer: access.property,
          line: access.line,
          form: 'namespace-member-via-wrapper',
          wrapper: state._namespaceWrapperOf && state._namespaceWrapperOf.get(access.object),
        });
      }
    }
  }

  // Fail closed, but NARROWLY: a plain non-literal require()/import() is a
  // common "lazy backend" pattern unrelated to this gate's concern (a
  // module-scope local from an env-derived path, exporting only its OWN
  // functions -- lib/services/settings-service.js, lib/dataverse/client.js,
  // etc.) and must NOT trip this gate merely for existing. Only three shapes
  // that could plausibly be laundering a generic-writer binding through an
  // unknowable source are treated as hard-fail candidates:
  //   - a destructure whose external key IS a generic writer name
  //     (`const { updateLifecycle } = require(nonLiteral)`);
  //   - a member access naming a generic writer off a local bound (whole) to
  //     a non-literal source (`adapter.updateLifecycle(...)` where `adapter =
  //     require(nonLiteral)`);
  //   - that same whole-bound local re-published by identity (an
  //     exportsWholeNamespace entry, or an exportedBindings value) -- its
  //     published identity could be an unknowable generic-writer source.
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
    const identityExportedLocals = new Set([
      ...info.exportsWholeNamespace,
      ...[...info.exportedBindings.values()],
    ]);
    for (const local of identityExportedLocals) {
      if (info.unresolvedBindings.has(local)) {
        unresolvedFailures.push(`${rel}:${info.unresolvedBindings.get(local)} (non-literal-source local '${local}' re-published by identity)`);
      }
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

  // Dedupe detected bindings per (file, writer, line, form).
  const allEntries = [];
  const rawWritersByFile = new Map();
  for (const rel of relPaths) {
    const state = perFile.get(rel);
    const seen = new Set();
    for (const d of state.detected) {
      const key = `${d.writer}|${d.line}|${d.form}|${d.wrapper || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allEntries.push({ file: rel, writer: d.writer, line: d.line, form: d.form, wrapper: d.wrapper || null });
      if (!rawWritersByFile.has(rel)) rawWritersByFile.set(rel, new Set());
      rawWritersByFile.get(rel).add(d.writer);
    }
  }
  allEntries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.writer.localeCompare(b.writer));

  // Exemption: reviewer-engagement/*, the adapter itself, or a RECORDED_IMPORTERS
  // (file, writer) pair.
  function isRecordedExempt(file, writer) {
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
  // no longer binds the writer(s) it claims, is a failure -- the recorded set
  // may only shrink honestly.
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
      lines.push(`  - ${e.file}:${e.line} binds ${e.writer} [${e.form}${wrapper}] -- ${status}`);
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
      console.error(`    + ${v.file}:${v.line} binds ${v.writer} [${v.form}${wrapper}]`);
    }
    if (violations.length > 60) console.error(`    ... ${violations.length - 60} more`);
  }
  if (staleFailures.length > 0) {
    console.error(`  Stale recorded-importer entrie(s) (${staleFailures.length}):`);
    for (const s of staleFailures) console.error(`    + ${s}`);
  }
  console.error('  Route the write through a lib/services/reviewer-engagement/ command,');
  console.error('  or update RECORDED_IMPORTERS in scripts/check-reviewer-engagement-boundary.js');
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
