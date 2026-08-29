/**
 * OperationalEventService — durable structured operational events.
 *
 * Persistence for the `operational_events` table (migration 030): one row per
 * operational event, from two sources:
 *   * 'app'          — application-recorded failures/recoveries. Mirrored from
 *                      NotificationService.notify() (severity error/critical,
 *                      or any caller passing `operationalEvent`) and from
 *                      explicit seam wiring (e.g. reviewer-acceptance drain).
 *   * 'vercel-drain' — selected runtime log entries delivered by the Vercel
 *                      Log Drain to /api/webhooks/vercel-log-drain.
 *
 * Contract:
 *   * recordEvent / markRecovered / markSuperseded are STRICTLY BEST-EFFORT:
 *     they never throw. A Postgres outage must not convert an original
 *     business failure into a different failure. Their own failures are
 *     console.error'd (once landed in runtime logs, the drain itself is the
 *     durable witness) and are never routed through NotificationService —
 *     that would risk a recursive alert loop.
 *   * resolveEvent / reopenEvent / queryEvents / getEventById serve the admin
 *     surface and MAY throw; the route maps errors to HTTP.
 *   * Redaction boundary lives HERE: summaries pass through redactLogText and
 *     are length-capped; metadata is depth/size/key-capped with a sensitive-
 *     key denylist and per-string redaction. Callers still must not pass
 *     request bodies, file contents, or tokens — this layer is the backstop,
 *     not a license.
 *
 * Dedup semantics (dedupe_key):
 *   * Drain rows use Vercel's stable log id (`vercel:<id>`) with
 *     ON CONFLICT DO NOTHING — at-least-once delivery, exactly-once storage.
 *   * App rows may pass a stable fingerprint (autoResolveKey shape). A repeat
 *     occurrence folds into the existing row: occurrence_count increments,
 *     last_occurred_at advances, summary/metadata/severity refresh, and a
 *     settled (recovered/resolved/superseded) row REOPENS to 'open' so a
 *     recurrence after recovery is visible as unresolved again.
 *
 * Trust model: like NotificationService, this service assumes any ambient
 * DAL context the caller established. It never opens its own withDalContext
 * (it only touches Postgres).
 */

const crypto = require('crypto');
const { sql } = require('@vercel/postgres');
const { redactLogText } = require('../utils/log-redactor');

const SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);
const STATUSES = new Set(['open', 'recovered', 'resolved', 'superseded', 'info']);
const SOURCES = new Set(['app', 'vercel-drain']);

const SUMMARY_MAX_CHARS = 2000;
const SHORT_FIELD_MAX_CHARS = 200;
// Matches the admin list's maximum page size (queryEvents limit cap).
const BULK_STATUS_MAX_ITEMS = 500;
const METADATA_MAX_STRING = 500;
const METADATA_MAX_KEYS = 40;
const METADATA_MAX_ARRAY = 20;
const METADATA_MAX_DEPTH = 3;
const METADATA_MAX_JSON_BYTES = 8 * 1024;

// Keys whose values are never stored regardless of content. Substring match,
// lowercase — 'authorization', 'x-api-key', 'sessionToken', etc. all hit.
const SENSITIVE_KEY_FRAGMENTS = [
  'authorization', 'cookie', 'token', 'secret', 'password', 'passwd',
  'apikey', 'api_key', 'bearer', 'signature', 'credential', 'clientip',
  'client_ip', 'ipaddress', 'ip_address', 'remoteaddress', 'remote_address',
  'forwarded', 'useragent', 'user_agent', 'email',
];

// Value-level IP redaction backstop (Codex adversarial finding, 2026-08-19):
// key-fragment denylisting alone misses bare keys like `ip`, so any string
// that LOOKS like an address is redacted regardless of its key. IPv4 may
// over-match dotted version numbers — acceptable, this boundary is
// deliberately conservative. IPv6 requires 2+ hex groups so times ("12:30")
// and single-colon pairs survive.
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}(?:%[0-9a-z]+)?\b/gi;

function isSensitiveKey(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((frag) => k.includes(frag));
}

function sanitizeString(value, maxChars) {
  const redacted = redactLogText(value)
    .replace(IPV4_RE, '[REDACTED:ip]')
    .replace(IPV6_RE, '[REDACTED:ip]');
  return redacted.length > maxChars
    ? `${redacted.slice(0, maxChars)}…[truncated]`
    : redacted;
}

