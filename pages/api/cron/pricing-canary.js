/**
 * Cron: /api/cron/pricing-canary
 *
 * Weekly check for unpriced models. Scans the last 7 days of `api_usage_log`
 * for distinct model ids that don't resolve via `lib/utils/model-pricing.js`
 * — either because the model is brand new or the table has a gap. Creates an
 * `ops` alert listing each unknown id with its request count.
 *
 * Complements the in-process `console.warn` from `model-pricing.js` (which is
 * great for dev but invisible in production). This cron is the durable
 * surface — an unpriced model id silently producing NULL cost rows is the
 * exact failure we want noisy.
 *
 * Also fires a `warning` alert when `LAST_REVIEWED_AT` is more than 60 days
 * old, prompting a manual pricing audit. The monthly drift cron is a
 * stronger signal, but the age check is a no-auth-required safety net.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses).
 */

import { sql } from '@vercel/postgres';
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import NotificationService from '../../../lib/services/notification-service';
import AlertService from '../../../lib/services/alert-service';
import { lookupPricing, LAST_REVIEWED_AT } from '../../../lib/utils/model-pricing';

const STALE_DAYS = 60;
const ALERT_KEY_UNKNOWN = 'pricing:unknown-models';
const ALERT_KEY_STALE   = 'pricing:table-stale';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  try {
    const unknown = await checkUnknownModels();
    const stale = await checkTableAge();
    return res.json({ ok: true, unknown, stale });
  } catch (error) {
    console.error('pricing-canary cron error:', error);
    return res.status(500).json({ error: 'pricing-canary failed', message: error.message });
  }
}

async function checkUnknownModels() {
  // Distinct models in the last 7 days that produced NULL cost OR whose
  // current lookup returns null. Two-pronged because we want to catch both
  // "logged-with-null-cost-historically" and "the model entry was deleted
  // post-hoc" — though the latter is unlikely.
  const result = await sql`
    SELECT model, COUNT(*)::int AS req_count
    FROM api_usage_log
    WHERE created_at >= NOW() - INTERVAL '7 days'
      AND model IS NOT NULL
    GROUP BY model
    ORDER BY req_count DESC
  `;

  const unknown = [];
  for (const row of result.rows) {
    if (!lookupPricing(row.model)) {
      unknown.push({ model: row.model, requestCount: row.req_count });
    }
  }

  if (unknown.length === 0) {
    // S181 round-2 (Codex MOD C): real auto-resolve. The previous code
    // called notify(severity:'info', autoResolveKey:...) on the all-clear
    // path — but notify() only inserts/dedupes, never resolves. Use
    // AlertService.autoResolve() directly so a standing warning from a
    // prior week actually clears when the gap is filled.
    const resolved = await AlertService.autoResolve(ALERT_KEY_UNKNOWN);
    return { status: 'ok', unknownCount: 0, resolved };
  }

  const summary = unknown
    .map((u) => `${u.model} (${u.requestCount} req)`)
    .join('; ');

  await NotificationService.notify({
    type: 'pricing_unknown_models',
    severity: 'warning',
    title: `Pricing canary: ${unknown.length} unpriced model id(s)`,
    message:
      `These model ids appeared in api_usage_log over the last 7 days but ` +
      `don't match any entry in lib/utils/model-pricing.js, so their rows ` +
      `have estimated_cost_cents = NULL. Add entries and bump ` +
      `LAST_REVIEWED_AT.\n\n${summary}`,
    metadata: { unknown },
    source: 'cron/pricing-canary',
    autoResolveKey: ALERT_KEY_UNKNOWN,
    category: 'ops',
  });

  return { status: 'alerting', unknownCount: unknown.length, unknown };
}

async function checkTableAge() {
  const reviewedAt = new Date(LAST_REVIEWED_AT + 'T00:00:00Z');
  const ageDays = Math.floor((Date.now() - reviewedAt.getTime()) / (24 * 60 * 60 * 1000));

  if (ageDays <= STALE_DAYS) {
    const resolved = await AlertService.autoResolve(ALERT_KEY_STALE);
    return { status: 'ok', ageDays, resolved };
  }

  await NotificationService.notify({
    type: 'pricing_table_stale',
    severity: 'warning',
    title: `Pricing table not reviewed in ${ageDays} days`,
    message:
      `lib/utils/model-pricing.js LAST_REVIEWED_AT = ${LAST_REVIEWED_AT}. ` +
      `Threshold is ${STALE_DAYS} days. Compare local prices against ` +
      `https://claude.com/pricing and bump LAST_REVIEWED_AT after review.`,
    metadata: { reviewedAt: LAST_REVIEWED_AT, ageDays, threshold: STALE_DAYS },
    source: 'cron/pricing-canary',
    autoResolveKey: ALERT_KEY_STALE,
    category: 'ops',
  });

  return { status: 'alerting', ageDays };
}
