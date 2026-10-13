/**
 * Staff discussion sentiment runs (migration 082). One row per analysis run; a 'generating' row is
 * inserted before the provider call. The validated record is held only on 'ready' rows. Plan:
 * docs/plans/DELIBERATION_SENTIMENT_PLAN_2026-10-13.md §4.4.
 *
 * Terminal writes (`completeRun`, `failRun`) are compare-and-set on the exact run id with
 * `status = 'generating'`: zero rows means the run was abandoned and replaced (or already finished),
 * and the caller discards its late result. Currentness (source artifact, content hash, prompt
 * version) is decided by the service; `acceptRun` repeats it in SQL as a race fence.
 */
import { db, sql } from '@vercel/postgres';

// A 'generating' row older than this was abandoned (the route allows 300 s) and no longer blocks a new run.
export const SENTIMENT_GENERATION_ABANDONED_SECONDS = 360;

const failureCodeOf = (code, fallback) => (String(code || fallback).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 80) || fallback);

/**
 * Reserve a new 'generating' run for one request, in one transaction under an advisory lock on the
 * request. A live 'generating' row blocks: { conflict: { code: 'sentiment_analysis_in_progress' } }.
 * An abandoned one is marked failed ('sentiment_run_abandoned') and the new run is inserted.
 * Returns { run } on success. Any error rolls back. The partial unique index (082) is the backstop.
 */
