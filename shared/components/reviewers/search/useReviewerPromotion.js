/**
 * Ownership: operation hook: owns promotion/save commands; controller owns state and view modules render.
 */
import { useCallback } from 'react';
import { readSseStream } from '../sse';
import {
  correlateSaveResultsToRosterCandidates,
  isCandidateSelectable,
  mergeEnrichment,
  pruneCandidateForRoster,
} from '../reviewer-search-logic';
import { formatSaveFailureDetails } from './presentation';
import { candKey, dedupeByName } from './candidateKeys';
import { requestEnvelope } from '../../../utils/api-request';
import {
  PROVENANCE_KINDS,
  provenanceKindOf,
} from '../../../../lib/utils/reviewer-provenance';

export default function useReviewerPromotion({
  requestId,
  onSaved,
  selected,
  analysis,
  displayCandidates,
  genRef,
  savingRef,
  pushProgress,
  reloadRoster,
  setSavingCount,
  setPhase,
  setError,
  setErrorMeta,
  setProgress,
  setPromotionNotice,
  setCandidates,
  setRecCandidates,
  setRosterActive,
  setRosterBlocked,
  setRosterSavedKeys,
  setRosterNote,
  setSelected,
}) {
  const refreshExpiredVerification = useCallback(async (staleCandidates, expectedGeneration) => {
    if (!requestId || !Array.isArray(staleCandidates) || staleCandidates.length === 0) {
      return { refreshed: [], failures: [], stale: false };
    }
    const failures = staleCandidates
      .filter((candidate) => Array.isArray(candidate?.manualContactFields) && candidate.manualContactFields.length > 0)
      .map((candidate) => ({
        name: candidate.name || 'Unknown candidate',
        error: 'Manual contact details were not overwritten by automated refresh; confirm the contact again before adding to Invite.',
      }));
    const refreshableCandidates = staleCandidates.filter((candidate) => (
      !Array.isArray(candidate?.manualContactFields) || candidate.manualContactFields.length === 0
    ));
    if (refreshableCandidates.length === 0) {
      return { refreshed: [], failures, stale: false };
    }
    pushProgress(`Refreshing contact verification for ${refreshableCandidates.length} reviewer(s)…`, expectedGeneration);
    const enrichmentResponse = await fetch('/api/reviewer-finder/enrich-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: refreshableCandidates,
        options: { usePubmed: true, useOrcid: true, useSerpSearch: true, useClaudeSearch: true },
        authorInstitution: analysis?.proposalInfo?.authorInstitution || null,
        requestId,
      }),
    });
    let enrichmentResults = null;
    let streamError = null;
    await readSseStream(enrichmentResponse, ({ event, data }) => {
      if (event === 'error' || data?.type === 'error') {
        streamError = data?.message || 'contact verification refresh failed';
        return;
      }
      if (data?.type === 'progress' && data.overall && genRef.current === expectedGeneration) {
        pushProgress(`Refreshing verification ${data.overall.current}/${data.overall.total}…`, expectedGeneration);
      }
      if (data?.type === 'complete') enrichmentResults = data.results;
    });
    if (genRef.current !== expectedGeneration) {
      return { refreshed: [], failures: [], stale: true };
    }
    if (streamError || !Array.isArray(enrichmentResults)) {
      throw new Error(streamError || 'Contact verification refresh returned no results.');
    }

    const merged = mergeEnrichment(refreshableCandidates, enrichmentResults);
    const ready = [];
    for (let index = 0; index < refreshableCandidates.length; index += 1) {
      const before = refreshableCandidates[index];
      const after = merged[index];
      const newReceipt = after?.automatedIdentityAttestation;
      if (!newReceipt || newReceipt === before?.automatedIdentityAttestation) {
        failures.push({
          name: before?.name || 'Unknown candidate',
          error: 'Contact verification could not be refreshed.',
        });
      } else {
        ready.push(after);
      }
    }

    // POST one row at a time because the roster endpoint returns a count, not
    // per-row identifiers. A recorded=1 response is therefore an exact durable
    // acknowledgement for this candidate; recorded=0 stays retryable.
    const refreshed = [];
    for (const candidate of ready) {
      if (genRef.current !== expectedGeneration) {
        return { refreshed, failures, stale: true };
      }
      const { ok: rosterOk, data: rosterData } = await requestEnvelope('/api/workbench/reviewer-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          candidates: [pruneCandidateForRoster(candidate)],
        }),
        tolerantBody: true,
      });
      if (genRef.current !== expectedGeneration) {
        return { refreshed, failures, stale: true };
      }
      if (rosterOk && rosterData.success && rosterData.recorded === 1) {
        refreshed.push(candidate);
      } else {
        failures.push({
          name: candidate.name || 'Unknown candidate',
          error: rosterData.error || 'Refreshed verification could not be written to the active roster.',
        });
      }
    }
    return {
      refreshed,
      failures,
      stale: genRef.current !== expectedGeneration,
    };
  }, [requestId, analysis, genRef, pushProgress]);

  const saveSelected = useCallback(async (candidateKeys = selected) => {
    const myGen = genRef.current;
    if (savingRef.current === myGen) return;
    // Filter by isSelectable too (not just `selected`): a needs-identity-review row
    // can't be checked, but this guarantees one never reaches save-candidates even if
    // a stale `selected` entry survives a reclassification (defense-in-depth; the
    // server 422s these anyway).
    const keysToSave = candidateKeys instanceof Set ? candidateKeys : selected;
    const chosen = displayCandidates.filter((c) => keysToSave.has(candKey(c)) && isCandidateSelectable(c));
    if (chosen.length === 0) return;
    savingRef.current = myGen;
    const isCurrent = () => genRef.current === myGen;
    setSavingCount(chosen.length);
    setPhase('saving');
    setError(null); setErrorMeta(null); setProgress([]); setPromotionNotice(null);
    try {
      // Candidates were already enriched at results time (stage 4 of runSearch),
      // so the chosen rows carry contact info + bibliometrics — save them directly.
      const applicantChosen = [];
      const toSave = [];
      const failures = [];
      for (const c of chosen) {
        if (provenanceKindOf(c) === PROVENANCE_KINDS.APPLICANT_SUGGESTED) {
          if (c.suggestionId) applicantChosen.push(c);
          else failures.push({ name: c.name || 'Applicant-referred reviewer', error: 'missing suggestionId' });
        } else {
          toSave.push(c);
        }
      }

      let saved = 0;
      let savedKeys = [];
      let savedResultRosterKeys = [];
      let savedRosterKeys = [];
      let blockedRosterKeys = [];
      let expiredRosterKeys = [];
      let addressVerificationKeys = [];
      let addressRepairKeys = [];
      let identityReviewResults = [];
      let serverRepairResults = [];
      let needsRosterReload = false;
      let refreshedVerificationCandidates = [];
      const rosterWarnings = [];
      if (toSave.length > 0) {
        pushProgress(`Saving ${toSave.length} candidate(s)…`, myGen);
        let receivedResponse = false;
        try {
          const { ok: sOk, status: sStatus, data: sData } = await requestEnvelope('/api/reviewer-finder/save-candidates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId,
              proposalTitle: analysis?.proposalInfo?.title || null,
              programArea: analysis?.proposalInfo?.programArea || null,
              candidates: toSave,
            }),
            tolerantBody: true,
          });
          receivedResponse = true;
          const saveResults = Array.isArray(sData.results) ? sData.results : [];
          const correlatedSaveResults = correlateSaveResultsToRosterCandidates(saveResults, toSave);
          const recordRepairCodes = new Set([
            'person_inactive',
            'email_conflict',
            'ambiguous_email_owner',
            'inactive_email_owner',
            'contact_linked_elsewhere',
          ]);
          saved = sData.savedCount || 0;
          savedKeys = Array.isArray(sData.savedKeys) ? sData.savedKeys : [];
          const correlatedSavedKeyResults = correlateSaveResultsToRosterCandidates(
            savedKeys.map((candidateKey) => ({ candidateKey })),
            toSave,
          );
          savedResultRosterKeys = Array.from(new Set([
            ...correlatedSaveResults
              .filter((result) => (
                result?.outcome === 'saved'
                && typeof result?.rosterCandidateKey === 'string'
              ))
              .map((result) => result.rosterCandidateKey),
            ...correlatedSavedKeyResults
              .filter((result) => typeof result?.rosterCandidateKey === 'string')
              .map((result) => result.rosterCandidateKey),
          ]));
          blockedRosterKeys = correlatedSaveResults
            .filter((result) => (
              result?.outcome === 'failed'
              && result?.code === 'applicant_excluded'
              && typeof result?.rosterCandidateKey === 'string'
            ))
            .map((result) => result.rosterCandidateKey);
          expiredRosterKeys = correlatedSaveResults
            .filter((result) => (
              result?.code === 'identity_attestation_required'
              && typeof result?.rosterCandidateKey === 'string'
            ))
            .map((result) => result.rosterCandidateKey);
          addressVerificationKeys = correlatedSaveResults
            .filter((result) => (
              result?.code === 'address_verification_required'
              && typeof result?.rosterCandidateKey === 'string'
            ))
            .map((result) => result.rosterCandidateKey);
          addressRepairKeys = correlatedSaveResults
            .filter((result) => (
              result?.code === 'conflict_record_unavailable'
              && typeof result?.rosterCandidateKey === 'string'
            ))
            .map((result) => result.rosterCandidateKey);
          identityReviewResults = correlatedSaveResults.filter((result) => (
            result?.decision === 'identity_choice_required'
            && !recordRepairCodes.has(result?.code)
            && typeof result?.rosterCandidateKey === 'string'
          ));
          serverRepairResults = correlatedSaveResults.filter((result) => (
            recordRepairCodes.has(result?.code)
            && typeof result?.rosterCandidateKey === 'string'
          ));
          needsRosterReload = saveResults.some((result) => (
            result?.outcome === 'saved' && result?.rosterFinalized === false
          ));
          if (needsRosterReload) {
            rosterWarnings.push('A reviewer was saved, but the Find roster could not be finalized.');
          }
          if (Array.isArray(sData.errors)) failures.push(...sData.errors);
          if ((!sOk || !sData.success) && saved === 0) {
            const detail = formatSaveFailureDetails(sData.errors);
            failures.push({
              name: 'Add to Invite',
              error: detail
                ? `${sData.error || `Save failed (${sStatus})`} ${detail}`
                : (sData.error || `Save failed (${sStatus})`),
            });
          }
        } catch (e) {
          if (!receivedResponse && requestId) {
            // The request may have committed before the connection failed. Treat
            // this as unknown-outcome and reload the server-owned roster before a
            // retry can create another person/suggestion.
            try {
              const rosterData = await reloadRoster(myGen);
              if (isCurrent() && rosterData) {
                const currentSavedKeys = Array.isArray(rosterData.savedKeys) ? rosterData.savedKeys : [];
                savedRosterKeys = currentSavedKeys;
                saved = toSave.filter((candidate) => currentSavedKeys.includes(candKey(candidate))).length;
              }
            } catch { /* retain unknown-outcome error below */ }
          }
          const knownSavedRosterKeys = new Set([...savedResultRosterKeys, ...savedRosterKeys]);
          failures.push(...toSave
            .filter((candidate) => !knownSavedRosterKeys.has(candKey(candidate)))
            .map((c) => ({
              name: c.name || 'Unknown candidate',
              error: receivedResponse ? e.message : 'Save outcome is unknown; roster state was refreshed before retry.',
            })));
        }

        const expiredSet = new Set(expiredRosterKeys);
        const expiredCandidates = toSave.filter((candidate) => expiredSet.has(candKey(candidate)));
        if (expiredCandidates.length > 0 && isCurrent()) {
          try {
            const refreshResult = await refreshExpiredVerification(expiredCandidates, myGen);
            if (refreshResult.stale || !isCurrent()) return;
            refreshedVerificationCandidates = refreshResult.refreshed;
            failures.unshift(...refreshResult.failures);
            if (refreshedVerificationCandidates.length > 0) {
              rosterWarnings.push(
                `Contact verification was refreshed for ${refreshedVerificationCandidates.length} reviewer`
                + `${refreshedVerificationCandidates.length === 1 ? '' : 's'}. Review the updated contact details, then add to Invite again.`,
              );
            }
            if (refreshResult.failures.length > 0) {
              rosterWarnings.push(
                `Verification could not be refreshed for ${refreshResult.failures.length} reviewer`
                + `${refreshResult.failures.length === 1 ? '' : 's'}; those rows remain unchanged and retryable.`,
              );
            }
          } catch (refreshError) {
            failures.push({
              name: 'Contact verification refresh',
              error: refreshError.message,
            });
          }
        }
      }
      if (!isCurrent()) return;

      let promoted = 0;
      const promotedCandidates = [];
      if (applicantChosen.length > 0) {
        if (isCurrent()) pushProgress(`Adding ${applicantChosen.length} applicant-referred reviewer(s) to Invite…`, myGen);
        const results = await Promise.all(applicantChosen.map(async (c) => {
          try {
            // Carry the PD's hand-corrections (ONLY the fields marked manual) so the
            // promote route persists them instead of dropping them. Send VALUES only —
            // the server writes to the suggestion's own person record, never a
            // client-supplied id, and forces email/website provenance to 'manual'.
            const manualFields = Array.isArray(c.manualContactFields) ? c.manualContactFields : [];
            const contact = {};
            if (manualFields.includes('email')) contact.email = c.email || null;
            if (manualFields.includes('website')) contact.website = c.website || null;
            if (manualFields.includes('affiliation')) contact.affiliation = c.affiliation || null;
            if (manualFields.includes('hIndex')) contact.hIndex = c.hIndex ?? null;
            const body = { requestId, suggestionId: c.suggestionId };
            if (Object.keys(contact).length > 0) body.contact = contact;

            const { ok, status, data } = await requestEnvelope('/api/workbench/promote-applicant-reviewer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              tolerantBody: true,
            });
            if (!ok || !data.success) {
              const error = new Error(data.message || data.error || `Adding to Invite failed (${status})`);
              error.code = data.code || null;
              throw error;
            }
            return {
              ok: true,
              candidate: c,
              rosterFinalized: data.rosterFinalized === true,
            };
          } catch (e) {
            return { ok: false, candidate: c, error: e.message, code: e.code || null };
          }
        }));
        for (const result of results) {
          if (result.ok) {
            promoted += 1;
            promotedCandidates.push(result.candidate);
            if (!result.rosterFinalized) {
              needsRosterReload = true;
              rosterWarnings.push('An applicant-referred reviewer was added, but the Find roster could not be finalized.');
            }
          } else {
            failures.push({ name: result.candidate.name || 'Applicant-referred reviewer', error: result.error });
            if (result.code === 'address_verification_required') {
              addressVerificationKeys.push(candKey(result.candidate));
            } else if (result.code === 'conflict_record_unavailable') {
              addressRepairKeys.push(candKey(result.candidate));
            } else if (new Set(['person_inactive', 'email_conflict', 'ambiguous_email_owner', 'inactive_email_owner', 'contact_linked_elsewhere']).has(result.code)) {
              serverRepairResults.push({
                rosterCandidateKey: candKey(result.candidate),
                code: result.code,
              });
            }
          }
        }
      }

      // The server owns the durable `saved` transition. The browser only
      // reconciles exact successful keys into its current view.
      if (savedResultRosterKeys.length > 0 || savedRosterKeys.length > 0) {
        const savedSet = new Set([...savedResultRosterKeys, ...savedRosterKeys]);
        const wasSaved = (candidate) => savedSet.has(candKey(candidate));
        if (isCurrent()) {
          const matchedSavedCandidates = displayCandidates.filter(wasSaved);
          const matchedSavedRosterKeys = matchedSavedCandidates.map(candKey).filter(Boolean);
          setCandidates((prev) => prev.filter((c) => !wasSaved(c)));
          setRosterActive((prev) => prev.filter((c) => !wasSaved(c)));
          setRosterSavedKeys((prev) => Array.from(new Set([...prev, ...matchedSavedRosterKeys])));
          setSelected((prev) => {
            const next = new Set(prev);
            matchedSavedCandidates.forEach((candidate) => next.delete(candKey(candidate)));
            return next;
          });
        }
      }
      if (blockedRosterKeys.length > 0 && isCurrent()) {
        const blockedSet = new Set(blockedRosterKeys);
        const wasBlocked = (candidate) => blockedSet.has(candKey(candidate));
        const blockedCandidates = displayCandidates
          .filter(wasBlocked)
          .map((candidate) => ({
            ...candidate,
            promotionDecision: 'blocked_applicant_excluded',
            promotionBlockCode: 'applicant_excluded',
            promotionBlockReason: 'This reviewer is applicant-excluded for the request and cannot be added to Invite.',
          }));
        setCandidates((prev) => prev.filter((candidate) => !wasBlocked(candidate)));
        setRecCandidates((prev) => prev.filter((candidate) => !wasBlocked(candidate)));
        setRosterActive((prev) => prev.filter((candidate) => !wasBlocked(candidate)));
        setRosterBlocked((prev) => dedupeByName([...blockedCandidates, ...prev]));
        setSelected((prev) => {
          const next = new Set(prev);
          displayCandidates.filter(wasBlocked).forEach((candidate) => next.delete(candKey(candidate)));
          return next;
        });
      }
      if (refreshedVerificationCandidates.length > 0 && isCurrent()) {
        const refreshedByRosterKey = new Map(
          refreshedVerificationCandidates.map((candidate) => [candKey(candidate), candidate]),
        );
        const applyRefresh = (candidate) => refreshedByRosterKey.get(candKey(candidate)) || candidate;
        setCandidates((prev) => prev.map(applyRefresh));
        setRecCandidates((prev) => prev.map(applyRefresh));
        setRosterActive((prev) => prev.map(applyRefresh));
        setSelected((prev) => {
          const next = new Set(prev);
          refreshedVerificationCandidates.forEach((candidate) => next.delete(candKey(candidate)));
          return next;
        });
      }

      if ((addressVerificationKeys.length > 0 || addressRepairKeys.length > 0) && isCurrent()) {
        const verificationSet = new Set(addressVerificationKeys);
        const repairSet = new Set(addressRepairKeys);
        const exposeRemedy = (candidate) => {
          const key = candKey(candidate);
          if (!verificationSet.has(key) && !repairSet.has(key)) return candidate;
          return {
            ...candidate,
            addressTrustReceipt: verificationSet.has(key) ? null : candidate.addressTrustReceipt,
            addressVerificationRequired: verificationSet.has(key) || candidate.addressVerificationRequired === true,
            conflictRecordUnavailable: repairSet.has(key) || candidate.conflictRecordUnavailable === true,
          };
        };
        setCandidates((prev) => prev.map(exposeRemedy));
        setRecCandidates((prev) => prev.map(exposeRemedy));
        setRosterActive((prev) => prev.map(exposeRemedy));
        setSelected((prev) => {
          const next = new Set(prev);
          [...addressVerificationKeys, ...addressRepairKeys].forEach((key) => next.delete(key));
          return next;
        });
        if (addressVerificationKeys.length > 0) {
          rosterWarnings.push('Address verification is required. Use “Verify address” on each affected reviewer, then add to Invite again.');
        }
        if (addressRepairKeys.length > 0) {
          rosterWarnings.push('A conflict safety record could not be written. Retry from the reviewer card or create a durable repair request.');
        }
      }

      if (identityReviewResults.length > 0 && isCurrent()) {
        const reasonByKey = new Map(identityReviewResults.map((result) => [
          result.rosterCandidateKey,
          result.code || 'ambiguous_or_name_mismatch',
        ]));
        const exposeIdentityRemedy = (candidate) => {
          const reason = reasonByKey.get(candKey(candidate));
          return reason ? { ...candidate, serverIdentityReviewReason: reason } : candidate;
        };
        setCandidates((prev) => prev.map(exposeIdentityRemedy));
        setRecCandidates((prev) => prev.map(exposeIdentityRemedy));
        setRosterActive((prev) => prev.map(exposeIdentityRemedy));
        setSelected((prev) => {
          const next = new Set(prev);
          identityReviewResults.forEach((result) => next.delete(result.rosterCandidateKey));
          return next;
        });
        rosterWarnings.push('Dataverse identity evidence needs review. Use “Confirm identity” to verify the person and exact address, or set the reviewer aside.');
      }

      if (serverRepairResults.length > 0 && isCurrent()) {
        const reasonByKey = new Map(serverRepairResults.map((result) => [
          result.rosterCandidateKey,
          result.code || 'record_repair_required',
        ]));
        const exposeRepair = (candidate) => {
          const reason = reasonByKey.get(candKey(candidate));
          return reason ? { ...candidate, serverRepairReason: reason } : candidate;
        };
        setCandidates((prev) => prev.map(exposeRepair));
        setRecCandidates((prev) => prev.map(exposeRepair));
        setRosterActive((prev) => prev.map(exposeRepair));
        setSelected((prev) => {
          const next = new Set(prev);
          serverRepairResults.forEach((result) => next.delete(result.rosterCandidateKey));
          return next;
        });
        rosterWarnings.push('Fix the identified reviewer record in AkoyaGO, then use “Retry record check” on the affected card.');
      }

      const totalSucceeded = saved + promoted;
      if (totalSucceeded === 0) {
        if (refreshedVerificationCandidates.length > 0 && isCurrent()) {
          const warning = Array.from(new Set(rosterWarnings)).join(' ');
          setRosterNote(warning);
          setPromotionNotice({ tone: 'warning', message: warning });
          setPhase('results');
          return;
        }
        if ((addressVerificationKeys.length > 0 || addressRepairKeys.length > 0) && isCurrent()) {
          const warning = Array.from(new Set(rosterWarnings)).join(' ');
          setRosterNote(warning);
          setPromotionNotice({ tone: 'warning', message: warning });
          setPhase('results');
          return;
        }
        if (identityReviewResults.length > 0 && isCurrent()) {
          const warning = Array.from(new Set(rosterWarnings)).join(' ');
          setRosterNote(warning);
          setPromotionNotice({ tone: 'warning', message: warning });
          setPhase('results');
          return;
        }
        if (serverRepairResults.length > 0 && isCurrent()) {
          const warning = Array.from(new Set(rosterWarnings)).join(' ');
          setRosterNote(warning);
          setPromotionNotice({ tone: 'warning', message: warning });
          setPhase('results');
          return;
        }
        const detail = formatSaveFailureDetails(failures);
        throw new Error(detail ? `No candidates were saved: ${detail}` : 'No candidates were saved.');
      }

      const messageParts = [];
      if (saved > 0) messageParts.push(`Saved ${saved} of ${toSave.length} to this request's candidate pool.`);
      if (promoted > 0) messageParts.push(`Added ${promoted} of ${applicantChosen.length} applicant-referred reviewer${applicantChosen.length === 1 ? '' : 's'} to Invite.`);
      if (failures.length > 0) {
        const detail = failures.map((f) => `${f.name || 'Unknown candidate'}: ${f.error || 'failed'}`).join('; ');
        messageParts.push(`${failures.length} could not be saved (${detail}).`);
      }
      if (isCurrent()) {
        const message = messageParts.join(' ');
        setPromotionNotice({ tone: 'success', message });
        setPhase('done');
      }
      if (promotedCandidates.length > 0) {
        const promotedKeys = new Set(promotedCandidates.map(candKey));
        if (isCurrent()) {
          setCandidates((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
          setRecCandidates((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
          setRosterActive((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
          setSelected((prev) => { const next = new Set(prev); promotedKeys.forEach((k) => next.delete(k)); return next; });
        }
        if (isCurrent()) {
          setRosterSavedKeys((prev) => Array.from(new Set([...prev, ...promotedKeys])));
        }
      }
      if (needsRosterReload && isCurrent()) {
        const snapshot = await reloadRoster(myGen);
        if (isCurrent()) {
          rosterWarnings.push(snapshot
            ? 'The server-owned roster was reloaded before another attempt.'
            : 'Reload this request before another attempt.');
        }
      }
      if (isCurrent() && rosterWarnings.length > 0) {
        setRosterNote(Array.from(new Set(rosterWarnings)).join(' '));
      }
      if (isCurrent() && onSaved && totalSucceeded > 0) onSaved();
    } catch (e) {
      if (isCurrent()) {
        setError(e.message);
        setPromotionNotice({ tone: 'error', message: e.message });
        setPhase('error');
      }
    } finally {
      if (savingRef.current === myGen) savingRef.current = null;
      if (isCurrent()) setSavingCount(0);
    }
  }, [
    displayCandidates,
    selected,
    requestId,
    analysis,
    onSaved,
    genRef,
    savingRef,
    pushProgress,
    refreshExpiredVerification,
    reloadRoster,
    setSavingCount,
    setPhase,
    setError,
    setErrorMeta,
    setProgress,
    setPromotionNotice,
    setCandidates,
    setRecCandidates,
    setRosterActive,
    setRosterBlocked,
    setRosterSavedKeys,
    setRosterNote,
    setSelected,
  ]);

  return { refreshExpiredVerification, saveSelected };
}
