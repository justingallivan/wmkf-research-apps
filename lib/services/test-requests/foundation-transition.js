/**
 * Foundation-account transition contract for a production clone
 * (docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md, open
 * questions 4 and 7).
 *
 * In production a clone-shaped create writes the Foundation account through
 * the vendor's GoVerify refresh, and the platform rollups that aggregate
 * Requests recalculate. The sandbox's versionnumber comparison would fail on
 * both, and `verifyClone`'s own before/after pair is read seconds apart inside
 * the verify step, so it cannot see a write made during create at all. The
 * production run therefore journals a baseline at `fence_source` (before the
 * create) and `verify` evaluates the account read after quiescence against it:
 *
 *   - every column outside the named exclusions below must be unchanged
 *     (a private digest; no account values reach the ledger);
 *   - Tax Status and BMF 509 must equal their pre-run values (digested
 *     separately);
 *   - the GoVerify timestamps may move only to times within the run window;
 *   - `akoya_countofrequests` may be unchanged or exactly +1; the other seven
 *     Request-aggregating rollups are protected; the `_date`/`_state`
 *     companions of all eight may move;
 *   - the Foundation's Contacts stay on their `versionnumber` digest.
 *
 * Each change to these lists is a reviewed commit (open question 4).
 */
import { bodyOrThrow, sha256 } from './basic-clone-steps.js';

export const FOUNDATION_TRANSITION_KIND = 'foundation_transition';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;

/** Must end at their pre-run values (the observed refresh re-set the same values). */
export const GOVERIFY_RESULT_FIELDS = Object.freeze(['akoya_taxstatus', 'wmkf_bmf509']);

/** May move, only to a time within the run window. Receipt key per field. */
export const GOVERIFY_STAMP_FIELDS = Object.freeze({
  akoya_goverifytrigger: 'goverifyTriggerAt',
  akoya_dexempt: 'exemptionCheckedAt',
});

/** Open question 7: may be unchanged or +1 per clone. */
export const REQUEST_COUNT_ROLLUP = 'akoya_countofrequests';

/** Open question 7: a clone is never awarded, so these never move. */
export const PROTECTED_REQUEST_ROLLUPS = Object.freeze([
  'akoya_countofawards', 'wmkf_countofdiscretionarygrant', 'wmkf_countofprogramgrants',
  'akoya_totalgrants', 'wmkf_sumofdiscretionarygrants', 'wmkf_sumofprogramgrants', 'akoya_mostrecentgrant',
]);

const ROLLUP_COMPANIONS = [REQUEST_COUNT_ROLLUP, ...PROTECTED_REQUEST_ROLLUPS]
  .flatMap((field) => [`${field}_date`, `${field}_state`]);

/** Row metadata every write moves (the GoVerify refresh is a write). */
const WRITE_METADATA = ['versionnumber', 'modifiedon', '_modifiedby_value', '_modifiedonbehalfby_value'];

/** Columns left out of the protected projection. Everything else is protected. */
export const PROJECTION_EXCLUSIONS = Object.freeze([
  ...WRITE_METADATA,
  ...GOVERIFY_RESULT_FIELDS,
  ...Object.keys(GOVERIFY_STAMP_FIELDS),
  REQUEST_COUNT_ROLLUP,
  ...ROLLUP_COMPANIONS,
]);
const EXCLUDED = new Set(PROJECTION_EXCLUSIONS);

/**
 * The contract names these columns; production's logical names are assumed
 * from the sandbox's metadata (plan P0b). A missing column would make its
 * rule pass vacuously, so absence fails closed.
 */
const REQUIRED_COLUMNS = [
  ...GOVERIFY_RESULT_FIELDS, ...Object.keys(GOVERIFY_STAMP_FIELDS), REQUEST_COUNT_ROLLUP, ...PROTECTED_REQUEST_ROLLUPS,
];

/** Allowed clock difference between this process and Dataverse. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** A date-only stamp is written in some user's local day; allow any UTC offset. */
const DATE_ONLY_SLACK_MS = 14 * 60 * 60 * 1000;

/** The whole account row (no `$select`), so an unnamed column is protected too. */
export async function readFoundationAccount(client, accountId) {
  if (!GUID.test(String(accountId || ''))) throw new Error('Foundation account ID is not a GUID.');
  const row = bodyOrThrow('Foundation account read', await client.get(`/accounts(${accountId})`));
  if (String(row?.accountid || '').toLowerCase() !== String(accountId).toLowerCase()) {
    throw new Error('Foundation account read returned a different row.');
  }
  return row;
}

function missingColumns(account) {
  return REQUIRED_COLUMNS.filter((field) => !Object.prototype.hasOwnProperty.call(account, field));
}

function projectionDigest(account) {
  const entries = Object.keys(account)
    .filter((key) => !key.includes('@') && !EXCLUDED.has(key))
    .sort()
    .map((key) => [key, account[key] ?? null]);
  return sha256(entries);
}

function goverifyResultDigest(account) {
  return sha256(GOVERIFY_RESULT_FIELDS.map((field) => [field, account[field] ?? null]));
}

