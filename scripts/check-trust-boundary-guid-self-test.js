#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-trust-boundary-guid.js.
 *
 * Builds isolated fixture trees (their own pages/api) under a temp dir and runs
 * the gate against each with --root, so the real pages/api is never touched.
 * Asserts the gate flags exactly the routes that pass a client-tainted id into a
 * Dataverse selector without a recognized GUID guard, and passes the rest. Also
 * asserts the live repo baseline is clean.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-trust-boundary-guid.js');
const tempRoot = path.join(repoRoot, '.tbg_selftest_tmp');

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('.tbg_selftest_tmp');

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

function flagged(output, file) {
  return new RegExp(`✗\\s+\\S*${file.replace(/[.\/]/g, (c) => '\\' + c)}\\b`).test(output);
}

const H = (b) => `export default async function h(req,res){\n${b}\n}\n`;

const CASES = [
  {
    name: 'unguarded getRecord(requestId from req.query) → fail',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js': H("const { requestId } = req.query;\nreturn DynamicsService.getRecord('akoya_requests', requestId);") },
  },
  {
    name: 'isGuid-guarded getRecord → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': H("const { requestId } = req.query;\nif (!isGuid(requestId)) return res.status(400).end();\nreturn DynamicsService.getRecord('akoya_requests', requestId);") },
  },
  {
    name: 'destructure from req.body || {} unguarded → fail',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js': H("const { suggestionId } = req.body || {};\nreturn DynamicsService.updateRecord('wmkf_appreviewersuggestions', suggestionId, {});") },
  },
  {
    name: 'inline GUID_RE.test(String(requestId)) guard → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': H("const requestId = req.query.requestId ? String(req.query.requestId).trim() : '';\nif (!GUID_RE.test(String(requestId))) return res.status(400).end();\nreturn DynamicsService.getRecord('akoya_requests', requestId);") },
  },
  {
    name: 'array batch for-of, unguarded → fail',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js': H("const { suggestionIds } = req.body || {};\nfor (const id of suggestionIds) { await adapter.updateLifecycle(id, {}); }\nreturn res.end();") },
  },
  {
    name: 'array batch for-of, allGuids guard → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': H("const { suggestionIds } = req.body || {};\nif (!allGuids(suggestionIds)) return res.status(400).end();\nfor (const id of suggestionIds) { await adapter.updateLifecycle(id, {}); }\nreturn res.end();") },
  },
  {
    name: 'array .map sink + .every(isGuid) guard → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': H("const { suggestionIds } = req.body || {};\nif (!suggestionIds.every(isGuid)) return res.status(400).end();\nawait Promise.all(suggestionIds.map(id => adapter.findById(id)));\nreturn res.end();") },
  },
  {
    name: 'member arg d.suggestionId guarded over the iterated collection → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': H("const { drafts } = req.body || {};\nfor (const d of drafts) { if (!isGuid(d.suggestionId)) return res.status(400).end(); }\nfor (const d of drafts) { await adapter.findById(d.suggestionId); }\nreturn res.end();") },
  },
  {
    name: 'inline req.query.x straight into sink → fail (no name to validate)',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js': H("return DynamicsService.getRecord('akoya_requests', req.query.requestId);") },
  },
  {
    name: 'server-derived id (off a fetched record) → pass (not client-tainted)',
    expect: 'pass',
    files: { 'pages/api/r.js': H("const { requestNumber } = req.query;\nconst { records } = await DynamicsService.queryRecords('akoya_requests', { filter: `akoya_requestnum eq '${String(requestNumber).replace(/'/g, \"''\")}'` });\nconst row = records[0];\nreturn DynamicsService.getRecord('akoya_requests', row.akoya_requestid);") },
  },
  {
    name: 'requestNumber escaped string filter, no id sink → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': H("const { requestNumber } = req.query;\nconst safe = String(requestNumber).replace(/'/g, \"''\");\nreturn DynamicsService.queryRecords('akoya_requests', { filter: `akoya_requestnum eq '${safe}'` });") },
  },
  {
    name: 'findByRequest(requestId) tainted, unguarded → fail',
    expect: 'fail', flag: 'pages/api/r.js',
    files: { 'pages/api/r.js': H("const { proposalId } = req.body || {};\nreturn adapter.findByRequest(proposalId);") },
  },
  {
    name: 'sink only in a comment / string → pass (AST, not text)',
    expect: 'pass',
    files: { 'pages/api/r.js': H("// getRecord('akoya_requests', requestId) would be unsafe\nreturn res.json({ doc: \"call getRecord(set, id) carefully\" });") },
  },
  {
    name: 'ignore marker suppresses an otherwise-failing route → pass',
    expect: 'pass',
    files: { 'pages/api/r.js': "// trust-boundary-guid:ignore reason=id-from-verified-token\n" + H("const { requestId } = req.query;\nreturn DynamicsService.getRecord('akoya_requests', requestId);") },
  },
  {
    name: 'two routes, one guarded one not → fail flags only the bad one',
    expect: 'fail', flag: 'pages/api/bad.js',
    files: {
      'pages/api/good.js': H("const { requestId } = req.query;\nif (!isGuid(requestId)) return res.status(400).end();\nreturn DynamicsService.getRecord('akoya_requests', requestId);"),
      'pages/api/bad.js': H("const { suggestionId } = req.body || {};\nreturn adapter.softDelete(suggestionId);"),
    },
  },
];

function runCases() {
  for (const c of CASES) {
    cleanup();
    const root = path.join(tempRoot, 'case');
    for (const [rel, body] of Object.entries(c.files)) write(root, rel, body);
    const { status, output } = runGate(root);
    const passed = status === 0;
    if (c.expect === 'pass' && !passed) throw new Error(`[${c.name}] expected PASS, got exit ${status}\n${output}`);
    if (c.expect === 'fail' && passed) throw new Error(`[${c.name}] expected FAIL, got PASS\n${output}`);
    if (c.expect === 'fail' && c.flag && !flagged(output, c.flag)) {
      throw new Error(`[${c.name}] expected ${c.flag} flagged in output\n${output}`);
    }
    // A 'pass' fixture that also names a should-not-flag file must not be flagged.
    if (c.expect === 'fail' && c.files['pages/api/good.js'] && flagged(output, 'pages/api/good.js')) {
      throw new Error(`[${c.name}] good.js was wrongly flagged\n${output}`);
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
  console.log(`trust-boundary-guid self-test OK — ${CASES.length + 1} cases.`);
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e.message || e);
  process.exit(1);
}