function sanitizeShortField(value) {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(value);
  if (!s.trim()) return null;
  return sanitizeString(s, SHORT_FIELD_MAX_CHARS);
}

/**
 * Canonicalize an IDENTITY field (dedupe_key / recovery_key). Identity must
 * stay stable and collision-resistant, so unlike display fields it is NEVER
 * redacted — redactLogText's long-token rule collapsed distinct ≥40-char
 * opaque ids into the same '[REDACTED:long-token]' key, turning distinct
 * drain entries into false duplicates (Codex adversarial finding, cycle 4,
 * 2026-08-19). Overlong keys keep a greppable prefix plus a sha256 digest so
 * they remain deterministic and unique. Writers and recovery/supersede
 * lookups both go through this, keeping key symmetry.
 */
function canonicalizeKey(value) {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(value);
  if (!s.trim()) return null;
  if (s.length <= SHORT_FIELD_MAX_CHARS) return s;
  const digest = crypto.createHash('sha256').update(s).digest('hex');
  return `${s.slice(0, 80)}…sha256:${digest}`;
}

function sanitizeMetadataValue(value, depth) {
  if (value == null) return null;
  const type = typeof value;
  if (type === 'string') return sanitizeString(value, METADATA_MAX_STRING);
  if (type === 'number') return Number.isFinite(value) ? value : String(value);
  if (type === 'boolean') return value;
  if (type === 'bigint') return String(value);
  if (Array.isArray(value)) {
    if (depth >= METADATA_MAX_DEPTH) return '[max-depth]';
    const capped = value.slice(0, METADATA_MAX_ARRAY)
      .map((v) => sanitizeMetadataValue(v, depth + 1));
    if (value.length > METADATA_MAX_ARRAY) capped.push(`[+${value.length - METADATA_MAX_ARRAY} more]`);
    return capped;
  }
  if (type === 'object') {
    if (depth >= METADATA_MAX_DEPTH) return '[max-depth]';
    // Error objects: keep only the safe projection, never the full object
    // (stacks/causes can embed request payloads).
    if (value instanceof Error) {
      return {
        message: sanitizeString(value.message || String(value), METADATA_MAX_STRING),
        code: value.code != null ? sanitizeString(String(value.code), 100) : undefined,
      };
    }
    const out = {};
    let count = 0;
    for (const [k, v] of Object.entries(value)) {
      if (count >= METADATA_MAX_KEYS) { out['[truncated-keys]'] = true; break; }
      if (isSensitiveKey(k)) { out[k] = '[REDACTED]'; count += 1; continue; }
      out[k] = sanitizeMetadataValue(v, depth + 1);
      count += 1;
    }
    return out;
  }
  return String(value);
}

/**
 * Sanitize an arbitrary metadata object into a bounded, redacted JSONB-safe
 * value (or null). Exported for tests.
 */
function sanitizeMetadata(metadata) {
  if (metadata == null || typeof metadata !== 'object') return null;
  let clean = sanitizeMetadataValue(metadata, 0);
  try {
    const json = JSON.stringify(clean);
    if (json && json.length > METADATA_MAX_JSON_BYTES) {
      clean = { truncated: true, note: `metadata exceeded ${METADATA_MAX_JSON_BYTES} bytes after sanitization` };
    }
  } catch {
    clean = { truncated: true, note: 'metadata not serializable' };
  }
  return clean;
}

function deriveEnvironment() {
  return process.env.VERCEL_ENV
    || (process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV)
    || null;
}

