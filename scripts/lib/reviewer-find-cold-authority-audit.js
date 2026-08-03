/**
 * Read-only, fixed-fixture authority audit for Reviewer Find cold preparation.
 *
 * The live reader performs OAuth plus Dataverse GETs only. It snapshots exact
 * suggestion identities and every engagement/token field, and all Dynamics
 * email activities regarding the request in the bounded run window. Public
 * summaries expose counts and SHA-256 digests only—never GUIDs or reviewer PII.
 */

const crypto = require('node:crypto');
const { loadEnvLocal, getAccessToken, createClient } = require('../../lib/dataverse/client');

const PRODUCTION_HOST = 'wmkf.crm.dynamics.com';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SUGGESTIONS = 25;
const MAX_EMAIL_ACTIVITIES = 100;
const SUGGESTION_ID = 'wmkf_appreviewersuggestionid';
const APPLICANT_RECOMMENDED_DISPOSITION = 100000000;
const SUGGESTION_FIELDS = Object.freeze([
  SUGGESTION_ID,
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
  'wmkf_applicantdisposition',
  'wmkf_selected',
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_externaltokenrevoked',
  'wmkf_responsetype',
  'wmkf_emailsentat',
  'wmkf_materialssentat',
  'wmkf_remindersentat',
  'wmkf_respondremindersentat',
  'wmkf_responsereceivedat',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_completedat',
  'wmkf_thankyousentat',
  'wmkf_proposalfirstaccessed',
  'wmkf_reviewfilename',
  'wmkf_reviewsharepointfolder',
  'wmkf_externaltokenhash',
  'wmkf_externaltokenissued',
  'wmkf_externaltokenexpires',
  'wmkf_coiackedat',
  'wmkf_aiuseackedat',
  'wmkf_withdrawnsufficientat',
]);
const EMAIL_FIELDS = Object.freeze([
  'activityid',
  'createdon',
  'modifiedon',
  'senton',
  'statecode',
  'statuscode',
  '_regardingobjectid_value',
]);
const UNTOUCHED_BOOLEAN_FIELDS = Object.freeze([
  'wmkf_selected',
  'wmkf_invited',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_externaltokenrevoked',
]);
const EMPTY_LIFECYCLE_FIELDS = Object.freeze([
  'wmkf_responsetype',
]);
const EMPTY_OUTREACH_FIELDS = Object.freeze([
  'wmkf_emailsentat',
  'wmkf_materialssentat',
  'wmkf_remindersentat',
  'wmkf_respondremindersentat',
  'wmkf_responsereceivedat',
]);
const EMPTY_REVIEW_FIELDS = Object.freeze([
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_completedat',
  'wmkf_thankyousentat',
  'wmkf_proposalfirstaccessed',
  'wmkf_reviewfilename',
  'wmkf_reviewsharepointfolder',
]);
const EMPTY_TOKEN_AND_ACK_FIELDS = Object.freeze([
  'wmkf_externaltokenhash',
  'wmkf_externaltokenissued',
  'wmkf_externaltokenexpires',
  'wmkf_coiackedat',
  'wmkf_aiuseackedat',
  'wmkf_withdrawnsufficientat',
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function cleanRows(rows, fields, idField) {
  return [...(Array.isArray(rows) ? rows : [])]
    .map((row) => Object.fromEntries(fields.map((field) => [field, row?.[field] ?? null])))
    .sort((left, right) => String(left[idField] || '').localeCompare(String(right[idField] || '')));
}

function normalizeAuthoritySnapshot({ suggestions = [], emailActivities = [] } = {}) {
  return {
    suggestions: cleanRows(suggestions, SUGGESTION_FIELDS, SUGGESTION_ID),
    emailActivities: cleanRows(emailActivities, EMAIL_FIELDS, 'activityid'),
  };
}

function publicAuthoritySummary(snapshot) {
  const normalized = normalizeAuthoritySnapshot(snapshot);
  return {
    suggestionCount: normalized.suggestions.length,
    suggestionDigest: digest(normalized.suggestions),
    emailActivityCount: normalized.emailActivities.length,
    emailActivityDigest: digest(normalized.emailActivities),
  };
}

function anchor(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function sameAnchor(left, right) {
  const normalizedLeft = anchor(left);
  const normalizedRight = anchor(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function hasDuplicate(values) {
  const present = values.filter(Boolean);
  return new Set(present).size !== present.length;
}

function isEmpty(value) {
  return value === null || value === '';
}

/**
 * Validate that the fixed cold fixture is a pristine set of applicant
 * recommendations. This is deliberately a pure, public-safe result: callers
 * receive failure codes only, never row identifiers or reviewer details.
 */
function validateColdAuthorityBaseline(snapshot, { requestId, expectedSuggestionCount = 5 } = {}) {
  const normalized = normalizeAuthoritySnapshot(snapshot);
  const failures = new Set();
  const expectedRequest = anchor(requestId);
  if (!expectedRequest) failures.add('authority_request_id_invalid');
  if (!Number.isSafeInteger(expectedSuggestionCount) || expectedSuggestionCount < 1
    || normalized.suggestions.length !== expectedSuggestionCount) {
    failures.add('authority_suggestion_count_mismatch');
  }
  if (normalized.emailActivities.length !== 0) failures.add('authority_email_activity_not_empty');

  const suggestionAnchors = normalized.suggestions.map((row) => anchor(row[SUGGESTION_ID]));
  const reviewerAnchors = normalized.suggestions.map((row) => anchor(row._wmkf_potentialreviewer_value));
  if (suggestionAnchors.some((value) => !value)) failures.add('authority_suggestion_anchor_missing');
  if (reviewerAnchors.some((value) => !value)) failures.add('authority_potential_reviewer_anchor_missing');
  if (hasDuplicate(suggestionAnchors)) failures.add('authority_suggestion_anchor_duplicate');
  if (hasDuplicate(reviewerAnchors)) failures.add('authority_potential_reviewer_anchor_duplicate');

  for (const row of normalized.suggestions) {
    if (!sameAnchor(row._wmkf_request_value, expectedRequest)) {
      failures.add('authority_request_linkage_mismatch');
    }
    if (row.wmkf_applicantdisposition !== APPLICANT_RECOMMENDED_DISPOSITION) {
      failures.add('authority_applicant_disposition_mismatch');
    }
    if (UNTOUCHED_BOOLEAN_FIELDS.some((field) => row[field] !== false && row[field] !== null)) {
      failures.add('authority_lifecycle_boolean_not_pristine');
    }
    if (EMPTY_LIFECYCLE_FIELDS.some((field) => !isEmpty(row[field]))) {
      failures.add('authority_lifecycle_not_pristine');
    }
    if (EMPTY_OUTREACH_FIELDS.some((field) => !isEmpty(row[field]))) {
      failures.add('authority_outreach_not_pristine');
    }
    if (EMPTY_REVIEW_FIELDS.some((field) => !isEmpty(row[field]))) {
      failures.add('authority_review_not_pristine');
    }
    if (EMPTY_TOKEN_AND_ACK_FIELDS.some((field) => !isEmpty(row[field]))) {
      failures.add('authority_token_or_acknowledgement_not_pristine');
    }
  }
  return { ok: failures.size === 0, failures: [...failures].sort() };
}

function validateAuthorityUnchanged(before, after, { expectedSuggestionCount = 5 } = {}) {
  const left = normalizeAuthoritySnapshot(before);
  const right = normalizeAuthoritySnapshot(after);
  const failures = [];
  if (left.suggestions.length !== expectedSuggestionCount) failures.push('baseline_suggestion_count_mismatch');
  if (right.suggestions.length !== expectedSuggestionCount) failures.push('postflight_suggestion_count_mismatch');
  if (digest(left.suggestions) !== digest(right.suggestions)) failures.push('suggestion_lifecycle_or_token_state_changed');
  if (digest(left.emailActivities) !== digest(right.emailActivities)) failures.push('request_email_activity_changed');
  return { ok: failures.length === 0, failures };
}

function validateRosterAnchors(snapshot, rosterSuggestionIds, { expectedSuggestionCount = 5 } = {}) {
  const normalized = normalizeAuthoritySnapshot(snapshot);
  const expected = normalized.suggestions.map((row) => row[SUGGESTION_ID]).filter(Boolean).sort();
  const actual = [...new Set((Array.isArray(rosterSuggestionIds) ? rosterSuggestionIds : [])
    .filter((value) => typeof value === 'string' && value))].sort();
  const failures = [];
  if (expected.length !== expectedSuggestionCount) failures.push('authority_anchor_count_mismatch');
  if (actual.length !== expectedSuggestionCount) failures.push('roster_anchor_count_mismatch');
  if (digest(expected) !== digest(actual)) failures.push('roster_anchor_set_mismatch');
  return { ok: failures.length === 0, failures };
}

function responseBody(label, response) {
  if (!response?.ok) throw new Error(`${label}_failed_${response?.status || 'unknown'}`);
  return response.body;
}

async function readProductionAuthoritySnapshot({ requestId, windowStart }) {
  loadEnvLocal();
  const resource = process.env.DYNAMICS_URL;
  if (!resource) throw new Error('DYNAMICS_URL is not configured');
  let target;
  try { target = new URL(resource); } catch { throw new Error('DYNAMICS_URL is invalid'); }
  if (target.hostname !== PRODUCTION_HOST) throw new Error('Cold authority audit requires the registered production Dataverse target.');
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Cold authority audit requires DATAVERSE_ALLOW_PROD_READS=yes.');
  }
  if (process.env.DATAVERSE_TARGET_INTERLOCK !== 'on') {
    throw new Error('Cold authority audit requires DATAVERSE_TARGET_INTERLOCK=on.');
  }
  if (typeof requestId !== 'string' || !GUID_RE.test(requestId)) {
    throw new Error('Cold authority audit requestId is invalid.');
  }
  const start = new Date(windowStart);
  if (!Number.isFinite(start.getTime())) throw new Error('Cold authority audit windowStart is invalid.');

  const token = await getAccessToken(resource);
  const client = createClient({ resourceUrl: resource, token });
  const suggestionFilter = `_wmkf_request_value eq ${requestId}`;
  const suggestionBody = responseBody('suggestion_read', await client.get(
    `/wmkf_appreviewersuggestions?$select=${SUGGESTION_FIELDS.join(',')}`
      + `&$filter=${encodeURIComponent(suggestionFilter)}`
      + `&$orderby=${SUGGESTION_ID} asc&$top=${MAX_SUGGESTIONS + 1}`,
  ));
  const suggestions = suggestionBody?.value || [];
  if (suggestions.length > MAX_SUGGESTIONS) throw new Error('suggestion_read_exceeded_bound');

  const emailFilter = `_regardingobjectid_value eq ${requestId} and createdon ge ${start.toISOString()}`;
  const emailBody = responseBody('email_activity_read', await client.get(
    `/emails?$select=${EMAIL_FIELDS.join(',')}`
      + `&$filter=${encodeURIComponent(emailFilter)}`
      + `&$orderby=activityid asc&$top=${MAX_EMAIL_ACTIVITIES + 1}`,
  ));
  const emailActivities = emailBody?.value || [];
  if (emailActivities.length > MAX_EMAIL_ACTIVITIES) throw new Error('email_activity_read_exceeded_bound');
  return normalizeAuthoritySnapshot({ suggestions, emailActivities });
}

module.exports = {
  APPLICANT_RECOMMENDED_DISPOSITION,
  SUGGESTION_FIELDS,
  EMAIL_FIELDS,
  normalizeAuthoritySnapshot,
  publicAuthoritySummary,
  validateColdAuthorityBaseline,
  validateAuthorityUnchanged,
  validateRosterAnchors,
  readProductionAuthoritySnapshot,
};
