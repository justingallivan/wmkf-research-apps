#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-model-override-warming.js.
 *
 * Builds isolated fixture trees (their own pages/api + lib + shared/config)
 * under a temp dir and runs the gate against each with --root, so the real
 * pages/api is never touched (a fixture .js under the live pages/api would also
 * confuse the running Next.js dev server). Asserts the gate flags exactly the
 * routes that resolve a model without a correctly-sequenced awaited warm, and
 * passes the rest. Also asserts the live repo baseline is clean.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-model-override-warming.js');
const tempRoot = path.join(repoRoot, '.model_warm_selftest_tmp');

function cleanup() {
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
}

function runGate(root) {
  try {
    return { status: 0, output: execSync(`node ${JSON.stringify(gate)} --root ${JSON.stringify(root)}`, {
      cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    }) };
  } catch (e) {
    return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

// Minimal fixture world: baseConfig defines the resolver; a loader; a mixed
// service (one model-resolving method + one DB-only method).
function scaffold(root) {
  write(root, 'shared/config/baseConfig.js',
    'function getModelForApp(a){return a;}\nfunction getFallbackModelForApp(a){return a;}\nmodule.exports={getModelForApp,getFallbackModelForApp,BASE_CONFIG:{}};\n');
  write(root, 'lib/services/model-override-loader.js',
    'async function loadModelOverrides(){}\nmodule.exports={loadModelOverrides};\n');
  write(root, 'lib/services/some-llm-service.js',
    "const {getModelForApp}=require('../../shared/config/baseConfig');\n" +
    'const Svc={ run(){ return getModelForApp("x"); }, dbOnly(){ return 1; } };\n' +
    'module.exports={Svc};\n');
}

function flagged(output, file) {
  return new RegExp(`✗\\s+\\S*${file.replace(/[.\/]/g, (c) => '\\' + c)}\\b`).test(output);
}

// name, files: {rel: body}, expect: 'pass' | 'fail', mustFlag: optional route rel
const CASES = [
  {
    name: 'direct resolver, no warm → fail',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js': "const {getModelForApp}=require('../../shared/config/baseConfig');\nexport default function h(){ return getModelForApp('a'); }\n" },
  },
  {
    name: 'direct resolver, awaited warm before → pass',
    expect: 'pass',
    files: { 'pages/api/r.js':
      "const {getModelForApp}=require('../../shared/config/baseConfig');\n" +
      "const {loadModelOverrides}=require('../../lib/services/model-override-loader');\n" +
      'export default async function h(){ await loadModelOverrides(); return getModelForApp("a"); }\n' },
  },
  {
    name: 'direct resolver, warm AFTER resolve in same fn → fail (ordering)',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js':
      "const {getModelForApp}=require('../../shared/config/baseConfig');\n" +
      "const {loadModelOverrides}=require('../../lib/services/model-override-loader');\n" +
      'export default async function h(){ const m = getModelForApp("a"); await loadModelOverrides(); return m; }\n' },
  },
  {
    name: 'warm present but NOT awaited → fail',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js':
      "const {getModelForApp}=require('../../shared/config/baseConfig');\n" +
      "const {loadModelOverrides}=require('../../lib/services/model-override-loader');\n" +
      'export default function h(){ loadModelOverrides(); return getModelForApp("a"); }\n' },
  },
  {
    name: 'helper-defined resolver + handler awaits warm before calling helper → pass (no cross-fn false positive)',
    expect: 'pass',
    files: { 'pages/api/r.js':
      "const {getModelForApp}=require('../../shared/config/baseConfig');\n" +
      "const {loadModelOverrides}=require('../../lib/services/model-override-loader');\n" +
      'function pick(){ return getModelForApp("a"); }\n' +
      'export default async function h(){ await loadModelOverrides(); return pick(); }\n' },
  },
  {
    name: 'transitive (via service), no warm → fail',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js': "const {Svc}=require('../../lib/services/some-llm-service');\nexport default async function h(){ return Svc.run(); }\n" },
  },
  {
    name: 'transitive (via service), awaited warm → pass',
    expect: 'pass',
    files: { 'pages/api/r.js':
      "const {Svc}=require('../../lib/services/some-llm-service');\n" +
      "const {loadModelOverrides}=require('../../lib/services/model-override-loader');\n" +
      'export default async function h(){ await loadModelOverrides(); return Svc.run(); }\n' },
  },
  {
    name: 'transitive + ignore marker, DB-only use → pass',
    expect: 'pass',
    files: { 'pages/api/r.js':
      "// model-override-warming:ignore reason=db-methods-only\n" +
      "const {Svc}=require('../../lib/services/some-llm-service');\nexport default function h(){ return Svc.dbOnly(); }\n" },
  },
  {
    name: 'ignore marker does NOT exempt a DIRECT in-file resolver → fail',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js':
      "// model-override-warming:ignore reason=bogus\n" +
      "const {getModelForApp}=require('../../shared/config/baseConfig');\nexport default function h(){ return getModelForApp('a'); }\n" },
  },
  {
    name: 'baseConfig imported for non-LLM use only → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': "const {BASE_CONFIG}=require('../../shared/config/baseConfig');\nexport default function h(){ return BASE_CONFIG; }\n" },
  },
  {
    name: 'getModelForApp only in a comment → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': "// this route never calls getModelForApp() anywhere\nexport default function h(){ return 1; }\n" },
  },
  {
    name: 'getModelForApp only inside a string literal → pass (AST, not text)',
    expect: 'pass',
    files: { 'pages/api/r.js': "export default function h(){ return 'see getModelForApp() docs https://x/y'; }\n" },
  },
];

function runCases() {
  for (const c of CASES) {
    cleanup();
    const root = path.join(tempRoot, 'case');
    scaffold(root);
    for (const [rel, body] of Object.entries(c.files)) write(root, rel, body);
    const { status, output } = runGate(root);
    const passed = status === 0;
    if (c.expect === 'pass' && !passed) throw new Error(`[${c.name}] expected PASS, got exit ${status}\n${output}`);
    if (c.expect === 'fail' && passed) throw new Error(`[${c.name}] expected FAIL, got PASS\n${output}`);
    if (c.expect === 'fail' && c.flag && !flagged(output, c.flag)) {
      throw new Error(`[${c.name}] expected ${c.flag} flagged in output\n${output}`);
    }
    console.log(`  ✓ ${c.name}`);
  }
}

function runLiveBaseline() {
  const { status, output } = runGate(repoRoot);
  if (status !== 0) throw new Error(`live repo baseline must be clean; got exit ${status}\n${output}`);
  console.log('  ✓ live repo baseline is clean');
}

function main() {
  cleanup();
  try {
    runCases();
    runLiveBaseline();
  } finally {
    cleanup();
  }
  console.log(`model-override-warming self-test OK — ${CASES.length + 1} cases.`);
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e.message || e);
  process.exit(1);
}
