/**
 * API: /api/workbench/manual-reviewer
 *
 * POST one sparse staff-entered reviewer into a request's durable candidate
 * pool. This is Phase 1 only: no enrichment runs here.
 *
 * Also captures REFERRALS (S249): when `referredBy` is supplied (a contacted
 * reviewer suggested this person), the candidate is tagged provenance `referred`
 * — a strong human signal, selectable-with-verify and grounded-rank-bonused like
 * proposal_named — and the referrer is recorded in the durable match reason. The
 * free-text → identity resolution (lookup → resolve/confirm/409) is the SAME
 * abstain-or-confirm flow as manual add; only the provenance + referrer differ.
 * Design: docs/REVIEWER_FINDER_REFERRAL_CAPTURE_DESIGN.md.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import { normalizeOrcid } from '../../../lib/utils/orcid-normalize';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import * as contactAdapter from '../../../lib/dataverse/adapters/contact';
import * as researcherAdapter from '../../../lib/dataverse/adapters/researcher';
import * as reviewerSuggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { lookupReviewerIdentity } from './reviewer-lookup';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 180;
const MAX_EMAIL = 254;
const MAX_AFFILIATION = 500;
const MAX_NOTE = 1000;
const RESOLUTION_MODES = new Set(['reuse_reviewer', 'reuse_contact', 'create_new']);

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function sameEmail(a, b) {
  return cleanString(a, MAX_EMAIL).toLowerCase() === cleanString(b, MAX_EMAIL).toLowerCase();
}

function sameId(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

function contactName(row) {
  return row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ');
}

function contactOrcidConflict(typedOrcid, contact) {
  if (!typedOrcid || !contact?.wmkf_orcid) return null;
  const existing = normalizeOrcid(contact.wmkf_orcid);
  if (existing.state === 'valid' && existing.id !== typedOrcid) {
    return { existing: existing.id, incoming: typedOrcid };
  }
  return null;
}

function resolutionFromLookup(lookup) {
  if (lookup?.outcome !== 'confident' || lookup.match?.nameConsistent === false) return null;
  if (lookup.match.reviewerId) {
    return { mode: 'reuse_reviewer', reviewerId: lookup.match.reviewerId, contactId: lookup.match.contactId || undefined };
  }
  if (lookup.match.contactId) {
    return { mode: 'reuse_contact', contactId: lookup.match.contactId };
  }
  return null;
}

function conflictResponse(res, reason, details) {
  return res.status(409).json({ error: 'Manual reviewer identity conflict', code: reason, details });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const body = req.body || {};
  const requestId = cleanString(body.requestId, 64);
  const name = cleanString(body.name, MAX_NAME);
  const email = cleanString(body.email, MAX_EMAIL).toLowerCase();
  const affiliation = cleanString(body.affiliation, MAX_AFFILIATION);
  const note = cleanString(body.note, MAX_NOTE);
  const referredBy = cleanString(body.referredBy, MAX_NAME);
  const orcidRaw = cleanString(body.orcid, 64);
  const orcidNorm = orcidRaw ? normalizeOrcid(orcidRaw) : { state: 'empty' };
  const orcid = orcidNorm.state === 'valid' ? orcidNorm.id : null;
  const resolution = body.resolution || null;

  if (!requestId) return res.status(400).json({ error: 'requestId is required (akoya_request GUID)' });
  if (!GUID_RE.test(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email must be a valid email address' });
  if (orcidRaw && !orcid) return res.status(400).json({ error: 'orcid must be a valid ORCID iD' });
  if (resolution) {
    if (!RESOLUTION_MODES.has(resolution.mode)) return res.status(400).json({ error: 'resolution.mode is invalid' });
    if (resolution.reviewerId && !GUID_RE.test(resolution.reviewerId)) return res.status(400).json({ error: 'resolution.reviewerId must be a GUID' });
    if (resolution.contactId && !GUID_RE.test(resolution.contactId)) return res.status(400).json({ error: 'resolution.contactId must be a GUID' });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return bypassDynamicsRestrictions('workbench-manual-reviewer', async () => {
    try {
      let request;
      try {
        request = await DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,akoya_title,wmkf_meetingdate,_wmkf_programareaserved_value',
        });
      } catch {
        request = null;
      }
      if (!request?.akoya_requestid) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      const cycleCode = request.wmkf_meetingdate ? meetingDateToCycleCode(request.wmkf_meetingdate) : null;
      const programArea = request._wmkf_programareaserved_value_formatted || null;
      // Durable home of the referrer (D1: no new Dataverse field) — encode it in the
      // match reason staff already read on the suggestion/person rows.
      const matchReason = referredBy
        ? `Referred by ${referredBy}.${note ? ` ${note}` : ''}`
        : (note || 'Manually added by staff.');

      let selectedResolution = resolution;
      const lookup = await lookupReviewerIdentity({ name, email: email || null, affiliation: affiliation || null, orcid });
      if (!selectedResolution) {
        const auto = resolutionFromLookup(lookup);
        if (auto) {
          selectedResolution = auto;
        } else if (lookup.outcome === 'none') {
          selectedResolution = { mode: 'create_new' };
        } else {
          return res.status(409).json({
            error: 'Reviewer identity needs staff confirmation before adding.',
            code: lookup.outcome === 'conflict' ? lookup.reason : 'resolution_required',
            lookup,
          });
        }
      } else if (lookup.outcome === 'conflict' && selectedResolution.mode !== 'create_new') {
        return conflictResponse(res, lookup.reason, lookup.details);
      } else if (lookup.outcome === 'candidates' && selectedResolution.mode !== 'create_new') {
        const ids = new Set((lookup.candidates || []).flatMap((c) => [c.reviewerId, c.contactId].filter(Boolean).map((id) => String(id).toLowerCase())));
        const chosenId = selectedResolution.mode === 'reuse_reviewer' ? selectedResolution.reviewerId : selectedResolution.contactId;
        if (!ids.has(String(chosenId || '').toLowerCase())) {
          return res.status(409).json({ error: 'Selected reviewer/contact is stale or not in the current lookup candidates.', code: 'stale_resolution', lookup });
        }
      }

      let potentialReviewerId = null;
      let personCreated = false;
      let contactToLink = null;
      let contactRow = null;
      let responseEmail = email || null;
      let responseAffiliation = affiliation || null;
      let responseName = name;

      if (selectedResolution.mode === 'reuse_reviewer') {
        if (!selectedResolution.reviewerId) return res.status(400).json({ error: 'resolution.reviewerId is required for reuse_reviewer' });
        const reviewer = await potentialReviewerAdapter.getById(selectedResolution.reviewerId).catch(() => null);
        if (!reviewer?.wmkf_potentialreviewersid) return res.status(409).json({ error: 'Selected reviewer no longer exists.', code: 'stale_resolution' });
        potentialReviewerId = reviewer.wmkf_potentialreviewersid;
        personCreated = false;
        contactToLink = selectedResolution.contactId || reviewer._wmkf_contact_value || null;
        if (contactToLink) {
          contactRow = await contactAdapter.getById(contactToLink).catch(() => null);
          if (!contactRow?.contactid) return res.status(409).json({ error: 'Selected contact no longer exists.', code: 'stale_resolution' });
          if (reviewer._wmkf_contact_value && !sameId(reviewer._wmkf_contact_value, contactRow.contactid)) {
            return conflictResponse(res, 'contact_linked_elsewhere', { reviewerId: potentialReviewerId, existingContactId: reviewer._wmkf_contact_value, contactId: contactRow.contactid });
          }
        }
      } else if (selectedResolution.mode === 'reuse_contact') {
        if (!selectedResolution.contactId) return res.status(400).json({ error: 'resolution.contactId is required for reuse_contact' });
        contactRow = await contactAdapter.getById(selectedResolution.contactId).catch(() => null);
        if (!contactRow?.contactid) return res.status(409).json({ error: 'Selected contact no longer exists.', code: 'stale_resolution' });
        if (email && contactRow.emailaddress1 && !sameEmail(email, contactRow.emailaddress1)) {
          return conflictResponse(res, 'email_mismatch', { contactId: contactRow.contactid, typedEmail: email, contactEmail: contactRow.emailaddress1 });
        }
        const orcidConflict = contactOrcidConflict(orcid, contactRow);
        if (orcidConflict) return conflictResponse(res, 'orcid_mismatch', { contactId: contactRow.contactid, ...orcidConflict });

        const filledEmail = email || contactRow.emailaddress1 || null;
        responseEmail = filledEmail;
        responseName = name || contactName(contactRow);
        const created = await potentialReviewerAdapter.create({
          name: responseName,
          email: filledEmail,
          affiliation: affiliation || null,
          whyChosen: matchReason,
        }, { actingUserSystemId });
        potentialReviewerId = created.id;
        personCreated = true;
        contactToLink = contactRow.contactid;
      } else {
        const created = await potentialReviewerAdapter.create({
          name,
          email: email || null,
          affiliation: affiliation || null,
          whyChosen: matchReason,
        }, { actingUserSystemId });
        potentialReviewerId = created.id;
        personCreated = true;
      }

      // Resolve the per-request candidate row FIRST, so the applicant-exclusion
      // gate fires before any identity-bearing enrichment write below. If this
      // reviewer is excluded for this request we return 409 without touching the
      // person's contact metadata (emailSource / ORCID). The person row created
      // above is acceptable on an excluded reviewer — they are a real human
      // and exclusion is per-request, not a global "never record" — but we stop
      // short of relabeling or filling contact identity for a row we're rejecting.
      const suggestion = await reviewerSuggestionAdapter.ensureStaffManualCandidate({
        potentialReviewerId,
        requestId,
        suggestionLabel: request.akoya_title ? `${request.akoya_title} — ${name}` : null,
        grantCycleCode: cycleCode,
        programArea,
        matchReason,
      }, { actingUserSystemId });

      if (suggestion.skippedExcluded) {
        return res.status(409).json({
          error: 'This reviewer is excluded for this request and was not added.',
          code: 'applicant_excluded',
          suggestionId: suggestion.id,
        });
      }

      // Fill-only contact/identity enrichment on the global person row. Both
      // emailSource and a staff-provided ORCID (looked up via /orcid-lookup or
      // typed) go through upsertByPotentialReviewer, which writes each field ONLY
      // when the existing value is empty. So staff input — lower-trust than a
      // reviewer self-report — never overwrites a resolver-sourced or
      // reviewer-attested (sticky `confirmed`) email source / ORCID, and
      // wmkf_identitystatus is never touched. Single round-trip.
      const contactOrcid = normalizeOrcid(contactRow?.wmkf_orcid);
      const carryOrcid = orcid || (contactOrcid.state === 'valid' ? contactOrcid.id : null);
      const carryOrcidUrl = carryOrcid ? `https://orcid.org/${carryOrcid}` : null;
      if (responseEmail || carryOrcid) {
        await researcherAdapter.upsertByPotentialReviewer(potentialReviewerId, {
          emailSource: responseEmail ? 'manual' : undefined,
          orcid: carryOrcid || undefined,
          orcidUrl: carryOrcidUrl || undefined,
        }, { actingUserSystemId });
      }

      if (contactToLink) {
        try {
          await potentialReviewerAdapter.setContactLink(potentialReviewerId, contactToLink, { actingUserSystemId });
        } catch (err) {
          if (err?.status === 409 || err?.code) {
            return conflictResponse(res, err.code || 'contact_linked_elsewhere', err.details || { contactId: contactToLink, potentialReviewerId });
          }
          throw err;
        }
      }

      return res.status(200).json({
        success: true,
        candidate: {
          suggestionId: suggestion.id,
          potentialReviewerId,
          contactId: contactToLink || null,
          name: responseName,
          email: responseEmail || null,
          affiliation: responseAffiliation || null,
          orcid: carryOrcid || null,
          orcidUrl: carryOrcidUrl,
          sources: referredBy ? ['referred'] : ['staff_manual'],
          // `referredBy` + `provenanceKind` drive the client's provenance (kind `referred`,
          // selectable-with-verify, grounded-rank bonus, "Referred by X" card label).
          referredBy: referredBy || null,
          provenanceKind: referredBy ? 'referred' : undefined,
          manualAdded: true,
          applicantRecommended: false,
          invitable: !!responseEmail,
          reasoning: matchReason,
        },
        created: {
          person: personCreated,
          suggestion: suggestion.created,
        },
      });
    } catch (error) {
      console.error('manual-reviewer error:', error);
      return res.status(500).json({
        error: 'Failed to add manual reviewer',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
