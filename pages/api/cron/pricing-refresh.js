/**
 * Cron: /api/cron/pricing-refresh
 *
 * Monthly drift check against the authoritative Anthropic cost report.
 * Pulls the last 30 days from `/v1/organizations/cost_report` grouped by
 * description and workspace, joins the provider Messages usage report for
 * the same daily billing dimensions, divides cost by those provider tokens,
 * and compares to `lib/utils/model-pricing.js`.
 *
 * Writes one row per (model, token_type) probed to `model_pricing_audit` for
 * history. Fires an `ops` alert when any row deviates by more than 5% OR a
 * model in the cost report has no local pricing entry.
 *
 * Storage choice (S181 decision): pricing source of truth stays in code
 * (`lib/utils/model-pricing.js`). This cron alerts; humans edit the file.
 * Refusing the temptation to auto-update means a billing-system glitch can't
 * silently corrupt prices.
 *
 * Skipped (200 with status='skipped') when ANTHROPIC_ADMIN_API_KEY is not
 * set, so dev/preview without the admin key don't fail.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses).
 */

import { sql } from '@vercel/postgres';
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import NotificationService from '../../../lib/services/notification-service';
import AlertService from '../../../lib/services/alert-service';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { buildPricingAuditRows } from '../../../lib/services/pricing-checks';
import { getCostReport, getMessagesUsageReport, isAdminKeyConfigured } from '../../../lib/services/anthropic-admin';

const DRIFT_THRESHOLD_PCT = 0.05;
const ALERT_KEY = 'pricing:drift';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  // Maintenance run AFTER auth guards. Sibling cron pricing-canary uses the
  // same pattern. B4-F2 audit hardening: before this, pricing-refresh wrote
  // NOTHING to maintenance_runs, so an empty model_pricing_audit table was
  // ambiguous between "no drift detected" and "cron never fired."
  const runId = await MaintenanceService.startRun('pricing-refresh');

  if (!isAdminKeyConfigured()) {
    console.log('[pricing-refresh] skipped — ANTHROPIC_ADMIN_API_KEY not set');
    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: 0,
      details: { skipped: true, reason: 'admin_key_missing' },
    });
    return res.json({ ok: true, status: 'skipped', reason: 'admin_key_missing' });
  }

  try {
    const result = await refresh();
    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: result.auditRowCount ?? 0,
      details: result,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('pricing-refresh cron error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'pricing-refresh failed', message: 'Internal error' });
  }
}

async function refresh() {
  // 30-day window, snapped to day boundaries.
  const now = new Date();
  const endingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startingAt = new Date(endingAt.getTime() - 30 * 24 * 60 * 60 * 1000);

  const window = { startingAt: startingAt.toISOString(), endingAt: endingAt.toISOString() };
  const [costBuckets, usageBuckets] = await Promise.all([
    getCostReport({ ...window, groupBy: ['description', 'workspace_id'] }),
    getMessagesUsageReport(window),
  ]);
  const { auditRows, skippedCount } = buildPricingAuditRows(costBuckets, usageBuckets);
  const flagged = auditRows.filter(row => row.flagged);
  const runDate = new Date().toISOString().slice(0, 10);

  // Persist matched provider comparisons; a failed insert prevents alert resolution.
  for (const row of auditRows) {
    await sql`
      INSERT INTO model_pricing_audit
        (run_date, model, token_type, period_start, period_end,
         anthropic_cost_cents, token_count,
         derived_cents_per_mtok, local_cents_per_mtok, delta_pct, flagged)
      VALUES
        (${runDate}, ${row.model}, ${row.tokenType},
         ${startingAt.toISOString()}, ${endingAt.toISOString()},
         ${row.anthropicCostCents}, ${row.tokenCount},
         ${row.derivedCentsPerMtok}, ${row.localCentsPerMtok},
         ${row.deltaPct}, ${row.flagged})
    `;
  }

  // Alert (or auto-resolve) based on flagged count.
  if (flagged.length === 0 && (skippedCount > 0 || auditRows.length === 0)) {
    return { status: 'incomplete', auditRowCount: auditRows.length, skippedCount, flaggedCount: 0 };
  }
  if (flagged.length === 0) {
    // S181 round-2 (Codex MOD C): use AlertService.autoResolve directly,
    // not notify() with severity:'info' + autoResolveKey — the latter
    // inserts/dedupes but never clears a prior warning.
    const resolved = await AlertService.autoResolve(ALERT_KEY);
    return { status: 'ok', auditRowCount: auditRows.length, flaggedCount: 0, resolved };
  }

  const summary = flagged
    .map((f) => {
      if (f.localCentsPerMtok == null) {
        return `${f.model}/${f.tokenType}: UNPRICED LOCALLY — derived ${(f.derivedCentsPerMtok / 100).toFixed(4)} $/MTok`;
      }
      const pct = (f.deltaPct * 100).toFixed(1);
      return `${f.model}/${f.tokenType}: local ${(f.localCentsPerMtok / 100).toFixed(4)} $/MTok vs derived ${(f.derivedCentsPerMtok / 100).toFixed(4)} $/MTok (${pct >= 0 ? '+' : ''}${pct}%)`;
    })
    .join('\n');

  await NotificationService.notify({
    type: 'pricing_drift',
    severity: 'warning',
    title: `Pricing drift: ${flagged.length} row(s) exceed ${(DRIFT_THRESHOLD_PCT * 100).toFixed(0)}% tolerance`,
    message:
      `lib/utils/model-pricing.js disagrees with Anthropic's authoritative ` +
      `cost_report and matching provider usage over the last 30 days. ` +
      `Investigate billing modifiers and review the table before changing rates:\n\n${summary}`,
    metadata: { flagged, skippedCount, tokenSource: 'anthropic_usage_report' },
    source: 'cron/pricing-refresh',
    autoResolveKey: ALERT_KEY,
    category: 'ops',
  });

  return { status: 'alerting', auditRowCount: auditRows.length, skippedCount, flaggedCount: flagged.length, flagged };
}

export { buildPricingAuditRows };
