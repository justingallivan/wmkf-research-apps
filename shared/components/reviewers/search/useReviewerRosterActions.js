/**
 * Ownership: operation hook: owns roster action commands; controller owns state and view modules render.
 */
import { useCallback, useRef } from 'react';
import { pruneCandidateForRoster } from '../reviewer-search-logic';
import { candKey, dedupeByName } from './candidateKeys';
import { requestEnvelope } from '../../../utils/api-request';

export default function useReviewerRosterActions({
  requestId,
  genRef,
  busy,
  removingPrevious,
  rosterNames,
  selected,
  selectionRevisionRef,
  rosterNamesRevisionRef,
  setExclusionNames,
  setExclusionSelection,
  previousSearchKeys,
  previousSearchRefs,
  reloadRoster,
  setCandidates,
  setRecCandidates,
  setRosterActive,
  setRosterExcluded,
  setRosterIneligible,
  setRosterBlocked,
  setRosterHandled,
  setRosterSavedKeys,
  setUnverified,
  setRosterNames,
  setSelected,
  setRosterNote,
  setRemovingPrevious,
}) {
  // Exclusion-only mutations compose without invalidating sibling recovery.
  // Other roster writers advance the revision, so a newer snapshot wins.
  const nameAttemptsRef = useRef(null);
  const beginNameAttempt = useCallback((name) => {
    const generation = genRef.current;
    const revision = rosterNamesRevisionRef.current;
    let ledger = nameAttemptsRef.current;
    if (!ledger || ledger.generation !== generation || ledger.revision !== revision) {
      ledger = { generation, revision, names: new Map() };
      nameAttemptsRef.current = ledger;
    }
    let entry = ledger.names.get(name);
    if (!entry) {
      entry = { retained: rosterNames.includes(name), pending: 0 };
      ledger.names.set(name, entry);
    }
    entry.pending++;
    setExclusionNames((prev) => prev.includes(name) ? prev : [...prev, name]);
    return {
      revision,
      settle(success) {
        entry.pending--;
        if (success) entry.retained = true;
        if (!success && !entry.retained && entry.pending === 0
          && genRef.current === generation && rosterNamesRevisionRef.current === revision) {
          setExclusionNames((prev) => prev.filter((value) => value !== name));
        }
      },
    };
  }, [genRef, rosterNamesRevisionRef, rosterNames, setExclusionNames]);

  const excludeCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId) return;
    const myGen = genRef.current;
    const pruned = pruneCandidateForRoster(cand);
    const nameAttempt = beginNameAttempt(cand.name);
    const selectionRevision = selectionRevisionRef.current;
    const wasSelected = selected.has(key);
    setCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRecCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterExcluded((prev) => dedupeByName([pruned, ...prev]));
    setExclusionSelection((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev); next.delete(key); return next;
    });
    try {
      const { ok, status, data } = await requestEnvelope('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'exclude', candidate: pruned }),
        tolerantBody: true,
      });
      if (genRef.current !== myGen) return;
      if (status === 409 && data?.code === 'candidate_already_saved') {
        nameAttempt.settle(true);
        setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
        setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
        setUnverified((prev) => prev.filter((c) => candKey(c) !== key));
        let snapshot = null;
        try { snapshot = await reloadRoster(myGen); } catch { /* The server conflict still identifies this saved key. */ }
        if (genRef.current === myGen) {
          setRosterNote(snapshot
            ? 'This reviewer is already on Invite. Remove them from this request on the Invite tab.'
            : 'This reviewer is already on Invite. Reload the reviewer roster before continuing.');
        }
        return;
      }
      if (!ok) throw new Error(data?.error || 'exclude failed');
      nameAttempt.settle(true);
    } catch {
      // Roll back the optimistic move so the card isn't silently lost.
      if (genRef.current === myGen && rosterNamesRevisionRef.current === nameAttempt.revision) {
        setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
        setRosterActive((prev) => dedupeByName([pruned, ...prev]));
        nameAttempt.settle(false);
        if (wasSelected && selectionRevisionRef.current === selectionRevision) {
          setExclusionSelection((prev) => new Set([...prev, key]));
        }
        setRosterNote("Couldn't exclude that reviewer — please try again.");
      } else {
        nameAttempt.settle(false);
        if (genRef.current === myGen) {
          setRosterNote('The reviewer list changed while this action was pending. Check Excluded before trying again.');
        }
      }
    }
  }, [beginNameAttempt, requestId, genRef, reloadRoster, selected, selectionRevisionRef, rosterNamesRevisionRef, setExclusionSelection, setCandidates, setRecCandidates, setRosterActive, setRosterExcluded, setUnverified, setRosterNote]);

  // Exclude an ephemeral unverified suggestion. Same durable PATCH (the server
  // exclude is an upsert, so no prior roster row is needed), but the rollback
  // differs from excludeCandidate: the row never left `unverified` — it is only
  // masked while its key sits in rosterExcluded — so a failure must NOT restore
  // it into rosterActive (it was never active).
  const excludeUnverifiedCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId) return;
    const myGen = genRef.current;
    const pruned = pruneCandidateForRoster(cand);
    const nameAttempt = beginNameAttempt(cand.name);
    setRosterExcluded((prev) => dedupeByName([pruned, ...prev]));
    try {
      const { ok, status, data } = await requestEnvelope('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'exclude', candidate: pruned }),
        tolerantBody: true,
      });
      if (genRef.current !== myGen) return;
      if (status === 409 && data?.code === 'candidate_already_saved') {
        nameAttempt.settle(true);
        setCandidates((prev) => prev.filter((c) => candKey(c) !== key));
        setRecCandidates((prev) => prev.filter((c) => candKey(c) !== key));
        setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
        setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
        setUnverified((prev) => prev.filter((c) => candKey(c) !== key));
        setSelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
        let snapshot = null;
        try { snapshot = await reloadRoster(myGen); } catch { /* The server conflict still identifies this saved key. */ }
        if (genRef.current === myGen) {
          setRosterNote(snapshot
            ? 'This reviewer is already on Invite. Remove them from this request on the Invite tab.'
            : 'This reviewer is already on Invite. Reload the reviewer roster before continuing.');
        }
        return;
      }
      if (!ok) throw new Error(data?.error || 'exclude failed');
      nameAttempt.settle(true);
    } catch {
      if (genRef.current === myGen && rosterNamesRevisionRef.current === nameAttempt.revision) {
        setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
        nameAttempt.settle(false);
        setRosterNote("Couldn't exclude that reviewer — please try again.");
      } else {
        nameAttempt.settle(false);
        if (genRef.current === myGen) {
          setRosterNote('The reviewer list changed while this action was pending. Check Excluded before trying again.');
        }
      }
    }
  }, [beginNameAttempt, requestId, genRef, reloadRoster, rosterNamesRevisionRef, setCandidates, setRecCandidates, setRosterActive, setRosterExcluded, setSelected, setUnverified, setRosterNote]);

  // Promote an excluded candidate back to the active, selectable list.
  const promoteCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId) return;
    const myGen = genRef.current;
    setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => dedupeByName([cand, ...prev]));
    try {
      const { ok, status, data } = await requestEnvelope('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'promote', candidateKey: key }),
        tolerantBody: true,
      });
      if (genRef.current !== myGen) return;
      if (status === 409 && [
        'candidate_not_excluded',
        'reviewer_already_handled',
        'reviewer_anchor_unavailable',
      ].includes(data.code)) {
        const snapshot = await reloadRoster(myGen);
        if (genRef.current === myGen) {
          const stage = data.stage ? ` (${String(data.stage).replaceAll('_', ' ')})` : '';
          setRosterNote(snapshot
            ? `That reviewer is no longer actionable${stage}, so the reviewer roster was reloaded.`
            : 'That reviewer changed elsewhere. Reload this request before continuing.');
        }
        return;
      }
      if (!ok || !data.success) throw new Error(data.error || 'promote failed');
    } catch {
      if (genRef.current === myGen) {
        setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
        setRosterExcluded((prev) => dedupeByName([cand, ...prev]));
        setRosterNote("Couldn't return that reviewer to the active list — please try again.");
      }
    }
  }, [requestId, genRef, reloadRoster, setRosterExcluded, setRosterActive, setRosterNote]);

  const removePreviousResults = useCallback(async () => {
    if (!requestId || busy || removingPrevious || previousSearchRefs.length === 0) return;
    const count = previousSearchKeys.size;
    if (!window.confirm(`Remove ${count} previously found reviewer${count === 1 ? '' : 's'} from this request? Applicant-recommended, saved, excluded, and COI records will be kept.`)) return;
    const myGen = genRef.current;
    setRemovingPrevious(true);
    setRosterNote(null);
    try {
      const { ok, data } = await requestEnvelope('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          action: 'remove_previous_results',
          candidateRefs: previousSearchRefs,
        }),
        tolerantBody: true,
      });
      if (genRef.current !== myGen) return;
      if (!ok || !data.success) throw new Error(data.error || 'remove failed');
      setRosterActive(Array.isArray(data.active) ? data.active : []);
      setRosterExcluded(Array.isArray(data.excluded) ? data.excluded : []);
      setRosterIneligible(Array.isArray(data.ineligible) ? data.ineligible : []);
      setRosterBlocked(Array.isArray(data.blocked) ? data.blocked : []);
      setRosterHandled(Array.isArray(data.handled) ? data.handled : []);
      setRosterSavedKeys(Array.isArray(data.savedKeys) ? data.savedKeys : []);
      setRosterNames(Array.isArray(data.allNames) ? data.allNames : []);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const key of Array.isArray(data.removedKeys) ? data.removedKeys : []) next.delete(key);
        return next;
      });
      setRosterNote(`${data.removed || 0} previous search result${data.removed === 1 ? '' : 's'} removed.`);
    } catch {
      if (genRef.current === myGen) {
        setRosterNote("Couldn't remove the previous search results — please try again.");
      }
    } finally {
      if (genRef.current === myGen) setRemovingPrevious(false);
    }
  }, [requestId, busy, removingPrevious, previousSearchRefs, previousSearchKeys, genRef, setRemovingPrevious, setRosterNote, setRosterActive, setRosterExcluded, setRosterIneligible, setRosterBlocked, setRosterHandled, setRosterSavedKeys, setRosterNames, setSelected]);

  return { excludeCandidate, excludeUnverifiedCandidate, promoteCandidate, removePreviousResults };
}
