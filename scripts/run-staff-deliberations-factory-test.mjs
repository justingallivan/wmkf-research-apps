#!/usr/bin/env node
/**
 * Owner-run, one-request Staff Deliberations automation acceptance command.
 * The ordinary cron remains disabled/unchanged; this validates one ready
 * production Basic Factory run and uses the real scheduled preparation worker.
 */
import './lib/use-extensionless.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client.js');

function parseArgs(argv) {
  const values = new Map();
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--execute') { execute = true; continue; }
    if (value === '--help') return { help: true };
    const match = value.match(/^--(request|factory-run)=(.+)$/);
    if (!match || values.has(match[1])) throw new Error('Use exactly one --request=<GUID>, one --factory-run=<GUID>, and --execute.');
    values.set(match[1], match[2]);
  }
  const requestId = values.get('request');
  const factoryRunId = values.get('factory-run');
  if (!execute || values.size !== 2 || !requestId || !factoryRunId) {
    throw new Error('Use exactly one --request=<GUID>, one --factory-run=<GUID>, and --execute.');
  }
  return { requestId, factoryRunId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node --import ./scripts/lib/use-extensionless.mjs scripts/run-staff-deliberations-factory-test.mjs --request=<GUID> --factory-run=<GUID> --execute');
    return;
  }
  loadEnvLocal();
  const { isGuid } = await import('../lib/utils/guid.js');
  if (!isGuid(args.requestId) || !isGuid(args.factoryRunId)) throw new Error('Both explicit identities must be GUIDs.');
  const { classifyDeployment, classifyTarget, resolveInterlockMode, assertDataverseOperationAllowed } = await import('../lib/dataverse/core/interlock.js');
  if (classifyDeployment() !== 'local'
    || classifyTarget(process.env.DYNAMICS_URL) !== 'production'
    || resolveInterlockMode() !== 'on'
    || process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes'
    || !process.env.DATAVERSE_PROD_WRITE_ACK
    || process.env.TEST_REQUEST_ISOLATION !== 'on') {
    throw new Error('Requires local deployment, registered Production Dataverse, enabled target interlock, production-read permission, current explicit write acknowledgement, and TEST_REQUEST_ISOLATION=on.');
  }
  assertDataverseOperationAllowed({
    url: `${process.env.DYNAMICS_URL}/api/data/v9.2/akoya_requests(${args.requestId})`,
    method: 'PATCH', callerLabel: 'local-factory-test-preflight',
  });
  const { readPreparationConfig } = await import('../lib/services/pre-site-visit/preparation-config.js');
  // The explicit CLI invocation is the one-shot activation. The copied env
  // enables only the production prerequisite for evaluating readiness; it
  // never mutates process.env or the local server/cron configuration.
  const config = readPreparationConfig({
    ...process.env,
    STAFF_DELIBERATIONS_AUTO_PREPARE: 'on',
    STAFF_DELIBERATIONS_AUTO_PREPARE_PRODUCTION: 'on',
  });
  if (!config.ready) throw new Error(`Preparation prerequisites not ready: ${config.blockedBy.filter((item) => item !== 'feature_disabled').join(', ')}`);

  const { requireLedgerUrl, ledgerSchemaCheck } = await import('../lib/db/ledger-guard.js');
  const { pgLedgerDb } = await import('../lib/services/test-requests/run-ledger-db.js');
  const { createRunLedger } = await import('../lib/services/test-requests/run-ledger.js');
  const ledgerUrl = requireLedgerUrl('production');
  await ledgerSchemaCheck(ledgerUrl, { mode: 'run-inspect' });
  const db = pgLedgerDb(ledgerUrl);
  let factoryRun;
  try {
    factoryRun = await createRunLedger(db).getRun(args.factoryRunId.toLowerCase());
  } finally {
    await db.end();
  }
  if (!factoryRun || factoryRun.status !== 'ready'
    || factoryRun.destinationEnvironment !== 'production'
    || factoryRun.recipe !== 'basic'
    || String(factoryRun.destinationRequestId || '').toLowerCase() !== args.requestId.toLowerCase()) {
    throw new Error('The Factory ledger does not attest a ready Production Basic run for this exact request GUID.');
  }
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const { runFactoryTestStaffDeliberationsPreparation } = await import('../lib/services/pre-site-visit/preparation-worker.js');
  const result = await withDalContext('local-staff-deliberations-factory-test', () => (
    runFactoryTestStaffDeliberationsPreparation({ requestId: args.requestId, factoryRun }, { config })
  ));
  const noWork = result.scanned === 0 && result.prepared === 0
    && result.blocked === 0 && result.retried === 0 && !result.generated && !result.receiptWriteFailures;
  const summary = {
    mode: noWork ? 'no-op' : result.status,
    reason: result.reason || (noWork ? 'no_due_receipt_or_claim_available' : null),
    requestId: args.requestId.toLowerCase(),
    factoryRunId: factoryRun.runId,
    scanned: result.scanned,
    generated: result.generated || 0,
    receiptWriteFailures: result.receiptWriteFailures || 0,
    prepared: result.prepared,
    blocked: result.blocked,
    retried: result.retried,
    outcomes: result.outcomes,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (result.blocked > 0 || result.retried > 0 || result.receiptWriteFailures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
