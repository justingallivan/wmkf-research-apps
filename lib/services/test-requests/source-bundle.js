/**
 * Test Request source bundle (design decision 6, option A).
 *
 * A read-only production step exports what the factory needs from one source
 * Grant Request into a private local JSON bundle; a later sandbox step builds
 * the new request from that bundle. The schema helpers are pure. The exported
 * orchestration function performs injected reads, but owns no Dataverse,
 * Graph, or filesystem client and never writes the bundle.
 *
 * The bundle carries source text (purpose), so callers write it only to a
 * private absolute path and never log it; `summarizeSourceBundle` returns the
 * printable subset. Files are referenced, not embedded: SharePoint is the same
 * akoyaGO site in production and the sandbox. Bundle consumers must re-resolve
 * each document library's drive on the registered site before copying, then
 * re-verify each item's eTag and SHA-256; stored drive IDs are snapshot identity,
 * not copy-time routing authority.
 */

import { PRODUCTION_HOSTS } from '../../dataverse/core/target-registry.js';
import { REGISTERED_SHAREPOINT_SITES } from '../sharepoint-target-registry.js';
import { projectCloneSource } from './sandbox-clone.js';

export const SOURCE_BUNDLE_KIND = 'test-request-source-bundle';
// 6c-ii Stage A (bundle v3): a bundle with a reviewers[] section is written and
// read as version 3; a legacy bundle with no section stays version 2 and
// readable (basic/initial_assessment do not need the section; `reviews`
// reservation refuses a version-2 bundle -- see the CLI). Bumping this
// constant alone would 400 nothing (the bundle is a private local file, not a
// live query), but it DOES change what `readSourceBundle` accepts, so both
// versions are supported explicitly rather than migrated in place.
export const SOURCE_BUNDLE_VERSION = 3;
const SUPPORTED_SOURCE_BUNDLE_VERSIONS = new Set([2, 3]);

const SHA256 = /^[0-9a-f]{64}$/;
const DOCUMENT_KINDS = new Set([
  'projectDescription',
  'biosketches',
  'projectBudget',
  'projectBudgetSpreadsheet',
  'reviewerProposal',
  'proposalNarrative',
  'proposalBibliography',
  // 6c-ii Stage A: an uploaded review's files, keyed to its suggestion (NOT
  // globally unique like the other kinds -- a request can have many uploaded
  // reviews, each with up to 5 files). See the loosened uniqueness rule below.
  'reviewerUpload',
]);
const REPEATABLE_DOCUMENT_KINDS = new Set(['reviewerUpload']);
const DOCUMENT_FIELDS = [
  'id', 'kind', 'library', 'folder', 'name', 'driveId', 'graphItemId', 'sharePointSite',
  'size', 'mimeType', 'eTag', 'versionId', 'contentHash',
  // Only populated (and required) for kind 'reviewerUpload'; null otherwise.
  'suggestionId',
];

function nonEmptyString(value, max = 1000) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function projectSharePointSite(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!nonEmptyString(value.key, 100)
      || !nonEmptyString(value.hostname, 255)
      || !nonEmptyString(value.pathname, 1000)
      || !value.pathname.startsWith('/')) return null;
  return {
    key: value.key,
    hostname: value.hostname.toLowerCase(),
    pathname: value.pathname.toLowerCase(),
  };
}

function sharePointSiteIdentity(site) {
  return [site.key, site.hostname, site.pathname].join('\u0000');
}

function isRegisteredSharePointSite(site) {
  return REGISTERED_SHAREPOINT_SITES.some((registered) => (
    site.key === registered.key
      && site.hostname === registered.hostname
      && site.pathname === registered.pathname
  ));
}

function projectDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Source bundle document is invalid.');
  }
  const failures = [];
  if (!nonEmptyString(document.id, 2000)) failures.push('id');
  if (!DOCUMENT_KINDS.has(document.kind)) failures.push('kind');
  for (const field of ['library', 'folder', 'name', 'driveId', 'graphItemId', 'mimeType', 'eTag']) {
    if (!nonEmptyString(document[field])) failures.push(field);
  }
  const sharePointSite = projectSharePointSite(document.sharePointSite);
  if (!sharePointSite) failures.push('sharePointSite');
  if (!Number.isSafeInteger(document.size) || document.size < 0) failures.push('size');
  if (document.versionId != null && !nonEmptyString(document.versionId)) failures.push('versionId');
  if (typeof document.contentHash !== 'string' || !SHA256.test(document.contentHash)) failures.push('contentHash');
  if (REPEATABLE_DOCUMENT_KINDS.has(document.kind)) {
    if (!nonEmptyString(document.suggestionId, 2000)) failures.push('suggestionId');
  } else if (document.suggestionId != null) {
    failures.push('suggestionId');
  }
  if (failures.length) throw new Error(`Source bundle document is invalid (${failures.join(', ')}).`);
  return Object.fromEntries(DOCUMENT_FIELDS.map((field) => [
    field,
    field === 'sharePointSite' ? sharePointSite : document[field] ?? null,
  ]));
}

function projectDocuments(documents) {
  if (!Array.isArray(documents)) throw new Error('Source bundle documents must be an array.');
  const projected = documents.map(projectDocument);
  const sites = new Set(projected.map((document) => sharePointSiteIdentity(document.sharePointSite)));
  if (sites.size > 1) throw new Error('Source bundle documents reference mixed SharePoint sites.');
  for (const document of projected) {
    if (!isRegisteredSharePointSite(document.sharePointSite)) {
      throw new Error('Source bundle document does not reference a registered SharePoint site.');
    }
  }
  // Non-repeatable kinds (the original proposal documents) stay at most one
  // per bundle. Repeatable kinds (reviewerUpload) are instead keyed by
  // (suggestionId, name) -- a request can have many uploaded reviews, each
  // with up to 5 files.
  const kinds = new Set();
  const repeatableKeys = new Set();
  for (const document of projected) {
    if (REPEATABLE_DOCUMENT_KINDS.has(document.kind)) {
      const key = `${document.suggestionId}\u0000${document.name}`;
      if (repeatableKeys.has(key)) {
        throw new Error(`Source bundle has a duplicate ${document.kind} document for suggestion ${document.suggestionId}.`);
      }
      repeatableKeys.add(key);
      continue;
    }
    if (kinds.has(document.kind)) throw new Error(`Source bundle has more than one ${document.kind} document.`);
    kinds.add(document.kind);
  }
  return projected;
}

function assertCompleteInventory(inventory) {
  if (!inventory || !Array.isArray(inventory.documents) || !Array.isArray(inventory.errors)) {
    throw new Error('Source document inventory is invalid.');
  }
  if (inventory.errors.length) {
    throw new Error(`Source document inventory is incomplete: ${inventory.errors.map((error) => (
      `${error.source}:${error.code}`
    )).join(', ')}.`);
  }
  return inventory.documents;
}

function inventoryIdentity(document) {
  return {
    id: document.id,
    kind: document.kind,
    library: document.library,
    folder: document.folder,
    driveId: document.driveId,
    graphItemId: document.graphItemId,
    name: document.name,
    size: document.size,
    mimeType: document.mimeType,
    eTag: document.eTag,
    versionId: document.versionId ?? null,
    suggestionId: document.suggestionId ?? null,
  };
}

function canonicalInventory(documents) {
  return documents.map(inventoryIdentity).sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
}

function assertSameInventory(hydratedDocuments, currentDocuments) {
  if (JSON.stringify(canonicalInventory(hydratedDocuments))
      !== JSON.stringify(canonicalInventory(currentDocuments))) {
    throw new Error('Source document set changed during export; rerun to capture a consistent bundle.');
  }
}

