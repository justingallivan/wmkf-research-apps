/**
 * Reviewer Finder — my-candidates service (P1m multi-verb pilot)
 * (Route→Service Consolidation Plan, Stage 3 wave, Decision 1 multi-verb;
 * Reviewer Lifecycle Stage 3D partial-file extraction).
 *
 * Holds the business logic for /api/reviewer-finder/my-candidates as ONE
 * METHOD PER HTTP VERB — the route shell dispatches and calls exactly one —
 * except the per-suggestion response-correction path, which lives in
 * `reviewer-engagement/correct-response.js` (Stage 3D):
 *   - getMyCandidates    — saved candidates grouped by request (default PD
 *     scope, requestId/requestNumber collaborator overrides, cycleCode
 *     narrowing, mode=proposals distinct-request list) + the GET-only
 *     hydration helpers;
 *   - patchMyCandidates  — dispatches bulk-by-request updates, restore,
 *     manual-invite-sent recording, and person/researcher edits here, incl.
 *     the duplicate-email 409 partial-success + savedFields semantics and
 *     conflicting-owner lookup; the per-suggestion response-correction path
 *     (the approved lifecycle write plus its nonfatal accepted-token
 *     follow-up) is delegated to `reviewer-engagement/correct-response.js`,
 *     and the manual-invite-sent write itself is delegated to
 *     `reviewer-engagement/record-invitation.js` (Stage 3F) — the guards,
 *     412→`stale_manual_link` mapping, and response envelope stay here;
 *   - deleteMyCandidates — atomic soft-delete (unselect + token revoke).
 *
 * `MyCandidatesError` is a compatibility re-export of the neutral leaf
 * `reviewer-engagement/errors.js` (Stage 3D correction round) — imported
 * directly rather than through `correct-response.js` so this file doesn't
 * pull in that module's adapter/token-lifecycle dependencies just for the
 * error class; `instanceof` and reference identity (`toBe`) hold across all
 * three import paths (`errors.js`, `correct-response.js`, this file).
 *
 * NO SHARED MUTABLE STATE between the three methods (verified at
 * decomposition: they share only imported adapters and pure helpers), so
 * they can move independently later if ever split.
 *
 * Contract (plan Decision 3): plain args, never req/res; domain failures
 * throw MyCandidatesError (extends ServiceHttpError) — explicit `body` for
 * the non-`{ error }` envelopes (PATCH bulk rejected-fields 400, the 409
 * duplicate-key payload, proposals-mode sanitized 500); unexpected failures
 * propagate untyped for the shell's per-verb historical 500 envelopes;
 * ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * No per-user filtering at the row level: Dataverse data is org-visible.
 * The default GET scope is a UX convenience layered on top.
 */

import { isGuid } from '../../utils/guid';
import { resolveByEmail as resolvePD } from '../program-director-resolver';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../utils/cycle-code';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../../dataverse/adapters/researcher';
import { getById as getRequestById, findByRequestNumber } from '../../dataverse/adapters/grant-request';
import { queryAccounts } from '../../dataverse/adapters/account';
import { buildExternalUrl } from '../../external/token-lifecycle';
import { hashToken } from '../external-token';
import { ContactParser } from '../../utils/contact-parser';
import { translateDuplicateKeyError } from '../../dataverse/duplicate-key';
import { ServiceHttpError } from '../service-http-error';
import { chunk as chunked } from '../../utils/chunk.js';
import { parseAddressTrustState } from '../../utils/reviewer-address-trust';
import { parseReferredByReason } from '../../utils/reviewer-provenance';
import { resolveEffectiveReviewDueDate } from '../../external/reviewer-due-date.js';
import { correctResponse } from '../reviewer-engagement/correct-response';
import { recordManualInvitation } from '../reviewer-engagement/record-invitation';
import { MyCandidatesError } from '../reviewer-engagement/errors';

/**
 * Compatibility re-export. The class lives in the neutral leaf
 * `lib/services/reviewer-engagement/errors.js` (Stage 3D correction round).
 * This module re-exports the same object — `instanceof` and reference
 * identity (`toBe`) hold across all three import paths.
 */
export { MyCandidatesError };

function manualInviteError(message, code) {
  return new MyCandidatesError(message, 409, { error: message, code });
}

function tokenFromOfficialManualLink(manualLink) {
  if (typeof manualLink !== 'string' || !manualLink) {
    throw new MyCandidatesError('A secure invitation link is required', 400);
  }
  let parsed;
  try {
    parsed = new URL(manualLink);
  } catch {
    throw new MyCandidatesError('The secure invitation link is invalid', 400);
  }
  const match = parsed.pathname.match(/^\/external\/review\/([^/]+)$/);
  const token = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!token || buildExternalUrl(token) !== manualLink) {
    throw new MyCandidatesError('The secure invitation link is invalid', 400);
  }
  return token;
}

const REQUEST_FIELDS = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  'wmkf_reviewduedate',
  'wmkf_abstract',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  '_wmkf_programareaserved_value',
  '_wmkf_programdirector_value',
];

