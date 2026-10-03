#!/usr/bin/env node

/**
 * Probe: how large are the source documents the Test Request Factory would
 * copy, across one cycle's Requests? Read-only against PRODUCTION: one
 * Dataverse Request listing, each Request's SharePoint document-location rows,
 * and a Graph folder listing per Request. No file is downloaded; sizes come
 * from the listing. Nothing is written anywhere.
 *
 * Step 1, list the cycles (meeting date x fiscal year, with Request counts):
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/absolute/.env.local \
 *     scripts/probe-test-request-source-document-sizes.mjs
 *
 * Step 2, measure one cycle:
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/absolute/.env.local \
 *     scripts/probe-test-request-source-document-sizes.mjs --meeting-date=YYYY-MM-DD
 *
 * Options: --fiscal-year=<value> (instead of or with --meeting-date);
 * --since=YYYY-MM-DD (Requests created on or after; default 18 months ago).
 *
 * One Request's full folder inventory (every file in every SharePoint bucket,
 * not only the seven kinds the Factory copies), to see where a large file
 * lives and whether the Factory would recognize it:
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/absolute/.env.local \
 *     scripts/probe-test-request-source-document-sizes.mjs --request-number=<n>
 *
 * Run history (2026-10-01, S562): the cycle listing and the cycle sweep were
 * run against production (December 2026, June 2026). The throttle retry, the
 * per-request-type breakdown and --request-number were added afterwards and
 * have not been run against production yet.
 *
 * Output: Request numbers, request-type codes, folder names, file extensions,
 * document kinds and sizes only. No titles, applicants, file names or URLs.
 */

import { withDalContext } from '../lib/dataverse/core/context.js';
import { createRequire } from 'module';
import { PRODUCTION_HOSTS } from '../lib/dataverse/core/target-registry.js';
import {
  TEST_REQUEST_PREVIEW_READ_LIMITS,
  createStrictTestRequestSourceDependencies,
  discoverTestRequestSourceDocuments,
} from '../lib/services/test-requests/admin-preview-service.js';

const require = createRequire(import.meta.url);
const { getAccessToken, createClient } = require('../lib/dataverse/client.js');

const MB = 1024 * 1024;
const PAGE_CAP = 5000;
const CONCURRENCY = 2;
const TOTAL_THRESHOLDS_MB = [50, 100, 250];
const FILE_THRESHOLDS_MB = [25, 50, 100, 250];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv) {
  const parsed = { meetingDate: null, fiscalYear: null, since: null, requestNumber: null };
  for (const arg of argv) {
    const [key, value] = arg.split('=');
    if (key === '--meeting-date' && DATE.test(value || '')) parsed.meetingDate = value;
    else if (key === '--fiscal-year' && /^[\w -]{1,20}$/.test(value || '')) parsed.fiscalYear = value;
    else if (key === '--since' && DATE.test(value || '')) parsed.since = value;
    else if (key === '--request-number' && /^\d{1,10}$/.test(value || '')) parsed.requestNumber = value;
    else throw new Error(`Unrecognized or malformed argument: ${key}`);
  }
  if (!parsed.since) {
    const since = new Date();
    since.setMonth(since.getMonth() - 18);
    parsed.since = since.toISOString().slice(0, 10);
  }
  return parsed;
}

function productionHost() {
  let hostname = '';
  try {
    hostname = new URL(process.env.DYNAMICS_URL || '').hostname.toLowerCase();
  } catch {
    // handled below
  }
  if (!PRODUCTION_HOSTS.includes(hostname)) {
    throw new Error('DYNAMICS_URL must be the registered production Dataverse host for this probe.');
  }
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('DATAVERSE_ALLOW_PROD_READS=yes is required for this read-only production probe.');
  }
  return hostname;
}

