/**
 * Real dependency triad for bundle v3's reviewers[] section (6c-ii Stage A,
 * Opus round 1 P2-5, reworked under Opus round 2). Wires
 * `exportTestRequestSourceBundle`'s optional `discoverReviewers` /
 * `hydrateReviewer` / `readCurrentReviewerIdentity` seam to the exporter's
 * existing read path: a raw Dataverse client (the SAME shape
 * `lib/dataverse/client.js#createClient` returns, matching the exporter
 * script's `readSourceRow`/`readSourceRevision` style -- reads here run
 * outside a restriction context, so the adapters/DynamicsService are
 * deliberately NOT used, exactly like the rest of the exporter -- registered
 * as an intentional EXEMPT_FILES entry in
 * scripts/check-dataverse-access-layer.js) plus the exporter's existing
 * Graph dependency object (the same shape
 * `createStrictTestRequestSourceDependencies()` returns: `getDriveId`,
 * `getFileMetadataById`, `downloadFile`, `listFiles`,
 * `getSharePointTargetInfo`).
 *
 * Opus round 2 reversals from round 1:
 *
 * P2-C: the CLI does NOT always wire this triad. Reviewer content (answer
 * text, uploaded review files) is confidential and must only leave
 * production when explicitly asked (the export script's `--with-reviewers`
 * flag, default off). This module has no opinion on that -- it is only ever
 * invoked when the CLI decides to.
 *
 * Forward hazard: `SYNTHETIC_REVIEWER_ISOLATION` is a per-PROCESS switch
 * governing the app's own reads, but this exporter reads PRODUCTION while
 * the seeder (Stage B/C) later writes to the SANDBOX from the same operator
 * shell -- wave30 may be applied to the sandbox only, so this module must
 * NEVER consult that switch (it would select a column production doesn't
 * have). `createReviewerSourceDependencies` instead takes an explicit,
 * REQUIRED `markerColumnPresent: boolean` (no default; the CLI's
 * `--source-marker-column=present|absent` flag, required whenever
 * `--with-reviewers` is set).
 */

import crypto from 'node:crypto';
import { isGuid } from '../../utils/guid.js';
import {
  REVIEWER_PERSON_FIELDS,
  REVIEWER_SUGGESTION_FIELDS,
  REVIEWER_ANSWER_FIELDS,
  classifyReviewerForm,
  REVIEW_FORM,
} from './source-bundle.js';
import { classifyReviewFileProvenance } from '../../../shared/utils/review-file-provenance.js';
import { SYNTHETIC_REVIEWER_MARKER_FIELDS } from './isolation.js';

const SUGGESTION_ENTITY_SET = 'wmkf_appreviewersuggestions';
const ANSWER_ENTITY_SET = 'wmkf_appreviewanswers';
const PERSON_ENTITY_SET = 'wmkf_potentialreviewerses';
const REVIEW_LIBRARY = 'akoya_request';

// Bounded reads: a request with more reviewers/answers/files than this is
// refused rather than silently truncated (same posture as the document
// inventory's assertReadLimits).
const MAX_REVIEWERS = 200;
const MAX_ANSWERS_PER_SUGGESTION = 200;
const MAX_REVIEW_FILES = 5;

const POINTER_SELECT_FIELDS = ['wmkf_reviewsharepointfolder', 'wmkf_reviewfilename'];

function invalidIdentityError(label) {
  const err = new Error(`Reviewer source identity is invalid or missing (${label}).`);
  err.code = 'reviewer_source_invalid_identity';
  return err;
}

/**
 * P2-A (Opus round 2): every GUID is validated before it is interpolated
 * into an OData filter or URL path -- a suggestion with no readable person
 * (or a malformed id anywhere) refuses clearly here, never reaches Dataverse
 * to 400.
 */
function assertGuid(value, label) {
  if (!isGuid(value)) throw invalidIdentityError(label);
}

