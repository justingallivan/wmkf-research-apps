#!/usr/bin/env node
'use strict';

/**
 * Read-only reviewer lifecycle call inventory, used by the Stage 0 receipt.
 * Run from the repository root: node scripts/inventory-reviewer-lifecycle-writers.js
 * Prints JSON; reads tracked lib/pages/shared/scripts JS/TS files without loading
 * application modules, environment files, or credentials. This is not a gate.
 *
 * Tracks literal adapter/core imports, named/namespace/require/dynamic-import
 * aliases, destructured defaults, and deps.member || importedDefault bindings.
 * Counts calls separately from imports; raw descriptors, internal adapter calls,
 * forwarded callbacks, REST writers and raw-field readers require the companion
 * receipt's source searches. It is file-local (not scope-sensitive) and does not
 * solve lexical shadowing, cross-file re-exports, arbitrary reflection, computed
 * module paths, runtime DI replacements, or aliases returned by unknown functions.
 * "unresolved" covers computed calls
 * through a recognized module binding, not every possible dynamic JavaScript call.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ts = require('typescript');

const ROOTS = ['lib', 'pages', 'shared', 'scripts'];
const CODE_EXTENSION = /\.(?:js|jsx|ts|tsx|cjs|mjs)$/;

function moduleKind(source) {
  if (/(?:^|\/)reviewer-suggestion(?:\.js)?$/.test(source)) return 'suggestion';
  if (/(?:^|\/)core\/changeset(?:\.js)?$/.test(source)) return 'changeset';
  return null;
}

function analyzeSource(file, source) {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX
    : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const parseErrors = ast.parseDiagnostics.map((diagnostic) => ({
    file,
    line: ast.getLineAndCharacterOfPosition(diagnostic.start || 0).line + 1,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
  const aliases = new Map();
  const imports = new Map();
  const calls = [];
  const unresolved = [];
  const line = (node) => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;

  function resolve(node) {
    if (!node) return null;
    if (ts.isIdentifier(node)) return aliases.get(node.text) || null;
    if (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node)) return resolve(node.expression);
    if (ts.isPropertyAccessExpression(node)) {
      const target = resolve(node.expression);
      return target?.endsWith(':*') ? target.slice(0, -1) + node.name.text : null;
    }
    if (ts.isElementAccessExpression(node)) {
      const target = resolve(node.expression);
      return target?.endsWith(':*') && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
        ? target.slice(0, -1) + node.argumentExpression.text : null;
    }
    if (ts.isBinaryExpression(node)
      && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      return resolve(node.right) || resolve(node.left);
    }
    if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const imported = moduleKind(node.arguments[0].text);
      return imported ? `${imported}:*` : null;
    }
    return null;
  }

  function bind(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const imported = moduleKind(node.moduleSpecifier.text);
      if (imported) {
        imports.set(line(node), { file, line: line(node), module: imported });
        const names = node.importClause?.namedBindings;
        if (names && ts.isNamespaceImport(names)) aliases.set(names.name.text, `${imported}:*`);
        else if (names && ts.isNamedImports(names)) {
          for (const item of names.elements) {
            aliases.set(item.name.text, `${imported}:${item.propertyName?.text || item.name.text}`);
          }
        }
      }
    }
    if (ts.isBindingElement(node) && node.initializer && ts.isIdentifier(node.name)) {
      const target = resolve(node.initializer);
      if (target) aliases.set(node.name.text, target);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const target = resolve(node.initializer);
      if (target && ts.isIdentifier(node.name)) aliases.set(node.name.text, target);
      else if (target?.endsWith(':*') && ts.isObjectBindingPattern(node.name)) {
        for (const item of node.name.elements) {
          if (ts.isIdentifier(item.name)) {
            aliases.set(item.name.text, target.slice(0, -1) + (item.propertyName?.getText(ast) || item.name.text));
          }
        }
      }
    }
    ts.forEachChild(node, bind);
  }

  // Resolve aliases declared before their imported/default binding without
  // executing code. Each pass can add at most the finite set of identifiers.
  let previousSize = -1;
  while (aliases.size !== previousSize) {
    previousSize = aliases.size;
    bind(ast);
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const target = resolve(node.expression);
      if (target) calls.push({ file, line: line(node), binding: node.expression.getText(ast), target });
      else if (ts.isElementAccessExpression(node.expression) && resolve(node.expression.expression)) {
        unresolved.push({ file, line: line(node), binding: node.expression.getText(ast) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { imports: [...imports.values()], calls, unresolved, parseErrors };
}

function inventory(root = process.cwd()) {
  const files = execFileSync('git', ['ls-files', '-z', ...ROOTS], { cwd: root, encoding: 'utf8' })
    .split('\0').filter((file) => CODE_EXTENSION.test(file));
  const result = { roots: ROOTS, filesScanned: files.length, imports: [], calls: [], unresolved: [], parseErrors: [] };
  for (const file of files) {
    const found = analyzeSource(file, fs.readFileSync(path.join(root, file), 'utf8'));
    result.imports.push(...found.imports);
    result.calls.push(...found.calls);
    result.unresolved.push(...found.unresolved);
    result.parseErrors.push(...found.parseErrors);
  }
  return result;
}

module.exports = { analyzeSource, inventory };
if (require.main === module) process.stdout.write(`${JSON.stringify(inventory(), null, 2)}\n`);
