/**
 * Ownership: operation hook: owns applicant enrichment commands/effect; controller owns state and view modules render.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { readSseStream } from '../sse';
import {
  applicantTerminalSuggestionKeys,
  hasValidApplicantEnrichmentCache,
  pruneCandidateForRoster,
} from '../reviewer-search-logic';
import { reviewerEngagementProjection } from '../../../utils/reviewer-engagement';
import { dedupeByName } from './candidateKeys';

export default function useApplicantReviewerEnrichment({
  blobUrl,
  proposalKey,
  requestId,
  analysis,
  recommended,
  rosterExcluded,
  rosterSavedKeys,
  rosterActive,
  rosterIneligible,
  rosterLoaded,
  recPhase,
  recRunningRef,
  genRef,
  mountedRef,
  setRecPhase,
  setRecError,
  setRecProgress,
  setRecCandidates,
  setRecHandled,
  setRosterIneligible,
}) {
  // Run the applicant-recommended reviewers through the full verify→COI→enrich
  // pipeline (server-side) and write the enrichment back to their existing rows.
  // Independent of the search; reuses the search's `analysis` when present so the
  // server can skip a second analyze call.
  const enrichRecommended = useCallback(async () => {
    const myGen = genRef.current;
    if (!blobUrl || !proposalKey || recRunningRef.current !== null) return;
    recRunningRef.current = myGen;
    setRecPhase('running'); setRecError(null); setRecProgress([]); setRecCandidates([]); setRecHandled([]);
    try {
      if (genRef.current !== myGen) return; // abort if context changed before the request fires
      // eslint-disable-next-line no-restricted-syntax -- raw fetch: SSE stream via reviewers/sse.js; allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
      const res = await fetch('/api/workbench/enrich-recommended', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, blobUrl, proposalKey, analysisResult: analysis || undefined }),
      });
      let result = null;
      let handledResult = [];
      let streamError = null;
      await readSseStream(res, ({ event, data }) => {
        if (event === 'error') { streamError = data?.message || 'Enrichment failed'; return; }
        if (data?.error) { streamError = data.error; return; }
        if (data?.message && mountedRef.current && genRef.current === myGen) {
          setRecProgress((p) => [...p.slice(-6), data.message]);
        }
        if (data?.recommended) result = data.recommended;
        if (Array.isArray(data?.handled)) handledResult = data.handled;
      });
      if (streamError) throw new Error(streamError);
      if (genRef.current !== myGen) return; // context changed — abort
      const recommendedResults = Array.isArray(result) ? result : [];
      setRecHandled(handledResult);
      setRecCandidates(recommendedResults.filter((candidate) => (
        (candidate.eligibilityStatus || candidate.contactEnrichment?.eligibilityStatus) !== 'deceased'
      )));
      setRosterIneligible((prev) => dedupeByName([
        ...recommendedResults
          .filter((candidate) => (
            (candidate.eligibilityStatus || candidate.contactEnrichment?.eligibilityStatus) === 'deceased'
          ))
          .map(pruneCandidateForRoster),
        ...prev,
      ]));
      setRecPhase('done');
    } catch (e) {
      if (genRef.current === myGen) { setRecError(e.message); setRecPhase('error'); }
    } finally {
      if (recRunningRef.current === myGen) recRunningRef.current = null;
    }
  }, [blobUrl, proposalKey, requestId, analysis, genRef, recRunningRef, mountedRef, setRecPhase, setRecError, setRecProgress, setRecCandidates, setRecHandled, setRosterIneligible]);

  // Auto-trigger applicant enrichment once both the proposal (blobUrl) and the
  // ingested recommendations are ready. Runs independently of the Claude search —
  // enrichment uses blobUrl directly for COI if no prior analysis result exists.
  // Defined after enrichRecommended to avoid a temporal dead zone reference error.
  const terminalApplicantKeys = useMemo(
    () => applicantTerminalSuggestionKeys(rosterExcluded, rosterSavedKeys),
    [rosterExcluded, rosterSavedKeys],
  );
  const actionableRecommended = useMemo(
    () => recommended.filter((row) => !reviewerEngagementProjection(row).handled),
    [recommended],
  );
  const haveValidCache = hasValidApplicantEnrichmentCache(
    [...rosterActive, ...rosterIneligible],
    proposalKey,
    actionableRecommended,
    terminalApplicantKeys,
  );
  useEffect(() => {
    const selectableCount = actionableRecommended.length;
    if (recPhase !== 'idle' || recRunningRef.current) return;
    if (rosterLoaded && haveValidCache) {
      setRecPhase('done');
      return;
    }
    if (blobUrl && proposalKey && selectableCount > 0 && rosterLoaded && !haveValidCache) {
      enrichRecommended();
    }
  }, [blobUrl, proposalKey, actionableRecommended, recPhase, rosterLoaded, haveValidCache, enrichRecommended, recRunningRef, setRecPhase]);

  return { enrichRecommended, terminalApplicantKeys, actionableRecommended, haveValidCache };
}