async function readCurrentDocumentIdentity(document, dependencies) {
  const driveId = await dependencies.getDriveId(document.library);
  const metadata = await dependencies.getFileMetadataById(driveId, document.graphItemId);
  if (!metadata || !metadata.eTag
      || metadata.id !== document.graphItemId
      || metadata.name !== document.name
      || metadata.size !== document.size
      || metadata.mimeType !== document.mimeType) {
    throw new Error('Source document set changed during export; rerun to capture a consistent bundle.');
  }
  return inventoryIdentity({
    ...document,
    driveId,
    eTag: metadata.eTag,
    versionId: metadata.versionId || null,
  });
}

// ───────── Reviewer section (bundle v3, 6c-ii Stage A) ─────────
// Plan "Source projection (bundle v3)": a per-source-suggestion person
// projection, the suggestion's candidate content and lifecycle, its answer
// rows, and (for an uploaded review) its files. The strict validator below
// REJECTS the fields the plan names, and a real person's address is exported
// only when the source carries the synthetic marker.

export const REVIEW_FORM = Object.freeze({
  UPLOADED: 'uploaded',
  RECEIVED_NO_FILE: 'received_no_file',
  UNRECEIVED: 'unreceived',
});

const REVIEWER_PERSON_FIELDS = [
  'wmkf_name', 'wmkf_firstname', 'wmkf_lastname', 'wmkf_areaofexpertise',
  'wmkf_primaryaffiliation', 'wmkf_academicrank', 'wmkf_primarydepartment',
  'wmkf_maininstitution',
];

const REVIEWER_SUGGESTION_FIELDS = [
  'wmkf_suggestionlabel', 'wmkf_programarea', 'wmkf_relevancescore', 'wmkf_matchreason',
  'wmkf_sources', 'wmkf_selected', 'wmkf_invited', 'wmkf_accepted', 'wmkf_declined',
  'wmkf_responsetype', 'wmkf_emailsentat', 'wmkf_responsereceivedat', 'wmkf_materialssentat',
  'wmkf_reviewreceivedat', 'wmkf_completedat', 'wmkf_thankyousentat', 'wmkf_reviewstatus',
  'wmkf_revieweraffiliation', 'wmkf_reviewuploadedbystaff',
  'wmkf_reviewerfirstname', 'wmkf_reviewerlastname', 'wmkf_reviewernickname', 'wmkf_reviewertitle',
  'wmkf_applicantdisposition',
];

// answerRowBody's exact projection (review-answer.js:280-295) plus the
// wmkf_questionkey alternate-key column the URL carries.
const REVIEWER_ANSWER_FIELDS = [
  'wmkf_questionkey', 'wmkf_questionorder', 'wmkf_questiontext', 'wmkf_questiontype',
  'wmkf_answerhtml', 'wmkf_answertext', 'wmkf_answervalue', 'wmkf_answervalues',
  'wmkf_questionoptions',
];

// Plan-named exact rejections, plus a prefix rule for the external-token
// family. Checked against the RAW keys of the source person/suggestion
// objects the caller hydrates -- never against the strict allowlisted
// projection itself, so an allowlist omission can't silently hide a
// forbidden field that was present on the wire.
const FORBIDDEN_REVIEWER_FIELD_NAMES = new Set([
  '_wmkf_contact_value', 'wmkf_addresstruststatejson', 'wmkf_emailsource',
  'wmkf_proposalfirstaccessed', 'wmkf_orcid', 'wmkf_orcidurl',
  'wmkf_honorariumrequest', '_wmkf_honorariumrequest_value',
  'wmkf_proposalurl', 'wmkf_proposalpassword',
]);
function assertNoForbiddenReviewerFields(raw, label) {
  if (!raw || typeof raw !== 'object') return;
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_REVIEWER_FIELD_NAMES.has(key) || /^wmkf_externaltoken/i.test(key)) {
      throw new Error(`Source bundle ${label} carries a forbidden field (${key}).`);
    }
  }
}