class OperationalEventService {
  /**
   * Record one operational event. BEST-EFFORT: never throws.
   *
   * @param {Object} opts
   * @param {string} [opts.source='app'] - 'app' | 'vercel-drain'
   * @param {string} opts.eventType - stable snake_case event class
   * @param {string} [opts.severity='error'] - info|warning|error|critical
   * @param {string} opts.summary - human-readable summary (redacted + capped here)
   * @param {string} [opts.subsystem] - emitting service/route label
   * @param {string} [opts.stage] - closed-vocabulary stage discriminator
   *   (e.g. 'virus_scan' | 'sharepoint_upload' | 'dataverse_changeset' | 'honorarium_onboard')
   * @param {boolean|null} [opts.transient] - retryability where known
   * @param {string} [opts.requestNumber] - akoya_requestnum when applicable
   * @param {Object} [opts.entityRefs] - { suggestionId?, jobId?, deliverableId?, ... }
   * @param {string} [opts.correlationId]
   * @param {string} [opts.recoveryKey] - key a later success uses to mark recovery
   * @param {string} [opts.dedupeKey] - stable fingerprint; repeats fold/reopen
   * @param {Object} [opts.metadata] - sanitized/capped here
   * @param {string} [opts.status] - explicit status override (rarely needed)
   * @param {Date|string|number} [opts.occurredAt] - event time (drain rows)
   * @param {string} [opts.environment] - override (drain rows); defaults to VERCEL_ENV
   * @returns {Promise<{id: number, folded: boolean}|null>} null on skip/duplicate/failure
   */
  static async recordEvent(opts = {}) {
    try {
      const source = SOURCES.has(opts.source) ? opts.source : 'app';
      const eventType = sanitizeShortField(opts.eventType);
      const summaryInput = opts.summary != null && String(opts.summary).trim()
        ? opts.summary
        : opts.eventType;
      if (!eventType || summaryInput == null) return null;

      const severity = SEVERITIES.has(opts.severity) ? opts.severity : 'error';
      const defaultStatus = severity === 'info' ? 'info' : 'open';
      const status = STATUSES.has(opts.status) ? opts.status : defaultStatus;
      const summary = sanitizeString(String(summaryInput), SUMMARY_MAX_CHARS);
      const subsystem = sanitizeShortField(opts.subsystem);
      const stage = sanitizeShortField(opts.stage);
      const transient = typeof opts.transient === 'boolean' ? opts.transient : null;
      const requestNumber = sanitizeShortField(opts.requestNumber);
      const correlationId = sanitizeShortField(opts.correlationId);
      const recoveryKey = canonicalizeKey(opts.recoveryKey);
      const dedupeKey = canonicalizeKey(opts.dedupeKey);
      const entityRefs = sanitizeMetadata(opts.entityRefs);
      const metadata = sanitizeMetadata(opts.metadata);
      const environment = sanitizeShortField(opts.environment) || deriveEnvironment();
      const occurredAt = opts.occurredAt != null ? new Date(opts.occurredAt) : new Date();
      const occurredAtIso = Number.isNaN(occurredAt.getTime())
        ? new Date().toISOString()
        : occurredAt.toISOString();

      if (dedupeKey && source === 'vercel-drain') {
        // Exactly-once storage for at-least-once drain deliveries.
        const result = await sql`
          INSERT INTO operational_events
            (source, environment, event_type, subsystem, severity, status, summary,
             stage, transient, request_number, entity_refs, correlation_id,
             recovery_key, dedupe_key, metadata, first_occurred_at, last_occurred_at)
          VALUES
            (${source}, ${environment}, ${eventType}, ${subsystem}, ${severity}, ${status}, ${summary},
             ${stage}, ${transient}, ${requestNumber}, ${entityRefs ? JSON.stringify(entityRefs) : null}, ${correlationId},
             ${recoveryKey}, ${dedupeKey}, ${metadata ? JSON.stringify(metadata) : null}, ${occurredAtIso}, ${occurredAtIso})
          ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
          RETURNING id
        `;
        // A true duplicate must be distinguishable from a storage FAILURE
        // (which returns null below): the drain route acks duplicates with
        // 200 but must NOT ack lost writes (Codex adversarial finding,
        // cycle 3, 2026-08-19).
        if (result.rows.length === 0) return { duplicate: true };
        return { id: result.rows[0].id, folded: false };
      }

      if (dedupeKey) {
        // App-row fold/reopen: recurrence increments the counter, refreshes
        // the latest context, and reopens a settled row.
        const result = await sql`
          INSERT INTO operational_events
            (source, environment, event_type, subsystem, severity, status, summary,
             stage, transient, request_number, entity_refs, correlation_id,
             recovery_key, dedupe_key, metadata, first_occurred_at, last_occurred_at)
          VALUES
            (${source}, ${environment}, ${eventType}, ${subsystem}, ${severity}, ${status}, ${summary},
             ${stage}, ${transient}, ${requestNumber}, ${entityRefs ? JSON.stringify(entityRefs) : null}, ${correlationId},
             ${recoveryKey}, ${dedupeKey}, ${metadata ? JSON.stringify(metadata) : null}, ${occurredAtIso}, ${occurredAtIso})
          ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET
            occurrence_count = operational_events.occurrence_count + 1,
            last_occurred_at = EXCLUDED.last_occurred_at,
            severity = EXCLUDED.severity,
            summary = EXCLUDED.summary,
            subsystem = COALESCE(EXCLUDED.subsystem, operational_events.subsystem),
            stage = COALESCE(EXCLUDED.stage, operational_events.stage),
            transient = COALESCE(EXCLUDED.transient, operational_events.transient),
            request_number = COALESCE(EXCLUDED.request_number, operational_events.request_number),
            entity_refs = COALESCE(EXCLUDED.entity_refs, operational_events.entity_refs),
            correlation_id = COALESCE(EXCLUDED.correlation_id, operational_events.correlation_id),
            recovery_key = COALESCE(EXCLUDED.recovery_key, operational_events.recovery_key),
            metadata = COALESCE(EXCLUDED.metadata, operational_events.metadata),
            status = CASE
              WHEN operational_events.status IN ('recovered', 'resolved', 'superseded')
                THEN 'open'
              ELSE operational_events.status
            END,
            status_changed_at = CASE
              WHEN operational_events.status IN ('recovered', 'resolved', 'superseded')
                THEN NOW()
              ELSE operational_events.status_changed_at
            END
          RETURNING id, (occurrence_count > 1) AS folded
        `;
        const row = result.rows[0];
        return row ? { id: row.id, folded: row.folded === true } : null;
      }

      const result = await sql`
        INSERT INTO operational_events
          (source, environment, event_type, subsystem, severity, status, summary,
           stage, transient, request_number, entity_refs, correlation_id,
           recovery_key, metadata, first_occurred_at, last_occurred_at)
        VALUES
          (${source}, ${environment}, ${eventType}, ${subsystem}, ${severity}, ${status}, ${summary},
           ${stage}, ${transient}, ${requestNumber}, ${entityRefs ? JSON.stringify(entityRefs) : null}, ${correlationId},
           ${recoveryKey}, ${metadata ? JSON.stringify(metadata) : null}, ${occurredAtIso}, ${occurredAtIso})
        RETURNING id
      `;
      return { id: result.rows[0].id, folded: false };
    } catch (error) {
      console.error('[operational-events] record failed (non-fatal):', error?.message || String(error));
      return null;
    }
  }

