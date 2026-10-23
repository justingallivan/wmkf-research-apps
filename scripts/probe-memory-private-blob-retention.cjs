#!/usr/bin/env node

/**
 * Bounded, private-only metadata probe for the Dataverse export Blob store.
 * Default execution is plan-only. Listing can consume Blob API allowance.
 * --authorize-metered-list acknowledges the existing named human approval; it creates no new approval.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  collectStoreMetadata: collectBlobStoreMetadata,
  MAX_PAGES_PER_STORE,
  PAGE_LIMIT,
  STORES,
} = require('./probe-memory-blob-retention.cjs');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_PATH = path.join(ROOT, 'docs/audits/private-blob-retention-prepared-evidence-2026-10-22.json');
const PRIVATE_STORE_FINGERPRINT = 'ffb75e44e30e';
const KNOWN_PUBLIC_STORE_FINGERPRINT = '6060259031fd';
const STORE = STORES[1];

function parseArgs(argv) {
  const known = new Set(['--execute', '--authorize-metered-list', '--help']);
  for (const arg of argv) {
    if (!known.has(arg)) throw new Error('invalid_arguments');
  }
  return {
    execute: argv.includes('--execute'),
    authorizeMeteredList: argv.includes('--authorize-metered-list'),
    help: argv.includes('--help'),
  };
}

function requireExecutionAuthorization(options) {
  if (!options?.execute || !options?.authorizeMeteredList) {
    throw new Error('metered_list_authorization_required');
  }
}

function extractTokenStoreId(token) {
  if (typeof token !== 'string') return null;
  const segments = token.trim().split('_');
  if (segments[0] !== 'vercel' || segments[1] !== 'blob' || segments[2] !== 'rw'
      || segments.length < 5 || !segments[4]) return null;
  // Vercel RW tokens encode the store ID in segment four; the secret follows it.
  return /^[A-Za-z0-9]+$/.test(segments[3] || '') ? segments[3] : null;
}

function fingerprintStoreId(storeId) {
  return crypto.createHash('sha256').update(`store_${storeId}`).digest('hex').slice(0, 12);
}

function validatePrivateCredential(env, {
  fingerprintFn = fingerprintStoreId,
  privateFingerprint = PRIVATE_STORE_FINGERPRINT,
  publicFingerprint = KNOWN_PUBLIC_STORE_FINGERPRINT,
} = {}) {
  const token = typeof env?.DVX_BLOB_RW_TOKEN === 'string' ? env.DVX_BLOB_RW_TOKEN.trim() : '';
  if (!token) throw new Error('private_blob_credential_missing');
  const shared = typeof env?.BLOB_READ_WRITE_TOKEN === 'string' ? env.BLOB_READ_WRITE_TOKEN.trim() : '';
  if (shared && shared === token) throw new Error('private_blob_credential_matches_shared_token');

  const storeId = extractTokenStoreId(token);
  if (!storeId) throw new Error('private_blob_token_shape_invalid');
  const fingerprint = fingerprintFn(storeId);
  if (fingerprint === publicFingerprint) throw new Error('private_blob_token_matches_known_public_store');
  if (fingerprint !== privateFingerprint) throw new Error('private_blob_store_fingerprint_unrecognized');
  return { token, candidateFingerprintMatches: true };
}

function collectPrivateStoreMetadata({ token, listFn, nowMs = Date.now() }) {
  return collectBlobStoreMetadata({ store: STORE, token, listFn, nowMs });
}

function createPlan() {
  return {
    mode: 'plan-only',
    listingAuthorized: false,
    sdkOperation: 'list',
    store: STORE.name,
    prefix: STORE.prefix,
    pageLimit: PAGE_LIMIT,
    maxPages: MAX_PAGES_PER_STORE,
    retries: 0,
    artifact: 'docs/audits/private-blob-retention-prepared-evidence-2026-10-22.json',
    bindingBasis: 'candidate-name fingerprint only; not runtime or Production proof',
    authorizationMeaning: '--authorize-metered-list acknowledges existing named human approval; it creates no new approval',
    executionGate: 'requires --execute --authorize-metered-list, a candidate store fingerprint match, and a new artifact path',
  };
}

function usage() {
  return [
    'Usage: node scripts/probe-memory-private-blob-retention.cjs [--execute --authorize-metered-list]',
    'Default: print a plan only; no Blob SDK import or API call is made.',
    'The flags acknowledge the existing named human metered-list approval; they do not create new approval.',
    'Execution lists at most five private-store pages (1,000 rows each), with SDK retries disabled, and may consume Blob API allowance.',
  ].join('\n');
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const runtime = dependencies.runtime || process;
  const env = dependencies.env || runtime.env;
  const fsImpl = dependencies.fs || fs;
  const log = dependencies.log || console.log;
  const errorLog = dependencies.errorLog || console.error;
  let options;
  try {
    options = parseArgs(argv);
  } catch {
    errorLog('Probe stopped safely: invalid_arguments');
    return 2;
  }
  if (options.help) {
    log(usage());
    return 0;
  }
  if (!options.execute) {
    log(JSON.stringify(createPlan(), null, 2));
    return 0;
  }
  try {
    requireExecutionAuthorization(options);
  } catch {
    errorLog('Probe stopped safely: metered_list_authorization_required');
    return 2;
  }
  if (fsImpl.existsSync(ARTIFACT_PATH)) {
    errorLog('Probe stopped safely: artifact_already_exists');
    return 2;
  }

  let credential;
  try {
    credential = validatePrivateCredential(env, dependencies.credentialValidationOptions);
  } catch (error) {
    const safeCodes = new Set([
      'private_blob_credential_missing',
      'private_blob_credential_matches_shared_token',
      'private_blob_token_shape_invalid',
      'private_blob_token_matches_known_public_store',
      'private_blob_store_fingerprint_unrecognized',
    ]);
    errorLog(`Probe stopped safely: ${safeCodes.has(error.message) ? error.message : 'credential_validation_failed'}`);
    return 2;
  }

  let listFn;
  try {
    // Must be set in this process before the SDK is loaded so list calls do not retry.
    runtime.env.VERCEL_BLOB_RETRIES = '0';
    listFn = dependencies.loadList
      ? dependencies.loadList()
      : require('@vercel/blob').list;
  } catch {
    errorLog('Probe stopped safely: sdk_load_failed');
    return 2;
  }

  const nowMs = dependencies.nowMs ?? Date.now();
  let storeSummary;
  try {
    storeSummary = await collectPrivateStoreMetadata({ token: credential.token, listFn, nowMs });
  } catch {
    errorLog('Probe stopped safely: unexpected_error');
    return 1;
  }
  const summary = {
    generatedAt: new Date(nowMs).toISOString(),
    scope: 'Private Dataverse export Blob metadata for the allowlisted prefix only',
    credentialSource: 'process.env',
    runtimeBinding: 'unverified',
    candidateFingerprintMatches: credential.candidateFingerprintMatches,
    bindingBasis: 'candidate-name fingerprint only; not runtime or Production proof',
    aggregationBasis: 'counts, bytes, and ages include fully valid rows only; any invalid row makes the store incomplete',
    complete: storeSummary.complete,
    store: storeSummary,
  };

  try {
    fsImpl.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fsImpl.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } catch {
    errorLog('Probe stopped safely: artifact_write_failed');
    return 1;
  }
  log(JSON.stringify(summary, null, 2));
  return summary.complete ? 0 : 1;
}

if (require.main === module) {
  main().then((status) => { process.exitCode = status; }).catch(() => {
    console.error('Probe failed safely: unexpected_error');
    process.exitCode = 1;
  });
}

module.exports = {
  ARTIFACT_PATH,
  KNOWN_PUBLIC_STORE_FINGERPRINT,
  MAX_PAGES_PER_STORE,
  PAGE_LIMIT,
  PRIVATE_STORE_FINGERPRINT,
  STORE,
  collectPrivateStoreMetadata,
  createPlan,
  extractTokenStoreId,
  fingerprintStoreId,
  main,
  parseArgs,
  requireExecutionAuthorization,
  validatePrivateCredential,
};
