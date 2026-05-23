/**
 * Cron: /api/cron/spend-check
 *
 * Hourly check for AI spend thresholds. Two independent checks:
 *
 * 1. Daily threshold — today's total spend (all providers, all apps) vs.
 *    DAILY_SPEND_ALERT_CENTS. Creates a `system_alerts` row (dashboard tile)
 *    when exceeded. Auto-resolves the next hour when back under.
 *
 * 2. Low balance — Option B path from project_api_credit_monitoring.md:
 *    sums api_usage_log.estimated_cost_cents since ANTHROPIC_BALANCE_ANCHOR_DATE,
 *    subtracts from ANTHROPIC_BALANCE_ANCHOR_CENTS to estimate remaining credit.
 *    When remaining < LOW_BALANCE_ALERT_CENTS, creates an alert AND emails via
 *    DynamicsService.createAndSendEmail (working since Session 77). Skipped
 *    entirely if anchor env vars aren't set.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses).
 */

import { sql } from '@vercel/postgres';
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import AlertService from '../../../lib/services/alert-service';
import NotificationService from '../../../lib/services/notification-service';

const DAILY_THRESHOLD_DEFAULT_CENTS = 1000;    // $10
const LOW_BALANCE_DEFAULT_CENTS = 500;         // $5

const DAILY_ALERT_KEY = 'spend:daily-threshold';
const LOW_BALANCE_ALERT_KEY = 'spend:low-balance';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  try {
    const results = {};

    results.dailyThreshold = await checkDailyThreshold();
    results.lowBalance = await checkLowBalance();

    return res.json({ ok: true, ...results });
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

async function checkLowBalance() {
  const anchorCents = Number(process.env.ANTHROPIC_BALANCE_ANCHOR_CENTS);
  const anchorDate = process.env.ANTHROPIC_BALANCE_ANCHOR_DATE;
  const lowThresholdCents = Number(process.env.LOW_BALANCE_ALERT_CENTS) || LOW_BALANCE_DEFAULT_CENTS;

  if (!anchorCents || !anchorDate) {
    return { status: 'not_configured' };
  }

  const result = await sql`
    SELECT COALESCE(SUM(estimated_cost_cents), 0)::numeric AS spent_cents
    FROM api_usage_log
    WHERE created_at >= ${anchorDate}::timestamptz
  `;
  const spentSinceAnchor = Number(result.rows[0].spent_cents);
  const remainingCents = anchorCents - spentSinceAnchor;

  if (remainingCents >= lowThresholdCents) {
    await AlertService.autoResolve(LOW_BALANCE_ALERT_KEY);
    return { status: 'ok', anchorCents, spentSinceAnchor, remainingCents };
  }

  // notify() handles both the system_alerts row and the email send (via the
  // unified template). It dedupes via autoResolveKey, returning null when an
  // active alert with the same key already exists — same idempotency contract
  // as the prior `createAlert + if (alert) email` pair.
  const alert = await NotificationService.notify({
    type: 'spend_low_balance',
    severity: 'error',
    title: `Estimated AI credit balance below $${(lowThresholdCents / 100).toFixed(2)}`,
    message:
      `Anchor: $${(anchorCents / 100).toFixed(2)} on ${anchorDate}. ` +
      `Spent since anchor: $${(spentSinceAnchor / 100).toFixed(2)}. ` +
      `Estimated remaining: $${(remainingCents / 100).toFixed(2)}. ` +
      `This is our own usage-log estimate, not authoritative Anthropic billing. ` +
      `Top up the Anthropic console and update ANTHROPIC_BALANCE_ANCHOR_CENTS ` +
      `and ANTHROPIC_BALANCE_ANCHOR_DATE to the new values.`,
    metadata: { anchorCents, anchorDate, spentSinceAnchor, remainingCents, lowThresholdCents },
    source: 'cron/spend-check',
    autoResolveKey: LOW_BALANCE_ALERT_KEY,
    category: 'spend',
  });

  return {
    status: alert ? 'alerting-new' : 'alerting-existing',
    anchorCents,
    spentSinceAnchor,
    remainingCents,
  };
}
