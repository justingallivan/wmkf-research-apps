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

const TEST_REQUEST_ENTITY_SET = 'akoya_requests';
const MARKER_FIELD_NAMES = new Set(Object.values(TEST_REQUEST_ISOLATION_FIELDS));

// Entity set from an entity-set name or an operation URL (relative, absolute
// or alternate-key, whose key may itself contain '/').
function entitySetOf(target) {
  return String(target ?? '').split('(')[0].split('?')[0].split('/').pop().toLowerCase();
}

/**
 * Write guard. No deployed app path may write the marker or run ID: any create
 * or update body for `akoya_requests` that names either field, whatever the
 * value, is refused, so an app path can neither turn a test request ordinary
 * nor forge one. The factory's current creator is the local operator CLI,
 * which uses the raw Dataverse client outside this layer; an in-app factory
 * create must add an explicit, reviewed exception here.
 */
export function assertTestRequestMarkerNotWritten(target, data) {
  if (entitySetOf(target) !== TEST_REQUEST_ENTITY_SET) return;
  if (!data || typeof data !== 'object') return;
  const named = Object.keys(data).filter(key => MARKER_FIELD_NAMES.has(key.toLowerCase()));
  if (named.length === 0) return;
  throw Object.assign(
    new Error(`Test Request marker fields (${named.join(', ')}) cannot be written by the application.`),
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
