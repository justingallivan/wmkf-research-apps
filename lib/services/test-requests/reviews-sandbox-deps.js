/**
 * Test Request Factory `reviews` recipe sandbox dependencies (slice 6c-ii
 * Stage B). Mirrors `lib/services/test-requests/ia-sandbox-deps.js`: one
 * frozen sandbox-bound service (hostname in `SANDBOX_HOSTS`, token fetched
 * per call, explicit `svc.baseUrl`) exposing the reads/writes the `reviews`
 * recipe's runner steps and the CLI's reservation-time resolution need.
 *
 * `findSyntheticByEmail` (lib/dataverse/adapters/potential-reviewer.js) does
 * not take an `options.svc` (it always reads through the `DynamicsService`
 * singleton, i.e. `process.env.DYNAMICS_URL`), so this module cannot bind it
 * to the sandbox by passing an option through — it re-implements the SAME
 * predicate (marker true, active, no Contact link, exact-match on the
 * normalized address, throws on more than one match) against a sandbox-bound
 * raw read, exactly as `sandboxGetRequest`/`sandboxFindByRequest` re-implement
 * their production analogues in ia-sandbox-deps.js. `isSyntheticReviewerRow`
 * (isolation.js) is the single shared predicate for "row carries the marker",
 * so this and the adapter never diverge on that one rule.
 *
 * `createPerson` uses the raw, opted-out `dataverse/client.js` `createClient`
 * (never `write-core.js`) because the synthetic person create carries
 * `wmkf_issyntheticreviewer: true`, and `write-core.createRecord`'s
 * `assertTestRequestMarkerNotWritten` guard refuses ANY marker field with no
 * opt-out (unlike `client.js`'s `isSanctionedMarkerWrite`, which is the one
 * sanctioned exception, scoped to the Factory's local operator CLI).
 * `createSuggestion` carries no marker, so it goes through `write-core.js`
 * `createRecord`, bound to this sandbox `svc` exactly as
 * `executeChangeset`/`ia-sandbox-deps.js` already do.
 *
 * Registered in `scripts/check-dataverse-access-layer.js` `EXEMPT_FILES`
 * (same reason as `ia-sandbox-deps.js`: a deliberately org-bound sandbox
 * service has no entity adapter to resolve against).
 */

import dataverseClientModule from '../../dataverse/client.js';
import { SANDBOX_HOSTS } from '../../dataverse/core/target-registry.js';
import { entitySet } from '../../dataverse/core/entity-registry.js';
import { buildOperations } from '../../dataverse/core/changeset.js';
import * as odata from '../../dataverse/core/odata.js';
import { assertTrustedDalContext } from '../dynamics-context.js';
import { isGuid } from '../../utils/guid.js';
import { _withCallerId, _writeFetch, createRecord, updateRecord } from '../dynamics/write-core.js';
import { executeChangeset } from '../dynamics/changeset.js';
import { processAnnotations } from '../dynamics/annotations.js';
import { buildHeaders } from '../dynamics/http.js';
import {
  SYNTHETIC_REVIEWER_MARKER_FIELDS,
  syntheticReviewerIsolationEnabled,
  isSyntheticReviewerRow,
} from './isolation.js';

const { getAccessToken: getSandboxAccessToken, createClient } = dataverseClientModule;

const PERSON_ENTITY_SET = entitySet('wmkf_potentialreviewerses');
const SUGGESTION_ENTITY_SET = entitySet('wmkf_appreviewersuggestions');

// Same annotation contract as ia-sandbox-deps.js: every sandbox read carries
// this Prefer header so rows come back with `_etag`/`*_formatted`, matching
// the production read path, and every returned record is run through
// `processAnnotations`.
const ANNOTATION_HEADERS = Object.freeze({ Prefer: 'odata.include-annotations="*"' });

function sandboxHttpError(resp, label) {
  const error = new Error(`reviews-sandbox-deps: ${label} failed (${resp.status})`);
  error.status = resp.status;
  error.body = resp.text;
  return error;
}

