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
import { unapprovedExtras } from './ledger-schema.js';

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Removes a migration file's own outer BEGIN;/COMMIT; lines (it runs inside the caller's own transaction). */
export function stripOuterTxn(body) {
  return body.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');
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
