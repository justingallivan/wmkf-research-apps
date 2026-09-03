/**
 * Guarded retention of structured individual-review DOCX files.
 *
 * Dataverse remains authoritative for content and owns the two durable pointer
 * fields. SharePoint stores derived bytes. Existing complete pointers always
 * win in ordinary filing; an exact manifest-bound local repair may move one
 * pointer only after creating and verifying its replacement. Partial pointers
 * and divergent target content fail visibly and are never overwritten by the
 * ordinary filer. An exact manifest-bound local content repair may version the
 * one current item while retaining its prior SharePoint version.
 * Operator work additionally binds its Graph target to the tracked Production
 * Dataverse hostname.
 */

import crypto from 'node:crypto';
import { GraphService, SHAREPOINT_CANONICAL_SITE_URL } from '../graph-service.js';
import { hashGovernedDocxContent } from '../initial-assessment/artifact-service.js';
import { buildIndividualReviewDocx } from './individual-review-builder.js';
import { fetchAnswersBySuggestion } from '../review-answers.js';
import {
  findReviewDocxFilingCandidates,
  getByIdWithSelect as getSuggestionById,
  isExcluded,
  patchReviewReceipt,
} from '../../dataverse/adapters/reviewer-suggestion.js';
import { getById as getRequestById } from '../../dataverse/adapters/grant-request.js';
import { getByIdWithSelect as getReviewerById } from '../../dataverse/adapters/potential-reviewer.js';
import {
  assertDataverseOperationAllowed,
  classifyDeployment,
  classifyTarget,
  resolveInterlockMode,
} from '../../dataverse/core/interlock.js';
import { isGuid } from '../../utils/guid.js';
import { meetingDateToCycleCode, parseCycleCode } from '../../utils/cycle-code.js';
import OperationalEventService from '../operational-event-service.js';

export const REVIEW_DOCX_LIBRARY = 'akoya_request';
export const REVIEW_DOCX_WRITE_FLAG = 'REVIEW_DOCX_SHAREPOINT_WRITE';
export const REVIEW_DOCX_CYCLE_FLAG = 'REVIEW_DOCX_SHAREPOINT_CYCLE';

const SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_potentialreviewer_value',
  '_wmkf_request_value',
  'wmkf_reviewreceivedat',
  'wmkf_reviewertitle',
  'wmkf_revieweraffiliation',
  'wmkf_reviewsharepointfolder',
  'wmkf_reviewfilename',
  'wmkf_selected',
  'wmkf_applicantdisposition',
  'wmkf_grantcyclecode',
].join(',');

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  'wmkf_meetingdate',
];

const REVIEWER_SELECT = ['wmkf_potentialreviewersid', 'wmkf_name'];
const KNOWN_ANSWER_TYPES = new Set(['richtext', 'picklist', 'multiselect', 'string']);
const ACTIONABLE_STATUSES = new Set([
  'invalid_cycle',
  'partial_pointer',
  'invalid_snapshot',
  'read_failed',
  'generation_failed',
  'content_conflict',
  'pointer_conflict',
  'sharepoint_failed',
  'pointer_write_failed',
  'verification_failed',
  'cleanup_failed',
  'target_guard_failed',
  'source_drift',
]);
const TARGET_PROOF = Symbol('review-docx-target-proof');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function isActionableReviewDocxStatus(status) {
  return ACTIONABLE_STATUSES.has(status);
}

function sameText(left, right) {
  return String(left || '') === String(right || '');
}

