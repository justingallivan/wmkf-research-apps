/**
 * API Route: /api/admin/models
 *
 * Admin endpoint for managing per-app Claude model overrides.
 * Protected: superuser role required (or auth bypassed in dev mode).
 *
 * GET  — Returns apps with effective model config, available models from Anthropic API
 * PUT  — Set or clear a model override for an app
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { clearModelOverridesCache } from '../../../lib/services/model-override-loader';
import { listSettings, setSetting, deleteSetting } from '../../../lib/services/settings-service';
import {
  loadAvailableModels,
  getCachedAvailableModels,
  clearAvailableModelsCache,
  getTierCatalog,
  isTier,
  resolveModel,
} from '../../../lib/services/model-resolver';
import { validateReviewedClaudeModelValue } from '../../../lib/services/model-review-validation';
import { lookupModelCapabilities } from '../../../lib/services/model-capabilities';
import { lookupPricing, LAST_REVIEWED_AT } from '../../../lib/utils/model-pricing';

// Valid model types that can be overridden
const VALID_MODEL_TYPES = ['model', 'visionModel', 'fallback'];

async function fetchAvailableModels({ force = false } = {}) {
  if (force) clearAvailableModelsCache();
  await loadAvailableModels({ force });
  return getCachedAvailableModels()
    .slice()
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .map(m => ({
      id: m.id,
      display_name: m.display_name || m.id,
      created_at: m.created_at,
    }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'PUT') {
    return handlePut(req, res, gate.profileId);
  }
}

async function handleGet(req, res) {
  try {
    // ?refresh=1 forces a re-fetch of /v1/models, bypassing the 24h cache.
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    // Fetch DB overrides, available models, and env overrides in parallel
    const [dbSettings, availableModels] = await Promise.all([
      listSettings('model_override:'),
      fetchAvailableModels({ force }),
    ]);

    // Build a map of DB overrides: { "concept-evaluator:model": "claude-..." }
    const dbOverrides = {};
    for (const [key, value] of Object.entries(dbSettings)) {
      const suffix = key.replace('model_override:', '');
      dbOverrides[suffix] = value;
    }

    const statusIds = new Set();

    // Build apps array from APP_MODELS config
    const apps = Object.entries(BASE_CONFIG.APP_MODELS).map(([appKey, config]) => {
      const result = { appKey, models: {} };

      for (const modelType of VALID_MODEL_TYPES) {
        const hardcoded = config[modelType] || null;
        const envKey = `CLAUDE_MODEL_${appKey.toUpperCase().replace(/-/g, '_')}`;
        const envOverride = modelType === 'model' ? (process.env[envKey] || null) : null;
        const dbOverride = dbOverrides[`${appKey}:${modelType}`] || null;

        // Determine effective stored value and its source
        let storedValue, source;
        if (dbOverride) {
          storedValue = dbOverride;
          source = 'db';
        } else if (envOverride) {
          storedValue = envOverride;
          source = 'env';
        } else if (hardcoded) {
          storedValue = hardcoded;
          source = 'hardcoded';
        } else {
          storedValue = BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
          source = 'default';
        }

        // storedValue may be a tier key or a concrete id; resolve to the
        // concrete id that callers will actually send to Anthropic.
        const resolvedId = resolveModel(storedValue) || storedValue;
        if (resolvedId) statusIds.add(resolvedId);

        result.models[modelType] = {
          effective: resolvedId,           // back-compat: the concrete id
          stored: storedValue,             // tier OR concrete id
          isTier: isTier(storedValue),
          registryStatus: buildModelRegistryStatus(resolvedId),
          source,
          dbOverride,
          envOverride,
          hardcoded,
        };
      }

      return result;
    });

    for (const model of availableModels) {
      if (model.id) statusIds.add(model.id);
    }
    const tiers = getTierCatalog();
    for (const tier of tiers) {
      if (tier.resolvedId) statusIds.add(tier.resolvedId);
      if (tier.fallbackId) statusIds.add(tier.fallbackId);
    }
    const defaultModelResolved = resolveModel(BASE_CONFIG.CLAUDE.DEFAULT_MODEL) || BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
    if (defaultModelResolved) statusIds.add(defaultModelResolved);

    const modelStatuses = {};
    for (const modelId of statusIds) {
      modelStatuses[modelId] = buildModelRegistryStatus(modelId);
    }

    return res.json({
      apps,
      availableModels,
      tiers,
      defaultModel: BASE_CONFIG.CLAUDE.DEFAULT_MODEL,
      defaultModelResolved,
      modelStatuses,
    });
  } catch (error) {
    console.error('Admin models GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch model configuration' });
  }
}

export function buildModelRegistryStatus(modelId) {
  const capabilities = lookupModelCapabilities(modelId);
  const pricing = lookupPricing(modelId);
  return {
    modelId,
    ok: Boolean(capabilities && pricing),
    capability: capabilities ? {
      status: 'reviewed',
      family: capabilities.family || null,
      reviewedAt: capabilities.reviewedAt || null,
      supportsTemperature: capabilities.supportsTemperature === true,
      supportsEffort: capabilities.supportsEffort === true,
      supportsStructuredOutput: capabilities.supportsStructuredOutput === true,
      maxOutputTokens: capabilities.maxOutputTokens ?? null,
      thinkingMode: capabilities.thinkingMode || null,
      defaultEffort: capabilities.defaultEffort || null,
      refusalSemantics: capabilities.refusalSemantics || null,
      dataRetentionClass: capabilities.dataRetentionClass || null,
      source: capabilities.source || null,
    } : {
      status: 'missing',
    },
    pricing: pricing ? {
      status: 'reviewed',
      inputCentsPerMTok: pricing.input,
      outputCentsPerMTok: pricing.output,
      lastReviewedAt: LAST_REVIEWED_AT,
    } : {
      status: 'missing',
      lastReviewedAt: LAST_REVIEWED_AT,
    },
  };
}

async function handlePut(req, res, profileId) {
  try {
    const { appKey, modelType, modelId } = req.body;

    // Validate appKey
    if (!BASE_CONFIG.APP_MODELS[appKey]) {
      return res.status(400).json({ error: `Invalid app key: ${appKey}` });
    }

    // Validate modelType
    if (!VALID_MODEL_TYPES.includes(modelType)) {
      return res.status(400).json({ error: `Invalid model type: ${modelType}. Must be one of: ${VALID_MODEL_TYPES.join(', ')}` });
    }

    const settingKey = `model_override:${appKey}:${modelType}`;
    // requireSuperuser returns profileId=null in dev (AUTH_REQUIRED=false) — keep
    // it null so the FK to user_profiles isn't violated.
    const updatedBy = profileId;
    let savedModelId = null;

    if (modelId === null || modelId === undefined || modelId === '') {
      // Delete the override — revert to env/hardcoded default
      await deleteSetting(settingKey);
    } else {
      // Stored value may be a tier key (opus/sonnet/haiku) or a reviewed
      // concrete Anthropic id. Future model ids must first be added to the
      // capability + pricing registries so request shaping and cost logging
      // cannot drift silently.
      const validation = validateReviewedClaudeModelValue(modelId);
      if (!validation.valid) {
        return res.status(400).json({
          error: validation.error,
          code: validation.code,
        });
      }
      await setSetting(settingKey, validation.value, updatedBy);
      savedModelId = validation.value;
    }

    // Clear the in-memory cache so the next API request picks up the change
    clearModelOverridesCache();

    return res.json({ success: true, settingKey, modelId: savedModelId });
  } catch (error) {
    console.error('Admin models PUT error:', error);
    return res.status(500).json({ error: 'Failed to update model override' });
  }
}
