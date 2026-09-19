import { useCallback } from 'react';
import { pruneCandidateForRoster } from '../reviewer-search-logic';
import { candKey, dedupeByName } from './candidateKeys';

export default function useReviewerRosterActions({
  requestId,
  genRef,
  busy,
  removingPrevious,
  rosterNames,
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
  setRosterNames,
  setSelected,
  setRosterNote,
  setRemovingPrevious,
}) {
  const excludeCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId) return;
    const myGen = genRef.current;
    const pruned = pruneCandidateForRoster(cand);
    setCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRecCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterExcluded((prev) => dedupeByName([pruned, ...prev]));
    setRosterNames((prev) => Array.from(new Set([...prev, cand.name])));
    setSelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
    try {
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'exclude', candidate: pruned }),
      });
      if (!res.ok) throw new Error('exclude failed');
    } catch {
      // Roll back the optimistic move so the card isn't silently lost.
      if (genRef.current === myGen) {
        setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
        setRosterActive((prev) => dedupeByName([pruned, ...prev]));
        setRosterNote("Couldn't exclude that reviewer — please try again.");
      }
    }
  }, [requestId, genRef, setCandidates, setRecCandidates, setRosterActive, setRosterExcluded, setRosterNames, setSelected, setRosterNote]);

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
    const nameAlreadyInRoster = rosterNames.includes(cand.name);
    setRosterExcluded((prev) => dedupeByName([pruned, ...prev]));
    setRosterNames((prev) => Array.from(new Set([...prev, cand.name])));
    try {
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'exclude', candidate: pruned }),
      });
      if (!res.ok) throw new Error('exclude failed');
    } catch {
      if (genRef.current === myGen) {
        setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
        if (!nameAlreadyInRoster) {
          setRosterNames((prev) => prev.filter((name) => name !== cand.name));
        }
        setRosterNote("Couldn't exclude that reviewer — please try again.");
      }
    }
  }, [requestId, genRef, rosterNames, setRosterExcluded, setRosterNames, setRosterNote]);

  // Promote an excluded candidate back to the active, selectable list.
  const promoteCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!key || !requestId) return;
    const myGen = genRef.current;
    setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => dedupeByName([cand, ...prev]));
    try {
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'promote', candidateKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (genRef.current !== myGen) return;
      if (res.status === 409 && [
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
      if (!res.ok || !data.success) throw new Error(data.error || 'promote failed');
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
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          action: 'remove_previous_results',
          candidateRefs: previousSearchRefs,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (genRef.current !== myGen) return;
      if (!res.ok || !data.success) throw new Error(data.error || 'remove failed');
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
