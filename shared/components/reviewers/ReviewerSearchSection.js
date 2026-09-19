/**
 * ReviewerSearchSection — the in-panel reviewer candidate search for the
 * Workbench Find tab. Replaces the old "go to the standalone Reviewer Finder"
 * handoff: it reuses the proposal already loaded by ReviewerFindPanel (a Vercel
 * Blob URL) and the applicant exclude list, then runs the same endpoints the
 * standalone app uses —
 *   analyze (Claude) → discover (PubMed/preprint verify + rank)
 *     → enrich-contacts (ALL tiers — PubMed/ORCID/SerpAPI Google+Scholar/Claude
 *       web search; SerpAPI is ~free so there is no cost dialog) → save-candidates
 * — so saved candidates land in the SAME per-request pool the Invite tab reads.
 * Applicant-recommended rows use an explicit promotion route before joining that
 * pool.
 *
 * S211 parity build (matches the proven standalone workflow): per-source toggles,
 * candidate-count + additional-context inputs;
 * enrichment runs ON RESULTS (not at save) so cards show email + ORCID/Scholar +
 * REAL h-index/citations (fetched via the google_scholar_author engine) BEFORE the
 * user selects; rich candidate cards with COI / evidence-quality warnings;
 * results split by decision readiness plus Unverified (the last is read-only).
 * verificationConfidence informs the evidence-quality wording but is not shown
 * as a percentage: the underlying literature sample is often too small for a
 * percentage to communicate uncertainty honestly.
 * the composite relevanceScore drives ordering only — and because /discover ranks
 * BEFORE enrichment, the enriched list is RE-RANKED here (shared scorer in
 * lib/utils/relevance-score.js) so the fetched h-index/citations affect order.
 *
 * Props:
 *   - requestId             : akoya_request GUID (save target)
 *   - blobUrl               : proposal blob URL from load-proposal (required to search)
 *   - proposalKey           : stable SharePoint file key (`library::folder::name`) for applicant-enrichment cache
 *   - excludedNames         : string[] of applicant-excluded names (prefills the editable box)
 *   - exclusionsUnavailable : true when ingestion failed to produce the exclude list
 *   - excludedRaw           : the applicant's original free-text exclusion field (shown as a disclosure under the box)
 *   - recommended           : applicant-recommended candidate rows (rendered + verifiable in the bottom card)
 *   - recommendedFailed      : applicant-recommended rows that failed to ingest (warning in the bottom card)
 *   - knownLookupFailed      : materialized rows whose exact linked person could not be safely hydrated
 *   - slotsPopulated        : how many wmkf_potentialreviewer slots the applicant filled (null = unknown)
 *   - ingestLoading / ingestError / onRetryIngestion : applicant-reviewer ingestion state + retry (from ReviewerFindPanel)
 *   - onSaved               : optional callback after a successful save
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card } from '../Layout';
import {
  isCandidateSelectable,
} from './reviewer-search-logic';
import { reviewerEngagementProjection } from '../../utils/reviewer-engagement';
import {
  buildEngagedSavedIndex,
  partitionRediscoveredCandidates,
  REDISCOVERED_STAGE_LABELS,
} from '../../utils/reviewer-rediscovery';
import { buildScholarSearchUrl, isRealScholarProfileUrl } from '../../../lib/utils/scholar-url';
import { buildGoogleSearchUrl } from '../../../lib/utils/google-search-url';
import {
  provenanceGroupOf,
  withReviewerProvenance,
} from '../../../lib/utils/reviewer-provenance';
import { DEFAULT_REVIEWER_COUNT } from '../../config/reviewerFinderPreferences';
import {
  activeInstitutionStage2Presentation,
} from '../../utils/institution-stage2-presentation';
import { CandidateCard } from './search/CandidateCard';
import { addressTrustFailureMessage, formatSaveFailureDetails } from './search/presentation';
import { candKey, dedupeByName, isApplicantOriginCandidate } from './search/candidateKeys';
import SearchControls from './search/SearchControls';
import SearchResults from './search/SearchResults';
import SearchContactModals from './search/SearchContactModals';
import HandledReviewers from './search/HandledReviewers';
import ApplicantReviewerStatus from './search/ApplicantReviewerStatus';
import useReviewerRoster from './search/useReviewerRoster';
import useReviewerRosterActions from './search/useReviewerRosterActions';
import useReviewerDiscovery from './search/useReviewerDiscovery';
import useApplicantReviewerEnrichment from './search/useApplicantReviewerEnrichment';
import useReviewerContactActions from './search/useReviewerContactActions';
import useReviewerPromotion from './search/useReviewerPromotion';

export { CandidateCard, addressTrustFailureMessage };

export default function ReviewerSearchSection({
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

  // The selectable list = the durable active roster ∪ this run's results, deduped
  // by normalized name (run results win — freshest enrichment). Renders + ranks
  // independent of `phase` so the roster shows on reload without a fresh search.
  // recCandidates (enriched applicant-referred) prepend so fresh enrichment wins
  // over any stale roster copy of the same person.
  const displayRosterActive = useMemo(() => rosterActive.filter((c) => (
    !isApplicantOriginCandidate(c) || (!!proposalKey && c.enrichedProposalKey === proposalKey)
  )), [rosterActive, proposalKey]);
  const visibleRecCandidates = useMemo(() => recCandidates.filter((candidate) => (
    !terminalApplicantKeys.has(candKey(candidate))
  )), [recCandidates, terminalApplicantKeys]);
  const currentRunKeys = useMemo(() => new Set(
    [...visibleRecCandidates, ...candidates].map(candKey).filter(Boolean)
  ), [visibleRecCandidates, candidates]);
  const previousSearchCandidates = useMemo(() => (
    displayRosterActive
      .filter((c) => !isApplicantOriginCandidate(c) && !currentRunKeys.has(candKey(c)))
  ), [displayRosterActive, currentRunKeys]);
  const previousSearchKeys = useMemo(() => new Set(
    previousSearchCandidates
      .map(candKey)
      .filter(Boolean)
  ), [previousSearchCandidates]);
  const previousSearchRefs = useMemo(() => previousSearchCandidates
    .filter((candidate) => candKey(candidate) && candidate.rosterUpdatedAt)
    .map((candidate) => ({
      candidateKey: candKey(candidate),
      updatedAt: candidate.rosterUpdatedAt,
    })), [previousSearchCandidates]);
  // Re-discovery reconciliation (S401): a merged candidate whose identity
  // anchors (or normalized name) match an ENGAGED saved-pool row leaves the
  // actionable list here and joins the Already-handled section below as a
  // "re-found by search" entry. Everything downstream (selection, save,
  // provenance sections, unverified suppression) sees only the kept list.
  const { kept: displayCandidates, rediscovered: rediscoveredEngaged } = useMemo(() => {
    const merged = dedupeByName([...visibleRecCandidates, ...candidates, ...displayRosterActive].map((c) => withReviewerProvenance(c)));
    return partitionRediscoveredCandidates(merged, engagedSavedIndex);
  }, [visibleRecCandidates, candidates, displayRosterActive, engagedSavedIndex]);
  const handledReviewers = useMemo(() => dedupeByName([
    ...recHandled,
    ...rosterHandled,
    ...recommended
      .filter((row) => reviewerEngagementProjection(row).handled)
      .map((row) => ({
        suggestionId: row.suggestionId,
        candidateKey: row.suggestionId ? `suggestion:${row.suggestionId}` : null,
        name: row.applicantKnownReviewer?.name || row.name || 'Applicant-recommended reviewer',
        stage: reviewerEngagementProjection(row).stage,
      })),
    // Keyed by the SAVED row's suggestion anchor (dedupe collapses on exact
    // keys, not names) and appended LAST, so when the same person already has a
    // suggestion-anchored handled entry above, that entry wins first-occurrence
    // and this twin folds into it instead of listing the person twice.
    ...rediscoveredEngaged.map(({ candidate, saved }) => ({
      suggestionId: saved.suggestionId,
      candidateKey: saved.suggestionId ? `suggestion:${saved.suggestionId}` : candKey(candidate),
      name: saved.name || candidate.name,
      affiliation: saved.affiliation || candidate.affiliation || null,
      stage: saved.stage,
      rediscovered: true,
    })),
  ]), [recHandled, rosterHandled, recommended, rediscoveredEngaged]);
  const incompleteCoiCandidates = dedupeByName([...displayCandidates, ...rosterIneligible])
    .filter((candidate) => candidate.coauthorCheckStatus === 'incomplete');
  const incompleteCoiNames = incompleteCoiCandidates.map((candidate) => candidate.name).filter(Boolean);
  const incompleteCoiLabel = incompleteCoiNames.length === 0
    ? `${incompleteCoiCandidates.length} reviewer${incompleteCoiCandidates.length === 1 ? '' : 's'}`
    : incompleteCoiNames.length <= 3
      ? incompleteCoiNames.join(', ')
      : `${incompleteCoiNames.slice(0, 3).join(', ')} and ${incompleteCoiNames.length - 3} others`;

  // Slice E: a candidate the system could not identity-resolve (deferred Track-B or
  // an unresolved verdict) is visible but NOT selectable/savable as a vetted reviewer
  // (anchor-or-abstain at the UI boundary). It renders read-only in its own section
  // and is excluded from select-all + the save set. The server (save-candidates) also
  // hard-rejects these rows, so this is the friendly gate, not the only one.
  // Not selectable if identity needs review OR there's a current same-institution COI
  // (S240 Chunk 2a hard drop): discovery already drops these, but enrichment can promote
  // a current affiliation that matches the PI's institution after the fact — those rows
  // become unselectable + unsavable (the save-candidates API also hard-rejects them).
  // The UI marker `pdIdentityConfirmed` makes an otherwise unverifiable row
  // selectable only after the authenticated roster action returned an opaque
  // server confirmation id. Save-candidates re-verifies it; the marker has no
  // server authority. Institution COI is never waived.
  const selectableCandidates = displayCandidates.filter(isCandidateSelectable);

  // A Claude suggestion the server couldn't verify can ALSO surface — and verify —
  // from a database search, in this run or a prior one (it then lives in
  // displayCandidates / the active roster). Drop those from the "Unverified
  // suggestions" set so one reviewer can't appear under both headings; the
  // verified row always wins over its unverified twin. Excluded names drop too —
  // they already have their own collapsed section.
  const knownNameKeys = new Set(
    [
      ...displayCandidates.map(candKey),
      // Re-discovered engaged rows left displayCandidates but are still known
      // people — their unverified twins must stay suppressed.
      ...rediscoveredEngaged.map(({ candidate }) => candKey(candidate)),
      ...rosterExcluded.map(candKey),
      ...rosterIneligible.map(candKey),
    ].filter(Boolean)
  );
  const unverifiedToShow = unverified.filter((c) => !knownNameKeys.has(candKey(c)));

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

  const [editingContact, setEditingContact] = useState(null);
  const [confirmingContact, setConfirmingContact] = useState(null);

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



  // Export the SELECTED candidates to an Excel workbook (Request Info + Candidates
  // sheets, built server-side). Slim DTO per row resolves the same fields the card
  // shows (email/orcid/scholar fall back to contactEnrichment); the server fetches
  // request metadata (number/institution/PI) authoritatively by requestId.
  const exportSelected = useCallback(async () => {
    const myGen = genRef.current;
    if (exportingRef.current !== null) return;
    const chosen = displayCandidates.filter((c) => selected.has(candKey(c)) && isCandidateSelectable(c));
    if (chosen.length === 0) return;
    exportingRef.current = myGen;
    setExporting(true);
    setExportError(null);
    try {
      const rows = chosen.map((c) => {
        const enr = c.contactEnrichment || {};
        const realScholar = c.googleScholarUrl || enr.googleScholarUrl || null;
        return {
          name: c.name,
          affiliation: c.affiliation || null,
          email: c.email || enr.email || null,
          reasoning: c.reasoning || c.generatedReasoning || null,
          keywords: Array.isArray(c.expertiseAreas) && c.expertiseAreas.length
            ? c.expertiseAreas.join(', ')
            : (c.expertise || c.keywords || null),
          isApplicantRecommended: !!c.isApplicantRecommended,
          provenance: c.provenance || null,
          orcidUrl: c.orcidUrl || enr.orcidUrl || null,
          scholarUrl: realScholar || buildScholarSearchUrl(c.name, c.affiliation),
          hasRealScholar: isRealScholarProfileUrl(realScholar),
          hasInstitutionCOI: !!c.hasInstitutionCOI,
          institutionCOIDetails: c.institutionCOIDetails || null,
          hasCoauthorCOI: !!c.hasCoauthorCOI,
          coauthorCOIStrength: c.coauthorCOIStrength || null,
          coauthorships: Array.isArray(c.coauthorships) ? c.coauthorships : [],
          hIndex: c.hIndex ?? enr.hIndex ?? null,
          publicationCount5yr: c.publicationCount5yr ?? (Array.isArray(c.publications) ? c.publications.length : null),
          seniorityEstimate: c.seniorityEstimate || null,
        };
      });
      const res = await fetch('/api/workbench/export-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, candidates: rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      if (genRef.current !== myGen || !mountedRef.current) return;
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : 'reviewer-candidates.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (genRef.current === myGen && mountedRef.current) setExportError(e.message);
    } finally {
      if (exportingRef.current === myGen) {
        exportingRef.current = null;
        if (genRef.current === myGen && mountedRef.current) setExporting(false);
      }
    }
  }, [displayCandidates, selected, requestId]);

  const onExcludeChange = (ev) => { excludeEditedRef.current = true; setExcludeText(ev.target.value); };

  // Decision-readiness sections are VIEWS over displayCandidates; selection is
  // keyed by candKey(c) (stable normalized name), so a roster splice can't
  // corrupt it (S224 — replaces the former flat-index invariant).
  // Default order is confidence/relevance rank (server-ranked, preserved). The
  // alpha toggle re-sorts within each readiness group by display name. Provenance
  // remains available in each card's Details disclosure without driving the
  // staffer's attention order.
  const sortForDisplay = (items) =>
    sortMode === 'alpha'
      ? [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
      : items;
  const readinessSections = [
    {
      key: 'ready_to_invite',
      title: 'Ready to add to Invite',
      items: sortForDisplay(displayCandidates.filter((c) => isCandidateSelectable(c))),
    },
    {
      key: 'needs_review',
      title: 'Needs review',
      items: sortForDisplay(displayCandidates.filter((c) => !isCandidateSelectable(c))),
    },
  ].filter((section) => section.items.length > 0);

  // Applicant rows now default to selected=false until explicit PD promotion;
  // removed-by-staff vs not-yet-promoted is not a distinct displayed state.
  const recCount = recommended.length;
  // Candidates with needsIdentification:true route to needs_identity_review, not
  // applicant_suggested — split the done-message count accordingly.
  const applicantDisplayCandidates = displayCandidates.filter(isApplicantOriginCandidate);
  const recVerifiedCount = applicantDisplayCandidates.filter((c) => (
    provenanceGroupOf(withReviewerProvenance(c)) === 'applicant_suggested'
      || c?.pdIdentityConfirmed === true
  )).length;
  const recIdentityReviewCount = applicantDisplayCandidates.filter((c) => (
    provenanceGroupOf(withReviewerProvenance(c)) === 'needs_identity_review'
      && c?.pdIdentityConfirmed !== true
  )).length;

  return (
    <>
      <Card hover={false}>
        <SearchControls
          busy={busy}
          showPromptEditor={showPromptEditor}
          onTogglePromptEditor={() => setShowPromptEditor((s) => !s)}
          onClosePromptEditor={() => setShowPromptEditor(false)}
          blobUrl={blobUrl}
          phase={phase}
          searchSources={searchSources}
          noSourcesSelected={noSourcesSelected}
          onToggleSource={(key) => setSearchSources((prev) => ({ ...prev, [key]: !prev[key] }))}
          reviewerCount={reviewerCount}
          onReviewerCountChange={setReviewerCount}
          additionalNotes={additionalNotes}
          onAdditionalNotesChange={setAdditionalNotes}
          referredSeedsText={referredSeedsText}
          onReferredSeedsChange={setReferredSeedsText}
          referredBy={referredBy}
          onReferredByChange={setReferredBy}
          excludeText={excludeText}
          onExcludeChange={onExcludeChange}
          exclusionsUnavailable={exclusionsUnavailable}
          excludedRaw={excludedRaw}
          error={error}
          errorMeta={errorMeta}
          promotionNotice={promotionNotice}
          previousSearchKeys={previousSearchKeys}
          rosterLoadFailed={rosterLoadFailed}
          retryRosterLoad={retryRosterLoad}
          runSearch={runSearch}
          rosterLoaded={rosterLoaded}
          removingPrevious={removingPrevious}
          progress={progress}
        />
        <SearchResults
          rosterNote={rosterNote}
          displayCandidates={displayCandidates}
          rosterExcluded={rosterExcluded}
          rosterIneligible={rosterIneligible}
          rosterBlocked={rosterBlocked}
          phase={phase}
          identityComparison={identityComparison}
          enrichNote={enrichNote}
          incompleteCoiCandidates={incompleteCoiCandidates}
          incompleteCoiLabel={incompleteCoiLabel}
          promotionNotice={promotionNotice}
          previousSearchKeys={previousSearchKeys}
          canManage={canManage}
          removePreviousResults={removePreviousResults}
          removingPrevious={removingPrevious}
          previousSearchRefs={previousSearchRefs}
          excludedRemoved={excludedRemoved}
          blockedReferredSeeds={blockedReferredSeeds}
          unverifiedToShow={unverifiedToShow}
          selected={selected}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          allSelected={allSelected}
          toggleAll={toggleAll}
          readinessSections={readinessSections}
          toggle={toggle}
          saveSelected={saveSelected}
          savingCount={savingCount}
          exportSelected={exportSelected}
          exporting={exporting}
          blobUrl={blobUrl}
          busy={busy}
          rosterLoaded={rosterLoaded}
          exportError={exportError}
          excludedOpen={excludedOpen}
          onExcludedToggle={setExcludedOpen}
          promoteCandidate={promoteCandidate}
          excludeCandidate={excludeCandidate}
          excludeUnverifiedCandidate={excludeUnverifiedCandidate}
          openIdentityConfirmation={openIdentityConfirmation}
          enrichRecommended={enrichRecommended}
          repairCandidateKey={repairCandidateKey}
          repairRequestsByCandidateKey={repairRequestsByCandidateKey}
          repairRequestsUnavailable={repairRequestsUnavailable}
          retryRosterLoad={retryRosterLoad}
          requestAddressRepair={requestAddressRepair}
          reviewAddressConflict={reviewAddressConflict}
          retryAddressCheck={retryAddressCheck}
          useLead={useLead}
          setEditingContact={setEditingContact}
          runSearch={runSearch}
          progress={progress}
        />
        <SearchContactModals
          editingContact={editingContact}
          confirmingContact={confirmingContact}
          persistManualContact={persistManualContact}
          verifyAddressContact={verifyAddressContact}
          setEditingContact={setEditingContact}
          confirmIdentityContact={confirmIdentityContact}
          setConfirmingContact={setConfirmingContact}
        />
      </Card>

      {manualAddSlot}

      <HandledReviewers handledReviewers={handledReviewers} onNavigate={onNavigate} />

      <ApplicantReviewerStatus
        ingestLoading={ingestLoading}
        recPhase={recPhase}
        ingestError={ingestError}
        onRetryIngestion={onRetryIngestion}
        recommended={recommended}
        recommendedFailed={recommendedFailed}
        slotsPopulated={slotsPopulated}
        knownLookupFailed={knownLookupFailed}
        blobUrl={blobUrl}
        recCount={recCount}
        recProgress={recProgress}
        recVerifiedCount={recVerifiedCount}
        recIdentityReviewCount={recIdentityReviewCount}
        enrichRecommended={enrichRecommended}
        proposalKey={proposalKey}
        recError={recError}
      />
    </>
  );
}
