#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-model-override-warming.js.
 *
 * Builds isolated fixture trees (their own pages/api + lib) under a temp dir and
 * runs the gate against each with --root, so the real pages/api is never touched
 * (a fixture .js under the live pages/api would also confuse the running Next.js
 * dev server). Asserts the gate flags exactly the routes that resolve a model
 * without warming, and passes the rest. Also exercises the first-class baseline
 * (the real repo must be clean).
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

// A minimal fixture world: a baseConfig that defines the resolver, a loader, a
// model-resolving service, and a non-LLM service.
function scaffold(root) {
  write(root, 'shared/config/baseConfig.js',
    'function getModelForApp(a){return a;}\nfunction getFallbackModelForApp(a){return a;}\nmodule.exports={getModelForApp,getFallbackModelForApp,BASE_CONFIG:{}};\n');
  write(root, 'lib/services/model-override-loader.js',
    'async function loadModelOverrides(){}\nmodule.exports={loadModelOverrides};\n');
  // Mixed module: one model-resolving method + one DB-only method.
  write(root, 'lib/services/some-llm-service.js',
    "const {getModelForApp}=require('../../shared/config/baseConfig');\n" +
    'const Svc={ run(){ return getModelForApp("x"); }, dbOnly(){ return 1; } };\n' +
    'module.exports={Svc};\n');
}

function expectFlagged(output, file) {
  return new RegExp(`✗\\s+\\S*${file.replace(/[.\/]/g, (c) => '\\' + c)}`).test(output);
}

function caseDirectMissing() {
  const root = path.join(tempRoot, 'direct_missing');
  scaffold(root);
  write(root, 'pages/api/direct.js',
    "const {getModelForApp}=require('../../shared/config/baseConfig');\nexport default function h(){ return getModelForApp('a'); }\n");
  const { status, output } = runGate(root);
  if (status !== 1) throw new Error(`direct-resolver-without-warm should FAIL (exit 1); got ${status}\n${output}`);
  if (!expectFlagged(output, 'pages/api/direct.js')) throw new Error(`expected direct.js flagged:\n${output}`);
}

function caseDirectWarmed() {
  const root = path.join(tempRoot, 'direct_warmed');
  scaffold(root);
  write(root, 'pages/api/direct.js',
    "const {getModelForApp}=require('../../shared/config/baseConfig');\n" +
    "const {loadModelOverrides}=require('../../lib/services/model-override-loader');\n" +
    'export default async function h(){ await loadModelOverrides(); return getModelForApp("a"); }\n');
  const { status, output } = runGate(root);
  if (status !== 0) throw new Error(`direct-resolver-with-warm should PASS (exit 0); got ${status}\n${output}`);
}

function caseTransitiveMissing() {
  const root = path.join(tempRoot, 'transitive_missing');
  scaffold(root);
  write(root, 'pages/api/viaservice.js',
    "const {Svc}=require('../../lib/services/some-llm-service');\nexport default async function h(){ return Svc.run(); }\n");
  const { status, output } = runGate(root);
  if (status !== 1) throw new Error(`transitive-resolver-without-warm should FAIL; got ${status}\n${output}`);
  if (!expectFlagged(output, 'pages/api/viaservice.js')) throw new Error(`expected viaservice.js flagged:\n${output}`);
}

function caseTransitiveWarmed() {
  const root = path.join(tempRoot, 'transitive_warmed');
  scaffold(root);
  write(root, 'pages/api/viaservice.js',
    "const {Svc}=require('../../lib/services/some-llm-service');\n" +
    "const {loadModelOverrides}=require('../../lib/services/model-override-loader');\n" +
    'export default async function h(){ await loadModelOverrides(); return Svc.run(); }\n');
  const { status, output } = runGate(root);
  if (status !== 0) throw new Error(`transitive-resolver-with-warm should PASS; got ${status}\n${output}`);
}

function caseIgnoreMarker() {
  const root = path.join(tempRoot, 'ignore_marker');
  scaffold(root);
  write(root, 'pages/api/dbonly.js',
    "// model-override-warming:ignore reason=db-methods-only\n" +
    "const {Svc}=require('../../lib/services/some-llm-service');\nexport default function h(){ return Svc.dbOnly(); }\n");
  const { status, output } = runGate(root);
  if (status !== 0) throw new Error(`mixed-module importer with ignore marker should PASS; got ${status}\n${output}`);
}

function caseNoModelRoute() {
  const root = path.join(tempRoot, 'no_model');
  scaffold(root);
  // Imports baseConfig for BASE_CONFIG only — must NOT be flagged just for that.
  write(root, 'pages/api/plain.js',
    "const {BASE_CONFIG}=require('../../shared/config/baseConfig');\nexport default function h(){ return BASE_CONFIG; }\n");
  const { status, output } = runGate(root);
  if (status !== 0) throw new Error(`route importing baseConfig for non-LLM use should PASS; got ${status}\n${output}`);
}

function caseCommentMentionOnly() {
  const root = path.join(tempRoot, 'comment_only');
  scaffold(root);
  // Mentions getModelForApp ONLY in a comment, resolves nothing — must PASS.
  write(root, 'pages/api/commented.js',
    "// this route does not call getModelForApp() at all\nexport default function h(){ return 1; }\n");
  const { status, output } = runGate(root);
  if (status !== 0) throw new Error(`comment-only mention should PASS; got ${status}\n${output}`);
}

function caseLiveBaselineClean() {
  const { status, output } = runGate(repoRoot);
  if (status !== 0) throw new Error(`live repo baseline must be clean; got ${status}\n${output}`);
}

function main() {
  cleanup();
  try {
    caseDirectMissing();
    console.log('  ✓ direct resolver without warm is flagged');
    caseDirectWarmed();
    console.log('  ✓ direct resolver with warm passes');
    caseTransitiveMissing();
    console.log('  ✓ transitive (via service) resolver without warm is flagged');
    caseTransitiveWarmed();
    console.log('  ✓ transitive resolver with warm passes');
    caseIgnoreMarker();
    console.log('  ✓ mixed-module importer with ignore marker passes');
    caseNoModelRoute();
    console.log('  ✓ baseConfig-for-config-only route is not flagged');
    caseCommentMentionOnly();
    console.log('  ✓ comment-only getModelForApp mention is not flagged');
    caseLiveBaselineClean();
    console.log('  ✓ live repo baseline is clean');
  } finally {
    cleanup();
  }
  console.log('model-override-warming self-test OK — 8/8 cases.');
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e.message || e);
  process.exit(1);
}
