/**
 * Ownership: operation hook: owns roster loading command; controller owns state and view modules render.
 */
import { useCallback, useRef } from 'react';
import { requestEnvelope } from '../../../utils/api-request';
import { parseReviewerRosterRetention } from '../reviewer-search-logic';

export default function useReviewerRoster({
  requestId,
  genRef,
  runningRef,
  setRosterActive,
  setRosterExcluded,
  setRosterIneligible,
  setRosterBlocked,
  setRosterHandled,
  setRosterSavedKeys,
  setRosterNames,
  setRosterRetention,
  setRepairRequestsByCandidateKey,
  setRepairRequestsUnavailable,
  setRosterLoaded,
  setRosterLoadFailed,
  setRosterNote,
}) {
  const operationRef = useRef(0);
  const applyRosterSnapshot = useCallback((data) => {
    setRosterActive(Array.isArray(data?.active) ? data.active : []);
    setRosterExcluded(Array.isArray(data?.excluded) ? data.excluded : []);
    setRosterIneligible(Array.isArray(data?.ineligible) ? data.ineligible : []);
    setRosterBlocked(Array.isArray(data?.blocked) ? data.blocked : []);
    setRosterHandled(Array.isArray(data?.handled) ? data.handled : []);
    setRosterSavedKeys(Array.isArray(data?.savedKeys) ? data.savedKeys : []);
    setRosterNames(Array.isArray(data?.allNames) ? data.allNames : []);
    if (parseReviewerRosterRetention(data?.retention)) {
      setRosterRetention(data.retention);
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'repairRequests')) {
      setRepairRequestsByCandidateKey(Object.fromEntries(
        (Array.isArray(data.repairRequests) ? data.repairRequests : [])
          .filter((request) => request?.candidateKey)
          .map((request) => [request.candidateKey, request]),
      ));
      setRepairRequestsUnavailable(data?.repairRequestsUnavailable === true);
    }
  }, [
    setRosterActive,
    setRosterExcluded,
    setRosterIneligible,
    setRosterBlocked,
    setRosterHandled,
    setRosterSavedKeys,
    setRosterNames,
    setRosterRetention,
    setRepairRequestsByCandidateKey,
    setRepairRequestsUnavailable,
  ]);

  const reloadRoster = useCallback(async (expectedGeneration = genRef.current) => {
    if (!requestId) return null;
    const operationId = ++operationRef.current;
    let envelope;
    try {
      envelope = await requestEnvelope(
        `/api/workbench/reviewer-roster?requestId=${encodeURIComponent(requestId)}`,
        { tolerantBody: true },
      );
    } catch {
      if (genRef.current === expectedGeneration && operationRef.current === operationId) {
        setRosterLoaded(false);
        setRosterLoadFailed(true);
      }
      return null;
    }
    const { ok, data } = envelope;
    if (genRef.current !== expectedGeneration || operationRef.current !== operationId) return null;
    if (!ok || !data?.success) {
      setRosterLoaded(false);
      setRosterLoadFailed(true);
      return null;
    }
    const hasCompleteRetention = parseReviewerRosterRetention(data?.retention) instanceof Map;
    if (!hasCompleteRetention) {
      setRosterLoaded(false);
      setRosterLoadFailed(true);
      return data;
    }
    applyRosterSnapshot(data);
    setRosterLoaded(true);
    setRosterLoadFailed(false);
    return data;
  }, [requestId, genRef, applyRosterSnapshot, setRosterLoaded, setRosterLoadFailed]);

  const invalidateRosterReads = useCallback(() => {
    operationRef.current += 1;
  }, []);

  const retryRosterLoad = useCallback(async () => {
    const myGen = genRef.current;
    if (runningRef && runningRef.current !== null) return;
    if (runningRef) runningRef.current = myGen;
    setRosterLoaded(false);
    setRosterLoadFailed(false);
    setRosterNote(null);
    const operationId = operationRef.current + 1;
    try {
      const snapshot = await reloadRoster(myGen);
      if (genRef.current !== myGen || operationRef.current !== operationId) return;
      if (snapshot && parseReviewerRosterRetention(snapshot.retention) instanceof Map) {
        setRosterLoaded(true);
        setRosterLoadFailed(false);
      } else {
        setRosterLoaded(false);
        setRosterLoadFailed(true);
        setRosterNote('Reviewer engagement could not be reconciled. Retry before searching.');
      }
    } catch {
      if (genRef.current === myGen && operationRef.current === operationId) {
        setRosterLoaded(false);
        setRosterLoadFailed(true);
        setRosterNote('Reviewer engagement could not be reconciled. Retry before searching.');
      }
    } finally {
      if (runningRef?.current === myGen) runningRef.current = null;
    }
  }, [genRef, runningRef, reloadRoster, setRosterLoaded, setRosterLoadFailed, setRosterNote]);

  return { applyRosterSnapshot, reloadRoster, retryRosterLoad, invalidateRosterReads };
}
