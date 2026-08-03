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

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function resolveLocal(fromFile, specifier) {
  if (typeof specifier !== 'string' || !specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function parse(file) {
  const rel = relative(file);
  const injections = {
    send_call: '\nsendEmail();\n',
    aliased_call: '\nconst transmit = DynamicsService.sendEmail; transmit();\n',
    destructured_call: '\nconst { sendEmail: transmit } = DynamicsService; transmit();\n',
    computed_call: "\nDynamicsService['sendEmail']();\n",
    forbidden_module: "\nimport '../../../lib/services/dynamics/email.js';\n",
  };
  const injection = process.env.REVIEWER_FIND_COLD_NO_SEND_TEST_INJECT;
  const source = fs.readFileSync(file, 'utf8')
    + (rel === routeEntries[0] ? (injections[injection] || '') : '');
  return parser.parse(source, {
    sourceType: 'unambiguous',
    plugins: ['dynamicImport', 'importMeta', 'jsx', 'optionalChaining'],
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
  for (const call of calledNames(ast)) {
    if (forbiddenCalls.has(call)) failures.push(`forbidden call ${call} reachable in ${rel}`);
  }
  for (const specifier of importSpecifiers(ast)) {
    const resolved = resolveLocal(file, specifier);
    if (resolved && resolved.startsWith(root + path.sep)) queue.push(resolved);
  }
}

if (failures.length > 0) {
  console.error('Reviewer Find cold no-send graph check failed:');
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Reviewer Find cold no-send graph passed (${visited.size} local modules checked).`);
}
