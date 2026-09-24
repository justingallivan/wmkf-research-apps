/**
 * IntakeAuditService - append-only audit log for the applicant intake portal.
 *
 * Every state-changing action (draft upsert, submit, attachment up/down,
 * membership request/approve/reject/revoke, staff override) writes one
 * row here. Payloads are sha256-hashed; the bytes are never stored, so
 * the table is safe under PII review even when drafts contain sensitive
 * applicant content.
 *
 * Failures during audit are logged and swallowed. Audit MUST NOT block
 * the primary operation — losing a single audit row is preferable to
 * failing an applicant submit because the audit insert had a hiccup.
 *
 * See docs/INTAKE_PORTAL_DESIGN.md (Audit / observability).
 */

const crypto = require('crypto');
const { sql } = require('../postgres/client');

const ACTOR_TYPES = new Set(['applicant', 'staff', 'system']);

function digestPayload(payload) {
  if (payload == null) return null;
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('sha256').update(str).digest('hex');
}

class IntakeAuditService {
  /**
   * Append one audit row. Returns the inserted row id, or null on failure.
   */
  static async log({
    actorOid = null,
    actorType,
    action,
    targetEntity = null,
    targetId = null,
    payload = null,
    metadata = null,
    ipAddress = null,
    userAgent = null,
  }) {
    if (!actorType || !ACTOR_TYPES.has(actorType)) {
      console.error(`IntakeAuditService.log: invalid actorType=${actorType}`);
      return null;
    }
    if (!action) {
      console.error('IntakeAuditService.log: action is required');
      return null;
    }

    try {
      const result = await sql`
        INSERT INTO intake_audit (
          actor_oid, actor_type, action,
          target_entity, target_id,
          payload_digest, metadata,
          ip_address, user_agent
        ) VALUES (
          ${actorOid}, ${actorType}, ${action},
          ${targetEntity}, ${targetId},
          ${digestPayload(payload)},
          ${metadata ? JSON.stringify(metadata) : '{}'}::jsonb,
          ${ipAddress}, ${userAgent}
        )
        RETURNING id
      `;
      return result.rows[0]?.id ?? null;
    } catch (error) {
      console.error('IntakeAuditService.log error:', error.message);
      return null;
    }
  }

  static async queryByActor(actorOid, { limit = 100 } = {}) {
    try {
      const result = await sql`
        SELECT * FROM intake_audit
        WHERE actor_oid = ${actorOid}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return result.rows;
    } catch (error) {
      console.error('IntakeAuditService.queryByActor error:', error.message);
      return [];
    }
  }

  static async queryByTarget(targetEntity, targetId, { limit = 100 } = {}) {
    try {
      const result = await sql`
        SELECT * FROM intake_audit
        WHERE target_entity = ${targetEntity}
          AND target_id = ${targetId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return result.rows;
    } catch (error) {
      console.error('IntakeAuditService.queryByTarget error:', error.message);
      return [];
    }
  }

  static digestPayload = digestPayload;
}

module.exports = IntakeAuditService;
