/**
 * The single driver seam for Postgres. This is the only runtime module
 * allowed to `import` `@vercel/postgres` or `pg` — enforced by
 * `scripts/check-postgres-access-layer.js` ratchet check (a) (any
 * driver-import file not already in the allowlist, or over its allowed
 * count, fails) together with the allowed-importer set that exempts
 * `lib/postgres/**` from that ratchet; the separate check (c) is what
 * stops `pages/api/**` from importing `lib/postgres/**` directly (routes
 * go through `lib/services`, never this seam).
 * Stores under `lib/services` today, and `lib/postgres/stores/**` later if
 * Q4 confirms that relocation (open as of the Stage 1 report, not yet
 * decided), are its only intended importers — see
 * docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md §4 item 1.
 *
 * As of Stage 2 this is the INTENDED single driver import point, not yet
 * the actual one: nothing imports this module yet, and
 * `scripts/postgres-access-allowlist.json` still freezes the 60
 * pre-existing direct `@vercel/postgres`/`pg` importers until Stages 3–7
 * move them onto this seam one file at a time.
 *
 * Behaviour freeze (plan §2 rule 6, §4 item 1): no query helpers, no
 * result mapping, no logging, no naming conventions. This module only
 * replaces the hand-rolled connect/release and BEGIN/COMMIT/ROLLBACK
 * sequences already present across `lib/services`; it changes nothing
 * about SQL text, response shapes, or error contracts.
 *
 * Exports exactly: `sql`, `withClient`, `withTransaction`, `getPool`.
 * `db` from `@vercel/postgres` is imported internally but deliberately
 * NOT re-exported: every live use of `db` is `db.connect()` (8 sites in
 * 6 files), and `withClient` replaces all of them, so exporting `db`
 * would leave a raw way around the seam's release discipline.
 *
 * - `sql` — re-exported UNCHANGED from `@vercel/postgres` so every
 *   existing `sql\`...\`` / `sql.query(...)` statement compiles without
 *   edit.
 * - `withClient(fn)` — `db.connect()`, run `fn(client)`, then release:
 *   on success `client.release()` (return the client to the pool, called
 *   after the try block, not in a `finally`, so it never runs on the
 *   throw path); on throw `client.release(error ?? true)` (destroy the
 *   connection rather than return a possibly-poisoned one — `?? true`
 *   so a thrown falsy value, e.g. `throw undefined`, still forces
 *   destruction rather than being treated as "no error") and rethrow the
 *   original thrown value. This is the strictly safer superset of the
 *   two forms already live in `lib/services` — `alert-service.js` and
 *   `auth/link-profile.js` already destroy on error; the other four
 *   `db.connect()` callers only ever released unconditionally.
 * - `withTransaction(fn)` — `withClient` plus `BEGIN`/`COMMIT`/`ROLLBACK`
 *   for the SIMPLE hand-rolled sequences (model: `withDossierTransaction`
 *   in `lib/services/cycle-dossier-store.js:28`, byte-identical twin
 *   `withReviewPanelTransaction` in `lib/services/review-panel-store.js:73`
 *   — both have an UNGUARDED `ROLLBACK` that would mask the original
 *   error if the rollback itself failed). Here the `ROLLBACK` runs inside
 *   its own try/catch so a rollback failure is swallowed and the caller
 *   always sees the ORIGINAL error, never a rollback-failure error masking
 *   it. Files with an early `ROLLBACK`-and-return, more than one `COMMIT`,
 *   or a caller-supplied client keep their own statements on a
 *   `withClient` client (plan §4 item 1) — this helper is intentionally
 *   narrower than "every transaction in the codebase". Note for Stage 3
 *   converters: the model `withDossierTransaction` issues `COMMIT` INSIDE
 *   its try, so a `COMMIT` failure there attempts a `ROLLBACK`; this seam's
 *   `COMMIT` runs OUTSIDE the try, so a `COMMIT` failure here skips
 *   `ROLLBACK` and destroys the connection via `withClient`'s
 *   `release(error ?? true)` instead. Same database end-state (a failed
 *   `COMMIT` leaves nothing to roll back) and the same error surfaces to
 *   the caller either way, but the code path differs — do not assume
 *   byte-identical behaviour when diffing against the model. Also for
 *   Stage 3: a NESTED `withTransaction` call opens a SECOND connection
 *   (an independent transaction on its own client via a fresh
 *   `db.connect()`), never a second `BEGIN` on the same client — callers
 *   that need one transaction spanning nested logic must pass the outer
 *   `client` through and call statements directly, not nest
 *   `withTransaction`.
 * - `getPool()` — the single lazily created `pg` `Pool`, one per process,
 *   for the three existing Pool users. Built from `POSTGRES_URL ||
 *   DATABASE_URL` (behaviour freeze: identical resolution and fallback to
 *   the current three call sites) and this is the ONLY place OUR code
 *   reads those two variables; `@vercel/postgres` reads `POSTGRES_URL`
 *   internally behind the re-exported `sql`, which this seam cannot and
 *   need not change. Throws a clear Error naming both variables when
 *   neither is set. `pg` is imported statically at module top so the
 *   ratchet's AST-only classification (plan §2 rule 12) sees a literal
 *   specifier. Recorded lifecycle changes for the converting stages, not
 *   done here: `cron/drain-submissions`'s current Pool is built with
 *   `max: 5`, which `getPool()` does not carry over (default pool size);
 *   and `irs-bmf-service.js` / `intake/submit.js` build a Pool per call
 *   and `pool.end()` it, which becomes "borrow the shared singleton,
 *   never end it" once they convert.
 */

import { sql, db } from '@vercel/postgres';
import { Pool } from 'pg';

export { sql };

export async function withClient(fn) {
  const client = await db.connect();
  let result;
  try {
    result = await fn(client);
  } catch (error) {
    client.release(error ?? true);
    throw error;
  }
  client.release();
  return result;
}

export async function withTransaction(fn) {
  return withClient(async (client) => {
    await client.query('BEGIN');
    let result;
    try {
      result = await fn(client);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Swallow the rollback failure: the caller must see the ORIGINAL
        // error, never a rollback-failure error masking it.
      }
      throw error;
    }
    await client.query('COMMIT');
    return result;
  });
}

let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'lib/postgres/client: getPool() requires POSTGRES_URL or DATABASE_URL to be set.'
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