function projectReviewerPerson(rawPerson, personIsSynthetic) {
  assertNoForbiddenReviewerFields(rawPerson, 'reviewer person');
  if (!rawPerson || typeof rawPerson !== 'object' || Array.isArray(rawPerson)) {
    throw new Error('Source bundle reviewer person is invalid.');
  }
  const hasEmail = rawPerson.wmkf_emailaddress != null;
  if (hasEmail && personIsSynthetic !== true) {
    throw new Error('Source bundle carries a real person\'s address; personIsSynthetic must be true to export it.');
  }
  const projected = Object.fromEntries(REVIEWER_PERSON_FIELDS.map((field) => [field, rawPerson[field] ?? null]));
  if (personIsSynthetic === true && hasEmail) {
    projected.wmkf_emailaddress = rawPerson.wmkf_emailaddress;
  }
  return projected;
}

function projectReviewerAnswer(rawAnswer) {
  if (!rawAnswer || typeof rawAnswer !== 'object' || Array.isArray(rawAnswer)) {
    throw new Error('Source bundle reviewer answer row is invalid.');
  }
  if (!nonEmptyString(rawAnswer.wmkf_questionkey, 500)) {
    throw new Error('Source bundle reviewer answer row is missing wmkf_questionkey.');
  }
  return Object.fromEntries(REVIEWER_ANSWER_FIELDS.map((field) => [field, rawAnswer[field] ?? null]));
}

/**
 * Classify the review form from pointer provenance and the received stamp
 * only (plan "Verify"/"Source projection" -- the same rule the seeder and
 * verifier use): a complete `Reviewer_Uploads/…/attempt_*` pointer pair is
 * `uploaded`; a complete pointer pair the filing service attached is
 * `received_no_file` (its generated file is never exported); no pointers with
 * a received stamp is `received_no_file`; no pointers and no stamp is
 * `unreceived`; a partial pointer pair (exactly one of the two set) or an
 * unrecognized classifier result fails the export.
 */
export function classifyReviewerForm({ folder, filename, reviewReceivedAt }, classifyProvenance) {
  const hasFolder = folder != null && folder !== '';
  const hasFilename = filename != null && filename !== '';
  if (hasFolder !== hasFilename) {
    throw new Error('Source bundle review has a partial file pointer pair (folder/filename); cannot classify.');
  }
  if (!hasFolder) {
    return reviewReceivedAt ? REVIEW_FORM.RECEIVED_NO_FILE : REVIEW_FORM.UNRECEIVED;
  }
  const provenance = classifyProvenance(folder);
  if (provenance === 'attempt_upload') return REVIEW_FORM.UPLOADED;
  if (provenance === 'generated' || provenance === 'legacy') return REVIEW_FORM.RECEIVED_NO_FILE;
  throw new Error(`Source bundle review file pointer has an unrecognized provenance (${provenance}).`);
}

/**
 * Validate and project one reviewer bundle entry. Deliberately IDEMPOTENT
 * (like `projectDocument`): `person`/`suggestion` are read and re-emitted
 * under the SAME key names, so re-validating an already-projected bundle
 * (`readSourceBundle`) re-applies the same allowlist/rejection rules to the
 * same shape rather than expecting a different wire shape. `personIsSynthetic`
 * is the source person's own marker (undefined/false when the host has no
 * wave30 column -- D-R1: production without the column exports no address for
 * anyone). `answers` are (still-)unprojected answer rows; a hydration-time
 * caller may carry extra fields (e.g. `eTag`) alongside the allowlisted ones
 * for the two-pass fence -- ignored here, never re-emitted. `reviewForm` is
 * the pre-classified form; `files` (only for `uploaded`) are already-projected
 * documents (kind `reviewerUpload`, produced by the same path as the proposal
 * documents).
 */
