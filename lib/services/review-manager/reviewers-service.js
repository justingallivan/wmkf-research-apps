/**
 * Review Manager — reviewers listing + lifecycle-update service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for GET/PATCH /api/review-manager/reviewers;
 * the route is a thin shell (auth BEFORE method dispatch — preserved from the
 * original route — input validation, DAL context, HTTP mapping). One method
 * per verb per Decision 1: `getReviewers` / `patchReviewers`.
 *
 * Contract (plan Decision 3):
 *   - takes plain argument objects, never req/res;
 *   - getReviewers returns the full 200 DTO ({ success, proposals,
 *     totalReviewers, liveQuestions } or the empty/PD-null early shapes);
 *   - patchReviewers returns { success: true, message };
 *   - getReviewers throws ServiceHttpError 400 when an all-request listing
 *     omits its required cycleCode; other read failures propagate untyped;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * PATCH batch semantics preserved EXACTLY: a sequential for…of over
 * suggestionIds — one failure throws out with earlier updates already
 * applied (no partial-success reporting, no parallelization). The
 * characterization suite pins call order and count.
 *
 * Read data is staff-shared. The route enforces the lead-PD/superuser boundary
 * before invoking either single or batch PATCH behavior here.
 */

import { resolveByEmail as resolvePD } from '../program-director-resolver';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../utils/cycle-code';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById, findByRequestNumber } from '../../dataverse/adapters/grant-request';
import { queryReviewers } from '../../dataverse/adapters/potential-reviewer';
import { ratingsFromAnswers } from '../../external/review-answer-snapshot';
import { getActiveQuestionSet } from '../../external/review-question-fetcher';
// Answer-snapshot reader hoisted to a shared module (also used by the thank-you sweep).
import { fetchAnswersBySuggestion } from '../review-answers';
import { chunk as chunked } from '../../utils/chunk.js';
import { TERMINAL_REVIEW_STATUS_VALUES, isTerminalReviewStatus } from '../../../shared/config/reviewerStatus.js';
import { REVIEW_STATUS_MAP } from '../../../shared/config/reviewerLifecycle.js';
import { ServiceHttpError } from '../service-http-error';
import {
  buildReviewSynthesisDigest,
  hashReviewSynthesisDigest,
} from '../review-synthesis-content.js';
import { evaluateReviewSynthesisReadiness } from '../review-synthesis-readiness.js';
import { getReviewSynthesisJobState } from '../review-synthesis-job-service.js';
import { resolveEffectiveReviewDueDate } from '../../external/reviewer-due-date.js';
import { deriveReviewerTokenState } from '../../external/reviewer-token-state.js';
import { evaluateReviewDueReminderEligibility } from '../reviewer-reminder-eligibility.js';
import { classifyReviewFileProvenance } from '../../../shared/utils/review-file-provenance.js';

const REQUEST_FIELDS = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_reviewduedate',
  'wmkf_abstract',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  '_wmkf_programareaserved_value',
  '_wmkf_programdirector_value',
  // Phase 4: stored AI synthesis of submitted reviews (fail-soft JSON parse below).
  'wmkf_reviewsynthesisjson',
];

// Legacy review_status optionset → string (mirror of REVIEW_STATUS_MAP).
// The UI keeps using the string codes; we translate on read.
const REVIEW_STATUS_BY_VALUE = {
  100000000: 'accepted',
  100000001: 'materials_sent',
  100000002: 'under_review',
  100000003: 'review_received',
  100000004: 'complete',
  [TERMINAL_REVIEW_STATUS_VALUES.withdrew]: 'withdrew',
  [TERMINAL_REVIEW_STATUS_VALUES.released]: 'released',
};

// Canonical read map (numeric → string), derived from the adapter's write map so the
// two can't drift and `held`/`withdrawn_sufficient` are always covered (audit #7).
const RESPONSE_TYPE_BY_VALUE = suggestionAdapter.RESPONSE_TYPE_BY_VALUE;

// Whole days elapsed since `iso` (floor, never negative). Used for the
// "days outstanding" figure in the workbench Reviews tab outstanding section.
function daysSince(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  return days < 0 ? 0 : days;
}

