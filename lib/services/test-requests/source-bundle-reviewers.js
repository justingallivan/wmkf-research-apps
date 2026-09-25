/**
 * Real dependency triad for bundle v3's reviewers[] section (6c-ii Stage A,
 * Opus round 1 P2-5). Wires `exportTestRequestSourceBundle`'s optional
 * `discoverReviewers` / `hydrateReviewer` / `readCurrentReviewerIdentity`
 * seam to the exporter's existing read path: a raw Dataverse client (the
 * SAME shape `lib/dataverse/client.js#createClient` returns, matching the
 * exporter script's `readSourceRow`/`readSourceRevision` style -- reads here
 * run outside a restriction context, so the adapters/DynamicsService are
 * deliberately NOT used, exactly like the rest of the exporter) plus the
 * exporter's existing Graph dependency object (the same shape
 * `createStrictTestRequestSourceDependencies()` returns: `getDriveId`,
 * `getFileMetadataById`, `downloadFile`, `listFiles`,
 * `getSharePointTargetInfo`).
 *
 * Decision (documented per the build brief): the CLI always wires this
 * triad, so a request with zero suggestions still gets a bundle v3 with an
 * EMPTY `reviewers` array (not a v2 bundle) -- this avoids a race between a
 * pre-check "does this request have suggestions" read and the two-pass
 * fence, and matches source-bundle.js's own tested contract that an empty
 * array still means "the section is present."
 */

import crypto from 'node:crypto';
import {
  REVIEWER_PERSON_FIELDS,
  REVIEWER_SUGGESTION_FIELDS,
  REVIEWER_ANSWER_FIELDS,
  classifyReviewerForm,
  REVIEW_FORM,
} from './source-bundle.js';
import { classifyReviewFileProvenance } from '../../../shared/utils/review-file-provenance.js';
import { syntheticReviewerIsolationEnabled, SYNTHETIC_REVIEWER_MARKER_FIELDS } from './isolation.js';

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
 * Resolve the review form and (for `uploaded`) hydrate its files under the
 * pointer folder through Graph, exactly as the document dependencies hydrate
 * a proposal document (drive resolve, metadata read, download, hash).
 */
async function readReviewFiles(graph, suggestionRow, suggestionId) {
  const folder = suggestionRow.wmkf_reviewsharepointfolder;
  const driveId = await graph.getDriveId(REVIEW_LIBRARY);
  const listed = await graph.listFiles(REVIEW_LIBRARY, folder, {
    recursive: false, maxDepth: 1, maxFiles: MAX_REVIEW_FILES, failOnTruncation: true,
  });
  const sharePointTarget = graph.getSharePointTargetInfo?.();
  const sharePointSite = sharePointTarget?.registered === true ? {
    key: sharePointTarget.key, hostname: sharePointTarget.hostname, pathname: sharePointTarget.pathname,
  } : null;
  const files = [];
  for (const file of listed) {
    const meta = await graph.getFileMetadataById(driveId, file.id);
    if (!meta || !meta.eTag) {
      throw new Error(`Reviewer upload file ${file.name} has no readable metadata; refusing.`);
    }
    const downloaded = await graph.downloadFile(driveId, file.id);
    if (downloaded.size !== meta.size || downloaded.buffer.length !== meta.size) {
      throw new Error(`Reviewer upload file ${file.name} changed while its bytes were being verified.`);
    }
    files.push({
      id: `${suggestionId}:${file.id}`,
      kind: 'reviewerUpload',
      library: REVIEW_LIBRARY,
      folder,
      name: meta.name,
      driveId,
      graphItemId: file.id,
      sharePointSite,
      size: meta.size,
      mimeType: meta.mimeType,
      eTag: meta.eTag,
      versionId: meta.versionId || null,
      contentHash: crypto.createHash('sha256').update(downloaded.buffer).digest('hex'),
      suggestionId,
    });
  }
  return files;
}

/**
 * Read one reviewer's complete snapshot (suggestion + person + answers +
 * review form + files). Shared by `hydrateReviewer` (needs the full
 * hydration for projection) and `readCurrentReviewerIdentity` (needs only
 * the identity subset) so the two passes read the SAME fields the SAME way.
 */
async function readReviewerSnapshot(client, graph, { suggestionId, personId }) {
  const suggestionRow = await readRowById(client, SUGGESTION_ENTITY_SET, suggestionId, [
    'wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value', '_wmkf_request_value',
    ...REVIEWER_SUGGESTION_FIELDS, ...POINTER_SELECT_FIELDS,
  ]);
  const markerSelect = syntheticReviewerIsolationEnabled() ? [SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] : [];
  const personRow = await readRowById(client, PERSON_ENTITY_SET, personId, [
    'wmkf_potentialreviewersid', 'wmkf_emailaddress', ...REVIEWER_PERSON_FIELDS, ...markerSelect,
  ]);
  const personIsSynthetic = syntheticReviewerIsolationEnabled()
    && personRow[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] === true;

  const answers = await readAnswerRows(client, suggestionId);

  const reviewForm = classifyReviewerForm({
    folder: suggestionRow.wmkf_reviewsharepointfolder,
    filename: suggestionRow.wmkf_reviewfilename,
    reviewReceivedAt: suggestionRow.wmkf_reviewreceivedat,
  }, classifyReviewFileProvenance);

  const files = reviewForm === REVIEW_FORM.UPLOADED
    ? await readReviewFiles(graph, suggestionRow, suggestionId)
    : [];

  return {
    suggestionId,
    personId,
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
 * Build the real reviewer dependency triad for `exportTestRequestSourceBundle`.
 * `client` is a raw Dataverse client (`.get(path)` -> `{ok, status, body, text}`,
 * exactly `createClient`'s shape); `graph` is the exporter's existing Graph
 * dependency object (`getDriveId`, `getFileMetadataById`, `downloadFile`,
 * `listFiles`, `getSharePointTargetInfo`).
 */
export function createReviewerSourceDependencies({ client, graph }) {
  async function discoverReviewers(source) {
    const rows = await queryRows(client, SUGGESTION_ENTITY_SET, {
      select: ['wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value'],
      filter: `_wmkf_request_value eq ${source.akoya_requestid}`,
      top: MAX_REVIEWERS,
    });
    return {
      reviewers: rows.map((row) => ({
        suggestionId: row.wmkf_appreviewersuggestionid,
        personId: row._wmkf_potentialreviewer_value,
      })),
      errors: [],
    };
  }

  async function hydrateReviewer(entry) {
    return readReviewerSnapshot(client, graph, entry);
  }

  async function readCurrentReviewerIdentity(entry) {
    const snapshot = await readReviewerSnapshot(client, graph, entry);
    return {
      suggestionId: snapshot.suggestionId,
      suggestionEtag: snapshot.suggestionEtag,
      personId: snapshot.personId,
      personEtag: snapshot.personEtag,
      answers: snapshot.answers.map((a) => ({ questionKey: a.wmkf_questionkey, eTag: a.eTag })),
      files: snapshot.files.map((f) => ({ graphItemId: f.graphItemId, eTag: f.eTag, versionId: f.versionId ?? null })),
    };
  }

  return { discoverReviewers, hydrateReviewer, readCurrentReviewerIdentity };
}
