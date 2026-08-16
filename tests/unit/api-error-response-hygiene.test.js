/**
 * Regression guard for unexpected API failures.
 *
 * Literal 500/502 JSON responses must not serialize exception `.message`
 * values, stringify exception identifiers, or use the historical `msg` alias.
 * Development-only details remain permitted when the value is structurally
 * guarded by NODE_ENV.
 *
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const API_ROOT = path.join(__dirname, '../../pages/api');

function memberName(node) {
  if (!node || !['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) return null;
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  if (node.computed && node.property?.type === 'StringLiteral') return node.property.value;
  return null;
}

function isProcessNodeEnv(node) {
  return node?.type === 'MemberExpression'
    && memberName(node) === 'NODE_ENV'
    && node.object?.type === 'MemberExpression'
    && memberName(node.object) === 'env'
    && node.object.object?.type === 'Identifier'
    && node.object.object.name === 'process';
}

function isDevelopmentGuard(node) {
  if (!node) return false;
  if (node.type === 'LogicalExpression') {
    return isDevelopmentGuard(node.left) || isDevelopmentGuard(node.right);
  }
  if (node.type !== 'BinaryExpression' || !['===', '=='].includes(node.operator)) return false;
  return (isProcessNodeEnv(node.left)
      && node.right?.type === 'StringLiteral'
      && node.right.value === 'development')
    || (isProcessNodeEnv(node.right)
      && node.left?.type === 'StringLiteral'
      && node.left.value === 'development');
}

function isLiteralServerErrorJson(node) {
  if (node?.type !== 'CallExpression' || memberName(node.callee) !== 'json') return false;
  const statusCall = node.callee.object;
  if (statusCall?.type !== 'CallExpression' || memberName(statusCall.callee) !== 'status') return false;
  const status = statusCall.arguments?.[0];
  return status?.type === 'NumericLiteral' && (status.value === 500 || status.value === 502);
}

function findResponseDisclosures(source, filename = 'fixture.js') {
  const ast = parser.parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: filename,
    plugins: ['jsx'],
  });
  const findings = [];

  function inspectResponse(node, developmentOnly = false, parent = null) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'ConditionalExpression') {
      inspectResponse(node.test, developmentOnly, node);
      inspectResponse(node.consequent, developmentOnly || isDevelopmentGuard(node.test), node);
      inspectResponse(node.alternate, developmentOnly, node);
      return;
    }

    const isMessageMember = ['MemberExpression', 'OptionalMemberExpression'].includes(node.type)
      && memberName(node) === 'message';
    const isStringifiedException = node.type === 'CallExpression'
      && node.callee?.type === 'Identifier'
      && node.callee.name === 'String'
      && node.arguments?.[0]?.type === 'Identifier'
      && ['error', 'err', 'rawErr', 'e'].includes(node.arguments[0].name);
    const isMsgAlias = node.type === 'Identifier'
      && node.name === 'msg'
      && !(parent?.type === 'ObjectProperty' && parent.key === node && !parent.computed);
    if (!developmentOnly && (isMessageMember || isStringifiedException || isMsgAlias)) {
      findings.push({
        line: node.loc?.start.line || null,
        expression: isMsgAlias ? 'msg' : isStringifiedException ? 'String(exception)' : 'exception.message',
      });
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (const child of value) inspectResponse(child, developmentOnly, node);
      } else {
        inspectResponse(value, developmentOnly, node);
      }
    }
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (isLiteralServerErrorJson(node)) {
      for (const argument of node.arguments) inspectResponse(argument);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
      } else {
        walk(value);
      }
    }
  }

  walk(ast);
  return findings;
}

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

describe('API error-response hygiene', () => {
  test('production 500/502 bodies do not expose exception messages', () => {
    const findings = listJavaScriptFiles(API_ROOT).flatMap((file) =>
      findResponseDisclosures(fs.readFileSync(file, 'utf8'), file).map((finding) => ({
        file: path.relative(path.join(__dirname, '../..'), file),
        ...finding,
      })),
    );

    expect(findings).toEqual([]);
  });

  test.each([
    ['direct member', "res.status(500).json({ error: error.message });"],
    ['optional member', "res.status(500).json({ error: error?.message });"],
    ['multiline alias', "res.status(502).json({\n  error: 'failed',\n  message: msg,\n});"],
    ['template interpolation', 'res.status(500).json({ error: `Failed: ${err.message}` });'],
    ['stringified exception', "res.status(500).json({ error: String(rawErr) });"],
  ])('self-test rejects %s disclosure', (_label, source) => {
    expect(findResponseDisclosures(source)).toHaveLength(1);
  });

  test('permits structurally development-only diagnostics', () => {
    const source = `
      res.status(500).json({
        error: 'Failed',
        details: process.env.NODE_ENV === 'development' && error instanceof Error
          ? error.message
          : undefined,
      });
    `;
    expect(findResponseDisclosures(source)).toEqual([]);
  });

  test('does not interfere with structured dynamic-status service errors', () => {
    const source = "res.status(err.httpStatus).json(err.body ?? { error: err.message });";
    expect(findResponseDisclosures(source)).toEqual([]);
  });
});
