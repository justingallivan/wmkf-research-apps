/**
 * Base configuration for all document processing apps
 * Can be extended by individual apps
 */

export const BASE_CONFIG = {
  // Claude API Configuration
  // Tier-keyed (opus/sonnet/haiku) — resolved to a concrete id at call time
  // via lib/services/model-resolver.js. Concrete ids are still accepted as
  // an escape hatch (env vars, Dataverse wmkf_appsystemsettings overrides,
  // prompt rows).
  CLAUDE: {
    API_URL: process.env.CLAUDE_API_URL || 'https://api.anthropic.com/v1/messages',
    ANTHROPIC_VERSION: '2023-06-01',
    DEFAULT_MODEL: process.env.CLAUDE_MODEL || 'sonnet',
    FALLBACK_MODEL: 'haiku'
  },

  // Per-App Model Configuration
  // Values are tier keys (opus / sonnet / haiku). Resolver picks the latest
  // concrete id in that family at call time; admin overrides and env vars
  // can also pin a specific concrete id.
  APP_MODELS: {
    // 'concept-evaluator' deprecated 2026-04-25 (archived to /_archived).
    'multi-perspective-evaluator': { model: 'sonnet', visionModel: 'sonnet', fallback: 'haiku' },
    'literature-analyzer':         { model: 'sonnet', visionModel: 'sonnet', fallback: 'haiku' },
    'batch-phase-i':               { model: 'sonnet', fallback: 'haiku' },
    'batch-phase-ii':              { model: 'sonnet', fallback: 'haiku' },
    'phase-i-writeup':             { model: 'sonnet', fallback: 'haiku' },
    'phase-ii-writeup':            { model: 'sonnet', fallback: 'haiku' },
    // Workbench reviewer-finding services still resolve this model namespace.
    // Opus (S286): Sonnet 4.6 fell into a token-repetition/hallucination loop on
    // niche/out-of-mainstream proposals (padding a fixed reviewer quota past its
    // confident set); Opus 4.8 handled the same proposals cleanly and added real
    // independent names. Pin the concrete id to avoid tier drift past the
    // temperature-gate's known Opus id. Fallback is Sonnet (haiku can't do
    // origination).
    'reviewer-finder':             { model: 'claude-opus-4-8', fallback: 'sonnet' },
    // Excluded-reviewer NAME PARSING only (reviewer-exclusion-parser) — a cheap,
    // deterministic JSON extraction kept off the pricey origination model. Split
    // from `reviewer-finder` in S286 when that key moved to Opus (which also
    // deprecates the temperature:0 this parser relies on for determinism).
    'reviewer-exclusion':          { model: 'haiku',  fallback: 'haiku' },
    'reviewers':                   { model: 'sonnet', fallback: 'haiku' },
    'peer-review-summarizer':      { model: 'sonnet', fallback: 'haiku' },
    'funding-analysis':            { model: 'sonnet', fallback: 'haiku' },
    'qa':                          { model: 'sonnet', fallback: 'haiku' },
    'refine':                      { model: 'sonnet', fallback: 'haiku' },
    'expense-reporter':            { model: 'haiku',  fallback: 'haiku' },
    'contact-enrichment':          { model: 'haiku',  fallback: 'haiku' },
    'email-personalization':       { model: 'haiku',  fallback: 'haiku' },
    'dynamics-explorer':           { model: 'haiku',  fallback: 'haiku' },
    'expertise-finder':            { model: 'sonnet', fallback: 'haiku' },
    'virtual-review-panel':        { model: 'sonnet', fallback: 'haiku' },
    'grant-reporting':             { model: 'sonnet', fallback: 'haiku' }
  },

  // Model Parameters
  MODEL_PARAMS: {
    DEFAULT_MAX_TOKENS: 16384,
    EXTENDED_MAX_TOKENS: 4000,
    MIN_MAX_TOKENS: 500,
    DEFAULT_TEMPERATURE: 0.3,
    STRUCTURED_DATA_TEMPERATURE: 0.1,
    CREATIVE_TEMPERATURE: 0.7,
    // Legacy config compatibility (from lib/config.js)
    REFINEMENT_MAX_TOKENS: 2500,
    QA_MAX_TOKENS: 1500,
    SUMMARIZATION_TEMPERATURE: 0.3,
    REFINEMENT_TEMPERATURE: 0.3,
    QA_TEMPERATURE: 0.4
  },

  // File Processing
  FILE_PROCESSING: {
    PDF_SIZE_LIMIT: 50 * 1024 * 1024, // 50MB
    TEXT_SIZE_LIMIT: 10 * 1024 * 1024, // 10MB
    MIN_TEXT_LENGTH: 100, // minimum characters
    MAX_TEXT_LENGTH: 1000000, // maximum characters for processing
    TEXT_TRUNCATE_LIMIT: 15000, // characters for API calls
    CHUNK_SIZE: 10000, // for splitting large texts
    CHUNK_OVERLAP: 500, // overlap between chunks
    SUPPORTED_FORMATS: ['pdf', 'txt', 'md'],
    // Legacy config compatibility (from lib/config.js)
    QA_TEXT_TRUNCATE_LIMIT: 10000, // characters for structured data extraction
    FUNDING_EXTRACTION_LIMIT: 6000 // characters for PI/institution/keyword extraction
  },

  // API Rate Limiting
  RATE_LIMITS: {
    REQUESTS_PER_MINUTE: 60,
    REQUESTS_PER_HOUR: 1000,
    CONCURRENT_REQUESTS: 5
  },

  // Caching
  CACHE: {
    ENABLED: process.env.ENABLE_CACHE !== 'false',
    TTL: 3600, // 1 hour in seconds
    MAX_SIZE: 100 // maximum cached items
  },

  // Security
  SECURITY: {
    REQUIRE_API_KEY: true,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
    MAX_REQUEST_SIZE: '100mb',
    SANITIZE_INPUT: true
  },

  // Logging
  LOGGING: {
    LEVEL: process.env.LOG_LEVEL || 'info',
    ENABLED: process.env.ENABLE_LOGGING !== 'false',
    INCLUDE_TIMESTAMPS: true
  },

  // Export Options
  EXPORT: {
    FORMATS: ['markdown', 'json', 'html', 'pdf'],
    DEFAULT_FORMAT: 'markdown',
    INCLUDE_METADATA: true
  },

  // Error Messages
  ERROR_MESSAGES: {
    NO_API_KEY: 'API key is required',
    INVALID_FILE: 'Invalid file format or corrupted file',
    FILE_TOO_LARGE: 'File exceeds maximum size limit',
    PROCESSING_FAILED: 'Failed to process document',
    AI_SERVICE_ERROR: 'AI service temporarily unavailable',
    RATE_LIMIT_EXCEEDED: 'Rate limit exceeded, please try again later',
    INVALID_REQUEST: 'Invalid request format',
    DATABASE_ERROR: 'A database error occurred',
    UPLOAD_FAILED: 'Failed to upload file',
    SCREENING_FAILED: 'Screening operation failed',
    EMAIL_GENERATION_FAILED: 'Failed to generate email',
    QUERY_FAILED: 'Query failed',
    INTERNAL_ERROR: 'An internal error occurred'
  },

  // Success Messages
  SUCCESS_MESSAGES: {
    PROCESSING_COMPLETE: 'Document processed successfully',
    EXPORT_COMPLETE: 'Export completed successfully',
    UPLOAD_COMPLETE: 'File uploaded successfully'
  }
};

