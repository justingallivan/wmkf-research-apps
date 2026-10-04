#!/usr/bin/env node
/**
 * Owner-operated, Sandbox-only Factory Basic file readback tool.
 * `--recover` performs one leased, same-step ledger CAS after a fresh exact
 * Request/artifact/Graph verification; it never uploads, sends, or marks ready.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createFactoryArtifactStore, MAX_BUNDLE_BYTES, MAX_MANIFEST_BYTES } from '../lib/services/test-requests/factory-artifact-store.js';
import { verifyPendingBasicFileReadback } from '../lib/services/test-requests/file-readback-verifier.js';
import { inspectPendingBasicFileReadback, parseFileReadbackArgs, recoverPendingBasicFileReadback } from '../lib/services/test-requests/file-recovery-runner.js';
import { createRunLedger } from '../lib/services/test-requests/run-ledger.js';
import { pgLedgerDb } from '../lib/services/test-requests/run-ledger-db.js';
import { requireLedgerUrl, ledgerSchemaCheck } from '../lib/db/ledger-guard.js';
import { GraphService } from '../lib/services/graph-service.js';
import { configuredSharePointTargetInfo } from '../lib/services/sharepoint-target-registry.js';
import { SANDBOX_URL } from '../lib/services/test-requests/basic-clone-steps.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST_SELECT = 'akoya_requestid,akoya_requestnum,wmkf_istestrequest,wmkf_testcreationrunid';

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node scripts/factory-file-readback.mjs --target=sandbox --run-id=<GUID> --confirm-request=<number>',
    '  node scripts/factory-file-readback.mjs --target=sandbox --run-id=<GUID> --confirm-request=<number> --manifest=/absolute/manifest.json --bundle=/absolute/bundle.json',
    '  node scripts/factory-file-readback.mjs --target=sandbox --run-id=<GUID> --confirm-request=<number> --recover --receipt-out=/absolute/private/path.json',
    '',
    'Read-only mode performs actor-independent owner-operator verification of one Sandbox Basic run.',
    'Recovery requires a fresh source bundle (<6 hours at the final database CAS), writes a private create-only receipt,',
    'and only verifies the same pending file step. It never uploads, advances, sends email, or marks the run ready.',
    'The private receipt records evidence before the CAS; it does not prove commit. After an ambiguous result, inspect the ledger.',
  ].join('\n') + '\n');
}

function graphReader() {
  return {
    configuredSharePointTarget: () => configuredSharePointTargetInfo(),
    clearGraphCaches: () => GraphService.clearCaches(),
    getSiteId: (...args) => GraphService.getSiteId(...args),
    getDriveId: (...args) => GraphService.getDriveId(...args),
    getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
    getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
    downloadFile: (driveId, itemId, options) => GraphService.downloadFile(driveId, itemId, options),
    listFiles: (...args) => GraphService.listFiles(...args),
  };
}

function artifactLoader(store) {
  return async (run) => {
    const [manifestResult, bundleResult] = await Promise.all([
      store.read(store.runPathname('sandbox', run.runId, 'manifest')),
      store.read(store.runPathname('sandbox', run.runId, 'bundle')),
    ]);
    if (!manifestResult?.value || !bundleResult?.value) throw new Error('artifacts_missing');
    return { manifest: manifestResult.value, bundle: bundleResult.value };
  };
}

function readLocalJson(filePath, maximumBytes) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > maximumBytes) throw new Error('artifact_file_invalid_or_too_large');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function selectArtifactLoader(store, args) {
  if (!args.manifestPath) return artifactLoader(store);
  return async () => ({
    manifest: readLocalJson(args.manifestPath, MAX_MANIFEST_BYTES),
    bundle: readLocalJson(args.bundlePath, MAX_BUNDLE_BYTES),
  });
}

function safeResult(result) {
  if (!result || typeof result !== 'object') return { status: 'blocked', reason: 'invalid_result' };
  return {
    status: result.status ?? 'blocked',
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.disposition ? { disposition: result.disposition } : {}),
    evidenceOnly: result.evidenceOnly === true,
    continuationAllowed: result.continuationAllowed === true,
    ...(result.requestNumber ? { requestNumber: result.requestNumber } : {}),
    ...(result.currentStep ? { currentStep: result.currentStep } : {}),
    ...(result.runVersion !== undefined ? { runVersion: result.runVersion } : {}),
    ...(result.receiptPath ? { receiptPath: result.receiptPath } : {}),
    ...(result.integrityMode ? { integrityMode: result.integrityMode } : {}),
    ...(result.inventoryCount !== undefined ? { inventoryCount: result.inventoryCount } : {}),
    ...(result.sourceSha256 ? { sourceSha256: result.sourceSha256 } : {}),
    ...(result.destinationSha256 ? { destinationSha256: result.destinationSha256 } : {}),
    ...(result.normalizedParts ? { normalizedParts: result.normalizedParts } : {}),
  };
}

async function main() {
  const args = parseFileReadbackArgs(process.argv);
  if (args.help) return printHelp();
  loadEnvLocal();
  if (process.env.DYNAMICS_SANDBOX_URL !== SANDBOX_URL) throw new Error('DYNAMICS_SANDBOX_URL must equal the registered Sandbox URL.');
  const ledgerUrl = requireLedgerUrl('sandbox');
  await ledgerSchemaCheck(ledgerUrl, { mode: args.recover ? 'advance' : 'run-inspect' });
  const db = pgLedgerDb(ledgerUrl, { pool: { max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 } });
  try {
    const ledger = createRunLedger(db);
    const token = await getAccessToken(SANDBOX_URL);
    const client = createClient({ resourceUrl: SANDBOX_URL, token });
    const readRequest = async (requestId) => {
      const response = await client.getWithOptions(`/akoya_requests(${requestId})?$select=${REQUEST_SELECT}`, {}, { timeoutMs: 30_000 });
      return response.ok ? response.body : null;
    };
    const store = createFactoryArtifactStore({ env: process.env });
    const common = {
      ledger, runId: args.runId, confirmRequestNumber: args.requestNumber,
      loadArtifacts: selectArtifactLoader(store, args), readRequest, graph: graphReader(),
      expectedTarget: { environment: 'sandbox', url: SANDBOX_URL },
      verifyPendingBasicFileReadback,
    };
    const result = args.recover
      ? await recoverPendingBasicFileReadback({ ...common, receiptPath: args.receiptPath, repoRoot: REPO_ROOT })
      : await inspectPendingBasicFileReadback(common);
    process.stdout.write(`${JSON.stringify(safeResult(result), null, 2)}\n`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  const known = /^[a-z][a-z0-9_]{2,80}$/.test(String(error?.code || '')) ? error.code : null;
  process.stderr.write(`${JSON.stringify({ status: 'blocked', reason: known || 'file_readback_failed' })}\n`);
  process.exitCode = 1;
});