function boundedMessage(error) {
  const message = String(error?.message || error || 'Unknown error')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

function errorCode(error, fallback) {
  return String(error?.code || error?.status || fallback || 'review_docx_failed').slice(0, 100);
}

function failureResult(base, status, error, fallbackCode = status) {
  return {
    ...base,
    status,
    error: {
      code: errorCode(error, fallbackCode),
      message: boundedMessage(error),
    },
  };
}

function baseResult(suggestionId) {
  return {
    suggestionId,
    status: null,
    expectedFolder: null,
    expectedFilename: null,
    item: null,
    semanticHash: null,
    error: null,
  };
}

function pointerState(row, expectedFolder = null, expectedFilename = null) {
  const folder = row?.wmkf_reviewsharepointfolder || null;
  const filename = row?.wmkf_reviewfilename || null;
  if (!folder && !filename) return 'empty';
  if (!folder || !filename) return 'partial';
  if (expectedFolder && expectedFilename
    && sameText(folder, expectedFolder)
    && sameText(filename, expectedFilename)) return 'exact';
  return 'complete';
}

function validateAnswerSnapshot(answers) {
  if (!Array.isArray(answers) || answers.length === 0) {
    return { ok: false, status: 'not_structured', reason: 'No persisted answer snapshot exists.' };
  }
  if (!answers.some((answer) => answer?.questionType === 'richtext')) {
    return { ok: false, status: 'not_structured', reason: 'No persisted rich-text answer row exists.' };
  }

  const keys = new Set();
  const orders = new Set();
  for (const answer of answers) {
    const key = typeof answer?.questionKey === 'string' ? answer.questionKey.trim() : '';
    const text = typeof answer?.questionText === 'string' ? answer.questionText.trim() : '';
    const type = answer?.questionType;
    const order = answer?.questionOrder;
    if (!key || keys.has(key) || !text || !KNOWN_ANSWER_TYPES.has(type)
      || !Number.isInteger(order) || orders.has(order)) {
      return { ok: false, status: 'invalid_snapshot', reason: 'Answer identity, order, text, or type is inconsistent.' };
    }
    keys.add(key);
    orders.add(order);

    if (answer.questionOptionsUnreadable === true || answer.answerValuesUnreadable === true) {
      return { ok: false, status: 'invalid_snapshot', reason: 'A categorical snapshot is unreadable.' };
    }
    if (type === 'richtext' && typeof answer.answerHtml !== 'string') {
      return { ok: false, status: 'invalid_snapshot', reason: 'A rich-text answer has an invalid stored shape.' };
    }
    if (type === 'string' && typeof answer.answerText !== 'string') {
      return { ok: false, status: 'invalid_snapshot', reason: 'A string answer has an invalid stored shape.' };
    }
    if (type === 'picklist') {
      if (answer.answerValue !== null && !Number.isInteger(answer.answerValue)) {
        return { ok: false, status: 'invalid_snapshot', reason: 'A picklist answer has an invalid stored value.' };
      }
      if (answer.questionOptions
        && answer.answerValue !== null
        && !answer.questionOptions.some((option) => option.value === answer.answerValue)) {
        return { ok: false, status: 'invalid_snapshot', reason: 'A picklist answer is outside its stored option snapshot.' };
      }
    }
    if (type === 'multiselect') {
      if (!Array.isArray(answer.answerValues)) {
        return { ok: false, status: 'invalid_snapshot', reason: 'A multiselect answer has no readable stored selection.' };
      }
      if (answer.questionOptions) {
        const optionValues = new Set(answer.questionOptions.map((option) => option.value));
        if (answer.answerValues.some((selection) => !optionValues.has(selection.value))) {
          return { ok: false, status: 'invalid_snapshot', reason: 'A multiselect answer is outside its stored option snapshot.' };
        }
      }
    }
  }
  return { ok: true };
}

function sanitizeReviewFilenamePart(value) {
  const sanitized = Array.from(String(value || '').normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, ''))
    .slice(0, 100)
    .join('')
    .replace(/[ .]+$/g, '');
  if (!sanitized) throw new Error('Generated review path requires a reviewer name.');
  return sanitized;
}

export function buildGeneratedReviewPath({ requestId, requestNumber, reviewerName }) {
  if (!isGuid(requestId)) {
    throw new Error('Generated review path requires a request GUID.');
  }
  const number = String(requestNumber || '').trim();
  if (!number) throw new Error('Generated review path requires a request number.');
  const requestGuid = requestId.replace(/-/g, '').toUpperCase();
  const safeReviewerName = sanitizeReviewFilenamePart(reviewerName);
  return {
    folder: `${number}_${requestGuid}/Reviews`,
    filename: `Review-${number}-${safeReviewerName}.docx`,
  };
}

function resolvedCycle(row, request) {
  const stamped = typeof row?.wmkf_grantcyclecode === 'string'
    ? row.wmkf_grantcyclecode.trim().toUpperCase()
    : '';
  if (stamped) return parseCycleCode(stamped) ? stamped : null;
  return meetingDateToCycleCode(request?.wmkf_meetingdate);
}

function answerRowsFor(answersBySuggestion, suggestionId) {
  if (answersBySuggestion[suggestionId]) return answersBySuggestion[suggestionId];
  const matchingKey = Object.keys(answersBySuggestion)
    .find((key) => key.toLowerCase() === suggestionId.toLowerCase());
  return matchingKey ? answersBySuggestion[matchingKey] : [];
}

function sourceState({ row, request, reviewer, answers, candidateCycle }) {
  const requestRow = request || {};
  const reviewerRow = reviewer || {};
  return {
    suggestion: {
      id: row.wmkf_appreviewersuggestionid || null,
      requestId: row._wmkf_request_value || null,
      reviewerId: row._wmkf_potentialreviewer_value || null,
      receivedAt: row.wmkf_reviewreceivedat || null,
      reviewerTitle: row.wmkf_reviewertitle || null,
      reviewerAffiliation: row.wmkf_revieweraffiliation || null,
      selected: row.wmkf_selected === true,
      disposition: row.wmkf_applicantdisposition ?? null,
      stampedCycle: row.wmkf_grantcyclecode || null,
      resolvedCycle: candidateCycle || null,
      folder: row.wmkf_reviewsharepointfolder || null,
      filename: row.wmkf_reviewfilename || null,
    },
    request: {
      id: requestRow.akoya_requestid || row._wmkf_request_value || null,
      number: requestRow.akoya_requestnum || null,
      title: requestRow.akoya_title || null,
      organizationName: requestRow.wmkf_organizationname || null,
      applicantId: requestRow._akoya_applicantid_value || null,
      applicantLabel: requestRow._akoya_applicantid_value_formatted || null,
      meetingDate: requestRow.wmkf_meetingdate || null,
    },
    reviewer: {
      id: reviewerRow.wmkf_potentialreviewersid || row._wmkf_potentialreviewer_value || null,
      name: reviewerRow.wmkf_name || null,
    },
    answers,
  };
}

