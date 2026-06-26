/**
 * API Route: /api/reviewer-finder/my-candidates  (Dataverse-backed)
 *
 * GET    — Saved candidates grouped by request.
 *           Default scope: requests where the authenticated user is the lead
 *           Program Director (`akoya_request._wmkf_programdirector_value`).
 *           Overrides:
 *             ?requestId=<guid>      collaborator lookup, ignores PD filter
 *             ?requestNumber=<num>   same, by request number
 *             ?cycleCode=Jxx|Dxx     narrow within PD scope
 *             mode=proposals         distinct request list (for picker modals)
 *
 * PATCH  — Per-suggestion lifecycle/researcher/person edits, or bulk-by-request
 *           updates (programArea, grantCycleCode). PI / institution edits are
 *           intentionally not supported here — those belong on `akoya_request`.
 *
 * DELETE — Soft-delete a single suggestion (sets wmkf_selected = false).
 *
 * No per-user filtering at the row level: Dataverse data is org-visible. The
 * default GET scope is a UX convenience layered on top.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { resolveByEmail as resolvePD } from '../../../lib/services/program-director-resolver';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../../lib/utils/cycle-code';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../../../lib/dataverse/adapters/researcher';
import { ensureToken } from '../../../lib/external/token-lifecycle';
import { ContactParser } from '../../../lib/utils/contact-parser';
import { translateDuplicateKeyError } from '../../../lib/dataverse/duplicate-key';

const REQUEST_FIELDS = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
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

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  // Trusted internal endpoint — no field/table masking applies.
  return bypassDynamicsRestrictions('my-candidates', async () => {
    if (req.method === 'GET') return handleGet(req, res, access);
    if (req.method === 'PATCH') return handlePatch(req, res, access);
    if (req.method === 'DELETE') return handleDelete(req, res, access);
    return res.status(405).json({ error: 'Method not allowed' });
  });
}

// ───────── GET ─────────

async function handleGet(req, res, access) {
  try {
    const { mode, requestId, requestNumber, cycleCode } = req.query;

    if (mode === 'proposals') {
      return handleProposalsList(req, res, access, { cycleCode });
    }

    // GUID-validate requestId before it becomes a Dataverse selector
    // (fetchRequestByIdOrNumber → getRecord). requestNumber is a string lookup,
    // escaped at its own filter.
    if (requestId && !isGuid(requestId)) {
      return res.status(400).json({ error: 'requestId is not a valid GUID' });
    }

    let suggestions = [];
    let requestById = {};
    // Removed ("X'd") candidates — only fetched in the single-request path (the
    // Candidates panel's scope). Attached to the proposal as `removedCandidates`.
    let removedRows = [];

    if (requestId || requestNumber) {
      const request = await fetchRequestByIdOrNumber({ requestId, requestNumber });
      if (!request) {
        return res.status(200).json({ success: true, proposals: [], totalCandidates: 0 });
      }
      requestById = { [request.requestId]: request };
      const rows = await suggestionAdapter.findByRequest(request.requestId, { selectedOnly: true });
      suggestions = rows;
      removedRows = await suggestionAdapter.findRemovedByRequest(request.requestId);
    } else {
      const pd = await resolvePD(access.session?.user?.azureEmail);
      if (!pd?.systemuserid) {
        return res.status(200).json({ success: true, proposals: [], totalCandidates: 0, programDirector: null });
      }
      const result = await suggestionAdapter.findByPD(pd.systemuserid, { cycleCode });
      suggestions = result.suggestions;
      requestById = result.requestById;
    }

    if (suggestions.length === 0 && removedRows.length === 0) {
      return res.status(200).json({ success: true, proposals: [], totalCandidates: 0 });
    }

    // Hydrate person + researcher rows for every distinct potentialreviewer ID
    // referenced by the suggestions, plus AKA/name for the applicant accounts
    // on the in-scope requests. One batched query each.
    const personIds = [...new Set(suggestions.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
    const accountIds = [...new Set(Object.values(requestById).map((r) => r.applicantId).filter(Boolean))];
    const [personById, researcherByPerson, akaByAccount] = await Promise.all([
      fetchPotentialReviewers(personIds),
      fetchResearchersByPerson(personIds),
      fetchApplicantAkas(accountIds),
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
          // when populated (the picker writes this via bulkUpdateByRequest);
          // fall back to the request's meeting-date-derived cycleCode.
          // Closes Codex S147 step-5 review Q6 (picker edits now visible
          // on refresh instead of reverting to meeting-date value).
          grantCycleCode: s.wmkf_grantcyclecode || request.cycleCode,
          grantCycleLabel: request.cycleLabel,
          meetingDate: request.meetingDate,
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
      const researcher = researcherByPerson[s._wmkf_potentialreviewer_value] || null;
      const facultyPageUrl = researcher?.wmkf_facultypageurl && !ContactParser.isDocumentUrl(researcher.wmkf_facultypageurl)
        ? researcher.wmkf_facultypageurl
        : null;
      const sources = typeof s.wmkf_sources === 'string'
        ? s.wmkf_sources.split(',').map((x) => x.trim()).filter(Boolean)
        : (s.wmkf_sources || []);
      // S249: a referral persists `referred` in wmkf_sources; the referrer lives in the
      // match-reason prefix ("Referred by {name}."). Reconstruct referredBy so the client's
      // buildReviewerProvenance re-derives kind `referred` (label + ranking + selectable-exempt)
      // rather than degrading to barred_parametric on reload.
      const referredMatch = sources.includes('referred')
        ? String(s.wmkf_matchreason || '').match(/^Referred by (.+?)\.(?:\s|$)/)
        : null;
      const referredBy = referredMatch ? referredMatch[1].trim() : null;
      byRequest[reqId].candidates.push({
        suggestionId: s.wmkf_appreviewersuggestionid,
        potentialReviewerId: s._wmkf_potentialreviewer_value || null,
        name: person.wmkf_name || null,
        affiliation: researcher?.wmkf_primaryaffiliation || person.wmkf_organizationname || null,
        email: person.wmkf_emailaddress || null,
        website: researcher?.wmkf_website || null,
        // Slice F (zero-SSRF email recovery): surface the persisted faculty-page URL so staff
        // can open it, read the reviewer's real address, and enter it via the manual edit
        // (which stamps emailSource='manual' → Slice-G confirm-before-invite). The more
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
        savedAt: s.createdon,
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

    return res.status(200).json({
      success: true,
      proposals,
      totalCandidates: suggestions.length,
    });
  } catch (error) {
    console.error('Get my candidates error:', error);
    return res.status(500).json({
      error: 'Failed to fetch candidates',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

// `mode=proposals` — distinct request list, used by modals that need to assign
// a researcher to one of the user's existing proposals.
async function handleProposalsList(req, res, access, { cycleCode }) {
  try {
    const pd = await resolvePD(access.session?.user?.azureEmail);
    if (!pd?.systemuserid) {
      return res.status(200).json({ success: true, proposals: [] });
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
    return res.status(200).json({ success: true, proposals });
  } catch (error) {
    console.error('Proposals list error:', error);
    return res.status(500).json({ error: 'Failed to fetch proposals' });
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
      select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_organizationname,wmkf_areaofexpertise',
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
  for (let i = 0; i < accountIds.length; i += CHUNK) {
    const chunk = accountIds.slice(i, i + CHUNK);
    const orChain = chunk.map((id) => `accountid eq ${id}`).join(' or ');
    const { records } = await DynamicsService.queryRecords('accounts', {
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
      select: 'wmkf_potentialreviewersid,wmkf_primaryaffiliation,wmkf_website,wmkf_facultypageurl,wmkf_hindex,wmkf_totalcitations,wmkf_orcid,wmkf_orcidurl,wmkf_googlescholarid,wmkf_googlescholarurl,wmkf_keywords',
      filter: orChain,
      top: 500,
    });
    for (const r of records) out[r.wmkf_potentialreviewersid] = r;
  }
  return out;
}

// Lightweight projection for the "Removed" list — far fewer fields than an active
// candidate (no invite/lifecycle state; these rows are off the request). Does its
// own person/researcher hydration so it stays decoupled from the main grouping.
async function projectRemovedCandidates(rows) {
  if (!rows?.length) return [];
  const personIds = [...new Set(rows.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const [personById, researcherByPerson] = await Promise.all([
    fetchPotentialReviewers(personIds),
    fetchResearchersByPerson(personIds),
  ]);
  return rows.map((s) => {
    const person = personById[s._wmkf_potentialreviewer_value] || {};
    const researcher = researcherByPerson[s._wmkf_potentialreviewer_value] || null;
    return {
      suggestionId: s.wmkf_appreviewersuggestionid,
      name: person.wmkf_name || null,
      affiliation: researcher?.wmkf_primaryaffiliation || person.wmkf_organizationname || null,
      email: person.wmkf_emailaddress || null,
      reasoning: s.wmkf_matchreason || null,
      // Whether the candidate was invited before removal — restoring keeps invite
      // stamps (softDelete leaves them), but the magic link was revoked, so the UI
      // can warn that a re-invite is needed.
      wasInvited: !!s.wmkf_invited,
      removedAt: s.modifiedon || null,
    };
  });
}

// ───────── PATCH ─────────

async function handlePatch(req, res, access) {
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  try {
    const body = req.body || {};
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
      notes,
      emailSentAt,
      responseType,
      responseReceivedAt,
      // Person/researcher fields
      name,
      affiliation,
      email,
      website,
      hIndex,
    } = body;

    // ── Bulk by request (proposalId) ──
    if (proposalId !== undefined && suggestionId === undefined) {
      // GUID-validate before it reaches bulkUpdateByRequest → findByRequest,
      // which interpolates it raw into an OData `_wmkf_request_value eq …` filter.
      if (!isGuid(proposalId)) {
        return res.status(400).json({ error: 'proposalId is not a valid GUID' });
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
        return res.status(400).json({
          error: 'Editing PI / institution is not supported here',
          rejectedFields: rejected,
          hint: 'These fields belong on akoya_request and are managed in CRM.',
        });
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No supported fields to update' });
      }
      const updated = await suggestionAdapter.bulkUpdateByRequest(proposalId, updates, { actingUserSystemId });
      return res.status(200).json({
        success: true,
        message: 'Proposal updated',
        updated: { proposalId, ...updates, suggestionsUpdated: updated },
      });
    }

    if (!suggestionId) {
      return res.status(400).json({ error: 'suggestionId or proposalId is required' });
    }
    // GUID-validate before it reaches updateLifecycle / findById (record-id
    // selectors interpolated raw into the request URL).
    if (!isGuid(suggestionId)) {
      return res.status(400).json({ error: 'suggestionId is not a valid GUID' });
    }

    // ── Restore a removed candidate (reverse the X) ──
    // Explicit flag rather than a generic `selected` field so the destructive
    // direction stays single-pathed through DELETE (atomic unselect + token
    // revoke); this only ever re-selects.
    if (body.restore === true) {
      await suggestionAdapter.restore(suggestionId, { actingUserSystemId });
      return res.status(200).json({ success: true, message: 'Candidate restored' });
    }

    // ── Per-suggestion ──
    const lifecycle = {};
    if (invited !== undefined) lifecycle.invited = invited;
    if (accepted !== undefined) lifecycle.accepted = accepted;
    if (declined !== undefined) lifecycle.declined = declined;
    if (notes !== undefined) lifecycle.notes = notes;
    if (emailSentAt !== undefined) {
      lifecycle.emailSentAt = emailSentAt === 'now' ? new Date().toISOString() : emailSentAt;
    }
    if (responseType !== undefined) lifecycle.responseType = responseType;
    if (responseReceivedAt !== undefined) {
      lifecycle.responseReceivedAt = responseReceivedAt === 'now' ? new Date().toISOString() : responseReceivedAt;
    }

    const hasLifecycle = Object.keys(lifecycle).length > 0;
    const hasResearcher = name !== undefined || affiliation !== undefined || email !== undefined ||
      website !== undefined || hIndex !== undefined;

    if (!hasLifecycle && !hasResearcher) {
      return res.status(400).json({ error: 'No supported fields to update' });
    }

    if (hasLifecycle) {
      await suggestionAdapter.updateLifecycle(suggestionId, lifecycle, { actingUserSystemId });

      // Auto-mint the external-reviewer magic-link token when the
      // reviewer flips to accepted. ensureToken is idempotent — no-op
      // if a usable token already exists, so re-flipping accepted on/off
      // doesn't churn URLs. Failures are logged but don't fail the PATCH
      // — staff can always generate the link manually from Review Manager.
      if (lifecycle.accepted === true) {
        try {
          await ensureToken(suggestionId, { actingUserSystemId });
        } catch (e) {
          console.error(`[my-candidates] auto-mint failed for ${suggestionId}: ${e.message}`);
        }
      }
    }

    // For person/researcher edits we need the linked potentialreviewer + researcher IDs.
    if (hasResearcher) {
      const sug = await suggestionAdapter.findById(suggestionId);
      const personId = sug?._wmkf_potentialreviewer_value;
      if (!personId) {
        return res.status(404).json({ error: 'Linked potential reviewer not found for this suggestion' });
      }

      const personUpdates = {};
      if (name !== undefined) personUpdates.name = name;
      if (email !== undefined) personUpdates.email = email;
      if (affiliation !== undefined) personUpdates.affiliation = affiliation;
      if (Object.keys(personUpdates).length > 0) {
        await potentialReviewerAdapter.update(personId, personUpdates, { actingUserSystemId });
      }

      // Bibliometric edits go straight onto the person now (S213 collapse —
      // updateById takes the person id; email is identity, handled elsewhere).
      // NOTE (Phase 2): this PATCH is a MANUAL STAFF EDIT and is intentionally
      // NOT resolver-gated — a human correcting a record is the authority (the
      // identity resolver's human-in-the-loop override). Automated enrichment
      // paths (save-candidates / enrich-recommended / saveToDatabase) ARE gated;
      // staff hand-edits are not, by design.
      const researcherUpdates = {};
      if (affiliation !== undefined) researcherUpdates.affiliation = affiliation;
      if (website !== undefined) researcherUpdates.website = website;
      if (hIndex !== undefined) researcherUpdates.hIndex = hIndex;
      // Slice G — when staff hand-enter/replace the email, stamp emailSource='manual' so the
      // invite send step reads it as LOW-confidence (this path bypasses the Fix-C enrichment
      // gate, so the address is unverified against the reviewer's identity until a human
      // confirms it at send). Does NOT change the "human is authority" stance above — it just
      // records provenance. Only on an email edit, so an affiliation-only edit won't clobber a
      // real source. wmkf_emailsource lives on the same person entity (researcher adapter map).
      if (email !== undefined) researcherUpdates.emailSource = 'manual';
      if (Object.keys(researcherUpdates).length > 0) {
        await researcherAdapter.updateById(personId, researcherUpdates, { actingUserSystemId });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Candidate updated',
      updated: { suggestionId, ...lifecycle, ...(hasResearcher && { name, affiliation, email, website, hIndex }) },
    });
  } catch (error) {
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
      const payload = { ...translated, conflictingRecordId };
      console.warn('[my-candidates] duplicate-key on update:', payload);
      return res.status(409).json(payload);
    }
    console.error('Update candidate error:', error);
    return res.status(500).json({
      error: 'Failed to update candidate',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

// translateDuplicateKeyError now lives in lib/dataverse/duplicate-key.js (S290
// chunk-5) so the alt-key ordering probe and this route share one definition.

// ───────── DELETE ─────────

async function handleDelete(req, res, access) {
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  try {
    const { suggestionId } = req.body || {};
    if (!suggestionId) {
      return res.status(400).json({ error: 'suggestionId is required' });
    }
    // GUID-validate before softDelete → getRecord/updateRecord (record-id
    // selector interpolated raw into the request URL).
    if (!isGuid(suggestionId)) {
      return res.status(400).json({ error: 'suggestionId is not a valid GUID' });
    }
    // Server-authoritative removal (Codex S213 BUG-1 + BUG-3 fix): unselect the
    // row AND revoke any magic link in ONE atomic PATCH (wmkf_selected=false +
    // wmkf_externaltokenrevoked=true). A single write means there's no two-step
    // window where the row could end up revoked-but-still-selected (or unselected-
    // but-link-live) on a partial failure. Harmless on a never-invited candidate
    // (no token → just sets a bool); throws (→ 500) only if the row is missing, so
    // the caller keeps the row rather than silently "removing" a nonexistent one.
    // Doing this server-side means removal never relies on a stale client-cached
    // tokenState, closing the concurrent-regeneration race.
    await suggestionAdapter.softDelete(suggestionId, { actingUserSystemId, alsoRevokeToken: true });
    return res.status(200).json({ success: true, message: 'Candidate removed' });
  } catch (error) {
    console.error('Delete candidate error:', error);
    return res.status(500).json({
      error: 'Failed to remove candidate',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