  /**
   * Mark all open events carrying `recoveryKey` as recovered (a later success
   * signal was observed). BEST-EFFORT: never throws; returns count (0 on failure).
   */
  static async markRecovered(recoveryKey, { note } = {}) {
    return this._settleByRecoveryKey(recoveryKey, 'recovered', note);
  }

  /**
   * Mark all open events carrying `recoveryKey` as superseded (no longer
   * applicable — e.g. the underlying job was cancelled). BEST-EFFORT.
   */
  static async markSuperseded(recoveryKey, { note } = {}) {
    return this._settleByRecoveryKey(recoveryKey, 'superseded', note);
  }

  static async _settleByRecoveryKey(recoveryKey, newStatus, note) {
    try {
      // Same canonicalization as recordEvent so recovery lookups always match
      // the stored key (identity symmetry).
      const key = canonicalizeKey(recoveryKey);
      if (!key) return 0;
      const cleanNote = note != null ? sanitizeString(String(note), SHORT_FIELD_MAX_CHARS) : null;
      const result = await sql`
        UPDATE operational_events
        SET status = ${newStatus},
            status_changed_at = NOW(),
            resolution_note = COALESCE(${cleanNote}, resolution_note)
        WHERE recovery_key = ${key} AND status = 'open'
        RETURNING id
      `;
      return result.rows.length;
    } catch (error) {
      console.error(`[operational-events] ${newStatus} mark failed (non-fatal):`, error?.message || String(error));
      return 0;
    }
  }