async function loadCandidate(
  suggestionId,
  { cycleCode, fullInspection = false, allowPointerRepair = false },
) {
  const base = baseResult(suggestionId);
  if (!isGuid(suggestionId)) {
    return { result: failureResult(base, 'invalid_id', new Error('suggestionId must be a GUID'), 'invalid_id') };
  }

  let row;
  try {
    row = await getSuggestionById(suggestionId, SUGGESTION_SELECT);
  } catch (error) {
    if (error?.status === 404) return { result: { ...base, status: 'not_found' } };
    throw error;
  }

  const initialPointerState = pointerState(row);
  if (!fullInspection) {
    if (initialPointerState === 'complete') return { result: { ...base, status: 'already_filed' } };
    if (initialPointerState === 'partial') return { result: { ...base, status: 'partial_pointer' } };
    if (!row.wmkf_reviewreceivedat) return { result: { ...base, status: 'not_received' } };
    if (row.wmkf_selected !== true) return { result: { ...base, status: 'not_selected' } };
    if (isExcluded(row)) return { result: { ...base, status: 'excluded' } };
  }

  const requestId = row._wmkf_request_value;
  const reviewerId = row._wmkf_potentialreviewer_value;
  if (!isGuid(requestId) || (!fullInspection && !isGuid(reviewerId))) {
    return { result: { ...base, status: 'unresolved_relationship' } };
  }

  const [request, reviewer, answersBySuggestion] = await Promise.all([
    getRequestById(requestId, { select: REQUEST_SELECT })
      .catch((error) => (error?.status === 404 ? null : Promise.reject(error))),
    isGuid(reviewerId)
      ? getReviewerById(reviewerId, { select: REVIEWER_SELECT })
        .catch((error) => (error?.status === 404 ? null : Promise.reject(error)))
      : Promise.resolve(null),
    fetchAnswersBySuggestion([suggestionId]),
  ]);
  const candidateCycle = resolvedCycle(row, request);
  const answers = answerRowsFor(answersBySuggestion, suggestionId);
  const source = {
    row,
    request,
    reviewer,
    answers,
    candidateCycle,
    fingerprint: sha256Json(sourceState({ row, request, reviewer, answers, candidateCycle })),
  };
  if (!request || !reviewer) {
    return { result: { ...base, status: 'unresolved_relationship' }, source };
  }

  let expected;
  try {
    expected = buildGeneratedReviewPath({
      requestId: request.akoya_requestid || requestId,
      requestNumber: request.akoya_requestnum,
      reviewerName: reviewer.wmkf_name,
    });
  } catch (error) {
    return { result: failureResult(base, 'unresolved_relationship', error, 'unresolved_relationship') };
  }
  const identified = { ...base, expectedFolder: expected.folder, expectedFilename: expected.filename };
  if (!candidateCycle) return { result: { ...identified, status: 'no_cycle' }, source };
  if (candidateCycle !== cycleCode) return { result: { ...identified, status: 'wrong_cycle' }, source };
  const scopedPointerState = pointerState(row, expected.folder, expected.filename);
  const priorPointer = initialPointerState === 'complete' && scopedPointerState !== 'exact'
    ? {
      folder: row.wmkf_reviewsharepointfolder,
      filename: row.wmkf_reviewfilename,
    }
    : null;
  if (priorPointer && !allowPointerRepair) {
    return {
      result: failureResult(identified, 'pointer_conflict', new Error('Complete pointers do not match the generated target.'), 'pointer_conflict'),
      source,
    };
  }
  if (initialPointerState === 'partial') return { result: { ...identified, status: 'partial_pointer' }, source };
  if (!row.wmkf_reviewreceivedat) return { result: { ...identified, status: 'not_received' }, source };
  if (row.wmkf_selected !== true) return { result: { ...identified, status: 'not_selected' }, source };
  if (isExcluded(row)) return { result: { ...identified, status: 'excluded' }, source };

  const snapshot = validateAnswerSnapshot(answers);
  if (!snapshot.ok) {
    return {
      result: snapshot.status === 'invalid_snapshot'
        ? failureResult(identified, snapshot.status, new Error(snapshot.reason), snapshot.status)
        : { ...identified, status: snapshot.status },
      source,
    };
  }
  if (!row._etag) {
    return {
      result: failureResult(identified, 'pointer_write_failed', new Error('Suggestion ETag is unavailable.'), 'missing_etag'),
      source,
    };
  }
  return {
    base: identified,
    row,
    request,
    reviewer,
    answers,
    cycleCode: candidateCycle,
    source,
    priorPointer,
    preclassifiedStatus: scopedPointerState === 'exact'
      ? 'already_filed'
      : priorPointer ? 'eligible_repair' : null,
  };
}

export async function inspectIndividualReviewFileCandidate(suggestionId, { cycleCode }) {
  if (!parseCycleCode(cycleCode)) {
    return failureResult(baseResult(suggestionId), 'invalid_cycle', new Error('A valid exact cycle code is required.'), 'invalid_cycle');
  }
  const loaded = await loadCandidate(suggestionId, { cycleCode: cycleCode.toUpperCase() });
  return loaded.result || { ...loaded.base, status: 'eligible' };
}

