// @ts-check
/**
 * Dynamics 365 Service
 *
 * Handles authentication, schema discovery, and data operations
 * against the Dataverse Web API v9.2 (OData).
 *
 * Auth: Client credentials flow (server-to-server).
 * Env vars: DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET
 */

import { applyRawOutputRetention } from '../utils/ai-run-retention.js';
import { buildNoResponseError } from '../utils/service-error.js';
import { buildHeaders } from './dynamics/http.js';
import { getAccessToken, resetTokenCache } from './dynamics/auth.js';
import { resolveLogicalName, checkRestriction } from './dynamics/restrictions.js';
import { processAnnotations } from './dynamics/annotations.js';
import {
  getEntityDefinitions,
  getEntityAttributes,
  getEntityRelationships,
  resolveEntitySetName,
  getPrimaryIdAttribute,
  getEntityKey,
  resetSchemaCache,
} from './dynamics/schema.js';
import {
  queryRecords,
  getRecord,
  countRecords,
  aggregateRecords,
  queryAllRecords,
  searchRecords,
} from './dynamics/read-ops.js';
import {
  _withCallerId,
  _writeFetch,
  createRecord,
  updateRecord,
  updateIfEmpty,
  deleteRecord,
  disassociate,
} from './dynamics/write-core.js';
import { executeChangeset } from './dynamics/changeset.js';
import {
  resolveSystemUser,
  createEmailActivity,
  addEmailAttachment,
  sendEmail,
  createAndSendEmail,
} from './dynamics/email.js';

// Module-level caches: tokenCache moved to ./dynamics/auth.js (Stage 1),
// schemaCache moved to ./dynamics/schema.js (Stage 4). The facade now delegates
// all schema + read operations to those modules.

/**
 * Branded Dataverse record id (see lib/utils/guid.js). Every facade selector
 * that interpolates a record id into a key predicate `${entitySet}(${recordId})`
 * requires the branded `Guid`, not `string` — a raw request-input string does
 * not type-check until narrowed through `isGuid` at the route edge. Server-
 * derived ids (read back off a fetched row) are cast at the read site.
 * @typedef {import('../utils/guid.js').Guid} Guid
 */

export class DynamicsService {
  // ───────── Auth ─────────

  /**
   * Get an access token via client credentials grant (delegates to
   * ./dynamics/auth.js — Stage 1). Kept as a static so the ~15 internal
   * `this.getAccessToken()` call sites and the test spies on
   * `DynamicsService.getAccessToken` continue to work unchanged.
   *
   * SECURITY: The returned token grants service-principal-level access to
   * Dynamics 365. It must NEVER be logged to console, included in error
   * messages, returned in API responses, sent via SSE, stored in the
   * database, or passed to third-party APIs (including Claude).
   * See .semgrep/token-audit.yaml for automated enforcement.
   */
  static async getAccessToken() {
    return getAccessToken();
  }

  // ───────── Headers ─────────

  /** @param {string} token */
  static buildHeaders(token) {
    return buildHeaders(token);
  }

  // ───────── Write Path Primitives ─────────
  //
  // _withCallerId (MSCRMCallerID impersonation header) + _writeFetch (write
  // fetch with 403 privilege-intersection fallback) moved to
  // ./dynamics/write-core.js — Stage 6. The facade keeps thin wrappers for
  // exact-surface parity; the changeset/email clusters reach them via
  // `svc._writeFetch` / `svc._withCallerId` (C12).

  /**
   * @param {Record<string, string>} headers
   * @param {string|null|undefined} actingUserSystemId
   */
  static _withCallerId(headers, actingUserSystemId) {
    return _withCallerId(headers, actingUserSystemId);
  }

  /**
   * @param {string} url
   * @param {{ method?: string, headers?: Record<string, string>, body?: string }} init
   * @param {string|null|undefined} actingUserSystemId
   * @param {{ noFallback?: boolean }} [options]
   */
  static _writeFetch(url, init, actingUserSystemId, options) {
    return _writeFetch(url, init, actingUserSystemId, options);
  }

