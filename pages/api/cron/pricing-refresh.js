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
import { lookupPricing, CACHE_MULTIPLIERS } from '../../../lib/utils/model-pricing';
import { getCostReport, getMessagesUsageReport, isAdminKeyConfigured } from '../../../lib/services/anthropic-admin';

const DRIFT_THRESHOLD_PCT = 0.05;  // 5%
const ALERT_KEY = 'pricing:drift';

// Keep cache lifetimes separate in the provider report; app usage logging
// aggregates cache writes and cannot serve as the cost report's denominator.
const TOKEN_TYPE_MAP = {
  uncached_input_tokens: { dimension: 'input', multiplier: 1, path: ['uncached_input_tokens'] },
  output_tokens: { dimension: 'output', multiplier: 1, path: ['output_tokens'] },
  cache_read_input_tokens: { dimension: 'input', multiplier: CACHE_MULTIPLIERS.read, path: ['cache_read_input_tokens'] },
  'cache_creation.ephemeral_5m_input_tokens': { dimension: 'input', multiplier: CACHE_MULTIPLIERS.write5m, path: ['cache_creation', 'ephemeral_5m_input_tokens'] },
  'cache_creation.ephemeral_1h_input_tokens': { dimension: 'input', multiplier: CACHE_MULTIPLIERS.write1h, path: ['cache_creation', 'ephemeral_1h_input_tokens'] },
};

// A cohort includes its day and every billing dimension exposed by both APIs.
// Null is the provider's default-workspace value, not a wildcard.
function cohortKey(bucket, row) {
  return JSON.stringify([bucket.starting_at, bucket.ending_at, row.model,
    row.service_tier, row.context_window, row.inference_geo, row.workspace_id ?? null]);
}

export function buildPricingAuditRows(costBuckets, usageBuckets) {
  const usage = new Map();
  for (const bucket of usageBuckets) {
    for (const row of bucket.results || []) {
      const key = cohortKey(bucket, row);
      const prior = usage.get(key) || {};
      for (const [tokenType, map] of Object.entries(TOKEN_TYPE_MAP)) {
        const count = map.path.reduce((value, field) => value?.[field], row);
        if (!Number.isSafeInteger(count) || count < 0) {
          prior[tokenType] = NaN;
        } else {
          prior[tokenType] = (prior[tokenType] ?? 0) + count;
        }
      }
      usage.set(key, prior);
    }
  }

  const totals = new Map();
  let skippedCount = 0;
  // Combine costs inside a cohort before using its denominator once.
  const costs = new Map();
  for (const bucket of costBuckets) {
    for (const row of bucket.results || []) {
      if (row.cost_type !== 'tokens') continue;
      const tokenType = row.token_type;
      const costCents = Number(row.amount);
      // Baseline prices do not describe batch/flex, regional premiums, or fast
      // mode. Preserve a standing alert if any billable row is uncomparable.
      if (!row.model || !TOKEN_TYPE_MAP[tokenType] || row.currency !== 'USD'
          || row.amount == null || row.amount === '' || !Number.isFinite(costCents) || costCents < 0
          || row.service_tier !== 'standard'
          || !['global', 'not_available'].includes(row.inference_geo)
          || row.context_window !== '0-200k'
          || (row.speed && row.speed !== 'standard') || /fast/i.test(row.description || '')) {
        skippedCount++;
        continue;
      }
      const key = JSON.stringify([cohortKey(bucket, row), tokenType]);
      const prior = costs.get(key) || { cohort: cohortKey(bucket, row), model: row.model, tokenType, costCents: 0 };
      prior.costCents += costCents;
      costs.set(key, prior);
    }
  }
  for (const row of costs.values()) {
    const tokenCount = usage.get(row.cohort)?.[row.tokenType];
    if (!Number.isSafeInteger(tokenCount) || tokenCount <= 0) {
      if (row.costCents > 0) skippedCount++;
      continue;
    }
    const key = JSON.stringify([row.model, row.tokenType]);
    const prior = totals.get(key) || { model: row.model, providerTokenType: row.tokenType, anthropicCostCents: 0, tokenCount: 0 };
    prior.anthropicCostCents += row.costCents;
    prior.tokenCount += tokenCount;
    totals.set(key, prior);
  }
  const auditRows = [...totals.values()].map(row => {
    const map = TOKEN_TYPE_MAP[row.providerTokenType];
    const pricing = lookupPricing(row.model);
    const multiplier = row.providerTokenType === 'cache_read_input_tokens'
      ? pricing?.cacheReadMultiplier ?? map.multiplier : map.multiplier;
    const localCentsPerMtok = pricing ? pricing[map.dimension] * multiplier : null;
    const derivedCentsPerMtok = row.anthropicCostCents * 1_000_000 / row.tokenCount;
    const deltaPct = localCentsPerMtok > 0 ? (derivedCentsPerMtok - localCentsPerMtok) / localCentsPerMtok : null;
    return { ...row, tokenType: mapToOurTokenType(row.providerTokenType),
      localCentsPerMtok, derivedCentsPerMtok, deltaPct,
      flagged: localCentsPerMtok == null || Math.abs(deltaPct) > DRIFT_THRESHOLD_PCT };
  });
  return { auditRows, skippedCount };
}

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

// Normalize Anthropic's verbose token_type strings to the shorter form we
// store in model_pricing_audit (stays compact + readable).
function mapToOurTokenType(t) {
  if (t === 'uncached_input_tokens') return 'input';
  if (t === 'output_tokens') return 'output';
  if (t === 'cache_read_input_tokens') return 'cache_read';
  if (t === 'cache_creation.ephemeral_5m_input_tokens') return 'cache_write_5m';
  if (t === 'cache_creation.ephemeral_1h_input_tokens') return 'cache_write_1h';
  return t;
}