/** Resolve the exact read-only SharePoint/Dataverse target used by a manifest. */
export async function resolveReviewDocxTarget({ requireProductionDataverse = false } = {}) {
  const configuredSite = (process.env.SHAREPOINT_SITE_URL || SHAREPOINT_CANONICAL_SITE_URL).replace(/\/$/, '');
  if (configuredSite !== SHAREPOINT_CANONICAL_SITE_URL) {
    const error = new Error('Review-DOCX filing target is not the canonical akoyaGO SharePoint site.');
    error.code = 'sharepoint_target_mismatch';
    throw error;
  }
  const dynamicsBase = String(process.env.DYNAMICS_URL || '').replace(/\/$/, '');
  if (!dynamicsBase) {
    const error = new Error('DYNAMICS_URL is required for pointer-write preflight.');
    error.code = 'dataverse_target_missing';
    throw error;
  }
  if (requireProductionDataverse && classifyTarget(dynamicsBase) !== 'production') {
    const error = new Error('Review-DOCX backfill requires the tracked Production Dataverse target.');
    error.code = 'backfill_dataverse_target_mismatch';
    throw error;
  }

  const siteId = await GraphService.getSiteId();
  const driveId = await GraphService.getDriveId(REVIEW_DOCX_LIBRARY, { siteId });
  if (!siteId || !driveId) {
    const error = new Error('Canonical SharePoint site or request-library drive did not resolve.');
    error.code = 'sharepoint_identity_missing';
    throw error;
  }
  return { siteUrl: configuredSite, siteId, driveId, dynamicsBase };
}

/**
 * Build the redacted, read-only manifest projection for one suggestion.
 * Review answers and generated bytes influence hashes but never leave this
 * service in the returned projection.
 */
export async function planIndividualReviewFileCandidate(
  suggestionId,
  { cycleCode, target, allowPointerRepair = false } = {},
) {
  const normalizedCycle = typeof cycleCode === 'string' ? cycleCode.trim().toUpperCase() : '';
  if (!parseCycleCode(normalizedCycle)) {
    return failureResult(baseResult(suggestionId), 'invalid_cycle', new Error('A valid exact cycle code is required.'), 'invalid_cycle');
  }

  let loaded;
  try {
    loaded = await loadCandidate(suggestionId, {
      cycleCode: normalizedCycle,
      fullInspection: true,
      allowPointerRepair,
    });
  } catch (error) {
    return failureResult(baseResult(suggestionId), 'read_failed', error, 'read_failed');
  }
  const source = loaded.source || null;
  const publicSource = {
    suggestionId,
    suggestionEtag: source?.row?._etag || null,
    sourceFingerprint: source?.fingerprint || null,
    requestId: source?.request?.akoya_requestid || source?.row?._wmkf_request_value || null,
    requestNumber: source?.request?.akoya_requestnum || null,
    reviewerName: source?.reviewer?.wmkf_name || null,
    receivedAt: source?.row?.wmkf_reviewreceivedat || null,
    cycleCode: source?.candidateCycle || null,
    currentPointer: source?.row?.wmkf_reviewsharepointfolder
      && source?.row?.wmkf_reviewfilename
      ? {
        folder: source.row.wmkf_reviewsharepointfolder,
        filename: source.row.wmkf_reviewfilename,
      }
      : null,
    selected: source ? source.row.wmkf_selected === true : null,
    disposition: source?.row?.wmkf_applicantdisposition ?? null,
    richTextPresent: source
      ? source.answers.some((answer) => answer?.questionType === 'richtext')
      : null,
  };
  if (loaded.result) return { ...loaded.result, ...publicSource };

  const {
    base, row, request, reviewer, answers, preclassifiedStatus, priorPointer,
  } = loaded;
  let built;
  let semanticHash;
  try {
    built = await buildIndividualReviewDocx({
      suggestionId,
      reviewer,
      request,
      row,
      generatedAtIso: row.wmkf_reviewreceivedat,
      answerSnapshot: answers,
      outputFilename: base.expectedFilename,
    });
    if (built.filename !== base.expectedFilename) {
      throw new Error('Individual review builder returned an unexpected filename.');
    }
    semanticHash = await hashGovernedDocxContent(built.content);
  } catch (error) {
    return { ...failureResult(base, 'generation_failed', error, 'generation_failed'), ...publicSource };
  }

  if (!target?.siteId || !target?.driveId || target.siteUrl !== SHAREPOINT_CANONICAL_SITE_URL) {
    return {
      ...failureResult(base, 'target_guard_failed', new Error('A canonical resolved read target is required.'), 'target_guard_failed'),
      ...publicSource,
      semanticHash,
    };
  }

  let item;
  try {
    item = await GraphService.getFileMetadataByPath(
      REVIEW_DOCX_LIBRARY,
      base.expectedFolder,
      base.expectedFilename,
      { siteId: target.siteId, driveId: target.driveId },
    );
  } catch (error) {
    return { ...failureResult(base, 'sharepoint_failed', error, 'sharepoint_failed'), ...publicSource, semanticHash };
  }

  let existingSemanticHash = null;
  let semanticMatch = null;
  if (item) {
    try {
      existingSemanticHash = await hashExistingItem(item);
      semanticMatch = existingSemanticHash === semanticHash;
    } catch (error) {
      return {
        ...failureResult({ ...base, item: safeItem(item) }, 'sharepoint_failed', error, 'sharepoint_download_failed'),
        ...publicSource,
        semanticHash,
      };
    }
    if (!semanticMatch) {
      return {
        ...failureResult({ ...base, item: safeItem(item) }, 'content_conflict', new Error('The existing target file does not match the generated review.'), 'content_conflict'),
        ...publicSource,
        semanticHash,
        existingSemanticHash,
        semanticMatch,
      };
    }
  }

  if (preclassifiedStatus === 'already_filed' && !item) {
    return {
      ...failureResult(base, 'verification_failed', new Error('Dataverse pointers exist but the expected SharePoint item is missing.'), 'verification_failed'),
      ...publicSource,
      semanticHash,
      item: null,
      existingSemanticHash: null,
      semanticMatch: false,
    };
  }

  return {
    ...base,
    ...publicSource,
    status: preclassifiedStatus || 'eligible',
    semanticHash,
    priorPointer,
    item: safeItem(item),
    existingSemanticHash,
    semanticMatch,
  };
}

