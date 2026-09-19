import { useCallback } from 'react';
import { addressTrustFailureMessage } from './presentation';
import {
  getCandidateEmailReadiness,
  getCandidatePromotionDecision,
  pruneCandidateForRoster,
} from '../reviewer-search-logic';
import { candKey, dedupeByName } from './candidateKeys';

export default function useReviewerContactActions({
  requestId,
  genRef,
  unverified,
  setCandidates,
  setRecCandidates,
  setRosterActive,
  setRosterNote,
  setSelected,
  setEditingContact,
  setRepairRequestsByCandidateKey,
  setConfirmingContact,
  setUnverified,
}) {
  // Apply a staff-entered MANUAL contact to transient candidate state. Used by
  // the lead "Use this email" promotion (Slice 4); the on-card Edit-contact
  // modal now persists website/affiliation through persistManualContact first.
  // For email/website it
  // stamps `manual` provenance (so emailConfidence → low → the invite flow requires
  // explicit quick-check acknowledgement) and clears the contact-layer abstain that
  // withheld a value (e.g. verified_domain_contradiction) so save can persist it.
  // NEVER touches name (the find-card key) or any identity field.
  const setManualContact = useCallback((cand, updates) => {
    if (!cand || !updates) return;
    const key = candKey(cand);
    if (!key) return;
    const apply = (c) => {
      if (candKey(c) !== key) return c;
      const enr = { ...(c.contactEnrichment || {}) };
      const next = { ...c, contactEnrichment: enr };
      // Record EXACTLY which fields the human edited, so the applicant-promote path
      // persists only those (Codex: affiliationPersistAllowed/hIndex are also set by
      // enrichment, so they're NOT a manual signal — overwriting from the card would
      // clobber enrichment values). Monotonic: a later edit unions with prior ones.
      const manualFields = new Set(Array.isArray(c.manualContactFields) ? c.manualContactFields : []);
      for (const k of Object.keys(updates)) manualFields.add(k);
      next.manualContactFields = Array.from(manualFields);
      // A manual email OR website is a staff override of the contact-quality
      // abstain (e.g. verified_domain_contradiction) — clear it for both so save
      // can persist the typed value (Codex review LOW: website edits were missing
      // this clear, so a withheld-by-domain row's manual website was blocked).
      if ('email' in updates || 'website' in updates) {
        enr.contactStatus = null; enr.contactStatusReason = null;
      }
      if ('email' in updates) {
        const email = updates.email || null;
        enr.email = email; enr.emailSource = email ? 'manual' : null; enr.emailPersistAllowed = !!email;
        next.email = email; next.emailSource = email ? 'manual' : null; next.emailPersistAllowed = !!email;
      }
      if ('website' in updates) {
        const website = updates.website || null;
        enr.website = website; enr.websiteSource = website ? 'manual' : null; enr.websitePersistAllowed = !!website;
        next.website = website; next.websiteSource = website ? 'manual' : null; next.websitePersistAllowed = !!website;
      }
      if ('affiliation' in updates) {
        const affiliation = updates.affiliation || null;
        enr.affiliationPersistAllowed = true;
        next.affiliation = affiliation;
      }
      if ('hIndex' in updates) {
        const h = updates.hIndex;
        const parsed = (h === '' || h == null) ? null : Number(h);
        const safe = Number.isFinite(parsed) ? parsed : null; // guard NaN (Codex review LOW)
        enr.hIndex = safe; next.hIndex = safe;
      }
      return next;
    };
    setCandidates((prev) => prev.map(apply));
    setRecCandidates((prev) => prev.map(apply));
    setRosterActive((prev) => prev.map(apply));
  }, [setCandidates, setRecCandidates, setRosterActive]);

  const applyAuthoritativeRosterCandidate = useCallback((key, candidate) => {
    if (!key || !candidate) return;
    const replace = (current) => (candKey(current) === key ? candidate : current);
    setCandidates((prev) => prev.map(replace));
    setRecCandidates((prev) => prev.map(replace));
    setRosterActive((prev) => prev.map(replace));
  }, [setCandidates, setRecCandidates, setRosterActive]);

  const persistManualContact = useCallback(async (cand, updates) => {
    if (!cand || !requestId) throw new Error('Reload this request before editing contact details.');
    const key = candKey(cand);
    if (!key) throw new Error('This reviewer has no stable roster key. Reload and try again.');
    const durableUpdates = {};
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'website')) durableUpdates.website = updates.website;
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'affiliation')) durableUpdates.affiliation = updates.affiliation;
    const localUpdates = { ...(updates || {}) };
    delete localUpdates.website;
    delete localUpdates.affiliation;
    if (Object.keys(durableUpdates).length === 0) {
      setManualContact(cand, updates);
      return;
    }
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-roster', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        action: 'update_contact_draft',
        candidateKey: key,
        updates: durableUpdates,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return false;
    if (!response.ok || !data.success || !data.candidate) {
      throw new Error(data.error || 'Could not save these contact details to the request.');
    }
    applyAuthoritativeRosterCandidate(key, data.candidate);
    if (Object.keys(localUpdates).length > 0) {
      setManualContact(data.candidate, localUpdates);
    }
    setRosterNote(`${data.candidate.name || cand.name}: contact details saved to this request.`);
  }, [requestId, genRef, setManualContact, applyAuthoritativeRosterCandidate, setRosterNote]);

  const verifyAddressContact = useCallback(async (cand, updates, evidence) => {
    if (!cand || !requestId) throw new Error('Reload this request before verifying an address.');
    const key = candKey(cand);
    if (!key) throw new Error('This reviewer has no stable roster key. Reload and try again.');
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        candidateKey: key,
        action: 'verify_person_and_address',
        email: updates.email,
        // Exact-person verification covers every field used by the promotion
        // confirmation gate. The server stores these fields and renews the
        // opaque confirmation in the same roster update as the address receipt.
        verifiedContact: {
          website: updates.website !== undefined ? updates.website : (cand.website || ''),
          affiliation: updates.affiliation !== undefined ? updates.affiliation : (cand.affiliation || ''),
        },
        evidenceType: evidence.evidenceType,
        evidenceUrl: evidence.evidenceUrl,
        note: evidence.note,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return false;
    if (!response.ok || !data.success || !data.candidate) {
      // Verification can commit the server-owned roster receipt before an
      // ETag-guarded Dataverse adjudication fails. Reflect only that explicit
      // partial success so the card and the next retry use the authoritative
      // receipt instead of silently reverting to the pre-verification state.
      if (data.partialSuccess === true && data.receiptRecorded === true && data.candidate) {
        applyAuthoritativeRosterCandidate(key, data.candidate);
      }
      throw new Error(addressTrustFailureMessage(data, 'Could not verify this address.'));
    }
    applyAuthoritativeRosterCandidate(key, data.candidate);
    setSelected((prev) => { const next = new Set(prev); next.add(key); return next; });
    setRosterNote(`${data.candidate.name || cand.name}: exact person and address verified.`);
    return true;
  }, [requestId, genRef, applyAuthoritativeRosterCandidate, setSelected, setRosterNote]);

  const reviewAddressConflict = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, candidateKey: key, action: 'get_address_conflict' }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return;
    if (!response.ok || !data.success || !data.conflict) {
      setRosterNote(addressTrustFailureMessage(
        data,
        'Could not load the current address conflict. Use the available action on this reviewer card.',
      ));
      return;
    }
    setEditingContact({ ...cand, addressConflict: data.conflict });
  }, [requestId, genRef, setEditingContact, setRosterNote]);

  const retryAddressCheck = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        candidateKey: key,
        action: 'retry_check',
        code: cand.serverRepairReason
          || (getCandidatePromotionDecision(cand)?.decision === 'needs_record_repair'
            ? getCandidatePromotionDecision(cand).reason
            : null),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return;
    if (!response.ok || !data.success || !data.candidate) {
      setRosterNote(addressTrustFailureMessage(
        data,
        'The conflict check could not be retried. Use the available action on this reviewer card.',
      ));
      return;
    }
    applyAuthoritativeRosterCandidate(key, data.candidate);
    setRosterNote(`${data.candidate.name || cand.name}: record check refreshed. Add the reviewer to Invite again.`);
  }, [requestId, genRef, applyAuthoritativeRosterCandidate, setRosterNote]);

  const requestAddressRepair = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        candidateKey: key,
        action: 'create_repair_request',
        code: cand.serverRepairReason
          || (getCandidatePromotionDecision(cand)?.decision === 'needs_record_repair'
            ? getCandidatePromotionDecision(cand).reason
            : null)
          || (getCandidateEmailReadiness(cand).action === 'blocked'
            ? 'address_conflict_pending'
            : 'address_verification_required'),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return;
    if (response.ok && data.success && data.repairRequest) {
      setRepairRequestsByCandidateKey((previous) => ({
        ...previous,
        [key]: data.repairRequest,
      }));
    }
    setRosterNote(response.ok && data.success
      ? data.message
      : (data.message || data.error || 'Could not create a repair request. Retry from this reviewer card.'));
  }, [requestId, genRef, setRepairRequestsByCandidateKey, setRosterNote]);

  // Slice 4: a quarantined email lead must pass through the evidence form;
  // website-only leads remain a direct non-address edit.
  const useLead = useCallback((cand, lead) => {
    if (!cand || !lead || !lead.value) return;
    if (lead.type === 'email') {
      setEditingContact({ ...cand, email: lead.value, emailSource: 'manual' });
      return;
    }
    setManualContact(cand, { website: lead.value });
  }, [setManualContact, setEditingContact]);

  const openIdentityConfirmation = useCallback(async (cand) => {
    if (!cand?.addressConflictPending) {
      setConfirmingContact(cand);
      return;
    }
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, candidateKey: key, action: 'get_address_conflict' }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return;
    if (!response.ok || !data.success || !data.conflict) {
      setRosterNote(addressTrustFailureMessage(
        data,
        'Could not load the current email choice. Reload the reviewer card and try again.',
      ));
      return;
    }
    setConfirmingContact({ ...cand, addressConflict: data.conflict });
  }, [requestId, genRef, setConfirmingContact, setRosterNote]);

  // PD confirms a needs-identity-review row IS the right person + supplies corrected
  // contact. The authenticated roster PATCH stores the request-scoped attestation
  // first; only then do we stamp manual contact + the UI marker/opaque id locally.
  const confirmIdentityContact = useCallback(async (cand, updates, evidence) => {
    if (!cand) return false;
    const key = candKey(cand);
    if (!key || !requestId) return false;
    const myGen = genRef.current;
    // An unverified Claude suggestion is ephemeral — it was never recorded on
    // the durable roster (S224), but confirm_identity only updates an existing
    // ACTIVE roster row. Record it first so the attestation has a row to bind
    // to; recordSurfaced upserts, so a re-run after a partial failure is safe.
    const wasUnverified = unverified.some((u) => candKey(u) === key);
    if (wasUnverified) {
      const recordRes = await fetch('/api/workbench/reviewer-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, candidates: [pruneCandidateForRoster(cand)] }),
      });
      const recordData = await recordRes.json().catch(() => ({}));
      if (!recordRes.ok || !recordData.success) {
        throw new Error(recordData.error || 'Could not add this suggestion to the request roster. Please retry.');
      }
      if (genRef.current !== myGen) return false;
    }
    const confirmedCandidate = {
      ...cand,
      ...updates,
      emailSource: 'manual',
      websiteSource: updates.website ? 'manual' : null,
      affiliationSource: 'staff_manual',
      contactEnrichment: {
        ...(cand.contactEnrichment || {}),
        ...updates,
        emailSource: 'manual',
        websiteSource: updates.website ? 'manual' : null,
        affiliationSource: 'staff_manual',
      },
    };
    const response = await fetch('/api/workbench/reviewer-roster', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, action: 'confirm_identity', candidate: confirmedCandidate }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.confirmationId) {
      throw new Error(data.error || 'Could not record identity confirmation. Please retry.');
    }
    if (genRef.current !== myGen) return false;
    const authoritativeConfirmed = data.candidate || confirmedCandidate;
    // The confirmation write has already committed. Keep that server truth in
    // the card even if the following address-evidence write fails and the modal
    // stays open for a retry.
    if (wasUnverified) {
      // The suggestion is now a durable active roster row: move it out of the
      // ephemeral Unverified section so the confirmed card renders (and stays
      // rescuable through the normal needs-identity-review machinery).
      setUnverified((prev) => prev.filter((u) => candKey(u) !== key));
      setRosterActive((prev) => dedupeByName([authoritativeConfirmed, ...prev]));
    }
    applyAuthoritativeRosterCandidate(key, authoritativeConfirmed);
    return verifyAddressContact(authoritativeConfirmed, updates, evidence);
  }, [requestId, genRef, unverified, verifyAddressContact, applyAuthoritativeRosterCandidate, setUnverified, setRosterActive]);
  return {
    setManualContact,
    persistManualContact,
    verifyAddressContact,
    reviewAddressConflict,
    retryAddressCheck,
    requestAddressRepair,
    useLead,
    openIdentityConfirmation,
    confirmIdentityContact,
  };
}
