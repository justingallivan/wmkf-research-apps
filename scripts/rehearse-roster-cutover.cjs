#!/usr/bin/env node
/** Explicit disposable-schema cutover rehearsal. Dry run unless --execute is supplied. */
const fs = require('node:fs');
const dotenv = require('dotenv');
const { assertOperationalSchema } = require('../lib/services/expertise-finder/roster-lifecycle.cjs');
const { assertTarget } = require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
const { runCutover } = require('./lib/expertise-roster-cutover.cjs');

const allowed = new Set([
  '--env', '--schema', '--phase', '--manifest', '--receipt', '--execute',
  '--source', '--mapping', '--reviewed-plan', '--import-receipt',
]);
const required = ['--env', '--schema', '--phase', '--manifest'];
const evidence = {
  '--source': 'source', '--mapping': 'mapping',
  '--reviewed-plan': 'reviewedPlan', '--import-receipt': 'importReceipt',
};

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const option = argv[i], value = argv[i + 1];
    if (!allowed.has(option) || Object.hasOwn(args, option) || !value || value.startsWith('--')) {
      throw Error('Invalid cutover arguments.');
    }
    args[option] = value;
  }
  if (!required.every(option => args[option]) ||
    (args['--execute'] && !args['--receipt']) ||
    (args['--phase'] === 'prepare' && !Object.keys(evidence).every(option => args[option]))) {
    throw Error('Required: --env FILE --schema SCHEMA --phase PHASE --manifest FILE; prepare also requires --source, --mapping, --reviewed-plan and --import-receipt. To commit, add --execute HOST --receipt NEW_FILE.');
  }
  return args;
}

async function main(argv) {
  const args = argsOf(argv);
  const schema = args['--schema'];
  assertOperationalSchema(schema);
  if (process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') throw Error('Local rehearsal only.');
  const envFile = args['--env'];
  const stat = fs.statSync(envFile);
  if (!stat.isFile() || (stat.mode & 0o077)) throw Error('A private environment file is required.');
  const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envFile)) };
  const { host } = assertTarget(env);
  if (args['--execute'] && args['--execute'] !== host) throw Error('Exact registered sandbox acknowledgement required.');
  const phase = args['--phase'];
  const review = phase === 'prepare' && Object.fromEntries(Object.entries(evidence).map(([option, key]) => [
    key, JSON.parse(fs.readFileSync(args[option], 'utf8')),
  ]));
  let store;
  async function readTarget() {
    if (!store) {
      for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET',
        'DATAVERSE_TARGET_INTERLOCK', 'DATAVERSE_DAL_ENFORCEMENT']) {
        if (!env[key]) throw Error('Incomplete sandbox census configuration.');
        process.env[key] = env[key];
      }
      const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
      const { createStore } = require('./lib/expertise-roster-import-store.cjs');
      const live = createClient({ resourceUrl: env.DYNAMICS_URL, token: await getAccessToken(env.DYNAMICS_URL) });
      const client = {
        raw(method, ...rest) {
          if (method !== 'GET') throw Error('Operational rehearsal only reads Dataverse.');
          return live.raw(method, ...rest);
        },
      };
      store = createStore({ env, client });
    }
    return store.readTarget();
  }
  return runCutover({
    env, schema, phase, acknowledge: args['--execute'], manifestPath: args['--manifest'],
    receiptPath: args['--receipt'], execute: Boolean(args['--execute']), readTarget, review,
  });
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    const expected = error.code === 'roster_cutover_refused' || error.code === 'roster_reconciliation_required';
    console.error(expected ? error.message : 'Cutover rehearsal failed. Inspect the private receipt if one was created.');
    process.exitCode = 1;
  });
}
module.exports = { main };