export async function preflightReviewDocxWrite({
  executionMode = 'scheduled',
  suggestionIds = [],
} = {}) {
  if (process.env[REVIEW_DOCX_WRITE_FLAG] !== 'on') {
    const error = new Error(`${REVIEW_DOCX_WRITE_FLAG} must equal literal "on".`);
    error.code = 'write_disabled';
    throw error;
  }
  if (resolveInterlockMode() !== 'on') {
    const error = new Error('DATAVERSE_TARGET_INTERLOCK must be in enforcing mode.');
    error.code = 'interlock_not_enforcing';
    throw error;
  }
  const deployment = classifyDeployment();
  const scheduledAllowed = executionMode === 'scheduled' && deployment === 'production';
  const backfillAllowed = executionMode === 'backfill' && deployment === 'local';
  if (!scheduledAllowed && !backfillAllowed) {
    const error = new Error(
      executionMode === 'backfill'
        ? 'Review-DOCX backfill is allowed only from a local operator process.'
        : 'Scheduled review-DOCX filing is allowed only in a Production deployment.',
    );
    error.code = executionMode === 'backfill' ? 'backfill_not_local' : 'scheduled_not_production';
    throw error;
  }
  if (backfillAllowed) {
    if (!Array.isArray(suggestionIds) || suggestionIds.length === 0 || suggestionIds.some((id) => !isGuid(id))) {
      const error = new Error('Backfill preflight requires the exact non-empty suggestion write set.');
      error.code = 'backfill_write_set_missing';
      throw error;
    }
  }
  const target = await resolveReviewDocxTarget({ requireProductionDataverse: backfillAllowed });
  if (backfillAllowed) {
    for (const suggestionId of suggestionIds) assertPointerTarget(target, suggestionId);
  }
  return { ...target, [TARGET_PROOF]: true };
}

function assertPointerTarget(target, suggestionId) {
  const pointerUrl = `${target.dynamicsBase}/api/data/v9.2/wmkf_appreviewersuggestions(${suggestionId})`;
  assertDataverseOperationAllowed({
    url: pointerUrl,
    method: 'PATCH',
    callerLabel: 'review-docx.individual-file-service',
  });
  return pointerUrl;
}

async function hashExistingItem(item) {
  const downloaded = await GraphService.downloadFile(item.driveId, item.id);
  try {
    return await hashGovernedDocxContent(downloaded.buffer);
  } catch {
    return null;
  }
}

function safeItem(item) {
  if (!item) return null;
  return {
    siteId: item.siteId || null,
    driveId: item.driveId || null,
    id: item.id || null,
    name: item.name || null,
    size: item.size ?? null,
    eTag: item.eTag || null,
    versionId: item.versionId || null,
  };
}

async function rereadPointer(suggestionId) {
  return getSuggestionById(
    suggestionId,
    'wmkf_appreviewersuggestionid,wmkf_reviewsharepointfolder,wmkf_reviewfilename',
  );
}

async function commitPointers({ suggestionId, row, expected, base, allowedPriorPointer = null }) {
  const payload = {
    wmkf_reviewsharepointfolder: expected.folder,
    wmkf_reviewfilename: expected.filename,
  };
  let current = row;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await patchReviewReceipt(suggestionId, payload, { ifMatch: current._etag });
    } catch (error) {
      lastError = error;
    }

    let fresh;
    try {
      fresh = await rereadPointer(suggestionId);
    } catch (readError) {
      return failureResult(base, 'pointer_write_failed', lastError || readError, 'pointer_readback_failed');
    }
    const state = pointerState(fresh, expected.folder, expected.filename);
    if (state === 'exact') return { ...base, status: 'pointer_committed' };
    const priorStateStillExact = allowedPriorPointer
      && pointerState(fresh, allowedPriorPointer.folder, allowedPriorPointer.filename) === 'exact';
    if (state !== 'empty' && !priorStateStillExact) {
      return {
        ...failureResult(base, 'pointer_conflict', lastError || new Error('A different or partial pointer won the race.'), 'pointer_conflict'),
        cleanupSafe: state === 'complete',
      };
    }
    if (!lastError) {
      return {
        ...failureResult(base, 'pointer_write_failed', new Error('Pointer PATCH returned without durable readback.'), 'pointer_not_committed'),
        cleanupSafe: Boolean(priorStateStillExact),
      };
    }
    if (attempt === 1 || !fresh._etag) {
      return {
        ...failureResult(base, 'pointer_write_failed', lastError, fresh._etag ? 'pointer_retry_exhausted' : 'missing_etag'),
        cleanupSafe: Boolean(priorStateStillExact),
      };
    }
    current = fresh;
    lastError = null;
  }
  return failureResult(base, 'pointer_write_failed', new Error('Pointer retry exhausted.'), 'pointer_retry_exhausted');
}

