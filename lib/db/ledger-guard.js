/**
 * Ledger guard: fail-closed dispatch gates for every ledger-driven mode of
 * scripts/rehearse-test-request-sandbox.mjs (Opus round-2 item 6; Codex
 * round-2 medium finding #7).
 *
 * Extracted out of the CLI script specifically so the SAFETY BEHAVIOR
 * itself is executable and unit-tested, not just its presence in the
 * dispatch source. The round-1 literal-source test
 * (tests/unit/test-request-sandbox-clone.test.js) proves every dispatch
 * block CALLS requireLedgerUrl and ledgerSchemaCheck, but it never executed
 * either function — deleting both throw blocks inside ledgerSchemaCheck
 * left every round-1 assertion passing (Codex round-2 finding). This module
 * makes them independently callable, injectable, and directly tested by
 * tests/unit/ledger-guard.test.js.
 */

import {
  classifyLedgerUrl, selectLedgerVariable, assertLedgerConnectionIdentity, SHARED_DATABASE_URL_VARS,
} from './ledger-registry.js';
import {
  compareLedgerFingerprint, formatLedgerDiff, readApprovedAhead, readExpectedFingerprint, readLedgerFingerprint, unapprovedExtras,
} from './ledger-schema.js';
import { pgLedgerDb } from '../services/test-requests/run-ledger-db.js';

/**
 * Refuse to run a ledger-driven mode against anything but a registered
 * ledger (lib/db/ledger-registry.js): the URL must be set, must not equal a
 * configured shared Production/Preview database URL, must name a
 * registered host, and on a managed host must name the database the target
 * expects (ledger_prod for --target=production, ledger otherwise).
 *
 * `target` is always a concrete non-empty string — every ledger-driven
 * mode, including --run-inspect and --ledger-check, is target-bound. A
 * missing/empty target throws immediately rather than falling through to
 * classifyLedgerUrl's target=null host-only rules (which skip the managed
 * database check) — this is what keeps a future no-argument
 * requireLedgerUrl() call (e.g. from an unresolved B4 merge conflict)
 * failing closed instead of silently accepting any database on the managed
 * host.
 *
 * `env` defaults to process.env but is injectable for tests.
 */
export function requireLedgerUrl(target, env = process.env) {
  if (typeof target !== 'string' || target.length === 0) {
    throw new Error('requireLedgerUrl requires a non-empty --target; every ledger-driven mode is target-bound.');
  }
  const varName = selectLedgerVariable(target, env);
  const url = env[varName];
  if (!url) {
    throw new Error(`${varName} is required for ledger-driven modes (--reserve, --advance, --run-inspect, ...) with --target=${target}.`);
  }
  console.log(`[ledger] using ${varName} for --target=${target}`);
  const sharedUrls = SHARED_DATABASE_URL_VARS
    .map((name) => env[name]).filter(Boolean);
  const verdict = classifyLedgerUrl(url, { target, sharedUrls });
  if (!verdict.ok) {
    // Throw on ANY refusal reason, not an enumerated list, so an
    // unrecognized future reason can never fall through and return the URL.
    if (verdict.reason === 'shared_database') {
      throw new Error(`${varName} must not be the shared Production/Preview database.`);
    }
    if (verdict.reason && verdict.reason.startsWith('wrong_database:')) {
      throw new Error(`${varName} on the managed ledger must name the ${verdict.reason.slice('wrong_database:'.length)} database for --target=${target}.`);
    }
    throw new Error(`${varName} is not an acceptable ledger (${verdict.reason}); see lib/db/ledger-registry.js.`);
  }
  return url;
}

/**
 * Read-only ledger inspection modes: MISSING/DIFFERING still throw (drift is
 * never safe to operate against), but an unapproved EXTRA only warns — these
 * modes make no writes, so an ahead-of-checkout ledger is informational.
 * `ledger-check` is stricter still: the standalone diagnostic never throws
 * at all, so an operator can always see the full diff.
 */
export const LEDGER_CHECK_READ_ONLY_MODES = new Set(['run-inspect', 'ledger-check']);

