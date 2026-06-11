#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
// Paths are overridable via env vars so the self-test can point the gate at
// synthetic fixture routes + a fixture matrix without touching the real tree.
const apiRoot = process.env.API_ROUTE_GATE_API_ROOT || path.join(repoRoot, 'pages', 'api');
const matrixPath = process.env.API_ROUTE_GATE_MATRIX_PATH || path.join(repoRoot, 'docs', 'API_ROUTE_SECURITY_MATRIX.md');

const KNOWN_GUARDS = [
  'requireAuth',
  'requireAuthWithProfile',
  'requireAppAccess',
  'requireSuperuser',
  'verifyCronSecret',
  'verifySuggestionToken',
  'getServerSession',
  'NextAuth',
];

// HMAC guard helpers for intentionally sessionless routes (BILL internal calls
// + webhooks). A route is only exempted via these when BOTH the helper token is
// present in source AND the route's matrix row documents a shared-secret/HMAC
// boundary — so an undocumented HMAC-token route still warns.
const HMAC_GUARDS = [
  'verifyInternalCall', // lib/bill/internal-call-auth.js — internal same-deployment HMAC
  'verifyBillWebhook',  // lib/bill — BILL.com webhook HMAC-SHA256
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

function toRoute(filePath) {
  const relative = path.relative(path.join(repoRoot, 'pages'), filePath);
  return `/${relative.replace(/\\/g, '/').replace(/\.js$/, '').replace(/\/index$/, '')}`;
}

function getMatrixRow(matrix, route) {
  return matrix
    .split(/\r?\n/)
    .find((line) => line.startsWith(`| \`${route}\` |`));
}

function getMatrixCells(matrix, route) {
  const row = getMatrixRow(matrix, route);
  if (!row) return null;
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function hasIntentionalNoGuardRow(matrix, route) {
  const cells = getMatrixCells(matrix, route);
  if (!cells) return false;
  const currentGuard = cells[3] || '';
  return currentGuard === 'None';
}

// True when the route's matrix row documents a shared-secret / HMAC boundary in
// either the Intended Class (cells[2]) or Current Guard (cells[3]) column.
function hasDocumentedHmacBoundary(matrix, route) {
  const cells = getMatrixCells(matrix, route);
  if (!cells) return false;
  const hmacRe = /HMAC|shared secret/i;
  return hmacRe.test(cells[2] || '') || hmacRe.test(cells[3] || '');
}

function main() {
  if (!fs.existsSync(matrixPath)) {
    console.error(`Missing API route security matrix: ${path.relative(repoRoot, matrixPath)}`);
    process.exit(1);
  }

  const matrix = fs.readFileSync(matrixPath, 'utf8');
  const apiFiles = walk(apiRoot)
    .filter((file) => file.endsWith('.js'))
    .sort();

  const missing = [];
  const noRecognizedGuard = [];

  for (const file of apiFiles) {
    const route = toRoute(file);
    if (!matrix.includes(`\`${route}\``)) {
      missing.push({ route, file });
    }

    const source = fs.readFileSync(file, 'utf8');
    const hasKnownGuard = KNOWN_GUARDS.some((guard) => source.includes(guard));
    const hasHmacGuard =
      HMAC_GUARDS.some((guard) => source.includes(guard)) && hasDocumentedHmacBoundary(matrix, route);
    if (!hasKnownGuard && !hasHmacGuard && !hasIntentionalNoGuardRow(matrix, route)) {
      noRecognizedGuard.push({ route, file });
    }
  }

  if (noRecognizedGuard.length > 0) {
    console.warn('API routes without a recognized guard token. This is a warning, not a failure:');
    for (const item of noRecognizedGuard) {
      console.warn(`  - ${item.route} (${path.relative(repoRoot, item.file)})`);
    }
    console.warn('');
  }

  if (missing.length > 0) {
    console.error('API routes missing from docs/API_ROUTE_SECURITY_MATRIX.md:');
    for (const item of missing) {
      console.error(`  - ${item.route} (${path.relative(repoRoot, item.file)})`);
    }
    console.error('\nAdd each route to the matrix with its access class, guard, data scope, risk, and notes.');
    process.exit(1);
  }

  console.log(`API route security matrix covers ${apiFiles.length} route file(s).`);
}

main();
