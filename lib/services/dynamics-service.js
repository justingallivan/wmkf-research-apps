/**
 * Dynamics 365 Service
 *
 * Handles authentication, schema discovery, and data operations
 * against the Dataverse Web API v9.2 (OData).
 *
 * Auth: Client credentials flow (server-to-server).
 * Env vars: DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET
 */

import { randomUUID } from 'crypto';
import { assertTrustedDalContext } from './dynamics-context.js';
import { applyRawOutputRetention } from '../utils/ai-run-retention.js';
import { buildServiceError, buildNoResponseError } from '../utils/service-error.js';
import { API_TIMEOUT } from './dynamics/constants.js';
import { buildHeaders, fetchWithTimeout } from './dynamics/http.js';
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

// Module-level caches: tokenCache moved to ./dynamics/auth.js (Stage 1),
// schemaCache moved to ./dynamics/schema.js (Stage 4). The facade now delegates
// all schema + read operations to those modules.

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

  static buildHeaders(token) {
    return buildHeaders(token);
  }

  // Write paths only. Adding MSCRMCallerID to reads would impersonate the user
  // for security-role evaluation, breaking callers whose linked Dynamics user
  // has narrower privileges than the service principal. Writes are the goal —
  // attribution on createdby/modifiedby/audit history.
  //
  // Important: Dataverse impersonation runs under the *intersection* of the app
  // user's privileges and the impersonated user's privileges. A staff role
  // missing a single table-level write privilege (e.g. Update on
  // wmkf_ai_run) will 403 even though the app registration has it. To ship
  // safely we:
  //   1. Gate the feature behind DYNAMICS_IMPERSONATION_ENABLED so admins
  //      can flip it per-environment after a privilege audit.
  //   2. Catch 403s from impersonated writes in _writeFetch and retry once
  //      without the header (logs a warning so the missing privilege is
  //      visible). The user's request still succeeds; attribution falls
  //      back to the service principal for that one call.
  static _withCallerId(headers, actingUserSystemId) {
    if (actingUserSystemId && process.env.DYNAMICS_IMPERSONATION_ENABLED === 'true') {
      headers.MSCRMCallerID = actingUserSystemId;
    }
    return headers;
  }

  /**
   * Write-path fetch with automatic privilege-intersection fallback.
   *
   * If the request has an MSCRMCallerID header and Dataverse responds 403,
   * retry once without the header so the write still lands as the service
   * principal. Emits a structured warning so the missing privilege is
   * actionable (telemetry, not silence). Other failure modes (4xx/5xx,
   * timeouts) bubble unchanged.
   *
   * @param {string} url
   * @param {object} init - fetch init; init.headers must already include or
   *   exclude MSCRMCallerID per _withCallerId.
   * @param {string|null} actingUserSystemId - the systemuserid attempted, used
   *   for the warning. Pass null when no impersonation was attempted.
   */
  static async _writeFetch(url, init, actingUserSystemId, { noFallback = false } = {}) {
    let resp = await fetchWithTimeout(url, init, API_TIMEOUT);
    const triedImpersonation = !!(actingUserSystemId && init.headers?.MSCRMCallerID);
    if (resp.status === 403 && triedImpersonation) {
      if (noFallback) return resp;
      const errBody = await resp.text().catch(() => '');
      console.warn(
        `[DynamicsService] Impersonated write rejected (acting=${actingUserSystemId}, ` +
        `url=${url}). Retrying as service principal. Body: ${errBody.slice(0, 300)}`
      );
      const fallbackHeaders = { ...init.headers };
      delete fallbackHeaders.MSCRMCallerID;
      resp = await fetchWithTimeout(url, { ...init, headers: fallbackHeaders }, API_TIMEOUT);
    }
    return resp;
  }

  // ───────── Restrictions ─────────
  //
  // resolveLogicalName + checkRestriction (and the private $expand parsers)
  // moved to ./dynamics/restrictions.js — Stage 2. The facade keeps thin
  // delegating wrappers so internal `this.` calls and external
  // `DynamicsService.` calls are unchanged.

  static resolveLogicalName(entitySet) {
    return resolveLogicalName(entitySet);
  }

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

  static getEntityDefinitions(...args) {
    return getEntityDefinitions(this, ...args);
  }

  static getEntityAttributes(...args) {
    return getEntityAttributes(this, ...args);
  }

  static getEntityRelationships(...args) {
    return getEntityRelationships(this, ...args);
  }

  // ───────── Read Operations ─────────
  //
  // queryRecords / getRecord / countRecords / aggregateRecords /
  // queryAllRecords / searchRecords moved to ./dynamics/read-ops.js — Stage 5.
  // Thin delegating wrappers pass `this` as the svc receiver (C1); the 85+ spy
  // sites on these method names continue to work through the facade surface.

  static queryRecords(...args) {
    return queryRecords(this, ...args);
  }

  static getRecord(...args) {
    return getRecord(this, ...args);
  }

  static countRecords(...args) {
    return countRecords(this, ...args);
  }

  static aggregateRecords(...args) {
    return aggregateRecords(this, ...args);
  }

  static queryAllRecords(...args) {
    return queryAllRecords(this, ...args);
  }

  static searchRecords(...args) {
    return searchRecords(this, ...args);
  }

  // ───────── Write Operations ─────────
  //
  // Write access on the service principal was granted 2026-04-14 (see
  // docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md). Scope at time of writing:
  //   - prvUpdate on akoya_request
  //   - prvCreate + prvUpdate on wmkf_ai_run
  //   - Activity privileges (email create/write/read + prvSendAsUser)
  // Writes to other tables (e.g., annotation/note) will 403.

  /**
   * Create a record. Uses Prefer: return=representation so the created row
   * comes back in the response — callers often need the new ID.
   *
   * @param {string} entitySet - e.g. 'wmkf_ai_runs', 'akoya_requests'
   * @param {object} data - Field payload. Lookups use `<nav>@odata.bind`.
   * @param {object} [options]
   * @param {string} [options.actingUserSystemId] - When set, sends
   *   `MSCRMCallerID` so Dataverse records the acting staff member on
   *   `createdby` / audit history. Plumbed from the session by user-initiated
   *   API routes; null for unattended writes (cron, external-token flows).
   * @returns {Promise<object>} The created record.
   */
  static async createRecord(entitySet, data, { actingUserSystemId, noFallback = false } = {}) {
    assertTrustedDalContext('DynamicsService.createRecord');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}`;

    const resp = await this._writeFetch(url, {
      method: 'POST',
      headers: this._withCallerId({
        ...this.buildHeaders(token),
        Prefer: 'return=representation',
      }, actingUserSystemId),
      body: JSON.stringify(data),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw buildServiceError('dataverse', resp, errorBody);
    }

    return this.processAnnotations(await resp.json());
  }

  /**
   * Update a record by ID (PATCH). Returns void on success (204).
   *
   * @param {string} entitySet
   * @param {string} recordId - GUID
   * @param {object} data
   * @param {object} [options]
   * @param {string} [options.ifMatch] - ETag from a prior getRecord (`record._etag`).
   *   When supplied, Dataverse rejects the PATCH with 412 if the row has been
   *   modified since the read. A thrown Error's `.status` is set to 412 in that
   *   case so callers can distinguish concurrent-edit from other failures.
   * @param {string} [options.actingUserSystemId] - When set, sends
   *   `MSCRMCallerID` so `modifiedby` reflects the acting staff member.
   * @returns {Promise<void>}
   */
  static async updateRecord(entitySet, recordId, data, { ifMatch, actingUserSystemId, noFallback = false } = {}) {
    assertTrustedDalContext('DynamicsService.updateRecord');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})`;

    const headers = this._withCallerId(this.buildHeaders(token), actingUserSystemId);
    if (ifMatch) headers['If-Match'] = ifMatch;

    const resp = await this._writeFetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      // 412-aware behavior preserved: buildServiceError sets .status; callers
      // that branch on err.status === 412 (concurrent-edit detection) continue
      // to work. buildServiceError also adds .isTransient and Dataverse code/
      // message — purely additive vs. the pre-P1 throw.
      throw buildServiceError('dataverse', resp, errorBody);
    }
  }

  /**
   * Write a value to a single field only when the field is currently empty —
   * unless `overwrite: true` is set. Uses the M1 ETag plumbing so the write
   * is safe against concurrent edits: if the row changes between the
   * preflight read and the PATCH, the PATCH fails with 412 and we surface
   * that as `{ ok: false, reason: 'conflict' }` instead of clobbering.
   *
   * Returns a discriminated object so callers can translate to HTTP
   * responses themselves (some want 409, some want 200 + a flag):
   *
   *   { ok: true, written: true }                         — field was empty, write succeeded
   *   { ok: true, written: false, reason: 'overwrote' }   — field was non-empty, overwrite=true, write succeeded
   *   { ok: false, reason: 'already-populated', existing, modifiedOn }
   *   { ok: false, reason: 'conflict' }                   — 412 from Dataverse (race)
   *   { ok: false, reason: 'writeback_failed', error }    — any other failure
   *
   * @param {string} entitySet
   * @param {string} recordId - GUID
   * @param {string} fieldName - Dataverse field to write (e.g. 'wmkf_ai_summary')
   * @param {string|number|boolean} value - value to write
   * @param {object} [options]
   * @param {boolean} [options.overwrite=false]
   * @param {string[]} [options.extraSelect=['modifiedon']] - extra fields to return in `existing`
   * @param {string} [options.actingUserSystemId] - Pass-through to `updateRecord`.
   */
  static async updateIfEmpty(entitySet, recordId, fieldName, value, { overwrite = false, extraSelect = ['modifiedon'], actingUserSystemId } = {}) {
    const selectFields = Array.from(new Set([fieldName, ...extraSelect])).join(',');

    let existing;
    try {
      existing = await this.getRecord(entitySet, recordId, { select: selectFields });
    } catch (err) {
      return { ok: false, reason: 'writeback_failed', error: err };
    }

    const current = (existing?.[fieldName] ?? '');
    const isEmpty = current === '' || current === null || current === undefined ||
      (typeof current === 'string' && current.trim() === '');

    if (!isEmpty && !overwrite) {
      return {
        ok: false,
        reason: 'already-populated',
        existing: current,
        modifiedOn: existing?.modifiedon || null,
      };
    }

    try {
      await this.updateRecord(
        entitySet,
        recordId,
        { [fieldName]: value },
        {
          ...(existing?._etag ? { ifMatch: existing._etag } : {}),
          ...(actingUserSystemId ? { actingUserSystemId } : {}),
        },
      );
      return isEmpty
        ? { ok: true, written: true }
        : { ok: true, written: false, reason: 'overwrote' };
    } catch (err) {
      if (err.status === 412) return { ok: false, reason: 'conflict' };
      return { ok: false, reason: 'writeback_failed', error: err };
    }
  }

  /**
   * Delete a record by ID. Returns void on success (204).
   *
   * @param {string} entitySet
   * @param {string} recordId - GUID
   * @param {object} [options]
   * @param {string} [options.actingUserSystemId] - When set, sends `MSCRMCallerID`.
   * @param {string} [options.ifMatch] - ETag from a prior read (`record._etag`).
   *   When supplied, Dataverse rejects the DELETE with 412 if the row changed
   *   since the read — used to fail-closed against a concurrent write that would
   *   engage a row we're about to delete (the merge collision-delete). The thrown
   *   Error's `.status` is the HTTP status so callers can branch on 412.
   * @returns {Promise<void>}
   */
  static async deleteRecord(entitySet, recordId, { actingUserSystemId, ifMatch } = {}) {
    assertTrustedDalContext('DynamicsService.deleteRecord');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})`;

    const headers = this._withCallerId(this.buildHeaders(token), actingUserSystemId);
    if (ifMatch) headers['If-Match'] = ifMatch;

    const resp = await this._writeFetch(url, {
      method: 'DELETE',
      headers,
    }, actingUserSystemId);

    if (!resp.ok) {
      const errorBody = await resp.text();
      // Plain-Error shape preserved for existing callers that match on the
      // message; `.status` added (purely additive) so the conditional-delete
      // caller can distinguish a 412 precondition failure from other errors.
      const err = new Error(`Delete ${entitySet}(${recordId}) failed (${resp.status}): ${errorBody}`);
      err.status = resp.status;
      throw err;
    }
  }

  /**
   * Clear a single-valued navigation property (NULL a lookup) by deleting its
   * $ref. This is the supported way to disassociate a lookup — a PATCH with
   * `<NavProp>@odata.bind: null` is NOT accepted by Dataverse. Mirrors the proven
   * slot-clear in scripts/reset-request-reviewers.mjs (`<entity>(id)/<NavProp>/$ref`
   * DELETE). A 404 is treated as success: the reference was already absent, so the
   * post-condition (lookup empty) already holds — idempotent clear.
   *
   * @param {string} entitySet
   * @param {string} recordId - GUID of the referencing row
   * @param {string} navProperty - single-valued nav prop (e.g. 'wmkf_PotentialReviewer1')
   * @param {object} [options]
   * @param {string} [options.actingUserSystemId] - MSCRMCallerID attribution.
   */
  static async disassociate(entitySet, recordId, navProperty, { actingUserSystemId } = {}) {
    assertTrustedDalContext('DynamicsService.disassociate');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;
    const url = `${baseUrl}/api/data/v9.2/${entitySet}(${recordId})/${navProperty}/$ref`;

    const headers = this._withCallerId(this.buildHeaders(token), actingUserSystemId);

    const resp = await this._writeFetch(url, {
      method: 'DELETE',
      headers,
    }, actingUserSystemId);

    if (!resp.ok && resp.status !== 404) {
      const errorBody = await resp.text();
      const err = new Error(`Disassociate ${entitySet}(${recordId})/${navProperty} failed (${resp.status}): ${errorBody}`);
      err.status = resp.status;
      throw err;
    }
  }

  // ───────── Atomic Multi-Row Writes ($batch changeset) ─────────
  //
  // Dataverse $batch wrapping a SINGLE changeset commits every operation or none
  // of them — verified in prod, S301 (scripts/probe-dataverse-batch-changeset.mjs:
  // multi-op commit + atomic rollback + per-op If-Match all confirmed). The
  // reviewer submit flow uses this to write the answer-snapshot child rows and
  // the parent PATCH in one transaction. This REFUTES the older "Dataverse has no
  // $batch transaction" belief carried in pages/api/admin/prompts/[name].js — that
  // flow's non-atomic mirror predates this verification.

  /**
   * Execute several create/update/delete operations in ONE atomic Dataverse
   * changeset. Either every operation commits or none do (all-or-nothing).
   *
   * @param {Array<{method:'POST'|'PATCH'|'DELETE', url:string, body?:object, ifMatch?:string}>} operations
   *   Ordered list (Content-ID = 1-based index). `url` is a resource path
   *   relative to the v9.2 data root with NO leading slash — e.g.
   *   `wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=<g>,wmkf_questionkey='q2')`
   *   (alternate-key upsert) or `akoya_requests(<guid>)`. POST/PATCH must carry a
   *   `body`; `ifMatch` adds a per-op `If-Match` precondition (412 if the row
   *   changed since it was read). Build URLs server-side — this helper does not
   *   GUID-validate them.
   * @param {object} [options]
   * @param {string} [options.actingUserSystemId] - MSCRMCallerID attribution for
   *   every op in the batch (same privilege-intersection fallback as single
   *   writes). Null/omitted for external-token flows (e.g. reviewer submit).
   * @returns {Promise<{ ok: true, operations: Array<{contentId:number|null, status:number, body:object|null}> }>}
   *   `body` is the parsed JSON op body when present (Dataverse create/PATCH ops
   *   in a changeset typically return 204 No Content, so `body` is usually null).
   *   This helper does NOT surface embedded response headers, so created-row IDs
   *   (`OData-EntityId`) are intentionally NOT returned — callers must address
   *   rows by GUID or alternate key they already hold, not by created-id
   *   read-back (the reviewer submit upserts answer rows by alternate key).
   * @throws {Error} structured service-error (buildServiceError shape) when the
   *   changeset is rejected OR when the parser cannot confirm a 2xx result for
   *   every op (fail-closed) — because the changeset is atomic, a throw means
   *   NOTHING was committed. `.status` is the failing op's HTTP status, so callers
   *   branch on 412 (If-Match conflict) exactly as they do for updateRecord/deleteRecord.
   */
  static async executeChangeset(operations, { actingUserSystemId } = {}) {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error('executeChangeset: operations must be a non-empty array');
    }
    const ALLOWED_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
    operations.forEach((op, i) => {
      if (!op || !ALLOWED_METHODS.has(op.method)) {
        throw new Error(`executeChangeset: operations[${i}].method must be one of POST/PATCH/DELETE`);
      }
      if (!op.url || typeof op.url !== 'string') {
        throw new Error(`executeChangeset: operations[${i}].url is required`);
      }
      if ((op.method === 'POST' || op.method === 'PATCH') && (op.body === undefined || op.body === null)) {
        throw new Error(`executeChangeset: operations[${i}] (${op.method}) requires a body`);
      }
    });
    // Enforcement runs AFTER input validation (above) so malformed-input
    // rejections keep their existing, more specific messages regardless of
    // context — only a well-formed changeset needs a trusted context to run.
    assertTrustedDalContext('DynamicsService.executeChangeset');

    const token = await this.getAccessToken();
    const baseUrl = `${process.env.DYNAMICS_URL}/api/data/v9.2`;
    const batchId = randomUUID();
    const batchBoundary = `batch_${batchId}`;
    const changesetBoundary = `changeset_${batchId}`;
    const body = buildChangesetBatchBody(operations, batchBoundary, changesetBoundary, baseUrl);

    const headers = this._withCallerId({
      Authorization: `Bearer ${token}`,
      'OData-Version': '4.0',
      'OData-MaxVersion': '4.0',
      Accept: 'application/json',
      'Content-Type': `multipart/mixed; boundary=${batchBoundary}`,
    }, actingUserSystemId);

    const resp = await this._writeFetch(`${baseUrl}/$batch`, {
      method: 'POST',
      headers,
      body,
    }, actingUserSystemId);

    const rawText = await resp.text();
    const contentType = resp.headers?.get ? resp.headers.get('content-type') : null;
    const parsed = parseBatchResponse(rawText, contentType);

    // The changeset is atomic, so a single failed embedded op == the whole batch
    // rolled back. Prefer the embedded status/body for precise 412/400/409
    // classification; fall back to the outer HTTP status when Dataverse returns a
    // bare (non-multipart) error envelope.
    const failed = parsed.find((p) => p.status >= 400);
    if (failed || !resp.ok) {
      const status = failed ? failed.status : resp.status;
      const errBody = failed ? failed.rawBody : rawText;
      throw buildServiceError('dataverse', { status }, errBody);
    }

    // Fail closed: a multipart success response MUST yield exactly one parsed 2xx
    // result per requested op. If the parser under-counts (skipped an unsplittable
    // part), or yields a non-2xx / unparseable status (status 0) that the `failed`
    // scan above didn't catch, we cannot prove the changeset committed — throw
    // rather than return ok and let the caller do post-commit work (e.g. delete
    // the reviewer draft) on an unconfirmed write. This guards the parser itself,
    // not just Dataverse's response.
    const allConfirmed =
      parsed.length === operations.length &&
      parsed.every((p) => p.status >= 200 && p.status < 300);
    if (!allConfirmed) {
      const statuses = parsed.map((p) => p.status).join(', ') || 'none';
      throw buildServiceError(
        'dataverse',
        { status: resp.status },
        `executeChangeset could not confirm an atomic commit: parsed ${parsed.length} of ` +
          `${operations.length} op result(s) [statuses: ${statuses}]. Raw response (truncated): ` +
          rawText.slice(0, 500),
      );
    }

    return {
      ok: true,
      operations: parsed.map((p) => ({ contentId: p.contentId, status: p.status, body: p.body })),
    };
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

    const taskTypeValue = this.AI_RUN_TASK_TYPES[taskType];
    if (taskTypeValue === undefined) {
      throw new Error(`logAiRun: unknown taskType "${taskType}" (expected one of: ${Object.keys(this.AI_RUN_TASK_TYPES).join(', ')})`);
    }

    const statusValue = this.AI_RUN_STATUSES[status];
    if (statusValue === undefined) {
      throw new Error(`logAiRun: unknown status "${status}" (expected one of: ${Object.keys(this.AI_RUN_STATUSES).join(', ')})`);
    }

    // Navigation property name is wmkf_ai_Request (capitalized R) — discovered
    // via EntityDefinitions expand on ManyToOneRelationships. Case matters.
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
      const retainedRawOutput = applyRawOutputRetention(rawOutput, rawOutputRetention);
      const serialized = typeof retainedRawOutput === 'string' ? retainedRawOutput : JSON.stringify(retainedRawOutput);
      payload.wmkf_ai_rawoutput = this._truncateForMemo(serialized, 1_000_000);
    }
    if (notes) payload.wmkf_ai_notes = this._truncateForMemo(String(notes), 2000);

    const created = await this.createRecord('wmkf_ai_runs', payload, { actingUserSystemId });
    return {
      runId: created.wmkf_ai_runid,
      runNum: created.wmkf_ai_runnum,
    };
  }

  /**
   * Truncate a string to fit in a Dataverse Memo field. Appends a visible
   * marker so readers can tell the content was cut off.
   */
  static _truncateForMemo(s, maxChars) {
    if (!s || s.length <= maxChars) return s;
    const marker = `\n…[truncated ${s.length - maxChars + 0} chars]`;
    return s.slice(0, maxChars - marker.length) + marker;
  }

  // ───────── Email Operations ─────────

  /**
   * Create an email activity record in Dynamics CRM.
   *
   * @param {Object} options
   * @param {string} options.subject - Email subject
   * @param {string} options.body - Email body (HTML supported)
   * @param {string} options.from - Sender email address
   * @param {string|string[]} options.to - Recipient email(s)
   * @param {string|string[]} [options.cc] - CC email(s)
   * @param {string} [options.regardingId] - GUID of the regarding entity (e.g., request)
   * @param {string} [options.regardingType] - Logical name of regarding entity (e.g., 'akoya_request')
   * @returns {string} The created email activity ID
   */
  /**
   * Resolve an email address to a Dynamics system user ID.
   * Required for sender party — Dynamics needs a partyid reference.
   */
  static async resolveSystemUser(email) {
    const { records } = await this.queryRecords('systemusers', {
      select: 'systemuserid',
      filter: `internalemailaddress eq '${email}'`,
      top: 1,
    });
    if (records.length === 0) {
      throw new Error(`No Dynamics system user found for email: ${email}`);
    }
    return records[0].systemuserid;
  }

  static async createEmailActivity({ subject, body, from, to, cc, regardingId, regardingType, actingUserSystemId, noFallback = false }) {
    assertTrustedDalContext('DynamicsService.createEmailActivity');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;

    // Resolve sender to a system user (required for SendEmail)
    const senderUserId = await this.resolveSystemUser(from);

    // Build activity parties
    const parties = [];

    // Sender (participationtypemask = 1) — must bind to a system user
    parties.push({
      participationtypemask: 1,
      addressused: from,
      'partyid_systemuser@odata.bind': `/systemusers(${senderUserId})`,
    });

    // To recipients (participationtypemask = 2)
    const toList = Array.isArray(to) ? to : [to];
    for (const addr of toList) {
      parties.push({ participationtypemask: 2, addressused: addr });
    }

    // CC recipients (participationtypemask = 3)
    if (cc) {
      const ccList = Array.isArray(cc) ? cc : [cc];
      for (const addr of ccList) {
        parties.push({ participationtypemask: 3, addressused: addr });
      }
    }

    const emailData = {
      subject,
      description: body,
      directioncode: true, // Outgoing
      email_activity_parties: parties,
    };

    // Link to a regarding record (e.g., a request)
    if (regardingId && regardingType) {
      const entitySet = await this.resolveEntitySetName(regardingType);
      emailData[`regardingobjectid_${regardingType}@odata.bind`] = `/${entitySet}(${regardingId})`;
    }

    const resp = await this._writeFetch(`${baseUrl}/api/data/v9.2/emails`, {
      method: 'POST',
      headers: this._withCallerId({
        ...this.buildHeaders(token),
        Prefer: 'return=representation',
      }, actingUserSystemId),
      body: JSON.stringify(emailData),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Failed to create email activity (${resp.status}): ${errorBody}`);
    }

    const result = await resp.json();
    return result.activityid;
  }

  /**
   * Add an attachment to an email activity.
   *
   * @param {string} emailId - Email activity ID
   * @param {Object} attachment
   * @param {string} attachment.filename - Filename
   * @param {string} attachment.contentType - MIME type
   * @param {Buffer|string} attachment.content - File content (Buffer or base64 string)
   */
  static async addEmailAttachment(emailId, { filename, contentType, content, actingUserSystemId, noFallback = false }) {
    assertTrustedDalContext('DynamicsService.addEmailAttachment');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;

    const base64Body = Buffer.isBuffer(content)
      ? content.toString('base64')
      : content;

    const attachmentData = {
      'objectid_email@odata.bind': `/emails(${emailId})`,
      objecttypecode: 'email',
      subject: filename,
      filename,
      mimetype: contentType || 'application/octet-stream',
      body: base64Body,
    };

    const resp = await this._writeFetch(`${baseUrl}/api/data/v9.2/activitymimeattachments`, {
      method: 'POST',
      headers: this._withCallerId(this.buildHeaders(token), actingUserSystemId),
      body: JSON.stringify(attachmentData),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Failed to add email attachment "${filename}" (${resp.status}): ${errorBody}`);
    }
  }

  /**
   * Send an email activity via the Dynamics SendEmail action.
   * The email must already be created via createEmailActivity().
   *
   * @param {string} emailId - Email activity ID to send
   */
  static async sendEmail(emailId, { actingUserSystemId, noFallback = false } = {}) {
    assertTrustedDalContext('DynamicsService.sendEmail');
    const token = await this.getAccessToken();
    const baseUrl = process.env.DYNAMICS_URL;

    const resp = await this._writeFetch(`${baseUrl}/api/data/v9.2/emails(${emailId})/Microsoft.Dynamics.CRM.SendEmail`, {
      method: 'POST',
      headers: this._withCallerId(this.buildHeaders(token), actingUserSystemId),
      body: JSON.stringify({
        IssueSend: true,
      }),
    }, actingUserSystemId, { noFallback });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Failed to send email (${resp.status}): ${errorBody}`);
    }
  }

  /**
   * Create, optionally attach files, and send an email in one call.
   *
   * @param {Object} options - Same as createEmailActivity plus:
   * @param {Array} [options.attachments] - Array of { filename, contentType, content }
   * @returns {{ emailId: string }} The sent email activity ID
   */
  static async createAndSendEmail({ subject, body, from, to, cc, regardingId, regardingType, attachments = [], actingUserSystemId, noFallback = false }) {
    if (noFallback && actingUserSystemId && process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
      throw new Error('Dynamics impersonation is disabled; noFallback requested');
    }

    // Step 1: Create the email activity
    const emailId = await this.createEmailActivity({ subject, body, from, to, cc, regardingId, regardingType, actingUserSystemId, noFallback });

    // Step 2: Add attachments (sequentially to avoid race conditions)
    for (const attachment of attachments) {
      await this.addEmailAttachment(emailId, { ...attachment, actingUserSystemId, noFallback });
    }

    // Step 3: Send
    await this.sendEmail(emailId, { actingUserSystemId, noFallback });

    return { emailId };
  }

  // ───────── Helpers ─────────

  // resolveEntitySetName / getPrimaryIdAttribute / getEntityKey moved to
  // ./dynamics/schema.js — Stage 4. Thin delegating wrappers pass `this` as the
  // svc receiver (C1) so internal `this.` and external `DynamicsService.` calls
  // (and test spies) are unchanged.

  static resolveEntitySetName(...args) {
    return resolveEntitySetName(this, ...args);
  }

  static getPrimaryIdAttribute(...args) {
    return getPrimaryIdAttribute(this, ...args);
  }

  // processAnnotations moved to ./dynamics/annotations.js — Stage 3. Thin
  // delegating wrapper so internal `this.` and external `DynamicsService.`
  // calls are unchanged.
  static processAnnotations(record) {
    return processAnnotations(record);
  }

  static getEntityKey(...args) {
    return getEntityKey(this, ...args);
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

// ───────── Private Helpers ─────────

// ───────── $batch changeset builders + response parser ─────────
//
// Adapted from the proven body builder in scripts/probe-dataverse-batch-changeset.mjs
// (the S301 feasibility spike). The request half is byte-for-byte the spike's
// shape; the response parser is net-new (the spike only regex-scanned status
// lines — executeChangeset needs per-op Content-ID + body for structured errors).

const BATCH_CRLF = '\r\n';

/** Build one embedded operation (an application/http MIME part) inside a changeset. */
function buildChangesetOp(op, changesetBoundary, baseUrl, contentId) {
  const lines = [];
  lines.push(`--${changesetBoundary}`);
  lines.push('Content-Type: application/http');
  lines.push('Content-Transfer-Encoding: binary');
  lines.push(`Content-ID: ${contentId}`);
  lines.push(''); // blank line before the embedded request
  const url = op.url.startsWith('http') ? op.url : `${baseUrl}/${op.url}`;
  lines.push(`${op.method} ${url} HTTP/1.1`);
  lines.push('OData-Version: 4.0');
  lines.push('Accept: application/json');
  if (op.ifMatch) lines.push(`If-Match: ${op.ifMatch}`);
  if (op.body !== undefined && op.body !== null) {
    lines.push('Content-Type: application/json');
    lines.push('');
    lines.push(JSON.stringify(op.body));
  } else {
    lines.push('');
  }
  return lines.join(BATCH_CRLF);
}

/** Build the full multipart/mixed $batch body wrapping a single changeset of ops. */
function buildChangesetBatchBody(operations, batchBoundary, changesetBoundary, baseUrl) {
  const parts = [];
  parts.push(`--${batchBoundary}`);
  parts.push(`Content-Type: multipart/mixed; boundary=${changesetBoundary}`);
  parts.push(''); // blank line before the changeset
  operations.forEach((op, i) => parts.push(buildChangesetOp(op, changesetBoundary, baseUrl, i + 1)));
  parts.push(`--${changesetBoundary}--`);
  parts.push(`--${batchBoundary}--`);
  parts.push('');
  return parts.join(BATCH_CRLF);
}

/** Pull the multipart boundary token out of a Content-Type header value. */
function extractBoundary(contentType) {
  if (!contentType) return null;
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  return m ? m[1].trim() : null;
}

/**
 * Split a string at its first blank line (the MIME header/body separator),
 * tolerant of CRLF or LF endings. Returns { headers, body } or null if there is
 * no blank-line separator.
 */
function splitHeadersAndBody(text) {
  const m = text.match(/\r?\n\r?\n/);
  if (!m) return null;
  return { headers: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

/**
 * Split a multipart body into its constituent part strings (each part's MIME
 * headers + content), dropping the preamble, the closing `--boundary--`, and any
 * epilogue. Tolerant of CRLF or LF line endings from the wire.
 */
function splitMultipart(body, boundary) {
  const segments = body.split(`--${boundary}`);
  const parts = [];
  for (const seg of segments) {
    const stripped = seg.replace(/^\r?\n/, '');
    if (stripped.startsWith('--')) continue; // closing boundary marker
    if (!stripped.trim()) continue;          // preamble / blank
    parts.push(stripped);
  }
  return parts;
}

/**
 * Parse one embedded `application/http` response body into { status, body,
 * rawBody }. Shape: "HTTP/1.1 <status> <reason>\r\n<headers>\r\n\r\n<body>".
 * Embedded response headers (e.g. OData-EntityId on a create) are intentionally
 * NOT surfaced — see executeChangeset's JSDoc: callers identify rows by
 * alternate key, not by created-id read-back.
 */
function parseEmbeddedHttp(text) {
  const statusMatch = text.match(/^HTTP\/1\.1\s+(\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const split = splitHeadersAndBody(text);
  const rawBody = split ? split.body.trim() : '';
  let body = null;
  if (rawBody) {
    try { body = JSON.parse(rawBody); } catch { /* non-JSON op body */ }
  }
  return { status, rawBody, body };
}

/** Recursively walk the nested multipart structure, collecting every embedded HTTP op result. */
function collectHttpParts(body, boundary, results) {
  for (const part of splitMultipart(body, boundary)) {
    const split = splitHeadersAndBody(part);
    if (!split) continue;
    const { headers: partHeaders, body: partBody } = split;
    const ctMatch = partHeaders.match(/Content-Type:\s*([^\r\n]+)/i);
    const ct = ctMatch ? ctMatch[1].trim() : '';
    const ctType = ct.toLowerCase(); // compare the MIME type case-insensitively…
    if (ctType.startsWith('multipart/mixed')) {
      const inner = extractBoundary(ct); // …but extract the boundary from the original (boundaries are case-sensitive)
      if (inner) collectHttpParts(partBody, inner, results);
    } else if (ctType.startsWith('application/http')) {
      const cidMatch = partHeaders.match(/Content-ID:\s*(\d+)/i);
      const contentId = cidMatch ? Number(cidMatch[1]) : null;
      results.push({ contentId, ...parseEmbeddedHttp(partBody) });
    }
  }
}

/**
 * Parse a Dataverse $batch response (batchresponse → changesetresponse →
 * application/http) into a flat per-op list. Returns [] when the response is not
 * multipart (Dataverse sometimes returns a bare JSON error for a rejected
 * changeset) — executeChangeset then falls back to the outer HTTP status.
 *
 * @returns {Array<{ contentId:number|null, status:number, body:object|null, rawBody:string }>}
 */
function parseBatchResponse(rawText, contentType) {
  const boundary = extractBoundary(contentType);
  if (!boundary || !rawText) return [];
  const results = [];
  collectHttpParts(rawText, boundary, results);
  return results;
}

