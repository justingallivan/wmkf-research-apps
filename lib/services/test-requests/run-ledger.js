/**
 * Test Request Factory durable run ledger (slice 5a).
 *
 * Design doc: docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md,
 * "Operation contract and recovery" + stage "3. Basic clone". Backing
 * tables: lib/db/migrations/054_test_request_runs.sql
 * (test_request_runs, test_request_run_resources).
 *
 * Contract:
 *   - This store is operational orchestration only. Dataverse remains
 *     request/document-registry authority; SharePoint remains file
 *     authority. Never pass credentials, bearer links, document bodies,
 *     purpose text, create request bodies, or bundle contents into any
 *     write here — only identities, hashes/digests, sizes, timestamps, and
 *     sanitized error text (see sanitizeErrorMessage below).
 *   - All SQL goes through an injected `{ query(text, params) -> { rows },
 *     transaction(fn) }` interface (see run-ledger-db.js for concrete
 *     adapters). createRunLedger(db) never imports a Postgres client
 *     directly, so it is testable with a recording fake.
 *   - reserveRun is the only writer that races on a client-supplied key
 *     (actor_id, idempotency_key). The run_id, destination_request_id and
 *     destination_location_id in `plan` MUST be derived deterministically
 *     by the caller from (actorId, idempotencyKey) (e.g. UUIDv5) so a lost
 *     first response and a retried confirm compute the identical values.
 *     reserveRun itself is reserve-or-return: on a genuine second attempt
 *     the `INSERT ... ON CONFLICT DO NOTHING` is a no-op and the following
 *     SELECT reads back the FIRST attempt's stored row -- including its
 *     destination GUIDs -- so the caller-supplied plan's GUIDs are only
 *     ever used the very first time a key is reserved. A same-key retry
 *     therefore can never produce a second destination GUID even if the
 *     caller's deterministic derivation had a bug, because the stored row
 *     always wins once one exists.
 *   - Every other mutation is fenced by lease_token + lease_generation
 *     (+ version, + locked_until where noted), following the convention in
 *     lib/services/scheduled-email-store.js. A fence miss returns null
 *     (never throws) so callers can treat it as "someone else owns this
 *     now" rather than an error.
 */

import crypto from 'node:crypto';
import { ServiceHttpError } from '../service-http-error.js';

const ERROR_MAX = 500;

