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
 * Also compares Anthropic's live `/v1/models` list against the reviewed local
 * capability/pricing registries. Newer same-family model ids are advisory only:
 * alert humans to review capability + pricing entries, never auto-advance
 * fallbacks or persisted model settings.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses).
 */

import { sql } from '@vercel/postgres';
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import NotificationService from '../../../lib/services/notification-service';
import AlertService from '../../../lib/services/alert-service';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { MODEL_CAPABILITIES, LAST_CAPABILITY_REVIEWED_AT } from '../../../lib/services/model-capabilities';
import { lookupPricing, MODEL_PRICING, LAST_REVIEWED_AT } from '../../../lib/utils/model-pricing';

const STALE_DAYS = 60;
const ALERT_KEY_UNKNOWN = 'pricing:unknown-models';
const ALERT_KEY_STALE   = 'pricing:table-stale';
const ALERT_KEY_MODEL_DISCOVERY = 'model-registry:live-unreviewed-models';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';
const ANTHROPIC_VERSION = '2023-06-01';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  // Maintenance run AFTER auth guards (Codex pass-4 §5 + pass-5 Q4).
  const runId = await MaintenanceService.startRun('pricing-canary');

  try {
    const unknown = await checkUnknownModels();
    const stale = await checkTableAge();
    const modelDiscovery = await checkLiveModelRegistry();
    const anyAlerting = unknown.status === 'alerting' || stale.status === 'alerting' || modelDiscovery.status === 'alerting';
    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: unknown.totalChecked ?? 0,
      details: { unknown, stale, modelDiscovery, anyAlerting },
    });
    return res.json({ ok: true, unknown, stale, modelDiscovery });
  } catch (error) {
    console.error('pricing-canary cron error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'pricing-canary failed', message: 'Internal error' });
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
    return { status: 'ok', totalChecked: result.rows.length, unknownCount: 0, resolved };
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

  return { status: 'alerting', totalChecked: result.rows.length, unknownCount: unknown.length, unknown };
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

async function checkLiveModelRegistry() {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { status: 'skipped', reason: 'CLAUDE_API_KEY not set' };
  }

  let models;
  try {
    const response = await fetch(ANTHROPIC_MODELS_URL, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    });
    if (!response.ok) {
      return { status: 'unavailable', httpStatus: response.status };
    }
    const data = await response.json();
    models = Array.isArray(data?.data) ? data.data : [];
  } catch (error) {
    return { status: 'unavailable', error: error.message };
  }

  const unreviewed = findUnreviewedLiveClaudeModels(models, {
    reviewedAt: LAST_CAPABILITY_REVIEWED_AT,
  });

  if (unreviewed.length === 0) {
    const resolved = await AlertService.autoResolve(ALERT_KEY_MODEL_DISCOVERY);
    return {
      status: 'ok',
      reviewedAt: LAST_CAPABILITY_REVIEWED_AT,
      totalChecked: models.length,
      unreviewedCount: 0,
      resolved,
    };
  }

  const summary = unreviewed
    .map((m) => `${m.id} (${m.createdAt || 'unknown created_at'}, capability=${m.capabilityCoverage.status}, pricing=${m.pricingCoverage.status})`)
    .join('; ');

  await NotificationService.notify({
    type: 'model_registry_unreviewed_live_models',
    severity: 'warning',
    title: `Model canary: ${unreviewed.length} newer Claude model id(s) need review`,
    message:
      `Anthropic's /v1/models list contains Claude model ids newer than ` +
      `lib/services/model-capabilities.js LAST_CAPABILITY_REVIEWED_AT = ${LAST_CAPABILITY_REVIEWED_AT}, ` +
      `but they are not specifically covered by both the capability and pricing registries. ` +
      `Review request-shaping behavior, refusal semantics, retention class, and pricing before ` +
      `using any of these ids or advancing a tier fallback.\n\n${summary}`,
    metadata: { reviewedAt: LAST_CAPABILITY_REVIEWED_AT, unreviewed },
    source: 'cron/pricing-canary',
    autoResolveKey: ALERT_KEY_MODEL_DISCOVERY,
    category: 'ops',
  });

  return {
    status: 'alerting',
    reviewedAt: LAST_CAPABILITY_REVIEWED_AT,
    totalChecked: models.length,
    unreviewedCount: unreviewed.length,
    unreviewed,
  };
}

export function findUnreviewedLiveClaudeModels(models, { reviewedAt = LAST_CAPABILITY_REVIEWED_AT } = {}) {
  return (models || [])
    .filter((model) => model?.id && String(model.id).startsWith('claude-'))
    .filter((model) => isCreatedAfterReview(model.created_at, reviewedAt))
    .map((model) => {
      const id = String(model.id);
      const capabilityCoverage = classifyRegistryCoverage(id, MODEL_CAPABILITIES);
      const pricingCoverage = classifyRegistryCoverage(id, MODEL_PRICING);
      return {
        id,
        displayName: model.display_name || null,
        createdAt: model.created_at || null,
        family: inferClaudeFamily(id),
        capabilityCoverage,
        pricingCoverage,
      };
    })
    .filter((model) => !isCoverageReviewed(model.capabilityCoverage) || !isCoverageReviewed(model.pricingCoverage));
}

export function classifyRegistryCoverage(modelId, registry) {
  const keys = Object.keys(registry || {}).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (modelId !== key && !modelId.startsWith(`${key}-`)) continue;
    const suffix = modelId.slice(key.length);
    if (!suffix) return { status: 'reviewed_exact', matchedKey: key };
    if (/^-\d{8}$/.test(suffix)) return { status: 'reviewed_dated', matchedKey: key };
    return { status: 'ancestor_match', matchedKey: key, suffix };
  }
  return { status: 'missing', matchedKey: null };
}

function isCoverageReviewed(coverage) {
  return coverage.status === 'reviewed_exact' || coverage.status === 'reviewed_dated';
}

function isCreatedAfterReview(createdAt, reviewedAt) {
  if (!createdAt || !reviewedAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return created.toISOString().slice(0, 10) > reviewedAt;
}

function inferClaudeFamily(modelId) {
  for (const family of ['opus', 'sonnet', 'haiku', 'fable', 'mythos']) {
    if (modelId.includes(`-${family}-`)) return family;
  }
  return 'unknown';
}
