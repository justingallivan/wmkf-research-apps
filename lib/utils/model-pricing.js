/**
 * Per-million-token pricing for every LLM provider we use.
 *
 * Source of truth = Anthropic's pricing page + each provider's pricing docs.
 * This file is the ONLY place to change rates. `lastReviewedAt` is updated
 * whenever the table is touched; the monthly drift cron
 * (`/api/cron/pricing-refresh`) compares each entry against the authoritative
 * `/cost_report` and alerts when delta exceeds 5%.
 *
 * Numbers below are in CENTS PER MILLION TOKENS. Cache pricing follows
 * Anthropic's documented multipliers (read = 0.1× input, 5m write = 1.25× input,
 * 1h write = 2× input).
 *
 * Matching strategy:
 *   1. Exact id match against the keys below.
 *   2. Longest-prefix match (keys sorted desc by length, first whose value the
 *      model id startsWith() wins). This is deterministic, unlike the previous
 *      `.includes()` approach which silently misrouted `claude-opus-4-6` to
 *      `claude-opus-4` (3× overestimate).
 *
 * When adding a new model entry:
 *   - Use the most specific prefix that's stable across dated revisions, e.g.
 *     `claude-opus-4-7` so both `claude-opus-4-7-20260601` and future dated
 *     releases match. Do NOT add the dated suffix.
 *   - Bump `LAST_REVIEWED_AT` to today.
 */

// ISO date of the most recent manual review against authoritative pricing.
// The S181 ratchet: monthly drift cron will flag rows >35d old; we treat
// >60d as a stale-table alert worth a manual check.
export const LAST_REVIEWED_AT = '2026-06-25';

// Pricing per million tokens (cents). Input/output only — cache pricing
// derives via the multipliers below.
export const MODEL_PRICING = {
  // ─── Anthropic ───
  // Fable/Mythos 5 tier: $10 input / $50 output
  'claude-fable-5':    { input: 1000, output: 5000 },
  'claude-mythos-5':   { input: 1000, output: 5000 },
  // Opus 4.5+ tier: $5 input / $25 output
  'claude-opus-4-8':   { input: 500,  output: 2500 },
  'claude-opus-4-7':   { input: 500,  output: 2500 },
  'claude-opus-4-6':   { input: 500,  output: 2500 },
  'claude-opus-4-5':   { input: 500,  output: 2500 },
  // Opus 4 / 4.1 tier: $15 input / $75 output (Opus 4 deprecated)
  'claude-opus-4-1':   { input: 1500, output: 7500 },
  'claude-opus-4':     { input: 1500, output: 7500 },
  // Sonnet 4.0+ tier: $3 input / $15 output (all unified pricing)
  'claude-sonnet-4-6': { input: 300,  output: 1500 },
  'claude-sonnet-4-5': { input: 300,  output: 1500 },
  'claude-sonnet-4':   { input: 300,  output: 1500 },
  // Haiku 4.5: $1 / $5 (S181 fix — table previously had $0.80/$4 = Haiku 3.5)
  'claude-haiku-4-5':  { input: 100,  output: 500  },
  // Haiku 3.5 (retired except on Bedrock/Vertex): $0.80 / $4
  'claude-haiku-3-5':  { input: 80,   output: 400  },
  'claude-3-5-haiku':  { input: 80,   output: 400  },
  // Haiku 3 legacy: $0.25 / $1.25
  'claude-3-haiku':    { input: 25,   output: 125  },

  // ─── OpenAI ───
  'gpt-4o-mini':       { input: 15,   output: 60   },
  'gpt-4o':            { input: 250,  output: 1000 },
  'o3-mini':           { input: 110,  output: 440  },
  'o1':                { input: 1500, output: 6000 },

  // ─── Google ───
  'gemini-2.5-flash':  { input: 15,   output: 60   },
  'gemini-2.5-pro':    { input: 125,  output: 1000 },
  'gemini-2.0-flash':  { input: 10,   output: 40   },

  // ─── Perplexity ───
  'sonar-pro':         { input: 300,  output: 1500 },
  'sonar':             { input: 100,  output: 100  },
};

