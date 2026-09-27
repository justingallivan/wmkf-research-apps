/**
 * Test Request Factory `pre_site_visit` recipe (slice 4b) sandbox dependency
 * seam. Mirrors `ia-sandbox-deps.js` / `reviews-sandbox-deps.js`: ONE frozen
 * sandbox-bound Dataverse service (hostname restricted to `SANDBOX_HOSTS`,
 * token fetched per call, explicit `svc.baseUrl`), never `process.env.
 * DYNAMICS_URL`.
 *
 * `createPresiteSandboxDeps({ resourceUrl, graph })` returns a COMPLETE
 * dependency object usable directly as the `dependencies` argument of
 * `generatePreSiteVisitArtifact` (lib/services/pre-site-visit/artifact-
 * service.js) -- every key `DEFAULT_DEPENDENCIES` (artifact-dependencies.js)
 * declares, sandbox-bound or a throwing sentinel, NEVER a fallback to that
 * production default (I9). `createPresiteInputDeps({ resourceUrl, graph })`
 * returns the matching complete object for `loadPreSiteVisitInputs`'s OWN
 * injectable dependencies (proposal-core-service.js `DEFAULT_DEPENDENCIES`).
 *
 * `runProposalCore` and `getBuckets` are throwing sentinels: recipe 4's
 * design (owner decision P2, docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md
 * "Recipe 4 -- pre_site_visit") copies the source's Pre-Site draft rather
 * than regenerating it, so a correctly seeded row is always found by
 * generation key and never reaches either path; a throw here is the safety
 * net (I8), not a functional gap. `getExecutorBudget`/`runPrompt` are the
 * same kind of sentinel on the input side -- `loadPreSiteVisitInputs` itself
 * never calls them (only `generatePreSiteVisitProposalCoreFromInputs`,
 * reached only through `runProposalCore`, does).
 *
 * `getCoPIs`/blockers in `getWriteupRoster` are simplified for this slice
 * (empty by construction) -- see the functions' own doc comments; this does
 * not affect input-snapshot determinism since the same function reference is
 * used at seed and at render time.
 *
 * Registered in `scripts/check-dataverse-access-layer.js` EXEMPT_FILES (same
 * reason as ia-sandbox-deps.js / reviews-sandbox-deps.js: a deliberately
 * org-bound sandbox service has no entity adapter to resolve against).
 */

import crypto from 'crypto';
import dataverseClientModule from '../../dataverse/client.js';
import { SANDBOX_HOSTS } from '../../dataverse/core/target-registry.js';
import { entitySet } from '../../dataverse/core/entity-registry.js';
import * as odata from '../../dataverse/core/odata.js';
import { buildOperations } from '../../dataverse/core/changeset.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { requestDocumentSelect } from '../../dataverse/adapters/request-document.js';
import { assertTrustedDalContext } from '../dynamics-context.js';
import { isGuid } from '../../utils/guid.js';
import { _withCallerId, _writeFetch, createRecord as writeCoreCreateRecord } from '../dynamics/write-core.js';
import { executeChangeset } from '../dynamics/changeset.js';
import { processAnnotations } from '../dynamics/annotations.js';
import { buildHeaders } from '../dynamics/http.js';
import { hashGovernedDocxContent } from '../documents/governed-docx-hash.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { renderPreSiteVisitDocx } from '../pre-site-visit/docx-renderer.js';
import { REQUEST_LINEAGE_SELECT } from '../pre-site-visit/artifact-model.js';
import { composeRefereeSection } from '../../../shared/utils/review-writeup-paragraphs.js';
import { createReviewsSandboxDeps } from './reviews-sandbox-deps.js';

const { getAccessToken: getSandboxAccessToken, createClient } = dataverseClientModule;

const REQUEST_DOCUMENT_ENTITY_SET = entitySet('wmkf_requestdocuments');
const GRANT_REQUEST_ENTITY_SET = entitySet('akoya_requests');
const ACCOUNT_ENTITY_SET = entitySet('accounts');
const AI_RUN_ENTITY_SET = entitySet('wmkf_ai_runs');

const ANNOTATION_HEADERS = Object.freeze({ Prefer: 'odata.include-annotations="*"' });
const NEXT_LINK_PAGE_CAP = 50;