function projectReviewer({ suggestionId, personId, person, suggestion, personIsSynthetic, answers, reviewForm, files }) {
  if (!nonEmptyString(suggestionId, 2000)) throw new Error('Source bundle reviewer is missing its suggestion id.');
  if (!nonEmptyString(personId, 2000)) throw new Error('Source bundle reviewer is missing its person id.');
  assertNoForbiddenReviewerFields(suggestion, 'reviewer suggestion');
  if (!Object.values(REVIEW_FORM).includes(reviewForm)) {
    throw new Error(`Source bundle reviewer has an invalid review form (${reviewForm}).`);
  }
  const projectedFiles = reviewForm === REVIEW_FORM.UPLOADED ? projectDocuments(files || []) : [];
  if (reviewForm === REVIEW_FORM.UPLOADED && projectedFiles.length === 0) {
    throw new Error('Source bundle review is uploaded but carries no files.');
  }
  if (reviewForm !== REVIEW_FORM.UPLOADED && (files || []).length > 0) {
    throw new Error('Source bundle review is not uploaded but carries files.');
  }
  for (const file of projectedFiles) {
    if (file.kind !== 'reviewerUpload' || file.suggestionId !== suggestionId) {
      throw new Error('Source bundle review file is not keyed to its own suggestion.');
    }
  }
  return {
    suggestionId,
    personId,
    person: projectReviewerPerson(person, personIsSynthetic === true),
    personIsSynthetic: personIsSynthetic === true,
    suggestion: Object.fromEntries(REVIEWER_SUGGESTION_FIELDS.map((field) => [field, suggestion?.[field] ?? null])),
    answers: (answers || []).map(projectReviewerAnswer),
    reviewForm,
    files: projectedFiles,
  };
}

function projectReviewers(reviewers) {
  if (!Array.isArray(reviewers)) throw new Error('Source bundle reviewers must be an array.');
  const projected = reviewers.map(projectReviewer);
  const seen = new Set();
  for (const reviewer of projected) {
    if (seen.has(reviewer.suggestionId)) throw new Error('Source bundle has more than one reviewer for the same suggestion.');
    seen.add(reviewer.suggestionId);
  }
  return projected;
}

// ───────── Two-pass consistency fence over reviewer child rows ─────────
// Same shape as assertCompleteInventory/assertSameInventory for documents:
// snapshot the complete bounded set of suggestion/answer/person identities
// (with eTags) before hydration, re-read the complete set afterwards, and
// reject any addition, removal, field or eTag drift.

function assertCompleteReviewerInventory(inventory) {
  if (!inventory || !Array.isArray(inventory.reviewers) || !Array.isArray(inventory.errors)) {
    throw new Error('Source reviewer inventory is invalid.');
  }
  if (inventory.errors.length) {
    throw new Error(`Source reviewer inventory is incomplete: ${inventory.errors.map((error) => (
      `${error.source}:${error.code}`
    )).join(', ')}.`);
  }
  return inventory.reviewers;
}

/**
 * Extract the comparable identity from a fully HYDRATED reviewer entry (the
 * shape `dependencies.hydrateReviewer` returns: raw answer rows carrying
 * `wmkf_questionkey` + a sibling `eTag`, and already-projected files carrying
 * `graphItemId`/`eTag`/`versionId`). `dependencies.readCurrentReviewerIdentity`
 * returns this SAME shape directly (it has no reason to hydrate the full
 * person/suggestion projection just to re-check identity), so the two sides
 * of the fence compare like for like.
 */
function hydratedReviewerIdentity(entry) {
  return {
    suggestionId: entry.suggestionId,
    suggestionEtag: entry.suggestionEtag,
    personId: entry.personId,
    personEtag: entry.personEtag,
    answers: (entry.answers || [])
      .map((a) => ({ questionKey: a.wmkf_questionkey, eTag: a.eTag }))
      .sort((left, right) => left.questionKey.localeCompare(right.questionKey)),
    files: (entry.files || [])
      .map((f) => ({ graphItemId: f.graphItemId, eTag: f.eTag, versionId: f.versionId ?? null }))
      .sort((left, right) => left.graphItemId.localeCompare(right.graphItemId)),
  };
}

