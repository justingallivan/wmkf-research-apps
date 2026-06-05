/**
 * Reviewer search time budget — single admin-editable Dataverse setting.
 *
 * Reviewer searches (analyze → discover → enrich) chain many sequential Claude
 * calls + external lookups and can run for minutes. This setting is the
 * application-level wall-clock budget those routes enforce via an AbortSignal
 * deadline. It exists because the Vercel `maxDuration` route wall is a
 * build-time-static value and CANNOT be made live-admin-editable; the routes
 * pin `maxDuration` at the plan ceiling (800s) and this number is the live knob
 * that lives below it. See docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
 *
 * Ground truth: `wmkf_appsystemsettings` key `reviewer.time_budget_seconds`,
 * read live wherever a reviewer search starts. Modeled on
 * `lib/services/honorarium-config.js` BUT with the opposite failure posture:
 *
 *   - honorarium gates a MONEY write → throws on any ambiguity (never guess).
 *   - this gates SEARCH DURATION → a search on the default budget beats no
 *     search, so it NEVER throws: absent key, malformed value, or a settings
 *     fetch failure all fall back to the documented 600s default.
 *
 * Uses the lenient `getSetting` (which swallows fetch failures → null), so
 * "key absent" and "Dataverse outage" collapse to the same default — which is
 * the correct behavior here (both → 600).
 */

const { getSetting } = require('./settings-service');

const REVIEWER_TIME_BUDGET_KEY = 'reviewer.time_budget_seconds';
const DEFAULT_REVIEWER_TIME_BUDGET_SECONDS = 600;
// Hard bounds. MAX is the Vercel Pro/Enterprise Fluid-Compute maxDuration cap
// (the routes pin maxDuration at 800), so the budget can never out-run the
// platform wall. MIN keeps a pathological tiny value from breaking searches.
const MIN_REVIEWER_TIME_BUDGET_SECONDS = 120;
const MAX_REVIEWER_TIME_BUDGET_SECONDS = 800;

function clampBudget(n) {
  return Math.min(
    MAX_REVIEWER_TIME_BUDGET_SECONDS,
    Math.max(MIN_REVIEWER_TIME_BUDGET_SECONDS, n),
  );
}

/**
 * Resolve the reviewer search time budget in seconds. ALWAYS returns a finite,
 * clamped number in [120, 800]; never throws.
 * @returns {Promise<number>}
 */
async function getReviewerTimeBudgetSeconds() {
  let raw;
  try {
    raw = await getSetting(REVIEWER_TIME_BUDGET_KEY); // string | null; swallows fetch failures
  } catch {
    // getSetting is already lenient, but belt-and-suspenders: never let a
    // settings fault break a search.
    return DEFAULT_REVIEWER_TIME_BUDGET_SECONDS;
  }

  if (raw == null || String(raw).trim() === '') {
    return DEFAULT_REVIEWER_TIME_BUDGET_SECONDS; // key absent or empty
  }

  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(
      `[reviewer-time-budget] setting '${REVIEWER_TIME_BUDGET_KEY}' is malformed: ` +
      `'${raw}' — falling back to ${DEFAULT_REVIEWER_TIME_BUDGET_SECONDS}s`,
    );
    return DEFAULT_REVIEWER_TIME_BUDGET_SECONDS;
  }

  return clampBudget(n);
}

module.exports = {
  REVIEWER_TIME_BUDGET_KEY,
  DEFAULT_REVIEWER_TIME_BUDGET_SECONDS,
  MIN_REVIEWER_TIME_BUDGET_SECONDS,
  MAX_REVIEWER_TIME_BUDGET_SECONDS,
  getReviewerTimeBudgetSeconds,
};
