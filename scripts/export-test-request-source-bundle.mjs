#!/usr/bin/env node

/**
 * Export one production Grant Request as a private Test Request source bundle
 * (design decision 6, option A). Read-only: one Dataverse Request lookup, its
 * SharePoint document-location rows, a Graph listing of its folders, and a
 * byte download of each recognized source document to hash it. Nothing is
 * written anywhere except the new bundle file.
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/absolute/.env.local \
 *     scripts/export-test-request-source-bundle.mjs \
 *     --source-request-number=<number> --out=/absolute/private/bundle.json
 *
 * The bundle contains source text; it is written with mode 0600 to a new
 * absolute path outside the repository and never printed. Stdout carries only
 * the summary (identities, counts, hash prefixes).
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import { requireUniqueSourceRequest } from '../lib/services/test-requests/sandbox-clone.js';
import {
  TEST_REQUEST_ADMIN_PREVIEW_DEPENDENCIES,
  assertTestRequestSourceReadLimits,
  discoverTestRequestSourceDocuments,
  hydrateTestRequestSourceDocument,
} from '../lib/services/test-requests/admin-preview-service.js';
import { buildSourceBundle, summarizeSourceBundle } from '../lib/services/test-requests/source-bundle.js';

const require = createRequire(import.meta.url);
const { getAccessToken, createClient } = require('../lib/dataverse/client.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_requesttype', 'akoya_purpose',
  'akoya_request', 'akoya_fiscalyear', 'wmkf_meetingdate', 'versionnumber',
].join(',');

function parseArgs(argv) {
  const parsed = { sourceRequestNumber: null, out: null, help: false };
  for (const arg of argv) {
    if (arg.startsWith('--source-request-number=')) parsed.sourceRequestNumber = arg.slice('--source-request-number='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.help) return parsed;
  if (!/^\d{1,10}$/.test(parsed.sourceRequestNumber || '')) {
    throw new Error('--source-request-number must be bounded digits.');
  }
  if (!parsed.out || !path.isAbsolute(parsed.out)) throw new Error('--out must be an absolute path.');
  const relative = path.relative(ROOT, path.resolve(parsed.out));
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('--out must be outside the repository; the bundle contains source text.');
  }
  if (fs.existsSync(parsed.out)) throw new Error('--out already exists; choose a new path.');
  return parsed;
}

function productionHost() {
  let hostname = null;
  try {
    hostname = new URL(process.env.DYNAMICS_URL || '').hostname.toLowerCase();
  } catch {
    // handled below
  }
  if (!PRODUCTION_HOSTS.includes(hostname)) {
    throw new Error('DYNAMICS_URL must be the registered production Dataverse host for a source-bundle export.');
  }
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('DATAVERSE_ALLOW_PROD_READS=yes is required for this read-only production export.');
  }
  return hostname;
}

function bodyOrThrow(label, response) {
  if (!response?.ok) {
    const detail = String(response?.text || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
    throw new Error(`${label} failed (${response?.status ?? 'no status'}): ${detail}`);
  }
  return response.body || {};
}

async function readSourceRow(client, requestNumber) {
  const filter = encodeURIComponent(`akoya_requestnum eq '${requestNumber}'`);
  const body = bodyOrThrow(
    'source Request lookup',
    await client.get(`/akoya_requests?$select=${SOURCE_SELECT}&$filter=${filter}&$top=2`),
  );
  const rows = body.value || [];
  requireUniqueSourceRequest(rows, Boolean(body['@odata.nextLink']));
  return rows[0];
}

async function readSourceRevision(client, requestId) {
  const body = bodyOrThrow(
    'source Request revalidation',
    await client.get(`/akoya_requests(${requestId})?$select=akoya_requestid,versionnumber`),
  );
  return body.versionnumber == null ? null : String(body.versionnumber);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/abs/.env.local '
      + 'scripts/export-test-request-source-bundle.mjs --source-request-number=<n> --out=/abs/bundle.json');
    return;
  }
  const hostname = productionHost();
  const resourceUrl = `https://${hostname}`;
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });

  const sourceRow = await readSourceRow(client, args.sourceRequestNumber);
  const requestId = sourceRow.akoya_requestid.toLowerCase();
  const documents = await withDalContext('export-test-request-source-bundle', async () => {
    const inventory = await discoverTestRequestSourceDocuments(
      { akoya_requestid: requestId, akoya_requestnum: String(sourceRow.akoya_requestnum) },
      TEST_REQUEST_ADMIN_PREVIEW_DEPENDENCIES,
    );
    if (inventory.errors.length) {
      throw new Error(`Source document inventory is incomplete: ${inventory.errors.map((e) => `${e.source}:${e.code}`).join(', ')}.`);
    }
    assertTestRequestSourceReadLimits(inventory.documents);
    const hydrated = [];
    for (const document of inventory.documents) {
      const version = await hydrateTestRequestSourceDocument(document, TEST_REQUEST_ADMIN_PREVIEW_DEPENDENCIES);
      hydrated.push({ ...version, graphItemId: document.graphItemId });
    }
    return hydrated;
  });

  const revisionAfter = await readSourceRevision(client, requestId);
  if (revisionAfter !== String(sourceRow.versionnumber)) {
    throw new Error('Source Request changed during export; rerun to capture a consistent bundle.');
  }

  const bundle = buildSourceBundle({ sourceRow, documents, dataverseHost: hostname, exportedAt: new Date() });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ written: args.out, ...summarizeSourceBundle(bundle) }, null, 2));
}

main().catch((error) => {
  console.error(`[export-test-request-source-bundle] ${error.message}`);
  process.exit(1);
});