function canonicalReviewerInventory(identities) {
  return identities.slice().sort((left, right) => (
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  ));
}

/**
 * Exported for the CLI/exporter reason-code surface (`reviewer_source_changed`).
 * `hydratedEntries` are the raw hydrated reviewer entries (as
 * `dependencies.hydrateReviewer` returns them); `currentEntries` are already
 * identity-shaped (as `dependencies.readCurrentReviewerIdentity` returns
 * them) -- see `hydratedReviewerIdentity`'s doc comment for why the shapes
 * differ.
 */
export function assertReviewerSourceUnchanged(hydratedEntries, currentEntries) {
  const hydratedIdentities = (hydratedEntries || []).map(hydratedReviewerIdentity);
  if (JSON.stringify(canonicalReviewerInventory(hydratedIdentities))
      !== JSON.stringify(canonicalReviewerInventory(currentEntries || []))) {
    const err = new Error('Reviewer source (suggestion/answer/person rows or files) changed during export; rerun to capture a consistent bundle.');
    err.code = 'reviewer_source_changed';
    throw err;
  }
}

/**
 * Read, hydrate and fence one source Request before returning a bundle that a
 * shell may write. Every external operation is injected for offline tests.
 */
export async function exportTestRequestSourceBundle(
  { sourceRequestNumber, dataverseHost, exportedAt },
  dependencies,
) {
  const sourceRow = await dependencies.readSourceRow(sourceRequestNumber);
  const projectedSource = projectCloneSource(sourceRow);
  const requestId = projectedSource.akoya_requestid;
  const source = {
    akoya_requestid: requestId,
    akoya_requestnum: projectedSource.akoya_requestnum,
  };

  const initialInventory = assertCompleteInventory(await dependencies.discoverDocuments(source));
  dependencies.assertReadLimits(initialInventory);
  const documents = [];
  for (const document of initialInventory) {
    documents.push(await dependencies.hydrateDocument(document));
  }

  const currentInventory = assertCompleteInventory(await dependencies.discoverDocuments(source));
  dependencies.assertReadLimits(currentInventory);
  const currentDocuments = [];
  for (const document of currentInventory) {
    currentDocuments.push(await readCurrentDocumentIdentity(document, dependencies));
  }
  assertSameInventory(documents, currentDocuments);

  // Reviewer section (bundle v3): only when the caller supplies the reviewer
  // dependency triad. Callers that don't (basic/initial_assessment today)
  // produce a version-2 bundle unchanged.
  let reviewers;
  if (dependencies.discoverReviewers) {
    const initialReviewerInventory = assertCompleteReviewerInventory(await dependencies.discoverReviewers(source));
    const hydratedReviewers = [];
    for (const entry of initialReviewerInventory) {
      hydratedReviewers.push(await dependencies.hydrateReviewer(entry));
    }

    const currentReviewerInventory = assertCompleteReviewerInventory(await dependencies.discoverReviewers(source));
    const currentReviewerIdentities = [];
    for (const entry of currentReviewerInventory) {
      currentReviewerIdentities.push(await dependencies.readCurrentReviewerIdentity(entry));
    }
    assertReviewerSourceUnchanged(hydratedReviewers, currentReviewerIdentities);
    reviewers = hydratedReviewers;
  }

  const revisionAfter = await dependencies.readSourceRevision(requestId);
  if (revisionAfter !== String(sourceRow.versionnumber)) {
    throw new Error('Source Request changed during export; rerun to capture a consistent bundle.');
  }

  return buildSourceBundle({ sourceRow, documents, dataverseHost, exportedAt, reviewers });
}

/**
 * Build a bundle from a raw source Request row (as read from Dataverse,
 * including its revision) and hydrated document versions. `reviewers` is
 * omitted entirely (not an empty array) for a version-2 bundle; passing an
 * array (even empty) produces a version-3 bundle carrying the section, so a
 * legacy bundle's digest is byte-for-byte unchanged by this function existing.
 */
