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
import { ATTEMPT_COST_UNKNOWN_SQL } from '../../../lib/services/review-panel-store';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { testRequestIsolationEnabled } from '../../../lib/services/test-requests/isolation.js';
import { excludeTestRequestSpendRows } from '../../../lib/services/test-requests/spend-isolation.js';

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

  return withDalContext('admin-stats', async () => {
    try {
      const [summary, byUser, byApp, byDay, today, reviewPanel] = await Promise.all([
        getSummary(days),
        getByUser(days),
        getByApp(days),
        getByDay(days),
        getToday(),
        getReviewPanel(days),
      ]);

      return res.json({
        period, days, summary, byUser, byApp, byDay, today, reviewPanel,
        ...(testRequestIsolationEnabled() ? { usageAttribution: { apiUsageLog: 'unattributable' } } : {}),
      });
    } catch (error) {
      console.error('Admin stats error:', error);
      return res.status(500).json({ error: 'Failed to fetch usage stats' });
    }
  });
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
// as an additive block. Uses the SAME ATTEMPT_COST_UNKNOWN_SQL predicate as
// review-panel-store.js's sumAttemptCosts/sumEntryAttemptCosts and
// pages/api/cron/spend-check.js — a single definition so "unknown cost" can
// never drift between call sites. Per-state unknownCount is computed WITHIN
// each state's group (a 'failed' or 'completed' bucket can itself contain
// attempts with cost_state='unknown' — an ambiguous paid-call confirmation —
// alongside attempts with a known cost), not just assumed for the
// 'unknown_outcome' bucket. The admin UI must render "Withheld" rather than
// a number for ANY state bucket whose own unknownCount > 0 — see
// pages/admin.js's rendering of this block.
//
// PR #281 merges review_panel_seat_attempts callers before migration 047
// runs on main's auto-deploy, so this table can legitimately not exist yet.
// Isolate that one failure mode (Postgres 42P01 undefined_table) so a
// missing table cannot fail this whole admin/stats response: return an
// `available: false` shape instead of throwing. Any other error still
// propagates — this is not a blanket swallow. pages/admin.js must render
// "Not migrated" (never a dollar figure or "Withheld") when available is
// false.
async function getReviewPanel(days) {
  try {
    if (testRequestIsolationEnabled()) {
      const grouped = await sql.query(
        `SELECT
           a.state AS state,
           e.request_id AS request_id,
           COUNT(*)::int AS attempt_count,
           COALESCE(SUM(a.cost_cents) FILTER (WHERE NOT ${ATTEMPT_COST_UNKNOWN_SQL}), 0)::numeric AS known_cost_cents,
           COUNT(*) FILTER (WHERE ${ATTEMPT_COST_UNKNOWN_SQL})::int AS unknown_count
         FROM review_panel_seat_attempts a
         JOIN review_panel_entries e ON e.id = a.entry_id
         WHERE a.created_at >= NOW() - MAKE_INTERVAL(days => $1)
         GROUP BY a.state, e.request_id`,
        [days]);
      const filtered = await excludeTestRequestSpendRows(grouped.rows);
      const byStateMap = new Map();
      for (const row of filtered.rows) {
        const current = byStateMap.get(row.state) || {
          state: row.state, attemptCount: 0, knownCostCents: 0, unknownCount: 0,
        };
        current.attemptCount += Number(row.attempt_count);
        current.knownCostCents += Number(row.known_cost_cents);
        current.unknownCount += Number(row.unknown_count);
        byStateMap.set(row.state, current);
      }
      const byState = [...byStateMap.values()];
      return {
        knownCostCents: byState.reduce((sum, row) => sum + row.knownCostCents, 0),
        unknownCount: byState.reduce((sum, row) => sum + row.unknownCount, 0),
        byState,
        available: true,
        isolation: filtered.isolation,
      };
    }
    const result = await sql.query(
      `SELECT
         a.state AS state,
         COUNT(*)::int AS attempt_count,
         COALESCE(SUM(a.cost_cents) FILTER (WHERE NOT ${ATTEMPT_COST_UNKNOWN_SQL}), 0)::numeric AS known_cost_cents,
         COUNT(*) FILTER (WHERE ${ATTEMPT_COST_UNKNOWN_SQL})::int AS unknown_count
       FROM review_panel_seat_attempts a
       WHERE a.created_at >= NOW() - MAKE_INTERVAL(days => $1)
       GROUP BY a.state`,
      [days]);
    const byState = result.rows.map((row) => ({
      state: row.state, attemptCount: row.attempt_count,
      knownCostCents: Number(row.known_cost_cents), unknownCount: row.unknown_count,
    }));
    const knownCostCents = byState.reduce((sum, row) => sum + row.knownCostCents, 0);
    const unknownCount = byState.reduce((sum, row) => sum + row.unknownCount, 0);
    return { knownCostCents, unknownCount, byState, available: true };
  } catch (error) {
    if (error && error.code === '42P01') {
      console.warn('review_panel_seat_attempts not present; migration 047 not applied');
      return { knownCostCents: 0, unknownCount: 0, byState: [], available: false };
    }
    throw error;
  }
}