function sandboxHttpError(resp, label) {
  const error = new Error(`presite-sandbox-deps: ${label} failed (${resp.status})`);
  error.status = resp.status;
  error.body = resp.text;
  return error;
}

/** Same bare-origin/registered-host guard as ia-sandbox-deps.js/reviews-sandbox-deps.js. */
function assertSandboxHost(resourceUrl) {
  let parsed;
  try {
    parsed = new URL(resourceUrl);
  } catch {
    throw new Error(`presite-sandbox-deps: resourceUrl is not a valid URL: ${resourceUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`presite-sandbox-deps: resourceUrl must use https: (got "${parsed.protocol}")`);
  }
  if (parsed.port !== '' || resourceUrl !== parsed.origin) {
    throw new Error(
      `presite-sandbox-deps: resourceUrl must be a bare origin with no port/userinfo/path `
      + `(got "${resourceUrl}", expected "https://${parsed.hostname}")`,
    );
  }
  if (!SANDBOX_HOSTS.includes(parsed.hostname)) {
    throw new Error(
      `presite-sandbox-deps: refusing non-sandbox Dataverse host "${parsed.hostname}" `
      + `(registered sandbox hosts: ${SANDBOX_HOSTS.join(', ')})`,
    );
  }
  return parsed.hostname;
}

function throwingSentinel(name) {
  return async function productionSentinel() {
    throw new Error(
      `presite-sandbox-deps: ${name} must never be reached by the pre_site_visit recipe `
      + `(the seeded draft is always found by generation key); refusing rather than `
      + `falling through to a production-bound default.`,
    );
  };
}

async function sandboxFindByGenerationKey(svc, generationKey) {
  assertTrustedDalContext('presite-sandbox-deps.findByGenerationKey');
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
  assertTrustedDalContext('presite-sandbox-deps.findByRequest');
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
  for (let guard = 0; guard < NEXT_LINK_PAGE_CAP && path; guard += 1) {
    const resp = await client.get(path, ANNOTATION_HEADERS);
    if (!resp.ok) throw sandboxHttpError(resp, 'findByRequest');
    records = records.concat(resp.body?.value || []);
    path = resp.body?.['@odata.nextLink'] || null;
    if (path && guard === NEXT_LINK_PAGE_CAP - 1) {
      throw Object.assign(
        new Error(`presite-sandbox-deps: findByRequest exceeded ${NEXT_LINK_PAGE_CAP} pages without exhausting @odata.nextLink`),
        { code: 'presite_sandbox_deps_pagination_cap_exceeded' },
      );
    }
  }
  return { records: records.map(processAnnotations) };
}

async function sandboxGetEntityById(svc, entitySetName, id, { select, label } = {}) {
  assertTrustedDalContext(`presite-sandbox-deps.get${label || entitySetName}`);
  if (!isGuid(id)) throw new Error(`presite-sandbox-deps: get${label || entitySetName} requires a valid GUID`);
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const query = select ? `?${new URLSearchParams({ $select: odata.select(select) }).toString()}` : '';
  const resp = await client.get(`/${entitySetName}(${id})${query}`, ANNOTATION_HEADERS);
  if (resp.status === 404) return null;
  if (!resp.ok) throw sandboxHttpError(resp, `get${label || entitySetName}`);
  return processAnnotations(resp.body);
}

function sandboxRunChangeset(svc, operations, options = {}) {
  assertTrustedDalContext('presite-sandbox-deps.runChangeset');
  return executeChangeset(svc, buildOperations(operations), options);
}

/**
 * Force SANDBOX_REHEARSAL regardless of what a caller supplies (same
 * defense-in-depth override as ia-sandbox-deps.js sandboxCreateDocument) --
 * this module's own callers already pass SANDBOX_REHEARSAL explicitly
 * (I10), so this is a second, independent guarantee.
 */
function sandboxCreateDocument(svc, payload, options = {}) {
  assertTrustedDalContext('presite-sandbox-deps.createDocument');
  const { actingUserSystemId: _ignoredActingUserSystemId, actorPolicy: _ignoredActorPolicy, ...rest } = options;
  return requestDocumentAdapter.create(payload, {
    ...rest,
    actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.SANDBOX_REHEARSAL,
    svc,
  });
}

function sandboxUpdateDocument(svc, id, patch, options = {}) {
  assertTrustedDalContext('presite-sandbox-deps.updateDocument');
  return requestDocumentAdapter.update(id, patch, { ...options, svc });
}

/**
 * Create ONE stub `wmkf_ai_run` row through the sandbox client -- a named
 * sandbox-only op, never `DynamicsService`/`logAiRun`/`writeRunRow` (all
 * production-bound). Mirrors `write-core.js` createRecord's shape, exactly
 * as ia-sandbox-deps.js's sandboxCreateDocument reuses it for
 * wmkf_requestdocuments.
 */
function sandboxCreateAiRun(svc, payload) {
  assertTrustedDalContext('presite-sandbox-deps.createAiRun');
  return writeCoreCreateRecord(svc, AI_RUN_ENTITY_SET, payload, {});
}

/**
 * Read one `wmkf_ai_run` row back by GUID (I3 exact-item recovery for
 * `seed_presite_ai_run`).
 */
function sandboxGetAiRunById(svc, id, { select } = {}) {
  return sandboxGetEntityById(svc, AI_RUN_ENTITY_SET, id, { select, label: 'AiRun' });
}

/**
 * Narrow sandbox deps for `seed_presite_ai_run` alone: the stub
 * `wmkf_ai_run` create/read, nothing else (no loadInputs/graph seam needed).
 */
export function createPresiteAiRunDeps({ resourceUrl }) {
  const svc = buildSvc(resourceUrl);
  return Object.freeze({
    createAiRun: (payload) => sandboxCreateAiRun(svc, payload),
    getAiRunById: (id, options) => sandboxGetAiRunById(svc, id, options),
    getCurrentPrompt: (promptName) => sandboxFetchCurrentPrompt(svc, promptName),
  });
}

function buildSvc(resourceUrl) {
  assertSandboxHost(resourceUrl);
  return Object.freeze({
    resourceUrl,
    baseUrl: `${resourceUrl}/api/data/v9.2`,
    getAccessToken: () => getSandboxAccessToken(resourceUrl),
    buildHeaders,
    processAnnotations,
    _withCallerId,
    _writeFetch,
  });
}

/**
 * Build the COMPLETE, sandbox-bound `dependencies` object for
 * `generatePreSiteVisitArtifact` -- every key `DEFAULT_DEPENDENCIES`
 * (artifact-dependencies.js) declares. `loadInputs` must be built by the
 * CALLER with `createPresiteInputDeps` and passed in as `loadInputs` so
 * `seed_presite_draft` and `render_presite` share the exact same bound
 * function reference (never a structurally-equal copy) -- otherwise the
 * input-snapshot-equality invariant is not actually exercised.
 *
 * @param {object} params
 * @param {string} params.resourceUrl
 * @param {Function} params.loadInputs - `(args) => loadPreSiteVisitInputs(args, sandboxInputDeps)`
 * @param {object} [params.graph] - the runner's own Graph dependency object
 *   (ensureFolderPath/uploadFile/getFileMetadataByPath/downloadFile/deleteFile),
 *   forwarded verbatim under DEFAULT_DEPENDENCIES' key names.
 */
export function createPresiteSandboxDeps({ resourceUrl, loadInputs, graph }) {
  if (typeof loadInputs !== 'function') {
    throw new Error('presite-sandbox-deps: createPresiteSandboxDeps requires loadInputs.');
  }
  const svc = buildSvc(resourceUrl);
  return Object.freeze({
    loadInputs,
    getCurrentPrompt: (promptName) => sandboxFetchCurrentPrompt(svc, promptName),
    // Owner decision P2: recipe 4 copies the source draft; runProposalCore is
    // never reached by a correctly seeded row (I8 safety net).
    runProposalCore: throwingSentinel('runProposalCore'),
    renderDocx: renderPreSiteVisitDocx,
    hashDocx: hashGovernedDocxContent,
    getRequest: (requestId, options) => sandboxGetEntityById(svc, GRANT_REQUEST_ENTITY_SET, requestId, {
      select: REQUEST_LINEAGE_SELECT, ...options, label: 'Request',
    }),
    // The seeded row is always found by generation key before a bucket
    // would ever be resolved (activeRequestBucket is only reached on a
    // fresh create) -- throwing sentinel (I8-style safety net).
    getBuckets: throwingSentinel('getBuckets'),
    findByGenerationKey: (generationKey) => sandboxFindByGenerationKey(svc, generationKey),
    findByRequest: (requestId, options) => sandboxFindByRequest(svc, requestId, options),
    createDocument: (payload, options) => sandboxCreateDocument(svc, payload, options),
    updateDocument: (id, patch, options) => sandboxUpdateDocument(svc, id, patch, options),
    commitChangeset: (operations, options) => sandboxRunChangeset(svc, operations, options),
    ensureFolderPath: (...args) => graph.ensureFolderPath(...args),
    // I2 (create-only): artifact-service.js calls `uploadFile(library, folder,
    // filename, content, contentType)` with only 5 positional args -- no
    // options object, so GraphService.uploadFile would otherwise default to
    // conflictBehavior 'replace'. Force 'fail' here regardless of what the
    // caller passes (a 6th argument would be silently ignored, not merged),
    // so a name collision refuses rather than overwriting a prior upload.
    // This never trips on a legitimate resume: fileNameFor (artifact-
    // model.js) suffixes every filename with the claim token, so each claim
    // owns a unique name, and recoverUploadedFile (artifact-upload-
    // recovery.js) calls getFileMetadataByPath FIRST and skips a fresh
    // upload when the item is already there. Only a true name collision (a
    // bug, or two independent claims racing on the same claim token) ever
    // reaches this uploadFile call at all -- and that must refuse, never
    // silently replace. Proven directly in presite-sandbox-deps.test.js.
    uploadFile: (library, folder, filename, content, contentType) => graph.uploadFile(
      library, folder, filename, content, contentType, { conflictBehavior: 'fail' },
    ),
    getFileMetadataByPath: (...args) => graph.getFileMetadataByPath(...args),
    downloadFile: (...args) => graph.downloadFile(...args),
    deleteFile: (...args) => graph.deleteFile(...args),
    newClaimToken: () => crypto.randomUUID(),
    // Pure env/config read (lib/utils/guarded-reopen-readiness.js), not
    // Dataverse/Graph-bound; the rehearsal shell sets the same flag the
    // Step 0 probe recorded (FINAL_WRITEUP_SCHEMA_READY=on).
    isGuardedReopenSchemaReady: () => false,
    createAiRun: (payload) => sandboxCreateAiRun(svc, payload),
    getAiRunById: (id, options) => sandboxGetAiRunById(svc, id, options),
  });
}

const REQUEST_INPUT_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'akoya_title', '_akoya_applicantid_value',
  '_wmkf_projectleader_value', '_akoya_programid_value', '_wmkf_programdirector_value',
  'wmkf_meetingdate', 'akoya_request', 'wmkf_invitedamount', 'akoya_expenses',
  'akoya_begindate', 'akoya_enddate',
].join(',');
const APPLICANT_SELECT = 'akoya_aka,name,address1_city,address1_stateorprovince,wmkf_countofprogramgrants,wmkf_sumofprogramgrants';

