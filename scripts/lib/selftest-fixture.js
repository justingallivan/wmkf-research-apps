'use strict';

// Shared self-test fixture creation + disposal for the CI gate self-tests.
// See docs/GATE_SCRIPT_CONSOLIDATION_PLAN.md (Architecture, Class 1).
//
// Contract (do not extend):
// - registerTmpFixture(prefix)      → { dir, cleanup }   (OS-tmp mkdtemp fixture)
// - registerRepoFixture(relPaths)   → { paths, cleanup } (in-repo fixture dir(s)/file(s);
//                                       string or array of repo-relative paths)
// - cleanup() is idempotent and byte-identical in semantics to the self-tests'
//   historical local helper: fs.rmSync(p, { recursive: true, force: true })
//   guarded by fs.existsSync(p). No new deletion scope.
// - registerRepoFixture cleans on entry (self-heals a prior orphan) then
//   mkdirSync-recursive's each DIRECTORY path. Paths that are plain files
//   (no trailing dir semantics) are the caller's to create; entry cleanup and
//   disposal still cover them.
// - Process-exit registration (exit/SIGINT/SIGTERM/uncaughtException) is
//   ADDITIVE best-effort crash insurance ONLY — never a replacement for any
//   in-body cleanup call. SIGKILL is uncatchable; no claim is made there.
// - The helper owns creation + disposer + crash insurance ONLY. Env-var
//   include mechanics, fixture file contents, gate invocation, and red/green
//   assertions stay in each self-test.

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..'); // scripts/lib → repo root

function rmIfExists(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function registerCrashCleanup(cleanup) {
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      cleanup();
      process.exit(1);
    });
  }
  process.on('uncaughtException', (err) => {
    cleanup();
    throw err;
  });
}

// OS-tmp fixture: mkdtemp under os.tmpdir(); additively register best-effort
// crash/exit cleanup. Returns { dir, cleanup }.
function registerTmpFixture(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cleanup = () => rmIfExists(dir);
  registerCrashCleanup(cleanup);
  return { dir, cleanup };
}

// In-repo fixture: cleanup-on-entry (self-heal a prior orphan), mkdir
// recursive for directory paths, additively register crash/exit cleanup.
// Accepts a repo-relative string or array of them; entries ending in a file
// (opts.filePaths) are cleaned/disposed but not created as directories.
// Returns { paths, cleanup } with absolute paths in input order.
function registerRepoFixture(relPathOrArray, opts = {}) {
  const relPaths = Array.isArray(relPathOrArray) ? relPathOrArray : [relPathOrArray];
  const fileSet = new Set((opts.filePaths || []).map((p) => path.resolve(repoRoot, p)));
  const paths = relPaths.map((rel) => path.resolve(repoRoot, rel));
  const cleanup = () => {
    for (const p of paths) rmIfExists(p);
  };
  for (const p of paths) {
    rmIfExists(p); // self-heal a prior orphan before scaffolding
    if (!fileSet.has(p)) fs.mkdirSync(p, { recursive: true });
  }
  registerCrashCleanup(cleanup);
  return { paths, cleanup };
}

module.exports = { registerTmpFixture, registerRepoFixture };