  /**
   * Staff resolution from the admin surface. MAY throw (route maps errors).
   * `action` ∈ 'resolve' | 'reopen'.
   *
   * Freshness precondition (Codex adversarial finding, cycle 3): a stale
   * admin list must not close a row that has since folded a NEW occurrence
   * and reopened. When the caller supplies `expectedStatus` /
   * `expectedLastOccurredAt` (from the rendered row), the update only applies
   * if they still match; on mismatch this throws `code: 'stale_state'` with
   * the row's current state attached so the route can 409 and the UI refetch.
   */
  static async setEventStatus(id, action, {
    profileId = null,
    note = null,
    expectedStatus = null,
    expectedLastOccurredAt = null,
    // `undefined` = not asserted. `null` or an ISO string = asserted: the row's
    // status_changed_at must be IS NOT DISTINCT FROM it. This is what closes
    // the ABA hole (open → resolved → open keeps status AND last_occurred_at).
    expectedStatusChangedAt = undefined,
  } = {}) {
    const eventId = Number(id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      const err = new Error('invalid event id');
      err.code = 'invalid_id';
      throw err;
    }
    if (action !== 'resolve' && action !== 'reopen') {
      const err = new Error('invalid action');
      err.code = 'invalid_action';
      throw err;
    }
    const newStatus = action === 'resolve' ? 'resolved' : 'open';
    const cleanNote = note != null ? sanitizeString(String(note), SHORT_FIELD_MAX_CHARS) : null;
    let expectedIso = null;
    if (expectedLastOccurredAt != null) {
      const parsed = new Date(expectedLastOccurredAt);
      if (Number.isNaN(parsed.getTime())) {
        // Malformed freshness timestamp is a caller error (400), not a 500.
        const err = new Error('invalid expectedLastOccurredAt');
        err.code = 'invalid_action';
        throw err;
      }
      expectedIso = parsed.toISOString();
    }
    const assertStatusChanged = expectedStatusChangedAt !== undefined;
    let expectedStatusChangedIso = null;
    if (assertStatusChanged && expectedStatusChangedAt !== null) {
      const parsed = new Date(expectedStatusChangedAt);
      if (Number.isNaN(parsed.getTime())) {
        const err = new Error('invalid expectedStatusChangedAt');
        err.code = 'invalid_action';
        throw err;
      }
      expectedStatusChangedIso = parsed.toISOString();
    }
    const result = await sql`
      UPDATE operational_events
      SET status = ${newStatus},
          status_changed_at = NOW(),
          resolved_by = CASE WHEN ${newStatus} = 'resolved' THEN ${profileId} ELSE resolved_by END,
          resolution_note = COALESCE(${cleanNote}, resolution_note)
      WHERE id = ${eventId}
        AND status <> 'info'
        AND (${expectedStatus}::text IS NULL OR status = ${expectedStatus})
        AND (${expectedIso}::timestamptz IS NULL OR last_occurred_at = ${expectedIso})
        AND (${assertStatusChanged}::boolean = false
             OR status_changed_at IS NOT DISTINCT FROM ${expectedStatusChangedIso}::timestamptz)
      RETURNING id, status
    `;
    if (result.rows[0]) return result.rows[0];

    // Distinguish "no such resolvable row" (404) from "row moved on" (409).
    const current = await sql`
      SELECT id, status, last_occurred_at, status_changed_at, occurrence_count
      FROM operational_events
      WHERE id = ${eventId} AND status <> 'info'
    `;
    if (!current.rows[0]) return null;
    const err = new Error('event changed since it was rendered');
    err.code = 'stale_state';
    err.current = current.rows[0];
    throw err;
  }

  /**
   * Batch form of setEventStatus for the admin "Resolve all shown" control.
   * Each row keeps its OWN freshness precondition, so a list that was
   * rendered before one row folded a new occurrence only skips that row
   * (reported as `stale`) — it never blind-closes it. Rows are processed
   * sequentially: the batch is bounded by the admin list limit (500) and a
   * single-row UPDATE is cheap, so this stays well inside the route budget
   * without contending for pool connections.
   *
   * Partial success is the contract, not a failure mode: the counts tell the
   * caller exactly what happened per row and the client refetches the list.
   * Throws only for caller errors (`invalid_action`, `batch_too_large`).
   *
   * @param {Array<{id:number|string, expectedStatus:string, expectedLastOccurredAt:string, expectedStatusChangedAt:string|null}>} items — all three preconditions REQUIRED per item; incomplete items land in `invalid`
   * @param {'resolve'|'reopen'} action
   * @returns {Promise<{updated:number[], stale:number[], notFound:number[], invalid:number[]}>}
   */
  static async setEventStatuses(items, action, { profileId = null, note = null } = {}) {
    if (action !== 'resolve' && action !== 'reopen') {
      const err = new Error('invalid action');
      err.code = 'invalid_action';
      throw err;
    }
    const list = Array.isArray(items) ? items : [];
    if (list.length > BULK_STATUS_MAX_ITEMS) {
      const err = new Error(`too many events in one batch (max ${BULK_STATUS_MAX_ITEMS})`);
      err.code = 'batch_too_large';
      throw err;
    }
    const outcome = { updated: [], stale: [], notFound: [], invalid: [] };
    for (const item of list) {
      const id = item && typeof item === 'object' ? item.id : item;
      // A batch item without its full freshness triple is refused, not
      // applied unguarded: the whole point of the batch is that an operator
      // resolved what they SAW, and what they saw is the triple.
      const complete = item && typeof item === 'object'
        && typeof item.expectedStatus === 'string' && item.expectedStatus
        && item.expectedLastOccurredAt != null
        && Object.prototype.hasOwnProperty.call(item, 'expectedStatusChangedAt');
      if (!complete) {
        outcome.invalid.push(Number(id));
        continue;
      }
      try {
        const row = await this.setEventStatus(id, action, {
          profileId,
          note,
          expectedStatus: item.expectedStatus,
          expectedLastOccurredAt: item.expectedLastOccurredAt,
          expectedStatusChangedAt: item.expectedStatusChangedAt,
        });
        if (row) outcome.updated.push(row.id);
        else outcome.notFound.push(Number(id));
      } catch (error) {
        if (error?.code === 'stale_state') outcome.stale.push(Number(id));
        else if (error?.code === 'invalid_id' || error?.code === 'invalid_action') outcome.invalid.push(Number(id));
        else throw error;
      }
    }
    return outcome;
  }