/** Strips bearer tokens and caps length before anything reaches the ledger. */
const SECRET_TEXT_PATTERNS = [
  [/Bearer\s+\S+/gi, 'Bearer [redacted]'],
  [/(Authorization"?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\n"',;}]*)/gi, '$1[redacted]'],
  [/([?&](?:sig|sv|se|sp|skoid|sktid|tempauth|access_token|token)=)[^&\s"']+/gi, '$1[redacted]'],
  [/https?:\/\/[^\s"']*(?:download|tempauth|sharepoint\.com\/[^\s"']*_layouts)[^\s"']*/gi, '[redacted-url]'],
];
const SECRET_KEY_PATTERN = /token|secret|authorization|password|downloadurl|tempauth|signature|cookie|body|content|purpose/i;

export function sanitizeErrorMessage(message) {
  let text = String(message ?? '');
  for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) text = text.replace(pattern, replacement);
  return text.slice(0, ERROR_MAX);
}

const HEX64 = /^[0-9a-f]{64}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_NUMBER = /^\d{1,10}$/;

// Per-key value grammars. There is deliberately no free-text key: every
// string a receipt may carry is an identifier, a filename or path made of
// app-chosen segments, an enum token, or a date-like value. Human-readable
// reasons live only in the run row's sanitized needs_attention_reason.
const IDENTIFIER = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9!_\-.:]{1,160})$/i;
const GRAPH_DRIVE_OR_SITE = /^[A-Za-z0-9!_\-.:,]{1,200}$/;
const PATH_SEGMENTS = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9 _.\-()&,'\/]{1,200}$/;
const FILENAME = /^(?!\.)[A-Za-z0-9 _\-()]{1,60}\.[A-Za-z0-9]{1,8}$/;
const LIBRARY = /^[a-z][a-z0-9_]{1,60}$/;
const ENUM_TOKEN = /^[a-z][a-z0-9_\-]{0,39}$/;
const STATUS_TOKEN = /^[A-Za-z][A-Za-z0-9_\- ]{0,39}$/;
const VERSION_TAG = /^[A-Za-z0-9"{}\-.,: ]{1,80}$/;
const MIME = /^[a-z]+\/[a-z0-9.+\-]{1,80}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const DATE_LIKE = /^(?:\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z?)?|[A-Za-z]{3,9} \d{4}|\d{1,10})$/;
const DIGITS_OR_NULL = /^\d{1,20}$/;

const KEY_RULES = Object.freeze({
  requestId: GUID, runId: GUID, locationId: GUID, parentLocationId: GUID, workflowId: GUID, ownerId: GUID,
  createdById: GUID, expectedAppUserId: GUID, applicantId: GUID, organizationId: GUID,
  requestNumber: REQUEST_NUMBER,
  itemId: IDENTIFIER, folderItemId: IDENTIFIER, graphItemId: IDENTIFIER, sourceGraphItemId: IDENTIFIER,
  driveId: GRAPH_DRIVE_OR_SITE, sourceDriveId: GRAPH_DRIVE_OR_SITE, siteId: GRAPH_DRIVE_OR_SITE,
  library: LIBRARY, folder: PATH_SEGMENTS, relativeUrl: PATH_SEGMENTS, filename: FILENAME, name: FILENAME,
  mimeType: MIME, eTag: VERSION_TAG, versionId: VERSION_TAG,
  versionNumber: DIGITS_OR_NULL, versionNumberBefore: DIGITS_OR_NULL, versionNumberAfter: DIGITS_OR_NULL,
  contentHash: HEX64,
  status: STATUS_TOKEN, outcome: ENUM_TOKEN, kind: ENUM_TOKEN, field: FIELD_NAME,
  expectedValue: DATE_LIKE, actualValue: DATE_LIKE, valueBefore: DATE_LIKE, valueAfter: DATE_LIKE,
  fiscalYear: DATE_LIKE, meetingDate: DATE_LIKE,
  requestIds: GUID, itemIds: IDENTIFIER, locationIds: GUID, resourceIds: DIGITS_OR_NULL,
});
const NUMERIC_KEYS = new Set(['size', 'statusCode', 'responseStatus', 'sequence', 'index', 'count', 'versionNumber']);
const BOOLEAN_KEYS = new Set([
  'sha256Match', 'sizeMatch', 'recovered', 'recoveredByExactItem', 'restored', 'restoreVerified',
  'restoreWasAlreadyActive', 'manualRecheckRequired', 'matched', 'exists', 'ok',
]);
const ARRAY_KEYS = new Set(['requestIds', 'itemIds', 'locationIds', 'resourceIds']);
const TIMESTAMP_KEY = /^[a-z][A-Za-z0-9]{0,40}At$/;
const FORBIDDEN_STEM = /body|content|purpose|token|secret|download|narrative|bytes|title|text|note|message/i;

/**
 * Allowlist of receipt keys a resource row may carry in planned_identity,
 * source_provenance or readback: identities, hashes, sizes, statuses,
 * timestamps and narrowly bounded labels only (design doc, "Operation
 * contract and recovery"). Every key has a value grammar; unknown keys are
 * rejected, never redacted. Slice 5b's runner must fit its receipts here.
 */
export const LEDGER_RECEIPT_KEYS = Object.freeze([
  ...Object.keys(KEY_RULES), ...NUMERIC_KEYS, ...BOOLEAN_KEYS,
].filter((key, index, list) => list.indexOf(key) === index));

function unsafe(detail) {
  return new ServiceHttpError(`Ledger receipt rejected: ${detail}.`, {
    httpStatus: 400,
    code: 'test_request_ledger_unsafe_value',
  });
}

function assertString(key, value, rule) {
  if (typeof value !== 'string') throw unsafe(`${key} must be a string`);
  if (value.length > 200) throw unsafe(`${key} exceeds 200 characters`);
  if (/[\n\r\t]/.test(value)) throw unsafe(`${key} contains control characters`);
  if (/https?:\/\/|\/\//i.test(value)) throw unsafe(`${key} carries a URL`);
  if (sanitizeErrorMessage(value) !== value) throw unsafe(`${key} looks like a credential or link`);
  if (!rule.test(value)) throw unsafe(`${key} does not match its allowed shape`);
}

function assertReceiptValue(key, value) {
  if (value === null || value === undefined) return;
  if (TIMESTAMP_KEY.test(key) && !(key in KEY_RULES)) {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || value.length > 40) {
      throw unsafe(`${key} is not a timestamp`);
    }
    return;
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value !== 'boolean') throw unsafe(`${key} must be a boolean`);
    return;
  }
  if (NUMERIC_KEYS.has(key) && typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 1e15) throw unsafe(`${key} is out of range`);
    return;
  }
  if (ARRAY_KEYS.has(key)) {
    if (!Array.isArray(value)) throw unsafe(`${key} must be an array`);
    if (value.length > 100) throw unsafe(`${key} has more than 100 entries`);
    for (const item of value) assertString(key, item, KEY_RULES[key]);
    return;
  }
  const rule = KEY_RULES[key];
  if (!rule) throw unsafe(`${key} has no value grammar`);
  assertString(key, value, rule);
}

