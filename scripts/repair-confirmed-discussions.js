/** Owner-authorized, fixed two-request operation. Defaults to read-only preflight.
 * --prepare / --publish / --analyze / --verify are separate checkpointed steps.
 * Write steps require the per-invocation DATAVERSE_PROD_WRITE_ACK; never change deployment flags.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
require('../lib/dataverse/client.js').loadEnvLocal();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'confirmed-discussions-'));
fs.symlinkSync(path.resolve('node_modules'), path.join(temp, 'node_modules'));
const output = path.join(temp, 'entry.cjs');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'lib/repair-confirmed-discussions-entry.js')],
  outfile: output, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error' });
require(output).main().then(() => process.exitCode = 0).catch(error => {
  console.error(JSON.stringify({ error: error.code || error.name, message: error.message })); process.exitCode = 1;
}).finally(() => { fs.rmSync(temp, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 200); });
