/**
 * Pure decision logic for the ledger migration runner
 * (scripts/apply-ledger-migrations.js; Codex round-1 Fix 3). Extracted so it
 * is testable without a live Postgres connection.
 *
 * Every ledger migration file is written idempotently (CREATE TABLE IF NOT
 * EXISTS, CREATE OR REPLACE FUNCTION, DROP CONSTRAINT IF EXISTS + ADD), which
 * is exactly what makes a naive "apply everything, record the filename"
 * runner dangerous: re-running a file against a ledger that already has an
 * OLDER, hand-patched shape of the same objects silently no-ops and the
 * runner would still mark it applied. This module's decision function forces
 * one of four explicit actions per file instead:
 *
 *  - skip:    the file is tracked and its checksum still matches — nothing
 *             to do.
 *  - refuse:  the file is tracked but its current checksum differs from the
 *             one recorded (the file was edited in place after being
 *             applied — ledger schema changes are forward migrations now),
 *             OR the file is untracked, its objects already exist live, and
 *             a semantic fingerprint comparison of "the checkout's files up
 *             to and including this one" against the live ledger finds
 *             missing or differing objects (the live shape does not match
 *             what this file would produce — a hand patch, not a clean
 *             checkout application).
 *  - apply:   the file is untracked and none of its objects exist live yet
 *             (an ordinary forward application, e.g. an empty ledger or the
 *             next new migration).
 *  - adopt:   the file is untracked, its objects already exist live, and the
 *             semantic comparison is clean — record it with its checksum
 *             without re-running its SQL (CREATE ... IF NOT EXISTS would
 *             no-op anyway; adopting just makes that explicit and durable).
 *
 * A tracked row with sha256 NULL (rows written before this column existed)
 * is treated as "unknown": refuse until an operator explicitly runs
 * --accept-tracked-checksums, which records the checkout's current checksum
 * for exactly those files. This exists only for the tracker rows the
 * factory-ledger-registry work itself created on the two Neon ledgers before
 * checksums existed.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { unapprovedExtras, compareLedgerFingerprint } from './ledger-schema.js';

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Removes a migration file's own outer BEGIN;/COMMIT; lines (it runs inside the caller's own transaction). */
export function stripOuterTxn(body) {
  return body.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');
}

/**
 * Opus round-3 L1: selects the files verifyTrackedPrefix should fingerprint
 * — every TRACKED file whose recorded checksum either matches the
 * checkout's current text OR is the legacy NULL ("unknown") state. A legacy
 * NULL-checksum row is still an already-applied tracked file; leaving it out
 * of the prefix let --accept-tracked-checksums record a checksum for a
 * drifted row sight-unseen and move straight on to the next file with no
 * live comparison of the row it just "accepted". A row whose checksum
 * MISMATCHES the current file (the file was edited in place) is excluded —
 * that case is decideFileAction's own explicit refusal, not a prefix-drift
 * question.
 *
 * @param {string[]} files - checkout files, in filename order
 * @param {Map<string, {sha256: string|null}>} tracked - tracker rows keyed by filename
 * @param {Map<string, string>} fileChecksum - each file's current sha256
 * @returns {string[]}
 */
export function selectTrackedPrefixFiles(files, tracked, fileChecksum) {
  return files.filter((f) => {
    const row = tracked.get(f);
    if (!row) return false;
    return row.sha256 === null || row.sha256 === undefined || row.sha256 === fileChecksum.get(f);
  });
}

