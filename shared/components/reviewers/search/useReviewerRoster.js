/**
 * Ownership: operation hook: owns roster loading command; controller owns state and view modules render.
 */
import { useCallback } from 'react';
import { requestEnvelope } from '../../../utils/api-request';

export default function useReviewerRoster({
  requestId,
  genRef,
  setRosterActive,
  setRosterExcluded,
  setRosterIneligible,
  setRosterBlocked,
  setRosterHandled,
  setRosterSavedKeys,
  setRosterNames,
  setRepairRequestsByCandidateKey,
  setRepairRequestsUnavailable,
  setRosterLoaded,
  setRosterLoadFailed,
  setRosterNote,
}) {
  const applyRosterSnapshot = useCallback((data) => {
    setRosterActive(Array.isArray(data?.active) ? data.active : []);
    setRosterExcluded(Array.isArray(data?.excluded) ? data.excluded : []);
    setRosterIneligible(Array.isArray(data?.ineligible) ? data.ineligible : []);
    setRosterBlocked(Array.isArray(data?.blocked) ? data.blocked : []);
    setRosterHandled(Array.isArray(data?.handled) ? data.handled : []);
    setRosterSavedKeys(Array.isArray(data?.savedKeys) ? data.savedKeys : []);
    setRosterNames(Array.isArray(data?.allNames) ? data.allNames : []);
    setRepairRequestsByCandidateKey(Object.fromEntries(
      (Array.isArray(data?.repairRequests) ? data.repairRequests : [])
        .filter((request) => request?.candidateKey)
        .map((request) => [request.candidateKey, request]),
    ));
    setRepairRequestsUnavailable(data?.repairRequestsUnavailable === true);
  }, [
    setRosterActive,
    setRosterExcluded,
    setRosterIneligible,
    setRosterBlocked,
    setRosterHandled,
    setRosterSavedKeys,
    setRosterNames,
    setRepairRequestsByCandidateKey,
    setRepairRequestsUnavailable,
  ]);

  const reloadRoster = useCallback(async (expectedGeneration = genRef.current) => {
    if (!requestId) return null;
    const { ok, data } = await requestEnvelope(
      `/api/workbench/reviewer-roster?requestId=${encodeURIComponent(requestId)}`,
      { tolerantBody: true },
    );
    if (genRef.current !== expectedGeneration) return null;
    if (!ok || !data.success) return null;
    applyRosterSnapshot(data);
    return data;
  }, [requestId, genRef, applyRosterSnapshot]);

  const retryRosterLoad = useCallback(async () => {
    const myGen = genRef.current;
    setRosterLoaded(false);
    setRosterLoadFailed(false);
    setRosterNote(null);
    try {
      const snapshot = await reloadRoster(myGen);
      if (genRef.current !== myGen) return;
      if (snapshot) {
        setRosterLoaded(true);
      } else {
        setRosterLoadFailed(true);
        setRosterNote('Reviewer engagement could not be reconciled. Retry before searching.');
      }
    } catch {
      if (genRef.current === myGen) {
        setRosterLoadFailed(true);
        setRosterNote('Reviewer engagement could not be reconciled. Retry before searching.');
      }
    }
  }, [genRef, reloadRoster, setRosterLoaded, setRosterLoadFailed, setRosterNote]);

  return { applyRosterSnapshot, reloadRoster, retryRosterLoad };
}
