/** Five-minute request/artifact mutation leases with monotonic fences. */
import { sql } from '@vercel/postgres';

export const PRESENTATION_SLOT_LEASE_SECONDS = 300;
export const PRESENTATION_SLOT_MAX_FENCE = 2147483647;

export async function getPresentationSlotLease({ requestId, artifactType }) {
  const result = await sql`
    SELECT * FROM presentation_material_slot_leases
     WHERE request_id = ${requestId}
       AND artifact_type = ${artifactType}
     LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function acquirePresentationSlotLease({ requestId, artifactType, leaseToken }) {
  const result = await sql`
    INSERT INTO presentation_material_slot_leases (
      request_id, artifact_type, lease_token, lease_expires_at, fence_version
    ) VALUES (
      ${requestId}, ${artifactType}, ${leaseToken},
      NOW() + (${PRESENTATION_SLOT_LEASE_SECONDS} || ' seconds')::INTERVAL, 1
    )
    ON CONFLICT (request_id, artifact_type) DO UPDATE
      SET lease_token = EXCLUDED.lease_token,
          lease_expires_at = EXCLUDED.lease_expires_at,
          fence_version = CASE
            WHEN presentation_material_slot_leases.lease_token = EXCLUDED.lease_token
              THEN presentation_material_slot_leases.fence_version
            ELSE presentation_material_slot_leases.fence_version + 1
          END,
          updated_at = NOW()
      WHERE (
          presentation_material_slot_leases.lease_token IS NULL
          OR presentation_material_slot_leases.lease_expires_at <= NOW()
        ) AND (
          presentation_material_slot_leases.lease_token = EXCLUDED.lease_token
          OR presentation_material_slot_leases.fence_version < ${PRESENTATION_SLOT_MAX_FENCE}
        )
    RETURNING *
  `;
  return result.rows[0] || null;
}

export async function renewPresentationSlotLease({ requestId, artifactType, leaseToken, fenceVersion }) {
  const result = await sql`
    UPDATE presentation_material_slot_leases
       SET lease_expires_at = NOW() + (${PRESENTATION_SLOT_LEASE_SECONDS} || ' seconds')::INTERVAL,
           updated_at = NOW()
     WHERE request_id = ${requestId}
       AND artifact_type = ${artifactType}
       AND lease_token = ${leaseToken}
       AND fence_version = ${fenceVersion}
       AND lease_expires_at > NOW()
     RETURNING *
  `;
  return result.rows[0] || null;
}

export async function releasePresentationSlotLease({ requestId, artifactType, leaseToken, fenceVersion }) {
  const result = await sql`
    UPDATE presentation_material_slot_leases
       SET lease_expires_at = NOW(), updated_at = NOW()
     WHERE request_id = ${requestId}
       AND artifact_type = ${artifactType}
       AND lease_token = ${leaseToken}
       AND fence_version = ${fenceVersion}
     RETURNING *
  `;
  return result.rows[0] || null;
}
