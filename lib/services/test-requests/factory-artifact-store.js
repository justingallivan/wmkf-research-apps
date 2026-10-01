/**
 * Private Blob store for the admin Test Request Factory form's source bundle
 * and run manifest (plan 2b). The ledger never holds source text, so the form
 * keeps both here, under pathnames minted ONLY by this module and bound to the
 * target and (for drafts) the actor:
 *
 *   <target>/drafts/<actorId>/<draftId>/bundle.json
 *   <target>/runs/<runId>/{bundle,manifest}.json
 *
 * Token: FACTORY_BLOB_RW_TOKEN, never the shared, intake or uploads tokens.
 * Writes are create-only and any put error is a refusal: unlike the dossier
 * store, a failed put is never read back as success. Only the maintenance
 * sweep (sweepFactoryArtifacts) deletes; it never touches a run that can
 * still advance. Every @vercel/blob function is injectable for tests.
 */

import crypto from 'crypto';
import { ServiceHttpError } from '../service-http-error.js';
import { createRunLedger } from './run-ledger.js';
import { pgLedgerDb } from './run-ledger-db.js';
import { targetFromDeployment } from './admin-run-identity.js';
import { requireLedgerUrl } from '../../db/ledger-guard.js';

export const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;
// The manifest embeds the whole bundle (basic-clone-steps.js buildCloneManifest), so
// its cap is the bundle cap plus room for the compiled create body and plan.
export const MAX_MANIFEST_BYTES = MAX_BUNDLE_BYTES + 2 * 1024 * 1024;
export const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const UNRESERVED_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SWEEP_LIST_LIMIT = 100; // default page bound for list()
// The sweep scans further than it deletes: protected runs (prepared,
// needs_attention, retired) stay in the listing forever, so a listing cap equal
// to the delete cap would starve later runs once enough of those accumulate.
export const SWEEP_SCAN_LIMIT = 1000; // objects per prefix per sweep
export const SWEEP_DELETE_LIMIT = 200; // deletions per sweep; the rest wait for tomorrow

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR = /^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TARGETS = new Set(['sandbox', 'production']);
const RUN_FILES = new Set(['bundle', 'manifest']);
const MAX_BYTES_BY_FILE = { bundle: MAX_BUNDLE_BYTES, manifest: MAX_MANIFEST_BYTES };
const RUN_PATH = /^(sandbox|production)\/runs\/([0-9a-f-]{36})\/(bundle|manifest)\.json$/i;
const DRAFT_PATH = /^(sandbox|production)\/drafts\/(admin:[0-9a-f-]{36})\/([0-9a-f-]{36})\/bundle\.json$/i;

function storeError(message, httpStatus, code) {
  return new ServiceHttpError(message, { httpStatus, code });
}

function guidOrThrow(label, value) {
  if (typeof value !== 'string' || !GUID.test(value)) throw storeError(`${label} must be a GUID.`, 400, 'factory_artifact_invalid_id');
  return value.toLowerCase();
}

function targetOrThrow(target) {
  if (!TARGETS.has(target)) throw storeError('Target must be sandbox or production.', 400, 'factory_artifact_invalid_target');
  return target;
}

export function draftPathname(target, actorId, draftId) {
  targetOrThrow(target);
  if (typeof actorId !== 'string' || !ACTOR.test(actorId)) throw storeError('Actor id is not a Factory actor.', 400, 'factory_artifact_invalid_id');
  return `${target}/drafts/${actorId}/${guidOrThrow('draftId', draftId)}/bundle.json`;
}

export function runPathname(target, runId, file) {
  targetOrThrow(target);
  if (!RUN_FILES.has(file)) throw storeError('Unknown run artifact.', 400, 'factory_artifact_invalid_id');
  return `${target}/runs/${guidOrThrow('runId', runId)}/${file}.json`;
}