/**
 * Ledger schema check (portability plan Phase 3). Compares the ledger's
 * structural fingerprint with the tracked expectation before any
 * ledger-driven mode runs.
 *
 * MISSING or DIFFERING objects always refuse, for every mode except the
 * `--ledger-check` diagnostic (which prints the full diff and never
 * throws). EXTRA objects are checked against the approved-ahead list:
 * extras that are all approved only warn; any extra NOT in that list
 * refuses for write modes (reserve, advance, set-status, status-recheck,
 * status-abandon, create-cast, bind-reviewer, run-recheck) and warns for the read-only
 * `--run-inspect` and `--ledger-check`.
 *
 * @param {string} ledgerUrl
 * @param {object} [opts]
 * @param {string|null} [opts.mode]
 * @param {{query(text:string, params?:any[]): Promise<{rows:any[]}>, end?: Function}} [opts.db] -
 *   an injectable db for tests; when given, no identity check is performed
 *   (the fake connection has no real backend to verify against) and no real
 *   connection is opened. Defaults to pgLedgerDb(ledgerUrl), which already
 *   routes the URL through buildLedgerClientConfig (Opus round-2 item 1).
 * @param {{fingerprint: object}} [opts.expected] - defaults to readExpectedFingerprint()
 * @param {Array} [opts.ahead] - approved-ahead entries; defaults to readApprovedAhead()
 */
export async function ledgerSchemaCheck(ledgerUrl, { mode = null, db: injectedDb = null, expected: injectedExpected = null, ahead: injectedAhead = null } = {}) {
  const usingRealDb = !injectedDb;
  const db = injectedDb || pgLedgerDb(ledgerUrl);
  let diff;
  let live;
  try {
    if (usingRealDb) {
      // Opus round-2 item 1: verify the LIVE connection landed on the
      // classified destination (ambient PGOPTIONS can still redirect
      // current_schema even though buildLedgerClientConfig pins every
      // other destination field explicitly).
      const verdict = classifyLedgerUrl(ledgerUrl, {});
      // Opus round-2 low #2: a URL the registry cannot classify has no
      // destination to verify against, so it fails closed here too (every
      // dispatch runs requireLedgerUrl first; this is the second fence).
      if (!verdict.ok || !verdict.effective) {
        throw new Error(`Ledger schema check refused: TEST_REQUEST_*LEDGER_URL is not an acceptable ledger (${verdict.reason || 'unclassified'}).`);
      }
      await assertLedgerConnectionIdentity(db, verdict.effective, { checkPort: verdict.label === 'managed-ledger' });
    }
    live = await readLedgerFingerprint(db);
    diff = compareLedgerFingerprint((injectedExpected || readExpectedFingerprint()).fingerprint, live);
  } finally {
    if (usingRealDb) await db.end?.();
  }
  const database = new URL(ledgerUrl).pathname.replace(/^\//, '');
  const approvedAhead = injectedAhead || readApprovedAhead();
  const unapproved = unapprovedExtras(diff, approvedAhead, live);

  if (mode === 'ledger-check') {
    // Standalone diagnostic: print everything, throw on nothing.
    if (diff.ok && unapproved.length === 0) {
      console.log(`[ledger-check] ${database}: matches lib/db/ledger-schema-fingerprint.json`);
    } else {
      console.warn(`[ledger-check] ${database}: schema differs from the checkout's fingerprint (diagnostic only; not blocking):\n${formatLedgerDiff(diff)}`);
      if (unapproved.length > 0) console.warn(`[ledger-check] unapproved extra objects (not in lib/db/ledger-schema-ahead.json):\n${unapproved.map((e) => `  extra     ${e}`).join('\n')}`);
    }
    return diff;
  }

  if (diff.missing.length > 0 || diff.differing.length > 0) {
    throw new Error(`Ledger ${database} does not match lib/db/ledger-schema-fingerprint.json:\n${formatLedgerDiff(diff)}\nApply the checkout's ledger migrations (npm run ledger:apply -- --url-env=TEST_REQUEST_LEDGER_URL) or regenerate the fingerprint if the files changed.`);
  }
  if (unapproved.length > 0) {
    const message = `Ledger ${database} has extra objects not in lib/db/ledger-schema-ahead.json's approved-ahead list:\n${unapproved.map((e) => `  extra     ${e}`).join('\n')}`;
    if (LEDGER_CHECK_READ_ONLY_MODES.has(mode)) {
      console.warn(`[ledger-check] ${message}`);
    } else {
      throw new Error(message);
    }
  } else if (diff.extra.length > 0) {
    console.log(`[ledger-check] ${database}: extra objects are all approved-ahead (lib/db/ledger-schema-ahead.json)`);
  } else {
    console.log(`[ledger-check] ${database}: matches lib/db/ledger-schema-fingerprint.json`);
  }
  return diff;
}
