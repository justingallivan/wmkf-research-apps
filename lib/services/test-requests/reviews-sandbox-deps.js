/**
 * Test Request Factory `reviews` recipe sandbox dependencies (slice 6c-ii
 * Stage B). Mirrors `lib/services/test-requests/ia-sandbox-deps.js`: one
 * frozen sandbox-bound service (hostname in `SANDBOX_HOSTS`, token fetched
 * per call, explicit `svc.baseUrl`) exposing the reads/writes the `reviews`
 * recipe's runner steps and the CLI's reservation-time resolution need.
 *
 * `findAnyPersonByEmail` is the ONLY address lookup the factory uses, and it
 * is an UNFILTERED exact-match lookup by normalized address — no marker/
 * active/Contact filter — used ONLY by the CLI's reservation-time resolver
 * (`rehearse-test-request-sandbox.mjs` `resolveReviewerAssignments`). A
 * marker/active/Contact-FILTERED predicate is deliberately NOT built into
 * this read: silently returning null for a REAL reviewer's address (an
 * existing row that is not synthetic) would let the reservation treat that
 * address as if it were free and preallocate a fresh destination GUID for
 * it, storing a real reviewer's address as the recipient-confinement
 * address for a run — stopping only much later, at seed time, on the
 * `wmkf_emailaddress_unique` alternate-key conflict. The caller (the
 * reservation resolver) therefore reads this row's marker/statecode/Contact
 * fields itself and refuses the reservation (`reviewer_person_not_synthetic`)
 * for any row that fails that check, before ever preallocating or reusing a
 * GUID.
 *
 * (Opus round 2, decision): `lib/dataverse/adapters/potential-reviewer.js`'s
 * marker-filtered `findSyntheticByEmail` was deleted as dead code — it had
 * no production importer once this module's unfiltered lookup replaced it,
 * and Stage C's verifier reads suggestions/answers by GUID rather than by
 * address. `potential-reviewer-synthetic-lookup-boundary.test.js` (the
 * allowlist gate for that now-deleted function) was deleted with it. Ordinary
 * paths must never import THIS module either — it is exempted from
 * `check:dataverse-access-layer` by name (`EXEMPT_FILES`), which is the
 * access-layer enforcement for the factory's sandbox-bound reads/writes.
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
import { _withCallerId, _writeFetch, createRecord } from '../dynamics/write-core.js';
import { executeChangeset } from '../dynamics/changeset.js';
import { processAnnotations } from '../dynamics/annotations.js';
import { buildHeaders } from '../dynamics/http.js';
import { syntheticReviewerIsolationEnabled } from './isolation.js';
import { SYNTHETIC_PERSON_PROJECTION_FIELDS } from '../reviewer-engagement/seed-synthetic-review.js';
import { REVIEWER_ANSWER_FIELDS } from './source-bundle.js';

// One source of truth (P3, Opus round 1): every field
// syntheticPersonProjection writes, plus the marker/statecode/Contact-link
// fields a caller needs to classify a row (never written by the seeder
// itself). Reused by findAnyPersonByEmail's $select and by the runner's own
// getPersonById calls (run-runner.js), so a future projection field can
// never cause the read side to silently miss it.
const PERSON_READ_FIELDS = Object.freeze([
  'wmkf_potentialreviewersid', 'statecode', '_wmkf_contact_value',
  // Platform-derived primary name (not in the projection; checked by prefix).
  'wmkf_name',
  ...SYNTHETIC_PERSON_PROJECTION_FIELDS,
]);

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
 * Sandbox-bound, UNFILTERED exact-match lookup by normalized address (P2-4).
 * Deliberately applies NO marker/active/Contact-link filter -- see the module
 * docblock for why: the reservation resolver must be able to distinguish "no
 * person owns this address" from "a real reviewer owns this address" and
 * refuse the latter, which a synthetic-only filter would silently hide.
 * Fails closed with `synthetic_reviewer_isolation_disabled` when the switch
 * is off (this still selects the marker column, which may not exist on the
 * target host until the switch's environment has wave30 applied) — a call
 * here with the switch off is a caller defect, not a legitimate miss.
 */