  // ───────── Restrictions ─────────
  //
  // resolveLogicalName + checkRestriction (and the private $expand parsers)
  // moved to ./dynamics/restrictions.js — Stage 2. The facade keeps thin
  // delegating wrappers so internal `this.` calls and external
  // `DynamicsService.` calls are unchanged.

  /** @param {string} entitySet */
  static resolveLogicalName(entitySet) {
    return resolveLogicalName(entitySet);
  }

  /**
   * @param {string} tableName
   * @param {string} [selectFields]
   * @param {string} [expandParam]
   * @param {string} [requestId]
   */
  static checkRestriction(tableName, selectFields, expandParam, requestId) {
    return checkRestriction(tableName, selectFields, expandParam, requestId);
  }

  // ───────── Schema Discovery ─────────
  //
  // getEntityDefinitions / getEntityAttributes / getEntityRelationships (plus
  // resolveEntitySetName / getPrimaryIdAttribute / getEntityKey below, the
  // private filterEntities, and the schemaCache state) moved to
  // ./dynamics/schema.js — Stage 4. The facade keeps thin delegating wrappers
  // passing `this` as the svc receiver (C1), so internal `this.` calls and
  // external `DynamicsService.` calls (and their test spies) are unchanged.

  /** @param {string} [searchTerm] */
  static getEntityDefinitions(searchTerm) {
    return getEntityDefinitions(this, searchTerm);
  }

  /** @param {string} tableName */
  static getEntityAttributes(tableName) {
    return getEntityAttributes(this, tableName);
  }

  /** @param {string} tableName */
  static getEntityRelationships(tableName) {
    return getEntityRelationships(this, tableName);
  }

  // ───────── Read Operations ─────────
  //
  // queryRecords / getRecord / countRecords / aggregateRecords /
  // queryAllRecords / searchRecords moved to ./dynamics/read-ops.js — Stage 5.
  // Thin delegating wrappers pass `this` as the svc receiver (C1); the 85+ spy
  // sites on these method names continue to work through the facade surface.

  /**
   * @param {string} entitySet
   * @param {{select?:string, filter?:string, orderby?:string, top?:number, expand?:string}} [options]
   */
  static queryRecords(entitySet, options) {
    return queryRecords(this, entitySet, options);
  }

  /**
   * Get a single record by ID. `recordId` interpolates raw into the key
   * predicate `${entitySet}(${recordId})`, so it requires the branded {@link Guid}
   * — narrow client input through `isGuid` at the route edge first.
   * @param {string} entitySet
   * @param {Guid} recordId
   * @param {{select?:string, expand?:string}} [options]
   */
  static getRecord(entitySet, recordId, options) {
    return getRecord(this, entitySet, recordId, options);
  }

  /**
   * @param {string} entitySet
   * @param {string} [filter]
   */
  static countRecords(entitySet, filter) {
    return countRecords(this, entitySet, filter);
  }

  /**
   * @param {string} entitySet
   * @param {{field?:string, operation?:string, filter?:string, groupBy?:string}} [options]
   */
  static aggregateRecords(entitySet, options) {
    return aggregateRecords(this, entitySet, options);
  }

  /**
   * @param {string} entitySet
   * @param {{select?:string, filter?:string, orderby?:string}} [options]
   */
  static queryAllRecords(entitySet, options) {
    return queryAllRecords(this, entitySet, options);
  }

  /**
   * @param {string} search
   * @param {{entities?:string[], top?:number, filter?:string}} [options]
   */
  static searchRecords(search, options) {
    return searchRecords(this, search, options);
  }

  // ───────── Write Operations ─────────
  //
  // Write access on the service principal was granted 2026-04-14 (see
  // docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md). Scope at time of writing:
  //   - prvUpdate on akoya_request
  //   - prvCreate + prvUpdate on wmkf_ai_run
  //   - Activity privileges (email create/write/read + prvSendAsUser)
  // Writes to other tables (e.g., annotation/note) will 403.

  // createRecord / updateRecord / updateIfEmpty / deleteRecord / disassociate
  // moved to ./dynamics/write-core.js — Stage 6 (Checkpoint C). Thin delegating
  // wrappers pass `this` as the svc receiver (C1) so internal `this.` calls,
  // external `DynamicsService.` calls, and their test spies are unchanged. The
  // four fail-closed `assertTrustedDalContext` sites (C2) live inside the moved
  // implementations, not in these wrappers.

