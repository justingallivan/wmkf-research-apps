/**
 * Ownership: state/lifecycle/composition hook: owns state, refs, reset/prefill effects, selection, and hook composition; operation hooks own commands and view modules render.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  buildEngagedSavedIndex,
} from '../../../utils/reviewer-rediscovery';
import { DEFAULT_REVIEWER_COUNT } from '../../../config/reviewerFinderPreferences';
import { candKey } from './candidateKeys';
import useReviewerRoster from './useReviewerRoster';
import useReviewerRosterActions from './useReviewerRosterActions';
import useReviewerDiscovery from './useReviewerDiscovery';
import useApplicantReviewerEnrichment from './useApplicantReviewerEnrichment';
import useReviewerContactActions from './useReviewerContactActions';
import useReviewerPromotion from './useReviewerPromotion';
import useReviewerExport from './useReviewerExport';
import useReviewerSearchProjection from './useReviewerSearchProjection';

export default function useReviewerSearchController({
  requestId,
  blobUrl,
  proposalKey = null,
  excludedNames = [],
  exclusionsUnavailable = false,
  excludedRaw = null,
  recommended = [],
  recommendedFailed = [],
  knownLookupFailed = [],
  slotsPopulated = null,
  ingestLoading = false,
  ingestError = null,
  onRetryIngestion,
  savedPool = [],
  onSaved,
  onNavigate,
  manualAddSlot = null,
  canManage = true,
  repairCandidateKey = null,
}) {
  const [phase, setPhase] = useState('idle'); // idle | running | results | saving | done | error
  const busy = phase === 'running' || phase === 'saving';
  const [savingCount, setSavingCount] = useState(0);
  // Saved-pool projections: names feed the cross-run search exclusion union
  // (S224); the engaged-row identity index collapses re-discovered
  // already-engaged people at the display merge (S401 Kwong confusion —
  // discovery's exact-name filter misses name variants; anchors don't).
  const savedPoolNames = useMemo(
    () => (Array.isArray(savedPool) ? savedPool : []).map((c) => c?.name).filter(Boolean),
    [savedPool],
  );
  const engagedSavedIndex = useMemo(() => buildEngagedSavedIndex(savedPool), [savedPool]);
  const [progress, setProgress] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [unverified, setUnverified] = useState([]); // Claude suggestions the searched databases couldn't verify (not selectable; rescuable via confirm-identity or excludable)
  const [analysis, setAnalysis] = useState(null);
  const [identityComparison, setIdentityComparison] = useState(null);
  // `selected` is keyed by the stable per-candidate correlation key, not by a
  // normalized name or flat array index. Same-name people must remain separate
  // through enrichment, durable roster actions, and partial-save handling.
  const [selected, setSelected] = useState(() => new Set());
  // Durable per-request roster (reviewer_find_roster via /api/workbench/reviewer-roster):
  // active candidates (selectable, persist across reload), the collapsed Excluded
  // set, and the full surfaced-name list fed into the cross-run dedup.
  const [rosterActive, setRosterActive] = useState([]);
  const [rosterExcluded, setRosterExcluded] = useState([]);
  const [rosterIneligible, setRosterIneligible] = useState([]);
  const [rosterBlocked, setRosterBlocked] = useState([]);
  const [rosterHandled, setRosterHandled] = useState([]);
  const [rosterSavedKeys, setRosterSavedKeys] = useState([]);
  const [rosterNames, setRosterNames] = useState([]);
  const [repairRequestsByCandidateKey, setRepairRequestsByCandidateKey] = useState({});
  const [repairRequestsUnavailable, setRepairRequestsUnavailable] = useState(false);
  // Gates the search button until the roster GET resolves, so a run can't skip
  // the cross-run dedup by firing before rosterNames is loaded (Codex post-impl).
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [rosterLoadFailed, setRosterLoadFailed] = useState(false);
  const [rosterNote, setRosterNote] = useState(null); // surfaced if a durable write fails
  const [removingPrevious, setRemovingPrevious] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [error, setError] = useState(null);
  const [errorMeta, setErrorMeta] = useState(null);
  const [promotionNotice, setPromotionNotice] = useState(null); // promotion outcome kept beside the action that triggered it
  const [enrichNote, setEnrichNote] = useState(null);
  const [excludeText, setExcludeText] = useState((excludedNames || []).join(', '));
  const [excludedRemoved, setExcludedRemoved] = useState(0);
  const [searchSources, setSearchSources] = useState({ pubmed: true, arxiv: true, biorxiv: true, chemrxiv: true });
  const noSourcesSelected = !Object.values(searchSources).some(Boolean);
  const [reviewerCount, setReviewerCount] = useState(DEFAULT_REVIEWER_COUNT); // how many candidates Claude is asked to suggest (recall lever; see reviewerFinderPreferences)
  const [additionalNotes, setAdditionalNotes] = useState(''); // optional extra instructions for Claude
  const [referredSeedsText, setReferredSeedsText] = useState('');
  const [referredBy, setReferredBy] = useState('');
  const [blockedReferredSeeds, setBlockedReferredSeeds] = useState([]);
  const [sortMode, setSortMode] = useState('relevance'); // 'relevance' (confidence rank, default) | 'alpha' (by name, within each provenance group)
  const [exporting, setExporting] = useState(false); // Excel export in flight
  const [exportError, setExportError] = useState(null); // export-specific error (own surface; does not disturb search `error`/`phase`)
  const exportingRef = useRef(null);

  // Applicant-recommended enrichment (separate flow from the search).
  const [recPhase, setRecPhase] = useState('idle'); // idle | running | done | error
  const [recCandidates, setRecCandidates] = useState([]);
  const [recHandled, setRecHandled] = useState([]);
  const [recProgress, setRecProgress] = useState([]);
  const [recError, setRecError] = useState(null);
  const recRunningRef = useRef(null);

  // Per-user prompt-override editor toggle (S222).
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  const [editingContact, setEditingContact] = useState(null);
  const [confirmingContact, setConfirmingContact] = useState(null);

  // Imperative guards: prevent double-submit (Finding 8) and let a context change
  // invalidate an in-flight run so a stale stream can't overwrite newer state
  // (Finding 7).
  const runningRef = useRef(null);
  const savingRef = useRef(null);
  const genRef = useRef(0);
  const excludeEditedRef = useRef(false);
  const mountedRef = useRef(true);

  const { reloadRoster, retryRosterLoad } = useReviewerRoster({
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
  });

  // Reset everything when the request or the loaded proposal changes — stale
  // candidates must never be savable under a different proposal (Finding 6).
  // Also (re)loads the durable per-request roster (genRef-guarded) so the
  // active + excluded sets show even before any fresh search this session.
  useEffect(() => {
    mountedRef.current = true;
    genRef.current += 1; // invalidate any in-flight run
    const myGen = genRef.current;
    runningRef.current = null;
    recRunningRef.current = null;
    exportingRef.current = null;
    setPhase('idle'); setSavingCount(0); setProgress([]); setCandidates([]); setUnverified([]); setAnalysis(null); setIdentityComparison(null);
    setSelected(new Set()); setError(null); setErrorMeta(null); setPromotionNotice(null); setEnrichNote(null); setExportError(null); setExporting(false);
    setExcludedRemoved(0); setRosterNote(null); setRemovingPrevious(false);
    setRosterActive([]); setRosterExcluded([]); setRosterIneligible([]); setRosterBlocked([]); setRosterHandled([]); setRosterSavedKeys([]); setRosterNames([]); setRepairRequestsByCandidateKey({}); setRepairRequestsUnavailable(false); setExcludedOpen(false); setRosterLoaded(false); setRosterLoadFailed(false);
    setSearchSources({ pubmed: true, arxiv: true, biorxiv: true, chemrxiv: true });
    setReviewerCount(DEFAULT_REVIEWER_COUNT);
    setAdditionalNotes('');
    setReferredSeedsText('');
    setReferredBy('');
    setBlockedReferredSeeds([]);
    setRecPhase('idle'); setRecCandidates([]); setRecHandled([]); setRecProgress([]); setRecError(null);
    setEditingContact(null); setConfirmingContact(null);
    excludeEditedRef.current = false;
    setExcludeText((excludedNames || []).join(', '));

    // Load the durable roster for this request. genRef-guarded so a slower fetch
    // can't clobber state after the request/proposal changed again. Never sets
    // `phase` — the roster renders independent of the search phase.
    if (requestId) {
      (async () => {
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
      })();
    } else {
      setRosterLoaded(true); // no request → nothing to load; don't block the form
    }
    return () => {
      if (genRef.current === myGen) {
        mountedRef.current = false;
        genRef.current += 1;
        runningRef.current = null;
        recRunningRef.current = null;
        exportingRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, blobUrl, reloadRoster]);

  // When the applicant exclude list finishes loading (it can arrive after the
  // proposal), prefill the box — unless the user has already edited it.
  useEffect(() => {
    if (!excludeEditedRef.current) setExcludeText((excludedNames || []).join(', '));
  }, [excludedNames]);

  const pushProgress = useCallback((m, expectedGeneration = genRef.current) => {
    if (m && mountedRef.current && genRef.current === expectedGeneration) {
      setProgress((p) => [...p.slice(-6), m]);
    }
  }, []);

  const { runSearch } = useReviewerDiscovery({
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
  });

  const {
    enrichRecommended,
    terminalApplicantKeys,
    actionableRecommended,
    haveValidCache,
  } = useApplicantReviewerEnrichment({
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
  });

  const {
    displayRosterActive,
    visibleRecCandidates,
    currentRunKeys,
    previousSearchCandidates,
    previousSearchKeys,
    previousSearchRefs,
    displayCandidates,
    rediscoveredEngaged,
    handledReviewers,
    incompleteCoiCandidates,
    incompleteCoiNames,
    incompleteCoiLabel,
    selectableCandidates,
    knownNameKeys,
    unverifiedToShow,
    readinessSections,
    recCount,
    applicantDisplayCandidates,
    recVerifiedCount,
    recIdentityReviewCount,
  } = useReviewerSearchProjection({
    proposalKey,
    recommended,
    rosterActive,
    recCandidates,
    candidates,
    rosterExcluded,
    rosterIneligible,
    rosterHandled,
    recHandled,
    unverified,
    sortMode,
    terminalApplicantKeys,
    engagedSavedIndex,
  });

  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const allSelected = selectableCandidates.length > 0 && selectableCandidates.every((c) => selected.has(candKey(c)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableCandidates.map(candKey)));

  const {
    excludeCandidate,
    excludeUnverifiedCandidate,
    promoteCandidate,
    removePreviousResults,
  } = useReviewerRosterActions({
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
  });


  const {
    setManualContact,
    persistManualContact,
    verifyAddressContact,
    reviewAddressConflict,
    retryAddressCheck,
    requestAddressRepair,
    useLead,
    openIdentityConfirmation,
    confirmIdentityContact,
  } = useReviewerContactActions({
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
  });

  const { refreshExpiredVerification, saveSelected } = useReviewerPromotion({
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
  });



  const { exportSelected } = useReviewerExport({
    requestId,
    selected,
    displayCandidates,
    exportingRef,
    genRef,
    mountedRef,
    setExporting,
    setExportError,
  });

  const onExcludeChange = (ev) => { excludeEditedRef.current = true; setExcludeText(ev.target.value); };




  return {
    phase,
    busy,
    savingCount,
    progress,
    identityComparison,
    selected,
    rosterExcluded,
    rosterIneligible,
    rosterBlocked,
    rosterLoaded,
    rosterLoadFailed,
    rosterNote,
    removingPrevious,
    excludedOpen,
    error,
    errorMeta,
    promotionNotice,
    enrichNote,
    excludeText,
    excludedRemoved,
    searchSources,
    reviewerCount,
    additionalNotes,
    referredSeedsText,
    referredBy,
    blockedReferredSeeds,
    sortMode,
    exporting,
    exportError,
    recPhase,
    recProgress,
    recError,
    showPromptEditor,
    editingContact,
    confirmingContact,
    noSourcesSelected,
    retryRosterLoad,
    runSearch,
    enrichRecommended,
    previousSearchKeys,
    previousSearchRefs,
    displayCandidates,
    handledReviewers,
    incompleteCoiCandidates,
    incompleteCoiLabel,
    unverifiedToShow,
    readinessSections,
    recCount,
    recVerifiedCount,
    recIdentityReviewCount,
    allSelected,
    toggle,
    toggleAll,
    onExcludeChange,
    removePreviousResults,
    saveSelected,
    exportSelected,
    promoteCandidate,
    excludeCandidate,
    excludeUnverifiedCandidate,
    openIdentityConfirmation,
    repairRequestsByCandidateKey,
    repairRequestsUnavailable,
    requestAddressRepair,
    reviewAddressConflict,
    retryAddressCheck,
    useLead,
    setEditingContact,
    persistManualContact,
    verifyAddressContact,
    confirmIdentityContact,
    setConfirmingContact,
    setShowPromptEditor,
    setSearchSources,
    setReviewerCount,
    setAdditionalNotes,
    setReferredSeedsText,
    setReferredBy,
    setSortMode,
    setExcludedOpen,
  };
}