/** Byte-mirror of ia-sandbox-deps.js's private assertSandboxHost. */
function assertSandboxHost(resourceUrl) {
  let parsed;
  try {
    parsed = new URL(resourceUrl);
  } catch {
    throw new Error(`reviews-sandbox-deps: resourceUrl is not a valid URL: ${resourceUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`reviews-sandbox-deps: resourceUrl must use https: (got "${parsed.protocol}")`);
  }
  if (parsed.port !== '' || resourceUrl !== parsed.origin) {
    throw new Error(
      `reviews-sandbox-deps: resourceUrl must be a bare origin with no port/userinfo/path `
      + `(got "${resourceUrl}", expected "https://${parsed.hostname}")`,
    );
  }
  if (!SANDBOX_HOSTS.includes(parsed.hostname)) {
    throw new Error(
      `reviews-sandbox-deps: refusing non-sandbox Dataverse host "${parsed.hostname}" `
      + `(registered sandbox hosts: ${SANDBOX_HOSTS.join(', ')})`,
    );
  }
  return parsed.hostname;
}

function normalizeEmail(email) {
  if (email === null || email === undefined) return '';
  return String(email).trim().toLowerCase();
}

function adapterError(message, { code, status = 500, details } = {}) {
  return Object.assign(new Error(message), { code, status, details });
}

/**
 * Sandbox-bound byte-mirror of `potential-reviewer.js#findSyntheticByEmail`.
 * Fails closed with the same `synthetic_reviewer_isolation_disabled` code
 * when the switch is off — the sandbox may have wave30 applied even when a
 * caller forgot to set the switch, and a call here with the switch off is a
 * caller defect, not a legitimate miss (mirrors the adapter's own posture).
 */
async function sandboxFindSyntheticByEmail(svc, email) {
  assertTrustedDalContext('reviews-sandbox-deps.findSyntheticByEmail');
  if (!syntheticReviewerIsolationEnabled()) {
    throw adapterError('reviews-sandbox-deps.findSyntheticByEmail requires SYNTHETIC_REVIEWER_ISOLATION to be on.', {
      code: 'synthetic_reviewer_isolation_disabled',
      status: 409,
    });
  }
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', ['wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_firstname', 'wmkf_lastname', 'wmkf_emailaddress',
    'wmkf_areaofexpertise', 'wmkf_primaryaffiliation', 'wmkf_academicrank', 'wmkf_primarydepartment', 'wmkf_maininstitution',
    'statecode', '_wmkf_contact_value', SYNTHETIC_REVIEWER_MARKER_FIELDS.marker].join(','));
  params.set('$filter', odata.eq('wmkf_emailaddress', norm));
  params.set('$top', '2');
  const resp = await client.get(`/${PERSON_ENTITY_SET}?${params.toString()}`, ANNOTATION_HEADERS);
  if (!resp.ok) throw sandboxHttpError(resp, 'findSyntheticByEmail');
  const records = (resp.body?.value || []).map(processAnnotations);
  const matches = records.filter((row) => normalizeEmail(row.wmkf_emailaddress) === norm
    && isSyntheticReviewerRow(row)
    && (row.statecode === undefined || row.statecode === 0)
    && !row._wmkf_contact_value);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw adapterError('More than one synthetic potential reviewer owns this email address.', {
      code: 'ambiguous_email_owner', status: 409, details: { count: matches.length },
    });
  }
  return matches[0];
}

async function sandboxGetPersonById(svc, id, { select } = {}) {
  assertTrustedDalContext('reviews-sandbox-deps.getPersonById');
  if (!isGuid(id)) throw new Error('reviews-sandbox-deps: getPersonById requires a valid GUID');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const fields = select && select.length ? select : ['wmkf_potentialreviewersid'];
  const params = new URLSearchParams({ $select: fields.join(',') });
  const resp = await client.get(`/${PERSON_ENTITY_SET}(${id})?${params.toString()}`, ANNOTATION_HEADERS);
  if (resp.status === 404) return null;
  if (!resp.ok) throw sandboxHttpError(resp, 'getPersonById');
  return processAnnotations(resp.body);
}

async function sandboxGetSuggestionById(svc, id, { select } = {}) {
  assertTrustedDalContext('reviews-sandbox-deps.getSuggestionById');
  if (!isGuid(id)) throw new Error('reviews-sandbox-deps: getSuggestionById requires a valid GUID');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const fields = select && select.length ? select : ['wmkf_appreviewersuggestionid'];
  const params = new URLSearchParams({ $select: fields.join(',') });
  const resp = await client.get(`/${SUGGESTION_ENTITY_SET}(${id})?${params.toString()}`, ANNOTATION_HEADERS);
  if (resp.status === 404) return null;
  if (!resp.ok) throw sandboxHttpError(resp, 'getSuggestionById');
  return processAnnotations(resp.body);
}

/**
 * The person POST carries `wmkf_issyntheticreviewer: true` — the ONE
 * sanctioned marker write, opted out on this call's own raw client, never on
 * write-core. `payload` must already include the preallocated
 * `wmkf_potentialreviewersid` (client-supplied primary key) and the
 * `syntheticPersonProjection` fields (seed-synthetic-review.js).
 */
async function sandboxCreatePerson(svc, payload) {
  assertTrustedDalContext('reviews-sandbox-deps.createPerson');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token, allowTestRequestMarkerWrites: true });
  const resp = await client.post(`/${PERSON_ENTITY_SET}`, payload, { Prefer: 'return=representation' });
  if (!resp.ok) throw sandboxHttpError(resp, 'createPerson');
  return processAnnotations(resp.body);
}

