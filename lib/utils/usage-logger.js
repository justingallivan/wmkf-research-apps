/**
 * Usage Logger — tracks per-user LLM API usage for billing and analytics.
 *
 * Logs are fire-and-forget (non-blocking) to avoid impacting response latency.
 * Cost estimates come from `lib/utils/model-pricing.js` (the one place where
 * rates are maintained). When `estimateCostCents` returns null, the row still
 * lands in `api_usage_log` with `estimated_cost_cents = NULL` — the pricing
 * canary cron picks those up.
 */

import { sql } from '@vercel/postgres';
import { estimateCostCents } from './model-pricing.js';

export { estimateCostCents };

/**
 * Log a single LLM API usage event. Fire-and-forget.
 *
 * @param {Object} params
 * @param {number|null} params.userProfileId  FK to user_profiles
 * @param {string} params.appName              e.g. 'batch-phase-ii'
 * @param {string} params.model                e.g. 'claude-sonnet-4-6-20260201'
 * @param {number} params.inputTokens
 * @param {number} params.outputTokens
 * @param {number} [params.cacheCreationTokens]   5-minute cache writes
 * @param {number} [params.cacheReadTokens]
 * @param {number} [params.cacheCreationTokens1h] 1-hour cache writes (rare)
 * @param {number} params.latencyMs
 * @param {string} params.status               'success' | 'error' | 'rate_limited'
 * @param {string} params.errorMessage
 * @param {string|null} params.stopReason       Provider completion stop reason
 * @param {string|null} params.requestId        Explorer request correlation
 * @param {number|null} params.requestRound     One-based Explorer model round
 */
export function logUsage({
  userProfileId,
  appName,
  model,
  inputTokens,
  outputTokens,
  cacheCreationTokens,
  cacheReadTokens,
  cacheCreationTokens1h,
  latencyMs,
  status,
  errorMessage,
  stopReason,
  requestId,
  requestRound,
}) {
  const cost = estimateCostCents(
    model,
    inputTokens || 0,
    outputTokens || 0,
    cacheCreationTokens || 0,
    cacheReadTokens || 0,
    cacheCreationTokens1h || 0,
  );

  const correlatedWrite = sql`INSERT INTO api_usage_log
      (user_profile_id, app_name, model, input_tokens, output_tokens,
       cache_creation_tokens, cache_read_tokens, estimated_cost_cents,
       latency_ms, request_status, error_message, stop_reason,
       request_id, request_round)
      VALUES (${userProfileId || null}, ${appName}, ${model || null},
              ${inputTokens || 0}, ${outputTokens || 0},
              ${cacheCreationTokens || 0}, ${cacheReadTokens || 0},
              ${cost}, ${latencyMs || null},
              ${status || 'success'}, ${errorMessage || null}, ${stopReason || null},
              ${requestId || null}, ${Number.isInteger(requestRound) ? requestRound : null})`;

  correlatedWrite.catch(err => {
    if (err?.code !== '42703') {
      console.warn('Usage log failed:', err.message);
      return;
    }
    // Additive migration compatibility: preserve usage logging if a newly
    // deployed function runs before request_id/request_round exist.
    sql`INSERT INTO api_usage_log
        (user_profile_id, app_name, model, input_tokens, output_tokens,
         cache_creation_tokens, cache_read_tokens, estimated_cost_cents,
         latency_ms, request_status, error_message, stop_reason)
        VALUES (${userProfileId || null}, ${appName}, ${model || null},
                ${inputTokens || 0}, ${outputTokens || 0},
                ${cacheCreationTokens || 0}, ${cacheReadTokens || 0},
                ${cost}, ${latencyMs || null},
                ${status || 'success'}, ${errorMessage || null}, ${stopReason || null})`
      .catch(fallbackError => console.warn('Usage log failed:', fallbackError.message));
  });
}
