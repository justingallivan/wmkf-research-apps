/**
 * Model tier resolver.
 *
 * Maps abstract tiers (opus/sonnet/haiku) to the latest concrete Anthropic
 * model id in that family, by querying the live /v1/models list. Concrete
 * ids pass through unchanged so callers can pin specific snapshots.
 *
 * Failure modes:
 *  - If /v1/models is unreachable or stale, fall back to TIER_FALLBACK_IDS
 *    below (hand-maintained, update when Anthropic ships a new generation).
 *  - If the resolved id is itself retired, the Claude call will 404 loudly.
 *    This is the intended failure mode — silent fallback to a different
 *    model would mask a retirement event.
 *  - Unknown tier strings resolve to null; the caller is expected to error.
 */

// Tier vocabulary. Stored values are lowercase canonical keys; the dropdown
// label combines Anthropic-native + tier ("Sonnet (medium)") per the
// admin-UX decision in Session 145.
const TIERS = {
  opus: { family: 'opus', anthropic: 'Opus', tier: 'high', order: 0 },
  sonnet: { family: 'sonnet', anthropic: 'Sonnet', tier: 'medium', order: 1 },
  haiku: { family: 'haiku', anthropic: 'Haiku', tier: 'low', order: 2 },
};

// Hand-maintained latest-known-id per tier. Used when the live API call
// has not yet populated the cache (cold start, /v1/models down, missing
// CLAUDE_API_KEY). Keep current with Anthropic's published latest.
const TIER_FALLBACK_IDS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

let _availableModels = null;
let _loadedAt = 0;
// 24h — Anthropic ships new models weekly-to-monthly, not hourly. Vercel
// cold starts refresh on their own anyway; the admin picker has a Refresh
// button for explicit pulls when a new model lands mid-day.
const TTL_MS = 24 * 60 * 60 * 1000;

async function loadAvailableModels({ force = false } = {}) {
  if (!force && _availableModels && Date.now() - _loadedAt < TTL_MS) {
    return _availableModels;
  }
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return _availableModels || [];
  try {
    const resp = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (!resp.ok) {
      console.error('[model-resolver] /v1/models failed:', resp.status);
      return _availableModels || [];
    }
    const data = await resp.json();
    _availableModels = (data.data || []).filter(m => m.id && m.id.startsWith('claude-'));
    _loadedAt = Date.now();
    return _availableModels;
  } catch (err) {
    console.error('[model-resolver] /v1/models error:', err.message);
    return _availableModels || [];
  }
}

function getCachedAvailableModels() {
  return _availableModels || [];
}

function clearAvailableModelsCache() {
  _availableModels = null;
  _loadedAt = 0;
}

function isTier(value) {
  if (!value || typeof value !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(TIERS, value.toLowerCase());
}

/**
 * Resolve a tier key to the latest concrete model id in that family.
 * Sync — reads only from the pre-loaded cache (or the static fallback table).
 * Callers that need a fresh list must await loadAvailableModels() first.
 */
function resolveTierSync(tier) {
  const key = String(tier).toLowerCase();
  if (!TIERS[key]) return null;
  const family = TIERS[key].family;

  if (_availableModels && _availableModels.length > 0) {
    const candidates = _availableModels
      .filter(m => m.id.toLowerCase().includes(`-${family}-`))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (candidates.length > 0) return candidates[0].id;
  }
  return TIER_FALLBACK_IDS[key] || null;
}

/**
 * Resolve a stored value (tier OR concrete id) to a concrete model id.
 * Tier strings pass through resolveTierSync. Anything else is treated as a
 * concrete id and returned unchanged (the escape hatch).
 */
function resolveModel(value) {
  if (!value) return null;
  if (isTier(value)) return resolveTierSync(value);
  return value;
}

/**
 * Build the tier catalog for the admin picker. Returns each tier with its
 * currently-resolved concrete id so the UI can display "Sonnet (medium) —
 * claude-sonnet-4-6" without each consumer recomputing.
 */
function getTierCatalog() {
  return Object.entries(TIERS).map(([key, meta]) => ({
    key,
    family: meta.family,
    anthropic: meta.anthropic,
    tier: meta.tier,
    order: meta.order,
    resolvedId: resolveTierSync(key),
    fallbackId: TIER_FALLBACK_IDS[key] || null,
    usingFallback: !(_availableModels && _availableModels.length > 0),
  })).sort((a, b) => a.order - b.order);
}

module.exports = {
  TIERS,
  TIER_FALLBACK_IDS,
  loadAvailableModels,
  getCachedAvailableModels,
  clearAvailableModelsCache,
  isTier,
  resolveTierSync,
  resolveModel,
  getTierCatalog,
};