/**
 * Get environment-specific configuration
 * @returns {Object} - Environment configuration
 */
export function getEnvironmentConfig() {
  const env = process.env.NODE_ENV || 'development';
  
  const envConfigs = {
    development: {
      DEBUG: true,
      VERBOSE_ERRORS: true,
      MOCK_MODE: process.env.MOCK_MODE === 'true'
    },
    production: {
      DEBUG: false,
      VERBOSE_ERRORS: false,
      MOCK_MODE: false
    },
    test: {
      DEBUG: true,
      VERBOSE_ERRORS: true,
      MOCK_MODE: true
    }
  };

  return envConfigs[env] || envConfigs.development;
}

/**
 * Merge configurations
 * @param {Object} baseConfig - Base configuration
 * @param {Object} appConfig - App-specific configuration
 * @returns {Object} - Merged configuration
 */
export function mergeConfig(baseConfig, appConfig) {
  return {
    ...baseConfig,
    ...appConfig,
    CLAUDE: { ...baseConfig.CLAUDE, ...(appConfig.CLAUDE || {}) },
    MODEL_PARAMS: { ...baseConfig.MODEL_PARAMS, ...(appConfig.MODEL_PARAMS || {}) },
    FILE_PROCESSING: { ...baseConfig.FILE_PROCESSING, ...(appConfig.FILE_PROCESSING || {}) }
  };
}

/**
 * Validate configuration
 * @param {Object} config - Configuration to validate
 * @throws {Error} - If configuration is invalid
 */
export function validateConfig(config) {
  if (!config.CLAUDE.API_URL) {
    throw new Error('Claude API URL is required');
  }

  if (config.FILE_PROCESSING.PDF_SIZE_LIMIT < 1024 * 1024) {
    throw new Error('PDF size limit must be at least 1MB');
  }

  if (config.MODEL_PARAMS.DEFAULT_TEMPERATURE < 0 || config.MODEL_PARAMS.DEFAULT_TEMPERATURE > 1) {
    throw new Error('Temperature must be between 0 and 1');
  }
}

// --- DB model override cache ---
// Pre-loaded by loadModelOverrides() so getModelForApp() stays synchronous
let _dbOverrides = new Map();
let _dbOverridesLoadedAt = 0;
const DB_OVERRIDES_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Pre-load model overrides from Dataverse `wmkf_appsystemsettings` into memory.
 * Call once near the top of each API handler (after auth, before getModelForApp).
 * No-ops if cache is still fresh.
 */
