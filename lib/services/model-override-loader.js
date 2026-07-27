/**
 * Server-only loader for model-override settings.
 *
 * Extracted from shared/config/baseConfig.js so that client-adjacent pages
 * (e.g. pages/reviewer-finder.js) that import BASE_CONFIG don't transitively
 * pull the settings-service → dataverse chain into the browser bundle.
 *
 * API route pattern stays unchanged: call loadModelOverrides() near the top
 * of the handler. This populates the cache in baseConfig.js (via setCache)
 * so the existing synchronous getModelForApp/getFallbackModelForApp still
 * works from anywhere.
 */

const { listSettings } = require('./settings-service');
const {
  _setOverridesCache,
  _shouldReloadOverrides,
  _setModelResolver,
  clearModelOverridesCache,
} = require('../../shared/config/baseConfig');
const {
  loadAvailableModels,
  resolveModel,
  clearAvailableModelsCache,
} = require('./model-resolver');

// Inject the resolver into baseConfig once at module load so server-side
// getModelForApp() resolves tier keys without baseConfig needing to import
// fetch / /v1/models machinery (which would leak into browser bundles).
_setModelResolver(resolveModel);

async function loadModelOverrides() {
  // Always poke loadAvailableModels — it has its own 24h TTL and short-
  // circuits if already warm, but if the models cache was cleared (e.g.
  // by an admin save) we need to refill it even when the override cache
  // is still fresh.
  const modelsPromise = loadAvailableModels();

  if (!_shouldReloadOverrides()) {
    await modelsPromise;
    return;
  }
  const [overridesResult] = await Promise.allSettled([
    listSettings('model_override:'),
    modelsPromise,
  ]);
  if (overridesResult.status !== 'fulfilled') {
    console.error('loadModelOverrides: failed to load overrides:', overridesResult.reason?.message);
    return;
  }
  try {
    const map = new Map();
    for (const [key, value] of Object.entries(overridesResult.value)) {
      const suffix = key.replace('model_override:', '');
      map.set(suffix, value);
    }
    _setOverridesCache(map);
  } catch (err) {
    console.error('loadModelOverrides: failed to load overrides:', err.message);
  }
}

module.exports = {
  loadModelOverrides,
  clearModelOverridesCache,
  clearAvailableModelsCache,
};
