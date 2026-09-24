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
  // Everything after an Authorization field to end of line goes: schemes
  // with structured parameters (Digest, JSON with escaped quotes) cannot be
  // parsed safely, so the redaction is conservative by construction.
  [/(Authorization"?\s*[:=]\s*)[^\n]*/gi, '$1[redacted]'],
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
// string a receipt may carry is an identifier, a factory-owned filename or
// folder family, an enum token, or a date form. Human-readable reasons live
// only in the run row's sanitized needs_attention_reason / last_error.
// Exact Microsoft Graph identifier shapes (no opaque catch-all):
//   site  = <host>.sharepoint.com,<site guid>,<web guid>
//   drive = b!<base64url>
//   item  = 01 + 32 base32 characters (A-Z, 2-7)
const GRAPH_SITE_ID = /^[a-z0-9.-]+\.sharepoint\.com,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH_DRIVE_ID = /^b![A-Za-z0-9_-]{16,120}$/;
const GRAPH_ITEM_ID = /^01[A-Z2-7]{32}$/;
// Recognized credential markers are rejected ANYWHERE inside a string,
// however they are wrapped or prefixed (`b!ghp_...`, `"glpat-..."`,
// `b!AAAAgithub_pat_...`), since the opaque drive, eTag and version grammars
// could otherwise carry a token inside their syntax. A genuine identifier that
// happens to contain a marker is refused (fail closed), which is the accepted
// cost. Mirrored verbatim in migration 054 (`test_request_receipt_ok` and the
// run-level Graph identifier CHECK).
const CREDENTIAL_SHAPE = /(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8}|glpat-|AIza|Bearer_)/;
// Factory folder families: the request folder `<number>_<GUID hex>` and the
// Basic recipe's subfolders (lib/services/test-requests/file-plan.js).
const REQUEST_FOLDER = String.raw`\d{1,10}_[0-9A-F]{32}`;
const SUBFOLDER = String.raw`(?:Phase I|AI Materials|Reviewer Materials)`;
const PATH_SEGMENTS = new RegExp(`^(?:${REQUEST_FOLDER}(?:\\/${SUBFOLDER})?|${SUBFOLDER})$`);
// Factory filename families (file-plan.js PHASE_I_KINDS and GENERATED_KINDS).
const FILENAME = /^(?:(?:Proposal|ProposalNarrative|ProposalBibliography)_\d{1,10}\.pdf|(?:ProjectDescription|Biosketches|ProjectBudget)\.pdf|Project Budget spreadsheet\.xlsx)$/;
const LIBRARY = /^[a-z][a-z0-9_]{1,60}$/;
const ENUM_TOKEN = /^[a-z][a-z0-9_\-]{0,39}$/;
// Dataverse `W/"123"` and Graph `"{GUID},7"` / `"cTag"` forms only.
const ETAG = /^(?:W\/)?"\{?[0-9A-Za-z\-]{1,40}\}?(?:,\d{1,9})?"$/;
const VERSION_ID = /^(?:\d{1,6}\.\d{1,6}|\d{1,12}|[0-9A-Za-z]{1,40})$/;
const MIME = /^[a-z]+\/[a-z0-9.+\-]{1,80}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const DATE_LIKE = /^(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z?)?|(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})$/;
const DIGITS = /^\d{1,20}$/;

