/**
 * Sandbox-only Dataverse dependency seam for the Initial Assessment lineage
 * commit path (Test Request Factory slice 6b, Stage A item 2).
 *
 * `createIaSandboxDeps({ resourceUrl })` builds ONE sandbox-bound Dataverse
 * service and derives every dependency `commitReadyLineage` /
 * `verifyReadyLineage` / `resolveCanonicalInitialAssessment`
 * (lib/services/initial-assessment/artifact-lineage.js,
 * lib/services/initial-assessment/artifact-reader.js) need —
 * `findByGenerationKey`, `findByRequest`, `getRequest`, `runChangeset` — from
 * that ONE bound host. The constructor refuses any hostname other than the
 * tracked `SANDBOX_HOSTS` registry (lib/dataverse/core/target-registry.js),
 * so a Stage B caller cannot point this seam at production by supplying a
 * different URL, and the resulting service object is frozen: nothing after
 * construction can repoint its host, token, or transport.
 *
 * Two transports, matching the write/read split already live in the repo:
 *   - Reads (findByGenerationKey/findByRequest/getRequest) go through
 *     `lib/dataverse/client.js`'s `createClient({ resourceUrl, token })` —
 *     the existing interlock-checked (`assertDataverseOperationAllowed`,
 *     keyed off the actual request URL — lib/dataverse/client.js `call()`)
 *     REST client that already takes an explicit `resourceUrl` instead of
 *     reading `process.env.DYNAMICS_URL`. They reproduce the exact
 *     `$select`/`$filter`/`$orderby` shapes
 *     `lib/dataverse/adapters/request-document.js` /
 *     `lib/dataverse/adapters/grant-request.js` build today, reusing the same
 *     pure `odata.js` builders and `requestDocumentSelect()` — this file does
 *     NOT reinvent that query logic, only its transport.
 *   - The changeset write goes through `executeChangeset`
 *     (lib/services/dynamics/changeset.js), which this Stage A change taught
 *     to prefer an explicit `svc.baseUrl` over `process.env.DYNAMICS_URL`
 *     when the service supplies one. The lineage commit therefore stays ONE
 *     atomic `$batch` changeset — this module does not split it.
 *
 * `lib/services/dynamics/read-ops.js` (queryRecords/getRecord/queryAllRecords)
 * is out of scope to modify (Stage A instructions) and reads
 * `process.env.DYNAMICS_URL` directly, so it cannot serve a sandbox-bound
 * read — hence the separate `createClient`-based read path above.
 *
 * Every dependency runs inside a trusted DAL context
 * (`assertTrustedDalContext`) so the fail-closed contract holds even if a
 * future caller forgets to wrap its own call in `withDalContext`.
 */

import dataverseClientModule from '../../dataverse/client.js';
import { SANDBOX_HOSTS } from '../../dataverse/core/target-registry.js';
import { entitySet } from '../../dataverse/core/entity-registry.js';
import * as odata from '../../dataverse/core/odata.js';
import { buildOperations } from '../../dataverse/core/changeset.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { requestDocumentSelect } from '../../dataverse/adapters/request-document.js';
import { assertTrustedDalContext } from '../dynamics-context.js';
import { isGuid } from '../../utils/guid.js';
import { _withCallerId, _writeFetch } from '../dynamics/write-core.js';
import { executeChangeset } from '../dynamics/changeset.js';
import { processAnnotations } from '../dynamics/annotations.js';
import { buildHeaders } from '../dynamics/http.js';

// lib/dataverse/client.js is CommonJS (`module.exports = {...}`); imported by
// its default namespace object (not named imports) so this module never
// depends on a bundler's CJS named-export static analysis.
const { getAccessToken: getSandboxAccessToken, createClient } = dataverseClientModule;

const REQUEST_DOCUMENT_ENTITY_SET = entitySet('wmkf_requestdocuments');
const GRANT_REQUEST_ENTITY_SET = entitySet('akoya_requests');

// The production read path (lib/services/dynamics/http.js:41) always sends
// this Prefer header so Dataverse includes @odata.etag and *_formatted
// annotations on every response; without it, conditionalOptions
// (artifact-lineage.js) would find no `_etag` and throw. Sandbox reads must
// send the identical header and run every returned record through the same
// `processAnnotations` (lib/services/dynamics/annotations.js) the production
// singleton applies, or the two paths disagree on row shape.
const ANNOTATION_HEADERS = Object.freeze({ Prefer: 'odata.include-annotations="*"' });

