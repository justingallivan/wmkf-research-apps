/**
 * Cron: /api/cron/spend-check
 *
 * Hourly check for the daily AI spend threshold. Sums `api_usage_log` for
 * today across all providers/apps and compares to `DAILY_SPEND_ALERT_CENTS`.
 * Creates a `system_alerts` row when exceeded; auto-resolves the next hour
 * when back under. Designed to catch runaway-cost bugs (code wedged in a
 * loop, prompt mistakenly looping a large input), not normal usage.
 *
 * S181 cleanup: the low-balance estimator was removed. Anthropic's
 * auto-reload + spend-limit notifications cover the "credits run out" and
 * "monthly budget approaching" failure modes natively — the local
 * anchor-based estimate was monitoring an impossibility.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses).
 */

import { sql } from '@vercel/postgres';
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import AlertService from '../../../lib/services/alert-service';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { ATTEMPT_COST_UNKNOWN_SQL } from '../../../lib/services/review-panel-store';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { testRequestIsolationEnabled } from '../../../lib/services/test-requests/isolation.js';
import { excludeTestRequestSpendRows } from '../../../lib/services/test-requests/spend-isolation.js';

// Calibrated S183 from 60d prod spend data: max observed legitimate day
// was $26.16 (a batch-processing day with 386 requests); avg active day
// $1.85. $75 leaves ~3x headroom over the observed max while still
// catching a true runaway (a loop hitting Claude at full rate burns
// $75 in well under an hour). Override per-env via DAILY_SPEND_ALERT_CENTS.
const DAILY_THRESHOLD_DEFAULT_CENTS = 7500;    // $75

const DAILY_ALERT_KEY = 'spend:daily-threshold';
// Distinct key (Opus recheck of 5353a314, item 2): the panel's own
// unknown-cost condition must never share a dedupe key with the daily
// threshold breach, or an early unknown-only alert would suppress a later
// genuine breach (and vice versa).
const PANEL_UNKNOWN_ALERT_KEY = 'spend:review-panel-unknown-cost';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  // Maintenance run AFTER auth guards (Codex pass-4 §5 + pass-5 Q4) so
  // rejected requests don't write spurious rows; authenticated runs always
  // pair start↔complete.
  const runId = await MaintenanceService.startRun('spend-check');

  try {
    const dailyThreshold = await withDalContext('cron-spend-check', () => checkDailyThreshold());
    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: dailyThreshold.requestCount ?? 0,
      details: dailyThreshold,
    });
    return res.json({ ok: true, dailyThreshold });
  } catch (error) {
    console.error('Spend-check cron error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'Spend check failed', message: 'Internal error' });
  }
}

async function checkDailyThreshold() {
  const thresholdCents = Number(process.env.DAILY_SPEND_ALERT_CENTS) || DAILY_THRESHOLD_DEFAULT_CENTS;

  const result = await sql`
    SELECT COALESCE(SUM(estimated_cost_cents), 0)::numeric AS total_cost_cents,
           COUNT(*)::int AS request_count
    FROM api_usage_log
    WHERE created_at::date = CURRENT_DATE
  `;
  const { total_cost_cents, request_count } = result.rows[0];

  // The Virtual Review Panel Phase A foundation never writes api_usage_log
  // (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.5)
  // — its own per-seat/chair ledger (review_panel_seat_attempts) is added
  // here so the daily sum still reflects panel spend. See
  // getReviewPanelDailyCost below for the migration-not-applied guard.
  const panel = await getReviewPanelDailyCost();
  const panelKnownCents = panel.knownCents;
  const panelUnknownCount = panel.unknownCount;
  const spentCents = Number(total_cost_cents) + panelKnownCents;

  const overThreshold = spentCents > thresholdCents;
  const isolationMetadata = testRequestIsolationEnabled() ? {
    testRequestIsolation: panel.isolation,
    apiUsageAttribution: 'unattributable',
  } : {};
  const metadata = { spentCents, thresholdCents, requestCount: request_count, panelKnownCents, panelUnknownCount, overThreshold, panelAvailable: panel.available, ...isolationMetadata };

  // Two INDEPENDENT alerts, each with its own dedupe key and its own
  // create/autoResolve pair, so one condition can never suppress or
  // prematurely clear the other. Previously both conditions shared
  // DAILY_ALERT_KEY: an unknown-only alert raised early in the day (e.g.
  // 9am, threshold not yet breached) would auto-resolve-key-collide with a
  // genuine threshold breach later that same day (e.g. 2pm) — the breach
  // never got its own row because AlertService.createAlert's dedupe treats
  // an existing active row under the same key as already-alerted. Splitting
  // the keys means the breach alert always fires on its own, and each
  // condition auto-resolves independently the moment IT clears, regardless
  // of the other's state.
  if (overThreshold) {
    await AlertService.createAlert({
      type: 'spend_threshold',
      severity: 'warning',
      title: `Today's AI spend exceeded $${(thresholdCents / 100).toFixed(2)}`,
      message: `Current spend: $${(spentCents / 100).toFixed(2)} across ${request_count} requests (includes $${(panelKnownCents / 100).toFixed(2)} of known review panel cost). Threshold: $${(thresholdCents / 100).toFixed(2)} (DAILY_SPEND_ALERT_CENTS).`,
      metadata,
      source: 'cron/spend-check',
      autoResolveKey: DAILY_ALERT_KEY,
    });
  } else {
    await AlertService.autoResolve(DAILY_ALERT_KEY);
  }

  // The unknown-cost alert must never fire while the ledger itself is
  // unavailable (migration 047 not yet applied) — an unmigrated table isn't
  // an "unknown cost" condition, it's simply not there yet.
  if (panel.available && panelUnknownCount > 0) {
    await AlertService.createAlert({
      type: 'spend_threshold',
      severity: 'warning',
      title: 'Review panel attempts have unknown cost today',
      message: `${panelUnknownCount} review panel attempt(s) have unknown cost; the daily total is incomplete. Known review panel cost today: $${(panelKnownCents / 100).toFixed(2)}.`,
      metadata,
      source: 'cron/spend-check',
      autoResolveKey: PANEL_UNKNOWN_ALERT_KEY,
    });
  } else {
    await AlertService.autoResolve(PANEL_UNKNOWN_ALERT_KEY);
  }

  return { status: (overThreshold || (panel.available && panelUnknownCount > 0)) ? 'alerting' : 'ok', spentCents, thresholdCents, requestCount: request_count, panelKnownCents, panelUnknownCount, panelAvailable: panel.available, ...isolationMetadata };
}

