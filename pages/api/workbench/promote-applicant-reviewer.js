/**
 * API: /api/workbench/promote-applicant-reviewer
 *
 * POST { requestId, suggestionId }
 *
 * Explicitly promotes one applicant-recommended reviewer into the request's
 * candidate pool by selecting the existing wmkf_appreviewersuggestion junction
 * row. Applicant ingestion creates these rows unselected; this route is the PD
 * action that flips wmkf_selected=true.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import * as reviewerSuggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import { APPLICANT_DISPOSITION_MAP } from '../../../lib/dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import * as researcherAdapter from '../../../lib/dataverse/adapters/researcher';
import { translateDuplicateKeyError } from '../../../lib/dataverse/duplicate-key';
import { findCandidateBySuggestion } from '../../../lib/services/reviewer-roster-store';

// Persist the PD's hand-corrections (the ONLY fields the client marked manual) to
// the suggestion's OWN person record, then report what landed. Mirrors the
// my-candidates hand-edit contract: conflict-safe fields first, the alt-key-
// constrained email LAST and isolated, source FORCED to 'manual' server-side (never
// trust a client source label — Codex/save-candidates trust-boundary defense). The
// row is already promoted by the time this runs, so a contact failure is reported,
// never fatal: the promoted-but-conflicted row resolves on the Invite tab merge flow.
async function writePromotedContact(personId, contact, { actingUserSystemId }) {
  const savedFields = [];
  if (!personId || !contact || typeof contact !== 'object') return { savedFields, contactError: null };

  const affiliation = typeof contact.affiliation === 'string' ? contact.affiliation : undefined;
  const website = typeof contact.website === 'string' ? contact.website : undefined;
  const hIndex = contact.hIndex === undefined ? undefined : contact.hIndex;
  const email = typeof contact.email === 'string' ? contact.email.trim() : '';

  try {
    if (affiliation !== undefined) {
      await potentialReviewerAdapter.update(personId, { affiliation }, { actingUserSystemId });
      savedFields.push('affiliation');
    }
    const researcherUpdates = {};
    if (affiliation !== undefined) researcherUpdates.affiliation = affiliation;
    if (website !== undefined) researcherUpdates.website = website;
    if (hIndex !== undefined) researcherUpdates.hIndex = hIndex;
    if (Object.keys(researcherUpdates).length > 0) {
      await researcherAdapter.updateById(personId, researcherUpdates, { actingUserSystemId });
      if (website !== undefined) savedFields.push('website');
      if (hIndex !== undefined) savedFields.push('hIndex');
    }
  } catch (err) {
    // Non-email writes don't alt-key conflict; a failure here is unexpected but
    // must not unwind the promotion. Report it.
    console.error('promote-applicant-reviewer contact write (safe fields) failed:', err);
    return { savedFields, contactError: { code: 'contact_write_failed', message: 'Promoted, but the contact correction could not be saved — re-enter it on the Invite Reviewers tab.' } };
  }

  // Email LAST, isolated. Force 'manual' AFTER it lands. A duplicate-key here means
  // the address is owned by another record → report (the staffer resolves it via the
  // Invite-tab merge), but the promotion already stuck.
  if (email) {
    try {
      await potentialReviewerAdapter.update(personId, { email }, { actingUserSystemId });
      await researcherAdapter.updateById(personId, { emailSource: 'manual' }, { actingUserSystemId });
      savedFields.push('email');
    } catch (err) {
      const translated = translateDuplicateKeyError(err);
      if (translated) {
        return { savedFields, contactError: { code: 'email_conflict', field: 'wmkf_emailaddress', value: translated.value || email, message: 'That email is already used by another reviewer record — resolve it on the Invite Reviewers tab.' } };
      }
      console.error('promote-applicant-reviewer email write failed:', err);
      return { savedFields, contactError: { code: 'contact_write_failed', message: 'Promoted, but the email correction could not be saved — re-enter it on the Invite Reviewers tab.' } };
    }
  }

  return { savedFields, contactError: null };
}

// B1 (S317): recover the VETTED enrichment email that `enrich-recommended` wrote to
// the durable roster but never to Dataverse (its writeback via
// `researcherAdapter.upsertByPotentialReviewer` has no email param — researcher.js:94),
// so an applicant reviewer promoted WITHOUT a manual correction used to land on the
// Invite tab with an empty `wmkf_emailaddress`. The email is read SERVER-SIDE from the
// roster keyed by the server-derived `requestId + suggestionId` (an exact id anchor —
// never a client-supplied value, never a normalized name), so no new trust boundary.
// Persisted through the SAME envelope save-candidates uses: only when enrichment marked
// it persistable (`emailPersistAllowed===true` — enrichment sets this false on any
// identity/domain abstain) and identity is not unresolved, and ONLY when the person has
// no email yet (idempotent; never overrides a manual correction or a prior address). The
// source is forced to the roster's VETTED provenance server-side, not 'manual'. A
// duplicate-email collision is non-fatal (mirrors the manual path) → reported, promotion
// stands. Returns { savedField, contactError }.
async function backfillEnrichedEmail(requestId, suggestionId, personId, { actingUserSystemId }) {
  if (!personId) return { savedField: false, contactError: null };
  let candidate = null;
  try {
    candidate = await findCandidateBySuggestion(requestId, suggestionId);
  } catch (err) {
    console.error('promote-applicant-reviewer roster read failed (non-fatal):', err);
    return { savedField: false, contactError: null };
  }
  if (!candidate) return { savedField: false, contactError: null };

  const enr = candidate.contactEnrichment || {};
  const email = (typeof candidate.email === 'string' && candidate.email.trim())
    || (typeof enr.email === 'string' && enr.email.trim()) || '';
  const persistOk = candidate.emailPersistAllowed === true || enr.emailPersistAllowed === true;
  // Mirror save-candidates' identity block: an unresolved / needs-review row never
  // persists contact (it could be a namesake). enrichment also drives persistOk=false
  // here, but gate explicitly too — belt and suspenders on the safety invariant.
  const identityUnresolved = candidate.needsIdentification === true
    || candidate.identityStatus === 'unresolved'
    || candidate.verificationStatus === 'unresolved';
  if (!email || !persistOk || identityUnresolved) return { savedField: false, contactError: null };

  // Idempotency: only write when the person currently has NO email — never clobber a
  // manual correction (already handled above) or a pre-existing address.
  let current = null;
  try {
    current = await potentialReviewerAdapter.getById(personId);
  } catch (err) {
    console.error('promote-applicant-reviewer person read failed (non-fatal):', err);
    return { savedField: false, contactError: null };
  }
  if (current && current.wmkf_emailaddress) return { savedField: false, contactError: null };

  const source = (typeof candidate.emailSource === 'string' && candidate.emailSource)
    || (typeof enr.emailSource === 'string' && enr.emailSource) || null;
  try {
    await potentialReviewerAdapter.update(personId, { email }, { actingUserSystemId });
    if (source) await researcherAdapter.updateById(personId, { emailSource: source }, { actingUserSystemId });
    return { savedField: true, contactError: null };
  } catch (err) {
    const translated = translateDuplicateKeyError(err);
    if (translated) {
      return { savedField: false, contactError: { code: 'email_conflict', field: 'wmkf_emailaddress', value: translated.value || email, message: 'That email is already used by another reviewer record — resolve it on the Invite Reviewers tab.' } };
    }
    console.error('promote-applicant-reviewer enriched-email write failed (non-fatal):', err);
    return { savedField: false, contactError: null };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const { requestId, suggestionId } = req.body || {};
  const requestGuid = typeof requestId === 'string' ? requestId.trim() : '';
  const suggestionGuid = typeof suggestionId === 'string' ? suggestionId.trim() : '';
  if (!isGuid(requestGuid) || !isGuid(suggestionGuid)) {
    return res.status(400).json({ error: 'requestId and suggestionId must be GUIDs' });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return bypassDynamicsRestrictions('workbench-promote-applicant-reviewer', async () => {
    try {
      const row = await reviewerSuggestionAdapter.findById(suggestionGuid);
      if (!row || String(row._wmkf_request_value || '').toLowerCase() !== requestGuid.toLowerCase()) {
        return res.status(404).json({ error: 'Applicant reviewer suggestion not found for this request' });
      }
      if (row.wmkf_applicantdisposition !== APPLICANT_DISPOSITION_MAP.recommended) {
        return res.status(400).json({ error: 'Only applicant-recommended reviewers can be promoted' });
      }

      // Flip selected FIRST — promotion is a valid decision regardless of whether a
      // contact correction can be saved (Codex Q1). Contact write happens after and
      // is non-fatal, so the current client (which treats any non-OK as a failed
      // promote) still records this row as promoted.
      await reviewerSuggestionAdapter.updateLifecycle(
        suggestionGuid,
        { selected: true },
        { actingUserSystemId },
      );

      // Persist the PD's hand-corrections to the suggestion's OWN person record
      // (row._wmkf_potentialreviewer_value — never a client-supplied id). The client
      // sends ONLY the fields it explicitly marked manual (contact.*).
      const { savedFields, contactError } = await writePromotedContact(
        row._wmkf_potentialreviewer_value,
        req.body?.contact,
        { actingUserSystemId },
      );

      // B1: if the PD did NOT hand-correct an email, backfill the vetted enrichment
      // email from the roster (server-side, id-anchored). Gate on whether a manual
      // email was ATTEMPTED, not just whether one persisted: a manual email that
      // COLLIDED (409, not in savedFields) is an explicit PD choice that must route to
      // the Invite-tab merge — never get silently overwritten by the enrichment email.
      const manualEmailAttempted = typeof req.body?.contact?.email === 'string'
        && req.body.contact.email.trim().length > 0;
      let backfillError = null;
      if (!manualEmailAttempted && !savedFields.includes('email')) {
        const { savedField, contactError: bfError } = await backfillEnrichedEmail(
          requestGuid,
          suggestionGuid,
          row._wmkf_potentialreviewer_value,
          { actingUserSystemId },
        );
        if (savedField) savedFields.push('email');
        backfillError = bfError;
      }

      // Prefer the manual-write error (the PD's explicit action) over the backfill's.
      const finalContactError = contactError || backfillError;
      return res.status(200).json({
        success: true,
        suggestionId: suggestionGuid,
        savedFields,
        partialSuccess: !!finalContactError,
        contactError: finalContactError,
      });
    } catch (err) {
      if (/applicant-excluded/i.test(err?.message || '')) {
        return res.status(400).json({ error: 'Only applicant-recommended reviewers can be promoted' });
      }
      console.error('promote-applicant-reviewer error:', err);
      return res.status(500).json({
        error: 'Failed to promote applicant reviewer',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
