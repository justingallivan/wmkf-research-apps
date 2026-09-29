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
 *     (a digest; the ledger holds only digests, the pre-run Request count
 *     and the two GoVerify timestamps);
 *   - Tax Status and BMF 509 must equal their pre-run values (digested
 *     separately);
 *   - the GoVerify timestamps may move only to times within the run window;
 *   - `akoya_countofrequests` may be unchanged or exactly +1; every other
 *     rollup value is protected; every account rollup's `_date` may move and
 *     its `_state` must read Calculated before and after;
 *   - the four non-audited GuideStar columns are protected under their own
 *     digest;
 *   - the Foundation's Contacts stay on their `versionnumber` digest;
 *   - the account's Primary Contact (`_primarycontactid_value`) may stay
 *     unchanged or become the run's journaled cast Liaison, and nothing else
 *     (cast-and-status plan, owner decision 1: *WMKF_Update Org Primary
 *     Contact from Request* copies a Request's Liaison onto the Foundation).
 *     Allowed, not required: that workflow is update-only (probe section 4),
 *     so a create-body bind is not expected to fire it. The allowance needs
 *     the pre-run value, which only a baseline carrying `primaryContactId`
 *     holds; a baseline without it (every baseline `captureFoundationBaseline`
 *     journals today, since the ledger receipt grammar has no such key yet)
 *     keeps the column inside the protected projection, so any change to it
 *     fails closed.
 *
 * Each change to these lists is a reviewed commit (open question 4).
 */
import { bodyOrThrow, getContactSnapshot, sha256 } from './basic-clone-steps.js';

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

/**
 * Every rollup on the production account (probe section 10, 2026-09-28). The
 * platform recalculates them together, so each `_date`/`_state` companion
 * moves on any recalculation even when its value does not; the values stay
 * protected. A rollup added later fails closed until listed here.
 */
export const ACCOUNT_ROLLUPS = Object.freeze([
  REQUEST_COUNT_ROLLUP, ...PROTECTED_REQUEST_ROLLUPS, 'opendeals', 'openrevenue', 'wmkf_countofconcepts',
]);

const ROLLUP_COMPANIONS = ACCOUNT_ROLLUPS.flatMap((field) => [`${field}_date`, `${field}_state`]);

/** Dataverse rollup state 1 = Calculated; 0 is not calculated and 2–7 are calculation errors (Codex round 1, PR #354). */
const ROLLUP_CALCULATED = 1;

/**
 * A rollup's `_date` may move freely, but its `_state` must read Calculated
 * (or be absent, as on the system `opendeals`/`openrevenue`), before the
 * create and after it: a failed recalculation can keep its old value, so an
 * unchanged value would not show it.
 */
function rollupStateFailures(account) {
  return ACCOUNT_ROLLUPS
    .filter((field) => {
      const state = account[`${field}_state`];
      return state !== undefined && state !== null && state !== ROLLUP_CALCULATED;
    })
    .map((field) => `Foundation ${field} rollup is not Calculated (state ${account[`${field}_state`]})`);
}

/**
 * GuideStar columns with auditing off (probe section 10) that a GoVerify
 * refresh may write. Protected, but digested separately so a failure says
 * whether they moved: the audit history cannot show it.
 */
export const GUIDESTAR_FIELDS = Object.freeze([
  'akoya_guidestarcode', 'akoya_guidestardescription', 'akoya_guidestarirsbmfsubsection', 'akoya_guidestarorganizationname',
]);

/** Row metadata every write moves (the GoVerify refresh is a write). */
const WRITE_METADATA = ['versionnumber', 'modifiedon', '_modifiedby_value', '_modifiedonbehalfby_value'];

/** Columns left out of the protected projection. Everything else is protected. */
export const PROJECTION_EXCLUSIONS = Object.freeze([
  ...WRITE_METADATA,
  ...GOVERIFY_RESULT_FIELDS,
  ...Object.keys(GOVERIFY_STAMP_FIELDS),
  REQUEST_COUNT_ROLLUP,
  ...ROLLUP_COMPANIONS,
  ...GUIDESTAR_FIELDS,
]);
const EXCLUDED = new Set(PROJECTION_EXCLUSIONS);

/**
 * The contract names these columns; production's logical names are assumed
 * from the sandbox's metadata (plan P0b). A missing column would make its
 * rule pass vacuously, so absence fails closed.
 */
export const PRIMARY_CONTACT_FIELD = '_primarycontactid_value';

const REQUIRED_COLUMNS = [
  PRIMARY_CONTACT_FIELD, ...GOVERIFY_RESULT_FIELDS, ...Object.keys(GOVERIFY_STAMP_FIELDS), REQUEST_COUNT_ROLLUP, ...PROTECTED_REQUEST_ROLLUPS, ...GUIDESTAR_FIELDS,
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

function projectionDigest(account, { excludePrimaryContact = false } = {}) {
  const entries = Object.keys(account)
    .filter((key) => !key.includes('@') && !EXCLUDED.has(key) && !(excludePrimaryContact && key === PRIMARY_CONTACT_FIELD))
    .sort()
    .map((key) => [key, account[key] ?? null]);
  return sha256(entries);
}

function goverifyResultDigest(account) {
  return sha256(GOVERIFY_RESULT_FIELDS.map((field) => [field, account[field] ?? null]));
}

function guidestarDigest(account) {
  return sha256(GUIDESTAR_FIELDS.map((field) => [field, account[field] ?? null]));
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
 * Receipt journaled at `fence_source` (before the create). Holds digests plus
 * three plain account values (the pre-run Request count and the two GoVerify
 * timestamps), which the count and window rules need, and the capture time.
 */
/**
 * `journalPrimaryContact` journals the pre-run Primary Contact as
 * `primaryContactId` (null when the account has none) and leaves it out of
 * the projection digest, and `liaisonContactId` journals the Liaison this run
 * binds. Verify and every later recheck allow the Primary Contact to become
 * that journaled Liaison and nothing else; a baseline without a journaled
 * Liaison fails closed on any Primary Contact change.
 */
export function captureFoundationBaseline(account, contacts, capturedAt, { journalPrimaryContact = false, liaisonContactId = null } = {}) {
  const missing = missingColumns(account);
  if (missing.length) throw new Error(`Foundation account read lacks transition-contract column(s): ${missing.join(', ')}.`);
  const unhealthy = rollupStateFailures(account);
  if (unhealthy.length) throw new Error(`${unhealthy.join('; ')}.`);
  const count = account[REQUEST_COUNT_ROLLUP];
  if (!Number.isInteger(count) || count < 0) throw new Error(`Foundation ${REQUEST_COUNT_ROLLUP} is not a non-negative integer.`);
  const receipt = {
    kind: FOUNDATION_TRANSITION_KIND,
    organizationId: String(account.accountid).toLowerCase(),
    foundationProjectionSha256: projectionDigest(account, { excludePrimaryContact: journalPrimaryContact }),
    foundationGoverifyResultSha256: goverifyResultDigest(account),
    foundationGuidestarSha256: guidestarDigest(account),
    foundationContactsSha256: contactsDigest(contacts),
    count,
    capturedAt: capturedAt.toISOString(),
  };
  if (journalPrimaryContact) {
    const primary = account[PRIMARY_CONTACT_FIELD] ?? null;
    if (primary !== null && !GUID.test(String(primary))) throw new Error(`Foundation ${PRIMARY_CONTACT_FIELD} is not a GUID.`);
    receipt.primaryContactId = primary === null ? null : String(primary).toLowerCase();
    if (liaisonContactId !== null && liaisonContactId !== undefined) {
      if (!GUID.test(String(liaisonContactId))) throw new Error('The run\'s cast Liaison is not a GUID.');
      receipt.liaisonContactId = String(liaisonContactId).toLowerCase();
    }
  }
  for (const [field, key] of Object.entries(GOVERIFY_STAMP_FIELDS)) {
    const value = stampValue(account, field);
    if (value !== null) receipt[key] = value;
  }
  return receipt;
}

/** The baseline fields a repeated `fence_source` must reproduce exactly. */
export function sameFoundationBaseline(recorded, fresh) {
  return ['kind', 'organizationId', 'foundationProjectionSha256', 'foundationGoverifyResultSha256', 'foundationGuidestarSha256',
    'foundationContactsSha256', 'count', 'primaryContactId', 'liaisonContactId', ...Object.values(GOVERIFY_STAMP_FIELDS)]
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
      || !baseline.foundationGoverifyResultSha256 || !baseline.foundationGuidestarSha256 || !baseline.foundationContactsSha256
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

  // A baseline that journaled the pre-run Primary Contact digests the
  // projection without it and checks the column on its own rule below.
  const primaryContactJournaled = Object.prototype.hasOwnProperty.call(baseline, 'primaryContactId');
  if (projectionDigest(accountAfter, { excludePrimaryContact: primaryContactJournaled }) !== baseline.foundationProjectionSha256) {
    failures.push('Foundation account protected columns changed during the run');
  }
  if (primaryContactJournaled) {
    const before = baseline.primaryContactId === null ? null : String(baseline.primaryContactId).toLowerCase();
    const after = accountAfter[PRIMARY_CONTACT_FIELD] == null ? null : String(accountAfter[PRIMARY_CONTACT_FIELD]).toLowerCase();
    // Only the Liaison journaled with this run's baseline counts, never the
    // cast's current one (a later cast replacement must not change an audit).
    const liaison = GUID.test(String(baseline.liaisonContactId || '')) ? String(baseline.liaisonContactId).toLowerCase() : null;
    if (after !== before && (liaison === null || after !== liaison)) {
      failures.push('Foundation Primary Contact changed to a contact other than the run\'s cast Liaison');
    }
  }
  if (goverifyResultDigest(accountAfter) !== baseline.foundationGoverifyResultSha256) {
    failures.push('Foundation Tax Status or BMF 509 differs from its pre-run value');
  }
  failures.push(...rollupStateFailures(accountAfter));
  if (guidestarDigest(accountAfter) !== baseline.foundationGuidestarSha256) {
    failures.push('Foundation GuideStar columns (not audited) changed during the run');
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

/**
 * Fresh account and Contacts reads evaluated against a run's journaled
 * `fence_source` baseline. Used by `verify` and by the CLI's read-only
 * `--run-recheck` (plan P5's later check: one read after a fixed delay is not
 * a quiescence barrier, so the owner re-runs this after the run is ready).
 */
export async function recheckFoundationTransition({ client, organizationId, resources, verifiedAt = new Date() }) {
  const baselines = resources.filter((row) => row.step === 'fence_source' && row.resourceKind === FOUNDATION_TRANSITION_KIND);
  const [account, contacts] = await Promise.all([
    readFoundationAccount(client, organizationId),
    getContactSnapshot(client, organizationId),
  ]);
  return evaluateFoundationTransition(baselines.length === 1 ? baselines[0].plannedIdentity : null, account, contacts, { verifiedAt });
}
