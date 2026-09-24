'use strict';

/**
 * The single driver seam for Postgres. This is the only runtime module
 * allowed to `import`/`require` `@vercel/postgres` or `pg` — enforced by
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
 * Written as CommonJS, not ESM (Stage 3 fresh-context finding): 12 of the
 * 30 Stage 3 files are themselves CommonJS (`require('@vercel/postgres')`)
 * and two plain-node scripts `require` some of them directly — Vercel's
 * runtime cannot `require()` an ESM module, and plain-node scripts are not
 * bundled the way app code is, so an ESM seam would introduce a
 * require(esm) hazard into first-party code the moment a CommonJS caller
 * or script converted onto it. `module.exports` is a single static object
 * literal so `cjs-module-lexer` (and bundlers that use it) can still expose
 * named exports to ESM importers — `import { sql } from '../postgres/client'`
 * keeps working from the existing ESM stores.
 *
 * Behaviour freeze (plan §2 rule 6, §4 item 1): no query helpers, no
 * result mapping, no logging, no naming conventions. This module only
 * replaces the hand-rolled connect/release and BEGIN/COMMIT/ROLLBACK
 * sequences already present across `lib/services`; it changes nothing
 * about SQL text, response shapes, or error contracts.
 *
 * Exports exactly: `sql`, `withClient`, `withTransaction`, `getPool`.
 * `db` from `@vercel/postgres` is required internally but deliberately
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
 *   throw path); on throw, `client.release(error ?? true)` (destroy the
 *   connection rather than return a possibly-poisoned one — `?? true`
 *   so a thrown falsy value, e.g. `throw undefined`, still forces
 *   destruction rather than being treated as "no error") is itself
 *   wrapped in its own try/catch — `fn` must never release the client
 *   itself, but if it does, pg's double-release guard throwing here must
 *   not replace the ORIGINAL error the caller is about to see — and the
 *   original thrown value is always rethrown. On the SUCCESS path a
 *   `client.release()` failure is NOT swallowed: it is the only error in
 *   play, so it propagates normally. This is the strictly safer superset
 *   of the two forms already live in `lib/services` — `alert-service.js`
 *   and `auth/link-profile.js` already destroy on error; the other four
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
 * - `getPool()` — returns a FROZEN FACADE over the single lazily created
 *   `pg` `Pool`, one per process, for the three existing Pool users, not
 *   the raw `Pool` instance: `{ query(text, params), connect() }`, the
 *   same facade object every call (cached alongside the underlying pool).
 *   `connect()` yields the real `PoolClient` (its own `.release()` still
 *   works as before); the facade deliberately has no `.end()`, `.on()`,
 *   or `.totalCount()` — two Stage 3/4 callers call `pool.end()` today,
 *   and a raw `Pool` export would let any importer poison the
 *   process-wide singleton for every other caller. Built from
 *   `POSTGRES_URL || DATABASE_URL` (behaviour freeze: identical
 *   resolution and fallback to the current three call sites) and this is
 *   the ONLY place OUR code reads those two variables; `@vercel/postgres`
 *   reads `POSTGRES_URL` internally behind the re-exported `sql`, which
 *   this seam cannot and need not change. Throws a clear Error naming
 *   both variables when neither is set. `pg` is required LAZILY inside
 *   getPool() with a literal specifier (the ratchet's AST-only
 *   classification, plan §2 rule 12, sees a literal `require('pg')`
 *   wherever it sits): loading `pg` at module top made every jsdom-
 *   environment Jest suite that transitively imports a converted store
 *   throw `TextEncoder is not defined` from `pg/lib/crypto/utils.js`
 *   (Stage 3 template finding, 2026-09-24); requiring it on first pool
 *   use keeps `sql`-only importers free of `pg` entirely. Recorded
 *   lifecycle changes for the
 *   converting stages, not done here: `cron/drain-submissions`'s current
 *   Pool is built with `max: 5`, which `getPool()` does not carry over
 *   (default pool size); and `irs-bmf-service.js` / `intake/submit.js`
 *   build a Pool per call and `pool.end()` it — once converted they must
 *   stop calling `.end()` at all (the facade has none), borrowing the
 *   shared singleton for the process lifetime instead.
 *
 * Test-only escape hatch: `module.exports.__endPoolForTests` is a
 * non-enumerable function (absent from `Object.keys(...)`, so it is not
 * one of the four public exports) that ends the real pool and resets the
 * singleton/facade so contract tests can close the handle without a
 * public `.end()`. It throws unless `process.env.JEST_WORKER_ID` is set
 * (Jest sets this in every worker) — it must never be reachable from
 * application code.
 */

const { sql, db } = require('@vercel/postgres');

async function withClient(fn) {
  const client = await db.connect();
  let result;
  try {
    result = await fn(client);
  } catch (error) {
    try {
      client.release(error ?? true);
    } catch {
      // Swallow a release failure here (e.g. fn already released the
      // client itself, tripping pg's double-release guard): the caller
      // must see the ORIGINAL error, never a release-failure error
      // masking it.
    }
    throw error;
  }
  client.release();
  return result;
}

async function withTransaction(fn) {
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
let poolFacade;

function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'lib/postgres/client: getPool() requires POSTGRES_URL or DATABASE_URL to be set.'
      );
    }
    const { Pool } = require('pg');
    pool = new Pool({ connectionString });
    poolFacade = Object.freeze({
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect(),
    });
  }
  return poolFacade;
}

module.exports = { sql, withClient, withTransaction, getPool };

Object.defineProperty(module.exports, '__endPoolForTests', {
  enumerable: false,
  value: async function __endPoolForTests() {
    if (!process.env.JEST_WORKER_ID) {
      throw new Error(
        'lib/postgres/client: __endPoolForTests is test-only (JEST_WORKER_ID is not set).'
      );
    }
    if (pool) {
      await pool.end();
    }
    pool = undefined;
    poolFacade = undefined;
  },
});