const meetingDateOf = (row) => (row.wmkf_meetingdate ? String(row.wmkf_meetingdate).slice(0, 10) : '(none)');
const fiscalYearOf = (row) => (row.akoya_fiscalyear == null || row.akoya_fiscalyear === '' ? '(none)' : String(row.akoya_fiscalyear));
const mb = (bytes) => (bytes / MB).toFixed(1);

async function listRequests(client, since) {
  const select = 'akoya_requestid,akoya_requestnum,akoya_requesttype,akoya_fiscalyear,wmkf_meetingdate';
  const filter = encodeURIComponent(`createdon ge ${since}T00:00:00Z`);
  const response = await client.get(`/akoya_requests?$select=${select}&$filter=${filter}&$top=${PAGE_CAP}`);
  if (!response?.ok) throw new Error(`Request listing failed (${response?.status ?? 'no status'}).`);
  const rows = response.body?.value || [];
  if (rows.length >= PAGE_CAP) {
    throw new Error(`Request listing hit the ${PAGE_CAP}-row cap; pass a later --since.`);
  }
  return rows;
}

function printCycles(rows, since) {
  const cycles = new Map();
  for (const row of rows) {
    const key = `${meetingDateOf(row)}\t${fiscalYearOf(row)}`;
    cycles.set(key, (cycles.get(key) || 0) + 1);
  }
  console.log(`Requests created since ${since}: ${rows.length}`);
  console.log('meeting date\tfiscal year\tRequests');
  for (const [key, count] of [...cycles.entries()].sort()) console.log(`${key}\t${count}`);
  console.log('\nRe-run with --meeting-date=YYYY-MM-DD (and/or --fiscal-year=<value>) to measure one cycle.');
}

// Graph throttles a cycle-wide sweep (429, occasionally 503). Wait and retry
// so a throttled listing is not reported as a Request with no documents.
const RETRY_WAITS_MS = [5_000, 15_000, 45_000];
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function listWithRetry(dependencies, library, folder, options) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await dependencies.listFiles(library, folder, options);
    } catch (error) {
      const throttled = error?.status === 429 || error?.status === 503;
      if (!throttled || attempt >= RETRY_WAITS_MS.length) throw error;
      await sleep(RETRY_WAITS_MS[attempt]);
    }
  }
}

// Discovery reports every failed folder listing as SOURCE_BUCKET_UNAVAILABLE.
// Record the underlying status and code per Request, so a folder that simply
// does not exist (404) can be told apart from a throttled or failed listing.
// Expected misses on the archive libraries are not errors and are not recorded.
async function measure(row, dependencies) {
  const listingErrors = [];
  const archiveBuckets = new Set();
  const recording = {
    ...dependencies,
    getRequestSharePointBuckets: async (requestId, requestNumber) => {
      const buckets = await dependencies.getRequestSharePointBuckets(requestId, requestNumber);
      for (const bucket of buckets) if (bucket.source === 'archive') archiveBuckets.add(`${bucket.library}::${bucket.folder}`);
      return buckets;
    },
    listFiles: async (library, folder, options) => {
      try {
        return await listWithRetry(dependencies, library, folder, options);
      } catch (error) {
        const expectedArchiveMiss = archiveBuckets.has(`${library}::${folder}`)
          && error?.status === 404 && error?.code === 'graph_folder_not_found';
        if (!expectedArchiveMiss) listingErrors.push(`${error?.status ?? 'no-status'}/${error?.code ?? 'no-code'}`);
        throw error;
      }
    },
  };
  try {
    const { documents, errors } = await discoverTestRequestSourceDocuments(row, recording);
    return { requestNumber: row.akoya_requestnum, requestType: row.akoya_requesttype, documents, errorCodes: errors.length ? listingErrors : [] };
  } catch (error) {
    return { requestNumber: row.akoya_requestnum, requestType: row.akoya_requesttype, documents: [], errorCodes: [error?.code || 'DISCOVERY_FAILED'] };
  }
}

async function inBatches(items, size, worker) {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(worker)));
  }
  return results;
}

