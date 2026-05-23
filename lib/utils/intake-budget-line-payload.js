/**
 * intake-budget-line-payload.js
 *
 * Pure helpers for the wmkf_proposalbudgetline child rows the drain
 * dynamics_patched step writes. Lives outside the route module so unit
 * tests can load it without pulling in pg (which doesn't load in jsdom).
 *
 * Authoritative shape: docs/atlas/dataverse-wmkf-proposalbudgetline.md
 * + docs/INTAKE_PORTAL_DRAIN_PLAN.md §"Child Create payload shape".
 *
 * Contract:
 *   Input row (caller-supplied, post-unroll — one row per year+category):
 *     {
 *       id: <uuid>,                 // pre-generated at submit time
 *       year: <int 1..10>,
 *       category: <int 100000000..100000009>,
 *       amount: <decimal>,          // USD; >= 0; Indirect=0 by convention
 *       lineOrder: <int 0..100000>,
 *       description?: <string <=500>,
 *       roleCode?: <string <=60>,   // fixed-row discriminator; null for dynamic
 *       headcount?: <int 0..100000>,// Personnel only (category=100000000)
 *       effortPct?: <int 0..100>,   // Personnel only
 *     }
 *   Returns: the Dataverse POST body bound to a parent request.
 */
'use strict';

const PERSONNEL_CATEGORY = 100000000;
const INDIRECT_CATEGORY = 100000006;
const COSTSHARE_CATEGORIES = new Set([100000007, 100000008, 100000009]);
const VALID_CATEGORIES = new Set([
  100000000, 100000001, 100000002, 100000003, 100000004,
  100000005, 100000006, 100000007, 100000008, 100000009,
]);

// Category integer → display label (for synthesized wmkf_name + error
// messages). Matches the atlas page labels verbatim.
const CATEGORY_LABEL = {
  100000000: 'Personnel',
  100000001: 'Equipment',
  100000002: 'Supplies',
  100000003: 'Travel',
  100000004: 'Other Direct',
  100000005: 'Tuition',
  100000006: 'Indirect',
  100000007: 'Waived Indirect',
  100000008: 'Waived Tuition',
  100000009: 'Other Cost Share',
};

const NAME_MAX = 160;
const DESCRIPTION_MAX = 500;
const ROLE_CODE_MAX = 60;

/**
 * Truncate a string to a max length with an ellipsis when cut. The
 * ellipsis is included within the max so the result never exceeds it.
 */
function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

/**
 * Synthesize wmkf_name per drain plan §"Child Create payload shape":
 *   "Y{year} — {category-label}: {description}"   (≤160; truncate with ellipsis)
 * Description is optional — collapse the trailing `: ` if empty.
 */
function synthesizeName(year, category, description) {
  const label = CATEGORY_LABEL[category] ?? `Unknown (${category})`;
  const base = description
    ? `Y${year} — ${label}: ${description}`
    : `Y${year} — ${label}`;
  return truncate(base, NAME_MAX);
}

/**
 * Throws on invalid row. Returns void on success. Index included for
 * caller-side error pinpointing (submit-entry: 422 to applicant; drain-
 * entry: terminal validation_400 + system_alerts).
 */