  /**
   * Create a record. Uses Prefer: return=representation so the created row
   * comes back in the response — callers often need the new ID.
   * @param {string} entitySet - e.g. 'wmkf_ai_runs', 'akoya_requests'
   * @param {object} data - Field payload. Lookups use `<nav>@odata.bind`.
   * @param {{ actingUserSystemId?: string|null, noFallback?: boolean }} [options]
   * @returns {Promise<object>} The created record.
   */
  static createRecord(entitySet, data, options) {
    return createRecord(this, entitySet, data, options);
  }

  /**
   * Update a record by ID (PATCH). Returns void on success (204).
   * @param {string} entitySet
   * @param {Guid} recordId - branded record id; interpolated into the key predicate
   * @param {object} data
   * @param {{ ifMatch?: string, actingUserSystemId?: string|null, noFallback?: boolean }} [options]
   * @returns {Promise<void>}
   */
  static updateRecord(entitySet, recordId, data, options) {
    return updateRecord(this, entitySet, recordId, data, options);
  }

  /**
   * Write a value to a single field only when the field is currently empty
   * (unless `overwrite: true`). ETag-guarded against concurrent edits; returns
   * a discriminated result — see write-core.js for the full outcome contract.
   * @param {string} entitySet
   * @param {Guid} recordId - branded record id (flows into `getRecord`/`updateRecord`)
   * @param {string} fieldName - Dataverse field to write (e.g. 'wmkf_ai_summary')
   * @param {string|number|boolean} value - value to write
   * @param {{ overwrite?: boolean, extraSelect?: string[], actingUserSystemId?: string|null }} [options]
   */
  static updateIfEmpty(entitySet, recordId, fieldName, value, options) {
    return updateIfEmpty(this, entitySet, recordId, fieldName, value, options);
  }

  /**
   * Delete a record by ID. Returns void on success (204).
   * @param {string} entitySet
   * @param {Guid} recordId - branded record id; interpolated into the key predicate
   * @param {{ actingUserSystemId?: string|null, ifMatch?: string }} [options]
   * @returns {Promise<void>}
   */
  static deleteRecord(entitySet, recordId, options) {
    return deleteRecord(this, entitySet, recordId, options);
  }

  /**
   * Clear a single-valued navigation property (NULL a lookup) by deleting its
   * $ref. A 404 is treated as idempotent success.
   * @param {string} entitySet
   * @param {Guid} recordId - branded record id of the referencing row
   * @param {string} navProperty - single-valued nav prop (e.g. 'wmkf_PotentialReviewer1')
   * @param {{ actingUserSystemId?: string|null }} [options]
   */
  static disassociate(entitySet, recordId, navProperty, options) {
    return disassociate(this, entitySet, recordId, navProperty, options);
  }

  // ───────── Atomic Multi-Row Writes ($batch changeset) ─────────
  //
  // executeChangeset + the 8 module-private $batch builders/parsers moved to
  // ./dynamics/changeset.js — Stage 7 (Checkpoint D). Thin delegating wrapper
  // passes `this` as the svc receiver (C1) so the 77 external
  // `DynamicsService.executeChangeset` refs and their spies are unchanged. The
  // validate-then-assert order (C2) and the fail-closed atomic-commit guard
  // (C11) live inside the moved implementation.

  /**
   * Execute several create/update/delete operations in ONE atomic Dataverse
   * changeset. Either every operation commits or none do (all-or-nothing).
   * See changeset.js for the full URL/body/If-Match contract and the fail-closed
   * commit-confirmation semantics.
   * @param {Array<{method:'POST'|'PATCH'|'DELETE', url:string, body?:object, ifMatch?:string}>} operations
   * @param {{ actingUserSystemId?: string }} [options]
   * @returns {Promise<{ ok: true, operations: Array<{contentId:number|null, status:number, body:object|null}> }>}
   */
  static executeChangeset(operations, options) {
    return executeChangeset(this, operations, options);
  }

  // ───────── AI Run Logging ─────────