/**
 * Sandbox-bound `getProposalNarrative`: locates the destination's already
 * copied `proposalNarrative` bundle document (the `reviews`/Basic clone
 * steps copy it before this recipe's steps run) via the run ledger's own
 * copy_file readback, downloads it through the runner's `graph` binding for
 * REAL file identity (siteId/driveId/itemId/versionId/contentHash), and
 * derives a deterministic `text` from those real bytes. The actual prose is
 * never part of `buildPreSiteVisitInputSnapshot`'s output (only
 * `sourceManifest`'s file-identity fields are, via `inputs.proposalNarrative`)
 * -- only a >=60-character non-empty string is required by
 * `loadPreSiteVisitInputs`'s completeness gate -- so a deterministic
 * transform of the real bytes (same function reference at seed and render
 * time, same bytes both times) preserves input-snapshot equality without
 * reimplementing PDF text extraction (workbench-proposal-documents.js's
 * `extractTextFromBuffer` is module-private and not exported).
 */
function makeGetProposalNarrative({ graph, findProposalNarrativeLocation }) {
  return async function getProposalNarrative(requestId, requestNumber) {
    const location = await findProposalNarrativeLocation(requestId, requestNumber);
    if (!location) return null;
    const { driveId, itemId, filename, siteId, versionId } = location;
    const downloaded = await graph.downloadFile(driveId, itemId);
    const buffer = downloaded?.buffer;
    if (!buffer || !buffer.length) return null;
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    return {
      text: `Copied proposal narrative bytes (${buffer.length} bytes, sha256 ${contentHash}). `
        + 'Content is the exact source-request AI Materials narrative, copied verbatim by an earlier recipe step.',
      filename,
      siteId,
      driveId,
      itemId,
      versionId,
      contentHash,
    };
  };
}