/**
 * Internal cache primitives used by lib/services/model-override-loader.js.
 * The loader lives in a server-only module to keep the settings-service →
 * Dataverse chain out of client bundles that import BASE_CONFIG constants.
 *
 * Application code should still call loadModelOverrides() from the server-
 * only module; the read getters here remain synchronous and read from this
 * cache.
 */
export function _shouldReloadOverrides() {
  return Date.now() - _dbOverridesLoadedAt >= DB_OVERRIDES_TTL_MS;
}
export function _setOverridesCache(map) {
  _dbOverrides = map;
  _dbOverridesLoadedAt = Date.now();
}

/**
 * Clear the in-memory model overrides cache.
 * Call after admin writes to `wmkf_appsystemsettings` so the next request re-fetches.
 */
export function clearModelOverridesCache() {
  _dbOverrides = new Map();
  _dbOverridesLoadedAt = 0;
}

// Tier resolution is injected by the server-only model-resolver loader so
// that browser bundles (which import BASE_CONFIG) don't pull in fetch /
// /v1/models machinery. Defaults to identity until injected — concrete ids
// already pass through unchanged, so this only matters once tiers are
// configured server-side.
let _resolveModel = (v) => v;
export function _setModelResolver(fn) {
  if (typeof fn === 'function') _resolveModel = fn;
}

// Local tier-key set used only for the drift warning below. Kept inline
// (not imported from model-resolver) so client bundles that import
// BASE_CONFIG don't transitively pull /v1/models machinery.
const _TIER_KEYS_FOR_DRIFT_WARN = new Set(['opus', 'sonnet', 'haiku']);
const _warnedAppKeys = new Set();
function _warnUnresolvedTier(appKey, type, value) {
  // Server-only: window check avoids noisy logs in any code path that
  // somehow runs the getter in a browser bundle.
  if (typeof window !== 'undefined') return;
  const sig = `${appKey}:${type}`;
  if (_warnedAppKeys.has(sig)) return;
  _warnedAppKeys.add(sig);
  console.warn(
    `[baseConfig] getModelForApp('${appKey}', '${type}') returning unresolved tier key '${value}'. ` +
    `The handler likely forgot to import lib/services/model-override-loader and call loadModelOverrides(). ` +
    `Anthropic will 404 on this id.`,
  );
}

/**
 * Get the appropriate Claude model for a specific app, resolved to a
 * concrete Anthropic model id.
 *
 * Resolution order:
 *   1. DB override (Dataverse `wmkf_appsystemsettings` key `model_override:{appKey}:{type}`)
 *   2. Env var CLAUDE_MODEL_{APP_KEY_UPPER}
 *   3. APP_MODELS[appKey][type]
 *   4. BASE_CONFIG.CLAUDE.DEFAULT_MODEL
 *
 * Each source may hold a tier key (opus/sonnet/haiku) or a concrete id;
 * the resolver returns the latest concrete id for the tier, and passes
 * concrete ids through unchanged (escape hatch).
 *
 * @param {string} appKey - The app identifier
 * @param {string} type - The model type: 'model', 'visionModel', or 'fallback'
 * @returns {string} - The concrete Anthropic model identifier
 */
export function getModelForApp(appKey, type = 'model') {
  const raw = _getModelForAppRaw(appKey, type);
  const resolved = _resolveModel(raw) || raw;
  if (typeof resolved === 'string' && _TIER_KEYS_FOR_DRIFT_WARN.has(resolved.toLowerCase())) {
    _warnUnresolvedTier(appKey, type, resolved);
  }
  return resolved;
}

/**
 * Like getModelForApp but returns the unresolved stored value (tier or id).
 * Used by the admin API to surface what's stored vs. what's resolved.
 */
export function _getModelForAppRaw(appKey, type = 'model') {
  // 1. Check DB override (loaded by loadModelOverrides)
  const dbOverride = _dbOverrides.get(`${appKey}:${type}`);
  if (dbOverride) {
    return dbOverride;
  }

  // 2. Allow environment variable override for specific apps
  // e.g., CLAUDE_MODEL_EXPERTISE_FINDER=opus  (or a concrete id)
  const envKey = `CLAUDE_MODEL_${appKey.toUpperCase().replace(/-/g, '_')}`;
  const envOverride = process.env[envKey];
  if (envOverride) {
    return envOverride;
  }

  // 3. Get from APP_MODELS configuration
  const appConfig = BASE_CONFIG.APP_MODELS[appKey];
  if (appConfig) {
    // Return requested type, falling back to model, then to default
    return appConfig[type] || appConfig.model || BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
  }

  // 4. Fall back to global default
  return BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
}

/**
 * Get the fallback model for a specific app
 * @param {string} appKey - The app identifier
 * @returns {string} - The fallback model identifier
 */
export function getFallbackModelForApp(appKey) {
  return getModelForApp(appKey, 'fallback');
}

export default BASE_CONFIG;