/** The only pathnames this store will touch; anything else is refused. */
function assertMintedPathname(pathname) {
  if (typeof pathname !== 'string' || !(RUN_PATH.test(pathname) || DRAFT_PATH.test(pathname))) {
    throw storeError('Unrecognized Factory artifact pathname.', 400, 'factory_artifact_invalid_id');
  }
  return pathname;
}

function maxBytesFor(pathname) {
  return pathname.endsWith('/manifest.json') ? MAX_BYTES_BY_FILE.manifest : MAX_BYTES_BY_FILE.bundle;
}

export function artifactDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isNotFound(error) {
  return error?.name === 'BlobNotFoundError' || error?.status === 404 || /not found/i.test(error?.message || '');
}

async function defaultBlob() {
  const { put, get, del, list } = await import('@vercel/blob');
  return { put, get, del, list };
}

export function createFactoryArtifactStore({ env = process.env, blob = null } = {}) {
  const token = () => {
    if (!env?.FACTORY_BLOB_RW_TOKEN) throw storeError('The Factory artifact store has not been configured.', 503, 'factory_store_unconfigured');
    return env.FACTORY_BLOB_RW_TOKEN;
  };
  const blobFns = async () => blob ?? defaultBlob();

  return {
    draftPathname,
    runPathname,

    /** Serialize and size-check without writing; returns the bytes. */
    assertFits(pathname, value) {
      assertMintedPathname(pathname);
      const bytes = Buffer.from(JSON.stringify(value), 'utf8');
      if (bytes.length > maxBytesFor(pathname)) throw storeError('Factory artifact exceeds its size limit.', 413, 'factory_artifact_too_large');
      return bytes;
    },

    /** Create-only write of a JSON document. An existing object or any put error is a refusal. */
    async putCreateOnly(pathname, value) {
      const bytes = this.assertFits(pathname, value);
      const accessToken = token();
      const { put } = await blobFns();
      try {
        await put(pathname, bytes, {
          access: 'private', token: accessToken, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false,
        });
      } catch (error) {
        // @vercel/blob 2.6.1 surfaces an overwrite refusal as a BlobError
        // carrying the server's message and no code (getBlobError's
        // `bad_request` arm), so the message is the only signal. This wording
        // is UNVERIFIED until the slice 3 Preview rehearsal plants an object
        // and retries Confirm; a miss costs a raw error instead of the 409.
        if (/already exists/i.test(error?.message || '')) {
          throw storeError('A Factory artifact already exists at this path; re-export the source with a new key.', 409, 'factory_artifact_exists');
        }
        throw error;
      }
      return { pathname, size: bytes.length };
    },

    /** Capped, digest-checked read. Returns null when the object is missing. */
    async read(pathname, { expectedSha256 = null, maxBytes = maxBytesFor(pathname) } = {}) {
      assertMintedPathname(pathname);
      const accessToken = token();
      const { get } = await blobFns();
      let result;
      try {
        result = await get(pathname, { access: 'private', token: accessToken, useCache: false });
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      if (!result?.stream) return null;
      const reader = result.stream.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw storeError('Factory artifact exceeds the read limit.', 413, 'factory_artifact_too_large');
          }
          chunks.push(Buffer.from(next.value));
        }
      } finally {
        reader.releaseLock();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (expectedSha256 && artifactDigest(value) !== expectedSha256) {
        throw storeError('Factory artifact failed its integrity check.', 502, 'factory_artifact_digest_mismatch');
      }
      return { value, size };
    },

    /** Delete one object; a missing object is fine. */
    async del(pathname) {
      assertMintedPathname(pathname);
      const accessToken = token();
      const { del } = await blobFns();
      try {
        await del(pathname, { token: accessToken });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },

    /** Bounded listing under a prefix this module's shapes cover. */
    async list(prefix, { limit = SWEEP_LIST_LIMIT } = {}) {
      if (typeof prefix !== 'string' || !/^(sandbox|production)\/(runs|drafts)\/$/.test(prefix)) {
        throw storeError('Unrecognized Factory artifact prefix.', 400, 'factory_artifact_invalid_id');
      }
      const accessToken = token();
      const { list } = await blobFns();
      const blobs = [];
      let cursor;
      do {
        const page = await list({ prefix, limit: Math.min(100, limit - blobs.length), cursor, token: accessToken });
        blobs.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor && blobs.length < limit);
      return blobs.slice(0, limit);
    },
  };
}

