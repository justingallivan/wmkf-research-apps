#!/usr/bin/env node

/**
 * Read-only, aggregate-only analysis of dynamics_query_log for the Dynamics
 * Explorer behavior campaign (S449).
 *
 * Reports volume, outcome, validator/restriction, latency, and per-session
 * tool-call distributions without emitting user identifiers, row ids, free-
 * text feedback, or environment values. query_params are only used inside
 * aggregate/dedup expressions; denial reasons are truncated and top-N only.
 *
 * Era note: record_count semantics changed on 2026-08-08 (PR #117). Rows
 * before that carry broken counts (string lengths, false zeros). All
 * record_count-based outcome buckets are therefore reported for the POST era
 * only; volume/session metrics are reported per era.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const contents = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const { sql } = await import('@vercel/postgres');

// PR #117 merged 2026-08-08 ~06:45 PT (~13:45 UTC). Treat Aug 8 UTC as a
// transition day excluded from era comparisons.
const PRE_END = '2026-08-08T00:00:00Z';
const POST_START = '2026-08-09T00:00:00Z';

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function rows(result) {
  console.table(result.rows);
}

section('0. Denominators and date range');
rows(await sql`
  SELECT
    COUNT(*)::int AS total_rows,
    COUNT(DISTINCT session_id)::int AS total_sessions,
    MIN(created_at)::date AS first_row,
    MAX(created_at) AS last_row,
    COUNT(*) FILTER (WHERE created_at < ${PRE_END})::int AS pre_era_rows,
    COUNT(*) FILTER (WHERE created_at >= ${PRE_END} AND created_at < ${POST_START})::int AS transition_day_rows,
    COUNT(*) FILTER (WHERE created_at >= ${POST_START})::int AS post_era_rows
  FROM dynamics_query_log
`);

section('1. Daily volume, last 45 days (rows, sessions, denials, validator rejects)');
rows(await sql`
  SELECT
    created_at::date AS day,
    COUNT(*)::int AS calls,
    COUNT(DISTINCT session_id)::int AS sessions,
    COUNT(*) FILTER (WHERE was_denied)::int AS restriction_denials,
    COUNT(*) FILTER (WHERE denial_reason LIKE 'ODATA_VALIDATOR_REJECT:%')::int AS validator_rejects
  FROM dynamics_query_log
  WHERE created_at >= NOW() - INTERVAL '45 days'
  GROUP BY 1 ORDER BY 1
`);

section('2. POST era: outcome by query_type (error=-1, zero, positive)');
rows(await sql`
  SELECT
    query_type,
    COUNT(*)::int AS calls,
    COUNT(*) FILTER (WHERE record_count = -1)::int AS errors,
    COUNT(*) FILTER (WHERE record_count = 0)::int AS zero_results,
    COUNT(*) FILTER (WHERE record_count > 0)::int AS positive,
    COUNT(*) FILTER (WHERE denial_reason LIKE 'ODATA_VALIDATOR_REJECT:%')::int AS validator_rejects,
    ROUND(AVG(execution_time_ms))::int AS avg_ms,
    PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY execution_time_ms)::int AS p90_ms
  FROM dynamics_query_log
  WHERE created_at >= ${POST_START} AND NOT was_denied
  GROUP BY 1 ORDER BY calls DESC
`);

section('3. POST era: top tables by calls and error share');
rows(await sql`
  SELECT
    COALESCE(table_name, '(none)') AS table_name,
    COUNT(*)::int AS calls,
    COUNT(*) FILTER (WHERE record_count = -1)::int AS errors,
    COUNT(*) FILTER (WHERE denial_reason LIKE 'ODATA_VALIDATOR_REJECT:%')::int AS validator_rejects
  FROM dynamics_query_log
  WHERE created_at >= ${POST_START} AND NOT was_denied
  GROUP BY 1 ORDER BY calls DESC LIMIT 15
`);

section('4. Per-session tool-call distribution by era (round-exhaustion proxy)');
rows(await sql`
  WITH per_session AS (
    SELECT
      session_id,
      CASE WHEN MIN(created_at) < ${PRE_END} THEN 'pre' ELSE 'post' END AS era,
      COUNT(*)::int AS calls
    FROM dynamics_query_log
    WHERE session_id IS NOT NULL
      AND (created_at < ${PRE_END} OR created_at >= ${POST_START})
    GROUP BY 1
  )
  SELECT
    era,
    COUNT(*)::int AS sessions,
    PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY calls)::int AS p50_calls,
    PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY calls)::int AS p90_calls,
    MAX(calls)::int AS max_calls,
    COUNT(*) FILTER (WHERE calls >= 15)::int AS sessions_ge_15_calls,
    COUNT(*) FILTER (WHERE calls >= 10)::int AS sessions_ge_10_calls
  FROM per_session
  GROUP BY 1 ORDER BY 1 DESC
`);

section('5. POST era: retry churn — identical (type, params) repeated within a session');
rows(await sql`
  WITH dupes AS (
    SELECT session_id, query_type, query_params::text AS params, COUNT(*)::int AS repeats
    FROM dynamics_query_log
    WHERE created_at >= ${POST_START} AND session_id IS NOT NULL AND NOT was_denied
    GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
  )
  SELECT
    query_type,
    COUNT(*)::int AS distinct_repeated_calls,
    SUM(repeats)::int AS total_calls_in_repeats,
    COUNT(DISTINCT session_id)::int AS sessions_affected
  FROM dupes
  GROUP BY 1 ORDER BY total_calls_in_repeats DESC
`);

section('6. Validator reject reasons, top 12 (truncated to 110 chars), by era');
rows(await sql`
  SELECT
    CASE WHEN created_at < ${PRE_END} THEN 'pre' ELSE 'post' END AS era,
    LEFT(REPLACE(denial_reason, 'ODATA_VALIDATOR_REJECT: ', ''), 110) AS reason,
    COUNT(*)::int AS n
  FROM dynamics_query_log
  WHERE denial_reason LIKE 'ODATA_VALIDATOR_REJECT:%'
    AND (created_at < ${PRE_END} OR created_at >= ${POST_START})
  GROUP BY 1, 2 ORDER BY n DESC LIMIT 12
`);

section('7. Restriction denials by era and query_type');
rows(await sql`
  SELECT
    CASE WHEN created_at < ${PRE_END} THEN 'pre' ELSE 'post' END AS era,
    query_type,
    COUNT(*)::int AS denials
  FROM dynamics_query_log
  WHERE was_denied
    AND (created_at < ${PRE_END} OR created_at >= ${POST_START})
  GROUP BY 1, 2 ORDER BY denials DESC LIMIT 12
`);

section('8. POST era: sessions with >=1 error — do they recover? (calls after first error)');
rows(await sql`
  WITH first_err AS (
    SELECT session_id, MIN(created_at) AS first_error_at
    FROM dynamics_query_log
    WHERE created_at >= ${POST_START} AND record_count = -1 AND session_id IS NOT NULL
    GROUP BY 1
  )
  SELECT
    COUNT(*)::int AS sessions_with_error,
    COUNT(*) FILTER (WHERE later.positive_after > 0)::int AS recovered_with_positive_result,
    ROUND(AVG(later.calls_after), 1) AS avg_calls_after_first_error
  FROM first_err fe
  JOIN LATERAL (
    SELECT
      COUNT(*)::int AS calls_after,
      COUNT(*) FILTER (WHERE q.record_count > 0)::int AS positive_after
    FROM dynamics_query_log q
    WHERE q.session_id = fe.session_id AND q.created_at > fe.first_error_at
  ) later ON true
`);

const lifecycleShape = await sql`
  SELECT to_regclass('public.dynamics_explorer_requests') IS NOT NULL AS available
`;

if (lifecycleShape.rows[0]?.available) {
  section('9. Phase B request outcomes by month (stale running derived as abandoned)');
  rows(await sql`
    WITH classified AS (
      SELECT
        DATE_TRUNC('month', started_at)::date AS month,
        CASE
          WHEN outcome = 'running' AND started_at < NOW() - INTERVAL '10 minutes'
            THEN 'abandoned'
          ELSE outcome
        END AS effective_outcome,
        rounds_used
      FROM dynamics_explorer_requests
    )
    SELECT
      month,
      effective_outcome,
      COUNT(*)::int AS requests,
      ROUND(AVG(rounds_used), 1) AS avg_rounds,
      PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY rounds_used)::int AS p90_rounds
    FROM classified
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  section('10. Phase B request correlation completeness, last 45 days');
  rows(await sql`
    SELECT
      COUNT(*)::int AS requests,
      COUNT(*) FILTER (WHERE r.outcome <> 'running')::int AS terminal_requests,
      COUNT(*) FILTER (
        WHERE r.outcome = 'running' AND r.started_at < NOW() - INTERVAL '10 minutes'
      )::int AS derived_abandoned,
      COUNT(*) FILTER (WHERE q.rows > 0)::int AS requests_with_query_rows,
      COUNT(*) FILTER (WHERE u.rows > 0)::int AS requests_with_usage_rows,
      COUNT(*) FILTER (WHERE f.rows > 0)::int AS requests_with_feedback,
      COALESCE(SUM(q.rows), 0)::int AS correlated_query_rows,
      COALESCE(SUM(u.rows), 0)::int AS correlated_usage_rows,
      COALESCE(SUM(f.rows), 0)::int AS correlated_feedback_rows
    FROM dynamics_explorer_requests r
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS rows
      FROM dynamics_query_log ql
      WHERE ql.request_id = r.request_id
    ) q ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS rows
      FROM api_usage_log ul
      WHERE ul.request_id = r.request_id
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS rows
      FROM dynamics_feedback df
      WHERE df.request_id = r.request_id
    ) f ON true
    WHERE r.started_at >= NOW() - INTERVAL '45 days'
  `);
} else {
  section('9-10. Phase B request telemetry');
  console.log('Migration 033 is not applied; request-level analysis is unavailable.');
}

console.log('\nDone. All figures aggregate-only; no identifiers or row-level data emitted.');
process.exit(0);
