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

const DAILY_THRESHOLD_DEFAULT_CENTS = 1000;    // $10

const DAILY_ALERT_KEY = 'spend:daily-threshold';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  try {
    const dailyThreshold = await checkDailyThreshold();
    return res.json({ ok: true, dailyThreshold });
  } catch (error) {
    console.error('Spend-check cron error:', error);
    return res.status(500).json({ error: 'Spend check failed', message: error.message });
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
  const spentCents = Number(total_cost_cents);

  if (spentCents > thresholdCents) {
    await AlertService.createAlert({
      type: 'spend_threshold',
      severity: 'warning',
      title: `Today's AI spend exceeded $${(thresholdCents / 100).toFixed(2)}`,
      message: `Current spend: $${(spentCents / 100).toFixed(2)} across ${request_count} requests. Threshold: $${(thresholdCents / 100).toFixed(2)} (DAILY_SPEND_ALERT_CENTS).`,
      metadata: { spentCents, thresholdCents, requestCount: request_count },
      source: 'cron/spend-check',
      autoResolveKey: DAILY_ALERT_KEY,
    });
    return { status: 'alerting', spentCents, thresholdCents, requestCount: request_count };
  }

  await AlertService.autoResolve(DAILY_ALERT_KEY);
  return { status: 'ok', spentCents, thresholdCents, requestCount: request_count };
}