  /**
   * Choice → numeric mapping for wmkf_ai_run Picklist fields.
   * See docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md. Numeric values are the
   * contract — Dynamics API does not accept labels.
   */
  static AI_RUN_TASK_TYPES = Object.freeze({
    summary: 682090000,
    report: 682090001,
    'check-in': 682090002,
    pd_assignment: 682090003,
  });

  static AI_RUN_STATUSES = Object.freeze({
    completed: 682090000,
    failed: 682090001,
    needs_review: 682090002,
  });

  /**
   * Write a row to the wmkf_ai_run audit/replay table. Non-critical — callers
   * should treat failures as logged warnings, not user-visible errors. The AI
   * produced its output before this runs; the run log is supplementary.
   *
   * @param {object} opts
   * @param {string} opts.requestGuid - akoya_request GUID this run was for
   * @param {string} opts.taskType - One of AI_RUN_TASK_TYPES keys
   * @param {string} opts.model - Claude model ID (e.g. 'claude-sonnet-4')
   * @param {number} [opts.promptVersion] - Integer; bumped on prompt text changes
   * @param {string} opts.status - One of AI_RUN_STATUSES keys
   * @param {object|string} [opts.rawOutput] - Full structured payload; stringified if object unless rawOutputRetention narrows it
   * @param {string|object} [opts.rawOutputRetention='full'] - full | hash | none
   * @param {string} [opts.notes] - Failure messages / retry context
   * @param {string} [opts.actingUserSystemId] - When set, the run row is
   *   attributed to the staff member rather than the service principal.
   * @returns {Promise<{ runId: string, runNum: string }>} IDs of the created row
   */
  static async logAiRun({ requestGuid, taskType, model, promptVersion, status, rawOutput, rawOutputRetention = 'full', notes, actingUserSystemId }) {
    if (!requestGuid) throw new Error('logAiRun: requestGuid is required');

    const taskTypeValue = /** @type {Record<string, number>} */ (this.AI_RUN_TASK_TYPES)[taskType];
    if (taskTypeValue === undefined) {
      throw new Error(`logAiRun: unknown taskType "${taskType}" (expected one of: ${Object.keys(this.AI_RUN_TASK_TYPES).join(', ')})`);
    }

    const statusValue = /** @type {Record<string, number>} */ (this.AI_RUN_STATUSES)[status];
    if (statusValue === undefined) {
      throw new Error(`logAiRun: unknown status "${status}" (expected one of: ${Object.keys(this.AI_RUN_STATUSES).join(', ')})`);
    }

    // Navigation property name is wmkf_ai_Request (capitalized R) — discovered
    // via EntityDefinitions expand on ManyToOneRelationships. Case matters.
    /** @type {Record<string, any>} */
    const payload = {
      'wmkf_ai_Request@odata.bind': `/akoya_requests(${requestGuid})`,
      wmkf_ai_tasktype: taskTypeValue,
      wmkf_ai_status: statusValue,
    };
    if (model) payload.wmkf_ai_model = String(model).slice(0, 64);
    if (promptVersion !== undefined && promptVersion !== null) payload.wmkf_ai_promptversion = Number(promptVersion);
    if (rawOutput !== undefined && rawOutput !== null) {
      // wmkf_ai_rawoutput cap raised to 1,000,000 chars (2026-04-14, Connor).
      // Truncation here is a safety valve only — real payloads are 5-15k.
      const retainedRawOutput = applyRawOutputRetention(rawOutput, /** @type {any} */ (rawOutputRetention));
      const serialized = typeof retainedRawOutput === 'string' ? retainedRawOutput : JSON.stringify(retainedRawOutput);
      payload.wmkf_ai_rawoutput = this._truncateForMemo(serialized, 1_000_000);
    }
    if (notes) payload.wmkf_ai_notes = this._truncateForMemo(String(notes), 2000);

    const created = /** @type {Record<string, any>} */ (await this.createRecord('wmkf_ai_runs', payload, { actingUserSystemId }));
    return {
      runId: created.wmkf_ai_runid,
      runNum: created.wmkf_ai_runnum,
    };
  }