/**
 * The suggestion create carries no marker; dispatched through `write-core.js`
 * `createRecord`, bound to this sandbox `svc`. `payload` must already include
 * the preallocated `wmkf_appreviewersuggestionid`.
 */
function sandboxCreateSuggestion(svc, payload) {
  assertTrustedDalContext('reviews-sandbox-deps.createSuggestion');
  return createRecord(svc, SUGGESTION_ENTITY_SET, payload, {});
}

function sandboxPatchSuggestion(svc, id, patch, { ifMatch } = {}) {
  assertTrustedDalContext('reviews-sandbox-deps.patchSuggestion');
  return updateRecord(svc, SUGGESTION_ENTITY_SET, id, patch, { ifMatch });
}

function sandboxRunChangeset(svc, operations, options = {}) {
  assertTrustedDalContext('reviews-sandbox-deps.runChangeset');
  return executeChangeset(svc, buildOperations(operations), options);
}

/**
 * Build one frozen sandbox-bound `dependencies` object for the `reviews`
 * recipe's runner steps and the CLI's reservation-time resolution.
 *
 * @param {{ resourceUrl: string }} args
 */
export function createReviewsSandboxDeps({ resourceUrl }) {
  assertSandboxHost(resourceUrl);
  const svc = Object.freeze({
    resourceUrl,
    baseUrl: `${resourceUrl}/api/data/v9.2`,
    getAccessToken: () => getSandboxAccessToken(resourceUrl),
    buildHeaders,
    processAnnotations,
    _withCallerId,
    _writeFetch,
  });
  return Object.freeze({
    findSyntheticByEmail: (email) => sandboxFindSyntheticByEmail(svc, email),
    getPersonById: (id, options) => sandboxGetPersonById(svc, id, options),
    getSuggestionById: (id, options) => sandboxGetSuggestionById(svc, id, options),
    createPerson: (payload) => sandboxCreatePerson(svc, payload),
    createSuggestion: (payload) => sandboxCreateSuggestion(svc, payload),
    patchSuggestion: (id, patch, options) => sandboxPatchSuggestion(svc, id, patch, options),
    runChangeset: (operations, options) => sandboxRunChangeset(svc, operations, options),
  });
}
