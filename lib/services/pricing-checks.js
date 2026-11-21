/** Pure pricing/model comparisons shared by scheduled alerts and manual Admin checks. No I/O. */
import { classifyRegistryCoverage } from './model-resolver';
import { MODEL_CAPABILITIES, LAST_CAPABILITY_REVIEWED_AT } from './model-capabilities';
import { MODEL_PRICING, lookupPricing, CACHE_MULTIPLIERS } from '../utils/model-pricing';
export { classifyRegistryCoverage };
const DRIFT_THRESHOLD_PCT = 0.05;
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
