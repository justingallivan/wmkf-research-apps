/**
 * Pure test-request isolation policy.
 *
 * This module consumes a trusted server-side request projection only. It does
 * not authenticate an actor, query Dataverse, or authorize a test operation.
 * A caller must separately establish admin/ownership authority after receiving
 * a classification.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TEST_REQUEST_ISOLATION_FIELDS = Object.freeze({
  marker: 'wmkf_istestrequest',
  runId: 'wmkf_testcreationrunid',
});

// Existing rows read back a null marker (the field default does not populate
// them; sandbox probe 2026-09-23), so ordinary is false OR null with no run.
/**
 * Rollout switch for the read-side guards (email refusal, early denials,
 * scheduled-job skips, report exclusion). Only the literal `on` enables them,
 * matching `DATAVERSE_DAL_ENFORCEMENT`: those guards select the marker columns,
 * which must exist in the target Dataverse first, so the switch is turned on
 * per environment only after its schema apply. The marker write guard below
 * does not depend on the columns and is always active.
 */
export function testRequestIsolationEnabled(env = process.env) {
  return env?.TEST_REQUEST_ISOLATION === 'on';
}

export const TEST_REQUEST_ORDINARY_OData_FILTER =
  `((${TEST_REQUEST_ISOLATION_FIELDS.marker} eq false or ${TEST_REQUEST_ISOLATION_FIELDS.marker} eq null) and ${TEST_REQUEST_ISOLATION_FIELDS.runId} eq null)`;

export const TEST_REQUEST_ORDINARY_FETCHXML_FILTER = [
  '<filter type="and">',
  '<filter type="or">',
  `<condition attribute="${TEST_REQUEST_ISOLATION_FIELDS.marker}" operator="eq" value="0"/>`,
  `<condition attribute="${TEST_REQUEST_ISOLATION_FIELDS.marker}" operator="null"/>`,
  '</filter>',
  `<condition attribute="${TEST_REQUEST_ISOLATION_FIELDS.runId}" operator="null"/>`,
  '</filter>',
].join('');

/**
 * Reviews recipe (slice 6c-i, D-R1 owner decision): the synthetic-reviewer
 * person marker lives on wmkf_potentialreviewers, a different entity than
 * TEST_REQUEST_ISOLATION_FIELDS' akoya_request fields. It is deliberately
 * NOT folded into TEST_REQUEST_ISOLATION_FIELDS -- that constant also builds
 * the ordinary-request OData/FetchXML filters and the request select, and a
 * person field there would break every ordinary request read. It is folded
 * only into the write guards below (and into client.js's parity set).
 */
export const SYNTHETIC_REVIEWER_MARKER_FIELDS = Object.freeze({
  marker: 'wmkf_issyntheticreviewer',
});

// These field names exist only on akoya_request or wmkf_potentialreviewers,
// so the guard is independent of the write target: it refuses them anywhere
// in a write body, including nested deep-insert payloads, whatever entity or
// URL form the write addresses. lib/dataverse/client.js (CommonJS) keeps a
// parity copy of these names (TEST_REQUEST_MARKER_FIELDS).
const MARKER_FIELD_NAMES = new Set([
  ...Object.values(TEST_REQUEST_ISOLATION_FIELDS),
  ...Object.values(SYNTHETIC_REVIEWER_MARKER_FIELDS),
]);
const MAX_BODY_DEPTH = 32;

function collectMarkerKeys(value, depth, found) {
  if (!value || typeof value !== 'object') return;
  if (depth > MAX_BODY_DEPTH) {
    throw Object.assign(new Error('Write body is nested too deeply to check for Test Request marker fields.'), {
      code: 'test_request_marker_immutable',
    });
  }
  for (const [key, inner] of Object.entries(value)) {
    if (MARKER_FIELD_NAMES.has(key.split('@')[0].toLowerCase())) found.add(key);
    collectMarkerKeys(inner, depth + 1, found);
  }
}

/**
 * Write guard. No deployed app path may write the marker or run ID: any create
 * or update body containing either field name, at any depth and whatever the
 * value, or any write URL whose path names either field (property-level
 * PUT/DELETE), is refused, so an app path can neither turn a test request ordinary
 * nor forge one. The factory's current creator is the local operator CLI,
 * which opts out on its own raw client; an in-app factory create must add an
 * explicit, reviewed exception here.
 */
export function assertTestRequestMarkerNotWritten(data, target = '') {
  const found = new Set();
  collectMarkerKeys(data, 0, found);
  // A property-level PUT/DELETE names the field in the URL, not the body.
  for (const segment of String(target ?? '').split('?')[0].split('/')) {
    const name = segment.split('(')[0];
    if (MARKER_FIELD_NAMES.has(name.toLowerCase())) found.add(name);
  }
  if (found.size === 0) return;
  throw Object.assign(
    new Error(`Test Request marker fields (${[...found].join(', ')}) cannot be written by the application.`),
    { code: 'test_request_marker_immutable' },
  );
}

function hasOwn(snapshot, key) {
  return Object.prototype.hasOwnProperty.call(snapshot, key);
}

function validGuid(value) {
  return typeof value === 'string' && GUID.test(value);
}

/**
 * Classify a trusted, explicitly selected request projection.
 *
 * A selected null marker with a null run is ordinary: existing rows read back
 * null because the field default does not populate them, and only the factory
 * writes the marker (always true, in the initial INSERT). A marker or run that
 * was not selected, or an invalid value, stays unknown and fails closed.
 */