/**
 * Validate a receipt object against the allowlist. Unknown keys, nested
 * objects, over-long or ill-shaped strings, credentials, links, bodies and
 * source text are rejected with 400 test_request_ledger_unsafe_value.
 * Returns the value unchanged so callers can bind it.
 */
export function assertLedgerReceipt(value, field = 'receipt') {
  if (value == null) return value;
  if (typeof value !== 'object' || Array.isArray(value)) throw unsafe(`${field} must be an object`);
  const keys = Object.keys(value);
  if (keys.length > 40) throw unsafe(`${field} has more than 40 keys`);
  for (const key of keys) {
    const known = key in KEY_RULES || NUMERIC_KEYS.has(key) || BOOLEAN_KEYS.has(key);
    const timestamp = TIMESTAMP_KEY.test(key) && !FORBIDDEN_STEM.test(key);
    if (!known && !timestamp) throw unsafe(`${field}.${key} is not an allowlisted receipt key`);
    assertReceiptValue(key, value[key]);
  }
  return value;
}

export function requestNumberOrThrow(value) {
  if (value === null || value === undefined) return null;
  if (!REQUEST_NUMBER.test(String(value))) {
    throw new ServiceHttpError('Destination request number must be bounded digits.', {
      httpStatus: 400,
      code: 'test_request_run_invalid_request_number',
    });
  }
  return String(value);
}


