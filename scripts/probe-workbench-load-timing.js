#!/usr/bin/env node
/**
 * Read-only probe. Bundles the real services with Next-compatible CommonJS
 * interop (raw Node ESM cannot load the app's NextAuth provider imports).
 * DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-workbench-load-timing.js \
 *   --email=<staff-email> --profile-id=<id> --cycle=D26
 * No HTTP auth simulation; application credentials read data under the local
 * write-blocking Dataverse interlock. Output: timings/counts/digest only.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildSync } = require('esbuild');
require('../lib/dataverse/client.js').loadEnvLocal();
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-timing-'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'));
const output = path.join(temporary, 'probe.cjs');
buildSync({ entryPoints: [path.join(__dirname, 'lib/workbench-timing-entry.js')], outfile: output,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error' });
require(output).main().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => fs.rmSync(temporary, { recursive: true, force: true }));