export function classifyTestRequestSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { kind: 'unknown', reason: 'invalid_snapshot' };
  }

  const markerPresent = hasOwn(snapshot, TEST_REQUEST_ISOLATION_FIELDS.marker);
  const runPresent = hasOwn(snapshot, TEST_REQUEST_ISOLATION_FIELDS.runId);
  if (!markerPresent) return { kind: 'unknown', reason: 'marker_projection_missing' };

  const marker = snapshot[TEST_REQUEST_ISOLATION_FIELDS.marker];
  const runId = snapshot[TEST_REQUEST_ISOLATION_FIELDS.runId];

  if (marker === true) {
    if (!runPresent || !validGuid(runId)) {
      return { kind: 'anomaly', reason: 'synthetic_run_missing_or_invalid' };
    }
    return { kind: 'synthetic', reason: 'marker_and_run_valid', runId: runId.toLowerCase() };
  }

  if (marker === false) {
    if (!runPresent) return { kind: 'unknown', reason: 'run_projection_missing', marker: false };
    if (runId === null) return { kind: 'ordinary', reason: 'marker_false_and_run_null' };
    return { kind: 'anomaly', reason: 'ordinary_marker_with_run' };
  }

  if (marker === null) {
    if (!runPresent) return { kind: 'unknown', reason: 'run_projection_missing' };
    if (runId === null) return { kind: 'ordinary', reason: 'marker_null_and_run_null' };
    return { kind: 'anomaly', reason: 'null_marker_with_run' };
  }

  return { kind: 'unknown', reason: 'marker_value_invalid' };
}

/**
 * Add the two trusted marker fields to a Dataverse $select only after the
 * rollout switch is on. Returning the input unchanged while off is deliberate:
 * production does not have these columns until its schema apply.
 */
export function withTestRequestIsolationSelect(select, env = process.env) {
  if (!testRequestIsolationEnabled(env)) return select;
  if (select == null) return select;
  const fields = typeof select === 'string'
    ? select.split(',').map((field) => field.trim()).filter(Boolean)
    : [...(select || [])];
  for (const field of Object.values(TEST_REQUEST_ISOLATION_FIELDS)) {
    if (!fields.includes(field)) fields.push(field);
  }
  return typeof select === 'string' ? fields.join(',') : fields;
}

/**
 * Public read DTO fragment. Staff may see only the derived TEST signal, never
 * the marker/run implementation fields. Off mode returns an empty object so
 * existing response shapes remain byte-for-byte compatible.
 */
export function testRequestVisibilityDto(snapshot, env = process.env) {
  if (!testRequestIsolationEnabled(env)) return {};
  const { kind } = classifyTestRequestSnapshot(snapshot);
  return { isTestRequest: kind === 'synthetic' || kind === 'anomaly' };
}

/** Internal aggregate predicate; unlike the badge, anomalies/unknowns fail closed. */
export function testRequestCountsAsOrdinary(snapshot, env = process.env) {
  return !testRequestIsolationEnabled(env)
    || classifyTestRequestSnapshot(snapshot).kind === 'ordinary';
}

/** Remove implementation fields from a public record and append only the badge DTO. */
export function projectTestRequestVisibilityRecord(snapshot, env = process.env) {
  if (!testRequestIsolationEnabled(env)) return snapshot;
  const projected = { ...(snapshot || {}), ...testRequestVisibilityDto(snapshot, env) };
  delete projected[TEST_REQUEST_ISOLATION_FIELDS.marker];
  delete projected[TEST_REQUEST_ISOLATION_FIELDS.runId];
  return projected;
}

/** Compose a server-owned ordinary-only OData predicate while the switch is on. */
export function withOrdinaryTestRequestODataFilter(filter, env = process.env) {
  if (!testRequestIsolationEnabled(env)) return filter;
  return filter
    ? `(${filter}) and ${TEST_REQUEST_ORDINARY_OData_FILTER}`
    : TEST_REQUEST_ORDINARY_OData_FILTER;
}

/** Qualify the canonical ordinary-only predicate through a trusted OData navigation property. */
export function ordinaryTestRequestODataFilterForNavigation(navigationProperty) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(navigationProperty)) {
    throw new Error('A trusted OData navigation property is required.');
  }
  return TEST_REQUEST_ORDINARY_OData_FILTER
    .replaceAll(TEST_REQUEST_ISOLATION_FIELDS.marker, `${navigationProperty}/${TEST_REQUEST_ISOLATION_FIELDS.marker}`)
    .replaceAll(TEST_REQUEST_ISOLATION_FIELDS.runId, `${navigationProperty}/${TEST_REQUEST_ISOLATION_FIELDS.runId}`);
}

/**
 * Ordinary dispatch assertion. This classifies the trusted projection itself;
 * callers cannot supply a claimed kind or use this as test-operation auth.
 */
export function assertOrdinaryRequestSnapshot(snapshot) {
  const classification = classifyTestRequestSnapshot(snapshot);
  if (classification.kind === 'ordinary') return { ok: true };
  return { ok: false, code: 'test_request_not_ordinary' };
}

/**
 * Fixed ordinary-only OData fragment. It intentionally has no parameters so
 * callers cannot widen it into a client-controlled test-mode escape hatch.
 */
export function buildOrdinaryTestRequestODataFilter() {
  return TEST_REQUEST_ORDINARY_OData_FILTER;
}

/** Fixed ordinary-only FetchXML fragment; see the OData contract above. */
export function buildOrdinaryTestRequestFetchXmlFilter() {
  return TEST_REQUEST_ORDINARY_FETCHXML_FILTER;
}