export async function reserveRun({ id, requestId, sourceArtifactId, sourceContentHash, promptName, profileId }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`discussion-sentiment:${requestId}`]);
    const activeResult = await client.query(
      `SELECT id, (created_at <= NOW() - ($2 || ' seconds')::INTERVAL) AS abandoned
         FROM staff_discussion_sentiments
        WHERE request_id = $1 AND status = 'generating'
        FOR UPDATE`,
      [requestId, SENTIMENT_GENERATION_ABANDONED_SECONDS],
    );
    const active = activeResult.rows[0] || null;
    if (active) {
      if (!active.abandoned) {
        await client.query('ROLLBACK');
        return { conflict: { code: 'sentiment_analysis_in_progress' } };
      }
      await client.query(
        `UPDATE staff_discussion_sentiments
            SET status = 'failed', failure_code = 'sentiment_run_abandoned', completed_at = NOW()
          WHERE id = $1 AND status = 'generating'`,
        [active.id],
      );
    }
    const inserted = await client.query(
      `INSERT INTO staff_discussion_sentiments (
         id, request_id, source_artifact_id, source_content_hash, prompt_name, status, requested_by_profile_id
       ) VALUES ($1, $2, $3, $4, $5, 'generating', $6)
       RETURNING *`,
      [id, requestId, sourceArtifactId, sourceContentHash, promptName, profileId],
    );
    await client.query('COMMIT');
    return { run: inserted.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Record a run that found nothing to analyze (an empty staff discussion). Inserted directly as 'failed'
 * with no provider call; a failed row is outside both partial unique indexes.
 */
export async function recordFailedRun({ id, requestId, sourceArtifactId, sourceContentHash, promptName, profileId, failureCode }) {
  const code = failureCodeOf(failureCode, 'sentiment_failed');
  const result = await sql`
    INSERT INTO staff_discussion_sentiments (
      id, request_id, source_artifact_id, source_content_hash, prompt_name, status, failure_code,
      requested_by_profile_id, completed_at
    ) VALUES (
      ${id}, ${requestId}, ${sourceArtifactId}, ${sourceContentHash}, ${promptName}, 'failed', ${code},
      ${profileId}, NOW()
    )
    RETURNING *
  `;
  return result.rows[0] || null;
}

/** Fill a generating row with the validated record. Null when the run was abandoned or already finished. */
export async function completeRun({ id, record, promptName, promptVersion, model }) {
  const result = await sql`
    UPDATE staff_discussion_sentiments
       SET status = 'ready', record = ${JSON.stringify(record)}::jsonb, prompt_name = ${promptName},
           prompt_version = ${promptVersion}, model = ${model || null}, completed_at = NOW()
     WHERE id = ${id} AND status = 'generating'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Record a failed run with a content-free code. Null when the run was abandoned or already finished. */
export async function failRun({ id, failureCode }) {
  const code = failureCodeOf(failureCode, 'sentiment_failed');
  const result = await sql`
    UPDATE staff_discussion_sentiments
       SET status = 'failed', failure_code = ${code}, completed_at = NOW()
     WHERE id = ${id} AND status = 'generating'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Accept a ready run that is still current (the expected source and prompt version are the caller's
 * view of "current right now"). In one transaction under the request lock, any previously accepted,
 * not withdrawn row is withdrawn by this actor, then this row is accepted. A row that was already
 * accepted (even if withdrawn) or is not ready and current is not accepted: returns null and writes nothing.
 */
export async function acceptRun({ id, requestId, profileId, expected }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`discussion-sentiment:${requestId}`]);
    const target = await client.query(
      `SELECT id FROM staff_discussion_sentiments
        WHERE id = $1 AND request_id = $2 AND status = 'ready' AND accepted_at IS NULL
          AND source_artifact_id = $3 AND source_content_hash = $4 AND prompt_version = $5
        FOR UPDATE`,
      [id, requestId, expected.sourceArtifactId, expected.sourceContentHash, expected.promptVersion],
    );
    if (!target.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    // Monotonic guard, under the lock and before any withdraw: an older result never displaces a newer
    // accepted one. The service's currentness read happened before this lock, so it can be stale.
    const newer = await client.query(
      `SELECT o.id FROM staff_discussion_sentiments o
        WHERE o.request_id = $1 AND o.accepted_at IS NOT NULL AND o.withdrawn_at IS NULL AND o.id <> $2
          AND (o.completed_at, o.id) > (SELECT t.completed_at, t.id FROM staff_discussion_sentiments t WHERE t.id = $2)`,
      [requestId, id],
    );
    if (newer.rows[0]) {
      await client.query('ROLLBACK');
      return { conflict: { code: 'sentiment_newer_result_accepted' } };
    }
    await client.query(
      `UPDATE staff_discussion_sentiments
          SET withdrawn_by_profile_id = $2, withdrawn_at = NOW()
        WHERE request_id = $1 AND accepted_at IS NOT NULL AND withdrawn_at IS NULL`,
      [requestId, profileId],
    );
    const accepted = await client.query(
      `UPDATE staff_discussion_sentiments
          SET accepted_by_profile_id = $2, accepted_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, profileId],
    );
    await client.query('COMMIT');
    return accepted.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Withdraw the request's accepted row. History stays; there is no fallback to an older accepted row. */
export async function withdrawRun({ id, requestId, profileId }) {
  const result = await sql`
    UPDATE staff_discussion_sentiments
       SET withdrawn_by_profile_id = ${profileId}, withdrawn_at = NOW()
     WHERE id = ${id} AND request_id = ${requestId} AND accepted_at IS NOT NULL AND withdrawn_at IS NULL
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function getRun({ id, requestId }) {
  const result = await sql`
    SELECT * FROM staff_discussion_sentiments WHERE id = ${id} AND request_id = ${requestId}
  `;
  return result.rows[0] || null;
}

/** The request's newest run in any state (the page's "Analyzing" and last-failure line), or null. */
export async function getLatestRun({ requestId }) {
  // live_generating is judged by the database clock, the same clock that stamped created_at.
  const result = await sql`
    SELECT *, (status = 'generating'
               AND created_at > NOW() - (${SENTIMENT_GENERATION_ABANDONED_SECONDS}::int * INTERVAL '1 second')) AS live_generating
      FROM staff_discussion_sentiments
     WHERE request_id = ${requestId}
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `;
  return result.rows[0] || null;
}

/** The newest ready run for the exact current source and prompt version (ties: completed_at, then id), or null. */
export async function getLatestCurrentReadyRun({ requestId, sourceArtifactId, sourceContentHash, promptVersion }) {
  const result = await sql`
    SELECT * FROM staff_discussion_sentiments
     WHERE request_id = ${requestId} AND status = 'ready'
       AND source_artifact_id = ${sourceArtifactId} AND source_content_hash = ${sourceContentHash}
       AND prompt_version = ${promptVersion}
     ORDER BY completed_at DESC, id DESC
     LIMIT 1
  `;
  return result.rows[0] || null;
}

/** The request's single accepted, not withdrawn row, or null. The caller still checks currentness. */
export async function getAcceptedRun({ requestId }) {
  const result = await sql`
    SELECT * FROM staff_discussion_sentiments
     WHERE request_id = ${requestId} AND accepted_at IS NOT NULL AND withdrawn_at IS NULL
     LIMIT 1
  `;
  return result.rows[0] || null;
}

/** The request's newest ready run in any currentness (the page's "Out of date" result), or null. */
export async function getLatestReadyRun({ requestId }) {
  const result = await sql`
    SELECT * FROM staff_discussion_sentiments
     WHERE request_id = ${requestId} AND status = 'ready'
     ORDER BY completed_at DESC, id DESC
     LIMIT 1
  `;
  return result.rows[0] || null;
}

/** A staff member's display name for the "accepted by" line, or null. */
export async function getProfileName({ profileId }) {
  const result = await sql`SELECT display_name, name FROM user_profiles WHERE id = ${profileId}`;
  const row = result.rows[0];
  return row ? (row.display_name || row.name || null) : null;
}
