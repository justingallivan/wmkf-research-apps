/**
 * Ownership: operation hook: owns roster action commands; controller owns state and view modules render.
 */
import { useCallback } from 'react';
import { parseReviewerRosterRetention, pruneCandidateForRoster } from '../reviewer-search-logic';
import { candKey, dedupeByName } from './candidateKeys';
import { requestJson, requestEnvelope } from '../../../utils/api-request';

export default function useReviewerRosterActions({
  requestId,
  genRef,
  runningRef,
  busy,
  removingPrevious,
  rosterNames,
  previousSearchKeys,
  previousSearchRefs,
  reloadRoster,
  applyRosterSnapshot,
  invalidateRosterReads,
  setRosterLoaded,
  setRosterLoadFailed,
  setCandidates,
  setRecCandidates,
  setRosterActive,
  setRosterExcluded,
  setRosterNames,
  setSelected,
  setRosterNote,
  setRemovingPrevious,
}) {
  const excludeCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId || busy || (runningRef && runningRef.current !== null)) return;
    const myGen = genRef.current;
    if (runningRef) runningRef.current = myGen;
    const pruned = pruneCandidateForRoster(cand);
    setCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRecCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterExcluded((prev) => dedupeByName([pruned, ...prev]));
    setRosterNames((prev) => Array.from(new Set([...prev, cand.name])));
    setSelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
    try {
      await requestJson('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'exclude', candidate: pruned }),
        tolerantBody: true,
        fallbackMessage: 'exclude failed',
      });
    } catch {
      // Roll back the optimistic move so the card isn't silently lost.
      if (genRef.current === myGen) {
        setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
        setRosterActive((prev) => dedupeByName([pruned, ...prev]));
        setRosterNote("Couldn't exclude that reviewer — please try again.");
      }
    } finally {
      if (runningRef?.current === myGen) runningRef.current = null;
    }
  }, [requestId, genRef, runningRef, busy, setCandidates, setRecCandidates, setRosterActive, setRosterExcluded, setRosterNames, setSelected, setRosterNote]);

  // Exclude an ephemeral unverified suggestion. Same durable PATCH (the server
  // exclude is an upsert, so no prior roster row is needed), but the rollback
  // differs from excludeCandidate: the row never left `unverified` — it is only
  // masked while its key sits in rosterExcluded — so a failure must NOT restore
  // it into rosterActive (it was never active).
  const excludeUnverifiedCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId || busy || (runningRef && runningRef.current !== null)) return;
    const myGen = genRef.current;
    if (runningRef) runningRef.current = myGen;
    const pruned = pruneCandidateForRoster(cand);
    const nameAlreadyInRoster = rosterNames.includes(cand.name);
    setRosterExcluded((prev) => dedupeByName([pruned, ...prev]));
    setRosterNames((prev) => Array.from(new Set([...prev, cand.name])));
    try {
      await requestJson('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'exclude', candidate: pruned }),
        tolerantBody: true,
        fallbackMessage: 'exclude failed',
      });
    } catch {
      if (genRef.current === myGen) {
        setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
        if (!nameAlreadyInRoster) {
          setRosterNames((prev) => prev.filter((name) => name !== cand.name));
      }
      setRosterNote("Couldn't exclude that reviewer — please try again.");
      }
    } finally {
      if (runningRef?.current === myGen) runningRef.current = null;
    }
  }, [requestId, genRef, runningRef, busy, rosterNames, setRosterExcluded, setRosterNames, setRosterNote]);

  // Promote an excluded candidate back to the active, selectable list.
  const promoteCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId || busy || (runningRef && runningRef.current !== null)) return;
    const myGen = genRef.current;
    if (runningRef) runningRef.current = myGen;
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
    } finally {
      if (runningRef?.current === myGen) runningRef.current = null;
    }
  }, [requestId, genRef, runningRef, busy, reloadRoster, setRosterExcluded, setRosterActive, setRosterNote]);

  const removePreviousResults = useCallback(async () => {
    if (!requestId || busy || removingPrevious || (runningRef && runningRef.current !== null) || previousSearchRefs.length === 0) return;
    const count = previousSearchKeys.size;
    if (!window.confirm(`Remove ${count} previously found reviewer${count === 1 ? '' : 's'} from this request? Applicant-recommended, saved, excluded, and COI records will be kept.`)) return;
    const myGen = genRef.current;
    if (runningRef) runningRef.current = myGen;
    setRemovingPrevious(true);
    invalidateRosterReads?.();
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
      if (genRef.current !== myGen) return;
      if (!(parseReviewerRosterRetention(data.retention) instanceof Map)) {
        setRosterLoaded(false);
        setRosterLoadFailed(true);
        setRosterNote('Previous results were removed, but the complete roster could not be confirmed. Retry reviewer state before continuing.');
      } else {
        applyRosterSnapshot(data);
        setRosterLoaded(true);
        setRosterLoadFailed(false);
        setRosterNote(`${data.removed || 0} previous search result${data.removed === 1 ? '' : 's'} removed.`);
      }
      setSelected((prev) => {
        const next = new Set(prev);
        for (const key of Array.isArray(data.removedKeys) ? data.removedKeys : []) next.delete(key);
        return next;
      });
    } catch {
      if (genRef.current === myGen) {
        setRosterLoaded(false);
        setRosterLoadFailed(true);
        setRosterNote('The removal may have completed, but the current roster could not be confirmed. Retry reviewer state before continuing.');
      }
    } finally {
      if (genRef.current === myGen) setRemovingPrevious(false);
      if (runningRef?.current === myGen) runningRef.current = null;
    }
  }, [requestId, busy, removingPrevious, previousSearchRefs, previousSearchKeys, genRef, runningRef, setRemovingPrevious, setRosterNote, setRosterLoaded, setRosterLoadFailed, setSelected, applyRosterSnapshot, invalidateRosterReads]);

  return { excludeCandidate, excludeUnverifiedCandidate, promoteCandidate, removePreviousResults };
}