  /**
   * Truncate a string to fit in a Dataverse Memo field. Appends a visible
   * marker so readers can tell the content was cut off.
   */
  /**
   * @param {string} s
   * @param {number} maxChars
   */
  static _truncateForMemo(s, maxChars) {
    if (!s || s.length <= maxChars) return s;
    const marker = `\n…[truncated ${s.length - maxChars + 0} chars]`;
    return s.slice(0, maxChars - marker.length) + marker;
  }

  // ───────── Email Operations ─────────
  //
  // resolveSystemUser / createEmailActivity / addEmailAttachment / sendEmail /
  // createAndSendEmail moved to ./dynamics/email.js — Stage 8 (Checkpoint E).
  // Thin delegating wrappers pass `this` as the svc receiver (C1) so internal
  // `this.` calls, external `DynamicsService.` calls, and their test spies are
  // unchanged. The 3 email-write asserts (C2) live inside the moved
  // implementations — these methods are exempt from the static access-layer
  // gate (NON_ENTITY_TRANSPORT_METHODS), so those runtime asserts are the ONLY
  // enforcement on this surface.

  /**
   * Resolve an email address to a Dynamics system user ID.
   * @param {string} email
   */
  static resolveSystemUser(email) {
    return resolveSystemUser(this, email);
  }

  /**
   * Create an email activity record in Dynamics CRM.
   * @param {{ subject: string, body: string, from: string, to: string|string[],
   *   cc?: string|string[], regardingId?: string, regardingType?: string,
   *   actingUserSystemId?: string|null, noFallback?: boolean }} params
   * @returns {Promise<string>} The created email activity ID
   */
  static createEmailActivity(params) {
    return createEmailActivity(this, params);
  }

  /**
   * Add an attachment to an email activity.
   * @param {string} emailId - Email activity ID
   * @param {{ filename: string, contentType: string, content: Buffer|string,
   *   actingUserSystemId?: string|null, noFallback?: boolean }} attachment
   */
  static addEmailAttachment(emailId, attachment) {
    return addEmailAttachment(this, emailId, attachment);
  }

  /**
   * Send an email activity via the Dynamics SendEmail action.
   * @param {string} emailId - Email activity ID to send
   * @param {{ actingUserSystemId?: string|null, noFallback?: boolean }} [options]
   */
  static sendEmail(emailId, options) {
    return sendEmail(this, emailId, options);
  }

  /**
   * Create, optionally attach files, and send an email in one call.
   * @param {{ subject: string, body: string, from: string, to: string|string[],
   *   cc?: string|string[], regardingId?: string, regardingType?: string,
   *   attachments?: any[], actingUserSystemId?: string|null, noFallback?: boolean }} options
   * @returns {Promise<{ emailId: string }>} The sent email activity ID
   */
  static createAndSendEmail(options) {
    return createAndSendEmail(this, options);
  }

  // ───────── Helpers ─────────

  // resolveEntitySetName / getPrimaryIdAttribute / getEntityKey moved to
  // ./dynamics/schema.js — Stage 4. Thin delegating wrappers pass `this` as the
  // svc receiver (C1) so internal `this.` and external `DynamicsService.` calls
  // (and test spies) are unchanged.

  /** @param {string} logicalName */
  static resolveEntitySetName(logicalName) {
    return resolveEntitySetName(this, logicalName);
  }

  /** @param {string} entitySet */
  static getPrimaryIdAttribute(entitySet) {
    return getPrimaryIdAttribute(this, entitySet);
  }

  // processAnnotations moved to ./dynamics/annotations.js — Stage 3. Thin
  // delegating wrapper so internal `this.` and external `DynamicsService.`
  // calls are unchanged.
  /** @param {any} record */
  static processAnnotations(record) {
    return processAnnotations(record);
  }

  /**
   * @param {string} entityLogicalName
   * @param {string} keyLogicalName
   */
  static getEntityKey(entityLogicalName, keyLogicalName) {
    return getEntityKey(this, entityLogicalName, keyLogicalName);
  }

  /**
   * Clear all caches (useful for testing / admin reset). Delegates to the
   * owner-module reset functions (Q3 seam): token cache in ./dynamics/auth.js,
   * schema cache in ./dynamics/schema.js.
   */
  static clearCaches() {
    resetTokenCache();
    resetSchemaCache();
  }
}