function contactsDigest(contacts) {
  return sha256([...contacts]
    .map((row) => [String(row.contactid).toLowerCase(), String(row.versionnumber)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

function stampValue(account, field) {
  const value = account[field] ?? null;
  if (value !== null && !(typeof value === 'string' && (DATE_ONLY.test(value) || DATE_TIME.test(value)))) {
    throw new Error(`Foundation ${field} is not a date or UTC timestamp.`);
  }
  return value;
}

/**
 * Receipt journaled at `fence_source` (before the create). Holds digests, the
 * pre-run Request count, the two GoVerify timestamps and the capture time only.
 */
export function captureFoundationBaseline(account, contacts, capturedAt) {
  const missing = missingColumns(account);
  if (missing.length) throw new Error(`Foundation account read lacks transition-contract column(s): ${missing.join(', ')}.`);
  const count = account[REQUEST_COUNT_ROLLUP];
  if (!Number.isInteger(count) || count < 0) throw new Error(`Foundation ${REQUEST_COUNT_ROLLUP} is not a non-negative integer.`);
  const receipt = {
    kind: FOUNDATION_TRANSITION_KIND,
    organizationId: String(account.accountid).toLowerCase(),
    foundationProjectionSha256: projectionDigest(account),
    foundationGoverifyResultSha256: goverifyResultDigest(account),
    foundationContactsSha256: contactsDigest(contacts),
    count,
    capturedAt: capturedAt.toISOString(),
  };
  for (const [field, key] of Object.entries(GOVERIFY_STAMP_FIELDS)) {
    const value = stampValue(account, field);
    if (value !== null) receipt[key] = value;
  }
  return receipt;
}

/** The baseline fields a repeated `fence_source` must reproduce exactly. */
export function sameFoundationBaseline(recorded, fresh) {
  return ['kind', 'organizationId', 'foundationProjectionSha256', 'foundationGoverifyResultSha256',
    'foundationContactsSha256', 'count', ...Object.values(GOVERIFY_STAMP_FIELDS)]
    .every((key) => (recorded?.[key] ?? null) === (fresh[key] ?? null));
}

function withinWindow(field, value, capturedAt, verifiedAt) {
  // The exemption date is a day: Dataverse may return it date-only or as a
  // midnight timestamp in some user's zone, so it is compared by calendar day.
  if (field === 'akoya_dexempt' || DATE_ONLY.test(value)) {
    const day = value.slice(0, 10);
    const earliest = new Date(capturedAt.getTime() - DATE_ONLY_SLACK_MS).toISOString().slice(0, 10);
    const latest = new Date(verifiedAt.getTime() + DATE_ONLY_SLACK_MS).toISOString().slice(0, 10);
    return day >= earliest && day <= latest;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) && at >= capturedAt.getTime() - CLOCK_SKEW_MS && at <= verifiedAt.getTime() + CLOCK_SKEW_MS;
}

/**
 * Pure evaluation of the account and Contacts read after quiescence against
 * the `fence_source` baseline. `outcome` is `refreshed` when the GoVerify
 * trigger moved within the window and `not_refreshed` when no GoVerify field
 * moved (plan P5). Failures name columns and rules, never values.
 */
export function evaluateFoundationTransition(baseline, accountAfter, contactsAfter, { verifiedAt }) {
  const failures = [];
  const capturedAt = new Date(baseline?.capturedAt);
  if (baseline?.kind !== FOUNDATION_TRANSITION_KIND || !baseline.foundationProjectionSha256
      || !baseline.foundationGoverifyResultSha256 || !baseline.foundationContactsSha256
      || !Number.isInteger(baseline.count) || Number.isNaN(capturedAt.getTime())) {
    return { failures: ['Foundation pre-create baseline is missing or unreadable'], outcome: null };
  }
  if (String(accountAfter?.accountid || '').toLowerCase() !== baseline.organizationId) {
    return { failures: ['Foundation account identity differs from the pre-create baseline'], outcome: null };
  }
  const missing = missingColumns(accountAfter);
  if (missing.length) {
    return { failures: [`Foundation account read lacks transition-contract column(s): ${missing.join(', ')}`], outcome: null };
  }

  if (projectionDigest(accountAfter) !== baseline.foundationProjectionSha256) {
    failures.push('Foundation account protected columns changed during the run');
  }
  if (goverifyResultDigest(accountAfter) !== baseline.foundationGoverifyResultSha256) {
    failures.push('Foundation Tax Status or BMF 509 differs from its pre-run value');
  }
  const countAfter = accountAfter[REQUEST_COUNT_ROLLUP];
  if (!Number.isInteger(countAfter) || (countAfter !== baseline.count && countAfter !== baseline.count + 1)) {
    failures.push(`Foundation ${REQUEST_COUNT_ROLLUP} is neither unchanged nor +1`);
  }
  if (contactsDigest(contactsAfter) !== baseline.foundationContactsSha256) {
    failures.push('Foundation contact rows changed during the run');
  }

  const moved = {};
  for (const [field, key] of Object.entries(GOVERIFY_STAMP_FIELDS)) {
    let value;
    try {
      value = stampValue(accountAfter, field);
    } catch (error) {
      failures.push(error.message.replace(/\.$/, ''));
      continue;
    }
    if (value === (baseline[key] ?? null)) continue;
    moved[field] = true;
    if (value === null || !withinWindow(field, value, capturedAt, verifiedAt)) {
      failures.push(`Foundation ${field} changed to a value outside the run window`);
    }
  }
  // The exemption date is date-only, so a same-day refresh can leave it
  // unchanged; the trigger stamp is the refresh signal.
  if (moved.akoya_dexempt && !moved.akoya_goverifytrigger) {
    failures.push('Foundation akoya_dexempt moved without a GoVerify trigger');
  }
  return { failures, outcome: failures.length ? null : (moved.akoya_goverifytrigger ? 'refreshed' : 'not_refreshed') };
}
