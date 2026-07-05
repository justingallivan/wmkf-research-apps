/**
 * Review Manager - Reviewers API (Dataverse-backed)
 *
 * GET /api/review-manager/reviewers
 *   Default scope: accepted suggestions on requests where the authenticated
 *   user is the lead Program Director.
 *   Query overrides:
 *     ?proposalId=<guid>     specific request (collaborator override; bypasses PD filter)
 *     ?requestNumber=<num>   same, by request number
 *     ?cycleCode=Jxx|Dxx     narrow within PD scope
 *     ?status=<reviewStatus> post-filter (e.g. 'materials_sent', 'complete')
 *
 * PATCH /api/review-manager/reviewers
 *   Single  : { suggestionId, reviewStatus?, notes? }
 *   Batch   : { suggestionIds: [...], reviewStatus }
 *
 * Note: suggestionId values are Dataverse GUIDs (strings). reviewStatus values
 * are the legacy string codes — the suggestion adapter translates them to the
 * picklist optionset on write.
 *
 * Data boundary: staff-shared. The PD-default scope is a listing convenience,
 * not an auth boundary — any `review-manager` user can target a specific
 * suggestion via `proposalId`/`requestNumber` and update its lifecycle.
 * Dynamics restrictions are bypassed because reviewer suggestions are
 * foundation-owned operational data, not user-private.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid, allGuids } from '../../../lib/utils/guid';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { resolveByEmail as resolvePD } from '../../../lib/services/program-director-resolver';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../../lib/utils/cycle-code';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { getById as getRequestById, findByRequestNumber } from '../../../lib/dataverse/adapters/grant-request';
import { queryReviewers } from '../../../lib/dataverse/adapters/potential-reviewer';
import { ratingsFromAnswers } from '../../../lib/external/review-answer-snapshot';
import { getActiveQuestionSet } from '../../../lib/external/review-question-fetcher';
// Answer-snapshot reader hoisted to a shared module (also used by the thank-you
// sweep) — `fetchAnswersBySuggestion` was previously defined route-local here.
import { fetchAnswersBySuggestion } from '../../../lib/services/review-answers';

const REQUEST_FIELDS = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
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

function deriveTokenState(s) {
  if (!s.wmkf_externaltokenhash) return 'not_minted';
  if (s.wmkf_externaltokenrevoked === true) return 'revoked';
  if (s.wmkf_externaltokenexpires) {
    const expires = new Date(s.wmkf_externaltokenexpires).getTime();
    if (Number.isFinite(expires) && expires <= Date.now()) return 'expired';
  }
  return 'active';
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

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  return bypassDynamicsRestrictions('review-manager-reviewers', async () => {
    if (req.method === 'GET') return handleGet(req, res, access);
    if (req.method === 'PATCH') return handlePatch(req, res, access);
    return res.status(405).json({ error: 'Method not allowed' });
  });
}

async function handleGet(req, res, access) {
  try {
    const { proposalId, requestNumber, cycleCode, status } = req.query;

    // GUID-validate proposalId before it becomes a Dataverse selector
    // (fetchRequestByIdOrNumber → getRecord). requestNumber is an escaped string lookup.
    if (proposalId && !isGuid(proposalId)) {
      return res.status(400).json({ error: 'proposalId is not a valid GUID' });
    }

    let suggestions = [];
    let requestById = {};

    if (proposalId || requestNumber) {
      const request = await fetchRequestByIdOrNumber({ requestId: proposalId, requestNumber });
      if (!request) {
        return res.status(200).json({ success: true, proposals: [], totalReviewers: 0 });
      }
      requestById = { [request.requestId]: request };
      const rows = await suggestionAdapter.findByRequest(request.requestId, { selectedOnly: true });
      suggestions = rows.filter((r) => r.wmkf_accepted === true);
    } else {
      const pd = await resolvePD(access.session?.user?.azureEmail);
      if (!pd?.systemuserid) {
        return res.status(200).json({ success: true, proposals: [], totalReviewers: 0, programDirector: null });
      }
      const result = await suggestionAdapter.findAcceptedByPD(pd.systemuserid, { cycleCode });
      suggestions = result.suggestions;
      // Reshape requestById from adapter's raw form into the projector shape
      for (const [id, r] of Object.entries(result.requestById)) {
        requestById[id] = {
          requestId: r.requestId,
          requestNumber: r.requestNumber,
          title: r.title,
          abstract: r.abstract,
          meetingDate: r.meetingDate,
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

    if (suggestions.length === 0) {
      return res.status(200).json({ success: true, proposals: [], totalReviewers: 0 });
    }

    const personIds = [...new Set(suggestions.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
    const [personById, researcherByPerson] = await Promise.all([
      fetchPotentialReviewers(personIds),
      fetchResearchersByPerson(personIds),
    ]);

    // Group by request, build response
    const byRequest = {};
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
          reviewSynthesis: parseReviewSynthesis(request.reviewSynthesisJson),
          reviewers: [],
        };
      }

      const person = personById[s._wmkf_potentialreviewer_value] || {};
      const researcher = researcherByPerson[s._wmkf_potentialreviewer_value] || null;

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
        materialsSentAt: s.wmkf_materialssentat || null,
        // Outstanding tracking (workbench Reviews tab Phase 1): whole days since
        // materials went out, for an accepted-but-not-submitted reviewer. null
        // when materials haven't been sent yet — "days outstanding" isn't
        // meaningful before that.
        daysSinceMaterialsSent: s.wmkf_materialssentat ? daysSince(s.wmkf_materialssentat) : null,
        reminderSentAt: s.wmkf_remindersentat || null,
        reminderCount: s.wmkf_remindercount ?? 0,
        reviewReceivedAt: s.wmkf_reviewreceivedat || null,
        // Submission status among accepted reviewers (workbench Reviews tab
        // Phase 1). Same signal ReviewsTab already uses client-side
        // (reviewReceivedAt truthy), surfaced explicitly for the outstanding
        // section's filter.
        submitted: !!s.wmkf_reviewreceivedat,
        reviewFilename: s.wmkf_reviewfilename || null,
        thankyouSentAt: s.wmkf_thankyousentat || null,
        // External magic-link token state. `tokenState` collapses the four
        // raw fields into one of: not_minted | active | revoked | expired,
        // which is what the UI actually wants to render.
        tokenIssuedAt: s.wmkf_externaltokenissued || null,
        tokenExpiresAt: s.wmkf_externaltokenexpires || null,
        tokenRevoked: s.wmkf_externaltokenrevoked === true,
        tokenState: deriveTokenState(s),
        proposalFirstAccessedAt: s.wmkf_proposalfirstaccessed || null,
        reviewSharePointFolder: s.wmkf_reviewsharepointfolder || null,
        reviewUploadedByStaff: s.wmkf_reviewuploadedbystaff === true,
        // Structured review form values. Ratings are sourced from the answer
        // snapshot below (Phase D — the snapshot is the system of record); only
        // affiliation remains a parent column (identity field, never snapshotted).
        reviewerAffiliation: s.wmkf_revieweraffiliation || null,
        reviewerImpact: null,
        reviewerRisk: null,
        reviewerOverallRating: null,
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
        // Phase D: derive the three ratings from the snapshot (system of record)
        // rather than the parent columns. A rating with no snapshot row → null,
        // identical to the old parent-column read for an unrated review.
        const ratings = ratingsFromAnswers(r.answers);
        r.reviewerImpact = ratings.impact;
        r.reviewerRisk = ratings.risk;
        r.reviewerOverallRating = ratings.overallRating;
      }
    }

    const proposalList = Object.values(byRequest).map((p) => {
      const statusCounts = {};
      for (const r of p.reviewers) {
        statusCounts[r.reviewStatus] = (statusCounts[r.reviewStatus] || 0) + 1;
      }
      return { ...p, statusSummary: statusCounts };
    });

    return res.status(200).json({
      success: true,
      proposals: proposalList,
      totalReviewers: proposalList.reduce((n, p) => n + p.reviewers.length, 0),
      liveQuestions: await fetchLiveQuestions(),
    });
  } catch (error) {
    console.error('Review Manager GET error:', error);
    return res.status(500).json({
      error: 'Failed to fetch reviewers',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}

async function handlePatch(req, res, access) {
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  try {
    const {
      suggestionId,
      suggestionIds,
      reviewStatus,
      notes,
    } = req.body || {};

    // Batch: status change across multiple suggestions
    if (Array.isArray(suggestionIds) && suggestionIds.length > 0) {
      if (reviewStatus === undefined) {
        return res.status(400).json({ error: 'reviewStatus required for batch update' });
      }
      // GUID-validate every id before it reaches updateLifecycle (record-id
      // selectors interpolated raw into the request URL). Reject the whole batch
      // on any bad id rather than partially applying.
      if (!allGuids(suggestionIds)) {
        return res.status(400).json({ error: 'suggestionIds must all be valid GUIDs' });
      }
      for (const id of suggestionIds) {
        await suggestionAdapter.updateLifecycle(id, { reviewStatus }, { actingUserSystemId });
      }
      return res.status(200).json({ success: true, message: `Updated ${suggestionIds.length} reviewers` });
    }

    if (!suggestionId) {
      return res.status(400).json({ error: 'suggestionId, suggestionIds, or proposalId is required' });
    }
    // GUID-validate before updateLifecycle (record-id selector interpolated raw).
    if (!isGuid(suggestionId)) {
      return res.status(400).json({ error: 'suggestionId is not a valid GUID' });
    }

    const lifecycle = {};
    if (reviewStatus !== undefined) lifecycle.reviewStatus = reviewStatus;
    if (notes !== undefined) lifecycle.notes = notes;

    // Note: the reviewStatus=complete close-out stamps (wmkf_completedat +
    // wmkf_reviewreceivedat) and the applicant-excluded fail-closed guard are
    // handled centrally in the adapter's updateLifecycle, so EVERY complete
    // path (single, batch below, thank-you send) is covered uniformly.

    if (Object.keys(lifecycle).length === 0) {
      return res.status(400).json({ error: 'No supported fields to update' });
    }

    await suggestionAdapter.updateLifecycle(suggestionId, lifecycle, { actingUserSystemId });
    return res.status(200).json({ success: true, message: 'Reviewer updated' });
  } catch (error) {
    console.error('Review Manager PATCH error:', error);
    return res.status(500).json({
      error: 'Failed to update reviewer',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
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

async function fetchPotentialReviewers(ids) {
  if (!ids?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const orChain = chunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const { records } = await queryReviewers({
      select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_organizationname',
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

// S213 appresearcher collapse: bibliometrics now live on the person, not the
// wmkf_appresearcher sidecar. Query the person rows (keyed by id) so downstream
// `researcher?.X` reads resolve against the same person record.
async function fetchResearchersByPerson(personIds) {
  if (!personIds?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const chunk = personIds.slice(i, i + CHUNK);
    const orChain = chunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const { records } = await queryReviewers({
      select: 'wmkf_potentialreviewersid,wmkf_primaryaffiliation,wmkf_website,wmkf_hindex,wmkf_totalcitations',
      filter: orChain,
      top: 500,
    });
    for (const r of records) out[r.wmkf_potentialreviewersid] = r;
  }
  return out;
}
