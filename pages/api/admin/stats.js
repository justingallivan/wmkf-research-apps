/**
 * API Route: /api/admin/stats
 *
 * Returns aggregated API usage statistics for the admin dashboard.
 * Protected: superuser role required (or auth bypassed in dev mode).
 *
 * Query params:
 *   period  - '1d' | '7d' | '30d' | '90d' (default '30d')
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const period = req.query.period || '30d';
  const days =
    period === '1d' ? 1 :
    period === '7d' ? 7 :
    period === '90d' ? 90 :
    30;

  try {
    const [summary, byUser, byApp, byDay, today, reviewPanel] = await Promise.all([
      getSummary(days),
      getByUser(days),
      getByApp(days),
      getByDay(days),
      getToday(),
      getReviewPanel(days),
    ]);

    return res.json({ period, days, summary, byUser, byApp, byDay, today, reviewPanel });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch usage stats' });
  }
}

async function getSummary(days) {
  const result = await sql`
    SELECT
      COUNT(*)::int AS total_requests,
      COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
      COALESCE(SUM(estimated_cost_cents), 0)::numeric AS total_cost_cents,
      COUNT(DISTINCT user_profile_id)::int AS unique_users,
      COUNT(*) FILTER (WHERE request_status = 'error')::int AS error_count,
      COALESCE(SUM(cache_creation_tokens), 0)::bigint AS total_cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0)::bigint AS total_cache_read_tokens
    FROM api_usage_log
    WHERE created_at >= NOW() - MAKE_INTERVAL(days => ${days})
  `;
  return result.rows[0];
}

async function getByUser(days) {
  const result = await sql`
    SELECT
      u.user_profile_id,
      CASE
        WHEN u.user_profile_id IS NULL THEN 'Backend'
        ELSE COALESCE(p.name, p.azure_email, 'Unknown')
      END AS user_name,
      COUNT(*)::int AS request_count,
      COALESCE(SUM(u.input_tokens), 0)::bigint AS total_input_tokens,
      COALESCE(SUM(u.output_tokens), 0)::bigint AS total_output_tokens,
      COALESCE(SUM(u.estimated_cost_cents), 0)::numeric AS total_cost_cents,
      COUNT(*) FILTER (WHERE u.request_status = 'error')::int AS error_count
    FROM api_usage_log u
    LEFT JOIN user_profiles p ON u.user_profile_id = p.id
    WHERE u.created_at >= NOW() - MAKE_INTERVAL(days => ${days})
    GROUP BY u.user_profile_id, p.name, p.azure_email
    ORDER BY total_cost_cents DESC
  `;
  return result.rows;
}

async function getToday() {
  const [summary, topApps, topUsers] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int AS request_count,
        COALESCE(SUM(estimated_cost_cents), 0)::numeric AS total_cost_cents,
        COUNT(*) FILTER (WHERE request_status = 'error')::int AS error_count
      FROM api_usage_log
      WHERE created_at::date = CURRENT_DATE
    `,
    sql`
      SELECT
        app_name,
        COUNT(*)::int AS request_count,
        COALESCE(SUM(estimated_cost_cents), 0)::numeric AS total_cost_cents
      FROM api_usage_log
      WHERE created_at::date = CURRENT_DATE
      GROUP BY app_name
      ORDER BY total_cost_cents DESC
      LIMIT 3
    `,
    sql`
      SELECT
        CASE
          WHEN u.user_profile_id IS NULL THEN 'Backend'
          ELSE COALESCE(p.name, p.azure_email, 'Unknown')
        END AS user_name,
        COUNT(*)::int AS request_count,
        COALESCE(SUM(u.estimated_cost_cents), 0)::numeric AS total_cost_cents
      FROM api_usage_log u
      LEFT JOIN user_profiles p ON u.user_profile_id = p.id
      WHERE u.created_at::date = CURRENT_DATE
      GROUP BY u.user_profile_id, p.name, p.azure_email
      ORDER BY total_cost_cents DESC
      LIMIT 3
    `,
  ]);

  return {
    ...summary.rows[0],
    topApps: topApps.rows,
    topUsers: topUsers.rows,
  };
}

async function getByApp(days) {
  const result = await sql`
    SELECT
      app_name,
      COUNT(*)::int AS request_count,
      COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
      COALESCE(SUM(estimated_cost_cents), 0)::numeric AS total_cost_cents,
      COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms,
      COUNT(*) FILTER (WHERE request_status = 'error')::int AS error_count
    FROM api_usage_log
    WHERE created_at >= NOW() - MAKE_INTERVAL(days => ${days})
    GROUP BY app_name
    ORDER BY total_cost_cents DESC
  `;
  return result.rows;
}

async function getByDay(days) {
  const result = await sql`
    SELECT
      DATE(created_at) AS day,
      COUNT(*)::int AS request_count,
      COALESCE(SUM(estimated_cost_cents), 0)::numeric AS total_cost_cents,
      COUNT(DISTINCT user_profile_id)::int AS unique_users
    FROM api_usage_log
    WHERE created_at >= NOW() - MAKE_INTERVAL(days => ${days})
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `;
  return result.rows;
}

// The Virtual Review Panel Phase A foundation never writes api_usage_log
// (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.5) —
// its own per-seat/chair ledger (review_panel_seat_attempts) is surfaced here
// as an additive block. knownCostCents sums only cost_state='known' rows
// (mirrors review-panel-store.js's sumAttemptCosts); byState never folds an
// unknown-outcome attempt's cost into a total. The admin UI must render
// "withheld" rather than a number whenever unknownCount > 0 — see the admin
// page's rendering of this block.
async function getReviewPanel(days) {
  const result = await sql`
    SELECT
      state,
      COUNT(*)::int AS attempt_count,
      COALESCE(SUM(cost_cents) FILTER (WHERE cost_state = 'known'), 0)::numeric AS known_cost_cents
    FROM review_panel_seat_attempts
    WHERE created_at >= NOW() - MAKE_INTERVAL(days => ${days})
    GROUP BY state
  `;
  const byState = result.rows.map((row) => ({ state: row.state, attemptCount: row.attempt_count, knownCostCents: Number(row.known_cost_cents) }));
  const knownCostCents = byState.reduce((sum, row) => sum + row.knownCostCents, 0);
  const unknownCount = byState.find((row) => row.state === 'unknown_outcome')?.attemptCount || 0;
  return { knownCostCents, unknownCount, byState };
}

