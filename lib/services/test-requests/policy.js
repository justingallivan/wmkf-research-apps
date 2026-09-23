/**
 * Pure draft compiler for the admin Test Request Factory.
 *
 * This module is intentionally inert: it has no transport, auth, environment,
 * database, Blob, or Graph imports. A draft is never execution-ready here;
 * Metadata is a normalized, trusted-server snapshot keyed by logical attribute:
 * { entity, fields: { name: { createable, requiredLevel, type, maxLength?,
 * minValue?, maxValue?, lookupTarget? } } }. It is not browser input.
 * sourceRequest must be a server-resolved authorized snapshot, never browser
 * payload; this compiler also requires its source GUID.
 * No metadata loader, authorization or platform readiness check exists here.
 * Future writes require those contracts plus the plan's isolation/provisioning gates.
 */

// Dataverse GUIDs use the canonical 8-4-4-4-12 hexadecimal shape but do not
// guarantee RFC 4122 version/variant nibbles (vendor/imported row ids can carry
// any hex value there). Shape validation is the correct boundary for record ids.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LABEL_LENGTH = 120;
const MAX_PURPOSE_LENGTH = 100000;
const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;

const FIXED_FIELDS = Object.freeze({
  marker: 'wmkf_istestrequest',
  runId: 'wmkf_testcreationrunid',
  applicant: 'akoya_applicantid@odata.bind',
  requestType: 'akoya_requesttype',
  responseReminder: 'wmkf_respondreminderenabled',
  reviewReminder: 'wmkf_reviewduereminderenabled',
});

const ALLOWED_INPUT_KEYS = new Set([
  'recipe',
  'sourceRequest',
  'testLabel',
  'fiscalYear',
  'meetingDate',
  'metadata',
  'requestId',
  'requestType',
  'runId',
  'testOrganizationId',
]);

const POLICY_FIELDS = new Set([
  'akoya_requestid',
  'akoya_title',
  'akoya_purpose',
  'akoya_request',
  'akoya_fiscalyear',
  FIXED_FIELDS.requestType,
  'wmkf_meetingdate',
  FIXED_FIELDS.marker,
  FIXED_FIELDS.runId,
  'akoya_applicantid',
  FIXED_FIELDS.responseReminder,
  FIXED_FIELDS.reviewReminder,
]);

// The bounded sandbox create omitted both fields and Dataverse assigned the
// authenticated application user as owner. Future execution must read back
// owner and creator before treating the created Request as valid.
const SERVER_DEFAULT_SYSTEM_FIELDS = new Set(['ownerid', 'owneridtype']);

const BODY_TO_METADATA_FIELD = Object.freeze({
  [FIXED_FIELDS.applicant]: 'akoya_applicantid',
});

const EXPECTED_TYPES = Object.freeze({
  akoya_requestid: new Set(['Uniqueidentifier', 'Guid']),
  akoya_applicantid: new Set(['Lookup']),
  akoya_title: new Set(['String']),
  akoya_purpose: new Set(['Memo', 'String']),
  akoya_request: new Set(['Money', 'Decimal', 'Double', 'Integer']),
  akoya_fiscalyear: new Set(['String']),
  [FIXED_FIELDS.requestType]: new Set(['Picklist', 'Integer']),
  wmkf_meetingdate: new Set(['DateOnly', 'DateTime']),
  [FIXED_FIELDS.marker]: new Set(['Boolean']),
  [FIXED_FIELDS.runId]: new Set(['String', 'Uniqueidentifier', 'Guid']),
  [FIXED_FIELDS.responseReminder]: new Set(['Boolean']),
  [FIXED_FIELDS.reviewReminder]: new Set(['Boolean']),
});

const REQUIRED_LEVELS = new Set(['None', 'Recommended', 'ApplicationRequired', 'SystemRequired']);

function blocker(code, field, detail) {
  return { code, ...(field ? { field } : {}), detail };
}

function isGuid(value) {
  return typeof value === 'string' && GUID.test(value);
}