// Cache multipliers applied against the matched model's `input` price.
// Anthropic-specific; OpenAI/Gemini/Perplexity callers pass 0 cache tokens.
export const CACHE_MULTIPLIERS = {
  read:        0.1,   // cache hit
  write5m:     1.25,  // 5-minute ephemeral
  write1h:     2.0,   // 1-hour ephemeral (S181 — was unrepresented; we likely
                      // don't use 1h caching but the constant is here so a
                      // future caller passing cacheCreationTokens1h is priced
                      // correctly)
};

// Sorted list of [key, pricing] pairs, longest key first. Computed once at
// module load so the matcher is O(K) per call where K = entries (~18).
const SORTED_ENTRIES = Object.entries(MODEL_PRICING).sort(
  (a, b) => b[0].length - a[0].length,
);

// Unknown-model warning dedup. A new model id seen for the first time logs
// once, then is suppressed for the rest of the process lifetime. Cleared by
// process restart; in serverless that's frequent enough.
const _warnedUnknown = new Set();

/**
 * Resolve a model id to its pricing entry, or null if unknown.
 * Exported separately so callers (and the canary cron) can probe without
 * computing a cost.
 */
export function lookupPricing(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  // Exact match first — cheapest and most specific.
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];
  // Longest-prefix match with a delimiter check. The sort guarantees
  // `claude-opus-4-7` is tried before `claude-opus-4`, but we ALSO require
  // the character after the matched prefix to be `-` (or end-of-string)
  // so that hypothetical future ids like `claude-opus-4-10` don't
  // silently match `claude-opus-4-1`, and `gpt-4o-miniature` doesn't
  // swallow `gpt-4o-mini`. S181 round-2 (Codex MOD A).
  for (const [key, pricing] of SORTED_ENTRIES) {
    if (!modelId.startsWith(key)) continue;
    const next = modelId[key.length];
    if (next === undefined || next === '-') return pricing;
  }
  return null;
}

/**
 * One-time-per-process warning when a model id can't be priced. The canary
 * cron is the durable surface; this is the immediate dev-loop signal.
 */
function warnUnknownOnce(modelId) {
  if (_warnedUnknown.has(modelId)) return;
  _warnedUnknown.add(modelId);
  console.warn(
    `[model-pricing] Unknown model "${modelId}" — cost will not be logged. ` +
    `Add an entry to lib/utils/model-pricing.js (bump LAST_REVIEWED_AT).`,
  );
}

/**
 * Compute the estimated cost in cents for a usage record. Returns null when
 * the model can't be priced (logs a one-time warning).
 *
 * @param {string} model
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {number} [cacheCreationTokens] — 5m cache writes (default if caller
 *   doesn't distinguish). For 1h cache writes, pass `cacheCreationTokens1h`.
 * @param {number} [cacheReadTokens]
 * @param {number} [cacheCreationTokens1h]
 */
export function estimateCostCents(
  model,
  inputTokens,
  outputTokens,
  cacheCreationTokens = 0,
  cacheReadTokens = 0,
  cacheCreationTokens1h = 0,
) {
  const pricing = lookupPricing(model);
  if (!pricing) {
    warnUnknownOnce(model || '(empty)');
    return null;
  }
  const regularInput = (inputTokens || 0) * pricing.input;
  const cacheWrite5m = (cacheCreationTokens || 0) * pricing.input * CACHE_MULTIPLIERS.write5m;
  const cacheWrite1h = (cacheCreationTokens1h || 0) * pricing.input * CACHE_MULTIPLIERS.write1h;
  const cacheRead    = (cacheReadTokens || 0) * pricing.input * CACHE_MULTIPLIERS.read;
  const output       = (outputTokens || 0) * pricing.output;
  return (regularInput + cacheWrite5m + cacheWrite1h + cacheRead + output) / 1_000_000;
}

/**
 * Reset the unknown-model warning cache. Test-only.
 */
export function _resetUnknownWarnings() {
  _warnedUnknown.clear();
}
