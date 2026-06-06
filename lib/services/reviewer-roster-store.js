/**
 * reviewer-roster-store — Postgres CRUD for `reviewer_find_roster`, the durable
 * per-request reviewer-search candidate roster behind the Workbench Find tab.
 *
 * One row per (request_id, normalized_name); the unique index is the cross-run
 * dedup key. Status: 'active' (selectable) | 'excluded' (collapsed, recoverable)
 * | 'saved' (graduated to the Dataverse pool; kept for dedup). See
 * docs/atlas/postgres-reviewer-find-roster.md + migration 020.
 *
 * CJS (mirrors database-service.js) so it can be required by the route and share
 * the CJS `normalizeReviewerName` util with `/discover`. The `candidate` JSON is
 * a pruned render DTO produced by `pruneCandidateForRoster` (reviewer-search-
 * logic.js) — this store treats it as opaque.
 */

const { sql } = require('@vercel/postgres');
const { normalizeReviewerName } = require('../utils/reviewer-name-match');

// Max non-excluded rows retained per request. Bounds growth in v1 (a TTL cron is
// a follow-up). Excluded rows are user-curated and never evicted.
const PER_REQUEST_ACTIVE_CAP = 300;

function sourceKindOf(candidate) {
  return (candidate && (candidate.isClaudeSuggestion || candidate.source === 'claude_suggestion'))
    ? 'claude_verified'
    : 'database';
}

/**
 * Bulk-record surfaced candidates as 'active'. Idempotent on (request, name):
 * refreshes the blob but NEVER downgrades an 'excluded'/'saved' row back to
 * 'active' (curation wins — the WHERE on the conflict update). `candidates` are
 * pruned DTOs carrying at least `.name`. Best-effort per row; enforces the cap.
 */
async function recordSurfaced(requestId, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  let recorded = 0;
  for (const c of list) {
    const name = c && c.name;
    const normalized = normalizeReviewerName(name);
    if (!normalized) continue; // unnamed / junk — nothing to dedup on
    try {
      await sql`
        INSERT INTO reviewer_find_roster
          (request_id, normalized_name, display_name, status, candidate, source_kind)
        VALUES (${requestId}, ${normalized}, ${String(name)}, 'active', ${JSON.stringify(c)}, ${sourceKindOf(c)})
        ON CONFLICT (request_id, normalized_name) DO UPDATE
          SET candidate = ${JSON.stringify(c)}, updated_at = now()
          WHERE reviewer_find_roster.status = 'active'
      `;
      recorded++;
    } catch (error) {
      console.error('reviewer-roster recordSurfaced row error:', error.message);
    }
  }
  await enforceCap(requestId);
  return recorded;
}

/** Evict the oldest non-excluded rows beyond the per-request cap. */
async function enforceCap(requestId) {
  try {
    await sql`
      DELETE FROM reviewer_find_roster
      WHERE request_id = ${requestId}
        AND status <> 'excluded'
        AND id IN (
          SELECT id FROM reviewer_find_roster
          WHERE request_id = ${requestId} AND status <> 'excluded'
          ORDER BY updated_at DESC
          OFFSET ${PER_REQUEST_ACTIVE_CAP}
        )
    `;
  } catch (error) {
    console.error('reviewer-roster enforceCap error:', error.message);
  }
}

/**
 * Set a candidate aside ('excluded'). Upserts from the submitted blob so it is
 * eviction-tolerant: an exclude on a row the cap already removed recreates it as
 * 'excluded' rather than 404ing. Excluded wins over any prior status.
 */
async function setExcluded(requestId, candidate) {
  const name = candidate && candidate.name;
  const normalized = normalizeReviewerName(name);
  if (!normalized) throw new Error('reviewer-roster.setExcluded: candidate.name required');
  await sql`
    INSERT INTO reviewer_find_roster
      (request_id, normalized_name, display_name, status, candidate, source_kind)
    VALUES (${requestId}, ${normalized}, ${String(name)}, 'excluded', ${JSON.stringify(candidate)}, ${sourceKindOf(candidate)})
    ON CONFLICT (request_id, normalized_name) DO UPDATE
      SET status = 'excluded', candidate = ${JSON.stringify(candidate)}, updated_at = now()
  `;
}

/**
 * Promote an excluded candidate back to 'active'. No-op (returns null) if the row
 * is gone (cap eviction) — the caller already holds the blob in memory.
 * Returns the stored candidate blob on success.
 */
async function promote(requestId, name) {
  const normalized = normalizeReviewerName(name);
  if (!normalized) return null;
  const res = await sql`
    UPDATE reviewer_find_roster
      SET status = 'active', updated_at = now()
      WHERE request_id = ${requestId} AND normalized_name = ${normalized} AND status = 'excluded'
      RETURNING candidate
  `;
  return res.rows[0] ? res.rows[0].candidate : null;
}

/**
 * Mark names as 'saved' (graduated to the Dataverse pool) so they leave the
 * active Find list but stay deduped. Leaves 'excluded' rows untouched.
 * Eviction-tolerant (Codex post-impl): UPSERTS so a name whose row the cap
 * already evicted is re-created as 'saved' (keeps it in the dedup set) rather
 * than silently dropped. Returns the count of names processed.
 */
async function markSaved(requestId, names) {
  const list = (Array.isArray(names) ? names : []).filter((n) => normalizeReviewerName(n));
  let saved = 0;
  for (const name of list) {
    const normalized = normalizeReviewerName(name);
    try {
      await sql`
        INSERT INTO reviewer_find_roster
          (request_id, normalized_name, display_name, status, candidate)
        VALUES (${requestId}, ${normalized}, ${String(name)}, 'saved', ${JSON.stringify({ name: String(name) })})
        ON CONFLICT (request_id, normalized_name) DO UPDATE
          SET status = 'saved', updated_at = now()
          WHERE reviewer_find_roster.status <> 'excluded'
      `;
      saved++;
    } catch (error) {
      console.error('reviewer-roster markSaved row error:', error.message);
    }
  }
  return saved;
}

/**
 * List the roster for a request: { active, excluded, allNames }.
 *   - active   : candidate blobs for the selectable list (status='active')
 *   - excluded : candidate blobs for the collapsed recoverable section
 *   - allNames : display_names for EVERY status — the cross-run dedup union
 */
async function listForRequest(requestId) {
  const res = await sql`
    SELECT status, display_name, candidate
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
    ORDER BY updated_at DESC
  `;
  const active = [];
  const excluded = [];
  const allNames = [];
  for (const row of res.rows) {
    allNames.push(row.display_name);
    if (row.status === 'active') active.push(row.candidate);
    else if (row.status === 'excluded') excluded.push(row.candidate);
  }
  return { active, excluded, allNames };
}

module.exports = {
  PER_REQUEST_ACTIVE_CAP,
  recordSurfaced,
  setExcluded,
  promote,
  markSaved,
  listForRequest,
};
