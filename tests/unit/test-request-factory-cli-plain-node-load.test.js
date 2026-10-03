/**
 * Regression for the P1 the orchestrator found in 98e5baa48 (2026-09-27):
 * `source-bundle.js` importing `lib/services/pre-site-visit/artifact-model.js`
 * for `validateDiagnostics` dragged that file's transitive graph (Dataverse
 * adapters, executePrompt, docx-renderer/JSZip, and extensionless ESM
 * specifiers only Jest/Next resolve) into the Test Request Factory's two
 * plain-Node CLI scripts, which `require('../lib/dataverse/client.js')`
 * (CommonJS interop) and are run directly with `node`, never through Jest
 * or Next's module resolution. Jest's own resolver is lenient about
 * extensionless specifiers and so CANNOT see this class of bug -- this test
 * spawns a real `node` subprocess (`process.execPath`), the only way to
 * catch it.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

const FACTORY_CLIS = [
  'scripts/export-test-request-source-bundle.mjs',
  'scripts/rehearse-test-request-sandbox.mjs',
];

describe('Test Request Factory CLIs load under plain Node (`node <script> --help`)', () => {
  test.each(FACTORY_CLIS)('%s exits 0 with no ERR_MODULE_NOT_FOUND', (scriptPath) => {
    const result = spawnSync(process.execPath, [scriptPath, '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {}, // no env, no network -- a plain `node` load, nothing more
      timeout: 15000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.status).toBe(0);
  });
});
