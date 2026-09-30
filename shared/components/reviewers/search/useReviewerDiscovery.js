/**
 * Ownership: operation hook: owns discovery/search command; controller owns state and view modules render.
 */
import { useCallback } from 'react';
import { readSseStream } from '../sse';
import {
  mergeEnrichment,
  parseExcludeList,
  parseReferredSeeds,
  filterExcluded,
  pruneCandidateForRoster,
  withReviewerCandidateKey,
  reviewerCandidateKey,
  parseReviewerRosterOutcomeResponse,
  parseReviewerRosterRetention,
} from '../reviewer-search-logic';
import { rankByRelevance } from '../../../../lib/utils/relevance-score';
import { withReviewerProvenance } from '../../../../lib/utils/reviewer-provenance';
import { dedupeByName } from './candidateKeys';
import { requestJson } from '../../../utils/api-request';

function rosterAttemptIdentity(item) {
  return `${item.originalIndex ?? item.inputIndex}:${item.displayKey || item.candidateKey || reviewerCandidateKey(item.candidate)}`;
}

function summarizeRosterPersistence(attempts, { retention, snapshot, correlationLost = false } = {}) {
  const inventoryAvailable = retention instanceof Map;
  const requiresReconciliation = !snapshot || !inventoryAvailable;
  const currentAttempts = attempts.map((attempt) => ({
    ...attempt,
    retentionStatus: inventoryAvailable && attempt.serverCandidateKey
      ? retention.get(attempt.serverCandidateKey) || null
      : null,
  }));
  const latestDetailsItems = currentAttempts.filter((attempt) => (
    attempt.outcome === 'failed' && attempt.existingAtAttempt === true && attempt.retentionStatus === 'active'
  ));
  const items = correlationLost
    ? currentAttempts
    : currentAttempts.filter((attempt) => !attempt.retentionStatus);
  const retryItems = correlationLost || requiresReconciliation ? [] : items.filter((attempt) => (
    attempt.serverCandidateKey
    && attempt.existingAtAttempt === false
    && ['written', 'unchanged', 'failed'].includes(attempt.outcome)
  ));
  const writtenKeys = currentAttempts.filter((attempt) => (
    attempt.outcome === 'written' && attempt.retentionStatus === 'active'
  )).map((attempt) => attempt.serverCandidateKey);
  const shouldWarn = requiresReconciliation || correlationLost || items.length > 0 || latestDetailsItems.length > 0;
  let summary = null;
  if (!snapshot) summary = 'We couldn’t confirm the saved results. Retry checking before leaving this page.';
  else if (!inventoryAvailable) summary = 'We couldn’t confirm the saved results. Retry checking before leaving this page.';
  else if (correlationLost) summary = "Couldn't confirm which results were saved. Use saved results to replace this search with the server roster.";
  else if (latestDetailsItems.length && items.length) summary = `${items.length} of ${currentAttempts.length} results weren't saved. ${latestDetailsItems.length === 1 ? 'Another result is' : `${latestDetailsItems.length} other results are`} retained, but the latest details were not saved; review the current card. Unsaved results are lost if you reload or start a new search.`;
  else if (latestDetailsItems.length) summary = `${latestDetailsItems.length === 1 ? 'The result is' : `${latestDetailsItems.length} results are`} retained, but the latest details were not saved; review the current card.`;
  else if (items.length) summary = `${items.length} of ${currentAttempts.length} results weren't saved. Keep this page open and retry saving. Unsaved results are lost if you reload or start a new search.`;
  return {
    mode: shouldWarn ? (requiresReconciliation || correlationLost ? 'unconfirmed' : 'partial') : 'confirmed',
    attempts: currentAttempts,
    items,
    retryItems,
    latestDetailsItems,
    latestDetailsNotSaved: latestDetailsItems.length,
    writtenKeys,
    correlationLost,
    requiresReconciliation,
    summary,
  };
}