async function cleanupCreatedItem(item, base, priorResult) {
  try {
    await GraphService.deleteFile(item.driveId, item.id);
    return priorResult;
  } catch (error) {
    await OperationalEventService.recordEvent({
      eventType: 'review_docx_orphan_cleanup_failed',
      severity: 'error',
      subsystem: 'review-docx-filing',
      stage: 'sharepoint_cleanup',
      summary: 'A review DOCX created by a failed filing attempt could not be removed.',
      entityRefs: { suggestionId: base.suggestionId, driveId: item.driveId, itemId: item.id },
      dedupeKey: `review-docx-cleanup:${base.suggestionId}:${item.driveId}:${item.id}`,
      metadata: { priorStatus: priorResult.status, code: errorCode(error, 'cleanup_failed') },
    });
    return failureResult({ ...base, item: safeItem(item) }, 'cleanup_failed', error, 'cleanup_failed');
  }
}

export async function ensureIndividualReviewFile(
  suggestionId,
  {
    cycleCode,
    executionMode = 'scheduled',
    target = null,
    expectedSuggestionEtag = null,
    expectedSourceFingerprint = null,
    expectedSemanticHash = null,
    repairFromPointer = null,
    replaceExistingItem = null,
  } = {},
) {
  const normalizedCycle = typeof cycleCode === 'string' ? cycleCode.trim().toUpperCase() : '';
  if (!parseCycleCode(normalizedCycle)) {
    return failureResult(baseResult(suggestionId), 'invalid_cycle', new Error('A valid exact cycle code is required.'), 'invalid_cycle');
  }

  let loaded;
  try {
    const manifestBound = Boolean(
      expectedSuggestionEtag || expectedSourceFingerprint || expectedSemanticHash,
    );
    const repairRequested = repairFromPointer !== null;
    const contentRepairRequested = replaceExistingItem !== null;
    if (repairRequested && contentRepairRequested) {
      return failureResult(baseResult(suggestionId), 'target_guard_failed', new Error('A repair cannot relocate a pointer and replace item content in the same operation.'), 'repair_mode_conflict');
    }
    if (repairRequested && (executionMode !== 'backfill'
      || !expectedSuggestionEtag
      || !expectedSourceFingerprint
      || !expectedSemanticHash
      || !repairFromPointer?.folder
      || !repairFromPointer?.filename)) {
      return failureResult(baseResult(suggestionId), 'target_guard_failed', new Error('Pointer repair requires an exact manifest-bound local backfill request.'), 'repair_not_manifest_bound');
    }
    if (contentRepairRequested && (executionMode !== 'backfill'
      || !expectedSuggestionEtag
      || !expectedSourceFingerprint
      || !expectedSemanticHash
      || !replaceExistingItem?.id
      || !replaceExistingItem?.eTag
      || !replaceExistingItem?.versionId
      || !replaceExistingItem?.semanticHash)) {
      return failureResult(baseResult(suggestionId), 'target_guard_failed', new Error('Content repair requires an exact manifest-bound local backfill request.'), 'content_repair_not_manifest_bound');
    }
    loaded = await loadCandidate(suggestionId, {
      cycleCode: normalizedCycle,
      fullInspection: manifestBound,
      allowPointerRepair: repairRequested,
    });
  } catch (error) {
    return failureResult(baseResult(suggestionId), 'read_failed', error, 'read_failed');
  }
  if (loaded.result) return loaded.result;

  const {
    base, row, request, reviewer, answers, source, preclassifiedStatus, priorPointer,
  } = loaded;
  if (repairFromPointer && (preclassifiedStatus !== 'eligible_repair'
    || !sameText(priorPointer?.folder, repairFromPointer.folder)
    || !sameText(priorPointer?.filename, repairFromPointer.filename))) {
    return failureResult(base, 'source_drift', new Error('Current pointers no longer match the reviewed repair source.'), 'source_drift');
  }
  if (replaceExistingItem && preclassifiedStatus !== 'already_filed') {
    return failureResult(base, 'source_drift', new Error('Content repair requires the reviewed target to remain the exact current pointer.'), 'source_drift');
  }
  if ((expectedSuggestionEtag && row._etag !== expectedSuggestionEtag)
    || (expectedSourceFingerprint && source?.fingerprint !== expectedSourceFingerprint)) {
    return failureResult(base, 'source_drift', new Error('Suggestion source no longer matches the reviewed manifest.'), 'source_drift');
  }
  let built;
  let semanticHash;
  try {
    built = await buildIndividualReviewDocx({
      suggestionId,
      reviewer,
      request,
      row,
      generatedAtIso: row.wmkf_reviewreceivedat,
      answerSnapshot: answers,
      outputFilename: base.expectedFilename,
    });
    if (built.filename !== base.expectedFilename) {
      throw new Error('Individual review builder returned an unexpected filename.');
    }
    semanticHash = await hashGovernedDocxContent(built.content);
  } catch (error) {
    return failureResult(base, 'generation_failed', error, 'generation_failed');
  }
  const hashedBase = { ...base, semanticHash };
  if (expectedSemanticHash && semanticHash !== expectedSemanticHash) {
    return failureResult(hashedBase, 'source_drift', new Error('Generated semantic content no longer matches the reviewed manifest.'), 'source_drift');
  }

  let assertedTarget = target?.[TARGET_PROOF] === true ? target : null;
  try {
    assertedTarget ||= await preflightReviewDocxWrite({ executionMode, suggestionIds: [suggestionId] });
    assertPointerTarget(assertedTarget, suggestionId);
  } catch (error) {
    return failureResult(hashedBase, 'target_guard_failed', error, 'target_guard_failed');
  }

  const expected = { folder: base.expectedFolder, filename: base.expectedFilename };
  let item;
  let created = false;
  let replaced = false;
  try {
    item = await GraphService.getFileMetadataByPath(
      REVIEW_DOCX_LIBRARY,
      expected.folder,
      expected.filename,
      { siteId: assertedTarget.siteId, driveId: assertedTarget.driveId },
    );
    if (!item) {
      if (preclassifiedStatus === 'already_filed') {
        return failureResult(hashedBase, 'verification_failed', new Error('Dataverse pointers exist but the expected SharePoint item is missing.'), 'verification_failed');
      }
      try {
        item = await GraphService.uploadFile(
          REVIEW_DOCX_LIBRARY,
          expected.folder,
          expected.filename,
          built.content,
          built.contentType,
          {
            conflictBehavior: 'fail',
            siteId: assertedTarget.siteId,
            driveId: assertedTarget.driveId,
          },
        );
        created = true;
      } catch (error) {
        if (error?.status !== 409) throw error;
        item = await GraphService.getFileMetadataByPath(
          REVIEW_DOCX_LIBRARY,
          expected.folder,
          expected.filename,
          { siteId: assertedTarget.siteId, driveId: assertedTarget.driveId },
        );
        if (!item) throw error;
      }
    }
  } catch (error) {
    return failureResult(hashedBase, 'sharepoint_failed', error, 'sharepoint_failed');
  }

  if (replaceExistingItem) {
    if (!item
      || !sameText(item.id, replaceExistingItem.id)
      || !sameText(item.eTag, replaceExistingItem.eTag)
      || !sameText(item.versionId, replaceExistingItem.versionId)
      || !sameText(item.name, expected.filename)) {
      return failureResult({ ...hashedBase, item: safeItem(item) }, 'source_drift', new Error('Current SharePoint item identity or version no longer matches the reviewed content repair.'), 'source_drift');
    }
    let priorSemanticHash;
    try {
      priorSemanticHash = await hashExistingItem(item);
    } catch (error) {
      return failureResult({ ...hashedBase, item: safeItem(item) }, 'sharepoint_failed', error, 'sharepoint_download_failed');
    }
    if (priorSemanticHash !== replaceExistingItem.semanticHash) {
      return failureResult({ ...hashedBase, item: safeItem(item) }, 'source_drift', new Error('Current SharePoint content no longer matches the reviewed prior version.'), 'source_drift');
    }
    try {
      const replacement = await GraphService.replaceFileContent(
        assertedTarget.driveId,
        item.id,
        built.content,
        built.contentType,
        { siteId: assertedTarget.siteId, ifMatch: item.eTag },
      );
      if (!replacement
        || !sameText(replacement.id, item.id)
        || !sameText(replacement.name, expected.filename)) {
        throw new Error('SharePoint content replacement returned a different item identity.');
      }
      item = replacement;
      replaced = true;
    } catch (error) {
      return failureResult({ ...hashedBase, item: safeItem(item) }, 'sharepoint_failed', error, 'content_replace_failed');
    }
  }

  const itemBase = { ...hashedBase, item: safeItem(item) };
  if (!created && !replaced) {
    let existingHash;
    try {
      existingHash = await hashExistingItem(item);
    } catch (error) {
      return failureResult(itemBase, 'sharepoint_failed', error, 'sharepoint_download_failed');
    }
    if (existingHash !== semanticHash) {
      return failureResult(itemBase, 'content_conflict', new Error('The existing target file does not match the generated review.'), 'content_conflict');
    }
  }

  if (preclassifiedStatus === 'already_filed') {
    try {
      const [finalPointer, finalItem] = await Promise.all([
        rereadPointer(suggestionId),
        GraphService.getFileMetadataById(assertedTarget.driveId, item.id, {
          siteId: assertedTarget.siteId,
        }),
      ]);
      if (pointerState(finalPointer, base.expectedFolder, base.expectedFilename) !== 'exact'
        || !finalItem
        || finalItem.name !== base.expectedFilename
        || (await hashExistingItem(finalItem)) !== semanticHash) {
        throw new Error('Already-filed pointer, stable item identity, or semantic content verification failed.');
      }
      if (replaced) {
        const priorVersion = await GraphService.downloadFileVersion(
          assertedTarget.driveId,
          finalItem.id,
          replaceExistingItem.versionId,
        );
        if ((await hashGovernedDocxContent(priorVersion)) !== replaceExistingItem.semanticHash) {
          throw new Error('SharePoint did not retain the reviewed prior file version after content repair.');
        }
      }
      return {
        ...hashedBase,
        status: replaced ? 'replaced' : 'already_filed',
        item: safeItem(finalItem),
        priorVersionId: replaced ? replaceExistingItem.versionId : null,
      };
    } catch (error) {
      return failureResult(itemBase, 'verification_failed', error, 'verification_failed');
    }
  }

  const pointerResult = await commitPointers({
    suggestionId,
    row,
    expected,
    base: itemBase,
    allowedPriorPointer: repairFromPointer,
  });
  if (pointerResult.status !== 'pointer_committed') {
    if (created && pointerResult.cleanupSafe === true) {
      const { cleanupSafe: _cleanupSafe, ...publicResult } = pointerResult;
      return cleanupCreatedItem(item, itemBase, publicResult);
    }
    const { cleanupSafe: _cleanupSafe, ...publicResult } = pointerResult;
    return publicResult;
  }

  try {
    const [finalPointer, finalItem] = await Promise.all([
      rereadPointer(suggestionId),
      GraphService.getFileMetadataById(assertedTarget.driveId, item.id, {
        siteId: assertedTarget.siteId,
      }),
    ]);
    if (pointerState(finalPointer, expected.folder, expected.filename) !== 'exact'
      || !finalItem
      || finalItem.name !== expected.filename
      || (await hashExistingItem(finalItem)) !== semanticHash) {
      throw new Error('Final pointer, stable item identity, or semantic content verification failed.');
    }
    return {
      ...hashedBase,
      status: created ? 'created' : 'reconciled',
      item: safeItem(finalItem),
    };
  } catch (error) {
    return failureResult(itemBase, 'verification_failed', error, 'verification_failed');
  }
}

