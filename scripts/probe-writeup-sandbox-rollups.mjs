#!/usr/bin/env node
/**
 * Read-only preflight for the Sandbox Test Request Factory rollup verifier.
 * Captures a digest-only Foundation/active-Request baseline, then immediately
 * verifies it without creating a Request. The expected result is a single
 * exact-set failure because the reserved probe UUID is never written.
 *
 * Run with the repository's existing environment loader:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-writeup-sandbox-rollups.mjs
 */
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import {
  captureSandboxFoundationBaseline,
  readSandboxRollupMetadata,
  verifySandboxFoundationTransition,
} from '../lib/services/test-requests/sandbox-foundation-verification.js';
import { SANDBOX_URL, getFoundationSnapshot } from '../lib/services/test-requests/basic-clone-steps.js';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

async function main() {
  loadEnvLocal();
  // Pin the process to the registered Sandbox after env loading. These are
  // process-local safety settings; this script never creates a write client.
  process.env.DYNAMICS_URL = SANDBOX_URL;
  process.env.DYNAMICS_SANDBOX_URL = SANDBOX_URL;
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.DATAVERSE_DAL_ENFORCEMENT = 'on';
  delete process.env.DATAVERSE_ALLOW_PROD_READS;

  const client = createClient({ resourceUrl: SANDBOX_URL, token: await getAccessToken(SANDBOX_URL) });
  if (process.argv.includes('--metadata-formula-fixture')) {
    const rows = [];
    for (const cast of ['Integer', 'Money', 'DateTime', 'Decimal']) {
      const response = await client.get(`/EntityDefinitions(LogicalName='account')/Attributes/Microsoft.Dynamics.CRM.${cast}AttributeMetadata?$select=LogicalName,SourceType,FormulaDefinition&$top=5000`);
      if (!response?.ok || !Array.isArray(response.body?.value) || response.body['@odata.nextLink']) {
        throw new Error(`Sandbox ${cast} metadata was incomplete; formula fixture was not emitted.`);
      }
      rows.push(...response.body.value.filter((row) => Number(row.SourceType) === 2));
    }
    const fixture = rows.map(({ LogicalName, SourceType, FormulaDefinition }) => ({ LogicalName, SourceType, FormulaDefinition }));
    console.log(JSON.stringify({
      mode: 'READ_ONLY_SANDBOX_FORMULA_FIXTURE',
      target: new URL(SANDBOX_URL).hostname,
      count: fixture.length,
      gzipBase64: gzipSync(Buffer.from(JSON.stringify(fixture))).toString('base64'),
    }));
    return;
  }
  if (process.argv.includes('--metadata-only')) {
    const metadata = await readSandboxRollupMetadata(client);
    console.log(JSON.stringify({
      mode: 'READ_ONLY_SANDBOX_ROLLUP_METADATA',
      target: new URL(SANDBOX_URL).hostname,
      fields: metadata.fields,
      metadataDigest: metadata.digest,
    }, null, 2));
    return;
  }
  const foundation = await getFoundationSnapshot(client);
  const capturedAt = new Date().toISOString();
  const baseline = await captureSandboxFoundationBaseline(client, {
    foundationId: foundation.accountid,
    applicantId: foundation.accountid,
    reservedRequestId: randomUUID(),
    capturedAt,
  });
  const verification = await verifySandboxFoundationTransition(client, baseline, {
    startedAt: baseline.capturedAt,
    verifiedAt: new Date().toISOString(),
  });
  const expectedFailure = verification.failures.length === 1
    && verification.failures[0] === 'Active applicant Request census is not exactly the baseline set plus the reserved Request.';
  console.log(JSON.stringify({
    mode: 'READ_ONLY_SANDBOX_ROLLUP_PREFLIGHT',
    target: new URL(SANDBOX_URL).hostname,
    requestCreated: false,
    metadataFields: baseline.metadataFields,
    metadataDigest: baseline.metadataDigest,
    activeRequestCount: baseline.activeRequestCount,
    expectedAfterActiveRequestCount: baseline.expectedAfterActiveRequestCount,
    baselineCaptured: true,
    noWriteVerification: {
      expectedToFailForUnwrittenReservedRequest: true,
      matchedExpectedFailure: expectedFailure,
      verificationOk: verification.ok,
      failureCount: verification.failures.length,
      failures: verification.failures,
    },
  }, null, 2));
  if (!expectedFailure) throw new Error('Read-only Sandbox rollup preflight did not produce its expected no-write result.');
}

main().catch((error) => {
  console.error(`Sandbox rollup read-only preflight failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
});
