#!/usr/bin/env node

/**
 * Static route-graph guard for the one-time Reviewer Find cold preparation.
 *
 * The browser fence is necessary but not sufficient: an allowed server route
 * must not acquire an email/invitation dependency later. This gate walks every
 * repository-relative import reachable from the five allowed cold POST routes
 * plus the page's idempotent applicant-ingestion GET, and rejects the
 * sanctioned email/token chokepoints and send call names.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeEntries = [
  'pages/api/workbench/applicant-reviewers.js',
  'pages/api/reviewer-finder/load-proposal.js',
  'pages/api/workbench/enrich-recommended.js',
  'pages/api/reviewer-finder/analyze.js',
  'pages/api/reviewer-finder/discover.js',
  'pages/api/reviewer-finder/enrich-contacts.js',
];
const forbiddenModules = new Set([
  'lib/services/dynamics/email.js',
  'lib/services/review-manager/send-emails-service.js',
  'lib/services/grantee-deliverables/send-invite-service.js',
  'lib/external/token-lifecycle.js',
  'lib/external/grantee-token-lifecycle.js',
]);
const forbiddenCalls = new Set([
  'sendEmail',
  'createEmailActivity',
  'addEmailAttachment',
  'mintAndStore',
  'mintForRequest',
]);
const traversalBoundaries = new Set([
  // The facade exposes read/write/email methods together. Importing the
  // facade is not proof that a caller can reach email; call-site inspection in
  // every upstream module remains authoritative. Do not descend from the
  // facade into every implementation module and manufacture a false edge.
  'lib/services/dynamics-service.js',
]);
// Keep this list aligned with the local module forms Next/Node can resolve in
// this repository. A relative import that names none of these forms must be
// rejected rather than silently omitted from the cold-route graph.
const LOCAL_MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.json'];

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function repositoryAliasTarget(specifier) {
  if (typeof specifier !== 'string') return null;
  // This repository has no jsconfig/tsconfig alias map. These two spellings
  // are nevertheless unambiguously repository-root aliases, not npm package
  // names, so resolve them directly and inspect the resulting local edge.
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('~/')) return specifier.slice(2);
  return null;
}

function isUnsupportedRepositoryAlias(specifier) {
  // Node's package-import namespace is the only other common local alias
  // shape. With no tracked map, fail closed rather than treating it as an npm
  // package and silently omitting a local graph edge.
  return typeof specifier === 'string' && specifier.startsWith('#');
}

function resolveLocal(fromFile, specifier) {
  const aliasTarget = repositoryAliasTarget(specifier);
  if (typeof specifier !== 'string' || (!specifier.startsWith('.') && aliasTarget === null)) return null;
  const base = aliasTarget === null
    ? path.resolve(path.dirname(fromFile), specifier)
    : path.resolve(root, aliasTarget);
  const candidates = [
    base,
    ...LOCAL_MODULE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...LOCAL_MODULE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function parse(file) {
  // JSON has no executable import/call graph. It still goes through
  // resolveLocal(), so a missing JSON dependency fails closed, but a resolved
  // configuration leaf requires no Babel parse.
  if (path.extname(file) === '.json') return null;
  const rel = relative(file);
  const injections = {
    send_call: '\nsendEmail();\n',
    aliased_call: '\nconst transmit = DynamicsService.sendEmail; transmit();\n',
    destructured_call: '\nconst { sendEmail: transmit } = DynamicsService; transmit();\n',
    computed_call: "\nDynamicsService['sendEmail']();\n",
    forbidden_module: "\nimport '../../../lib/services/dynamics/email.js';\n",
    aliased_forbidden_module: "\nimport '@/lib/services/dynamics/email.js';\n",
    dynamic_forbidden_module: "\nasync function fixture() { return import('../../../lib/services/dynamics/email.js'); }\n",
    unresolvable_local_import: "\nimport '../../../lib/services/__cold-no-send-missing__.js';\n",
    unresolvable_repository_alias: "\nimport '@/lib/services/__cold-no-send-missing__.js';\n",
    unsupported_repository_alias: "\nimport '#cold-no-send-local';\n",
  };
  const injection = process.env.REVIEWER_FIND_COLD_NO_SEND_TEST_INJECT;
  const source = fs.readFileSync(file, 'utf8')
    + (rel === routeEntries[0] ? (injections[injection] || '') : '');
  return parser.parse(source, {
    sourceType: 'unambiguous',
    plugins: ['dynamicImport', 'importMeta', 'jsx', 'optionalChaining', 'typescript'],
  });
}

function importSpecifiers(ast) {
  const values = [];
  traverse(ast, {
    ImportDeclaration(nodePath) {
      values.push(nodePath.node.source.value);
    },
    ExportNamedDeclaration(nodePath) {
      if (nodePath.node.source) values.push(nodePath.node.source.value);
    },
    ExportAllDeclaration(nodePath) {
      values.push(nodePath.node.source.value);
    },
    CallExpression(nodePath) {
      const { node } = nodePath;
      if (node.callee?.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') {
        values.push(node.arguments[0].value);
      }
      if (node.callee?.type === 'Identifier'
        && node.callee.name === 'require'
        && node.arguments[0]?.type === 'StringLiteral') {
        values.push(node.arguments[0].value);
      }
    },
  });
  return values;
}

function calledNames(ast) {
  const values = [];
  const aliases = new Map();
  const memberName = (member) => {
    if (!member) return null;
    if (!member.computed && member.property?.type === 'Identifier') return member.property.name;
    if (member.computed && member.property?.type === 'StringLiteral') return member.property.value;
    return null;
  };
  traverse(ast, {
    ImportSpecifier(nodePath) {
      const imported = nodePath.node.imported?.name || nodePath.node.imported?.value;
      if (forbiddenCalls.has(imported)) aliases.set(nodePath.node.local.name, imported);
    },
    VariableDeclarator(nodePath) {
      const { id, init } = nodePath.node;
      if (id?.type === 'Identifier'
        && (init?.type === 'MemberExpression' || init?.type === 'OptionalMemberExpression')) {
        const sourceName = memberName(init);
        if (forbiddenCalls.has(sourceName)) aliases.set(id.name, sourceName);
      }
      if (id?.type === 'ObjectPattern') {
        for (const property of id.properties) {
          const sourceName = property.key?.name || property.key?.value;
          const localName = property.value?.name;
          if (forbiddenCalls.has(sourceName) && localName) aliases.set(localName, sourceName);
        }
      }
    },
    CallExpression(nodePath) {
      const callee = nodePath.node.callee;
      if (callee?.type === 'Identifier') values.push(aliases.get(callee.name) || callee.name);
      if ((callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression')
        && memberName(callee)) {
        values.push(memberName(callee));
      }
    },
  });
  return values;
}

const queue = routeEntries.map((entry) => path.join(root, entry));
const visited = new Set();
const failures = [];
while (queue.length > 0) {
  const file = queue.shift();
  if (visited.has(file)) continue;
  visited.add(file);
  const rel = relative(file);
  if (forbiddenModules.has(rel)) failures.push(`forbidden module reachable: ${rel}`);
  if (traversalBoundaries.has(rel)) continue;
  let ast;
  try {
    ast = parse(file);
  } catch (error) {
    failures.push(`could not parse ${rel}: ${error.message}`);
    continue;
  }
  if (!ast) continue;
  for (const call of calledNames(ast)) {
    if (forbiddenCalls.has(call)) failures.push(`forbidden call ${call} reachable in ${rel}`);
  }
  for (const specifier of importSpecifiers(ast)) {
    if (isUnsupportedRepositoryAlias(specifier)) {
      failures.push(`unsupported repository alias import ${specifier} from ${rel}`);
      continue;
    }
    const isRelative = typeof specifier === 'string' && specifier.startsWith('.');
    const isRepositoryAlias = repositoryAliasTarget(specifier) !== null;
    if (!isRelative && !isRepositoryAlias) continue;
    const resolved = resolveLocal(file, specifier);
    if (!resolved) {
      failures.push(`unresolvable ${isRepositoryAlias ? 'repository alias' : 'local'} import ${specifier} from ${rel}`);
      continue;
    }
    if (!resolved.startsWith(root + path.sep)) {
      failures.push(`local import escapes repository ${specifier} from ${rel}`);
      continue;
    }
    queue.push(resolved);
  }
}

if (failures.length > 0) {
  console.error('Reviewer Find cold no-send graph check failed:');
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Reviewer Find cold no-send graph passed (${visited.size} local modules checked).`);
}
