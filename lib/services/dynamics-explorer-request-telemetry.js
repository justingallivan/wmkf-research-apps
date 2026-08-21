/**
 * Dynamics Explorer request telemetry.
 *
 * One row owns one authenticated, body-valid chat request lifecycle. Writes are
 * deliberately fail-soft toward the answer path, while finalization is an
 * atomic running -> terminal compare-and-set. No prompt, answer, tool output,
 * query text, or exception message is stored here.
 */

const { sql } = require('@vercel/postgres');

const TERMINAL_OUTCOMES = new Set([
  'completed',
  'truncated',
  'max_rounds',
  'refused',
  'error',
  'client_disconnected',
]);

const ERROR_STAGES = new Set(['context', 'model', 'tool', 'response', 'telemetry']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeRequestId(value) {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function normalizeSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100
    ? value
    : null;
}

function normalizeRounds(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

class DynamicsExplorerRequestTelemetry {
  static async startRequest({ requestId, userProfileId, sessionId }) {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId) {
      console.warn('Dynamics Explorer request telemetry start skipped: invalid request id');
      return false;
    }

    try {
      const result = await sql`
        INSERT INTO dynamics_explorer_requests (
          request_id, user_profile_id, session_id, outcome, rounds_used
        ) VALUES (
          ${normalizedRequestId}, ${userProfileId || null},
          ${normalizeSessionId(sessionId)}, 'running', 0
        )
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id
      `;
      return result.rows.length === 1;
    } catch (error) {
      console.warn('Dynamics Explorer request telemetry start failed:', error.message);
      return false;
    }
  }

  static async finalizeRequest({
    requestId,
    userProfileId,
    sessionId,
    outcome,
    roundsUsed,
    model = null,
    stopReason = null,
    errorStage = null,
  }) {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId || !TERMINAL_OUTCOMES.has(outcome)) {
      console.warn('Dynamics Explorer request telemetry finalization skipped: invalid terminal state');
      return false;
    }

    const normalizedRounds = normalizeRounds(roundsUsed);
    const normalizedModel = typeof model === 'string' ? model.slice(0, 100) : null;
    const normalizedStopReason = typeof stopReason === 'string' ? stopReason.slice(0, 50) : null;
    const normalizedErrorStage = outcome === 'error' && ERROR_STAGES.has(errorStage)
      ? errorStage
      : null;

    try {
      const updated = await sql`
        UPDATE dynamics_explorer_requests
        SET outcome = ${outcome},
            rounds_used = ${normalizedRounds},
            model = ${normalizedModel},
            stop_reason = ${normalizedStopReason},
            error_stage = ${normalizedErrorStage},
            completed_at = NOW()
        WHERE request_id = ${normalizedRequestId}
          AND outcome = 'running'
        RETURNING request_id
      `;
      if (updated.rows.length === 1) return true;

      // If the start insert failed during a transient outage, recover with a
      // terminal row. A competing finalizer or an existing terminal row wins
      // through the primary key and leaves this attempt as a no-op.
      const inserted = await sql`
        INSERT INTO dynamics_explorer_requests (
          request_id, user_profile_id, session_id, outcome, rounds_used,
          model, stop_reason, error_stage, completed_at
        ) VALUES (
          ${normalizedRequestId}, ${userProfileId || null},
          ${normalizeSessionId(sessionId)}, ${outcome}, ${normalizedRounds},
          ${normalizedModel}, ${normalizedStopReason}, ${normalizedErrorStage}, NOW()
        )
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id
      `;
      return inserted.rows.length === 1;
    } catch (error) {
      console.warn('Dynamics Explorer request telemetry finalization failed:', error.message);
      return false;
    }
  }
}

module.exports = {
  DynamicsExplorerRequestTelemetry,
  TERMINAL_OUTCOMES,
  normalizeRequestId,
  normalizeSessionId,
};
