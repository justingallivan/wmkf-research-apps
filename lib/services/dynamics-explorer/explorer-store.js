/**
 * Postgres helpers for the Dynamics Explorer chat loop: a fail-soft
 * user-role read, a fail-closed (throws on error) active-restriction read
 * that the route depends on never resolving under an empty restriction set,
 * and fire-and-forget query logging with its legacy-column fallback insert.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:2956-2983
 * (pre-S2 line numbers); characterization tests are the safety net.
 */

import { sql } from '@vercel/postgres';

// ─── Database helpers ───

export async function getUserRole(userProfileId) {
  if (!userProfileId) return 'read_only';
  try {
    const result = await sql`SELECT role FROM dynamics_user_roles WHERE user_profile_id = ${userProfileId}`;
    return result.rows[0]?.role || 'read_only';
  } catch { return 'read_only'; }
}

export async function getActiveRestrictions() {
  const result = await sql`SELECT table_name, field_name, restriction_type, reason FROM dynamics_restrictions ORDER BY table_name`;
  return result.rows;
}

export function logQuery({ requestId, requestRound, userProfileId, sessionId, queryType, tableName, queryParams, recordCount, executionTime, wasDenied = false, denialReason = null }) {
  const correlatedWrite = sql`INSERT INTO dynamics_query_log (user_profile_id, session_id, query_type, table_name, query_params, record_count, execution_time_ms, was_denied, denial_reason, request_id, request_round)
    VALUES (${userProfileId || null}, ${sessionId || null}, ${queryType}, ${tableName}, ${JSON.stringify(queryParams)}, ${recordCount}, ${executionTime}, ${wasDenied}, ${denialReason}, ${requestId || null}, ${Number.isInteger(requestRound) ? requestRound : null})`;
  correlatedWrite.catch(err => {
    if (err?.code !== '42703') {
      console.warn('Failed to log dynamics query:', err.message);
      return;
    }
    sql`INSERT INTO dynamics_query_log (user_profile_id, session_id, query_type, table_name, query_params, record_count, execution_time_ms, was_denied, denial_reason)
      VALUES (${userProfileId || null}, ${sessionId || null}, ${queryType}, ${tableName}, ${JSON.stringify(queryParams)}, ${recordCount}, ${executionTime}, ${wasDenied}, ${denialReason})`
      .catch(fallbackError => console.warn('Failed to log dynamics query:', fallbackError.message));
  });
}