function uploadedAtMs(object) {
  const ms = object?.uploadedAt ? new Date(object.uploadedAt).getTime() : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Daily maintenance sweep (plan 2b, Retention). Deletes a run's artifacts only
 * when (a) the ledger has no row for it and every object is older than 24 h,
 * or (b) its row is `ready`; never for prepared/creating/needs_attention, never
 * by age alone, and not at all when the ledger read fails. Drafts older than
 * 6 h are deleted. Idempotent under overlap: missing objects are tolerated.
 */
export async function sweepFactoryArtifacts({
  env = process.env, blob = null, ledgerDb = null, now = Date.now(), target = null,
} = {}) {
  if (!env?.TEST_REQUEST_LEDGER_URL || !env?.FACTORY_BLOB_RW_TOKEN) return { skipped: 'unconfigured', deleted: 0 };
  const sweepTarget = target ?? targetFromDeployment();
  const store = createFactoryArtifactStore({ env, blob });
  const stats = {
    deleted: 0, kept: 0, errors: 0, truncated: false, details: [],
  };

  const deleteObject = async (pathname) => {
    if (stats.deleted >= SWEEP_DELETE_LIMIT) { stats.truncated = true; return; }
    try {
      await store.del(pathname);
      stats.deleted += 1;
    } catch (error) {
      stats.errors += 1;
      stats.details.push(`Delete failed: ${pathname}: ${error.message}`);
    }
  };

  for (const object of await store.list(`${sweepTarget}/drafts/`, { limit: SWEEP_SCAN_LIMIT })) {
    const uploaded = uploadedAtMs(object);
    if (uploaded === null || !DRAFT_PATH.test(object.pathname) || now - uploaded < DRAFT_MAX_AGE_MS) {
      stats.kept += 1;
    } else {
      await deleteObject(object.pathname);
    }
  }

  const groups = new Map();
  for (const object of await store.list(`${sweepTarget}/runs/`, { limit: SWEEP_SCAN_LIMIT })) {
    const match = RUN_PATH.exec(object.pathname || '');
    if (!match) { stats.kept += 1; continue; }
    const runId = match[2].toLowerCase();
    if (!groups.has(runId)) groups.set(runId, []);
    groups.get(runId).push(object);
  }
  if (!groups.size) return stats;

  let db = ledgerDb;
  const owned = !db;
  try {
    if (owned) {
      db = pgLedgerDb(requireLedgerUrl(sweepTarget, env), { pool: { max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 } });
    }
    const ledger = createRunLedger(db);
    for (const [runId, objects] of groups) {
      let run;
      try {
        run = await ledger.getRun(runId);
      } catch (error) {
        stats.errors += 1;
        stats.details.push(`Ledger read failed for run ${runId}: ${error.message}`);
        continue;
      }
      const allOld = objects.every((object) => {
        const uploaded = uploadedAtMs(object);
        return uploaded !== null && now - uploaded >= UNRESERVED_RUN_MAX_AGE_MS;
      });
      const deletable = run ? run.status === 'ready' : allOld;
      if (!deletable) { stats.kept += objects.length; continue; }
      for (const object of objects) await deleteObject(object.pathname);
    }
  } catch (error) {
    stats.errors += 1;
    stats.details.push(`Ledger unavailable: ${error.message}`);
  } finally {
    if (owned) await db?.end?.();
  }
  return stats;
}
