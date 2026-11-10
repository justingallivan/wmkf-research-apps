#!/usr/bin/env node
/** File-only dry run. No --execute, env loading, credentials, or remote calls. */
const fs = require('node:fs');
const { planImport } = require('./lib/expertise-roster-import-plan.cjs');
async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--source', '--target', '--mapping', '--output'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) throw new Error('Use --source file --target file --mapping file --output NEW-file; no execution mode exists.');
    args[key] = argv[i + 1];
  }
  if (Object.keys(args).length !== 4) throw new Error('All four file arguments are required.');
  const { PRODUCTION_HOSTS, SANDBOX_HOSTS } = await import('../lib/dataverse/core/target-registry.js');
  const read = key => JSON.parse(fs.readFileSync(args[key], 'utf8'));
  const report = planImport(read('--source'), read('--target'), read('--mapping'), [...PRODUCTION_HOSTS, ...SANDBOX_HOSTS]);
  // Exclusive creation prevents accidentally overwriting an input or prior evidence.
  fs.writeFileSync(args['--output'], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ mode: report.mode, ...report.summary, output: args['--output'], executionAuthorized: false }));
  if (report.blocked) process.exitCode = 2;
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
