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

// Calibrated S183 from 60d prod spend data: max observed legitimate day
// was $26.16 (a batch-processing day with 386 requests); avg active day
// $1.85. $75 leaves ~3x headroom over the observed max while still
// catching a true runaway (a loop hitting Claude at full rate burns
// $75 in well under an hour). Override per-env via DAILY_SPEND_ALERT_CENTS.
const DAILY_THRESHOLD_DEFAULT_CENTS = 7500;    // $75

const DAILY_ALERT_KEY = 'spend:daily-threshold';

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
    const dailyThreshold = await checkDailyThreshold();
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
  // here so the daily sum still reflects panel spend. Same day window as
  // api_usage_log above (created_at::date = CURRENT_DATE). Uses the SAME
  // ATTEMPT_COST_UNKNOWN_SQL predicate as review-panel-store.js's
  // sumAttemptCosts/sumEntryAttemptCosts and pages/api/admin/stats.js — a
  // single definition so "unknown cost" can never drift between call sites.
  // A reaped/late attempt is state='unknown_outcome' with cost_state left
  // NULL (never set by the late path); a finalized completed/failed attempt
  // can ALSO carry cost_state='unknown' when its paid-call confirmation was
  // itself ambiguous — both must count, and neither is ever folded into the
  // known total. Built with sql.query (not the tagged template) so the
  // predicate lands as literal SQL text, not a bound parameter.
  const panelResult = await sql.query(
    `SELECT COALESCE(SUM(a.cost_cents) FILTER (WHERE NOT ${ATTEMPT_COST_UNKNOWN_SQL}), 0)::numeric AS panel_known_cost_cents,
            COUNT(*) FILTER (WHERE ${ATTEMPT_COST_UNKNOWN_SQL})::int AS panel_unknown_count
     FROM review_panel_seat_attempts a
     WHERE a.created_at::date = CURRENT_DATE`);
  const panelKnownCents = Number(panelResult.rows[0].panel_known_cost_cents);
  const panelUnknownCount = Number(panelResult.rows[0].panel_unknown_count);
  const spentCents = Number(total_cost_cents) + panelKnownCents;

  const overThreshold = spentCents > thresholdCents;
  // Alert on EITHER condition: an unresolved-cost review panel attempt is
  // itself alert-worthy even when the (necessarily incomplete) known total
  // stays under threshold — a silent gap in spend visibility is exactly what
  // this cron exists to surface, not something to wait out until it happens
  // to coincide with a threshold breach. Same DAILY_ALERT_KEY/autoResolveKey
  // either way, so the existing dedupe/autoResolve semantics are unchanged:
  // one alert row, auto-resolved only once BOTH conditions clear.
  if (overThreshold || panelUnknownCount > 0) {
    const incompleteNote = panelUnknownCount > 0
      ? `${panelUnknownCount} review panel attempt(s) have unknown cost; the daily total is incomplete. Known review panel cost today: $${(panelKnownCents / 100).toFixed(2)}.`
      : '';
    const title = overThreshold
      ? `Today's AI spend exceeded $${(thresholdCents / 100).toFixed(2)}`
      : 'Review panel attempts have unknown cost today';
    const message = overThreshold
      ? `Current spend: $${(spentCents / 100).toFixed(2)} across ${request_count} requests (includes $${(panelKnownCents / 100).toFixed(2)} of known review panel cost). Threshold: $${(thresholdCents / 100).toFixed(2)} (DAILY_SPEND_ALERT_CENTS).${incompleteNote ? ` ${incompleteNote}` : ''}`
      : incompleteNote;
    await AlertService.createAlert({
      type: 'spend_threshold',
      severity: 'warning',
      title,
      message,
      metadata: { spentCents, thresholdCents, requestCount: request_count, panelKnownCents, panelUnknownCount, overThreshold },
      source: 'cron/spend-check',
      autoResolveKey: DAILY_ALERT_KEY,
    });
    return { status: 'alerting', spentCents, thresholdCents, requestCount: request_count, panelKnownCents, panelUnknownCount };
  }

  await AlertService.autoResolve(DAILY_ALERT_KEY);
  return { status: 'ok', spentCents, thresholdCents, requestCount: request_count, panelKnownCents, panelUnknownCount };
}
