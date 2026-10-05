/**
 * Site Visit summary drafts (migration 070). One row per Summarize run; the
 * acknowledgment is recorded before the provider call. Generated text is held
 * only while a row is 'ready' or 'publishing'; every other transition clears it.
 * A publish claims the row ('publishing') before any external write, so edit,
 * discard, and a new run cannot change or retire what is being published (Codex
 * review 2026-10-05). Plan §4.3, §6, §16, §17.
 */
import { sql } from '@vercel/postgres';

export const SUMMARY_DRAFT_TTL_DAYS = 14;
// A 'generating' row older than this was abandoned (the route allows 300 s) and
// no longer blocks a new run; likewise a 'publishing' claim (the route allows 120 s).
export const SUMMARY_GENERATION_ABANDONED_SECONDS = 360;

/**
 * Retire the request's ready draft (and any abandoned run), then insert a new
 * 'generating' row carrying the acknowledgment. Returns the new row, or null
 * when another run is still generating (the partial unique index refuses it).
 */
export async function beginSummaryDraft({
  id, requestId, artifactType, sourceRevisionId, presentationEndMs, sourceArtifactId,
  acknowledgmentVersion, profileId,
}) {
  await sql`
    UPDATE meeting_transcript_summary_drafts
       SET state = 'superseded', summary_text = NULL, version = version + 1,
           updated_by_profile_id = ${profileId}, updated_at = NOW()
     WHERE request_id = ${requestId}
       AND artifact_type = ${artifactType}
       AND (state = 'ready'
         OR (state = 'generating' AND created_at <= NOW() - (${SUMMARY_GENERATION_ABANDONED_SECONDS} || ' seconds')::INTERVAL)
         OR (state = 'publishing' AND publish_claimed_at <= NOW() - (${SUMMARY_GENERATION_ABANDONED_SECONDS} || ' seconds')::INTERVAL))
  `;
  const result = await sql`
    INSERT INTO meeting_transcript_summary_drafts (
      id, request_id, artifact_type, state, source_revision_id, presentation_end_ms, source_artifact_id,
      acknowledgment_version, acknowledged_by_profile_id, acknowledged_at, updated_by_profile_id, expires_at
    ) VALUES (
      ${id}, ${requestId}, ${artifactType}, 'generating', ${sourceRevisionId}, ${presentationEndMs}, ${sourceArtifactId},
      ${acknowledgmentVersion}, ${profileId}, NOW(), ${profileId},
      NOW() + (${SUMMARY_DRAFT_TTL_DAYS} || ' days')::INTERVAL
    )
    ON CONFLICT (request_id, artifact_type) WHERE state IN ('generating', 'ready', 'publishing') DO NOTHING
    RETURNING *
  `;
  return result.rows[0] || null;
}

/** Fill a generating row with the accepted text. Null when the row was retired meanwhile. */
export async function completeSummaryDraft({ id, text, promptName, promptVersion, promptId, aiRunId }) {
  const result = await sql`
    UPDATE meeting_transcript_summary_drafts
       SET state = 'ready', summary_text = ${text}, prompt_name = ${promptName}, prompt_version = ${promptVersion},
           prompt_id = ${promptId}, ai_run_id = ${aiRunId}, version = version + 1, updated_at = NOW()
     WHERE id = ${id} AND state = 'generating'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Record a failed run; the acknowledgment metadata stays. */
export async function failSummaryDraft({ id, failureCode }) {
  const result = await sql`
    UPDATE meeting_transcript_summary_drafts
       SET state = 'failed', failure_code = ${String(failureCode || 'summary_failed').slice(0, 100)},
           version = version + 1, updated_at = NOW()
     WHERE id = ${id} AND state = 'generating'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** The request's active (generating, ready, or publishing; unexpired) draft of this type, or null. */
export async function getActiveSummaryDraft({ requestId, artifactType }) {
  const result = await sql`
    SELECT * FROM meeting_transcript_summary_drafts
     WHERE request_id = ${requestId}
       AND artifact_type = ${artifactType}
       AND state IN ('generating', 'ready', 'publishing')
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1
  `;
  return result.rows[0] || null;
}

/** The newest run of this type in any state (for the card's last-failure line), or null. */
export async function getLatestSummaryRun({ requestId, artifactType }) {
  const result = await sql`
    SELECT id, state, failure_code, created_at, updated_at FROM meeting_transcript_summary_drafts
     WHERE request_id = ${requestId}
       AND artifact_type = ${artifactType}
     ORDER BY created_at DESC
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function updateSummaryDraftText({ id, requestId, text, expectedVersion, profileId }) {
  const result = await sql`
    UPDATE meeting_transcript_summary_drafts
       SET summary_text = ${text}, text_edited = TRUE, version = version + 1,
           updated_by_profile_id = ${profileId}, updated_at = NOW()
     WHERE id = ${id} AND request_id = ${requestId} AND state = 'ready'
       AND version = ${expectedVersion} AND expires_at > NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function discardSummaryDraft({ id, requestId, expectedVersion, profileId }) {
  const result = await sql`
    UPDATE meeting_transcript_summary_drafts
       SET state = 'discarded', summary_text = NULL, version = version + 1,
           updated_by_profile_id = ${profileId}, updated_at = NOW()
     WHERE id = ${id} AND request_id = ${requestId} AND state = 'ready' AND version = ${expectedVersion}
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Claim a draft for publication before any external write. A 'ready' row at the
 * expected version, or a 'publishing' row at that version (a retry of an
 * interrupted publish), is claimed; the version is unchanged so a retry can name
 * it. Null when the draft was edited, discarded, replaced, or expired.
 */
export async function claimSummaryDraftForPublish({ id, requestId, expectedVersion, profileId }) {
  const result = await sql`
    UPDATE meeting_transcript_summary_drafts
       SET state = 'publishing', publish_claimed_at = NOW(),
           updated_by_profile_id = ${profileId}, updated_at = NOW()
     WHERE id = ${id} AND request_id = ${requestId} AND version = ${expectedVersion}
       AND state IN ('ready', 'publishing') AND expires_at > NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Return a claim to 'ready' when the publish stopped before any registry write was attempted. */
export async function releaseSummaryDraftClaim({ id, requestId, expectedVersion }) {
  const result = await sql`
    UPDATE meeting_transcript_summary_drafts
       SET state = 'ready', publish_claimed_at = NULL, updated_at = NOW()
     WHERE id = ${id} AND request_id = ${requestId} AND version = ${expectedVersion} AND state = 'publishing'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** After the registry row is confirmed: clear the text and point at the published row. */
export async function markSummaryDraftPublished({ id, requestId, expectedVersion, publishedArtifactId, profileId }) {
  const result = await sql`
    UPDATE meeting_transcript_summary_drafts
       SET state = 'published', summary_text = NULL, published_artifact_id = ${publishedArtifactId},
           version = version + 1, updated_by_profile_id = ${profileId}, updated_at = NOW()
     WHERE id = ${id} AND request_id = ${requestId} AND state = 'publishing' AND version = ${expectedVersion}
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** Maintenance: clear the text of every expired active draft. Returns the count. */
export async function expireSummaryDrafts() {
  const result = await sql`
    UPDATE meeting_transcript_summary_drafts
       SET state = 'expired', summary_text = NULL, version = version + 1, updated_at = NOW()
     WHERE state IN ('generating', 'ready', 'publishing') AND expires_at <= NOW()
  `;
  return result.rowCount || 0;
}
