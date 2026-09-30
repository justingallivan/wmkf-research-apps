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
 *             OR an untracked file's live schema matches neither the
 *             migration prefix immediately BEFORE the file nor the prefix
 *             THROUGH the file.
 *  - apply:   the file is untracked and the live schema matches the prefix
 *             BEFORE it (an ordinary forward application).
 *  - adopt:   the file is untracked and the live schema matches the prefix
 *             THROUGH it — record it without re-running its SQL.
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
 * @param {{ missing: string[], differing: string[], extra: string[] }|null} params.beforeDiff - comparison of
 *   the migration prefix immediately before this file against the live ledger
 * @param {{ missing: string[], differing: string[], extra: string[] }|null} params.throughDiff - comparison of
 *   the migration prefix through this file against the live ledger
 * @param {boolean} params.acceptTrackedChecksums - operator opted into recording checksums for legacy NULL rows
 * @param {Array} params.approvedAhead - lib/db/ledger-schema-ahead.json's approvedAhead entries; extras in either
 *   prefix comparison must be exactly shape-approved here
 * @param {object|null} params.liveFingerprint - the live ledger's full fingerprint, needed to shape-verify an
 *   approved-ahead table extra (readLedgerFingerprint's return value)
 * @returns {{ action: 'skip'|'apply'|'adopt'|'refuse'|'accept-checksum', reason?: string }}
 */
export function decideFileAction({
  file,
  currentChecksum,
  trackedRow,
  beforeDiff = null,
  throughDiff = null,
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

  const stateMatches = (diff) => !!diff
    && (diff.missing || []).length === 0
    && (diff.differing || []).length === 0
    && unapprovedExtras(diff, approvedAhead, liveFingerprint).length === 0;
  const beforeMatches = stateMatches(beforeDiff);
  const throughMatches = stateMatches(throughDiff);
  const throughExtras = new Set(throughDiff?.extra || []);
  const currentFileObjectsAlreadyLive = (beforeDiff?.extra || []).filter((item) => !throughExtras.has(item));

  if (beforeMatches && throughMatches) {
    // Approved-ahead extras can make both comparisons acceptable. Prefer
    // THROUGH only when it is the closer raw fingerprint (the current file
    // explains live objects that were extras against BEFORE); an actual
    // no-op file stays on APPLY so its SQL still runs before it is tracked.
    const count = (diff) => (diff.missing || []).length + (diff.differing || []).length + (diff.extra || []).length;
    return count(throughDiff) < count(beforeDiff) ? { action: 'adopt' } : { action: 'apply' };
  }
  if (beforeMatches && currentFileObjectsAlreadyLive.length === 0) return { action: 'apply' };
  if (throughMatches) return { action: 'adopt' };

  const mismatch = (label, diff) => {
    if (!diff) return `${label}=not-computed`;
    const unapproved = unapprovedExtras(diff, approvedAhead, liveFingerprint);
    const parts = [];
    if ((diff.missing || []).length) parts.push(`missing ${diff.missing.join(', ')}`);
    if ((diff.differing || []).length) parts.push(`differing ${diff.differing.join(', ')}`);
    if (unapproved.length) parts.push(`unapproved extra ${unapproved.join(', ')}`);
    if (label === 'BEFORE' && currentFileObjectsAlreadyLive.length) {
      parts.push(`partial current-file objects already live ${currentFileObjectsAlreadyLive.join(', ')}`);
    }
    return `${label}=${parts.length ? parts.join('; ') : 'ambiguous'}`;
  };
  return {
    action: 'refuse',
    reason: `${file}: live schema matches neither the prefix BEFORE this file nor the prefix THROUGH it (${mismatch('BEFORE', beforeDiff)}; ${mismatch('THROUGH', throughDiff)}); write a numbered forward migration instead of hand-patching`,
  };
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
 * Opus round-3 M1: a prefix extra is not automatically a hand-added stray
 * object — it may simply be an object a LATER, not-yet-tracked checkout file
 * creates (e.g. 058's test_request_cast_slot_bindings, applied to the ledger
 * ahead of its tracker row). Without this, every checkout with any
 * untracked-but-live later file refused the WHOLE run before the per-file
 * loop's own `adopt` path (decideFileAction) ever got a chance to evaluate
 * it — a regression from "adopt the later file" to "refuse everything".
 * `laterFilesFingerprint` (the scratch fingerprint of applying EVERY file in
 * the checkout, not just the tracked prefix) lets a table-shaped extra be
 * exempted here ONLY when that table's live shape is byte-for-byte what the
 * full checkout would itself produce; a shape mismatch (the live table
 * exists but differs from what the checkout's own later file defines) stays
 * fatal, same as any other differing object.
 */
function extraTableMatchesLaterFiles(tableName, liveFingerprint, laterFilesFingerprint) {
  const laterShape = laterFilesFingerprint?.tables?.[tableName];
  const liveShape = liveFingerprint?.tables?.[tableName];
  if (!laterShape || !liveShape) return false;
  const shapeDiff = compareLedgerFingerprint(
    { tables: { [tableName]: laterShape }, functions: [] },
    { tables: { [tableName]: liveShape }, functions: [] },
  );
  return shapeDiff.missing.length === 0 && shapeDiff.differing.length === 0 && shapeDiff.extra.length === 0;
}

/**
 * @param {object} params
 * @param {{ missing: string[], differing: string[], extra: string[] }|null} params.prefixDiff - comparison of the
 *   tracked prefix's scratch-schema fingerprint against the live ledger; null/omitted when there is no tracked
 *   prefix to verify (an empty ledger with nothing tracked yet)
 * @param {Array} params.approvedAhead - lib/db/ledger-schema-ahead.json's approvedAhead entries
 * @param {object|null} params.liveFingerprint - the live ledger's full fingerprint, needed to shape-verify an
 *   approved-ahead table extra
 * @param {object|null} params.laterFilesFingerprint - Opus round-3 M1: the scratch fingerprint of applying EVERY
 *   file in the checkout (not just the tracked prefix); a table-shaped prefix extra whose live shape exactly
 *   matches this fingerprint's shape for that table is exempted (a later file will adopt it), never assumed
 *   benign just because it isn't in approvedAhead
 * @returns {{ ok: boolean, reason?: string }}
 */
export function decideTrackedPrefixVerification({
  prefixDiff, approvedAhead = [], liveFingerprint = null, laterFilesFingerprint = null,
}) {
  if (!prefixDiff) return { ok: true };

  if (prefixDiff.missing.length > 0 || prefixDiff.differing.length > 0) {
    return {
      ok: false,
      reason: 'the tracked migration prefix has drifted from the live ledger (missing or differing objects); refusing the whole run before applying/adopting/accepting anything further',
    };
  }

  const extras = prefixDiff.extra || [];
  if (extras.length > 0) {
    let unapproved = unapprovedExtras(prefixDiff, approvedAhead, liveFingerprint);
    if (unapproved.length > 0 && laterFilesFingerprint) {
      unapproved = unapproved.filter((e) => {
        const tableMatch = /^table (.+)$/.exec(e);
        if (!tableMatch) return true;
        return !extraTableMatchesLaterFiles(tableMatch[1], liveFingerprint, laterFilesFingerprint);
      });
    }
    if (unapproved.length > 0) {
      return {
        ok: false,
        reason: `the tracked migration prefix has unapproved extra object(s) not covered by lib/db/ledger-schema-ahead.json or a later checkout file: ${unapproved.join(', ')}`,
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
 *
 * Opus round-3 M1: when the prefix comparison finds only EXTRA objects (no
 * missing/differing) and `allFiles` names more files than `trackedFiles`,
 * a second rolled-back scratch pass fingerprints the FULL checkout
 * (`allFiles`) in the same one-transaction pattern, so decideTrackedPrefix
 * Verification can tell a benign "a later, not-yet-tracked file already
 * created this" extra from a genuine hand-added stray object. Skipped
 * whenever there is nothing for it to change (no extras, or no files beyond
 * the prefix) to avoid an unnecessary scratch schema.
 */
export async function verifyTrackedPrefix(client, {
  trackedFiles, allFiles = null, migrationsDir, readLedgerFingerprint, approvedAhead = [],
}) {
  if (!trackedFiles || trackedFiles.length === 0) return { ok: true };
  const scratchFp = await fingerprintFilesInScratch(client, trackedFiles, migrationsDir, readLedgerFingerprint);
  const liveFingerprint = await readLedgerFingerprint(client);
  const prefixDiff = compareLedgerFingerprint(scratchFp, liveFingerprint);

  let laterFilesFingerprint = null;
  const hasLaterFiles = Array.isArray(allFiles) && allFiles.length > trackedFiles.length;
  if (prefixDiff.missing.length === 0 && prefixDiff.differing.length === 0 && prefixDiff.extra.length > 0 && hasLaterFiles) {
    laterFilesFingerprint = await fingerprintFilesInScratch(client, allFiles, migrationsDir, readLedgerFingerprint);
  }

  return decideTrackedPrefixVerification({
    prefixDiff, approvedAhead, liveFingerprint, laterFilesFingerprint,
  });
}
