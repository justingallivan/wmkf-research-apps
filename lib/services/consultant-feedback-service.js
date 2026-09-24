/**
 * Consultant Feedback slice 1
 * (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3, §4).
 *
 * Staff-recorded informal feedback from retained consultants on a proposal.
 * Postgres (`consultant_feedback`, migration 048) owns the entry; slice 1 has
 * no attachments, so every entry carries a non-empty sanitized body.
 *
 * `writeFeedbackEntry` (insert) and `updateFeedbackEntry` (patch) are the two
 * entry points that can set or change an entry's author (§3.2 "one write
 * primitive", Codex AR-2 finding 4). They stay separate functions — insert
 * establishes the mutation-id replay contract an update never needs, and an
 * update must compare the submitted author against the stored row rather
 * than insert-then-overwrite — but both route through the SAME two guards,
 * `validateAuthorInput` (exactly one of roster id / one-off name) and
 * `assertConsultantEligible` (`is_active = true AND role_type = 'Consultant'`
 * against `expertise_roster`, run inside the caller's own same-client
 * transaction), and nothing else in this file or its callers may insert or
 * reassign an author. Slice 2's finalize step 7 binds an attachment through
 * `updateFeedbackEntry`, not a third write path.
 *
 * Eligibility (§3.2, Codex AR-1 finding 3): a `consultantRosterId` is
 * resolved with `is_active = true AND role_type = 'Consultant'` on create and
 * on any ACTUAL author change (the submitted author differs by value from
 * the stored row — not merely because the client's body included the author
 * fields, which it may resubmit unchanged; see `updateFeedbackEntry`), and rejected
 * with 400 `consultant_not_eligible` otherwise. Reads and author-unchanged
 * edits use an UNFILTERED join so a deactivated consultant's past feedback
 * keeps its name (§3.1).
 *
 * No `expertise_roster` write happens anywhere in this file (CF6): a one-off
 * name/affiliation is stored on the entry itself and never promoted to the
 * roster.
 *
 * Known residual (accepted, not fixed, slice 1): the mutation-id replay
 * receipt lives ON the row it created. If a create's response is lost, a
 * colleague then hard-deletes that row, and the original client retries the
 * same mutation id, the retry finds no row for `(request_id, mutation_id)`
 * and inserts a second entry — the replay guard cannot distinguish "never
 * happened" from "happened and was since deleted" once the receipt itself is
 * gone. Accepted here because the retry window is the open-form lifetime (a
 * user closing and reopening the tab already rotates the mutation id via
 * `closeForm`), so the overlap with an unrelated concurrent hard delete is
 * narrow. Slice 2's `deleting`/terminal status work is where a durable
 * receipt independent of the row would live if the owner wants this closed.
 */
import { sql, withClient } from '../postgres/client';
import { ServiceHttpError } from './service-http-error';
import { isGuid } from '../utils/guid.js';
import { sanitizeReviewHtml, isEffectivelyEmptyHtml } from '../external/sanitize-review-html.js';
import * as requestDocumentAdapter from '../dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_BATCH_MAX_IDS } from '../dataverse/adapters/request-document.js';
import { GraphService } from './graph-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
} from '../../shared/config/requestDocument.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from './request-document-actor-service.js';

/**
 * Slice 2 dependencies (attachment reads/writes against the Dataverse
 * registry), injected so tests can drive every branch without a live
 * Dataverse call. `findDocumentsByIds` batches the registry lookup for a
 * page of feedback rows; `supersedeDocument` is the same idempotent PATCH
 * `contributor-service.js:52` uses.
 */