function isCalendarDate(value) {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

function metadataField(metadata, field) {
  return metadata?.fields?.[field] || null;
}

function metadataNameForBodyField(field) {
  return BODY_TO_METADATA_FIELD[field] || field;
}

function requireCreateable(metadata, field, blockers) {
  const metadataName = metadataNameForBodyField(field);
  const spec = metadataField(metadata, metadataName);
  if (!spec) {
    blockers.push(blocker('METADATA_UNKNOWN', metadataName, 'Field metadata is unavailable.'));
    return null;
  }
  if (spec.createable !== true) {
    blockers.push(blocker('FIELD_NOT_CREATEABLE', metadataName, 'Field is not explicitly createable.'));
    return null;
  }
  if (!REQUIRED_LEVELS.has(spec.requiredLevel)) {
    blockers.push(blocker('METADATA_INVALID', metadataName, 'requiredLevel is not recognized.'));
  }
  const expected = EXPECTED_TYPES[metadataName];
  if (expected && !expected.has(spec.type)) {
    blockers.push(blocker('METADATA_INVALID', metadataName, `Expected one of: ${[...expected].join(', ')}.`));
  }
  if ((spec.type === 'String' || spec.type === 'Memo')
      && (!Number.isInteger(spec.maxLength) || spec.maxLength < 1)) {
    blockers.push(blocker('METADATA_INVALID', metadataName, 'String/memo metadata requires a positive maxLength.'));
  }
  if (['Money', 'Decimal', 'Double', 'Integer'].includes(spec.type)
      && (!Number.isFinite(spec.minValue) || !Number.isFinite(spec.maxValue) || spec.minValue > spec.maxValue)) {
    blockers.push(blocker('METADATA_INVALID', metadataName, 'Numeric metadata requires a valid minValue/maxValue range.'));
  }
  return spec;
}

function validateMetadata(metadata, blockers) {
  if (!metadata || metadata.entity !== 'akoya_request' || !metadata.fields || typeof metadata.fields !== 'object') {
    blockers.push(blocker('METADATA_UNKNOWN', null, 'akoya_request metadata is required.'));
    return;
  }

  for (const [field, spec] of Object.entries(metadata.fields)) {
    if (!spec || typeof spec !== 'object') {
      blockers.push(blocker('METADATA_INVALID', field, 'Field metadata must be an object.'));
      continue;
    }
    if (!REQUIRED_LEVELS.has(spec.requiredLevel)) {
      blockers.push(blocker('METADATA_INVALID', field, 'requiredLevel is not recognized.'));
    }
    if (spec.requiredLevel === 'SystemRequired' && !POLICY_FIELDS.has(field)
        && !SERVER_DEFAULT_SYSTEM_FIELDS.has(field) && spec.createable === true) {
      blockers.push(blocker('SYSTEM_REQUIRED_UNRESOLVED', field, 'No documented server default exists for this required field.'));
    }
  }

  const applicant = metadataField(metadata, 'akoya_applicantid');
  if (!applicant || applicant.lookupTarget !== 'accounts') {
    blockers.push(blocker('LOOKUP_TARGET_UNKNOWN', 'akoya_applicantid', 'Applicant binding must target accounts.'));
  }

  for (const field of [FIXED_FIELDS.marker, FIXED_FIELDS.runId, FIXED_FIELDS.responseReminder, FIXED_FIELDS.reviewReminder]) {
    requireCreateable(metadata, field, blockers);
  }
}

function validateStrictInput(input, blockers) {
  for (const key of Object.keys(input || {})) {
    if (!ALLOWED_INPUT_KEYS.has(key)) blockers.push(blocker('INPUT_NOT_ALLOWED', key, 'Only explicit draft inputs are accepted.'));
  }
  if (input?.recipe !== 'basic') {
    blockers.push(blocker('RECIPE_UNSUPPORTED', 'recipe', 'Only the basic recipe is implemented.'));
  }
  if (typeof input?.testLabel !== 'string' || input.testLabel.trim().length < 1 || input.testLabel.length > MAX_LABEL_LENGTH) {
    blockers.push(blocker('INPUT_INVALID', 'testLabel', `Label must be 1-${MAX_LABEL_LENGTH} characters.`));
  }
  if (typeof input?.fiscalYear !== 'string' || input.fiscalYear.trim().length < 1 || input.fiscalYear.length > 80) {
    blockers.push(blocker('INPUT_INVALID', 'fiscalYear', 'Fiscal year must be a non-empty bounded string.'));
  }
  if (typeof input?.meetingDate !== 'string' || !isCalendarDate(input.meetingDate)) {
    blockers.push(blocker('INPUT_INVALID', 'meetingDate', 'Meeting date must use YYYY-MM-DD.'));
  }
  if (!Number.isInteger(input?.requestType)) {
    blockers.push(blocker('INPUT_INVALID', FIXED_FIELDS.requestType, 'Request type must be a numeric Dataverse option value.'));
  }
  for (const field of ['requestId', 'runId', 'testOrganizationId']) {
    if (!isGuid(input?.[field])) blockers.push(blocker('INPUT_INVALID', field, 'Value must be a UUID.'));
  }
  if (!input?.sourceRequest || typeof input.sourceRequest !== 'object' || Array.isArray(input.sourceRequest)) {
    blockers.push(blocker('INPUT_INVALID', 'sourceRequest', 'Source request snapshot is required.'));
  }
  if (input?.sourceRequest?.akoya_requestid && isGuid(input.sourceRequest.akoya_requestid)
      && isGuid(input.requestId) && input.requestId.toLowerCase() === input.sourceRequest.akoya_requestid.toLowerCase()) {
    blockers.push(blocker('SOURCE_ID_REUSED', 'requestId', 'Generated request ID must differ from the source ID.'));
  }
}

function validateSource(sourceRequest, blockers) {
  if (!sourceRequest || typeof sourceRequest !== 'object') return;
  if (!isGuid(sourceRequest.akoya_requestid)) {
    blockers.push(blocker('SOURCE_INVALID', 'akoya_requestid', 'Source request ID must be a UUID.'));
  }
  if (sourceRequest.akoya_request != null
      && (typeof sourceRequest.akoya_request !== 'number'
        || !Number.isFinite(sourceRequest.akoya_request)
        || sourceRequest.akoya_request < 0
        || sourceRequest.akoya_request > MAX_AMOUNT)) {
    blockers.push(blocker('INPUT_INVALID', 'akoya_request', 'Requested amount must be finite and non-negative.'));
  }
  if (sourceRequest.akoya_purpose != null
      && (typeof sourceRequest.akoya_purpose !== 'string' || sourceRequest.akoya_purpose.length > MAX_PURPOSE_LENGTH)) {
    blockers.push(blocker('INPUT_INVALID', 'akoya_purpose', 'Purpose must be a bounded string.'));
  }
}

function requiredInputCheck(metadata, body, blockers) {
  if (!metadata?.fields) return;
  for (const [field, spec] of Object.entries(metadata.fields)) {
    if (!spec || spec.requiredLevel !== 'ApplicationRequired') continue;
    const bodyField = Object.entries(BODY_TO_METADATA_FIELD)
      .find(([, metadataFieldName]) => metadataFieldName === field)?.[0] || field;
    if (!(bodyField in body) || body[bodyField] == null || body[bodyField] === '') blockers.push(blocker('REQUIRED_UNSUPPLIED', field, 'Application-required field has no safe supplied value.'));
  }
}

function validateBodyValues(metadata, body, blockers) {
  for (const [bodyField, value] of Object.entries(body)) {
    const field = metadataNameForBodyField(bodyField);
    const spec = metadataField(metadata, field);
    if (!spec || value == null) continue;
    if ((spec.type === 'String' || spec.type === 'Memo') && typeof value === 'string'
        && Number.isInteger(spec.maxLength) && value.length > spec.maxLength) {
      blockers.push(blocker('VALUE_OUT_OF_RANGE', field, 'Value exceeds metadata maxLength.'));
    }
    if (['Money', 'Decimal', 'Double', 'Integer'].includes(spec.type) && typeof value === 'number'
        && (value < spec.minValue || value > spec.maxValue)) {
      blockers.push(blocker('VALUE_OUT_OF_RANGE', field, 'Value exceeds metadata numeric range.'));
    }
  }
}

export function compileTestRequestDraft(input = {}) {
  const blockers = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { createBody: null, omittedFields: [], replacedFields: [], blockers: [blocker('INPUT_INVALID', null, 'Draft input must be an object.')], executionReady: false };
  }
  validateStrictInput(input, blockers);
  validateSource(input.sourceRequest, blockers);
  validateMetadata(input.metadata, blockers);

  const body = {
    akoya_requestid: input.requestId,
    [`${FIXED_FIELDS.applicant}`]: isGuid(input.testOrganizationId)
      ? `/accounts(${input.testOrganizationId})` : undefined,
    akoya_title: typeof input.testLabel === 'string' ? `TEST: ${input.testLabel.trim()}` : undefined,
    akoya_purpose: input.sourceRequest?.akoya_purpose,
    akoya_request: input.sourceRequest?.akoya_request,
    akoya_fiscalyear: input.fiscalYear,
    [FIXED_FIELDS.requestType]: input.requestType,
    wmkf_meetingdate: input.meetingDate,
    [FIXED_FIELDS.marker]: true,
    [FIXED_FIELDS.runId]: input.runId,
    [FIXED_FIELDS.responseReminder]: false,
    [FIXED_FIELDS.reviewReminder]: false,
  };

  for (const field of Object.keys(body)) {
    if (body[field] == null) delete body[field];
    else requireCreateable(input.metadata, field, blockers);
  }
  requiredInputCheck(input.metadata, body, blockers);
  validateBodyValues(input.metadata, body, blockers);

  return {
    createBody: blockers.length ? null : body,
    omittedFields: Object.keys(input.sourceRequest || {}).filter(field => !['akoya_purpose', 'akoya_request'].includes(field)),
    replacedFields: [FIXED_FIELDS.applicant, FIXED_FIELDS.requestType, FIXED_FIELDS.marker, FIXED_FIELDS.runId, FIXED_FIELDS.responseReminder, FIXED_FIELDS.reviewReminder],
    blockers,
    executionReady: false,
  };
}

export const TEST_REQUEST_FIXED_FIELDS = FIXED_FIELDS;