export function buildSourceBundle({ sourceRow, documents, dataverseHost, exportedAt, reviewers }) {
  if (!nonEmptyString(dataverseHost, 255)) throw new Error('Source bundle Dataverse host is required.');
  const normalizedDataverseHost = dataverseHost.toLowerCase();
  if (!PRODUCTION_HOSTS.includes(normalizedDataverseHost)) {
    throw new Error('Source bundle Dataverse host is not a registered production host.');
  }
  if (!(exportedAt instanceof Date) || Number.isNaN(exportedAt.getTime())) {
    throw new Error('Source bundle export time is invalid.');
  }
  const request = projectCloneSource(sourceRow);
  if (!/^\d{1,10}$/.test(request.akoya_requestnum || '')) throw new Error('Source Request number is invalid.');
  const hasReviewerSection = reviewers !== undefined;
  return {
    kind: SOURCE_BUNDLE_KIND,
    version: hasReviewerSection ? 3 : 2,
    exportedAt: exportedAt.toISOString(),
    source: { dataverseHost: normalizedDataverseHost, request },
    documents: projectDocuments(documents),
    ...(hasReviewerSection ? { reviewers: projectReviewers(reviewers) } : {}),
  };
}

/** Validate a parsed bundle and return its canonical projection. */
export function readSourceBundle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Source bundle is invalid.');
  if (value.kind !== SOURCE_BUNDLE_KIND) throw new Error('File is not a Test Request source bundle.');
  if (!SUPPORTED_SOURCE_BUNDLE_VERSIONS.has(value.version)) {
    throw new Error(`Unsupported source bundle version: ${value.version}.`);
  }
  if (value.version === 3 && !Array.isArray(value.reviewers)) {
    throw new Error('Version 3 source bundle is missing its reviewers section.');
  }
  if (value.version === 2 && value.reviewers !== undefined) {
    throw new Error('Version 2 source bundle must not carry a reviewers section.');
  }
  const exportedAt = new Date(value.exportedAt);
  if (typeof value.exportedAt !== 'string' || Number.isNaN(exportedAt.getTime())) {
    throw new Error('Source bundle export time is invalid.');
  }
  const request = value.source?.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Source bundle request is missing.');
  }
  // Re-project through the same validator the export used; the stored
  // revision is passed as versionnumber so projectCloneSource accepts it.
  return buildSourceBundle({
    sourceRow: { ...request, versionnumber: request.revision },
    documents: value.documents,
    dataverseHost: value.source?.dataverseHost,
    exportedAt,
    reviewers: value.version === 3 ? value.reviewers : undefined,
  });
}

/**
 * `reviews` reservation requires a bundle v3 (reviewers[] section present);
 * `basic`/`initial_assessment` accept a legacy v2 bundle too (6c-i build
 * notes: this was the "not enforced" deviation -- enforced here, called from
 * the CLI's reserve path before any further parsing).
 */
export function assertBundleHasReviewerSectionForRecipe(recipe, bundle) {
  if (recipe === 'reviews' && !Array.isArray(bundle?.reviewers)) {
    throw new Error('--recipe=reviews requires a source bundle with a reviewers[] section (export a fresh bundle v3).');
  }
}

/** Printable summary: identities, counts and hash prefixes; never source text. */
export function summarizeSourceBundle(bundle) {
  const { request } = bundle.source;
  return {
    dataverseHost: bundle.source.dataverseHost,
    requestNumber: request.akoya_requestnum,
    requestId: request.akoya_requestid,
    revision: request.revision,
    fiscalYear: request.akoya_fiscalyear,
    meetingDate: request.wmkf_meetingdate,
    hasPurpose: request.akoya_purpose != null,
    hasRequestedAmount: request.akoya_request != null,
    documents: bundle.documents.map((document) => ({
      kind: document.kind,
      name: document.name,
      size: document.size,
      sha256Prefix: document.contentHash.slice(0, 12),
    })),
  };
}
