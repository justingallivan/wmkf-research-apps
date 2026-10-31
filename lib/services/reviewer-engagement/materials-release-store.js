/**
 * Shared claim for releasing review materials to one reviewer engagement
 * (D46/D49; migration 091 `reviewer_materials_releases`).
 *
 * Automatic release on acceptance and manual release both claim the row
 * before minting the reviewer's link. `claimMaterialsRelease` is
 * `INSERT … ON CONFLICT (suggestion_id) DO NOTHING RETURNING`: the first
 * insert owns the release and every other path refuses. States:
 *
 *   claimed → link_minted → sent → recorded
 *                 ↘ uncertain / failed (staff "Send materials again")
 *
 * Each forward step requires the live lease, so a second worker holding a
 * stale view cannot advance it. `recordMaterialsRelease` (sent → recorded)
 * needs no lease: after a confirmed send, any retry may finish the
 * bookkeeping, never resend. Rows left at claimed / link_minted past the
 * lease are not resumed automatically; `reclaimMaterialsRelease` is the
 * staff action that sends again under the same row.
 */
import crypto from 'crypto';
import { sql } from '@vercel/postgres';

export const MATERIALS_RELEASE_STATES = Object.freeze(['claimed', 'link_minted', 'sent', 'recorded', 'uncertain', 'failed']);
export const MATERIALS_RELEASE_LEASE_MS = 10 * 60 * 1000;
const MAX_ERROR_CODE_LENGTH = 100;

function leaseUntil(leaseMs) {
  return new Date(Date.now() + leaseMs).toISOString();
}

function errorCode(code) {
  const value = String(code || 'materials_release_failed');
  return value.slice(0, MAX_ERROR_CODE_LENGTH);
}

export async function getMaterialsRelease(suggestionId) {
  const result = await sql`SELECT * FROM reviewer_materials_releases WHERE suggestion_id = ${suggestionId}`;
  return result.rows[0] || null;
}

/**
 * @returns {Promise<{ claimed: true, release: object } | { claimed: false, release: object|null }>}
 *   `release` on a refused claim is the row that owns it (null only if it
 *   vanished between the insert and the read).
 */
export async function claimMaterialsRelease({ suggestionId, requestId, source, jobId = null, actorProfileId = null, leaseMs = MATERIALS_RELEASE_LEASE_MS }) {
  if (source !== 'acceptance' && source !== 'manual') throw new Error('claimMaterialsRelease: unknown source');
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    INSERT INTO reviewer_materials_releases (suggestion_id, request_id, source, job_id, actor_profile_id, lease_token, lease_until)
    VALUES (${suggestionId}, ${requestId}, ${source}, ${jobId}, ${actorProfileId}, ${leaseToken}, ${leaseUntil(leaseMs)})
    ON CONFLICT (suggestion_id) DO NOTHING
    RETURNING *
  `;
  if (result.rows[0]) return { claimed: true, release: result.rows[0] };
  return { claimed: false, release: await getMaterialsRelease(suggestionId) };
}

/** claimed → link_minted, under the live lease. Null when the lease was lost. */
export async function markMaterialsLinkMinted(suggestionId, leaseToken) {
  const result = await sql`
    UPDATE reviewer_materials_releases
       SET state = 'link_minted', link_minted_at = NOW(), updated_at = NOW()
     WHERE suggestion_id = ${suggestionId} AND lease_token = ${leaseToken}
       AND state = 'claimed' AND lease_until > NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * link_minted → sent after a confirmed delivery. Not lease-bound: the email
 * has left, so the receipt must be kept even if the lease expired mid-send.
 * The token match still fences out a different holder.
 */
export async function markMaterialsSent(suggestionId, leaseToken) {
  const result = await sql`
    UPDATE reviewer_materials_releases
       SET state = 'sent', sent_at = NOW(), error_code = NULL, updated_at = NOW()
     WHERE suggestion_id = ${suggestionId} AND lease_token = ${leaseToken} AND state = 'link_minted'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/** sent → recorded once the Dataverse markers are written. Any retry may finish it. */
export async function recordMaterialsRelease(suggestionId) {
  const result = await sql`
    UPDATE reviewer_materials_releases
       SET state = 'recorded', recorded_at = NOW(), lease_token = NULL, lease_until = NULL, updated_at = NOW()
     WHERE suggestion_id = ${suggestionId} AND state = 'sent'
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * A claimed or link-minted release that cannot finish: `uncertain` when the
 * email may have left, `failed` when it definitely did not. Staff decide.
 */
export async function markMaterialsReleaseStopped(suggestionId, leaseToken, state, code) {
  if (state !== 'uncertain' && state !== 'failed') throw new Error('markMaterialsReleaseStopped: state must be uncertain or failed');
  const result = await sql`
    UPDATE reviewer_materials_releases
       SET state = ${state}, error_code = ${errorCode(code)}, lease_token = NULL, lease_until = NULL, updated_at = NOW()
     WHERE suggestion_id = ${suggestionId} AND lease_token = ${leaseToken} AND state IN ('claimed', 'link_minted')
     RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Staff "Send materials again": takes a stopped release, or one abandoned past
 * its lease, back to `claimed` under a new lease. Never touches sent/recorded.
 */
export async function reclaimMaterialsRelease({ suggestionId, actorProfileId, leaseMs = MATERIALS_RELEASE_LEASE_MS }) {
  const leaseToken = crypto.randomUUID();
  const result = await sql`
    UPDATE reviewer_materials_releases
       SET state = 'claimed', lease_token = ${leaseToken}, lease_until = ${leaseUntil(leaseMs)},
           actor_profile_id = ${actorProfileId}, attempts = attempts + 1, error_code = NULL,
           link_minted_at = NULL, updated_at = NOW()
     WHERE suggestion_id = ${suggestionId}
       AND (state IN ('uncertain', 'failed') OR (state IN ('claimed', 'link_minted') AND lease_until <= NOW()))
     RETURNING *
  `;
  return result.rows[0] || null;
}