// Same day window as api_usage_log above (created_at::date = CURRENT_DATE).
// Uses the SAME ATTEMPT_COST_UNKNOWN_SQL predicate as review-panel-store.js's
// sumAttemptCosts/sumEntryAttemptCosts and pages/api/admin/stats.js — a
// single definition so "unknown cost" can never drift between call sites.
// A reaped/late attempt is state='unknown_outcome' with cost_state left
// NULL (never set by the late path); a finalized completed/failed attempt
// can ALSO carry cost_state='unknown' when its paid-call confirmation was
// itself ambiguous — both must count, and neither is ever folded into the
// known total. Built with sql.query (not the tagged template) so the
// predicate lands as literal SQL text, not a bound parameter.
//
// PR #281 merges review_panel_seat_attempts callers before migration 047
// runs on main's auto-deploy, so this table can legitimately not exist yet.
// Isolate that one failure mode (Postgres 42P01 undefined_table) from the
// rest of the handler: return the "not yet migrated" shape instead of
// throwing, so the daily spend-check cron keeps running on api_usage_log
// alone. Any other error still propagates — this is not a blanket swallow.
async function getReviewPanelDailyCost() {
  try {
    if (testRequestIsolationEnabled()) {
      const grouped = await sql.query(
        `SELECT e.request_id AS request_id,
                COUNT(*)::int AS attempt_count,
                COALESCE(SUM(a.cost_cents) FILTER (WHERE NOT ${ATTEMPT_COST_UNKNOWN_SQL}), 0)::numeric AS known_cost_cents,
                COUNT(*) FILTER (WHERE ${ATTEMPT_COST_UNKNOWN_SQL})::int AS unknown_count
         FROM review_panel_seat_attempts a
         JOIN review_panel_entries e ON e.id = a.entry_id
         WHERE a.created_at::date = CURRENT_DATE
         GROUP BY e.request_id`);
      const filtered = await excludeTestRequestSpendRows(grouped.rows);
      return {
        knownCents: filtered.rows.reduce((sum, row) => sum + Number(row.known_cost_cents), 0),
        unknownCount: filtered.rows.reduce((sum, row) => sum + Number(row.unknown_count), 0),
        available: true,
        isolation: filtered.isolation,
      };
    }
    const panelResult = await sql.query(
      `SELECT COALESCE(SUM(a.cost_cents) FILTER (WHERE NOT ${ATTEMPT_COST_UNKNOWN_SQL}), 0)::numeric AS panel_known_cost_cents,
              COUNT(*) FILTER (WHERE ${ATTEMPT_COST_UNKNOWN_SQL})::int AS panel_unknown_count
       FROM review_panel_seat_attempts a
       WHERE a.created_at::date = CURRENT_DATE`);
    return {
      knownCents: Number(panelResult.rows[0].panel_known_cost_cents),
      unknownCount: Number(panelResult.rows[0].panel_unknown_count),
      available: true,
    };
  } catch (error) {
    if (error && error.code === '42P01') {
      console.warn('review_panel_seat_attempts not present; migration 047 not applied');
      return { knownCents: 0, unknownCount: 0, available: false };
    }
    throw error;
  }
}
