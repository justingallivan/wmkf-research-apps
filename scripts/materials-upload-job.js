#!/usr/bin/env node
/** Inspect or resolve one durable applicant materials job on an explicit database target. */
import pg from 'pg';
import {
  inspectMaterialsUploadJob,
  resolveMaterialsUploadJobFromOperator,
} from '../lib/services/site-visit-materials/materials-upload-operator-runtime.js';
import {
  productionMaterialsDatabaseConfig,
  productionMutationConfirmed,
} from '../lib/services/site-visit-materials/materials-upload-operator-target.js';

function usage() {
  console.error('Usage: node scripts/materials-upload-job.js --database-url postgres://...@127.0.0.1:PORT/DB --job-id UUID [--action inspect|cancel|retry]');
  console.error('Production: MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL=... node scripts/materials-upload-job.js --target production --expected-host HOST --expected-database DB --job-id UUID [--action inspect|cancel|retry]');
  console.error('Production mutations also require --confirm-job UUID --confirm-action cancel|retry.');
  process.exitCode = 2;
}

function argsOf(argv) {
  const parsed = {};
  const supported = new Set([
    'database-url', 'job-id', 'action', 'target', 'expected-host', 'expected-database',
    'confirm-job', 'confirm-action',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) return null;
    const value = argv[index + 1];
    const name = key.slice(2);
    if (!supported.has(name) || Object.hasOwn(parsed, name) || !value || value.startsWith('--')) return null;
    parsed[name] = value;
    index += 1;
  }
  return parsed;
}

function isLoopbackPostgresUrl(value) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)
      && ![...parsed.searchParams.keys()].some((key) => ['host', 'hostaddr', 'service'].includes(key.toLowerCase()));
  } catch {
    return false;
  }
}

async function inspectJob(clientConfig, jobId, production = false, expectedDatabase = null) {
  const result = await inspectMaterialsUploadJob({
    clientConfig, jobId, production, expectedDatabase, createClient: (config) => new pg.Client(config),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function resolveJob(clientConfig, jobId, action, production = false, expectedDatabase = null) {
  const result = await resolveMaterialsUploadJobFromOperator({
    clientConfig,
    jobId,
    action,
    production,
    expectedDatabase,
    createClient: (config) => new pg.Client(config),
  });
  console.log(JSON.stringify({ jobId, action, status: result.status, attemptCount: result.attempt_count }));
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const jobId = args?.['job-id'];
  const action = args?.action || 'inspect';
  if (!args || !jobId || !['inspect', 'cancel', 'retry'].includes(action)
    || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    usage();
    return;
  }

  if (args.target === 'production') {
    if (args['database-url']
      || !args['expected-host'] || !args['expected-database']) {
      console.error('production_target_confirmation_required');
      process.exitCode = 2;
      return;
    }
    if (action !== 'inspect' && !productionMutationConfirmed({
      jobId,
      action,
      confirmJob: args['confirm-job'],
      confirmAction: args['confirm-action'],
    })) {
      console.error('production_mutation_confirmation_required');
      process.exitCode = 2;
      return;
    }
    if (action === 'inspect' && (args['confirm-job'] || args['confirm-action'])) {
      console.error('unexpected_production_confirmation');
      process.exitCode = 2;
      return;
    }
    const target = productionMaterialsDatabaseConfig({
      expectedHost: args['expected-host'],
      expectedDatabase: args['expected-database'],
    });
    if (action === 'inspect') await inspectJob(target.clientConfig, jobId, true, target.expectedDatabase);
    else await resolveJob(target.clientConfig, jobId, action, true, target.expectedDatabase);
    return;
  }

  if (args.target || args['expected-host'] || args['expected-database']
    || args['confirm-job'] || args['confirm-action']) {
    console.error('unsupported_operator_target_arguments');
    process.exitCode = 2;
    return;
  }
  const connectionString = args['database-url'];
  if (!connectionString || !isLoopbackPostgresUrl(connectionString)) {
    console.error('loopback_postgres_url_required');
    process.exitCode = 2;
    return;
  }
  const clientConfig = { connectionString, ssl: false };
  if (action === 'inspect') await inspectJob(clientConfig, jobId);
  else await resolveJob(clientConfig, jobId, action);
}

try {
  await main();
} catch (error) {
  const reason = typeof error?.code === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : 'materials_operator_failed';
  console.error(reason);
  process.exitCode = 1;
}