function validateBudgetLineRow(row, idx) {
  if (!row || typeof row !== 'object') {
    throw new Error(`budget_lines[${idx}]: must be an object`);
  }
  // year — Integer 1..10
  if (!Number.isInteger(row.year) || row.year < 1 || row.year > 10) {
    throw new Error(`budget_lines[${idx}]: year must be integer 1..10, got ${row.year}`);
  }
  // category — one of the 10 reserved values
  if (!Number.isInteger(row.category) || !VALID_CATEGORIES.has(row.category)) {
    throw new Error(`budget_lines[${idx}]: invalid category ${row.category}`);
  }
  // amount — number, >= 0. Indirect (100000006) is conventionally 0 but
  // we don't enforce that here — the form layer owns the convention.
  if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0) {
    throw new Error(`budget_lines[${idx}]: amount must be number >= 0, got ${row.amount}`);
  }
  // lineOrder — Integer 0..100000
  if (!Number.isInteger(row.lineOrder) || row.lineOrder < 0 || row.lineOrder > 100000) {
    throw new Error(`budget_lines[${idx}]: lineOrder must be integer 0..100000, got ${row.lineOrder}`);
  }
  // description — optional, <= 500
  if (row.description != null) {
    if (typeof row.description !== 'string') {
      throw new Error(`budget_lines[${idx}]: description must be string or null`);
    }
    if (row.description.length > DESCRIPTION_MAX) {
      throw new Error(`budget_lines[${idx}]: description exceeds ${DESCRIPTION_MAX} chars`);
    }
  }
  // roleCode — optional, <= 60
  if (row.roleCode != null) {
    if (typeof row.roleCode !== 'string') {
      throw new Error(`budget_lines[${idx}]: roleCode must be string or null`);
    }
    if (row.roleCode.length > ROLE_CODE_MAX) {
      throw new Error(`budget_lines[${idx}]: roleCode exceeds ${ROLE_CODE_MAX} chars`);
    }
  }
  // Personnel-only fields. Per atlas spec they're null for non-Personnel
  // rows — the form layer should already enforce this, but the drain
  // validates it defensively (a stray headcount on a Travel row would
  // hit Dataverse as a constraint violation and surface as validation_400
  // anyway; catching it here gives a clearer error).
  if (row.category === PERSONNEL_CATEGORY) {
    if (row.headcount != null) {
      if (!Number.isInteger(row.headcount) || row.headcount < 0 || row.headcount > 100000) {
        throw new Error(`budget_lines[${idx}]: headcount must be integer 0..100000 (Personnel row), got ${row.headcount}`);
      }
    }
    if (row.effortPct != null) {
      if (!Number.isInteger(row.effortPct) || row.effortPct < 0 || row.effortPct > 100) {
        throw new Error(`budget_lines[${idx}]: effortPct must be integer 0..100 (Personnel row), got ${row.effortPct}`);
      }
    }
  } else {
    if (row.headcount != null) {
      throw new Error(`budget_lines[${idx}]: headcount only valid for Personnel rows (category=100000000)`);
    }
    if (row.effortPct != null) {
      throw new Error(`budget_lines[${idx}]: effortPct only valid for Personnel rows`);
    }
  }
}

/**
 * Build the Dataverse POST body for a single wmkf_proposalbudgetline row.
 * Caller is responsible for validating the input via validateBudgetLineRow
 * first — this builder trusts the shape.
 */
function buildBudgetLinePayload(row, requestId) {
  if (!row?.id) throw new Error('buildBudgetLinePayload: row.id required (pre-gen UUID)');
  if (!requestId) throw new Error('buildBudgetLinePayload: requestId required');

  const body = {
    wmkf_proposalbudgetlineid: row.id,
    wmkf_name: synthesizeName(row.year, row.category, row.description),
    wmkf_year: row.year,
    wmkf_category: row.category,
    wmkf_amount: row.amount,
    wmkf_lineorder: row.lineOrder,
    'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
  };
  if (row.description != null) body.wmkf_description = row.description;
  if (row.roleCode != null) body.wmkf_rolecode = row.roleCode;
  if (row.category === PERSONNEL_CATEGORY) {
    if (row.headcount != null) body.wmkf_headcount = row.headcount;
    if (row.effortPct != null) body.wmkf_effortpct = row.effortPct;
  }
  return body;
}

module.exports = {
  validateBudgetLineRow,
  buildBudgetLinePayload,
  synthesizeName,
  CATEGORY_LABEL,
  VALID_CATEGORIES,
  COSTSHARE_CATEGORIES,
  PERSONNEL_CATEGORY,
  INDIRECT_CATEGORY,
};