const KEY_RULES = Object.freeze({
  requestId: GUID, runId: GUID, locationId: GUID, parentLocationId: GUID, workflowId: GUID, ownerId: GUID,
  createdById: GUID, expectedAppUserId: GUID, applicantId: GUID, organizationId: GUID,
  requestDocumentId: GUID,
  requestNumber: REQUEST_NUMBER,
  itemId: GRAPH_ITEM_ID, folderItemId: GRAPH_ITEM_ID, graphItemId: GRAPH_ITEM_ID, sourceGraphItemId: GRAPH_ITEM_ID,
  driveId: GRAPH_DRIVE_ID, sourceDriveId: GRAPH_DRIVE_ID, siteId: GRAPH_SITE_ID,
  library: LIBRARY, folder: PATH_SEGMENTS, relativeUrl: PATH_SEGMENTS, filename: FILENAME, name: FILENAME,
  mimeType: MIME, eTag: ETAG, versionId: VERSION_ID, sourceVersionId: VERSION_ID,
  versionNumber: DIGITS, versionNumberBefore: DIGITS, versionNumberAfter: DIGITS,
  contentHash: HEX64, generationKey: HEX64, claimTokenSha256: HEX64, foundationBaselineSha256: HEX64,
  outcome: ENUM_TOKEN, kind: ENUM_TOKEN, field: FIELD_NAME,
  expectedValue: DATE_LIKE, actualValue: DATE_LIKE, valueBefore: DATE_LIKE, valueAfter: DATE_LIKE,
  fiscalYear: DATE_LIKE, meetingDate: DATE_LIKE,
  requestIds: GUID, itemIds: GRAPH_ITEM_ID, locationIds: GUID, resourceIds: DIGITS,
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
 * Attempt-marker timestamp keys the Initial Assessment recipe's step bodies
 * (slice 6b) will journal before each remote mutation, following the same
 * dispatch-marker convention as the Basic recipe's `createAttemptedAt` /
 * `locationCreateAttemptedAt` / `uploadAttemptedAt`. Every one of these
 * already satisfies the generic `<stem>At` TIMESTAMP_KEY grammar above (no
 * FORBIDDEN_STEM match), so none needs its own KEY_RULES entry; this export
 * exists only so 6b's writers and their tests share one spelling. A folder
 * create reuses the Basic recipe's own `graphFolderAttemptedAt`.
 */
export const IA_ATTEMPT_MARKER_KEYS = Object.freeze([
  'registryCreateAttemptedAt', 'registryPatchAttemptedAt', 'graphFolderAttemptedAt', 'changesetAttemptedAt',
]);

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
  if (sanitizeErrorMessage(value) !== value || CREDENTIAL_SHAPE.test(value)) throw unsafe(`${key} looks like a credential or link`);
  if (!rule.test(value)) throw unsafe(`${key} does not match its allowed shape`);
}

function assertReceiptValue(key, value) {
  if (value === null || value === undefined) return;
  if (TIMESTAMP_KEY.test(key) && !(key in KEY_RULES)) {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || value.length > 40 || !DATE_LIKE.test(value)) {
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

/**
 * The finite set of reason / error codes the ledger will store. Nothing
 * outside this set reaches last_error, needs_attention_reason or a resource
 * error column: a foreign error's own code is copied only when it is a
 * member, otherwise the error is classified. Slice 5b's runner and later
 * recipes add codes here by reviewed commit, never at call time.
 */
export const LEDGER_REASON_CODES = Object.freeze([
  // ledger-internal
  'test_request_run_fenced', 'test_request_run_not_found', 'test_request_run_conflict',
  'test_request_run_invalid_status', 'test_request_run_invalid_request_number', 'test_request_ledger_unsafe_value',
  // classifications of foreign errors
  'upstream_http', 'timeout', 'network', 'unknown_error',
  // runner / step outcomes (slice 5b)
  'lease_unavailable', 'step_failed', 'operator_stop', 'preflight_identity_changed', 'manifest_digest_mismatch',
  'bundle_stale', 'source_fence_failed', 'source_changed', 'preallocated_request_present_not_owned',
  'preallocated_request_recovered', 'ambiguous_create_outcome', 'create_rejected',
  'goverify_deactivation_uncertain', 'goverify_restore_unverified', 'goverify_restore_failed',
  'meeting_date_patch_failed', 'meeting_date_readback_mismatch', 'location_preexisting',
  'location_readback_mismatch', 'folder_create_failed', 'file_conflict', 'file_rejected',
  'file_ambiguous_unrecovered', 'file_source_changed', 'file_verification_failed', 'file_copy_failed',
  'observation_side_effects', 'verification_failed', 'request_readback_mismatch',
  'preallocated_request_present', 'file_journal_unverified',
  // Initial Assessment recipe (slice 6a ledger dimension; step bodies land in 6b)
  'ia_claim_lost', 'ia_pointer_mismatch', 'ia_upload_ambiguous', 'ia_snapshot_stale', 'ia_verification_failed',
  'recipe_step_not_built',
]);
const REASON_CODE_SET = new Set(LEDGER_REASON_CODES);
const STORED_REASON = /^([a-z][a-z0-9_]{0,63})(?: \(http (\d{3})\))?$/;

function classifyForeignError(error) {
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus
    : Number.isInteger(error?.status) ? error.status : null;
  if (status !== null) return { token: 'upstream_http', status };
  if (error?.name === 'AbortError' || /timed? ?out/i.test(String(error?.name ?? ''))) return { token: 'timeout', status: null };
  if (/^E[A-Z]+$/.test(String(error?.code ?? ''))) return { token: 'network', status: null };
  return { token: 'unknown_error', status: null };
}

/**
 * Reduce an Error to a stored reason: its own code when that code is in
 * LEDGER_REASON_CODES, otherwise a classification. Message text is never
 * used. Callers keep the full message in their private receipt or log.
 */
export function describeLedgerError(error) {
  const own = typeof error?.code === 'string' && REASON_CODE_SET.has(error.code) ? error.code : null;
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus
    : Number.isInteger(error?.status) ? error.status : null;
  const token = own ?? classifyForeignError(error).token;
  return status !== null && status >= 100 && status <= 599 ? `${token} (http ${status})` : token;
}

/** Accept a member of LEDGER_REASON_CODES (optionally with an http status) or an Error; reject everything else. */
export function ledgerReasonOrThrow(reason) {
  if (reason instanceof Error || (reason && typeof reason === 'object')) return describeLedgerError(reason);
  const match = typeof reason === 'string' ? STORED_REASON.exec(reason) : null;
  if (match && REASON_CODE_SET.has(match[1])) return reason;
  throw new ServiceHttpError('Ledger reasons must be a member of LEDGER_REASON_CODES or an Error, never free text.', {
    httpStatus: 400,
    code: 'test_request_ledger_unsafe_value',
  });
}

/** Finite step identities a run may occupy or a resource may be journaled under. */
export const LEDGER_STEPS = Object.freeze([
  'fence_source', 'create_request', 'correct_meeting_date', 'provision_location', 'copy_file', 'observe', 'verify', 'ready',
  // Initial Assessment recipe (slice 6a ledger dimension; step bodies land in 6b)
  'seed_initial_assessment', 'seed_initial_assessment_snapshot', 'verify_initial_assessment',
]);
const STEP_SET = new Set(LEDGER_STEPS);
const RESOURCE_KINDS = new Set([
  'dataverse_request', 'dataverse_request_patch', 'sharepoint_folder', 'dataverse_document_location', 'sharepoint_file', 'workflow_bypass',
  'dataverse_request_document',
]);
const RESOURCE_SYSTEMS = new Set(['dataverse', 'sharepoint']);
const RESOURCE_OUTCOMES = new Set(['planned', 'dispatched', 'verified', 'recovered', 'conflict', 'rejected', 'ambiguous', 'failed']);
const RECIPES = new Set(['basic', 'initial_assessment']);
const ENVIRONMENTS = new Set(['sandbox', 'production']);
const HOSTNAME = /^[a-z0-9][a-z0-9.\-]{1,253}$/;
// Nothing caller-typed is stored verbatim in the run row:
//   actor_id is either an authenticated principal GUID (`admin:<guid>` /
//   `user:<guid>`, from server auth context) or `cli:<16 hex>`, a one-way
//   digest of the operating-system username produced by cliActorId();
//   idempotency_key is stored as the SHA-256 of the caller's key, so the
//   same key still maps to the same run while the key text never persists.
const ACTOR_ID = /^(?:(?:admin|user):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|cli:[0-9a-f]{16})$/;
const RAW_IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,200}$/; // printable ASCII, hashed before storage

export function cliActorId(username) {
  if (typeof username !== 'string' || !username) throw unsafe('cli actor username is required');
  return `cli:${crypto.createHash('sha256').update(`cli:${username}`).digest('hex').slice(0, 16)}`;
}

export function idempotencyKeyDigest(rawKey) {
  if (typeof rawKey !== 'string' || !RAW_IDEMPOTENCY_KEY.test(rawKey)) throw unsafe('idempotency key must be 1-200 printable ASCII characters');
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
const REVISION = /^(?:W\/)?"?[0-9A-Za-z\-]{1,80}"?$/;
const POLICY_VERSION = /^[a-z0-9][a-z0-9.\-]{0,59}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The ledger's display label is DERIVED from validated fields and never
 * taken from the caller: the operator's own label lives only in the private
 * manifest (it becomes the Request title). Nothing free-text reaches the row.
 */
export function derivedTestLabel(plan) {
  return `TEST ${plan.recipe} clone of ${plan.sourceRequestNumber} run ${String(plan.runId).slice(0, 8)}`;
}

export function stepOrThrow(step) {
  if (typeof step !== 'string' || !STEP_SET.has(step)) throw unsafe(`step ${JSON.stringify(String(step)).slice(0, 40)} is not a member of LEDGER_STEPS`);
  return step;
}

function enumOrThrow(name, value, set) {
  if (typeof value !== 'string' || !set.has(value)) throw unsafe(`${name} is not an allowlisted value`);
  return value;
}

function shapeOrThrow(name, value, rule) {
  if (typeof value !== 'string' || !rule.test(value)) throw unsafe(`${name} does not match its allowed shape`);
  if (CREDENTIAL_SHAPE.test(value)) throw unsafe(`${name} looks like a credential`);
  return value;
}

/** Validate every text column of a reservation before any SQL. */
export function assertReservePlan({ actorId, idempotencyKey, plan }) {
  if (!plan || typeof plan !== 'object') throw unsafe('plan must be an object');
  shapeOrThrow('actorId', actorId, ACTOR_ID);
  idempotencyKeyDigest(idempotencyKey);
  for (const key of ['runId', 'sourceRequestId', 'destinationRequestId', 'destinationLocationId', 'expectedAppUserId', 'expectedOrganizationId']) {
    shapeOrThrow(`plan.${key}`, plan[key], GUID);
  }
  enumOrThrow('plan.recipe', plan.recipe, RECIPES);
  enumOrThrow('plan.destinationEnvironment', plan.destinationEnvironment, ENVIRONMENTS);
  shapeOrThrow('plan.sourceDataverseHost', plan.sourceDataverseHost, HOSTNAME);
  shapeOrThrow('plan.destinationDataverseHost', plan.destinationDataverseHost, HOSTNAME);
  shapeOrThrow('plan.sourceRequestNumber', plan.sourceRequestNumber, REQUEST_NUMBER);
  shapeOrThrow('plan.sourceRevision', plan.sourceRevision, REVISION);
  for (const key of ['bundleSha256', 'copyPolicyDigest', 'planDigest', 'createBodySha256']) shapeOrThrow(`plan.${key}`, plan[key], HEX64);
  shapeOrThrow('plan.copyPolicyVersion', plan.copyPolicyVersion, POLICY_VERSION);
  if (typeof plan.bundleExportedAt !== 'string' || Number.isNaN(Date.parse(plan.bundleExportedAt))) throw unsafe('plan.bundleExportedAt is not a timestamp');
  shapeOrThrow('plan.expectedGraphSiteId', plan.expectedGraphSiteId, GRAPH_SITE_ID);
  shapeOrThrow('plan.expectedGraphDriveId', plan.expectedGraphDriveId, GRAPH_DRIVE_ID);
  shapeOrThrow('plan.fiscalYear', plan.fiscalYear, DATE_LIKE);
  shapeOrThrow('plan.meetingDate', plan.meetingDate, ISO_DATE);
  return plan;
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
      assertReservePlan({ actorId, idempotencyKey, plan }); // before any SQL
      const keyDigest = idempotencyKeyDigest(idempotencyKey);
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
            plan.runId, actorId, keyDigest,
            plan.recipe,
            plan.sourceDataverseHost, plan.sourceRequestId, plan.sourceRequestNumber, plan.sourceRevision,
            plan.bundleSha256, plan.bundleExportedAt,
            plan.copyPolicyVersion, plan.copyPolicyDigest, plan.planDigest, plan.createBodySha256,
            plan.destinationEnvironment, plan.destinationDataverseHost,
            plan.destinationRequestId, plan.destinationLocationId,
            plan.expectedAppUserId, plan.expectedOrganizationId,
            plan.expectedGraphSiteId, plan.expectedGraphDriveId,
            plan.fiscalYear, plan.meetingDate, derivedTestLabel(plan),
          ],
        );

        const { rows } = await tx.query(
          `SELECT * FROM test_request_runs WHERE actor_id = $1::text AND idempotency_key = $2::text`,
          [actorId, keyDigest],
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
      stepOrThrow(nextStep);
      if (!Number.isInteger(nextStepIndex) || nextStepIndex < 0 || nextStepIndex > 1000) throw unsafe('nextStepIndex is out of range');
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

    /**
     * Stop the run for manual attention in ONE fenced UPDATE. When `error` is
     * given, `last_error` is recorded in the same statement, so a step failure
     * is never half-persisted (Codex round twelve: a separate recordError +
     * markNeedsAttention pair could lose the fence between the two and leave
     * the run `creating` while the caller reported needs_attention).
     */
    async markNeedsAttention({
      runId, leaseToken, leaseGeneration, expectedVersion, reason, error = null,
    }) {
      const storedReason = ledgerReasonOrThrow(reason);
      const storedError = error == null ? null : ledgerReasonOrThrow(error);
      const { rows } = await db.query(
        `UPDATE test_request_runs
            SET status = 'needs_attention',
                needs_attention_reason = $5::text,
                last_error = COALESCE($6::text, last_error),
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
        [runId, leaseToken, leaseGeneration, expectedVersion, storedReason, storedError],
      );
      return mapRun(rows[0] || null);
    },

    async recordError({
      runId, leaseToken, leaseGeneration, expectedVersion, error,
    }) {
      const storedError = ledgerReasonOrThrow(error);
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
        [runId, leaseToken, leaseGeneration, expectedVersion, storedError],
      );
      return mapRun(rows[0] || null);
    },

    async journalPlannedResource({
      runId, leaseToken, leaseGeneration, step, resourceKind, system, plannedIdentity, sourceProvenance = null,
    }) {
      // Validate before any SQL so an unsafe receipt never opens a transaction.
      stepOrThrow(step);
      enumOrThrow('resourceKind', resourceKind, RESOURCE_KINDS);
      enumOrThrow('system', system, RESOURCE_SYSTEMS);
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
      enumOrThrow('outcome', outcome, RESOURCE_OUTCOMES);
      if (readback != null) assertLedgerReceipt(readback, 'readback');
      return db.transaction(async (tx) => {
        await assertLeaseFence(tx, { runId, leaseToken, leaseGeneration });
        const { rows } = await tx.query(
          `UPDATE test_request_run_resources
              SET response_status = COALESCE($3::integer, response_status),
                  readback = CASE WHEN $4::jsonb IS NULL THEN readback ELSE COALESCE(readback, '{}'::jsonb) || $4::jsonb END,
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
      enumOrThrow('outcome', outcome, RESOURCE_OUTCOMES);
      const storedError = ledgerReasonOrThrow(error); // before any SQL
      return db.transaction(async (tx) => {
        await assertLeaseFence(tx, { runId, leaseToken, leaseGeneration });
        const { rows } = await tx.query(
          `UPDATE test_request_run_resources
              SET outcome = $3::text, error = $4::text, updated_at = NOW()
            WHERE resource_id = $1::bigint AND run_id = $2::uuid
            RETURNING *`,
          [resourceId, runId, outcome, storedError],
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