function report(results) {
  const limits = TEST_REQUEST_PREVIEW_READ_LIMITS;
  const perKindMax = new Map();
  const errorTally = new Map();
  const byType = new Map();
  let withDocuments = 0;
  let withErrors = 0;
  let unknownSizes = 0;
  let refusedToday = 0;
  let maxFile = 0;
  let maxTotal = 0;
  const overTotal = new Map(TOTAL_THRESHOLDS_MB.map((threshold) => [threshold, 0]));
  const overFile = new Map(FILE_THRESHOLDS_MB.map((threshold) => [threshold, 0]));

  console.log('request\tfiles\tlargest MB\ttotal MB\tnotes');
  for (const result of results.sort((left, right) => String(left.requestNumber).localeCompare(String(right.requestNumber)))) {
    const sizes = result.documents.map((document) => document.size).filter((size) => Number.isFinite(size));
    unknownSizes += result.documents.length - sizes.length;
    const largest = sizes.length ? Math.max(...sizes) : 0;
    const total = sizes.reduce((sum, size) => sum + size, 0);
    for (const document of result.documents) {
      if (Number.isFinite(document.size)) perKindMax.set(document.kind, Math.max(perKindMax.get(document.kind) || 0, document.size));
    }
    if (result.documents.length) withDocuments += 1;
    const type = byType.get(result.requestType ?? '(none)') || { measured: 0, withDocuments: 0, errored: 0 };
    type.measured += 1;
    if (result.documents.length) type.withDocuments += 1;
    if (result.errorCodes.length) type.errored += 1;
    byType.set(result.requestType ?? '(none)', type);
    if (result.errorCodes.length) withErrors += 1;
    for (const code of result.errorCodes) errorTally.set(code, (errorTally.get(code) || 0) + 1);
    maxFile = Math.max(maxFile, largest);
    maxTotal = Math.max(maxTotal, total);
    for (const threshold of TOTAL_THRESHOLDS_MB) if (total > threshold * MB) overTotal.set(threshold, overTotal.get(threshold) + 1);
    for (const threshold of FILE_THRESHOLDS_MB) if (largest > threshold * MB) overFile.set(threshold, overFile.get(threshold) + 1);
    const refused = result.documents.length > limits.maxFiles || largest > limits.maxFileBytes || total > limits.maxTotalBytes;
    if (refused) refusedToday += 1;
    const notes = [refused ? 'OVER CURRENT LIMITS' : '', ...new Set(result.errorCodes)].filter(Boolean).join(', ');
    console.log(`${result.requestNumber}\t${result.documents.length}\t${mb(largest)}\t${mb(total)}\t${notes}`);
  }

  console.log('\nSummary');
  console.log(`Requests measured: ${results.length}`);
  console.log(`  with at least one recognized document: ${withDocuments}`);
  console.log(`  with a discovery error (sizes may be incomplete): ${withErrors}`);
  for (const [code, count] of [...errorTally.entries()].sort()) console.log(`    folder listings failing with ${code}: ${count}`);
  console.log(`  documents with no size in the listing: ${unknownSizes}`);
  console.log('By request type code (measured / with recognized documents / listing errors):');
  for (const [type, tally] of [...byType.entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0])))) {
    console.log(`  ${type}: ${tally.measured} / ${tally.withDocuments} / ${tally.errored}`);
  }
  console.log(`Largest single file: ${mb(maxFile)} MB; largest Request total: ${mb(maxTotal)} MB`);
  console.log(`Refused by today's limits (${limits.maxFiles} files, ${mb(limits.maxFileBytes)} MB per file, ${mb(limits.maxTotalBytes)} MB total): ${refusedToday}`);
  for (const [threshold, count] of overFile) console.log(`  Requests whose largest file exceeds ${threshold} MB: ${count}`);
  for (const [threshold, count] of overTotal) console.log(`  Requests whose total exceeds ${threshold} MB: ${count}`);
  console.log('Largest file by document kind:');
  for (const [kind, size] of [...perKindMax.entries()].sort()) console.log(`  ${kind}: ${mb(size)} MB`);
}

