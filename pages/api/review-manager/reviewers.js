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
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { resolveByEmail as resolvePD } from '../../../lib/services/program-director-resolver';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../../lib/utils/cycle-code';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';

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

const RESPONSE_TYPE_BY_VALUE = {
  100000000: 'accepted',
  100000001: 'declined',
  100000002: 'no_response',
};

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
        reminderSentAt: s.wmkf_remindersentat || null,
        reminderCount: s.wmkf_remindercount ?? 0,
        reviewReceivedAt: s.wmkf_reviewreceivedat || null,
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
        // Structured review form values (numeric picklist or null)
        reviewerAffiliation: s.wmkf_revieweraffiliation || null,
        reviewerImpact: s.wmkf_reviewerimpact ?? null,
        reviewerRisk: s.wmkf_reviewerrisk ?? null,
        reviewerOverallRating: s.wmkf_revieweroverallrating ?? null,
      });
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
      for (const id of suggestionIds) {
        await suggestionAdapter.updateLifecycle(id, { reviewStatus }, { actingUserSystemId });
      }
      return res.status(200).json({ success: true, message: `Updated ${suggestionIds.length} reviewers` });
    }

    if (!suggestionId) {
      return res.status(400).json({ error: 'suggestionId, suggestionIds, or proposalId is required' });
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
      const r = await DynamicsService.getRecord('akoya_requests', requestId, { select: REQUEST_FIELDS.join(',') });
      return projectRequest(r);
    } catch (e) {
      return null;
    }
  }
  if (requestNumber) {
    const safe = String(requestNumber).replace(/'/g, "''");
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: REQUEST_FIELDS.join(','),
      filter: `akoya_requestnum eq '${safe}'`,
      top: 1,
    });
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
    const { records } = await DynamicsService.queryRecords('wmkf_potentialreviewerses', {
      select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_organizationname',
      filter: orChain,
      top: 500,
    });
    for (const p of records) out[p.wmkf_potentialreviewersid] = p;
  }
  return out;
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
    const { records } = await DynamicsService.queryRecords('wmkf_potentialreviewerses', {
      select: 'wmkf_potentialreviewersid,wmkf_primaryaffiliation,wmkf_website,wmkf_hindex,wmkf_totalcitations',
      filter: orChain,
      top: 500,
    });
    for (const r of records) out[r.wmkf_potentialreviewersid] = r;
  }
  return out;
}