function mapRun(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    actorId: row.actor_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    currentStep: row.current_step,
    stepIndex: row.step_index,
    recipe: row.recipe,
    sourceDataverseHost: row.source_dataverse_host,
    sourceRequestId: row.source_request_id,
    sourceRequestNumber: row.source_request_number,
    sourceRevision: row.source_revision,
    bundleSha256: row.bundle_sha256,
    bundleExportedAt: row.bundle_exported_at,
    copyPolicyVersion: row.copy_policy_version,
    copyPolicyDigest: row.copy_policy_digest,
    planDigest: row.plan_digest,
    createBodySha256: row.create_body_sha256,
    destinationEnvironment: row.destination_environment,
    destinationDataverseHost: row.destination_dataverse_host,
    destinationRequestId: row.destination_request_id,
    destinationLocationId: row.destination_location_id,
    destinationRequestNumber: row.destination_request_number,
    expectedAppUserId: row.expected_app_user_id,
    expectedOrganizationId: row.expected_organization_id,
    expectedGraphSiteId: row.expected_graph_site_id,
    expectedGraphDriveId: row.expected_graph_drive_id,
    fiscalYear: row.fiscal_year,
    meetingDate: row.meeting_date,
    testLabel: row.test_label,
    version: row.version,
    leaseToken: row.lease_token,
    leaseGeneration: row.lease_generation,
    lockedUntil: row.locked_until,
    attemptCount: row.attempt_count,
    needsAttentionReason: row.needs_attention_reason,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapResource(row) {
  if (!row) return null;
  return {
    resourceId: row.resource_id,
    runId: row.run_id,
    sequence: row.sequence,
    step: row.step,
    resourceKind: row.resource_kind,
    system: row.system,
    plannedIdentity: row.planned_identity,
    sourceProvenance: row.source_provenance,
    dispatchedAt: row.dispatched_at,
    responseStatus: row.response_status,
    readback: row.readback,
    outcome: row.outcome,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fenceConflict(message) {
  return new ServiceHttpError(message, { httpStatus: 409, code: 'test_request_run_fenced' });
}

/**
 * Locks the run row (SELECT ... FOR UPDATE) inside an open transaction and
 * checks the caller's lease token/generation and that the lease has not
 * expired. Used by every resource-journal write, which is fenced through
 * the run row rather than carrying its own lease columns.
 */
async function assertLeaseFence(tx, { runId, leaseToken, leaseGeneration }) {
  const { rows } = await tx.query(
    // Expiry is judged by the database clock, like every sibling fence's
    // `locked_until > NOW()`, so app/DB clock skew cannot split the verdict.
    `SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS lease_live
       FROM test_request_runs WHERE run_id = $1::uuid FOR UPDATE`,
    [runId],
  );
  const row = rows[0];
  if (!row) {
    throw new ServiceHttpError('Test request run not found.', {
      httpStatus: 404,
      code: 'test_request_run_not_found',
    });
  }
  if (
    row.lease_token !== leaseToken
    || Number(row.lease_generation) !== Number(leaseGeneration)
    || row.lease_live !== true
  ) {
    throw fenceConflict('Lease fence check failed: this worker no longer owns the run.');
  }
  return row;
}

/**
 * @param {{ query: Function, transaction: Function }} db
 */
export function createRunLedger(db) {
  return {
    /**
     * Reserve-or-return on (actorId, idempotencyKey). `plan` must supply the
     * full row payload the FIRST time a key is reserved; a same-key retry
     * ignores everything in `plan` except planDigest (used only to detect a
     * conflicting retry) because the stored row always wins. See file
     * header for why this makes a duplicate destination GUID impossible.
     */
    async reserveRun({ actorId, idempotencyKey, plan }) {
      return db.transaction(async (tx) => {
        const insertResult = await tx.query(
          `INSERT INTO test_request_runs (
             run_id, actor_id, idempotency_key,
             status, current_step, step_index, recipe,
             source_dataverse_host, source_request_id, source_request_number, source_revision,
             bundle_sha256, bundle_exported_at,
             copy_policy_version, copy_policy_digest, plan_digest, create_body_sha256,
             destination_environment, destination_dataverse_host,
             destination_request_id, destination_location_id,
             expected_app_user_id, expected_organization_id,
             expected_graph_site_id, expected_graph_drive_id,
             fiscal_year, meeting_date, test_label
           ) VALUES (
             $1::uuid, $2::text, $3::text,
             'prepared', 'fence_source', 0, $4::text,
             $5::text, $6::uuid, $7::text, $8::text,
             $9::text, $10::timestamptz,
             $11::text, $12::text, $13::text, $14::text,
             $15::text, $16::text,
             $17::uuid, $18::uuid,
             $19::uuid, $20::uuid,
             $21::text, $22::text,
             $23::text, $24::date, $25::text
           )
           ON CONFLICT (actor_id, idempotency_key) DO NOTHING
           RETURNING run_id`,
          [
            plan.runId, actorId, idempotencyKey,
            plan.recipe,
            plan.sourceDataverseHost, plan.sourceRequestId, plan.sourceRequestNumber, plan.sourceRevision,
            plan.bundleSha256, plan.bundleExportedAt,
            plan.copyPolicyVersion, plan.copyPolicyDigest, plan.planDigest, plan.createBodySha256,
            plan.destinationEnvironment, plan.destinationDataverseHost,
            plan.destinationRequestId, plan.destinationLocationId,
            plan.expectedAppUserId, plan.expectedOrganizationId,
            plan.expectedGraphSiteId, plan.expectedGraphDriveId,
            plan.fiscalYear, plan.meetingDate, plan.testLabel,
          ],
        );

        const { rows } = await tx.query(
          `SELECT * FROM test_request_runs WHERE actor_id = $1::text AND idempotency_key = $2::text`,
          [actorId, idempotencyKey],
        );
        const existing = rows[0];
        if (!existing) {
          throw new ServiceHttpError('Test request run could not be reserved.', { httpStatus: 500 });
        }
        if (existing.plan_digest !== plan.planDigest) {
          throw new ServiceHttpError(
            'A different test request run already exists for this idempotency key.',
            { httpStatus: 409, code: 'test_request_run_conflict' },
          );
        }
        const created = (insertResult.rows || []).length > 0;
        return { run: mapRun(existing), created };
      });
    },

    async claimLease({ runId, expectedVersion, leaseSeconds = 300 }) {
      const leaseToken = crypto.randomUUID();
      const seconds = Math.min(900, Math.max(30, Number(leaseSeconds) || 300));
      const { rows } = await db.query(
        `UPDATE test_request_runs
            SET lease_token = $2::uuid,
                lease_generation = lease_generation + 1,
                locked_until = NOW() + ($3::text || ' seconds')::interval,
                attempt_count = attempt_count + 1,
                version = version + 1,
                updated_at = NOW()
          WHERE run_id = $1::uuid
            AND version = $4::integer
            AND status IN ('prepared', 'creating', 'needs_attention')
            AND (locked_until IS NULL OR locked_until < NOW())
          RETURNING *`,
        [runId, leaseToken, String(seconds), expectedVersion],
      );
      return mapRun(rows[0] || null);
    },

    async renewLease({ runId, leaseToken, leaseGeneration, leaseSeconds = 300 }) {
      const seconds = Math.min(900, Math.max(30, Number(leaseSeconds) || 300));
      const { rows } = await db.query(
        `UPDATE test_request_runs
            SET locked_until = NOW() + ($4::text || ' seconds')::interval,
                updated_at = NOW()
          WHERE run_id = $1::uuid
            AND lease_token = $2::uuid
            AND lease_generation = $3::integer
          RETURNING *`,
        [runId, leaseToken, leaseGeneration, String(seconds)],
      );
      return mapRun(rows[0] || null);
    },

    async releaseLease({ runId, leaseToken, leaseGeneration }) {
      const { rows } = await db.query(
        `UPDATE test_request_runs
            SET lease_token = NULL,
                locked_until = NULL,
                updated_at = NOW()
          WHERE run_id = $1::uuid
            AND lease_token = $2::uuid
            AND lease_generation = $3::integer
          RETURNING *`,
        [runId, leaseToken, leaseGeneration],
      );
      return mapRun(rows[0] || null);
    },

    async advanceStep({
      runId, leaseToken, leaseGeneration, expectedVersion, nextStep, nextStepIndex, status = null,
      destinationRequestNumber = null,
    }) {
      const requestNumber = requestNumberOrThrow(destinationRequestNumber);
      // advanceStep only moves a run forward within the working states;
      // needs_attention/ready have dedicated writers that satisfy the
      // table's coherence CHECKs, and retirement is a separate operation.
      if (status !== null && status !== 'creating') {
        throw new ServiceHttpError('advanceStep may only set status to creating.', {
          httpStatus: 400,
          code: 'test_request_run_invalid_status',
        });
      }
      const { rows } = await db.query(
        `UPDATE test_request_runs
            SET current_step = $5::text,
                step_index = $6::integer,
                status = COALESCE($7::text, status),
                destination_request_number = COALESCE($8::text, destination_request_number),
                needs_attention_reason = CASE
                  WHEN COALESCE($7::text, status) = 'needs_attention' THEN needs_attention_reason
                  ELSE NULL
                END,
                version = version + 1,
                updated_at = NOW()
          WHERE run_id = $1::uuid
            AND lease_token = $2::uuid
            AND lease_generation = $3::integer
            AND version = $4::integer
            AND locked_until > NOW()
          RETURNING *`,
        [runId, leaseToken, leaseGeneration, expectedVersion, nextStep, nextStepIndex, status, requestNumber],
      );
      return mapRun(rows[0] || null);
    },

    async markReady({
      runId, leaseToken, leaseGeneration, expectedVersion, destinationRequestNumber = null,
    }) {
      // ready must carry the server-assigned number: validated here and
      // required atomically in the WHERE clause (plus the table CHECK).
      const requestNumber = requestNumberOrThrow(destinationRequestNumber);
      const { rows } = await db.query(
        `UPDATE test_request_runs
            SET status = 'ready',
                completed_at = NOW(),
                needs_attention_reason = NULL,
                lease_token = NULL,
                locked_until = NULL,
                destination_request_number = COALESCE($5::text, destination_request_number),
                version = version + 1,
                updated_at = NOW()
          WHERE run_id = $1::uuid
            AND lease_token = $2::uuid
            AND lease_generation = $3::integer
            AND version = $4::integer
            AND locked_until > NOW()
            AND COALESCE($5::text, destination_request_number) ~ '^[0-9]{1,10}$'
          RETURNING *`,
        [runId, leaseToken, leaseGeneration, expectedVersion, requestNumber],
      );
      return mapRun(rows[0] || null);
    },

    async markNeedsAttention({
      runId, leaseToken, leaseGeneration, expectedVersion, reason,
    }) {
      const { rows } = await db.query(
        `UPDATE test_request_runs
            SET status = 'needs_attention',
                needs_attention_reason = $5::text,
                lease_token = NULL,
                locked_until = NULL,
                version = version + 1,
                updated_at = NOW()
          WHERE run_id = $1::uuid
            AND lease_token = $2::uuid
            AND lease_generation = $3::integer
            AND version = $4::integer
            AND locked_until > NOW()
          RETURNING *`,
        [runId, leaseToken, leaseGeneration, expectedVersion, sanitizeErrorMessage(reason)],
      );
      return mapRun(rows[0] || null);
    },

    async recordError({
      runId, leaseToken, leaseGeneration, expectedVersion, error,
    }) {
      const { rows } = await db.query(
        `UPDATE test_request_runs
            SET last_error = $5::text,
                version = version + 1,
                updated_at = NOW()
          WHERE run_id = $1::uuid
            AND lease_token = $2::uuid
            AND lease_generation = $3::integer
            AND version = $4::integer
            AND locked_until > NOW()
          RETURNING *`,
        [runId, leaseToken, leaseGeneration, expectedVersion, sanitizeErrorMessage(error?.message ?? error)],
      );
      return mapRun(rows[0] || null);
    },

    async journalPlannedResource({
      runId, leaseToken, leaseGeneration, step, resourceKind, system, plannedIdentity, sourceProvenance = null,
    }) {
      // Validate before any SQL so an unsafe receipt never opens a transaction.
      assertLedgerReceipt(plannedIdentity ?? {}, 'plannedIdentity');
      if (sourceProvenance != null) assertLedgerReceipt(sourceProvenance, 'sourceProvenance');
      return db.transaction(async (tx) => {
        await assertLeaseFence(tx, { runId, leaseToken, leaseGeneration });

        const { rows: seqRows } = await tx.query(
          // The run row is already locked FOR UPDATE by assertLeaseFence in
          // this transaction, which serializes journal calls per run; an
          // aggregate cannot itself take FOR UPDATE in Postgres.
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
             FROM test_request_run_resources
            WHERE run_id = $1::uuid`,
          [runId],
        );
        const nextSequence = seqRows[0]?.next_sequence ?? 1;

        const { rows } = await tx.query(
          `INSERT INTO test_request_run_resources (
             run_id, sequence, step, resource_kind, system, planned_identity, source_provenance
           ) VALUES ($1::uuid, $2::integer, $3::text, $4::text, $5::text, $6::jsonb, $7::jsonb)
           RETURNING *`,
          [
            runId, nextSequence, step, resourceKind, system,
            JSON.stringify(plannedIdentity ?? {}),
            sourceProvenance != null ? JSON.stringify(sourceProvenance) : null,
          ],
        );
        return mapResource(rows[0]);
      });
    },

    async recordResourceDispatched({
      resourceId, runId, leaseToken, leaseGeneration,
    }) {
      return db.transaction(async (tx) => {
        await assertLeaseFence(tx, { runId, leaseToken, leaseGeneration });
        const { rows } = await tx.query(
          `UPDATE test_request_run_resources
              SET dispatched_at = NOW(), outcome = 'dispatched', updated_at = NOW()
            WHERE resource_id = $1::bigint AND run_id = $2::uuid
            RETURNING *`,
          [resourceId, runId],
        );
        return mapResource(rows[0] || null);
      });
    },

    async recordResourceReadback({
      resourceId, runId, leaseToken, leaseGeneration, responseStatus = null, readback = null, outcome,
    }) {
      if (readback != null) assertLedgerReceipt(readback, 'readback');
      return db.transaction(async (tx) => {
        await assertLeaseFence(tx, { runId, leaseToken, leaseGeneration });
        const { rows } = await tx.query(
          `UPDATE test_request_run_resources
              SET response_status = $3::integer,
                  readback = $4::jsonb,
                  outcome = $5::text,
                  updated_at = NOW()
            WHERE resource_id = $1::bigint AND run_id = $2::uuid
            RETURNING *`,
          [resourceId, runId, responseStatus, readback != null ? JSON.stringify(readback) : null, outcome],
        );
        return mapResource(rows[0] || null);
      });
    },

    async recordResourceFailure({
      resourceId, runId, leaseToken, leaseGeneration, outcome, error,
    }) {
      return db.transaction(async (tx) => {
        await assertLeaseFence(tx, { runId, leaseToken, leaseGeneration });
        const { rows } = await tx.query(
          `UPDATE test_request_run_resources
              SET outcome = $3::text, error = $4::text, updated_at = NOW()
            WHERE resource_id = $1::bigint AND run_id = $2::uuid
            RETURNING *`,
          [resourceId, runId, outcome, sanitizeErrorMessage(error?.message ?? error)],
        );
        return mapResource(rows[0] || null);
      });
    },

    async getRun(runId) {
      const { rows } = await db.query(
        `SELECT * FROM test_request_runs WHERE run_id = $1::uuid`,
        [runId],
      );
      return mapRun(rows[0] || null);
    },

    async listRunResources(runId) {
      const { rows } = await db.query(
        `SELECT * FROM test_request_run_resources WHERE run_id = $1::uuid ORDER BY sequence ASC`,
        [runId],
      );
      return rows.map(mapResource);
    },

    async listRuns({ actorId, limit = 50 } = {}) {
      const bounded = Math.min(200, Math.max(1, Number(limit) || 50));
      const { rows } = await db.query(
        `SELECT * FROM test_request_runs WHERE actor_id = $1::text ORDER BY created_at DESC LIMIT $2::integer`,
        [actorId, bounded],
      );
      return rows.map(mapRun);
    },
  };
}
