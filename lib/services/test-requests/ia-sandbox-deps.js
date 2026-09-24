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
import { requestDocumentSelect } from '../../dataverse/adapters/request-document.js';
import { assertTrustedDalContext } from '../dynamics-context.js';
import { _withCallerId, _writeFetch } from '../dynamics/write-core.js';
import { executeChangeset } from '../dynamics/changeset.js';

// lib/dataverse/client.js is CommonJS (`module.exports = {...}`); imported by
// its default namespace object (not named imports) so this module never
// depends on a bundler's CJS named-export static analysis.
const { getAccessToken: getSandboxAccessToken, createClient } = dataverseClientModule;

const REQUEST_DOCUMENT_ENTITY_SET = entitySet('wmkf_requestdocuments');
const GRANT_REQUEST_ENTITY_SET = entitySet('akoya_requests');

function sandboxHttpError(resp, label) {
  const error = new Error(`ia-sandbox-deps: ${label} failed (${resp.status})`);
  error.status = resp.status;
  error.body = resp.text;
  return error;
}

/**
 * Validate a Dataverse org URL resolves to a tracked SANDBOX_HOSTS hostname.
 * Throws on anything else (unparseable, production, or unknown) — fail
 * closed, matching the registry's own "extending it is a reviewed commit"
 * contract (never inferred from an env var name).
 *
 * @param {string} resourceUrl
 * @returns {string} the validated hostname
 */
function assertSandboxHost(resourceUrl) {
  let hostname;
  try {
    hostname = new URL(resourceUrl).hostname;
  } catch {
    throw new Error(`ia-sandbox-deps: resourceUrl is not a valid URL: ${resourceUrl}`);
  }
  if (!SANDBOX_HOSTS.includes(hostname)) {
    throw new Error(
      `ia-sandbox-deps: refusing non-sandbox Dataverse host "${hostname}" `
      + `(registered sandbox hosts: ${SANDBOX_HOSTS.join(', ')})`,
    );
  }
  return hostname;
}

async function sandboxFindByGenerationKey(svc, generationKey) {
  assertTrustedDalContext('ia-sandbox-deps.findByGenerationKey');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', requestDocumentSelect());
  params.set('$filter', odata.eq('wmkf_generationkey', generationKey));
  params.set('$top', '2');
  const resp = await client.get(`/${REQUEST_DOCUMENT_ENTITY_SET}?${params.toString()}`);
  if (!resp.ok) throw sandboxHttpError(resp, 'findByGenerationKey');
  return { records: resp.body?.value || [] };
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
  // so a misbehaving mock/server can never spin this loop forever.
  for (let guard = 0; guard < 50 && path; guard += 1) {
    const resp = await client.get(path);
    if (!resp.ok) throw sandboxHttpError(resp, 'findByRequest');
    records = records.concat(resp.body?.value || []);
    path = resp.body?.['@odata.nextLink'] || null;
  }
  return { records };
}

async function sandboxGetRequest(svc, requestId, { select } = {}) {
  assertTrustedDalContext('ia-sandbox-deps.getRequest');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const query = select ? `?${new URLSearchParams({ $select: odata.select(select) }).toString()}` : '';
  const resp = await client.get(`/${GRANT_REQUEST_ENTITY_SET}(${requestId})${query}`);
  if (!resp.ok) throw sandboxHttpError(resp, 'getRequest');
  return resp.body;
}

function sandboxRunChangeset(svc, operations, options = {}) {
  assertTrustedDalContext('ia-sandbox-deps.runChangeset');
  return executeChangeset(svc, buildOperations(operations), options);
}

/**
 * Build one sandbox-bound `dependencies` object usable directly as the
 * `dependencies` option of `commitReadyLineage`/`resolveCanonicalInitialAssessment`
 * (and anything else built on the same DEFAULT_DEPENDENCIES key names).
 *
 * @param {object} params
 * @param {string} params.resourceUrl - the sandbox org's root URL
 *   (`https://<host>`), validated against SANDBOX_HOSTS.
 * @returns {{findByGenerationKey: Function, findByRequest: Function, getRequest: Function, runChangeset: Function}}
 */
export function createIaSandboxDeps({ resourceUrl } = {}) {
  assertSandboxHost(resourceUrl);
  let cachedToken = null;
  const svc = Object.freeze({
    resourceUrl,
    baseUrl: `${resourceUrl}/api/data/v9.2`,
    async getAccessToken() {
      if (!cachedToken) cachedToken = await getSandboxAccessToken(resourceUrl);
      return cachedToken;
    },
    _withCallerId,
    _writeFetch,
  });
  return Object.freeze({
    findByGenerationKey: (generationKey) => sandboxFindByGenerationKey(svc, generationKey),
    findByRequest: (requestId, options) => sandboxFindByRequest(svc, requestId, options),
    getRequest: (requestId, options) => sandboxGetRequest(svc, requestId, options),
    runChangeset: (operations, options) => sandboxRunChangeset(svc, operations, options),
  });
}