// Every file in every bucket of one Request, with the kind the Factory would
// assign it (or '-' when the Factory would not copy it).
async function inventory(client, requestNumber, dependencies) {
  const select = 'akoya_requestid,akoya_requestnum,akoya_requesttype,akoya_fiscalyear,wmkf_meetingdate';
  const filter = encodeURIComponent(`akoya_requestnum eq '${requestNumber}'`);
  const response = await client.get(`/akoya_requests?$select=${select}&$filter=${filter}&$top=2`);
  if (!response?.ok) throw new Error(`Request lookup failed (${response?.status ?? 'no status'}).`);
  const rows = response.body?.value || [];
  if (rows.length !== 1) throw new Error(`Expected exactly one Request numbered ${requestNumber}; found ${rows.length}.`);
  const row = rows[0];
  console.log(`Request ${row.akoya_requestnum}: type code ${row.akoya_requesttype}, fiscal year ${fiscalYearOf(row)}, meeting date ${meetingDateOf(row)}`);

  await withDalContext('probe-test-request-source-document-sizes', async () => {
    const { documents } = await discoverTestRequestSourceDocuments(row, dependencies);
    const kindByItem = new Map(documents.map((document) => [document.graphItemId, document.kind]));
    const buckets = await dependencies.getRequestSharePointBuckets(row.akoya_requestid, row.akoya_requestnum);
    console.log('bucket\tlibrary\tfolder\textension\tMB\tFactory kind');
    let total = 0;
    let count = 0;
    for (const bucket of buckets) {
      let files;
      try {
        files = await listWithRetry(dependencies, bucket.library, bucket.folder, { recursive: true, maxDepth: 3, maxFiles: 200, failOnTruncation: true });
      } catch (error) {
        console.log(`${bucket.source}\t${bucket.library}\t(listing failed: ${error?.status ?? 'no-status'}/${error?.code ?? 'no-code'})`);
        continue;
      }
      for (const file of files) {
        const folder = String(file.folder || bucket.folder).split('/').filter(Boolean).slice(1).join('/') || '(root)';
        const extension = String(file.name || '').includes('.') ? String(file.name).split('.').pop().toLowerCase() : '(none)';
        const size = Number.isFinite(file.size) ? file.size : 0;
        total += size;
        count += 1;
        console.log(`${bucket.source}\t${bucket.library}\t${folder}\t${extension}\t${mb(size)}\t${kindByItem.get(file.id) || '-'}`);
      }
    }
    const copied = documents.reduce((sum, document) => sum + (Number.isFinite(document.size) ? document.size : 0), 0);
    console.log(`\n${count} files, ${mb(total)} MB in all; the Factory would copy ${documents.length} of them, ${mb(copied)} MB.`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const hostname = productionHost();
  const resourceUrl = `https://${hostname}`;
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  if (args.requestNumber) {
    await inventory(client, args.requestNumber, createStrictTestRequestSourceDependencies());
    return;
  }
  const rows = await listRequests(client, args.since);

  if (!args.meetingDate && !args.fiscalYear) {
    printCycles(rows, args.since);
    return;
  }
  const selected = rows.filter((row) => (!args.meetingDate || meetingDateOf(row) === args.meetingDate)
    && (!args.fiscalYear || fiscalYearOf(row) === args.fiscalYear)
    && row.akoya_requestid && row.akoya_requestnum);
  console.log(`Cycle filter: meeting date ${args.meetingDate || '(any)'}, fiscal year ${args.fiscalYear || '(any)'}; ${selected.length} of ${rows.length} Requests created since ${args.since}`);
  if (!selected.length) return;

  const dependencies = createStrictTestRequestSourceDependencies();
  const results = await withDalContext('probe-test-request-source-document-sizes', () => (
    inBatches(selected, CONCURRENCY, (row) => measure(row, dependencies))
  ));
  report(results);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