async function recordActionableResult(result) {
  if (!isActionableReviewDocxStatus(result.status)) return;
  await OperationalEventService.recordEvent({
    eventType: 'review_docx_filing_failed',
    severity: 'error',
    subsystem: 'review-docx-filing',
    stage: result.status,
    summary: `Review DOCX filing requires attention (${result.status}).`,
    entityRefs: { suggestionId: result.suggestionId, itemId: result.item?.id || null },
    dedupeKey: `review-docx-filing:${result.suggestionId}:${result.status}`,
    metadata: { code: result.error?.code || result.status },
  });
}

function countStatuses(results) {
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  return counts;
}

export async function sweepMissingIndividualReviewFiles({
  cycleCode = process.env[REVIEW_DOCX_CYCLE_FLAG],
  scanCap = 50,
  attemptCap = 5,
  deadlineMs = 260_000,
  minRemainingMs = 30_000,
} = {}) {
  const startedAt = Date.now();
  const normalizedCycle = typeof cycleCode === 'string' ? cycleCode.trim().toUpperCase() : '';
  const boundedScanCap = Math.min(Math.max(Number.parseInt(scanCap, 10) || 50, 1), 100);
  const boundedAttemptCap = Math.min(Math.max(Number.parseInt(attemptCap, 10) || 5, 1), 20);
  const base = {
    cycleCode: normalizedCycle || null,
    scanned: 0,
    attempted: 0,
    candidateCount: 0,
    hasMore: false,
    deadlineReached: false,
    results: [],
    counts: {},
  };

  if (process.env[REVIEW_DOCX_WRITE_FLAG] !== 'on') {
    return { ...base, status: 'disabled' };
  }
  if (!parseCycleCode(normalizedCycle)) {
    const result = failureResult(baseResult(null), 'invalid_cycle', new Error(`${REVIEW_DOCX_CYCLE_FLAG} must be an exact cycle code.`), 'invalid_cycle');
    await recordActionableResult(result);
    return {
      ...base,
      status: 'invalid_cycle',
      results: [result],
      counts: { invalid_cycle: 1 },
    };
  }

  let target;
  try {
    target = await preflightReviewDocxWrite({ executionMode: 'scheduled' });
  } catch (error) {
    const result = failureResult(baseResult(null), 'target_guard_failed', error, 'target_guard_failed');
    await recordActionableResult(result);
    return { ...base, status: 'target_guard_failed', results: [result], counts: { target_guard_failed: 1 } };
  }

  const discovered = await findReviewDocxFilingCandidates({ cycleCode: normalizedCycle });
  if (discovered.capped) {
    throw new Error('Review DOCX candidate discovery hit the Dataverse 5000-row cap.');
  }
  const population = discovered.records || [];
  const emptyPointerIds = population
    .filter((row) => pointerState(row) === 'empty')
    .map((row) => row.wmkf_appreviewersuggestionid)
    .filter(isGuid);
  const discoveryAnswers = emptyPointerIds.length > 0
    ? await fetchAnswersBySuggestion(emptyPointerIds)
    : {};
  const actionablePopulation = population.filter((row) => {
    if (pointerState(row) === 'partial') return true;
    return answerRowsFor(discoveryAnswers, row.wmkf_appreviewersuggestionid)
      .some((answer) => answer?.questionType === 'richtext');
  });
  const candidates = actionablePopulation.slice(0, boundedScanCap);
  const output = {
    ...base,
    status: 'completed',
    candidateCount: actionablePopulation.length,
    hasMore: actionablePopulation.length > candidates.length,
  };

  for (const candidate of candidates) {
    if (Date.now() - startedAt > deadlineMs - minRemainingMs) {
      output.deadlineReached = true;
      break;
    }
    const suggestionId = candidate.wmkf_appreviewersuggestionid;
    output.scanned += 1;
    let inspected;
    try {
      inspected = await inspectIndividualReviewFileCandidate(suggestionId, { cycleCode: normalizedCycle });
    } catch (error) {
      inspected = failureResult(baseResult(suggestionId), 'read_failed', error, 'read_failed');
    }

    let result = inspected;
    if (inspected.status === 'eligible') {
      if (output.attempted >= boundedAttemptCap) {
        result = { ...inspected, status: 'attempt_limit' };
      } else {
        output.attempted += 1;
        result = await ensureIndividualReviewFile(suggestionId, {
          cycleCode: normalizedCycle,
          executionMode: 'scheduled',
          target,
        });
      }
    }
    output.results.push(result);
    await recordActionableResult(result);
  }
  output.counts = countStatuses(output.results);
  return output;
}