async function sandboxFindAnyPersonByEmail(svc, email) {
  assertTrustedDalContext('reviews-sandbox-deps.findAnyPersonByEmail');
  if (!syntheticReviewerIsolationEnabled()) {
    throw adapterError('reviews-sandbox-deps.findAnyPersonByEmail requires SYNTHETIC_REVIEWER_ISOLATION to be on.', {
      code: 'synthetic_reviewer_isolation_disabled',
      status: 409,
    });
  }
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', PERSON_READ_FIELDS.join(','));
  params.set('$filter', odata.eq('wmkf_emailaddress', norm));
  params.set('$top', '2');
  const resp = await client.get(`/${PERSON_ENTITY_SET}?${params.toString()}`, ANNOTATION_HEADERS);
  if (!resp.ok) throw sandboxHttpError(resp, 'findAnyPersonByEmail');
  const records = (resp.body?.value || []).map(processAnnotations);
  const matches = records.filter((row) => normalizeEmail(row.wmkf_emailaddress) === norm);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw adapterError('More than one potential reviewer owns this email address.', {
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
 * List every `wmkf_appreviewersuggestion` bound to a destination Request
 * (slice 6c-ii Stage C `verify_reviews`: "no suggestion on the destination
 * Request beyond the seeded set"), read-only, GUID-only, bounded. Mirrors
 * `sandboxFindAnyPersonByEmail`'s shape (raw client, `$top`, continuation
 * refused rather than silently truncated).
 */
const MAX_SUGGESTIONS_PER_REQUEST = 200;
async function sandboxListSuggestionsByRequest(svc, requestId) {
  assertTrustedDalContext('reviews-sandbox-deps.listSuggestionsByRequest');
  if (!isGuid(requestId)) throw new Error('reviews-sandbox-deps: listSuggestionsByRequest requires a valid GUID');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', 'wmkf_appreviewersuggestionid');
  params.set('$filter', odata.eq('_wmkf_request_value', requestId));
  params.set('$top', String(MAX_SUGGESTIONS_PER_REQUEST));
  const resp = await client.get(`/${SUGGESTION_ENTITY_SET}?${params.toString()}`, ANNOTATION_HEADERS);
  if (!resp.ok) throw sandboxHttpError(resp, 'listSuggestionsByRequest');
  const body = resp.body || {};
  if (body['@odata.nextLink']) {
    throw new Error('reviews-sandbox-deps: listSuggestionsByRequest returned more rows than the bounded read limit; refusing a partial list.');
  }
  return (body.value || []).map(processAnnotations).map((row) => row.wmkf_appreviewersuggestionid);
}

const ANSWER_ENTITY_SET = entitySet('wmkf_appreviewanswers');
const MAX_ANSWERS_PER_SUGGESTION = 200;

/**
 * Read every answer row for a destination suggestion, read-only, bounded
 * (mirrors source-bundle-reviewers.js's own `readAnswerRows` bound). Selects
 * exactly `REVIEWER_ANSWER_FIELDS` (the same allowlist the bundle exports
 * and the seeder writes) plus the key column and eTag, so the verifier
 * compares the SAME shape end to end.
 */
async function sandboxGetAnswersBySuggestion(svc, suggestionId) {
  assertTrustedDalContext('reviews-sandbox-deps.getAnswersBySuggestion');
  if (!isGuid(suggestionId)) throw new Error('reviews-sandbox-deps: getAnswersBySuggestion requires a valid GUID');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', REVIEWER_ANSWER_FIELDS.join(','));
  params.set('$filter', odata.eq('_wmkf_appreviewersuggestion_value', suggestionId));
  params.set('$top', String(MAX_ANSWERS_PER_SUGGESTION));
  const resp = await client.get(`/${ANSWER_ENTITY_SET}?${params.toString()}`, ANNOTATION_HEADERS);
  if (!resp.ok) throw sandboxHttpError(resp, 'getAnswersBySuggestion');
  const body = resp.body || {};
  if (body['@odata.nextLink']) {
    throw new Error('reviews-sandbox-deps: getAnswersBySuggestion returned more rows than the bounded read limit; refusing a partial set.');
  }
  return (body.value || []).map(processAnnotations);
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
    findAnyPersonByEmail: (email) => sandboxFindAnyPersonByEmail(svc, email),
    getPersonById: (id, options) => sandboxGetPersonById(svc, id, options),
    getSuggestionById: (id, options) => sandboxGetSuggestionById(svc, id, options),
    listSuggestionsByRequest: (requestId) => sandboxListSuggestionsByRequest(svc, requestId),
    getAnswersBySuggestion: (suggestionId) => sandboxGetAnswersBySuggestion(svc, suggestionId),
    createPerson: (payload) => sandboxCreatePerson(svc, payload),
    createSuggestion: (payload) => sandboxCreateSuggestion(svc, payload),
    runChangeset: (operations, options) => sandboxRunChangeset(svc, operations, options),
  });
}

// Exported for run-runner.js's own getPersonById calls (P3, Opus round 1:
// "one source of truth" for the person select list).
export { PERSON_READ_FIELDS };