function projectRequest(r) {
  if (!r) return null;
  const cycleCode = r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null;
  return {
    requestId: r.akoya_requestid,
    requestNumber: r.akoya_requestnum,
    title: r.akoya_title || null,
    abstract: r.wmkf_abstract || null,
    meetingDate: r.wmkf_meetingdate || null,
    reviewDeadline: r.wmkf_reviewduedate || null,
    cycleCode,
    cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
    applicant: r._akoya_applicantid_value_formatted || null,
    projectLeader: r._wmkf_projectleader_value_formatted || null,
    grantProgram: r._wmkf_grantprogram_value_formatted || null,
    programArea: r._wmkf_programareaserved_value_formatted || null,
    organizationName: r.wmkf_organizationname || null,
    reviewSynthesisJson: r.wmkf_reviewsynthesisjson || null,
  };
}

/**
 * Fail-soft parse of the stored AI review synthesis (Phase 4). Never throws —
 * a malformed/legacy value degrades to null rather than 500ing the whole DTO.
 *
 * Shape-sanitized, not just JSON-parsed: the Executor's validationSchema bounds
 * what IT writes, but the column is hand-editable in Dynamics and intended for
 * Power Automate later, so this read is the trust boundary for the tab. Every
 * value the client renders as a React child is guaranteed a string here (a
 * non-string array item would otherwise crash the component tree). Tolerates
 * both the bare synthesis object and a {synthesis: {...}} envelope.
 */
function parseReviewSynthesis(raw) {
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const s = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? ((parsed.synthesis && typeof parsed.synthesis === 'object' && !Array.isArray(parsed.synthesis))
      ? parsed.synthesis
      : parsed)
    : null;
  if (!s) return null;
  const strArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    consensus: strArray(s.consensus),
    disagreements: strArray(s.disagreements),
    keyConcerns: strArray(s.keyConcerns),
    ratingSummaries: (Array.isArray(s.ratingSummaries) ? s.ratingSummaries : [])
      .filter((rs) => rs && typeof rs === 'object' && !Array.isArray(rs))
      .map((rs) => ({
        questionKey: typeof rs.questionKey === 'string' ? rs.questionKey : '',
        questionText: typeof rs.questionText === 'string' ? rs.questionText : '',
        summary: typeof rs.summary === 'string' ? rs.summary : '',
      })),
    overall: typeof s.overall === 'string' ? s.overall : '',
  };
}

/**
 * Build the reviewers-by-proposal DTO.
 *
 * @param {Object} args
 * @param {string|undefined} args.proposalId - request GUID (already validated by the shell)
 * @param {string|undefined} args.requestNumber
 * @param {string|undefined} args.cycleCode
 * @param {string|undefined} args.status - post-filter (single value or 'all')
 * @param {'my'|'all'|undefined} args.scope - listing scope; ignored for a specific proposal
 * @param {string|undefined} args.azureEmail - authenticated user's email for the PD default scope
 * @returns {Promise<Object>} the exact 200 body (incl. the empty and PD-null early shapes)
 */