/** Table names a migration file's CREATE TABLE statements define. */
export function tableNamesIn(sql) {
  const names = [];
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+("?\w+"?)/gi;
  let m;
  while ((m = re.exec(sql))) names.push(m[1].replace(/"/g, ''));
  return names;
}

/**
 * Runs `files` (in order, read from `migrationsDir`) inside a scratch schema
 * on the SAME connection, inside one transaction that is always rolled back,
 * and returns the resulting fingerprint (via the caller-supplied
 * `readLedgerFingerprint`, to avoid a circular import with ledger-schema.js).
 * Doing the whole sequence in one transaction keeps every statement on the
 * same backend even through a transaction-mode pooler (Neon's `-pooler`
 * endpoint), where a bare `SET search_path` is not guaranteed to persist
 * between separate `client.query` calls outside a transaction.
 */
export async function fingerprintFilesInScratch(client, files, migrationsDir, readLedgerFingerprint) {
  const schema = `ledger_adopt_${crypto.randomBytes(4).toString('hex')}`;
  await client.query('BEGIN');
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    for (const f of files) {
      await client.query(stripOuterTxn(fs.readFileSync(path.join(migrationsDir, f), 'utf8')));
    }
    return await readLedgerFingerprint(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}

/**
 * Decides the action for one migration file.
 *
 * @param {object} params
 * @param {string} params.file - migration filename
 * @param {string} params.currentChecksum - sha256 of the file as it exists in the checkout
 * @param {{ sha256: string|null }|null} params.trackedRow - the tracker row for this file, or null if untracked
 * @param {boolean} params.liveHasObjects - whether this migration's objects already exist live (untracked case only)
 * @param {{ missing: string[], differing: string[], extra: string[] }|null} params.scratchDiff - comparison of
 *   "files up to and including this one" against the live ledger (only needed when liveHasObjects is true)
 * @param {boolean} params.acceptTrackedChecksums - operator opted into recording checksums for legacy NULL rows
 * @param {Array} params.approvedAhead - lib/db/ledger-schema-ahead.json's approvedAhead entries (Opus round-2 item 4:
 *   an extra object in scratchDiff no longer adopts silently; it must be exactly shape-approved here)
 * @param {object|null} params.liveFingerprint - the live ledger's full fingerprint, needed to shape-verify an
 *   approved-ahead table extra (readLedgerFingerprint's return value)
 * @returns {{ action: 'skip'|'apply'|'adopt'|'refuse'|'accept-checksum', reason?: string }}
 */
export function decideFileAction({
  file,
  currentChecksum,
  trackedRow,
  liveHasObjects = false,
  scratchDiff = null,
  acceptTrackedChecksums = false,
  approvedAhead = [],
  liveFingerprint = null,
}) {
  if (trackedRow) {
    if (trackedRow.sha256 === null || trackedRow.sha256 === undefined) {
      if (acceptTrackedChecksums) return { action: 'accept-checksum' };
      return { action: 'refuse', reason: `${file}: tracked with no recorded checksum; run --accept-tracked-checksums once this checkout is confirmed unmodified since it was applied` };
    }
    if (trackedRow.sha256 !== currentChecksum) {
      return { action: 'refuse', reason: `${file} changed since it was applied; ledger schema changes are forward migrations (write a new numbered file)` };
    }
    return { action: 'skip' };
  }

  if (!liveHasObjects) return { action: 'apply' };

  if (!scratchDiff || scratchDiff.missing.length > 0 || scratchDiff.differing.length > 0) {
    return { action: 'refuse', reason: `${file}: objects already exist live and differ from the checkout's migration (write a new numbered forward migration instead of hand-patching)` };
  }

  // Opus round-2 item 4: an extra object in the scratch comparison used to
  // adopt silently (CREATE TABLE IF NOT EXISTS could be masking a
  // hand-added trigger with side effects). Now every extra must be exactly
  // shape-approved against lib/db/ledger-schema-ahead.json (the same
  // comparison Fix 4/item 3 use for the live schema check), never assumed
  // benign just because missing/differing were empty.
  const extras = scratchDiff.extra || [];
  if (extras.length > 0) {
    const unapproved = unapprovedExtras(scratchDiff, approvedAhead, liveFingerprint);
    if (unapproved.length > 0) {
      return { action: 'refuse', reason: `${file}: objects already exist live with unapproved extra object(s) not covered by lib/db/ledger-schema-ahead.json (write a new numbered forward migration): ${unapproved.join(', ')}` };
    }
  }

  return { action: 'adopt' };
}

/**
 * Codex round-3 #2: a tracked row with a matching checksum only proves the
 * migration file's TEXT hasn't changed since it was applied; it says
 * nothing about whether the LIVE ledger's objects still match what that
 * file's SQL would produce. A live-only hand edit (a dropped CHECK, an
 * ALTERed default, a DROPped trigger) under an unchanged, still-tracked
 * file leaves the checksum intact while the schema has silently drifted —
 * and the per-file loop only ever re-derives a fresh comparison for
 * UNTRACKED files, so a drifted tracked file was previously invisible to
 * the runner entirely. Before applying/adopting/accepting anything, the
 * caller fingerprints the tracked-and-checksum-matching PREFIX of files (in
 * filename order) in a rolled-back scratch schema and compares it with the
 * live ledger; this is the pure refuse/ok decision over that comparison,
 * mirroring decideFileAction's extras handling (an extra object follows the
 * same approved-ahead rule used for adoption).
 *
 * @param {object} params
 * @param {{ missing: string[], differing: string[], extra: string[] }|null} params.prefixDiff - comparison of the
 *   tracked prefix's scratch-schema fingerprint against the live ledger; null/omitted when there is no tracked
 *   prefix to verify (an empty ledger with nothing tracked yet)
 * @param {Array} params.approvedAhead - lib/db/ledger-schema-ahead.json's approvedAhead entries
 * @param {object|null} params.liveFingerprint - the live ledger's full fingerprint, needed to shape-verify an
 *   approved-ahead table extra
 * @returns {{ ok: boolean, reason?: string }}
 */
export function decideTrackedPrefixVerification({ prefixDiff, approvedAhead = [], liveFingerprint = null }) {
  if (!prefixDiff) return { ok: true };

  if (prefixDiff.missing.length > 0 || prefixDiff.differing.length > 0) {
    return {
      ok: false,
      reason: 'the tracked migration prefix has drifted from the live ledger (missing or differing objects); refusing the whole run before applying/adopting/accepting anything further',
    };
  }

  const extras = prefixDiff.extra || [];
  if (extras.length > 0) {
    const unapproved = unapprovedExtras(prefixDiff, approvedAhead, liveFingerprint);
    if (unapproved.length > 0) {
      return {
        ok: false,
        reason: `the tracked migration prefix has unapproved extra object(s) not covered by lib/db/ledger-schema-ahead.json: ${unapproved.join(', ')}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Orchestrates the tracked-prefix verification: fingerprints `trackedFiles`
 * (the tracked-and-checksum-matching files, in filename order) in a
 * rolled-back scratch schema on `client`'s own connection
 * (fingerprintFilesInScratch), reads the LIVE ledger fingerprint, compares
 * the two, and returns decideTrackedPrefixVerification's verdict. A no-op
 * (`{ ok: true }`) when there is no tracked prefix yet. The caller is
 * responsible for calling this ONLY outside --dry-run (it runs real DDL,
 * rolled back, in a scratch schema) and for refusing the ENTIRE run — before
 * any per-file action — when the result is not ok.
 */
export async function verifyTrackedPrefix(client, {
  trackedFiles, migrationsDir, readLedgerFingerprint, approvedAhead = [],
}) {
  if (!trackedFiles || trackedFiles.length === 0) return { ok: true };
  const scratchFp = await fingerprintFilesInScratch(client, trackedFiles, migrationsDir, readLedgerFingerprint);
  const liveFingerprint = await readLedgerFingerprint(client);
  const prefixDiff = compareLedgerFingerprint(scratchFp, liveFingerprint);
  return decideTrackedPrefixVerification({ prefixDiff, approvedAhead, liveFingerprint });
}