export const DEFAULT_DEPENDENCIES = Object.freeze({
  findDocumentsByIds: (ids) => requestDocumentAdapter.findByIds(ids),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  supersedeDocument: (id) => requestDocumentAdapter.update(
    id,
    { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
    { actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.ALLOW_UNATTRIBUTED, actorContext: { operation: 'consultant-feedback-delete' } },
  ),
});

/** Registry row → the shape callers/UI need; never the SharePoint identity. */
function attachmentFromRegistryRow(row) {
  if (!row) return null;
  return {
    requestdocumentId: row.wmkf_requestdocumentid,
    filename: row.wmkf_filename || null,
    contentType: row.wmkf_contenttype || null,
    size: Number.isFinite(row.wmkf_filesize) ? row.wmkf_filesize : (row.wmkf_filesize != null ? Number(row.wmkf_filesize) : null),
  };
}

const KNOWN_REQUEST_DOCUMENT_LIFECYCLE_STATES = new Set(
  Object.values(REQUEST_DOCUMENT_LIFECYCLE_STATE),
);

/**
 * One fail-closed eligibility predicate for every staff attachment consumer.
 * A registry row may produce a link or a Graph read only when its exact
 * identity, request ownership, artifact type, operation status, known live
 * lifecycle, and file pointers all match the feedback entry.
 */
function isStaffDownloadableRegistryRow(row, { requestId, requestdocumentId }) {
  if (!row || !isGuid(requestId) || !requestdocumentId) return false;
  const sameDocument = String(row.wmkf_requestdocumentid || '').toLowerCase()
    === String(requestdocumentId).toLowerCase();
  const sameRequest = String(row._wmkf_request_value || '').toLowerCase()
    === requestId.toLowerCase();
  return sameDocument
    && sameRequest
    && row.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.CONSULTANT_FEEDBACK
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && KNOWN_REQUEST_DOCUMENT_LIFECYCLE_STATES.has(row.wmkf_lifecyclestate)
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && Boolean(row.wmkf_sharepointdriveid)
    && Boolean(row.wmkf_sharepointitemid);
}

/**
 * Best-effort, CHUNKED batch registry read keyed by lowercased id; never
 * throws. The adapter refuses more than `REQUEST_DOCUMENT_BATCH_MAX_IDS` ids
 * in one call, so a 26th+ attached entry must not silently vanish from the
 * result — chunk and merge instead of sending every id in one call. A
 * failing chunk marks only ITS ids `unavailable` (surfaced by the caller as a
 * distinct attachment state) rather than treating every attachment on the
 * page as absent.
 */
async function loadRegistryMap(requestdocumentIds, dependencies) {
  const ids = [...new Set(requestdocumentIds.filter(Boolean))];
  const map = new Map();
  const unavailableIds = new Set();
  for (let i = 0; i < ids.length; i += REQUEST_DOCUMENT_BATCH_MAX_IDS) {
    const chunk = ids.slice(i, i + REQUEST_DOCUMENT_BATCH_MAX_IDS);
    try {
      const { records } = await dependencies.findDocumentsByIds(chunk);
      for (const row of records || []) {
        map.set(String(row.wmkf_requestdocumentid).toLowerCase(), row);
      }
    } catch (error) {
      console.error('[consultant-feedback] registry batch read failed', { message: error?.message, batchSize: chunk.length });
      for (const id of chunk) unavailableIds.add(String(id).toLowerCase());
    }
  }
  return { map, unavailableIds };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Checked BEFORE sanitizing (raw input length, not the sanitized/stripped
// output) so an oversized payload is rejected up front rather than after
// paying the sanitize-html parse cost.
const MAX_BODY_LENGTH = 200_000;

function badRequest(message, reason) {
  return new ServiceHttpError(message, { httpStatus: 400, body: { error: message, reason } });
}

function notFound(message = 'Consultant feedback entry not found.') {
  return new ServiceHttpError(message, { httpStatus: 404, body: { error: message, reason: 'not_found' } });
}

/**
 * `shared` must be an actual boolean when supplied; a non-boolean (e.g. the
 * string `"false"`) is truthy and would otherwise fail open to shared=true.
 * `allowDefault` lets an absent (`undefined`) value default to `true` (CF2)
 * only at create, where the field is optional; an update's `patch.shared` is
 * only normalized when the caller's body has the key at all, so there is no
 * "absent" case to default there.
 */
function normalizeShared(value, { allowDefault = false } = {}) {
  if (value === undefined && allowDefault) return true;
  if (typeof value !== 'boolean') throw badRequest('shared must be a boolean.', 'invalid_shared');
  return value;
}

/**
 * Strict positive-integer id check for roster ids, entry ids, and actor ids.
 * Ids arrive as either a JSON number or a numeric string (query params are
 * always strings; JSON bodies are usually numbers). `Number.isInteger(Number(x))`
 * is too permissive: `Number(true) === 1`, `Number('') === 0` is rejected only
 * by the `> 0` half, but `Number(' 5 ')` and other coercions can slip through.
 * This accepts only an actual integer number or a `/^\d+$/` string, so
 * `true`, `''`, `1.5`, `'1.5'`, and `' 5'` are all rejected.
 */
function isPositiveInt(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  if (typeof value === 'string') return /^\d+$/.test(value) && Number(value) > 0;
  return false;
}

function normalizeReceivedOn(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!DATE_RE.test(trimmed)) throw badRequest('receivedOn must be a YYYY-MM-DD date.', 'invalid_received_on');
  return trimmed;
}

function mapRow(row, registryMap = null, unavailableIds = null, requestId = null) {
  const docKey = row.requestdocument_id ? String(row.requestdocument_id).toLowerCase() : null;
  const registryRow = registryMap && docKey ? registryMap.get(docKey) || null : null;
  const isUnavailable = Boolean(docKey && (
    unavailableIds?.has(docKey)
    || !isStaffDownloadableRegistryRow(registryRow, {
      requestId,
      requestdocumentId: row.requestdocument_id,
    })
  ));
  return {
    id: String(row.id),
    // received_on is always selected as `to_char(..., 'YYYY-MM-DD')` text (never
    // a pg Date object read back through toISOString(), which shifts a day east
    // of UTC) — see every SELECT/RETURNING in this file.
    receivedOn: String(row.received_on),
    bodyHtml: row.body_html != null ? sanitizeReviewHtml(row.body_html) : null,
    shared: row.shared === true,
    consultant: row.consultant_roster_id != null
      ? { rosterId: row.consultant_roster_id, name: row.roster_name ?? null, affiliation: row.roster_affiliation ?? null }
      : { rosterId: null, name: row.one_off_name ?? null, affiliation: row.one_off_affiliation ?? null },
    oneOff: row.consultant_roster_id == null,
    // requestdocument_id may be present without a resolved registry row. A
    // batch that failed outright is surfaced as `{ status: 'unavailable' }`
    // (§3.3 "unavailable is not empty" — never silently absent); a batch
    // that succeeded but returned no matching/live row is also unavailable,
    // so the UI never offers a link that the download boundary will reject.
    attachment: row.requestdocument_id
      ? (isUnavailable
        ? { requestdocumentId: row.requestdocument_id, status: 'unavailable' }
        : attachmentFromRegistryRow(registryRow))
      : null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/**
 * Active entries for a request, newest `received_on` first, with the live
 * (unfiltered by `is_active`) roster join so a deactivated consultant's past
 * feedback keeps its author name (§3.1).
 */
/**
 * §3.6 recovery sweep: finish steps 2-3 of the three-step delete for any row
 * of this request stuck in `deleting` (a crash or lost response after step 1)
 * before listing. Never lets a sweep failure fail the list — best-effort,
 * logged, and retried on the next visit.
 */
async function sweepDeletingRows(requestId, dependencies) {
  let stuck;
  try {
    const { rows } = await sql.query(
      `SELECT id, requestdocument_id FROM consultant_feedback WHERE request_id = $1 AND status = 'deleting'`,
      [requestId],
    );
    stuck = rows;
  } catch (error) {
    console.error('[consultant-feedback] deleting-row sweep read failed', { requestId, message: error?.message });
    return;
  }
  for (const row of stuck) {
    try {
      await finishThreeStepDelete({ id: row.id, requestdocumentId: row.requestdocument_id, dependencies });
    } catch (error) {
      console.error('[consultant-feedback] deleting-row sweep step failed', { requestId, id: row.id, message: error?.message });
    }
  }
}

export async function listConsultantFeedback({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  await sweepDeletingRows(requestId, dependencies);
  const { rows } = await sql.query(
    `SELECT cf.id, to_char(cf.received_on, 'YYYY-MM-DD') AS received_on, cf.body_html, cf.shared, cf.consultant_roster_id,
            cf.one_off_name, cf.one_off_affiliation, cf.requestdocument_id, cf.updated_at,
            r.name AS roster_name, r.affiliation AS roster_affiliation
       FROM consultant_feedback cf
       LEFT JOIN expertise_roster r ON r.id = cf.consultant_roster_id
      WHERE cf.request_id = $1 AND cf.status = 'active'
      ORDER BY cf.received_on DESC, cf.id DESC`,
    [requestId],
  );
  const { map: registryMap, unavailableIds } = await loadRegistryMap(rows.map((row) => row.requestdocument_id), dependencies);
  return rows.map((row) => mapRow(row, registryMap, unavailableIds, requestId));
}

/** Active `role_type='Consultant'` roster rows for the dropdown source. */
export async function listEligibleConsultants() {
  const { rows } = await sql.query(
    `SELECT id, name, affiliation FROM expertise_roster
      WHERE is_active = true AND role_type = 'Consultant'
      ORDER BY name, id`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, affiliation: row.affiliation ?? null }));
}

/**
 * §3.3 `feedback:<requestdocumentid>` membership proof, half of it: is this
 * registry row actually a shared, active consultant-feedback attachment for
 * THIS request? (The other half — Ready, not Superseded — is a live
 * Dataverse check the caller runs against the registry row itself.)
 */
export async function isSharedActiveFeedbackAttachment(requestId, requestdocumentId) {
  if (!isGuid(requestId) || !isGuid(requestdocumentId)) return false;
  const { rows } = await sql.query(
    `SELECT 1 FROM consultant_feedback
      WHERE request_id = $1 AND requestdocument_id = $2 AND shared = true AND status = 'active'
      LIMIT 1`,
    [requestId, requestdocumentId],
  );
  return rows.length > 0;
}

/**
 * Slice 3 staff download contract. The browser supplies the feedback entry id,
 * never a SharePoint path or drive/item identity. This resolver independently
 * proves the active Postgres entry belongs to the request, then proves the
 * linked Dataverse row is exactly one live Consultant Feedback artifact for
 * that same request before issuing any Graph read. Unlike the external
 * briefing member, staff may open an unshared entry's attachment.
 */
export async function downloadConsultantFeedbackAttachment({ requestId, entryId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  if (!isPositiveInt(entryId)) throw badRequest('entryId must be a positive integer.', 'invalid_entry_id');

  const { rows } = await sql.query(
    `SELECT id, requestdocument_id
       FROM consultant_feedback
      WHERE id = $1 AND request_id = $2 AND status = 'active'
      LIMIT 1`,
    [Number(entryId), requestId],
  );
  const feedback = rows[0];
  if (!feedback?.requestdocument_id) throw notFound('Consultant feedback attachment not found.');

  const registry = await dependencies.findDocumentsByIds([feedback.requestdocument_id]);
  const records = registry?.records || [];
  const row = records.length === 1 ? records[0] : null;
  if (!isStaffDownloadableRegistryRow(row, {
    requestId,
    requestdocumentId: feedback.requestdocument_id,
  })) throw notFound('Consultant feedback attachment not found.');

  let file;
  try {
    file = await dependencies.downloadFile(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid);
  } catch (error) {
    console.error('[consultant-feedback] staff attachment download failed', {
      requestId,
      entryId: Number(entryId),
      message: error?.message,
    });
    throw new ServiceHttpError('The consultant feedback attachment could not be downloaded.', {
      httpStatus: 502,
      body: { error: 'The consultant feedback attachment could not be downloaded.', reason: 'download_failed' },
    });
  }

  const mimeType = file?.mimeType || 'application/octet-stream';
  const allowed = mimeType === 'application/pdf'
    || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (!allowed || !Buffer.isBuffer(file?.buffer)) {
    throw notFound('Consultant feedback attachment not found.');
  }
  return {
    buffer: file.buffer,
    mimeType,
    filename: row.wmkf_filename || file.filename || 'consultant-feedback',
    // Content-Length must describe the bytes we actually send, not potentially
    // stale Graph metadata.
    size: file.buffer.length,
    inline: mimeType === 'application/pdf',
  };
}

/**
 * Slice 2 filename support (`consultant-feedback-attachment-service.js`'s
 * `finalizeAttachmentUpload`, `entryId` bind path): the target entry's
 * display consultant name and received date, for building
 * `Consultant Feedback-<Request#>-<consultant name>-<received_on><ext>`.
 * Read-only display data, not an authorization check — the row's `active`
 * status and request ownership are enforced separately by
 * `updateFeedbackEntry`'s own `SELECT … FOR UPDATE`, which runs as part of
 * the same finalize call. Returns `null` for a missing/foreign id so the
 * caller falls back to a generic name rather than throwing.
 */
export async function getFeedbackEntryForFilename({ id, requestId }) {
  if (!isGuid(requestId) || !isPositiveInt(id)) return null;
  const { rows } = await sql.query(
    `SELECT to_char(cf.received_on, 'YYYY-MM-DD') AS received_on, cf.consultant_roster_id, cf.one_off_name,
            r.name AS roster_name
       FROM consultant_feedback cf
       LEFT JOIN expertise_roster r ON r.id = cf.consultant_roster_id
      WHERE cf.id = $1 AND cf.request_id = $2`,
    [Number(id), requestId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    consultantName: row.consultant_roster_id != null ? (row.roster_name || null) : (row.one_off_name || null),
    receivedOn: row.received_on || null,
  };
}

/** Throws `consultant_not_eligible` unless the roster row is an active Consultant. Must run inside the caller's transaction/client. */
async function assertConsultantEligible(client, consultantRosterId) {
  const { rows } = await client.query(
    `SELECT id FROM expertise_roster WHERE id = $1 AND is_active = true AND role_type = 'Consultant'`,
    [consultantRosterId],
  );
  if (!rows[0]) {
    // `error` carries the human sentence (matching the badRequest()/notFound()
    // helpers' shape below), never the bare `reason` code — the route ships
    // this `body` verbatim, and the Workbench form surfaces `data.error`
    // straight to staff.
    throw new ServiceHttpError('The selected consultant is not an active roster consultant.', {
      httpStatus: 400,
      body: { error: 'The selected consultant is not an active roster consultant.', reason: 'consultant_not_eligible' },
    });
  }
}

function validateAuthorInput({ consultantRosterId, oneOff }) {
  const hasRoster = consultantRosterId != null;
  const hasOneOff = oneOff != null && typeof oneOff.name === 'string' && oneOff.name.trim().length > 0;
  if (hasRoster === hasOneOff) {
    throw badRequest('Provide exactly one of consultantRosterId or oneOff.name.', 'invalid_author');
  }
  if (hasRoster && !isPositiveInt(consultantRosterId)) {
    throw badRequest('consultantRosterId must be a positive integer.', 'invalid_author');
  }
  return { hasRoster, hasOneOff };
}

/**
 * The insert path (§3.2; see the module docblock for the split with
 * `updateFeedbackEntry`). Validates the request GUID, mutation id,
 * exactly-one-author rule, a non-empty sanitized body (slice 1 has no
 * attachments), and the date; runs eligibility for a roster author; inserts
 * with `ON CONFLICT (request_id, mutation_id) DO NOTHING`, then selects and
 * returns the row for that mutation id (replay-safe), in one explicit
 * same-client transaction.
 */
export async function writeFeedbackEntry({
  requestId, actorProfileId, mutationId, consultantRosterId = null, oneOff = null, bodyHtml, receivedOn, shared,
  // Attachment-only create (slice 2 finalize step 7 ONLY — the public POST
  // route must never forward a client-supplied value here; see
  // `pages/api/workbench/consultant-feedback.js`).
  requestdocumentId = null,
}) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  // mutationId is a client-generated UUID (not a Dataverse GUID), but the
  // wire shape is identical, so the same validator applies.
  if (!isGuid(mutationId)) throw badRequest('mutationId must be a UUID.', 'invalid_mutation_id');
  if (!isPositiveInt(actorProfileId)) {
    throw badRequest('actorProfileId is required.', 'invalid_actor');
  }
  if (requestdocumentId != null && !isGuid(requestdocumentId)) {
    throw badRequest('requestdocumentId must be a GUID.', 'invalid_requestdocument_id');
  }
  const { hasRoster } = validateAuthorInput({ consultantRosterId, oneOff });
  if (typeof bodyHtml === 'string' && bodyHtml.length > MAX_BODY_LENGTH) {
    throw badRequest('bodyHtml is too long.', 'body_too_long');
  }
  const sanitizedBody = typeof bodyHtml === 'string' ? sanitizeReviewHtml(bodyHtml) : null;
  if ((!sanitizedBody || isEffectivelyEmptyHtml(sanitizedBody)) && requestdocumentId == null) {
    // An entry with no attachment must carry a body (slice 1 rule, relaxed by
    // slice 2 only when finalize supplies an attachment on create).
    throw badRequest('bodyHtml is required.', 'body_required');
  }
  const normalizedReceivedOn = normalizeReceivedOn(receivedOn);
  const isShared = normalizeShared(shared, { allowDefault: true });
  const oneOffName = hasRoster ? null : String(oneOff.name).trim();
  const oneOffAffiliation = hasRoster ? null : (oneOff.affiliation != null ? String(oneOff.affiliation).trim() || null : null);
  const finalBody = sanitizedBody && !isEffectivelyEmptyHtml(sanitizedBody) ? sanitizedBody : null;

  // Excluded transaction shape: kept verbatim on a withClient client rather
  // than withTransaction. Recorded behaviour difference: withClient destroys
  // the connection on any throw out of this callback instead of this
  // function's former unconditional `finally { client.release(); }`, which
  // always returned it to the pool.
  return withClient(async (client) => {
    try {
      await client.query('BEGIN');
      if (hasRoster) await assertConsultantEligible(client, Number(consultantRosterId));
      await client.query(
        `INSERT INTO consultant_feedback
           (request_id, consultant_roster_id, one_off_name, one_off_affiliation, body_html,
            received_on, requestdocument_id, shared, mutation_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         ON CONFLICT (request_id, mutation_id) DO NOTHING`,
        [requestId, hasRoster ? Number(consultantRosterId) : null, oneOffName, oneOffAffiliation,
          finalBody, normalizedReceivedOn, requestdocumentId, isShared, mutationId, Number(actorProfileId)],
      );
      const { rows } = await client.query(
        `SELECT cf.id, to_char(cf.received_on, 'YYYY-MM-DD') AS received_on, cf.body_html, cf.shared, cf.consultant_roster_id,
                cf.one_off_name, cf.one_off_affiliation, cf.requestdocument_id, cf.updated_at,
                r.name AS roster_name, r.affiliation AS roster_affiliation
           FROM consultant_feedback cf
           LEFT JOIN expertise_roster r ON r.id = cf.consultant_roster_id
          WHERE cf.request_id = $1 AND cf.mutation_id = $2`,
        [requestId, mutationId],
      );
      // Checked BEFORE COMMIT: if this ever fires, the transaction still rolls
      // back cleanly in the catch below instead of the catch issuing a ROLLBACK
      // against an already-committed transaction (a no-op at best, an error at
      // worst, and either way not what "something went wrong" should mean here).
      if (!rows[0]) throw new ServiceHttpError('Consultant feedback entry could not be created.', { httpStatus: 500 });
      await client.query('COMMIT');
      return mapRow(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      // A unique violation on `requestdocument_id` (SQLSTATE 23505) means a
      // prior replay of this same finalize already created the entry bound to
      // this exact registry row (the `ON CONFLICT (request_id, mutation_id)`
      // clause only dedupes on mutation id; a retry that happens to allocate a
      // NEW mutation id for the same staged attachment hits this constraint
      // instead). Select and return that row rather than failing the retry.
      if (requestdocumentId != null && error?.code === '23505') {
        const { rows: existingRows } = await sql.query(
          `SELECT cf.id, to_char(cf.received_on, 'YYYY-MM-DD') AS received_on, cf.body_html, cf.shared, cf.consultant_roster_id,
                  cf.one_off_name, cf.one_off_affiliation, cf.requestdocument_id, cf.updated_at,
                  r.name AS roster_name, r.affiliation AS roster_affiliation
             FROM consultant_feedback cf
             LEFT JOIN expertise_roster r ON r.id = cf.consultant_roster_id
            WHERE cf.request_id = $1 AND cf.requestdocument_id = $2`,
          [requestId, requestdocumentId],
        );
        if (existingRows[0]) return mapRow(existingRows[0]);
      }
      throw error;
    }
  });
}

/**
 * Body/receivedOn/shared/author edits. The client may resubmit the current
 * author fields on every save, so a `consultantRosterId`/`oneOff` key
 * being PRESENT in `patch` does not by itself mean the author changed:
 * eligibility re-runs only when the submitted author differs BY VALUE from
 * the stored row. A same-value resubmission (e.g. editing only the body of
 * an entry whose roster consultant was since deactivated) is treated as
 * author-unchanged and never re-checked (§3.2).
 */
export async function updateFeedbackEntry({ id, requestId, actorProfileId, patch = {} }) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  if (!isPositiveInt(id)) throw badRequest('id is required.', 'invalid_id');
  if (!isPositiveInt(actorProfileId)) {
    throw badRequest('actorProfileId is required.', 'invalid_actor');
  }
  const patchHasAuthorKey = Object.prototype.hasOwnProperty.call(patch, 'consultantRosterId')
    || Object.prototype.hasOwnProperty.call(patch, 'oneOff');

  // Excluded transaction shape: kept verbatim on a withClient client rather
  // than withTransaction. Recorded behaviour difference: withClient destroys
  // the connection on any throw out of this callback instead of this
  // function's former unconditional `finally { client.release(); }`, which
  // always returned it to the pool.
  return withClient(async (client) => {
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        `SELECT id, consultant_roster_id, one_off_name, one_off_affiliation, body_html,
                to_char(received_on, 'YYYY-MM-DD') AS received_on, requestdocument_id, shared
           FROM consultant_feedback WHERE id = $1 AND request_id = $2 AND status = 'active' FOR UPDATE`,
        [Number(id), requestId],
      );
      const existing = existingRows[0];
      if (!existing) {
        // The row is gone or `deleting` (the `status = 'active'` filter above
        // excludes both). A plain edit gets an ordinary 404. An attachment
        // bind attempt (finalize) gets a distinct, PERMANENT 409: the target
        // lost a real race (a delete won) rather than a client mistake, so
        // finalize's loser-side cleanup must run and the staging row must be
        // rejected, not released for a retry that can never succeed.
        if (Object.prototype.hasOwnProperty.call(patch, 'requestdocumentId')) {
          throw new ServiceHttpError('This entry is no longer available to attach to.', {
            httpStatus: 409,
            body: { error: 'This entry is no longer available to attach to.', reason: 'attachment_target_gone' },
          });
        }
        throw notFound();
      }

    let consultantRosterId = existing.consultant_roster_id;
    let oneOffName = existing.one_off_name;
    let oneOffAffiliation = existing.one_off_affiliation;
    if (patchHasAuthorKey) {
      const nextConsultantRosterId = Object.prototype.hasOwnProperty.call(patch, 'consultantRosterId') ? patch.consultantRosterId : null;
      const nextOneOff = Object.prototype.hasOwnProperty.call(patch, 'oneOff') ? patch.oneOff : null;
      const { hasRoster } = validateAuthorInput({ consultantRosterId: nextConsultantRosterId, oneOff: nextOneOff });
      const nextRosterId = hasRoster ? Number(nextConsultantRosterId) : null;
      const nextOneOffName = hasRoster ? null : String(nextOneOff.name).trim();
      const nextOneOffAffiliation = hasRoster ? null : (nextOneOff.affiliation != null ? String(nextOneOff.affiliation).trim() || null : null);
      // The submitted author is compared by VALUE against the stored row, not
      // by whether the client happened to include the key: the client may
      // resubmit the current author fields on every save, so key presence
      // alone would treat every body/date/share-only edit as an author change
      // and needlessly re-run eligibility (§3.2 — a body-only edit must not
      // fail for an entry whose consultant was since deactivated).
      const authorUnchanged = nextRosterId === existing.consultant_roster_id
        && nextOneOffName === existing.one_off_name
        && nextOneOffAffiliation === existing.one_off_affiliation;
      if (!authorUnchanged && hasRoster) await assertConsultantEligible(client, nextRosterId);
      consultantRosterId = nextRosterId;
      oneOffName = nextOneOffName;
      oneOffAffiliation = nextOneOffAffiliation;
    }

    let bodyHtml = existing.body_html;
    if (Object.prototype.hasOwnProperty.call(patch, 'bodyHtml')) {
      if (typeof patch.bodyHtml === 'string' && patch.bodyHtml.length > MAX_BODY_LENGTH) {
        throw badRequest('bodyHtml is too long.', 'body_too_long');
      }
      const sanitizedBody = typeof patch.bodyHtml === 'string' ? sanitizeReviewHtml(patch.bodyHtml) : null;
      if (!sanitizedBody || isEffectivelyEmptyHtml(sanitizedBody)) {
        // Slice 1: no attachment means the body may never become empty.
        if (existing.requestdocument_id == null) throw badRequest('bodyHtml is required.', 'body_required');
      }
      bodyHtml = sanitizedBody;
    }

    const receivedOn = Object.prototype.hasOwnProperty.call(patch, 'receivedOn')
      ? normalizeReceivedOn(patch.receivedOn)
      : existing.received_on;
    const shared = Object.prototype.hasOwnProperty.call(patch, 'shared') ? normalizeShared(patch.shared) : existing.shared;

    // Attachment binding (slice 2 finalize step 7 ONLY — see writeFeedbackEntry's
    // matching note). Refuse a bind when the row already carries an attachment
    // (§4 "Slice 2 registry contract": one attachment per entry) or is being
    // deleted (already excluded above since the SELECT only finds `active` rows,
    // but the plan states the rule explicitly — a 'deleting' row never reaches
    // here at all).
    let requestdocumentId = existing.requestdocument_id;
    if (Object.prototype.hasOwnProperty.call(patch, 'requestdocumentId')) {
      if (!isGuid(patch.requestdocumentId)) {
        throw badRequest('requestdocumentId must be a GUID.', 'invalid_requestdocument_id');
      }
      const isSameAttachment = existing.requestdocument_id != null
        && String(existing.requestdocument_id).toLowerCase() === String(patch.requestdocumentId).toLowerCase();
      if (existing.requestdocument_id != null && !isSameAttachment) {
        throw new ServiceHttpError('This entry already has an attachment.', {
          httpStatus: 409,
          body: { error: 'This entry already has an attachment.', reason: 'attachment_conflict' },
        });
      }
      // Binding the IDENTICAL id the row already holds is a replay of a
      // successful bind whose response was lost before `completePortalUpload`
      // ran (finalize crashed, or the staging lease simply expired) — an
      // idempotent success, not a conflict. Falling through here (instead of
      // throwing) makes the UPDATE below a no-op write of the same value.
      requestdocumentId = patch.requestdocumentId;
    }

    const { rows } = await client.query(
      `UPDATE consultant_feedback
          SET consultant_roster_id = $1, one_off_name = $2, one_off_affiliation = $3,
              body_html = $4, received_on = $5, shared = $6, requestdocument_id = $7, updated_by = $8, updated_at = now()
        WHERE id = $9
      RETURNING id, to_char(received_on, 'YYYY-MM-DD') AS received_on, body_html, shared, consultant_roster_id, one_off_name, one_off_affiliation, requestdocument_id, updated_at`,
      [consultantRosterId, oneOffName, oneOffAffiliation, bodyHtml, receivedOn, shared, requestdocumentId, Number(actorProfileId), existing.id],
    );
    await client.query('COMMIT');
    const row = rows[0];
    let rosterName = null;
    let rosterAffiliation = null;
    if (row.consultant_roster_id != null) {
      const rosterRows = (await sql.query('SELECT name, affiliation FROM expertise_roster WHERE id = $1', [row.consultant_roster_id])).rows;
      rosterName = rosterRows[0]?.name ?? null;
      rosterAffiliation = rosterRows[0]?.affiliation ?? null;
    }
    return mapRow({ ...row, roster_name: rosterName, roster_affiliation: rosterAffiliation });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  });
}

/** Hard delete where `status = 'active'` (CF5; slice 1 has no supersede-first lifecycle). */
/**
 * §3.6 steps 2-3, idempotent: supersede the registry row (a no-op when
 * already Superseded), then delete the Postgres row iff it is still
 * `deleting`. Shared by `deleteFeedbackEntry` (step 1's caller) and the
 * `listConsultantFeedback` recovery sweep, which finds a row already left in
 * `deleting` by a prior crash.
 */
async function finishThreeStepDelete({ id, requestdocumentId, dependencies }) {
  if (requestdocumentId) {
    await dependencies.supersedeDocument(requestdocumentId);
  }
  await sql.query(`DELETE FROM consultant_feedback WHERE id = $1 AND status = 'deleting'`, [Number(id)]);
}

/**
 * CF5 hard delete. A row with no attachment deletes in one statement, as
 * slice 1 always did. A row with an attachment runs the plan §3.6 three
 * ordered steps: mark `deleting` (so it is immediately invisible to every
 * `status = 'active'` reader) in its own same-client transaction, then
 * supersede the registry row, then the final delete. If step 2 or 3 fails
 * here, the row is left `deleting` and the next `listConsultantFeedback`
 * sweep for this request finishes it.
 */
export async function deleteFeedbackEntry({ id, requestId, actorProfileId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) throw badRequest('requestId must be a GUID.', 'invalid_request_id');
  if (!isPositiveInt(id)) throw badRequest('id is required.', 'invalid_id');
  if (!isPositiveInt(actorProfileId)) {
    throw badRequest('actorProfileId is required.', 'invalid_actor');
  }

  // Excluded transaction shape: kept verbatim on a withClient client rather
  // than withTransaction. Recorded behaviour difference: withClient destroys
  // the connection on any throw out of this callback instead of this
  // function's former unconditional `finally { client.release(); }`, which
  // always returned it to the pool. The callback previously had TWO exit
  // points that returned straight out of deleteFeedbackEntry (the
  // no-attachment hard-delete, and falling through to steps 2-3 below); a
  // withClient callback can only resolve once, so both are now expressed as
  // a `{ done, result | marked }` value the code after `withClient` branches
  // on — a JS-level control-flow change only, no SQL statement changed.
  const step1 = await withClient(async (client) => {
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, requestdocument_id FROM consultant_feedback WHERE id = $1 AND request_id = $2 AND status = 'active' FOR UPDATE`,
        [Number(id), requestId],
      );
      if (!rows[0]) throw notFound();
      if (rows[0].requestdocument_id == null) {
        // No attachment: slice 1's single-statement hard delete, in the same
        // transaction as the row lock above.
        await client.query(`DELETE FROM consultant_feedback WHERE id = $1`, [rows[0].id]);
        await client.query('COMMIT');
        return { done: true, result: { id: String(rows[0].id) } };
      }
      await client.query(`UPDATE consultant_feedback SET status = 'deleting', updated_at = now() WHERE id = $1`, [rows[0].id]);
      await client.query('COMMIT');
      return { done: false, marked: rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  if (step1.done) return step1.result;
  const marked = step1.marked;

  try {
    await finishThreeStepDelete({ id: marked.id, requestdocumentId: marked.requestdocument_id, dependencies });
    return { id: String(marked.id) };
  } catch (error) {
    // Step 1 already committed: the entry is gone from every `active` reader.
    // Steps 2-3 are recoverable — the next list-sweep for this request
    // finishes them — so surface a distinct signal rather than a generic 500.
    console.error('[consultant-feedback] three-step delete steps 2-3 failed', { id: marked.id, message: error?.message });
    throw new ServiceHttpError('The attachment could not be removed. Delete again to retry.', {
      httpStatus: 502,
      body: { error: 'The attachment could not be removed. Delete again to retry.', reason: 'attachment_removal_pending', id: String(marked.id) },
    });
  }
}

/**
 * Briefing read model (§3.3). Catches query errors and returns `unavailable`
 * with a structured log instead of throwing, so a fault on this table alone
 * never fails the whole briefing context.
 */
export async function loadSharedConsultantFeedbackForBriefing(requestId, dependencies = DEFAULT_DEPENDENCIES) {
  try {
    if (!isGuid(requestId)) return { status: 'ok', items: [] };
    const { rows } = await sql.query(
      `SELECT to_char(cf.received_on, 'YYYY-MM-DD') AS received_on, cf.body_html, cf.consultant_roster_id, cf.one_off_name, cf.one_off_affiliation,
              cf.requestdocument_id,
              r.name AS roster_name, r.affiliation AS roster_affiliation
         FROM consultant_feedback cf
         LEFT JOIN expertise_roster r ON r.id = cf.consultant_roster_id
        WHERE cf.request_id = $1 AND cf.status = 'active' AND cf.shared = true
        ORDER BY cf.received_on DESC, cf.id DESC`,
      [requestId],
    );
    // §3.3 "New document member kind feedback:<requestdocumentid>": exposed
    // to the briefing page only when the registry row is Ready and not
    // Superseded — read live so a delete's supersede (§3.6) removes the link
    // on the next context load with no cache to invalidate.
    const { map: registryMap, unavailableIds } = await loadRegistryMap(rows.map((row) => row.requestdocument_id), dependencies);
    return {
      status: 'ok',
      items: rows.map((row) => {
        const docKey = row.requestdocument_id ? String(row.requestdocument_id).toLowerCase() : null;
        if (docKey && unavailableIds.has(docKey)) {
          return {
            name: row.consultant_roster_id != null ? (row.roster_name ?? null) : (row.one_off_name ?? null),
            affiliation: row.consultant_roster_id != null ? (row.roster_affiliation ?? null) : (row.one_off_affiliation ?? null),
            receivedOn: String(row.received_on),
            bodyHtml: row.body_html != null ? sanitizeReviewHtml(row.body_html) : null,
            // A failed registry batch for THIS id only — distinct from "no
            // attachment" or "not eligible to show": the item's own body
            // still renders, but the attachment section says so rather than
            // silently looking like this entry never had a file.
            attachment: { status: 'unavailable' },
          };
        }
        const registryRow = docKey ? registryMap.get(docKey) || null : null;
        const eligible = registryRow
          && registryRow.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
          && registryRow.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED;
        return {
          name: row.consultant_roster_id != null ? (row.roster_name ?? null) : (row.one_off_name ?? null),
          affiliation: row.consultant_roster_id != null ? (row.roster_affiliation ?? null) : (row.one_off_affiliation ?? null),
          receivedOn: String(row.received_on),
          bodyHtml: row.body_html != null ? sanitizeReviewHtml(row.body_html) : null,
          attachment: eligible
            ? {
              member: `feedback:${row.requestdocument_id}`,
              filename: registryRow.wmkf_filename || null,
              // Same rule as the materials section's `materialDescriptor`
              // (briefing-page-service.js): PDF opens inline, everything
              // else downloads (D23/D28).
              inline: /\.pdf$/i.test(registryRow.wmkf_filename || ''),
            }
            : null,
        };
      }),
    };
  } catch (error) {
    console.error('[consultant-feedback] briefing read failed', { requestId, message: error?.message });
    return { status: 'unavailable', items: [] };
  }
}