function projectRequest(r) {
  if (!r) return null;
  return {
    requestId: r.akoya_requestid,
    requestNumber: r.akoya_requestnum,
    title: r.akoya_title || null,
    abstract: r.wmkf_abstract || null,
    meetingDate: r.wmkf_meetingdate || null,
    reviewDeadline: r.wmkf_reviewduedate || null,
    cycleCode: r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null,
    cycleLabel: r.wmkf_meetingdate ? cycleCodeToLabel(meetingDateToCycleCode(r.wmkf_meetingdate)) : null,
    applicantId: r._akoya_applicantid_value || null,
    applicant: r._akoya_applicantid_value_formatted || null,
    projectLeader: r._wmkf_projectleader_value_formatted || null,
    grantProgram: r._wmkf_grantprogram_value_formatted || null,
    programArea: r._wmkf_programareaserved_value_formatted || null,
    programDirectorId: r._wmkf_programdirector_value || null,
  };
}

// ───────── GET ─────────

/**
 * Saved candidates grouped by request, or (mode=proposals) the distinct
 * request list for picker modals.
 *
 * @param {Object} args - mode, requestId (GUID, shell-validated in default
 *   mode), requestNumber, cycleCode, azureEmail
 * @returns {Promise<Object>} the exact 200 payload
 * @throws {MyCandidatesError} 500 sanitized proposals-mode failure
 */