const NEXT_LINK_PAGE_CAP = 50;

function sandboxHttpError(resp, label) {
  const error = new Error(`ia-sandbox-deps: ${label} failed (${resp.status})`);
  error.status = resp.status;
  error.body = resp.text;
  return error;
}

/**
 * Validate a Dataverse org URL is a bare `https://<sandbox-host>` origin —
 * resolves to a tracked SANDBOX_HOSTS hostname, `https:` only, and carries no
 * port/userinfo/path/query/fragment (a `resourceUrl` with a stray path would
 * still classify correctly by hostname but would silently double up when this
 * module appends `/api/data/v9.2`). Throws on anything else (unparseable,
 * non-https, non-origin, production, or unknown) — fail closed, matching the
 * registry's own "extending it is a reviewed commit" contract (never inferred
 * from an env var name).
 *
 * @param {string} resourceUrl
 * @returns {string} the validated hostname
 */
function assertSandboxHost(resourceUrl) {
  let parsed;
  try {
    parsed = new URL(resourceUrl);
  } catch {
    throw new Error(`ia-sandbox-deps: resourceUrl is not a valid URL: ${resourceUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`ia-sandbox-deps: resourceUrl must use https: (got "${parsed.protocol}")`);
  }
  // `URL#origin` excludes userinfo but INCLUDES an explicit port, so an
  // origin-only comparison alone would silently accept "https://host:8443"
  // (origin equals the input verbatim) — check the port separately.
  if (parsed.port !== '' || resourceUrl !== parsed.origin) {
    throw new Error(
      `ia-sandbox-deps: resourceUrl must be a bare origin with no port/userinfo/path `
      + `(got "${resourceUrl}", expected "https://${parsed.hostname}")`,
    );
  }
  if (!SANDBOX_HOSTS.includes(parsed.hostname)) {
    throw new Error(
      `ia-sandbox-deps: refusing non-sandbox Dataverse host "${parsed.hostname}" `
      + `(registered sandbox hosts: ${SANDBOX_HOSTS.join(', ')})`,
    );
  }
  return parsed.hostname;
}

// Sandbox reads deliberately skip DynamicsService.checkRestriction: this is
// an operator-only sandbox path (the Test Request Factory rehearsal), not a
// staff-facing surface subject to Dynamics field/table restrictions.
async function sandboxFindByGenerationKey(svc, generationKey) {
  assertTrustedDalContext('ia-sandbox-deps.findByGenerationKey');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', requestDocumentSelect());
  params.set('$filter', odata.eq('wmkf_generationkey', generationKey));
  params.set('$top', '2');
  const resp = await client.get(`/${REQUEST_DOCUMENT_ENTITY_SET}?${params.toString()}`, ANNOTATION_HEADERS);
  if (!resp.ok) throw sandboxHttpError(resp, 'findByGenerationKey');
  return { records: (resp.body?.value || []).map(processAnnotations) };
}

async function sandboxFindByRequest(svc, requestId, { artifactType } = {}) {
  assertTrustedDalContext('ia-sandbox-deps.findByRequest');
  const filters = [odata.eqGuid('_wmkf_request_value', requestId)];
  if (artifactType !== undefined) {
    filters.push(odata.eqRaw('wmkf_artifacttype', Number(artifactType)));
  }
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', requestDocumentSelect());
  params.set('$filter', odata.and(filters));
  params.set('$orderby', 'createdon desc');
  let path = `/${REQUEST_DOCUMENT_ENTITY_SET}?${params.toString()}`;
  let records = [];
  // Follow @odata.nextLink like the production queryAllRecords path; capped
  // so a misbehaving mock/server can never spin this loop forever. Unlike
  // queryAllRecords (which has no such cap because production paging is
  // trusted to terminate), reaching the cap here throws rather than silently
  // returning a truncated result — a caller cannot tell "no more pages" from
  // "gave up after 50" otherwise.
  for (let guard = 0; guard < NEXT_LINK_PAGE_CAP && path; guard += 1) {
    const resp = await client.get(path, ANNOTATION_HEADERS);
    if (!resp.ok) throw sandboxHttpError(resp, 'findByRequest');
    records = records.concat(resp.body?.value || []);
    path = resp.body?.['@odata.nextLink'] || null;
    if (path && guard === NEXT_LINK_PAGE_CAP - 1) {
      throw Object.assign(
        new Error(`ia-sandbox-deps: findByRequest exceeded ${NEXT_LINK_PAGE_CAP} pages without exhausting @odata.nextLink`),
        { code: 'ia_sandbox_deps_pagination_cap_exceeded' },
      );
    }
  }
  return { records: records.map(processAnnotations) };
}

async function sandboxGetRequest(svc, requestId, { select } = {}) {
  assertTrustedDalContext('ia-sandbox-deps.getRequest');
  // The id is interpolated into the entity path; refuse anything but a GUID
  // (findByRequest gets the same guarantee from odata.eqGuid).
  if (!isGuid(requestId)) throw new Error('ia-sandbox-deps: getRequest requires a valid request GUID');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const query = select ? `?${new URLSearchParams({ $select: odata.select(select) }).toString()}` : '';
  const resp = await client.get(`/${GRANT_REQUEST_ENTITY_SET}(${requestId})${query}`, ANNOTATION_HEADERS);
  if (!resp.ok) throw sandboxHttpError(resp, 'getRequest');
  return processAnnotations(resp.body);
}

function sandboxRunChangeset(svc, operations, options = {}) {
  assertTrustedDalContext('ia-sandbox-deps.runChangeset');
  return executeChangeset(svc, buildOperations(operations), options);
}

/**
 * `createDocument`/`updateDocument` (Stage B, item A): route through the
 * SAME `lib/dataverse/adapters/request-document.js` `create`/`update` the
 * production Initial Assessment producer uses, via that adapter's optional
 * `options.svc` seam (Stage B) — so the sandbox path reuses the adapter's
 * actor-policy resolution and immutable-origin-field guard verbatim rather
 * than duplicating it, and still goes through `write-core.js`'s
 * `svc.baseUrl` preference (Stage B) so the write lands on THIS sandbox
 * host, never `process.env.DYNAMICS_URL`.
 */
function sandboxCreateDocument(svc, payload, options = {}) {
  assertTrustedDalContext('ia-sandbox-deps.createDocument');
  return requestDocumentAdapter.create(payload, { ...options, svc });
}

function sandboxUpdateDocument(svc, id, patch, options = {}) {
  assertTrustedDalContext('ia-sandbox-deps.updateDocument');
  return requestDocumentAdapter.update(id, patch, { ...options, svc });
}

/**
 * Build one sandbox-bound `dependencies` object usable directly as the
 * positional `dependencies` argument of `commitReadyLineage` (third) and
 * `resolveCanonicalInitialAssessment` (second), and anything else built on
 * the same DEFAULT_DEPENDENCIES key names.
 *
 * @param {object} params
 * @param {string} params.resourceUrl - the sandbox org's root URL
 *   (`https://<host>`), validated against SANDBOX_HOSTS.
 * @returns {{findByGenerationKey: Function, findByRequest: Function, getRequest: Function, runChangeset: Function}}
 */
export function createIaSandboxDeps({ resourceUrl } = {}) {
  assertSandboxHost(resourceUrl);
  // lib/dataverse/client.js's getAccessToken(resourceUrl) returns only the
  // token string — it does not expose `expires_in` — so there is no expiry
  // to cache against. Caching an un-expiring token risks using it past its
  // real lifetime; fetching fresh every call is the simplest correct option
  // for this operator-only rehearsal path (no request-volume pressure to
  // justify caching's added state).
  const svc = Object.freeze({
    resourceUrl,
    baseUrl: `${resourceUrl}/api/data/v9.2`,
    getAccessToken: () => getSandboxAccessToken(resourceUrl),
    // buildHeaders/processAnnotations: only needed by the write-core.js
    // createRecord/updateRecord path (createDocument/updateDocument below);
    // findByGenerationKey/findByRequest/getRequest/runChangeset never read
    // these svc members (they build their own client/headers).
    buildHeaders,
    processAnnotations,
    _withCallerId,
    _writeFetch,
  });
  return Object.freeze({
    findByGenerationKey: (generationKey) => sandboxFindByGenerationKey(svc, generationKey),
    findByRequest: (requestId, options) => sandboxFindByRequest(svc, requestId, options),
    getRequest: (requestId, options) => sandboxGetRequest(svc, requestId, options),
    runChangeset: (operations, options) => sandboxRunChangeset(svc, operations, options),
    createDocument: (payload, options) => sandboxCreateDocument(svc, payload, options),
    updateDocument: (id, patch, options) => sandboxUpdateDocument(svc, id, patch, options),
  });
}