export default function useReviewerDiscovery({
  blobUrl,
  requestId,
  excludeText,
  rosterNames,
  savedPoolNames,
  rosterLoaded,
  removingPrevious,
  searchSources,
  noSourcesSelected,
  reviewerCount,
  additionalNotes,
  referredSeedsText,
  referredBy,
  runningRef,
  genRef,
  pushProgress,
  setPhase,
  setError,
  setErrorMeta,
  setProgress,
  setCandidates,
  setUnverified,
  setIdentityComparison,
  setSelected,
  setPromotionNotice,
  setEnrichNote,
  setAnalysis,
  setExcludedRemoved,
  setExportError,
  setBlockedReferredSeeds,
  setRosterActive,
  setRosterIneligible,
  setRosterNames,
  setRosterNote,
  setTransientIneligible,
  persistenceState,
  setPersistenceState,
  reloadRoster,
  invalidateRosterReads,
  setRosterLoaded,
}) {
  const persistAndReconcile = useCallback(async (items, expectedGeneration, writeMode = null, priorState = null) => {
    let parsed = null;
    let snapshot = null;
    invalidateRosterReads?.();
    try {
      const response = await requestJson('/api/workbench/reviewer-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          candidates: items.map((item) => pruneCandidateForRoster(item.candidate)),
          ...(writeMode ? { writeMode } : {}),
        }),
        tolerantBody: false,
        fallbackMessage: 'reviewer-roster save failed',
      });
      parsed = parseReviewerRosterOutcomeResponse(response, items.length);
    } catch {
      parsed = null;
    }
    if (genRef.current !== expectedGeneration) return { stale: true, parsed, snapshot: null };
    try {
      snapshot = await reloadRoster(expectedGeneration);
    } catch {
      snapshot = null;
    }
    if (genRef.current !== expectedGeneration) return { stale: true, parsed, snapshot: null };
    if (!snapshot) setRosterLoaded?.(false);
    const retained = parseReviewerRosterRetention(snapshot?.retention);
    const incoming = items.map((item, index) => {
      const outcome = parsed?.results[index] || null;
      const serverCandidateKey = outcome && outcome.outcome !== 'invalid' ? outcome.candidateKey : null;
      return {
        originalIndex: item.originalIndex ?? item.inputIndex ?? index,
        displayKey: item.displayKey || item.candidateKey || reviewerCandidateKey(item.candidate),
        candidate: serverCandidateKey ? { ...item.candidate, candidateKey: serverCandidateKey } : item.candidate,
        serverCandidateKey,
        existingAtAttempt: outcome?.existingAtAttempt ?? null,
        outcome: outcome?.outcome || 'unconfirmed',
        code: outcome?.code || null,
      };
    });
    const retryIdentities = new Set(items.map(rosterAttemptIdentity));
    const attemptsByIdentity = new Map((priorState?.attempts || [])
      .filter((attempt) => !retryIdentities.has(rosterAttemptIdentity(attempt)))
      .map((attempt) => [rosterAttemptIdentity(attempt), attempt]));
    for (const attempt of incoming) attemptsByIdentity.set(rosterAttemptIdentity(attempt), attempt);
    const attempts = [...attemptsByIdentity.values()];
    for (const attempt of incoming) {
      if (!attempt.serverCandidateKey) continue;
      const wasInvalid = attempt.outcome === 'invalid';
      if (wasInvalid) continue;
      const rebinding = (candidate) => reviewerCandidateKey(candidate) === attempt.displayKey
        ? { ...candidate, candidateKey: attempt.serverCandidateKey }
        : candidate;
      setCandidates((current) => current.map(rebinding));
      setTransientIneligible((current) => current.map(rebinding));
    }
    const state = summarizeRosterPersistence(attempts, {
      retention: retained,
      snapshot,
      correlationLost: !parsed || priorState?.correlationLost === true,
    });
    if (state.requiresReconciliation || state.correlationLost) setRosterLoaded?.(false);
    setPersistenceState(state);
    return { stale: false, parsed, snapshot, state, unresolved: state.items };
  }, [requestId, genRef, invalidateRosterReads, reloadRoster, setRosterLoaded, setCandidates, setTransientIneligible, setPersistenceState]);

  const retryCheckingSaves = useCallback(async () => {
    const myGen = genRef.current;
    if (runningRef.current !== null || !requestId) return;
    runningRef.current = myGen;
    setPhase('saving');
    invalidateRosterReads?.();
    try {
      let snapshot = null;
      try { snapshot = await reloadRoster(myGen); } catch { snapshot = null; }
      if (genRef.current !== myGen) return;
      if (!snapshot) {
        setRosterLoaded?.(false);
        setPersistenceState((state) => state && ({ ...state, requiresReconciliation: true, summary: 'We couldn’t confirm the saved results. Retry checking before leaving this page.' }));
        return;
      }
      const retention = parseReviewerRosterRetention(snapshot.retention);
      if (!retention) {
        setRosterLoaded?.(false);
        setPersistenceState((state) => state && ({
          ...state,
          requiresReconciliation: true,
          summary: 'We couldn’t confirm the saved results. Retry checking before leaving this page.',
        }));
        return;
      }
      setRosterLoaded?.(true);
      const nextState = persistenceState ? summarizeRosterPersistence(persistenceState.attempts, {
        retention, snapshot, correlationLost: persistenceState.correlationLost,
      }) : null;
      setRosterLoaded?.(!nextState?.requiresReconciliation && !nextState?.correlationLost);
      setPersistenceState(nextState);
    } finally {
      if (genRef.current === myGen) setPhase('results');
      if (runningRef.current === myGen) runningRef.current = null;
    }
  }, [requestId, genRef, runningRef, invalidateRosterReads, reloadRoster, persistenceState, setPhase, setRosterLoaded, setPersistenceState]);

  const useSavedResults = useCallback(async () => {
    if (runningRef.current !== null || !requestId) return;
    const myGen = genRef.current;
    runningRef.current = myGen;
    setPhase('saving');
    let recoverySucceeded = false;
    invalidateRosterReads?.();
    try {
      let snapshot = null;
      try { snapshot = await reloadRoster(myGen); } catch { snapshot = null; }
      if (genRef.current !== myGen) return;
      if (!snapshot) {
        setRosterLoaded?.(false);
        setPersistenceState((state) => state && ({ ...state, requiresReconciliation: true, summary: 'We couldn’t confirm the saved results. Retry checking before leaving this page.' }));
        return;
      }
      const retention = parseReviewerRosterRetention(snapshot.retention);
      if (!retention) {
        setRosterLoaded?.(false);
        setPersistenceState((state) => state && ({ ...state, requiresReconciliation: true, summary: 'We couldn’t confirm the saved results. Retry checking before leaving this page.' }));
        return;
      }
      setRosterLoaded?.(true);
      // Use saved results replaces this search's transient cards with the fresh
      // server roster. Drop every attempted card; retained rows are already
      // represented by the snapshot, while absent rows must not stay actionable.
      const keysToDiscard = new Set((persistenceState?.attempts || []).flatMap((item) => [
        item.displayKey,
        item.serverCandidateKey,
        reviewerCandidateKey(item.candidate),
      ]).filter(Boolean));
      setCandidates((current) => current.filter((candidate) => !keysToDiscard.has(reviewerCandidateKey(candidate))));
      setTransientIneligible((current) => current.filter((candidate) => !keysToDiscard.has(reviewerCandidateKey(candidate))));
      setSelected((current) => new Set([...current].filter((key) => !keysToDiscard.has(key))));
      setPersistenceState(null);
      setRosterLoaded?.(true);
      recoverySucceeded = true;
    } finally {
      if (genRef.current === myGen) setPhase(recoverySucceeded ? 'idle' : 'results');
      if (runningRef.current === myGen) runningRef.current = null;
    }
  }, [requestId, genRef, runningRef, invalidateRosterReads, reloadRoster, persistenceState, setCandidates, setTransientIneligible, setSelected, setRosterLoaded, setPhase, setPersistenceState]);

  const retrySavingResults = useCallback(async () => {
    const myGen = genRef.current;
    if (runningRef.current !== null || !requestId || !persistenceState?.retryItems?.length) return;
    runningRef.current = myGen;
    setPhase('saving');
    try {
      let current = null;
      try { current = await reloadRoster(myGen); } catch { current = null; }
      if (genRef.current !== myGen) return;
      const retained = parseReviewerRosterRetention(current?.retention);
      if (!retained) {
        setRosterLoaded?.(false);
        setPersistenceState((state) => state && ({ ...state, requiresReconciliation: true, summary: 'We couldn’t confirm the saved results. Retry checking before leaving this page.' }));
        return;
      }
      setRosterLoaded?.(true);
      const refreshedState = summarizeRosterPersistence(persistenceState.attempts, {
        retention: retained, snapshot: current, correlationLost: persistenceState.correlationLost,
      });
      setRosterLoaded?.(!refreshedState.requiresReconciliation && !refreshedState.correlationLost);
      if (refreshedState.correlationLost || refreshedState.requiresReconciliation) {
        setPersistenceState(refreshedState);
        return;
      }
      const candidatesToRetry = refreshedState.retryItems.filter((item) => (
        item.existingAtAttempt === false
        && item.serverCandidateKey
        && !retained.has(item.serverCandidateKey)
      ));
      if (!candidatesToRetry.length) {
        setPersistenceState(refreshedState);
        return;
      }
      const retryInputs = candidatesToRetry.map((item, index) => ({
        ...item,
        inputIndex: index,
        candidateKey: item.serverCandidateKey,
      }));
      const result = await persistAndReconcile(retryInputs, myGen, 'insert_missing', refreshedState);
      if (result.stale || genRef.current !== myGen) return;
    } finally {
      if (genRef.current === myGen) setPhase('results');
      if (runningRef.current === myGen) runningRef.current = null;
    }
  }, [requestId, genRef, runningRef, persistenceState, reloadRoster, persistAndReconcile, setPhase, setRosterLoaded, setPersistenceState]);

  const runSearch = useCallback(async () => {
    const myGen = genRef.current;
    if (!blobUrl || runningRef.current !== null || removingPrevious || noSourcesSelected || !rosterLoaded) return;
    runningRef.current = myGen;
    // Exclude set = the manual/applicant box + everything already surfaced for
    // this request (roster, every status) + names already in the saved pool. The
    // union is what makes a re-run find NEW people instead of re-surfacing the
    // same set (S224).
    const effectiveExcluded = Array.from(new Set([
      ...parseExcludeList(excludeText),
      ...rosterNames,
      ...(savedPoolNames || []),
    ]));
    const referredSeeds = parseReferredSeeds(referredSeedsText, referredBy);
    setPhase('running');
    setPersistenceState(null);
    setTransientIneligible([]);
    setError(null); setErrorMeta(null); setProgress([]); setCandidates([]); setUnverified([]); setIdentityComparison(null); setSelected(new Set());
    setPromotionNotice(null); setEnrichNote(null); setAnalysis(null); setExcludedRemoved(0); setExportError(null); setBlockedReferredSeeds([]);
    try {
      // 1. Analyze the proposal (Claude). excludedNames soft-blocks Claude's own
      //    suggestions; we still hard-filter discovery results below.
      // eslint-disable-next-line no-restricted-syntax -- raw fetch: SSE stream via reviewers/sse.js; allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
      const aRes = await fetch('/api/reviewer-finder/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl,
          requestId: requestId || null,
          excludedNames: effectiveExcluded,
          reviewerCount,
          additionalNotes: additionalNotes.trim() || undefined,
        }),
      });
      let analysisResult = null;
      let streamError = null;
      let analysisTransportError = null;
      try {
        await readSseStream(aRes, ({ event, data }) => {
          if (event === 'error') { streamError = data || { message: 'Analysis failed' }; return; }
          if (data?.error) { streamError = { message: data.error, status: data.status, retryable: data.retryable }; return; }
          if (data?.message) pushProgress(data.message, myGen);
          if (data?.proposalInfo) analysisResult = data;
        });
      } catch (transportError) {
        analysisTransportError = transportError;
      }
      if (streamError) {
        const err = new Error(streamError.message || 'Analysis failed');
        err.status = streamError.status;
        err.retryable = !!streamError.retryable;
        throw err;
      }
      if (analysisTransportError && !analysisResult) {
        throw new Error('The proposal analysis connection was interrupted before results arrived. Please run the search again.');
      }
      if (analysisTransportError) pushProgress('Analysis results received; continuing after the connection closed.', myGen);
      // Stream ended cleanly but no result frame arrived — almost always a
      // timed-out or dropped connection during the long Claude analysis, not a
      // content problem. Name the likely cause so the user knows to just retry.
      if (!analysisResult) throw new Error("The proposal analysis didn't finish — the connection timed out or dropped before results came back. Please run the search again.");
      if (genRef.current !== myGen) return; // context changed — abort
      setAnalysis(analysisResult);

      // 2. Discover + verify + rank across databases.
      pushProgress('Searching databases for candidates…', myGen);
      // eslint-disable-next-line no-restricted-syntax -- raw fetch: SSE stream via reviewers/sse.js; allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
      const dRes = await fetch('/api/reviewer-finder/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisResult,
          // S240: let the server resolve the structured PI identity (Project Leader
          // contact → wmkf_orcid → exact OpenAlex author) for exclusion + COI.
          // Optional; absent/malformed → server falls back to proposal-text identity.
          requestId: requestId || null,
          // Server-side dedup: filter already-surfaced/excluded/saved names out of
          // the database results BEFORE the per-candidate Claude reasoning call, so
          // a re-run doesn't re-spend reasoning tokens (S224). Client filterExcluded
          // below stays as defense-in-depth.
          excludedNames: effectiveExcluded,
          referredSeeds,
          options: {
            searchPubmed: searchSources.pubmed,
            searchArxiv: searchSources.arxiv,
            searchBiorxiv: searchSources.biorxiv,
            searchChemrxiv: searchSources.chemrxiv,
            generateReasoning: true,
          },
        }),
      });
      let ranked = null;
      let unverifiedRaw = null;
      let blockedReferredRaw = [];
      let identityComparisonRaw = null;
      streamError = null;
      let discoveryTransportError = null;
      try {
        await readSseStream(dRes, ({ event, data }) => {
          if (event === 'error') { streamError = data?.message || 'Discovery failed'; return; }
          if (data?.error) { streamError = data.error; return; }
          if (data?.message) pushProgress(data.message, myGen);
          if (data?.ranked) ranked = data.ranked;
          if (data?.unverified) unverifiedRaw = data.unverified;
          if (Array.isArray(data?.blockedReferredSeeds)) blockedReferredRaw = data.blockedReferredSeeds;
          if (data?.identityComparison) identityComparisonRaw = data.identityComparison;
        });
      } catch (transportError) {
        discoveryTransportError = transportError;
      }
      if (streamError) throw new Error(streamError);
      if (discoveryTransportError && !ranked) {
        throw new Error('The candidate discovery connection was interrupted before results arrived. Please run the search again.');
      }
      if (discoveryTransportError) pushProgress('Candidate results received; continuing after the connection closed.', myGen);
      if (!ranked) throw new Error('Discovery returned no candidates.');
      if (genRef.current !== myGen) return; // context changed — abort
      setIdentityComparison(identityComparisonRaw);

      // 3. Hard-filter excluded names from the database results — /discover does
      //    NOT honor the soft-block, so without this the panel's "excluded names
      //    are blocked" claim would be false (Codex S210, Finding 3). The same
      //    filter applies to the unverified list so excluded names leak nowhere.
      const { kept, removed } = filterExcluded(ranked, effectiveExcluded);
      setExcludedRemoved(removed.length);
      const unverifiedKept = filterExcluded(Array.isArray(unverifiedRaw) ? unverifiedRaw : [], effectiveExcluded).kept;

      // 4. Enrich ALL kept candidates now, with every tier (SerpAPI is ~free), so
      //    email + bibliometrics + ORCID/Scholar show on the cards BEFORE the user
      //    selects. Best-effort: a failure leaves un-enriched cards + a note and
      //    still reaches results — it must never fail the search (Finding 10).
      const keyedKept = kept.map(withReviewerCandidateKey);
      let enriched = keyedKept;
      let enrichFailed = false;
      if (keyedKept.length > 0) {
        try {
          pushProgress(`Finding contact info & citation metrics for ${keyedKept.length} reviewer(s)…`, myGen);
          // eslint-disable-next-line no-restricted-syntax -- raw fetch: SSE stream via reviewers/sse.js; allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
          const eRes = await fetch('/api/reviewer-finder/enrich-contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidates: keyedKept,
              options: { usePubmed: true, useOrcid: true, useSerpSearch: true, useClaudeSearch: true },
              // Lets the route re-evaluate institution COI on the post-enrichment
              // affiliation so the badge stays accurate after an affiliation-evidence
              // promotion (Codex P2#1). requestId lets the server use the structured
              // PI-institution union, matching discover's hard drop (S240).
              authorInstitution: analysisResult?.proposalInfo?.authorInstitution || null,
              requestId: requestId || null,
            }),
          });
          let enrichmentResults = null;
          let enrichStreamError = null;
          try {
            await readSseStream(eRes, ({ event, data }) => {
              if (event === 'error' || data?.type === 'error') { enrichStreamError = data?.message || 'enrichment failed'; return; }
              if (data?.type === 'progress' && data.overall) pushProgress(`Enriching ${data.overall.current}/${data.overall.total}…`, myGen);
              if (data?.type === 'complete') enrichmentResults = data.results;
            });
          } catch (transportError) {
            if (!enrichmentResults) throw transportError;
            pushProgress('Contact results received; continuing after the connection closed.', myGen);
          }
          if (enrichStreamError || !enrichmentResults) enrichFailed = true;
          else enriched = mergeEnrichment(kept, enrichmentResults);
        } catch {
          enrichFailed = true;
        }
      }
      if (genRef.current !== myGen) return; // context changed mid-enrich — abort

      // Re-rank with the SAME shared scorer /discover used, now that enrichment
      // has populated real h-index/citations — /discover ranks BEFORE enrichment,
      // so without this re-rank the bibliometrics would never affect ordering
      // (Codex S211 catch). Mirrors discover.js's keyword derivation.
      const proposalKeywords = (analysisResult.proposalInfo?.keywords || '')
        .split(',').map((k) => k.trim()).filter(Boolean);
      enriched = rankByRelevance(enriched.map((c) => withReviewerProvenance(c)), proposalKeywords);
      // Preserve the server's "AI-flagged-off-topic sorts last" guarantee (S238) — the
      // shared scorer orders by relevance score only and would otherwise promote a flagged
      // candidate back to the top after enrichment.
      const offTopic = enriched.filter((c) => c.aiFlaggedNotRelevant);
      if (offTopic.length > 0) {
        enriched = [...enriched.filter((c) => !c.aiFlaggedNotRelevant), ...offTopic];
      }
      const dedupedEnriched = dedupeByName(enriched);
      const deceasedCandidates = dedupedEnriched.filter((candidate) => (
        (candidate.eligibilityStatus || candidate.contactEnrichment?.eligibilityStatus) === 'deceased'
      ));
      const eligibleCandidates = dedupedEnriched.filter((candidate) => (
        (candidate.eligibilityStatus || candidate.contactEnrichment?.eligibilityStatus) !== 'deceased'
      ));

      setCandidates(eligibleCandidates);
      setTransientIneligible(deceasedCandidates);
      // Stamp the stable candidate key NOW (like keyedKept above): the rescue
      // flow records the row on the roster and then confirms identity with
      // possibly-edited contact fields, and only a carried stamp keeps both
      // requests (and local state) on one key.
      setUnverified(unverifiedKept.map((c) => withReviewerCandidateKey(withReviewerProvenance(c))));
      setBlockedReferredSeeds(blockedReferredRaw);
      if (enrichFailed) {
        setEnrichNote('Contact lookup was incomplete — some cards may be missing emails or citation metrics.');
      }

      // Durably record the surfaced candidates so they persist + dedup future
      // runs. AWAIT it (don't fire-and-forget) and re-check genRef before trusting
      // it as deduped — a slow POST must not clobber a newer search's roster
      // (S224). Verified (Claude) + database discoveries only; unverified stay
      // ephemeral. A failure degrades to "no dedup this run", never a broken panel.
      if (dedupedEnriched.length > 0 && requestId) {
        const items = dedupedEnriched.map((candidate, inputIndex) => ({
          candidate,
          inputIndex,
          candidateKey: reviewerCandidateKey(candidate),
        }));
        await persistAndReconcile(items, myGen);
      }
      // Keep `phase` busy until the roster write settles. Otherwise a user can
      // remove prior results while this POST is still in flight, and the two
      // operations can replace client roster state with competing snapshots.
      if (genRef.current !== myGen) return;
      setPhase('results');
    } catch (e) {
      if (genRef.current === myGen) {
        const rawMessage = e?.message || 'Reviewer search failed.';
        const message = /^(load failed|failed to fetch|networkerror when attempting to fetch resource\.?)$/i.test(rawMessage)
          ? 'The reviewer search connection was interrupted before results arrived. Please run the search again.'
          : rawMessage;
        setError(message);
        setErrorMeta({ status: e?.status, retryable: !!e?.retryable });
        setPhase('error');
      }
    } finally {
      if (runningRef.current === myGen) runningRef.current = null;
    }
  }, [blobUrl, requestId, excludeText, rosterNames, savedPoolNames, rosterLoaded, removingPrevious, searchSources, noSourcesSelected, reviewerCount, additionalNotes, referredSeedsText, referredBy, runningRef, genRef, pushProgress, setPhase, setError, setErrorMeta, setProgress, setCandidates, setUnverified, setIdentityComparison, setSelected, setPromotionNotice, setEnrichNote, setAnalysis, setExcludedRemoved, setExportError, setBlockedReferredSeeds, setTransientIneligible, setPersistenceState, persistAndReconcile]);

  return { runSearch, retrySavingResults, retryCheckingSaves, useSavedResults };
}
