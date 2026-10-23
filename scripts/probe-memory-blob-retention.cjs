#!/usr/bin/env node
/**
 * Aggregate-only Vercel Blob metadata probe for two historical prefixes.
 *
 * Default mode is plan-only. Listing can consume Vercel Blob API usage and is
 * blocked unless both --execute and --authorize-metered-list are supplied.
 * The latter flag is an explicit acknowledgement of the owner's named
 * Vercel Blob list approval; it is not a substitute for obtaining that
 * approval. This probe only calls the SDK list API. It never reads blob
 * contents, performs HEAD/GET/PUT/DELETE, or emits item-level metadata.
 *
 * Safe aggregate evidence is written to the fixed default path after an
 * authorized execution, including incomplete store results. No token, URL,
 * pathname, cursor, ETag, raw error, or item record is persisted or printed.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_PATH = path.join(ROOT, 'docs/audits/blob-retention-metadata-evidence-2026-10-22.json');
const PAGE_LIMIT = 1000;
const MAX_PAGES_PER_STORE = 5;
const AGE_BUCKETS = Object.freeze([
  ['under30Days', 0, 30],
  ['30To89Days', 30, 90],
  ['90To179Days', 90, 180],
  ['180To364Days', 180, 365],
  ['365DaysOrMore', 365, Infinity],
]);

const STORES = Object.freeze([
  Object.freeze({
    name: 'shared-public-reviewer-finder',
    prefix: 'reviewer-finder/',
    tokenEnv: 'BLOB_READ_WRITE_TOKEN',
  }),
  Object.freeze({
    name: 'private-dataverse-export',
    prefix: 'dataverse-export/',
    tokenEnv: 'DVX_BLOB_RW_TOKEN',
  }),
]);

function parseArgs(argv) {
  const known = new Set(['--execute', '--authorize-metered-list', '--public-only', '--help']);
  for (const arg of argv) {
    if (!known.has(arg)) throw new Error('unknown_argument');
  }
  return {
    execute: argv.includes('--execute'),
    authorizeMeteredList: argv.includes('--authorize-metered-list'),
    help: argv.includes('--help'),
    publicOnly: argv.includes('--public-only'),
  };
}

function requireExecutionAuthorization(options) {
  if (!options?.execute || !options?.authorizeMeteredList) {
    throw new Error('metered_list_authorization_required');
  }
}

function validateCredentials(env) {
  const shared = typeof env?.BLOB_READ_WRITE_TOKEN === 'string' ? env.BLOB_READ_WRITE_TOKEN.trim() : '';
  const dataverseExport = typeof env?.DVX_BLOB_RW_TOKEN === 'string' ? env.DVX_BLOB_RW_TOKEN.trim() : '';
  if (!shared || !dataverseExport) throw new Error('required_blob_credentials_missing');
  if (shared === dataverseExport) throw new Error('blob_credentials_must_be_distinct');
  return {
    BLOB_READ_WRITE_TOKEN: shared,
    DVX_BLOB_RW_TOKEN: dataverseExport,
  };
}

function emptyStoreSummary(store) {
  return {
    name: store.name,
    prefix: store.prefix,
    complete: false,
    pages: 0,
    rowsSeen: 0,
    validRows: 0,
    invalidRows: 0,
    bytes: 0,
    ageBuckets: Object.fromEntries(AGE_BUCKETS.map(([name]) => [name, 0])),
    oldestAgeDays: null,
    newestAgeDays: null,
    failure: null,
  };
}

function dateValueMs(uploadedAt) {
  if (uploadedAt instanceof Date) return uploadedAt.getTime();
  if (typeof uploadedAt === 'string' || typeof uploadedAt === 'number') return new Date(uploadedAt).getTime();
  return NaN;
}

function addBlobMetadata(summary, blob, nowMs) {
  summary.rowsSeen += 1;

  const pathnameMatches = typeof blob?.pathname === 'string'
    && blob.pathname.startsWith(summary.prefix);
  const size = blob?.size;
  const uploadedAtMs = dateValueMs(blob?.uploadedAt);
  const ageMs = nowMs - uploadedAtMs;
  const validSize = Number.isSafeInteger(size) && size >= 0;
  const validDate = Number.isFinite(uploadedAtMs) && Number.isFinite(ageMs) && ageMs >= 0;
  const validTotal = validSize && Number.isSafeInteger(summary.bytes + size);

  if (!pathnameMatches || !validSize || !validDate || !validTotal) {
    summary.invalidRows += 1;
    return;
  }

  const ageDays = Math.floor(ageMs / 86_400_000);
  summary.validRows += 1;
  summary.bytes += size;
  for (const [bucket, minDays, maxDays] of AGE_BUCKETS) {
    if (ageDays >= minDays && ageDays < maxDays) {
      summary.ageBuckets[bucket] += 1;
      break;
    }
  }
  summary.oldestAgeDays = summary.oldestAgeDays === null
    ? ageDays : Math.max(summary.oldestAgeDays, ageDays);
  summary.newestAgeDays = summary.newestAgeDays === null
    ? ageDays : Math.min(summary.newestAgeDays, ageDays);
}

async function collectStoreMetadata({ store, token, listFn, nowMs = Date.now() }) {
  const summary = emptyStoreSummary(store);
  let cursor;
  let hasMore = true;
  const seenCursors = new Set();

  while (hasMore && summary.pages < MAX_PAGES_PER_STORE) {
    const options = { prefix: store.prefix, limit: PAGE_LIMIT, mode: 'expanded', token };
    if (cursor !== undefined) options.cursor = cursor;

    let page;
    summary.pages += 1;
    try {
      page = await listFn(options);
    } catch {
      summary.failure = 'list_request_failed';
      break;
    }

    if (!page || !Array.isArray(page.blobs) || typeof page.hasMore !== 'boolean') {
      summary.failure = 'invalid_page_shape';
      break;
    }

    if (page.blobs.length > PAGE_LIMIT) {
      summary.failure = 'page_row_limit_exceeded';
      break;
    }
    for (const blob of page.blobs) addBlobMetadata(summary, blob, nowMs);
    if (summary.invalidRows > 0) {
      summary.failure = 'invalid_metadata_rows';
      break;
    }

    hasMore = page.hasMore;
    if (!hasMore) break;
    if (typeof page.cursor !== 'string' || page.cursor.trim().length === 0) {
      summary.failure = 'missing_cursor';
      break;
    }
    if (seenCursors.has(page.cursor)) {
      summary.failure = 'repeated_cursor';
      break;
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }

  if (!summary.failure && hasMore && summary.pages >= MAX_PAGES_PER_STORE) {
    summary.failure = 'page_limit_reached';
  }
  if (!summary.failure && summary.invalidRows > 0) {
    summary.failure = 'invalid_metadata_rows';
  }
  summary.complete = !hasMore && summary.failure === null;
  return summary;
}

async function runProbe({ listFn, env, nowMs = Date.now() }) {
  const credentials = validateCredentials(env);
  const stores = [];

  for (const store of STORES) {
    stores.push(await collectStoreMetadata({
      store,
      token: credentials[store.tokenEnv],
      listFn,
      nowMs,
    }));
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    scope: 'Vercel Blob metadata for the two allowlisted prefixes',
    aggregationBasis: 'bytes and age statistics include fully valid rows only; any invalid row makes that store incomplete',
    complete: stores.every((store) => store.complete),
    stores,
  };
}

function createPlan() {
  return {
    mode: 'plan-only',
    listingAuthorized: false,
    sdkOperation: 'list',
    pageLimit: PAGE_LIMIT,
    maxPagesPerStore: MAX_PAGES_PER_STORE,
    artifact: 'docs/audits/blob-retention-metadata-evidence-2026-10-22.json',
    stores: STORES.map(({ name, prefix, tokenEnv }) => ({ name, prefix, tokenEnv })),
    executionGate: 'requires --execute --authorize-metered-list and distinct local tokens',
  };
}

function usage() {
  return [
    'Usage: node scripts/probe-memory-blob-retention.cjs [--execute --authorize-metered-list]',
    'Default: print a plan only; no Blob API calls are made.',
    'Execution requires explicit authorization for the potentially metered Vercel Blob list operation.',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`Probe stopped safely: ${error.message === 'unknown_argument' ? 'unknown_argument' : 'invalid_arguments'}`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.execute) {
    console.log(JSON.stringify(createPlan(), null, 2));
    return;
  }
  try {
    requireExecutionAuthorization(options);
  } catch {
    console.error('Probe stopped safely: metered_list_authorization_required');
    process.exitCode = 2;
    return;
  }

  // Read only the two credential names into a private object; never mutate
  // process.env or initialize application runtime modules.
  const localEnv = { BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN, DVX_BLOB_RW_TOKEN: process.env.DVX_BLOB_RW_TOKEN };
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^(BLOB_READ_WRITE_TOKEN|DVX_BLOB_RW_TOKEN)=(.*)$/);
    if (match && !localEnv[match[1]]) localEnv[match[1]] = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
  }
  let env;
  try {
    env = options.publicOnly
      ? { BLOB_READ_WRITE_TOKEN: typeof localEnv.BLOB_READ_WRITE_TOKEN === 'string' ? localEnv.BLOB_READ_WRITE_TOKEN.trim() : '' }
      : validateCredentials(localEnv);
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error('required_blob_credentials_missing');
  } catch (error) {
    console.error(`Probe stopped safely: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (fs.existsSync(ARTIFACT_PATH)) {
    console.error('Probe stopped safely: artifact_already_exists');
    process.exitCode = 2;
    return;
  }

  const { list } = require('@vercel/blob');
  const summary = options.publicOnly
    ? {
        generatedAt: new Date().toISOString(),
        scope: 'Local configured shared-store reviewer-finder prefix only; deployed store identity not established',
        complete: false,
        stores: [
          await collectStoreMetadata({ store: STORES[0], token: env.BLOB_READ_WRITE_TOKEN, listFn: list }),
          { name: STORES[1].name, complete: false, failure: 'private_store_not_listed_local_credential_unavailable' },
        ],
      }
    : await runProbe({ listFn: list, env });

  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.complete) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(() => {
    // Never surface raw SDK or filesystem errors; they can contain URLs or
    // request details. The aggregate artifact is not claimed on this path.
    console.error('Probe failed safely: unexpected_error');
    process.exitCode = 1;
  });
}

module.exports = {
  AGE_BUCKETS,
  ARTIFACT_PATH,
  MAX_PAGES_PER_STORE,
  PAGE_LIMIT,
  STORES,
  addBlobMetadata,
  collectStoreMetadata,
  createPlan,
  parseArgs,
  requireExecutionAuthorization,
  runProbe,
  validateCredentials,
};