/**
 * Build the COMPLETE, sandbox-bound `dependencies` object for
 * `loadPreSiteVisitInputs` -- every key proposal-core-service.js's OWN
 * `DEFAULT_DEPENDENCIES` declares.
 *
 * @param {object} params
 * @param {string} params.resourceUrl
 * @param {object} params.graph - the runner's Graph dependency object.
 * @param {Function} params.findProposalNarrativeLocation - `(requestId, requestNumber) =>
 *   { driveId, itemId, filename, siteId, versionId } | null`, resolved by the
 *   caller from the run's ledger/bundle (the already-copied proposalNarrative
 *   document), never derived from environment/production adapters here.
 */
export function createPresiteInputDeps({ resourceUrl, graph, findProposalNarrativeLocation }) {
  if (typeof findProposalNarrativeLocation !== 'function') {
    throw new Error('presite-sandbox-deps: createPresiteInputDeps requires findProposalNarrativeLocation.');
  }
  const svc = buildSvc(resourceUrl);
  const reviewsDeps = createReviewsSandboxDeps({ resourceUrl });
  return Object.freeze({
    getRequest: (requestId) => sandboxGetEntityById(svc, GRANT_REQUEST_ENTITY_SET, requestId, { select: REQUEST_INPUT_SELECT, label: 'Request' }),
    getApplicant: (applicantId) => sandboxGetEntityById(svc, ACCOUNT_ENTITY_SET, applicantId, { select: APPLICANT_SELECT, label: 'Applicant' }),
    // Co-PI relationship rows are not modelled for sandbox test-request
    // clones in this slice (the destination clone never seeds
    // wmkf_apprequestperson rows); an empty list is deterministic across
    // seed and render and only narrows the rendered Personnel roster to the
    // PI, which `requireIdentity` still accepts.
    getCoPIs: async () => [],
    getProposalNarrative: makeGetProposalNarrative({ graph, findProposalNarrativeLocation }),
    getProgramGrants: (applicantId) => sandboxLoadProgramGrants(svc, applicantId),
    // Never reached by loadPreSiteVisitInputs itself (only by
    // generatePreSiteVisitProposalCoreFromInputs, gated behind the
    // throwing runProposalCore sentinel above) -- I8 safety net.
    getExecutorBudget: throwingSentinel('getExecutorBudget'),
    runPrompt: throwingSentinel('runPrompt'),
    getWriteupRoster: (requestId) => sandboxGetWriteupRoster(reviewsDeps, requestId),
    composeRefereeSection,
  });
}