export async function getReviewers({ proposalId, requestNumber, cycleCode, status, scope = 'my', azureEmail }) {
  let suggestions = [];
  let requestById = {};
  const lifecycleByRequest = {};
  const isSingleProposal = !!(proposalId || requestNumber);

  if (isSingleProposal) {
    const request = await fetchRequestByIdOrNumber({ requestId: proposalId, requestNumber });
    if (!request) {
      return { success: true, proposals: [], totalReviewers: 0 };
    }
    requestById = { [request.requestId]: request };
    const rows = await suggestionAdapter.findByRequest(request.requestId, {
      selectedOnly: true,
      requireComplete: true,
    });
    lifecycleByRequest[request.requestId] = rows;
    suggestions = rows.filter((r) => r.wmkf_accepted === true || !!r.wmkf_reviewreceivedat);
  } else {
    let result;
    if (scope === 'all') {
      if (!cycleCode) {
        throw new ServiceHttpError('cycleCode is required when scope=all', { httpStatus: 400 });
      }
      result = await suggestionAdapter.findAcceptedByCycle(cycleCode);
    } else {
      const pd = await resolvePD(azureEmail);
      if (!pd?.systemuserid) {
        return { success: true, proposals: [], totalReviewers: 0, programDirector: null };
      }
      result = await suggestionAdapter.findAcceptedByPD(pd.systemuserid, { cycleCode });
    }
    suggestions = result.suggestions;
    // Both listing scopes use the adapter's accepted-reviewer request shape.
    // Normalize it once so My and All cannot drift at the response boundary.
    for (const [id, r] of Object.entries(result.requestById)) {
      requestById[id] = {
        requestId: r.requestId,
        requestNumber: r.requestNumber,
        title: r.title,
        abstract: r.abstract,
        meetingDate: r.meetingDate,
        reviewDeadline: r.reviewDeadline,
        cycleCode: r.meetingCycleCode,
        cycleLabel: r.meetingCycleCode ? cycleCodeToLabel(r.meetingCycleCode) : null,
        applicant: r.applicant,
        projectLeader: r.projectLeader,
        grantProgram: r.grantProgram,
        programArea: r.programArea,
        organizationName: r.organizationName,
      };
    }
  }

  if (suggestions.length === 0 && !isSingleProposal) {
    return { success: true, proposals: [], totalReviewers: 0 };
  }

  const personIds = [...new Set(suggestions.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const personById = await fetchPotentialReviewers(personIds);

  // Group by request, build response
  const byRequest = {};
  if (isSingleProposal) {
    const request = Object.values(requestById)[0];
    byRequest[request.requestId] = {
      proposalId: request.requestId,
      proposalTitle: request.title || `Request ${request.requestNumber || ''}`.trim(),
      proposalAbstract: request.abstract,
      proposalAuthors: request.projectLeader || request.applicant,
      proposalInstitution: request.organizationName || request.applicant || null,
      requestNumber: request.requestNumber,
      programArea: request.programArea,
      grantCycleCode: request.cycleCode,
      cycleLabel: request.cycleLabel,
      meetingDate: request.meetingDate,
      reviewDeadline: request.reviewDeadline || null,
      reviewSynthesis: parseReviewSynthesis(request.reviewSynthesisJson),
      reviewSynthesisState: null,
      reviewers: [],
    };
  }
  for (const s of suggestions) {
    const reqId = s._wmkf_request_value;
    const request = requestById[reqId];
    if (!request) continue;

    const reviewStatus = (typeof s.wmkf_reviewstatus === 'number'
      ? REVIEW_STATUS_BY_VALUE[s.wmkf_reviewstatus]
      : null) || 'accepted';

    // Optional post-filter by status (single value, not 'all')
    if (status && status !== 'all' && reviewStatus !== status) continue;

    if (!byRequest[reqId]) {
      byRequest[reqId] = {
        proposalId: request.requestId,
        proposalTitle: request.title || `Request ${request.requestNumber || ''}`.trim(),
        proposalAbstract: request.abstract,
        proposalAuthors: request.projectLeader || request.applicant,
        proposalInstitution: request.organizationName || request.applicant || null,
        requestNumber: request.requestNumber,
        programArea: request.programArea,
        grantCycleCode: request.cycleCode,
        cycleLabel: request.cycleLabel,
        meetingDate: request.meetingDate,
        reviewDeadline: request.reviewDeadline || null,
        reviewSynthesis: parseReviewSynthesis(request.reviewSynthesisJson),
        reviewSynthesisState: null,
        reviewers: [],
      };
    }

    const person = personById[s._wmkf_potentialreviewer_value] || {};
    const researcher = personById[s._wmkf_potentialreviewer_value] || null;
    const effectiveReviewDeadline = resolveEffectiveReviewDueDate({
      overrideDate: s.wmkf_reviewduedateoverride,
      defaultDate: request.reviewDeadline,
    });
    const reviewDueReminderEligibility = evaluateReviewDueReminderEligibility({
      row: s,
      effectiveReviewDueDate: effectiveReviewDeadline,
    });

    byRequest[reqId].reviewers.push({
      suggestionId: s.wmkf_appreviewersuggestionid,
      potentialReviewerId: s._wmkf_potentialreviewer_value || null,
      name: person.wmkf_name || null,
      affiliation: researcher?.wmkf_primaryaffiliation || person.wmkf_organizationname || null,
      email: person.wmkf_emailaddress || null,
      website: researcher?.wmkf_website || null,
      hIndex: researcher?.wmkf_hindex ?? null,
      totalCitations: researcher?.wmkf_totalcitations ?? null,
      notes: s.wmkf_notes || null,
      reviewStatus,
      responseType: typeof s.wmkf_responsetype === 'number'
        ? RESPONSE_TYPE_BY_VALUE[s.wmkf_responsetype]
        : null,
      // Pre-response lifecycle stamps. Added for the Phase 1 activity-history
      // drawer (`shared/components/reviewers/reviewer-activity-history.js`);
      // all three are already in the entity registry's FIELD_SELECT, so this
      // widens the projection only, not the query.
      emailSentAt: s.wmkf_emailsentat || null,
      respondReminderSentAt: s.wmkf_respondremindersentat || null,
      responseReceivedAt: s.wmkf_responsereceivedat || null,
      // Terminal transition stamps. Same rationale: already selected, projected
      // here for the drawer.
      withdrawnSufficientAt: s.wmkf_withdrawnsufficientat || null,
      completedAt: s.wmkf_completedat || null,
      honorariumEligibility: s.wmkf_honorariumeligibility == null
        ? null
        : (suggestionAdapter.HONORARIUM_ELIGIBILITY_BY_VALUE[s.wmkf_honorariumeligibility] || 'unknown'),
      honorariumOptOut: s.wmkf_honorariumoptout === true,
      honorariumRequestId: s._wmkf_honorariumrequest_value || null,
      materialsSentAt: s.wmkf_materialssentat || null,
      // Outstanding tracking (workbench Reviews tab Phase 1): whole days since
      // materials went out, for an accepted-but-not-submitted reviewer. null
      // when materials haven't been sent yet — "days outstanding" isn't
      // meaningful before that.
      daysSinceMaterialsSent: s.wmkf_materialssentat ? daysSince(s.wmkf_materialssentat) : null,
      reminderSentAt: s.wmkf_remindersentat || null,
      reminderCount: s.wmkf_remindercount ?? 0,
      reviewDueDateOverride: s.wmkf_reviewduedateoverride || null,
      effectiveReviewDeadline,
      reviewDueReminderEligibility: reviewDueReminderEligibility.eligible
        ? 'eligible'
        : reviewDueReminderEligibility.reason,
      reviewReceivedAt: s.wmkf_reviewreceivedat || null,
      // Submission status among accepted reviewers (workbench Reviews tab
      // Phase 1). Same signal ReviewsTab already uses client-side
      // (reviewReceivedAt truthy), surfaced explicitly for the outstanding
      // section's filter.
      submitted: !!s.wmkf_reviewreceivedat,
      reviewFilename: s.wmkf_reviewfilename || null,
      thankyouSentAt: s.wmkf_thankyousentat || null,
      // External magic-link token state is pure liveness only. Reminder
      // deadline coverage is projected separately above so a live token still
      // exposes compromise-response actions such as Revoke.
      tokenIssuedAt: s.wmkf_externaltokenissued || null,
      tokenExpiresAt: s.wmkf_externaltokenexpires || null,
      tokenRevoked: s.wmkf_externaltokenrevoked === true,
      tokenState: deriveReviewerTokenState(s),
      proposalFirstAccessedAt: s.wmkf_proposalfirstaccessed || null,
      reviewSharePointFolder: s.wmkf_reviewsharepointfolder || null,
      reviewFileProvenance: classifyReviewFileProvenance(s.wmkf_reviewsharepointfolder),
      reviewUploadedByStaff: s.wmkf_reviewuploadedbystaff === true,
      // Structured review form values. Ratings are sourced from the answer
      // snapshot below (the snapshot is the system of record); only
      // affiliation remains a parent column (identity field, never snapshotted).
      reviewerAffiliation: s.wmkf_revieweraffiliation || null,
      reviewerRiskLevel: null,
      reviewerOverallAssessment: null,
    });
  }

  // Phase 4: attach the narrative answer snapshot. Child rows are QUERIED only
  // for submitted reviewers (only they have rows), but EVERY reviewer in the
  // DTO gets an `answers` array (empty for non-submitted) so the shape is
  // uniform for the client. One keyed child read for the whole page.
  const submittedIds = [];
  for (const p of Object.values(byRequest)) {
    for (const r of p.reviewers) {
      if (r.reviewReceivedAt) submittedIds.push(r.suggestionId);
    }
  }
  const answersBySuggestion = await fetchAnswersBySuggestion([...new Set(submittedIds)]);
  for (const p of Object.values(byRequest)) {
    for (const r of p.reviewers) {
      r.answers = answersBySuggestion[r.suggestionId] || [];
      // Derive the two ratings from the snapshot (system of record)
      // rather than the parent columns. A rating with no snapshot row → null,
      // identical to the old parent-column read for an unrated review.
      const ratings = ratingsFromAnswers(r.answers);
      r.reviewerRiskLevel = ratings.riskLevel;
      r.reviewerOverallAssessment = ratings.overallAssessment;
    }
  }

  const proposalList = await Promise.all(Object.values(byRequest).map(async (p) => {
    const statusCounts = {};
    for (const r of p.reviewers) {
      statusCounts[r.reviewStatus] = (statusCounts[r.reviewStatus] || 0) + 1;
    }
    if (lifecycleByRequest[p.proposalId]) {
      const digestReviewers = p.reviewers
        .filter((reviewer) => reviewer.reviewReceivedAt)
        .map((reviewer) => ({
          name: reviewer.name,
          affiliation: reviewer.reviewerAffiliation || null,
          answers: reviewer.answers,
        }));
      const digest = buildReviewSynthesisDigest(digestReviewers);
      const contentHash = hashReviewSynthesisDigest(digest);
      const readiness = evaluateReviewSynthesisReadiness(
        lifecycleByRequest[p.proposalId],
        { contentHash },
      );
      let jobState;
      try {
        jobState = await getReviewSynthesisJobState(p.proposalId, readiness.inputHash);
      } catch (error) {
        console.error('[review-manager reviewers] synthesis job state unavailable:', error);
        jobState = {
          current: false,
          status: 'unavailable',
          mode: null,
          runId: null,
          attempts: 0,
          lastError: 'Synthesis status is temporarily unavailable.',
          createdAt: null,
          updatedAt: null,
          startedAt: null,
          completedAt: null,
          currentRunId: null,
          currentCompletedAt: null,
        };
      }
      p.reviewSynthesisState = {
        ready: readiness.ready,
        canRunManually: readiness.canRunManually,
        participantCount: readiness.participantCount,
        submittedCount: readiness.submittedCount,
        resolvedCount: readiness.resolvedCount,
        blockingCount: readiness.blockingCount,
        current: !!p.reviewSynthesis && jobState.current,
        status: jobState.status,
        mode: jobState.mode,
        runId: jobState.runId,
        attempts: jobState.attempts,
        lastError: jobState.lastError,
        createdAt: jobState.createdAt,
        updatedAt: jobState.updatedAt,
        startedAt: jobState.startedAt,
        completedAt: jobState.completedAt,
        currentRunId: jobState.currentRunId,
        currentCompletedAt: jobState.currentCompletedAt,
      };
    }
    return { ...p, statusSummary: statusCounts };
  }));

  return {
    success: true,
    proposals: proposalList,
    totalReviewers: proposalList.reduce((n, p) => n + p.reviewers.length, 0),
    liveQuestions: await fetchLiveQuestions(),
  };
}

/**
 * Apply a lifecycle update — batch or single (already validated by the shell).
 *
 * Batch is a SEQUENTIAL for…of: one failure throws with earlier updates
 * already applied (no partial-success reporting) — pinned by the
 * characterization suite; do not parallelize or reorder.
 *
 * Complete and the post-accept terminal statuses are dedicated human workflows;
 * this generic correction seam refuses all three before any row is written.
 *
 * @param {Object} args
 * @param {string[]|null} args.suggestionIds - batch ids (GUID-validated by the shell), or null
 * @param {string|undefined} args.reviewStatus - required for batch
 * @param {string|null} args.suggestionId - single id (GUID-validated by the shell)
 * @param {Object} args.lifecycle - single-update fields (non-empty, built by the shell)
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ success: true, message: string }>}
 */
export async function patchReviewers({ suggestionIds, reviewStatus, suggestionId, lifecycle, actingUserSystemId }) {
  const requestedStatus = Array.isArray(suggestionIds) ? reviewStatus : lifecycle?.reviewStatus;
  const normalizedStatus = typeof requestedStatus === 'string'
    ? requestedStatus.trim().toLowerCase()
    : requestedStatus;
  if (normalizedStatus === 'complete' || normalizedStatus === REVIEW_STATUS_MAP.complete) {
    throw new ServiceHttpError('Complete requires the dedicated reviewer closeout endpoint', {
      httpStatus: 400,
    });
  }
  if (isTerminalReviewStatus(normalizedStatus)
      || Object.values(TERMINAL_REVIEW_STATUS_VALUES).includes(normalizedStatus)) {
    throw new ServiceHttpError('Terminal reviewer statuses require the dedicated transition endpoint', {
      httpStatus: 400,
    });
  }
  if (Array.isArray(suggestionIds) && suggestionIds.length > 0) {
    for (const id of suggestionIds) {
      await suggestionAdapter.updateLifecycle(id, { reviewStatus }, { actingUserSystemId });
    }
    return { success: true, message: `Updated ${suggestionIds.length} reviewers` };
  }

  await suggestionAdapter.updateLifecycle(suggestionId, lifecycle, { actingUserSystemId });
  return { success: true, message: 'Reviewer updated' };
}

async function fetchRequestByIdOrNumber({ requestId, requestNumber }) {
  if (requestId) {
    try {
      const r = await getRequestById(requestId, { select: REQUEST_FIELDS });
      return projectRequest(r);
    } catch (e) {
      return null;
    }
  }
  if (requestNumber) {
    const { records } = await findByRequestNumber(requestNumber, { select: REQUEST_FIELDS, top: 1 });
    return records[0] ? projectRequest(records[0]) : null;
  }
  return null;
}

// S213 appresearcher collapse: bibliometrics live on the person, not the
// wmkf_appresearcher sidecar. Query the person rows (keyed by id) so downstream
// `researcher?.X` reads resolve against the same person record.
//
// Stage 2 read coalescing: this select is the union of the former
// fetchPotentialReviewers projection (wmkf_potentialreviewersid, wmkf_name,
// wmkf_emailaddress, wmkf_organizationname) and the former
// fetchResearchersByPerson projection (wmkf_potentialreviewersid,
// wmkf_primaryaffiliation, wmkf_website, wmkf_hindex, wmkf_totalcitations) —
// same entity, same 25-id OR-chain filter, disjoint fields — merged into one
// chunked read. Every field consumed downstream (getReviewers' person/researcher
// lookups) must remain in this select.
async function fetchPotentialReviewers(ids) {
  if (!ids?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(ids, CHUNK)) {
    const orChain = chunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const { records } = await queryReviewers({
      select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_organizationname,wmkf_primaryaffiliation,wmkf_website,wmkf_hindex,wmkf_totalcitations',
      filter: orChain,
      top: 500,
    });
    for (const p of records) out[p.wmkf_potentialreviewersid] = p;
  }
  return out;
}

/**
 * Fetch the live admin-panel question set for the workbench Reviews-tab
 * comparison matrix (Phase 2, plan §"Comparison matrix"). Projects the
 * fetcher's normalized fields into the minimal shape the matrix derivation
 * (`shared/utils/review-matrix.js`) needs: `{key, order, text, type}`.
 *
 * Fail-soft by design: `getActiveQuestionSet()` fails CLOSED (throws) on any
 * Dataverse/shape problem, which is correct for the reviewer-facing form but
 * wrong here — a workbench read of past submissions must not 500 just because
 * the LIVE question set is momentarily unavailable. On throw, log and return
 * null; the matrix derivation module treats null as "unknown live set" and
 * falls back to snapshot-order-only with nothing marked retired.
 *
 * @returns {Promise<Array<{key:string, order:number, text:string, type:string}>|null>}
 */
async function fetchLiveQuestions() {
  try {
    const questions = await getActiveQuestionSet();
    return questions.map((q) => ({ key: q.key, order: q.order, text: q.label, type: q.type }));
  } catch (error) {
    console.error('Review Manager GET: live question set fetch failed, falling back to snapshot-order-only:', error);
    return null;
  }
}