  /**
   * Bounded admin query. MAY throw.
   *
   * @param {Object} filters
   * @param {string} [filters.status] - open|recovered|resolved|superseded|info
   * @param {string} [filters.severity]
   * @param {string} [filters.source]
   * @param {string} [filters.eventType]
   * @param {string} [filters.search] - matches request_number, correlation_id,
   *   summary, event_type, or entity_refs text (ILIKE, bounded)
   * @param {number} [filters.hours=168] - lookback window over last_occurred_at (max 2160 = 90d)
   * @param {number} [filters.limit=100] - max 500
   */
  static async queryEvents({ status, severity, source, eventType, search, hours, limit } = {}) {
    const clauses = [];
    const values = [];
    const add = (fragment, value) => {
      values.push(value);
      clauses.push(fragment.replace('?', `$${values.length}`));
    };

    const boundedHours = Math.min(Math.max(parseInt(hours, 10) || 168, 1), 2160);
    add('last_occurred_at > NOW() - MAKE_INTERVAL(hours => ?)', boundedHours);
    if (status && STATUSES.has(status)) add('status = ?', status);
    if (severity && SEVERITIES.has(severity)) add('severity = ?', severity);
    if (source && SOURCES.has(source)) add('source = ?', source);
    if (eventType && String(eventType).trim()) add('event_type = ?', String(eventType).trim().slice(0, 200));
    if (search && String(search).trim()) {
      const term = `%${String(search).trim().slice(0, 100)}%`;
      values.push(term);
      const p = `$${values.length}`;
      clauses.push(`(request_number ILIKE ${p} OR correlation_id ILIKE ${p} OR summary ILIKE ${p} OR event_type ILIKE ${p} OR entity_refs::text ILIKE ${p})`);
    }

    const boundedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    values.push(boundedLimit);

    const text = `
      SELECT id, source, environment, event_type, subsystem, severity, status,
             summary, stage, transient, request_number, entity_refs,
             correlation_id, recovery_key, metadata, occurrence_count,
             first_occurred_at, last_occurred_at, recorded_at,
             status_changed_at, resolved_by, resolution_note
      FROM operational_events
      WHERE ${clauses.join(' AND ')}
      ORDER BY last_occurred_at DESC
      LIMIT $${values.length}
    `;
    const result = await sql.query(text, values);
    return result.rows;
  }

  /** Summary counts for the admin header chips. MAY throw. */
  static async getEventSummary({ hours } = {}) {
    const boundedHours = Math.min(Math.max(parseInt(hours, 10) || 168, 1), 2160);
    const result = await sql`
      SELECT status, severity, COUNT(*)::int AS count
      FROM operational_events
      WHERE last_occurred_at > NOW() - MAKE_INTERVAL(hours => ${boundedHours})
      GROUP BY status, severity
    `;
    return result.rows;
  }
}

module.exports = OperationalEventService;
module.exports.sanitizeMetadata = sanitizeMetadata;
module.exports._internal = { sanitizeString, isSensitiveKey, canonicalizeKey };