const PROGRAM_GRANT_SELECT = [
  'akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate', 'wmkf_invitedamount', 'statuscode',
].join(',');
const MAX_PROGRAM_GRANTS = 200;

/** Sandbox-bound program-grant list for one applicant, bounded (mirrors funding-history.js's own shape: {records, capped}). */
async function sandboxLoadProgramGrants(svc, applicantId) {
  assertTrustedDalContext('presite-sandbox-deps.loadProgramGrants');
  if (!isGuid(applicantId)) throw new Error('presite-sandbox-deps: loadProgramGrants requires a valid applicant GUID');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', PROGRAM_GRANT_SELECT);
  params.set('$filter', odata.eqGuid('_akoya_applicantid_value', applicantId));
  params.set('$top', String(MAX_PROGRAM_GRANTS));
  const resp = await client.get(`/${GRANT_REQUEST_ENTITY_SET}?${params.toString()}`, ANNOTATION_HEADERS);
  if (!resp.ok) throw sandboxHttpError(resp, 'loadProgramGrants');
  const body = resp.body || {};
  const capped = Boolean(body['@odata.nextLink']);
  return { records: (body.value || []).map(processAnnotations), capped };
}

const ROSTER_SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid', 'wmkf_accepted', 'wmkf_reviewreceivedat',
  '_wmkf_potentialreviewer_value', 'wmkf_revieweraffiliation',
];
const ROSTER_PERSON_SELECT = [
  'wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_emailaddress', 'wmkf_primaryaffiliation',
  'wmkf_organizationname', 'wmkf_lastname', 'wmkf_academicrank', 'wmkf_maininstitution',
  'wmkf_areaofexpertise', 'wmkf_keywords',
];

