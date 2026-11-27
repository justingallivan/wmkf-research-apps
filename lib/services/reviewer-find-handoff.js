import { sql } from '@vercel/postgres';

export async function openFindHandoff(requestId, profileId, settings) {
  await sql`INSERT INTO reviewer_find_handoffs(request_id, owner_profile_id, settings)
    VALUES (${requestId}, ${profileId}, ${JSON.stringify(settings)}::jsonb)
    ON CONFLICT (request_id) DO NOTHING`;
  return getFindHandoff(requestId, profileId);
}

export async function getFindHandoff(requestId, profileId) {
  const { rows } = await sql`SELECT COALESCE(NULLIF(p.display_name, ''), p.name) AS owner, CASE WHEN h.owner_profile_id = ${profileId || null} THEN h.settings END AS settings, h.case_id AS "caseId"
    FROM reviewer_find_handoffs h JOIN user_profiles p ON p.id = h.owner_profile_id
    WHERE h.request_id = ${requestId}`;
  return rows[0] || null;
}

export async function completeFindHandoff(requestId, profileId, caseId) {
  const result = await sql`DELETE FROM reviewer_find_handoffs
    WHERE request_id = ${requestId} AND owner_profile_id = ${profileId} AND case_id = ${caseId}`;
  return result.rowCount === 1;
}
