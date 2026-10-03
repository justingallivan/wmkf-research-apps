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
} from '../reviewer-search-logic';
import { rankByRelevance } from '../../../../lib/utils/relevance-score';
import { withReviewerProvenance } from '../../../../lib/utils/reviewer-provenance';
import { normalizeReviewerName } from '../../../../lib/utils/reviewer-name-match';
import { dedupeByName } from './candidateKeys';
import { readRosterSaveReceipt } from './rosterSaveReceipt';
import { requestEnvelope } from '../../../utils/api-request';

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
  setRosterIneligible,
  setRosterNote,
  reloadRoster,
  setRosterLoaded,
  setRosterLoadFailed,
}) {
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
      if (!requestId) {
        setRosterIneligible((prev) => dedupeByName([
          ...deceasedCandidates.map(pruneCandidateForRoster),
          ...prev,
        ]));
      }
      // Stamp the stable candidate key NOW (like keyedKept above): the rescue
      // flow records the row on the roster and then confirms identity with
      // possibly-edited contact fields, and only a carried stamp keeps both
      // requests (and local state) on one key.
      setUnverified(unverifiedKept.map((c) => withReviewerCandidateKey(withReviewerProvenance(c))));
      setBlockedReferredSeeds(blockedReferredRaw);
      if (enrichFailed) {
        setEnrichNote('Contact lookup was incomplete — some cards may be missing emails or citation metrics.');
      }

      // Record verified discoveries, then reload the retained roster. Indexed
      // acknowledgments correlate inputs; only GET determines durable buckets
      // and future search exclusions. Unverified suggestions stay ephemeral.
      // Both awaits are generation-guarded so an older run cannot replace a new
      // proposal's state; uncertain outcomes use read recovery, never POST replay.
      if (dedupedEnriched.length > 0 && requestId) {
        const pruned = dedupedEnriched.map(pruneCandidateForRoster);
        let postResponse = null;
        try {
          postResponse = await requestEnvelope('/api/workbench/reviewer-roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { requestId, candidates: pruned },
            tolerantBody: true,
            fallbackMessage: 'reviewer-roster save failed',
          });
        } catch { /* a transport failure has an unknown write outcome; reconcile below */ }
        if (genRef.current !== myGen) return;

        const receipt = postResponse?.ok === true
          ? readRosterSaveReceipt(postResponse.data, pruned.length)
          : null;
        let rosterSnapshot = null;
        try {
          rosterSnapshot = await reloadRoster(myGen);
        } catch { /* stale/failed read is reported below */ }
        if (genRef.current !== myGen) return;

        if (!rosterSnapshot) {
          setRosterLoaded(false);
          setRosterLoadFailed(true);
          setCandidates([]);
          setSelected(new Set());
          setRosterNote('Could not confirm all search saves because reviewer state could not be reloaded. Retry reviewer state before searching.');
        } else {
          setRosterLoaded(true);
          setRosterLoadFailed(false);
          const rowsByKey = new Map();
          const rowsInOtherBuckets = new Set();
          for (const bucket of ['active', 'excluded', 'ineligible', 'blocked', 'handled']) {
            for (const row of Array.isArray(rosterSnapshot[bucket]) ? rosterSnapshot[bucket] : []) {
              const key = row?.candidateKey;
              if (typeof key !== 'string' || !key) continue;
              if (bucket === 'active') rowsByKey.set(key, row);
              else rowsInOtherBuckets.add(key);
            }
          }
          for (const key of Array.isArray(rosterSnapshot.savedKeys) ? rosterSnapshot.savedKeys : []) {
            if (typeof key === 'string' && key) rowsInOtherBuckets.add(key);
          }
          const allNames = new Set((Array.isArray(rosterSnapshot.allNames) ? rosterSnapshot.allNames : [])
            .map(normalizeReviewerName).filter(Boolean));
          const candidatesForCurrentRun = [];
          const warnings = new Set();

          if (!receipt) {
            // No trustworthy input-to-key mapping exists. The authoritative GET
            // still replaces saved state, but no fresh card can shadow it.
            setCandidates([]);
            setSelected(new Set());
            setRosterNote('Could not confirm all search saves. Reviewer state was reloaded; run a new search to continue.');
          } else {
            for (let inputIndex = 0; inputIndex < dedupedEnriched.length; inputIndex += 1) {
              const candidate = dedupedEnriched[inputIndex];
              const outcome = receipt.outcomes[inputIndex];
              const key = outcome.candidateKey;
              const isDeceased = deceasedCandidates.includes(candidate);
              if (outcome.status === 'failed' || outcome.status === 'invalid') warnings.add(inputIndex);
              const activeRow = key ? rowsByKey.get(key) : null;
              if (activeRow) {
                if (!isDeceased) candidatesForCurrentRun.push(activeRow);
                else warnings.add(inputIndex);
                continue;
              }
              if (key && rowsInOtherBuckets.has(key)) continue;

              const normalizedName = normalizeReviewerName(candidate?.name);
              const nameAlreadySurfaced = normalizedName && allNames.has(normalizedName);
              if (nameAlreadySurfaced) {
                if (outcome.status === 'recorded' || outcome.status === 'unchanged') warnings.add(inputIndex);
                continue;
              }

              if (outcome.status === 'failed' && !isDeceased && key) {
                // Keep a new failed row as an ephemeral card. The key is the
                // server's correlation key, while saved state remains GET-only.
                candidatesForCurrentRun.push({ ...candidate, candidateKey: key });
                warnings.add(inputIndex);
                continue;
              }
              if (isDeceased || outcome.status === 'recorded' || outcome.status === 'unchanged') {
                warnings.add(inputIndex);
              }
            }
            setCandidates(candidatesForCurrentRun);
            if (warnings.size > 0) {
              setRosterNote(`${warnings.size} search result${warnings.size === 1 ? '' : 's'} could not be confirmed in the request roster. Run another search to rediscover unsaved candidates.`);
            } else {
              setRosterNote(null);
            }
          }
        }
      }
      // Keep `phase` busy until the roster write and readback settle. Otherwise a user can
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
  }, [blobUrl, requestId, excludeText, rosterNames, savedPoolNames, rosterLoaded, removingPrevious, searchSources, noSourcesSelected, reviewerCount, additionalNotes, referredSeedsText, referredBy, runningRef, genRef, pushProgress, setPhase, setError, setErrorMeta, setProgress, setCandidates, setUnverified, setIdentityComparison, setSelected, setPromotionNotice, setEnrichNote, setAnalysis, setExcludedRemoved, setExportError, setBlockedReferredSeeds, setRosterIneligible, setRosterNote, setRosterLoaded, setRosterLoadFailed, reloadRoster]);

  return { runSearch };
}