function sameGuid(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

function bodyOrThrow(label, response) {
  if (!response?.ok) {
    const detail = String(response?.text || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
    throw new Error(`${label} failed (${response?.status ?? 'no status'}): ${detail}`);
  }
  return response.body || {};
}

function refuseContinuation(label, body) {
  if (body && body['@odata.nextLink']) {
    throw new Error(`${label} returned more rows than the bounded read limit; refusing a partial reviewer set.`);
  }
}

async function queryRows(client, entitySet, { select, filter, top }) {
  const params = new URLSearchParams();
  params.set('$select', select.join(','));
  if (filter) params.set('$filter', filter);
  params.set('$top', String(top));
  const body = bodyOrThrow(`${entitySet} query`, await client.get(`/${entitySet}?${params.toString()}`));
  refuseContinuation(`${entitySet} query`, body);
  const rows = body.value || [];
  if (rows.length > top) {
    throw new Error(`${entitySet} query returned more rows than the bounded read limit; refusing a partial reviewer set.`);
  }
  return rows;
}

async function readRowById(client, entitySet, id, select) {
  const params = new URLSearchParams();
  params.set('$select', select.join(','));
  return bodyOrThrow(`${entitySet} read`, await client.get(`/${entitySet}(${id})?${params.toString()}`));
}

async function readAnswerRows(client, suggestionId) {
  assertGuid(suggestionId, 'answer query suggestionId');
  const rows = await queryRows(client, ANSWER_ENTITY_SET, {
    select: REVIEWER_ANSWER_FIELDS,
    filter: `_wmkf_appreviewersuggestion_value eq ${suggestionId}`,
    top: MAX_ANSWERS_PER_SUGGESTION,
  });
  return rows.map((row) => ({
    ...Object.fromEntries(REVIEWER_ANSWER_FIELDS.map((field) => [field, row[field] ?? null])),
    eTag: row['@odata.etag'] || null,
  }));
}

/**
 * List the pointer folder and confirm `wmkf_reviewfilename` is actually among
 * the listed files (P3, Opus round 2) -- an uploaded review whose primary
 * filename isn't in its own folder is a state the classifier already trusted
 * too much; refuse rather than silently hydrate a mismatched set.
 */
async function listReviewFiles(graph, suggestionRow) {
  const folder = suggestionRow.wmkf_reviewsharepointfolder;
  const driveId = await graph.getDriveId(REVIEW_LIBRARY);
  const listed = await graph.listFiles(REVIEW_LIBRARY, folder, {
    recursive: false, maxDepth: 1, maxFiles: MAX_REVIEW_FILES, failOnTruncation: true,
  });
  if (!listed.some((file) => file.name === suggestionRow.wmkf_reviewfilename)) {
    throw new Error(`Reviewer upload folder does not contain the primary filename (${suggestionRow.wmkf_reviewfilename}); refusing.`);
  }
  const sharePointTarget = graph.getSharePointTargetInfo?.();
  const sharePointSite = sharePointTarget?.registered === true ? {
    key: sharePointTarget.key, hostname: sharePointTarget.hostname, pathname: sharePointTarget.pathname,
  } : null;
  return { folder, driveId, listed, sharePointSite };
}

/**
 * Metadata-only file identities for the fence's SECOND pass (P3, Opus round
 * 2): re-reads identities/metadata only, never re-downloads bytes.
 */
async function readReviewFileIdentities(graph, suggestionRow) {
  const { driveId, listed } = await listReviewFiles(graph, suggestionRow);
  const identities = [];
  for (const file of listed) {
    const meta = await graph.getFileMetadataById(driveId, file.id);
    if (!meta || !meta.eTag) {
      throw new Error(`Reviewer upload file ${file.name} has no readable metadata; refusing.`);
    }
    identities.push({ graphItemId: file.id, eTag: meta.eTag, versionId: meta.versionId || null });
  }
  return identities;
}

/**
 * Full file hydration (download + hash) for the export projection. Mirrors
 * `hydrateSelectedDocument` (admin-preview-service.js ~342-388): metadata is
 * read BEFORE the download, the bytes are downloaded, then metadata is
 * re-read AFTER and compared to the pre-download read -- a file that changed
 * mid-download is refused, not silently hashed as of a stale version.
 */
async function readReviewFilesFull(graph, suggestionRow, suggestionId) {
  const { folder, driveId, listed, sharePointSite } = await listReviewFiles(graph, suggestionRow);
  // Stage C (6c-ii) copies the primary file first ("Review_1.<ext>" ==
  // the source's own wmkf_reviewfilename): listReviewFiles' order is
  // whatever the Graph folder listing returns, which carries no such
  // guarantee, so reorder here -- once, at export time -- rather than
  // asking every later consumer of `bundle.reviewers[].files` to know which
  // entry is primary.
  const primaryIndex = listed.findIndex((file) => file.name === suggestionRow.wmkf_reviewfilename);
  // Defense-in-depth (P3-c, Opus round 1): listReviewFiles above already
  // refuses when the primary filename isn't listed, so primaryIndex === -1
  // should be unreachable here -- but this function must never silently
  // fall through to the unreordered `listed` array on that assumption
  // alone; assert it explicitly rather than depending on an earlier call's
  // implicit invariant.
  if (primaryIndex === -1) {
    throw new Error(`Reviewer upload folder does not contain the primary filename (${suggestionRow.wmkf_reviewfilename}); refusing.`);
  }
  const ordered = primaryIndex > 0
    ? [listed[primaryIndex], ...listed.slice(0, primaryIndex), ...listed.slice(primaryIndex + 1)]
    : listed;
  const files = [];
  for (const file of ordered) {
    const before = await graph.getFileMetadataById(driveId, file.id);
    if (!before || !before.eTag) {
      throw new Error(`Reviewer upload file ${file.name} has no readable metadata; refusing.`);
    }
    const downloaded = await graph.downloadFile(driveId, file.id);
    const after = await graph.getFileMetadataById(driveId, file.id);
    if (!after || after.eTag !== before.eTag || after.size !== before.size || after.name !== before.name
        || downloaded.filename !== before.name || downloaded.size !== before.size
        || downloaded.buffer.length !== before.size) {
      throw new Error(`Reviewer upload file ${file.name} changed while its bytes were being verified; refusing.`);
    }
    files.push({
      id: `${suggestionId}:${file.id}`,
      kind: 'reviewerUpload',
      library: REVIEW_LIBRARY,
      folder,
      name: before.name,
      driveId,
      graphItemId: file.id,
      sharePointSite,
      size: before.size,
      mimeType: before.mimeType,
      eTag: before.eTag,
      versionId: before.versionId || null,
      contentHash: crypto.createHash('sha256').update(downloaded.buffer).digest('hex'),
      suggestionId,
    });
  }
  return files;
}

/**
 * Shared core read (suggestion + person + answers + review-form
 * classification), used by BOTH the full hydration and the identity-only
 * re-read so the two passes read the same fields the same way. Does NOT
 * touch files -- callers branch on `reviewForm` and call the full or
 * identity-only file reader themselves.
 *
 * P2-A: every id is GUID-validated before use. P2-B: an ownership check
 * refuses a suggestion whose `_wmkf_request_value` isn't the source request,
 * or whose `_wmkf_potentialreviewer_value` isn't the entry's own personId --
 * on EVERY read, both passes, so a suggestion/person pair that drifted (or
 * was never actually related) can never be silently hydrated as if it were.
 */
async function readReviewerCore(client, { suggestionId, personId, requestId }) {
  assertGuid(suggestionId, 'suggestionId');
  assertGuid(personId, 'personId');
  assertGuid(requestId, 'requestId');

  const suggestionRow = await readRowById(client, SUGGESTION_ENTITY_SET, suggestionId, [
    'wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value', '_wmkf_request_value',
    ...REVIEWER_SUGGESTION_FIELDS, ...POINTER_SELECT_FIELDS,
  ]);
  if (!sameGuid(suggestionRow._wmkf_request_value, requestId)) {
    throw invalidIdentityError(`suggestion ${suggestionId} does not belong to request ${requestId}`);
  }
  if (!sameGuid(suggestionRow._wmkf_potentialreviewer_value, personId)) {
    throw invalidIdentityError(`suggestion ${suggestionId} does not belong to person ${personId}`);
  }

  return { suggestionRow };
}

async function readPersonRow(client, personId, markerColumnPresent) {
  assertGuid(personId, 'personId');
  const markerSelect = markerColumnPresent ? [SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] : [];
  return readRowById(client, PERSON_ENTITY_SET, personId, [
    'wmkf_potentialreviewersid', 'wmkf_emailaddress', ...REVIEWER_PERSON_FIELDS, ...markerSelect,
  ]);
}

/**
 * Build the real reviewer dependency triad for `exportTestRequestSourceBundle`.
 * `client` is a raw Dataverse client (`.get(path)` -> `{ok, status, body, text}`,
 * exactly `createClient`'s shape); `graph` is the exporter's existing Graph
 * dependency object. `markerColumnPresent` is REQUIRED (boolean, no default):
 * `false` treats every source reviewer as real (no marker selected, no
 * address exported -- D-R1/D-R5's production-without-wave30 posture); `true`
 * selects the marker and exports an address only for a marker-true person.
 */
export function createReviewerSourceDependencies({ client, graph, markerColumnPresent }) {
  if (typeof markerColumnPresent !== 'boolean') {
    throw new Error('createReviewerSourceDependencies requires an explicit markerColumnPresent boolean (no default).');
  }

  async function discoverReviewers(source) {
    assertGuid(source?.akoya_requestid, 'source akoya_requestid');
    const requestId = source.akoya_requestid;
    const rows = await queryRows(client, SUGGESTION_ENTITY_SET, {
      select: ['wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value'],
      filter: `_wmkf_request_value eq ${requestId}`,
      top: MAX_REVIEWERS,
    });
    return {
      reviewers: rows.map((row) => {
        assertGuid(row.wmkf_appreviewersuggestionid, 'discovered suggestionId');
        // A suggestion with no (or an unreadable) person refuses clearly here,
        // never reaches Dataverse as a malformed id and 400s.
        assertGuid(row._wmkf_potentialreviewer_value, `discovered personId for suggestion ${row.wmkf_appreviewersuggestionid}`);
        return {
          suggestionId: row.wmkf_appreviewersuggestionid,
          personId: row._wmkf_potentialreviewer_value,
          requestId,
        };
      }),
      errors: [],
    };
  }

  async function hydrateReviewer(entry) {
    const { suggestionRow } = await readReviewerCore(client, entry);
    const personRow = await readPersonRow(client, entry.personId, markerColumnPresent);
    const personIsSynthetic = markerColumnPresent && personRow[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] === true;

    const answers = await readAnswerRows(client, entry.suggestionId);

    const reviewForm = classifyReviewerForm({
      folder: suggestionRow.wmkf_reviewsharepointfolder,
      filename: suggestionRow.wmkf_reviewfilename,
      reviewReceivedAt: suggestionRow.wmkf_reviewreceivedat,
    }, classifyReviewFileProvenance);

    const files = reviewForm === REVIEW_FORM.UPLOADED
      ? await readReviewFilesFull(graph, suggestionRow, entry.suggestionId)
      : [];

    return {
      suggestionId: entry.suggestionId,
      personId: entry.personId,
      suggestionEtag: suggestionRow['@odata.etag'] || null,
      personEtag: personRow['@odata.etag'] || null,
      person: personIsSynthetic ? personRow : { ...personRow, wmkf_emailaddress: null },
      personIsSynthetic,
      suggestion: suggestionRow,
      answers,
      reviewForm,
      files,
    };
  }

  /**
   * P3 (Opus round 2): the fence's second pass re-reads identities and
   * metadata ONLY -- it never calls readReviewFilesFull (which downloads and
   * hashes bytes). Confidential review content should be downloaded at most
   * once per export.
   */
  async function readCurrentReviewerIdentity(entry) {
    const { suggestionRow } = await readReviewerCore(client, entry);
    const personRow = await readPersonRow(client, entry.personId, markerColumnPresent);
    const answers = await readAnswerRows(client, entry.suggestionId);

    const reviewForm = classifyReviewerForm({
      folder: suggestionRow.wmkf_reviewsharepointfolder,
      filename: suggestionRow.wmkf_reviewfilename,
      reviewReceivedAt: suggestionRow.wmkf_reviewreceivedat,
    }, classifyReviewFileProvenance);

    const fileIdentities = reviewForm === REVIEW_FORM.UPLOADED
      ? await readReviewFileIdentities(graph, suggestionRow)
      : [];

    return {
      suggestionId: entry.suggestionId,
      suggestionEtag: suggestionRow['@odata.etag'] || null,
      personId: entry.personId,
      personEtag: personRow['@odata.etag'] || null,
      answers: answers.map((a) => ({ questionKey: a.wmkf_questionkey, eTag: a.eTag })),
      files: fileIdentities.map((f) => ({ graphItemId: f.graphItemId, eTag: f.eTag, versionId: f.versionId ?? null })),
    };
  }

  return { discoverReviewers, hydrateReviewer, readCurrentReviewerIdentity };
}
