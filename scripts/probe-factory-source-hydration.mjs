#!/usr/bin/env node
/**
 * Read-only, bounded reproduction of the Factory XLSX hydration guard.
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/absolute/.env.local
 *   scripts/probe-factory-source-hydration.mjs --request-number=1234567
 * Reads one exact production Request and its recognized XLSX documents, three
 * times sequentially. No bundles, contents, URLs, names or secrets are printed
 * or saved. Output contains sizes/hashes and sanitized success/failure codes.
 */
import { createRequire } from 'node:module';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import {
  createStrictTestRequestSourceDependencies,
  discoverTestRequestSourceDocuments,
  hydrateTestRequestSourceDocument,
  assertTestRequestSourceReadLimits,
} from '../lib/services/test-requests/admin-preview-service.js';

const require = createRequire(import.meta.url);
const { getAccessToken, createClient } = require('../lib/dataverse/client.js');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^--request-number=\d{1,10}$/.test(args[0])) {
    throw new Error('invalid_arguments');
  }
  const requestNumber = args[0].split('=')[1];
  const hostname = new URL(process.env.DYNAMICS_URL || '').hostname.toLowerCase();
  if (!PRODUCTION_HOSTS.includes(hostname) || process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('production_read_ack_required');
  }
  const resourceUrl = `https://${hostname}`;
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const response = await client.get(`/akoya_requests?$select=akoya_requestid,akoya_requestnum&$filter=${encodeURIComponent(`akoya_requestnum eq '${requestNumber}'`)}&$top=2`);
  if (!response.ok || response.body?.value?.length !== 1) throw new Error('exact_request_required');
  const dependencies = createStrictTestRequestSourceDependencies();
  await withDalContext('probe-factory-source-hydration', async () => {
    const { documents, errors } = await discoverTestRequestSourceDocuments(response.body.value[0], dependencies);
    if (errors.length) throw new Error('incomplete_inventory');
    const selected = documents.filter(document => /\.xlsx$/i.test(document.name));
    if (!selected.length) throw new Error('no_xlsx');
    assertTestRequestSourceReadLimits(selected);
    const report = { checkedAt: new Date().toISOString(), readOnly: true, requestNumber, documents: [] };
    for (const document of selected) {
      const samples = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await hydrateTestRequestSourceDocument(document, dependencies);
          samples.push({ attempt, ok: true, bytes: result.size, sha256: result.contentHash });
        } catch (error) {
          samples.push({ attempt, ok: false, code: error?.code === 'test_request_preview_source_changed' ? error.code : 'hydration_failed' });
          process.exitCode = 1;
        }
      }
      report.documents.push({ samples, allHashesMatch: samples.every(sample => sample.ok) && new Set(samples.map(sample => sample.sha256)).size === 1 });
    }
    console.log(JSON.stringify(report, null, 2));
  });
}
main().catch(() => { console.error('Factory hydration probe failed; check arguments, read authorization and inventory.'); process.exitCode = 1; });