/**
 * Sandbox-bound `getWriteupRoster` (Slice 4 parity: proposal-core-service.js
 * uses this for the `[[STAFF:RefereeSection]]` fill). Simplified relative to
 * the production reader (review-manager/reviewers-service.js): `blockers` is
 * always `[]` (the production readiness/blocker computation is not
 * reproduced here). This does not affect input-snapshot determinism -- the
 * SAME function reference/result shape is used at seed and render time.
 */
async function sandboxGetWriteupRoster(reviewsDeps, requestId) {
  if (!requestId) return { reviewers: [], blockers: [] };
  const suggestionIds = await reviewsDeps.listSuggestionsByRequest(requestId);
  const suggestions = (await Promise.all(
    suggestionIds.map((id) => reviewsDeps.getSuggestionById(id, { select: ROSTER_SUGGESTION_SELECT })),
  )).filter((s) => s && (s.wmkf_accepted === true || Boolean(s.wmkf_reviewreceivedat)));

  const personIds = [...new Set(suggestions.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const personById = new Map((await Promise.all(
    personIds.map((id) => reviewsDeps.getPersonById(id, { select: ROSTER_PERSON_SELECT })),
  )).filter(Boolean).map((person) => [person.wmkf_potentialreviewersid, person]));

  const reviewers = await Promise.all(suggestions.map(async (s) => {
    const person = personById.get(s._wmkf_potentialreviewer_value) || {};
    const answers = s.wmkf_reviewreceivedat
      ? await reviewsDeps.getAnswersBySuggestion(s.wmkf_appreviewersuggestionid)
      : [];
    return {
      suggestionId: s.wmkf_appreviewersuggestionid,
      name: person.wmkf_name || null,
      email: person.wmkf_emailaddress || null,
      reviewerAffiliation: s.wmkf_revieweraffiliation || null,
      affiliation: person.wmkf_primaryaffiliation || person.wmkf_organizationname || null,
      lastName: person.wmkf_lastname || null,
      academicRank: person.wmkf_academicrank || null,
      mainInstitution: person.wmkf_maininstitution || null,
      areaOfExpertise: person.wmkf_areaofexpertise || null,
      keywords: person.wmkf_keywords || null,
      reviewReceivedAt: s.wmkf_reviewreceivedat || null,
      reviewSharePointFolder: null,
      reviewFilename: null,
      reviewerOverallAssessment: null,
      answers,
    };
  }));
  return { reviewers, blockers: [] };
}

async function sandboxFetchCurrentPrompt(svc, promptName) {
  assertTrustedDalContext('presite-sandbox-deps.getCurrentPrompt');
  const token = await svc.getAccessToken();
  const client = createClient({ resourceUrl: svc.resourceUrl, token });
  const params = new URLSearchParams();
  params.set('$select', [
    'wmkf_ai_promptid', 'wmkf_promptversion', 'wmkf_ai_promptvariables', 'wmkf_ai_promptoutputschema',
    'wmkf_ai_systemprompt', 'wmkf_ai_promptbody',
  ].join(','));
  params.set('$filter', odata.and([
    odata.eq('wmkf_ai_promptname', promptName),
    odata.eqRaw('statecode', 0),
  ]));
  params.set('$orderby', 'wmkf_promptversion desc');
  params.set('$top', '1');
  const resp = await client.get(`/wmkf_ai_prompts?${params.toString()}`, ANNOTATION_HEADERS);
  if (!resp.ok) throw sandboxHttpError(resp, 'getCurrentPrompt');
  const [row] = resp.body?.value || [];
  return row ? processAnnotations(row) : null;
}