export async function getMyCandidates({ mode, requestId, requestNumber, cycleCode, azureEmail }) {
  if (mode === 'proposals') {
    return proposalsList({ cycleCode, azureEmail });
  }

  let suggestions = [];
  let requestById = {};
  // Inactive candidates (staff-removed or declined) — only fetched in the
  // single-request path (the Candidates panel's scope). Attached to the proposal
  // as `removedCandidates`.
  let removedRows = [];

  if (requestId || requestNumber) {
    const request = await fetchRequestByIdOrNumber({ requestId, requestNumber });
    if (!request) {
      return { success: true, proposals: [], totalCandidates: 0 };
    }
    requestById = { [request.requestId]: request };
    const rows = await suggestionAdapter.findByRequest(request.requestId, { selectedOnly: true });
    suggestions = rows;
    removedRows = await suggestionAdapter.findRemovedByRequest(request.requestId);
  } else {
    const pd = await resolvePD(azureEmail);
    if (!pd?.systemuserid) {
      return { success: true, proposals: [], totalCandidates: 0, programDirector: null };
    }
    const result = await suggestionAdapter.findByPD(pd.systemuserid, { cycleCode });
    suggestions = result.suggestions;
    requestById = result.requestById;
  }

  if (suggestions.length === 0 && removedRows.length === 0) {
    return { success: true, proposals: [], totalCandidates: 0 };
  }

  // Hydrate person + researcher rows for every distinct potentialreviewer ID
  // referenced by the suggestions, plus AKA/name for the applicant accounts
  // on the in-scope requests. One batched query each.
  const personIds = [...new Set(suggestions.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const accountIds = [...new Set(Object.values(requestById).map((r) => r.applicantId).filter(Boolean))];
  const [personById, akaByAccount, reviewHistoryByPerson] = await Promise.all([
    fetchPotentialReviewers(personIds),
    fetchApplicantAkas(accountIds),
    // S308 review-history: prior reviews completed (received) per person, across
    // every request, so the PD can see "reviewed N times, last <date>" before inviting.
    // Supplementary — a history-query failure must NOT take down the candidate list,
    // so it degrades to no history rather than rejecting the Promise.all.
    suggestionAdapter.aggregateReviewHistory(personIds).catch((err) => {
      console.warn('[my-candidates] review-history aggregation failed (non-fatal):', err?.message || err);
      return {};
    }),
  ]);

  // Group by request
  const byRequest = {};
  for (const s of suggestions) {
    const reqId = s._wmkf_request_value;
    const request = requestById[reqId];
    if (!request) continue; // suggestion's request wasn't in scope
    if (!byRequest[reqId]) {
      byRequest[reqId] = {
        proposalId: request.requestId,
        proposalTitle: request.title || `Request ${request.requestNumber || ''}`.trim(),
        proposalAbstract: request.abstract,
        proposalAuthors: request.projectLeader || request.applicant,
        // Institution: prefer the account's AKA (the human-friendly common
        // name shown on the AkoyaGO org form — e.g. "Stanford University"
        // vs the legal `name` "The Board of Trustees of the Leland Stanford
        // Junior University"). Fall back to the formal name when AKA is
        // blank. Read-only — edits belong on the account record in CRM.
        proposalInstitution: (request.applicantId && akaByAccount[request.applicantId])
          || request.applicant || null,
        requestNumber: request.requestNumber,
        programArea: request.programArea,
        // grantCycleCode: prefer suggestion-level wmkf_grantcyclecode
        // when populated (the picker writes this via setRequestMetadata,
        // a sequential per-row update); fall back to the
        // request's meeting-date-derived cycleCode.
        // Closes Codex S147 step-5 review Q6 (picker edits now visible
        // on refresh instead of reverting to meeting-date value).
        grantCycleCode: s.wmkf_grantcyclecode || request.cycleCode,
        grantCycleLabel: request.cycleLabel,
        meetingDate: request.meetingDate,
        reviewDeadline: request.reviewDeadline,
        summaryBlobUrl: s.wmkf_summarybloburl || null,
        candidates: [],
      };
    } else {
      if (!byRequest[reqId].grantCycleCode && s.wmkf_grantcyclecode) {
        // First suggestion was null; pick up later non-null suggestion-level
        // override (defensive — bulkUpdate writes all at once but be safe).
        byRequest[reqId].grantCycleCode = s.wmkf_grantcyclecode;
      }
      if (!byRequest[reqId].summaryBlobUrl && s.wmkf_summarybloburl) {
        // Same defensive pattern: summaryBlobUrl is written per-suggestion
        // at save-candidates time. All suggestions for a given proposal
        // should carry the same URL, but pick up the first non-null.
        byRequest[reqId].summaryBlobUrl = s.wmkf_summarybloburl;
      }
    }
    const person = personById[s._wmkf_potentialreviewer_value] || {};
    const researcher = personById[s._wmkf_potentialreviewer_value] || null;
    const facultyPageUrl = researcher?.wmkf_facultypageurl && !ContactParser.isDocumentUrl(researcher.wmkf_facultypageurl)
      ? researcher.wmkf_facultypageurl
      : null;
    const sources = typeof s.wmkf_sources === 'string'
      ? s.wmkf_sources.split(',').map((x) => x.trim()).filter(Boolean)
      : (s.wmkf_sources || []);
    // S249: a referral persists `referred` in wmkf_sources; the referrer lives in the
    // match-reason line 1 ("Referred by {name}."). Reconstruct referredBy so the client's
    // buildReviewerProvenance re-derives kind `referred` (label + ranking + selectable-exempt)
    // rather than degrading to barred_parametric on reload.
    const referredBy = sources.includes('referred')
      ? parseReferredByReason(s.wmkf_matchreason)
      : null;
    byRequest[reqId].candidates.push({
      suggestionId: s.wmkf_appreviewersuggestionid,
      potentialReviewerId: s._wmkf_potentialreviewer_value || null,
      name: person.wmkf_name || null,
      affiliation: researcher?.wmkf_primaryaffiliation || person.wmkf_organizationname || null,
      // S308 board-writeup identity (person-level confirmed). Surfaced so clicking a
      // reviewer in the workbench shows + edits them.
      academicRank: person.wmkf_academicrank || null,
      primaryDepartment: person.wmkf_primarydepartment || null,
      mainInstitution: person.wmkf_maininstitution || null,
      email: person.wmkf_emailaddress || null,
      website: researcher?.wmkf_website || null,
      // Slice F (zero-SSRF email recovery): surface the persisted faculty-page URL so staff
      // can open it, read the reviewer's real address, and enter it via the manual edit
      // (which stamps emailSource='manual' → quick-check acknowledgement). The more
      // specific faculty-page link; `website` is the fallback.
      facultyPageUrl,
      // Scholar / ORCID profile URLs persisted on the bibliometric sidecar.
      // Publications themselves are NOT persisted (live-only during a search),
      // so the Candidates tab links out to Scholar to view papers instead.
      googleScholarUrl: researcher?.wmkf_googlescholarurl || null,
      googleScholarId: researcher?.wmkf_googlescholarid || null,
      orcid: researcher?.wmkf_orcid || null,
      orcidUrl: researcher?.wmkf_orcidurl || null,
      keywords: researcher?.wmkf_keywords || null,
      hIndex: researcher?.wmkf_hindex ?? null,
      totalCitations: researcher?.wmkf_totalcitations ?? null,
      relevanceScore: s.wmkf_relevancescore,
      reasoning: s.wmkf_matchreason,
      sources,
      // S249: present only for referrals — drives the client's `referred` provenance
      // (kind + "Referred by X" label + grounded-rank bonus + selectable-with-verify).
      referredBy,
      // Applicant-recommended (intake/applicant-reviewer ingestion) vs.
      // staff/Claude-discovered (null disposition). Excluded rows carry
      // wmkf_selected=false and never reach this selected-only list, so the
      // meaningful flag here is just "did the applicant suggest this person".
      applicantRecommended:
        s.wmkf_applicantdisposition === suggestionAdapter.APPLICANT_DISPOSITION_MAP.recommended,
      manualAdded: sources.includes('staff_manual'),
      invited: !!s.wmkf_invited,
      accepted: !!s.wmkf_accepted,
      declined: !!s.wmkf_declined,
      notes: s.wmkf_notes || null,
      emailSentAt: s.wmkf_emailsentat || null,
      // Map the numeric optionset → the string code the finder UI compares against
      // (=== 'accepted'/'declined'/'held'/'no_response'). Emitting the raw number
      // meant every string comparison silently missed AND held had no bucket; the
      // derived RESPONSE_TYPE_BY_VALUE keeps this symmetric with the write map.
      responseType: suggestionAdapter.RESPONSE_TYPE_BY_VALUE[s.wmkf_responsetype] ?? null,
      responseReceivedAt: s.wmkf_responsereceivedat || null,
      respondReminderSentAt: s.wmkf_respondremindersentat || null,
      reviewDueDateOverride: s.wmkf_reviewduedateoverride || null,
      requestReviewDeadline: request.reviewDeadline || null,
      effectiveReviewDeadline: resolveEffectiveReviewDueDate({
        overrideDate: s.wmkf_reviewduedateoverride,
        defaultDate: request.reviewDeadline,
      }),
      savedAt: s.createdon,
      // S308 review-history: count of prior reviews this person has SUBMITTED for
      // WMKF (across all requests) + the most recent date. Derived, not stored.
      priorReviewCount: reviewHistoryByPerson[s._wmkf_potentialreviewer_value]?.reviewCount || 0,
      lastReviewAt: reviewHistoryByPerson[s._wmkf_potentialreviewer_value]?.lastReviewAt || null,
    });
  }

  const proposals = Object.values(byRequest);

  // Single-request mode: attach the request's removed candidates so the
  // Candidates panel can offer a "Removed → Restore" list. If every candidate
  // was removed, byRequest is empty — build a proposal shell from requestById
  // so the Removed list still renders.
  if ((requestId || requestNumber) && removedRows.length > 0) {
    const removedCandidates = await projectRemovedCandidates(removedRows);
    const reqId = Object.keys(requestById)[0];
    let target = proposals.find((p) => p.proposalId === reqId);
    if (!target) {
      const request = requestById[reqId];
      target = {
        proposalId: request.requestId,
        proposalTitle: request.title || `Request ${request.requestNumber || ''}`.trim(),
        requestNumber: request.requestNumber,
        candidates: [],
      };
      proposals.push(target);
    }
    target.removedCandidates = removedCandidates;
  }

  return {
    success: true,
    proposals,
    totalCandidates: suggestions.length,
  };
}

// `mode=proposals` — distinct request list, used by modals that need to assign
// a researcher to one of the user's existing proposals. Failures are sanitized
// HERE (historical behavior: this sub-branch's 500 carries no details).
async function proposalsList({ cycleCode, azureEmail }) {
  try {
    const pd = await resolvePD(azureEmail);
    if (!pd?.systemuserid) {
      return { success: true, proposals: [] };
    }
    const { requestById } = await suggestionAdapter.findByPD(pd.systemuserid, { cycleCode });
    const proposals = Object.values(requestById).map((r) => ({
      id: r.requestId,
      proposalHash: r.requestId,
      title: r.title || `Request ${r.requestNumber || ''}`.trim(),
      cycleCode: r.cycleCode,
      cycleLabel: r.cycleLabel,
      requestNumber: r.requestNumber,
      meetingDate: r.meetingDate,
    })).sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || ''));
    return { success: true, proposals };
  } catch (error) {
    console.error('Proposals list error:', error);
    throw new MyCandidatesError('Failed to fetch proposals', 500, { error: 'Failed to fetch proposals' });
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

// S213 appresearcher collapse: bibliometrics now live on the person, not the
// wmkf_appresearcher sidecar. Query the person rows (keyed by id) so downstream
// `researcher?.X` reads resolve against the same person record.
//
// Stage 2 read coalescing: this select is the UNION of the former person
// projection and the former (now-deleted) fetchResearchersByPerson
// projection — same entity, same 25-id OR-chain, disjoint field sets — so a
// single chunked read serves both the person and researcher lookups callers
// need. Every downstream-consumed field from both former lists must remain.
async function fetchPotentialReviewers(ids) {
  if (!ids?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(ids, CHUNK)) {
    const orChain = chunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const { records } = await potentialReviewerAdapter.queryReviewers({
      select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_emailsource,wmkf_organizationname,wmkf_areaofexpertise,wmkf_academicrank,wmkf_primarydepartment,wmkf_maininstitution,wmkf_primaryaffiliation,wmkf_website,wmkf_facultypageurl,wmkf_hindex,wmkf_totalcitations,wmkf_orcid,wmkf_orcidurl,wmkf_googlescholarid,wmkf_googlescholarurl,wmkf_keywords',
      filter: orChain,
      top: 500,
    });
    for (const p of records) out[p.wmkf_potentialreviewersid] = p;
  }
  return out;
}

async function fetchApplicantAkas(accountIds) {
  if (!accountIds?.length) return {};
  const out = {};
  const CHUNK = 25;
  for (const chunk of chunked(accountIds, CHUNK)) {
    const orChain = chunk.map((id) => `accountid eq ${id}`).join(' or ');
    const { records } = await queryAccounts({
      select: 'accountid,akoya_aka,name',
      filter: orChain,
      top: 500,
    });
    for (const a of records) {
      if (a.akoya_aka) out[a.accountid] = a.akoya_aka;
    }
  }
  return out;
}

// Lightweight projection for the "Removed" list — far fewer fields than an active
// candidate (no invite/lifecycle state; these rows are off the request). Does its
// own person/researcher hydration so it stays decoupled from the main grouping.
async function projectRemovedCandidates(rows) {
  if (!rows?.length) return [];
  const personIds = [...new Set(rows.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const personById = await fetchPotentialReviewers(personIds);
  return rows.map((s) => {
    const person = personById[s._wmkf_potentialreviewer_value] || {};
    const researcher = personById[s._wmkf_potentialreviewer_value] || null;
    return {
      suggestionId: s.wmkf_appreviewersuggestionid,
      potentialReviewerId: s._wmkf_potentialreviewer_value || null,
      name: person.wmkf_name || null,
      affiliation: researcher?.wmkf_primaryaffiliation || person.wmkf_organizationname || null,
      email: person.wmkf_emailaddress || null,
      emailSource: person.wmkf_emailsource || null,
      personEtag: person._etag || null,
      reasoning: s.wmkf_matchreason || null,
      googleScholarId: researcher?.wmkf_googlescholarid || null,
      orcid: researcher?.wmkf_orcid || null,
      orcidUrl: researcher?.wmkf_orcidurl || null,
      // Whether the candidate was invited before removal — restoring keeps invite
      // stamps (softDelete leaves them), but the magic link was revoked, so the UI
      // can warn that a re-invite is needed.
      wasInvited: !!s.wmkf_invited,
      declined: !!s.wmkf_declined,
      responseType: suggestionAdapter.RESPONSE_TYPE_BY_VALUE[s.wmkf_responsetype] ?? null,
      removedAt: s.modifiedon || null,
    };
  });
}

// ───────── PATCH ─────────

/**
 * Per-suggestion lifecycle/researcher/person edits, restore, explicit manual
 * invitation recording, or
 * bulk-by-request updates (programArea, grantCycleCode). PI / institution
 * edits are intentionally not supported here — those belong on
 * `akoya_request`.
 *
 * Duplicate-email partial success: conflict-SAFE person/researcher fields
 * are written FIRST and the alt-key-constrained email LAST in its own
 * PATCH, so a duplicate-email 409 reports partialSuccess + savedFields
 * (what committed) instead of looking like a total failure.
 *
 * Generic invitation/response corrections require a separately server-authorized
 * request binding and a fresh open source row. Its exact ETag protects the write;
 * conflicts stop before token follow-up or person edits, with no automatic retry.
 *
 * @param {Object} args - body (the request body), actingUserSystemId, authorizedRequestId
 * @returns {Promise<Object>} the exact 200 payload (bulk / restore / update shapes)
 * @throws {MyCandidatesError} 400 validation shapes, 404 missing linked
 *   reviewer, 409 duplicate-key payload (explicit body); other failures
 *   propagate untyped for the shell's 500
 */
export async function patchMyCandidates({ body = {}, actingUserSystemId = null, authorizedRequestId }) {
  // Tracks which person/researcher fields committed, so a duplicate-email 409
  // (which rejects only the isolated email PATCH below) can report partial success
  // instead of looking like a total failure that discarded the staffer's edits.
  const savedFields = [];
  try {
    const {
      suggestionId,
      proposalId, // request guid for bulk updates
      // Bulk fields
      grantCycleCode,
      programArea,
      // Per-suggestion lifecycle fields
      invited,
      accepted,
      declined,
      emailSentAt,
      responseType,
      responseReceivedAt,
      // Person/researcher fields
      name,
      affiliation,
      email,
      website,
      hIndex,
      // S308 board-writeup identity (person-level confirmed).
      academicRank,
      primaryDepartment,
      mainInstitution,
      emailClear,
    } = body;

    // ── Bulk by request (proposalId) ──
    if (proposalId !== undefined && suggestionId === undefined) {
      // GUID-validate before it reaches setRequestMetadata (which calls
      // findByRequest), which interpolates it raw into an OData
      // `_wmkf_request_value eq …` filter.
      if (!isGuid(proposalId)) {
        throw new MyCandidatesError('proposalId is not a valid GUID', 400);
      }
      const updates = {};
      if (grantCycleCode !== undefined) updates.grantCycleCode = grantCycleCode;
      if (programArea !== undefined) updates.programArea = programArea;

      // PI / institution edits are intentionally rejected — those live on
      // akoya_request and editing them here would create a divergent snapshot.
      const rejected = [];
      if (body.proposalAuthors !== undefined) rejected.push('proposalAuthors');
      if (body.proposalInstitution !== undefined) rejected.push('proposalInstitution');
      if (rejected.length) {
        throw new MyCandidatesError('Editing PI / institution is not supported here', 400, {
          error: 'Editing PI / institution is not supported here',
          rejectedFields: rejected,
          hint: 'These fields belong on akoya_request and are managed in CRM.',
        });
      }
      if (Object.keys(updates).length === 0) {
        throw new MyCandidatesError('No supported fields to update', 400);
      }
      const updated = await suggestionAdapter.setRequestMetadata(proposalId, updates, { actingUserSystemId });
      return {
        success: true,
        message: 'Proposal updated',
        updated: { proposalId, ...updates, suggestionsUpdated: updated },
      };
    }

    if (!suggestionId) {
      throw new MyCandidatesError('suggestionId or proposalId is required', 400);
    }
    // GUID-validate before it reaches updateLifecycle / findById (record-id
    // selectors interpolated raw into the request URL).
    if (!isGuid(suggestionId)) {
      throw new MyCandidatesError('suggestionId is not a valid GUID', 400);
    }

    // ── Restore a removed candidate (reverse the X) ──
    // Explicit flag rather than a generic `selected` field so the destructive
    // direction stays single-pathed through DELETE (atomic unselect + token
    // revoke); this only ever re-selects.
    if (body.restore === true) {
      await suggestionAdapter.restore(suggestionId, { actingUserSystemId });
      return { success: true, message: 'Candidate restored' };
    }

    // The former verifyEmailAddress action changed only wmkf_emailsource and did
    // not record evidence. Keeping it callable would bypass the versioned
    // exact-address contract. Current Find/Invite UI uses
    // /api/workbench/reviewer-address-trust instead.
    if (body.verifyEmailAddress === true) {
      throw new MyCandidatesError(
        'Address verification now requires an evidence link. Use Verify address in Find or Invite.',
        409,
        {
          error: 'Address verification now requires an evidence link. Use Verify address in Find or Invite.',
          code: 'address_verification_moved',
          remediation: [{ action: 'verify_person_and_address', label: 'Verify person and address' }],
        },
      );
    }

    // ── Record a staff-sent invitation that used the secure-link fallback ──
    // This is deliberately a separate, confirmed action from copying the link:
    // clipboard access is not proof that an email was sent. The submitted link
    // must be the exact currently-active official link. An ETag-conditional
    // lifecycle write then closes the race where another preview replaces the
    // token after this read but before the invited stamp lands.
    if (body.markManualInviteSent === true) {
      const token = tokenFromOfficialManualLink(body.manualLink);
      const suggestion = await suggestionAdapter.findById(suggestionId);
      if (!suggestion?._etag) {
        throw manualInviteError(
          'Could not verify the current invitation link. Refresh the candidates and try again.',
          'manual_invite_state_unavailable',
        );
      }
      if (suggestion.wmkf_selected !== true) {
        throw manualInviteError('This reviewer is no longer selected for invitation.', 'candidate_not_selected');
      }
      if (suggestion.wmkf_invited === true || suggestion.wmkf_emailsentat) {
        throw manualInviteError('This reviewer is already recorded as invited.', 'already_invited');
      }
      if (suggestion.wmkf_accepted === true || suggestion.wmkf_declined === true || suggestion.wmkf_responsetype != null) {
        throw manualInviteError('This reviewer has already responded and cannot be marked as newly invited.', 'already_responded');
      }
      const expiresAt = Date.parse(suggestion.wmkf_externaltokenexpires || '');
      if (
        !suggestion.wmkf_externaltokenhash
        || suggestion.wmkf_externaltokenrevoked === true
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now()
        || hashToken(token) !== suggestion.wmkf_externaltokenhash
      ) {
        throw manualInviteError(
          'This secure link is no longer current. Reopen the invitation preview and copy the newest link.',
          'stale_manual_link',
        );
      }

      const emailSentAt = new Date().toISOString();
      try {
        await recordManualInvitation({
          suggestionId,
          emailSentAt,
          ifMatch: suggestion._etag,
          actingUserSystemId,
        });
      } catch (error) {
        if (error?.status === 412) {
          throw manualInviteError(
            'The invitation changed while you were recording it. Reopen the preview and use the newest link.',
            'stale_manual_link',
          );
        }
        throw error;
      }
      return {
        success: true,
        message: 'Manual invitation recorded',
        updated: { suggestionId, invited: true, emailSentAt },
        manualInviteRecorded: true,
      };
    }

    // ── Per-suggestion ──
    const lifecycle = {};
    if (invited !== undefined) lifecycle.invited = invited;
    if (accepted !== undefined) lifecycle.accepted = accepted;
    if (declined !== undefined) lifecycle.declined = declined;
    if (emailSentAt !== undefined) {
      lifecycle.emailSentAt = emailSentAt === 'now' ? new Date().toISOString() : emailSentAt;
    }
    if (responseType !== undefined) lifecycle.responseType = responseType;
    if (responseReceivedAt !== undefined) {
      lifecycle.responseReceivedAt = responseReceivedAt === 'now' ? new Date().toISOString() : responseReceivedAt;
    }
    const hasLifecycle = Object.keys(lifecycle).length > 0;
    const hasResearcher = name !== undefined || affiliation !== undefined || email !== undefined ||
      website !== undefined || hIndex !== undefined ||
      academicRank !== undefined || primaryDepartment !== undefined || mainInstitution !== undefined;

    if (!hasLifecycle && !hasResearcher) {
      throw new MyCandidatesError('No supported fields to update', 400);
    }

    if (hasLifecycle) {
      // Approved response-only correction path (Stage 3D): lifecycle write
      // (authorized-request GUID guard, applicant-exclusion / closed-
      // engagement / invitation-correction-source / concrete-ETag checks,
      // then the ETag-conditional updateLifecycle) followed by the nonfatal
      // accepted-token follow-up. See `reviewer-engagement/correct-response.js`.
      await correctResponse({ suggestionId, lifecycle, authorizedRequestId, actingUserSystemId });
    }

    // For person/researcher edits we need the linked potentialreviewer + researcher IDs.
    if (hasResearcher) {
      const sug = await suggestionAdapter.findById(suggestionId);
      const personId = sug?._wmkf_potentialreviewer_value;
      if (!personId) {
        throw new MyCandidatesError('Linked potential reviewer not found for this suggestion', 404);
      }

      // Email is the only alt-key-constrained field here (wmkf_emailaddress_unique),
      // so a duplicate email is what 409s. Write the conflict-SAFE fields FIRST and
      // isolate the email write LAST, so a collision can't roll back the staffer's
      // affiliation/website/h-index edits (which would otherwise be silently lost
      // when the modal flips to merge mode). `savedFields` records what committed so
      // the 409 below can report partial success rather than total failure.
      const personUpdates = {};
      if (name !== undefined) personUpdates.name = name;
      if (affiliation !== undefined) personUpdates.affiliation = affiliation;
      // S308 board-writeup identity — reviewer/staff-confirmed person fields (own
      // columns, never the enrichment affiliation/department). Server-derived personId
      // only; no client→selector path (mirrors name/affiliation).
      if (academicRank !== undefined) personUpdates.academicRank = academicRank;
      if (primaryDepartment !== undefined) personUpdates.primaryDepartment = primaryDepartment;
      if (mainInstitution !== undefined) personUpdates.mainInstitution = mainInstitution;
      if (Object.keys(personUpdates).length > 0) {
        await potentialReviewerAdapter.update(personId, personUpdates, { actingUserSystemId });
      }
      if (name !== undefined) savedFields.push('name');
      if (affiliation !== undefined) savedFields.push('affiliation');
      if (academicRank !== undefined) savedFields.push('academicRank');
      if (primaryDepartment !== undefined) savedFields.push('primaryDepartment');
      if (mainInstitution !== undefined) savedFields.push('mainInstitution');

      // Bibliometric edits go straight onto the person now (S213 collapse —
      // updateById takes the person id; email is identity, handled separately
      // below). NOTE (Phase 2): this PATCH is a MANUAL STAFF EDIT and is
      // intentionally NOT resolver-gated — a human correcting a record is the
      // authority (the identity resolver's human-in-the-loop override). Automated
      // enrichment paths (save-candidates / enrich-recommended / saveToDatabase)
      // ARE gated; staff hand-edits are not, by design.
      const researcherUpdates = {};
      if (affiliation !== undefined) researcherUpdates.affiliation = affiliation;
      if (website !== undefined) researcherUpdates.website = website;
      if (hIndex !== undefined) researcherUpdates.hIndex = hIndex;
      if (Object.keys(researcherUpdates).length > 0) {
        await researcherAdapter.updateById(personId, researcherUpdates, { actingUserSystemId });
      }
      if (website !== undefined) savedFields.push('website');
      if (hIndex !== undefined) savedFields.push('hIndex');

      // Email LAST, in its OWN PATCH. A duplicate-key 409 here leaves everything
      // above already committed (→ partialSuccess). Slice G — the address and its
      // manual provenance are written TOGETHER (S387 adversarial review finding 3):
      // as two calls, an address that landed while the source write failed left the
      // row describing the NEW address under the OLD source, which the send gate
      // could read as `ready` and send without an acknowledgement. One PATCH means a
      // rejected address takes its provenance with it. The manual source makes the
      // invite step require a quick-check acknowledgement (this path bypasses the
      // Fix-C enrichment gate, so it's unverified against the reviewer's identity
      // until a human confirms it at send).
      if (email !== undefined) {
        const currentPerson = await potentialReviewerAdapter.getById(personId);
        const currentTrust = parseAddressTrustState(currentPerson?.wmkf_addresstruststatejson, {
          storedEmail: currentPerson?.wmkf_emailaddress,
        });
        if (currentTrust.valid && currentTrust.state.status === 'conflict_pending') {
          const message = 'Resolve the pending address conflict in the invitation preview before editing this email.';
          throw new MyCandidatesError(message, 409, {
            error: message,
            message,
            code: 'address_conflict_pending',
            partialSuccess: savedFields.length > 0,
            savedFields,
            remediation: [
              { action: 'resolve_address_conflict', label: 'Open the invitation preview and record the verified address' },
              { action: 'create_repair_request', label: 'Create a repair request if neither address is safe' },
            ],
          });
        }
        if (typeof email === 'string' && email.trim()) {
          if (!currentPerson?._etag) {
            const message = 'The reviewer version could not be confirmed. Reload before editing this address.';
            throw new MyCandidatesError(message, 409, {
              error: message,
              message,
              code: 'candidate_stale',
              partialSuccess: savedFields.length > 0,
              savedFields,
              remediation: [{ action: 'reload_candidate', label: 'Reload the reviewer and review the current address' }],
            });
          }
          try {
            await potentialReviewerAdapter.update(personId, { email, emailSource: 'manual' }, {
              actingUserSystemId,
              ifMatch: currentPerson._etag,
            });
          } catch (error) {
            if (translateDuplicateKeyError(error)) throw error;
            if (error?.status === 412) {
              const message = 'The reviewer changed while this address was being edited. Reload and review the current address.';
              throw new MyCandidatesError(message, 409, {
                error: message,
                message,
                code: 'candidate_stale',
                partialSuccess: savedFields.length > 0,
                savedFields,
                remediation: [{ action: 'reload_candidate', label: 'Reload the reviewer and review the current address' }],
              });
            }
            throw error;
          }
        } else {
          await potentialReviewerAdapter.clearEmailForEdit(personId, emailClear, { actingUserSystemId });
        }
        savedFields.push('email');
      }
    }

    return {
      success: true,
      message: 'Candidate updated',
      updated: { suggestionId, ...lifecycle, ...(hasResearcher && { name, affiliation, email, website, hIndex, academicRank, primaryDepartment, mainInstitution }) },
    };
  } catch (error) {
    // Typed domain errors above pass straight through to the shell mapping.
    if (error instanceof ServiceHttpError) throw error;
    if (error?.code === 'contact_clear_evidence_required' || error?.code === 'contact_clear_conflict') {
      throw new MyCandidatesError(error.message, error.status || 409, {
        error: error.message,
        code: error.code,
      });
    }
    // Translate Dataverse alternate-key violations (412 on a unique field
    // like wmkf_emailaddress) into a meaningful 409. The raw error is a
    // long XML-laden 412 that the client surfaces as an opaque 500;
    // staff need to know which existing row is holding the conflicting
    // value so they can decide whether to merge or pick a different email.
    const translated = translateDuplicateKeyError(error);
    if (translated) {
      // The 412 carries the duplicate field/value but NOT the conflicting record's
      // id (verified S290 chunk-5: the error's DuplicateEntity is the row being
      // written; the existing owner is absent). Resolve the owner by the duplicate
      // email so chunk-4 merge mode gets the RIGHT loser. Ambiguity-aware: only
      // attach conflictingRecordId for a single ACTIVE owner — a none/ambiguous/
      // inactive/lookup-failed result returns null so the modal shows the
      // duplicate-key message WITHOUT auto-opening a misdirected merge.
      let conflictingRecordId = null;
      if (translated.field === 'wmkf_emailaddress' && translated.value) {
        try {
          const match = await potentialReviewerAdapter.findByEmailCandidates(translated.value);
          // Fail-closed: only attach for a single owner whose statecode is an
          // explicit Active (0). A missing statecode suppresses merge mode rather
          // than risking a misdirected merge (Codex S290 post-impl V2/V5).
          if (match.one && typeof match.row?.statecode === 'number' && match.row.statecode === 0) {
            conflictingRecordId = match.id;
          }
        } catch (lookupErr) {
          console.warn('[my-candidates] conflicting-owner lookup failed:', lookupErr.message);
        }
      }
      // The reorder above writes the conflict-safe fields BEFORE the isolated email
      // PATCH, so a duplicate-email 409 typically lands with those already saved.
      // Report that (partialSuccess + savedFields) so the modal can tell the staffer
      // their affiliation/website/etc. persisted and only the email needs resolving.
      const payload = { ...translated, conflictingRecordId, partialSuccess: savedFields.length > 0, savedFields };
      console.warn('[my-candidates] duplicate-key on update:', payload);
      throw new MyCandidatesError(translated.message || 'duplicate key', 409, payload);
    }
    throw error;
  }
}

// ───────── DELETE ─────────

/**
 * Soft-delete a single suggestion. Server-authoritative removal (Codex S213
 * BUG-1 + BUG-3 fix): unselect the row AND revoke any magic link in ONE
 * atomic PATCH (wmkf_selected=false + wmkf_externaltokenrevoked=true). A
 * single write means there's no two-step window where the row could end up
 * revoked-but-still-selected (or unselected-but-link-live) on a partial
 * failure. Harmless on a never-invited candidate (no token → just sets a
 * bool); throws (→ shell 500) only if the row is missing, so the caller
 * keeps the row rather than silently "removing" a nonexistent one. Doing
 * this server-side means removal never relies on a stale client-cached
 * tokenState, closing the concurrent-regeneration race.
 *
 * @param {Object} args - suggestionId (GUID, shell-validated), actingUserSystemId
 * @returns {Promise<{ success: true, message: 'Candidate removed' }>}
 */
export async function deleteMyCandidates({ suggestionId, actingUserSystemId = null }) {
  await suggestionAdapter.softDelete(suggestionId, { actingUserSystemId, alsoRevokeToken: true });
  return { success: true, message: 'Candidate removed' };
}
