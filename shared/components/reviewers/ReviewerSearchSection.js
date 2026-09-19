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
import { readSseStream } from './sse';
import {
  mergeEnrichment,
  isCandidateSelectable,
  canConfirmCandidateForPromotion,
  getCandidatePromotionDecision,
  getCandidateEmailReadiness,
  correlateSaveResultsToRosterCandidates,
  pruneCandidateForRoster,
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
  PROVENANCE_KINDS,
  provenanceGroupOf,
  provenanceKindOf,
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

  // Apply a staff-entered MANUAL contact to transient candidate state. Used by
  // the lead "Use this email" promotion (Slice 4); the on-card Edit-contact
  // modal now persists website/affiliation through persistManualContact first.
  // For email/website it
  // stamps `manual` provenance (so emailConfidence → low → the invite flow requires
  // explicit quick-check acknowledgement) and clears the contact-layer abstain that
  // withheld a value (e.g. verified_domain_contradiction) so save can persist it.
  // NEVER touches name (the find-card key) or any identity field.
  const setManualContact = useCallback((cand, updates) => {
    if (!cand || !updates) return;
    const key = candKey(cand);
    if (!key) return;
    const apply = (c) => {
      if (candKey(c) !== key) return c;
      const enr = { ...(c.contactEnrichment || {}) };
      const next = { ...c, contactEnrichment: enr };
      // Record EXACTLY which fields the human edited, so the applicant-promote path
      // persists only those (Codex: affiliationPersistAllowed/hIndex are also set by
      // enrichment, so they're NOT a manual signal — overwriting from the card would
      // clobber enrichment values). Monotonic: a later edit unions with prior ones.
      const manualFields = new Set(Array.isArray(c.manualContactFields) ? c.manualContactFields : []);
      for (const k of Object.keys(updates)) manualFields.add(k);
      next.manualContactFields = Array.from(manualFields);
      // A manual email OR website is a staff override of the contact-quality
      // abstain (e.g. verified_domain_contradiction) — clear it for both so save
      // can persist the typed value (Codex review LOW: website edits were missing
      // this clear, so a withheld-by-domain row's manual website was blocked).
      if ('email' in updates || 'website' in updates) {
        enr.contactStatus = null; enr.contactStatusReason = null;
      }
      if ('email' in updates) {
        const email = updates.email || null;
        enr.email = email; enr.emailSource = email ? 'manual' : null; enr.emailPersistAllowed = !!email;
        next.email = email; next.emailSource = email ? 'manual' : null; next.emailPersistAllowed = !!email;
      }
      if ('website' in updates) {
        const website = updates.website || null;
        enr.website = website; enr.websiteSource = website ? 'manual' : null; enr.websitePersistAllowed = !!website;
        next.website = website; next.websiteSource = website ? 'manual' : null; next.websitePersistAllowed = !!website;
      }
      if ('affiliation' in updates) {
        const affiliation = updates.affiliation || null;
        enr.affiliationPersistAllowed = true;
        next.affiliation = affiliation;
      }
      if ('hIndex' in updates) {
        const h = updates.hIndex;
        const parsed = (h === '' || h == null) ? null : Number(h);
        const safe = Number.isFinite(parsed) ? parsed : null; // guard NaN (Codex review LOW)
        enr.hIndex = safe; next.hIndex = safe;
      }
      return next;
    };
    setCandidates((prev) => prev.map(apply));
    setRecCandidates((prev) => prev.map(apply));
    setRosterActive((prev) => prev.map(apply));
  }, []);

  const applyAuthoritativeRosterCandidate = useCallback((key, candidate) => {
    if (!key || !candidate) return;
    const replace = (current) => (candKey(current) === key ? candidate : current);
    setCandidates((prev) => prev.map(replace));
    setRecCandidates((prev) => prev.map(replace));
    setRosterActive((prev) => prev.map(replace));
  }, []);

  const persistManualContact = useCallback(async (cand, updates) => {
    if (!cand || !requestId) throw new Error('Reload this request before editing contact details.');
    const key = candKey(cand);
    if (!key) throw new Error('This reviewer has no stable roster key. Reload and try again.');
    const durableUpdates = {};
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'website')) durableUpdates.website = updates.website;
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'affiliation')) durableUpdates.affiliation = updates.affiliation;
    const localUpdates = { ...(updates || {}) };
    delete localUpdates.website;
    delete localUpdates.affiliation;
    if (Object.keys(durableUpdates).length === 0) {
      setManualContact(cand, updates);
      return;
    }
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-roster', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        action: 'update_contact_draft',
        candidateKey: key,
        updates: durableUpdates,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return false;
    if (!response.ok || !data.success || !data.candidate) {
      throw new Error(data.error || 'Could not save these contact details to the request.');
    }
    applyAuthoritativeRosterCandidate(key, data.candidate);
    if (Object.keys(localUpdates).length > 0) {
      setManualContact(data.candidate, localUpdates);
    }
    setRosterNote(`${data.candidate.name || cand.name}: contact details saved to this request.`);
  }, [requestId, setManualContact, applyAuthoritativeRosterCandidate]);

  const verifyAddressContact = useCallback(async (cand, updates, evidence) => {
    if (!cand || !requestId) throw new Error('Reload this request before verifying an address.');
    const key = candKey(cand);
    if (!key) throw new Error('This reviewer has no stable roster key. Reload and try again.');
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        candidateKey: key,
        action: 'verify_person_and_address',
        email: updates.email,
        // Exact-person verification covers every field used by the promotion
        // confirmation gate. The server stores these fields and renews the
        // opaque confirmation in the same roster update as the address receipt.
        verifiedContact: {
          website: updates.website !== undefined ? updates.website : (cand.website || ''),
          affiliation: updates.affiliation !== undefined ? updates.affiliation : (cand.affiliation || ''),
        },
        evidenceType: evidence.evidenceType,
        evidenceUrl: evidence.evidenceUrl,
        note: evidence.note,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return false;
    if (!response.ok || !data.success || !data.candidate) {
      // Verification can commit the server-owned roster receipt before an
      // ETag-guarded Dataverse adjudication fails. Reflect only that explicit
      // partial success so the card and the next retry use the authoritative
      // receipt instead of silently reverting to the pre-verification state.
      if (data.partialSuccess === true && data.receiptRecorded === true && data.candidate) {
        applyAuthoritativeRosterCandidate(key, data.candidate);
      }
      throw new Error(addressTrustFailureMessage(data, 'Could not verify this address.'));
    }
    applyAuthoritativeRosterCandidate(key, data.candidate);
    setSelected((prev) => { const next = new Set(prev); next.add(key); return next; });
    setRosterNote(`${data.candidate.name || cand.name}: exact person and address verified.`);
    return true;
  }, [requestId, applyAuthoritativeRosterCandidate]);

  const reviewAddressConflict = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, candidateKey: key, action: 'get_address_conflict' }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return;
    if (!response.ok || !data.success || !data.conflict) {
      setRosterNote(addressTrustFailureMessage(
        data,
        'Could not load the current address conflict. Use the available action on this reviewer card.',
      ));
      return;
    }
    setEditingContact({ ...cand, addressConflict: data.conflict });
  }, [requestId]);

  const retryAddressCheck = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        candidateKey: key,
        action: 'retry_check',
        code: cand.serverRepairReason
          || (getCandidatePromotionDecision(cand)?.decision === 'needs_record_repair'
            ? getCandidatePromotionDecision(cand).reason
            : null),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return;
    if (!response.ok || !data.success || !data.candidate) {
      setRosterNote(addressTrustFailureMessage(
        data,
        'The conflict check could not be retried. Use the available action on this reviewer card.',
      ));
      return;
    }
    applyAuthoritativeRosterCandidate(key, data.candidate);
    setRosterNote(`${data.candidate.name || cand.name}: record check refreshed. Add the reviewer to Invite again.`);
  }, [requestId, applyAuthoritativeRosterCandidate]);

  const requestAddressRepair = useCallback(async (cand) => {
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        candidateKey: key,
        action: 'create_repair_request',
        code: cand.serverRepairReason
          || (getCandidatePromotionDecision(cand)?.decision === 'needs_record_repair'
            ? getCandidatePromotionDecision(cand).reason
            : null)
          || (getCandidateEmailReadiness(cand).action === 'blocked'
            ? 'address_conflict_pending'
            : 'address_verification_required'),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return;
    if (response.ok && data.success && data.repairRequest) {
      setRepairRequestsByCandidateKey((previous) => ({
        ...previous,
        [key]: data.repairRequest,
      }));
    }
    setRosterNote(response.ok && data.success
      ? data.message
      : (data.message || data.error || 'Could not create a repair request. Retry from this reviewer card.'));
  }, [requestId]);

  // Slice 4: a quarantined email lead must pass through the evidence form;
  // website-only leads remain a direct non-address edit.
  const useLead = useCallback((cand, lead) => {
    if (!cand || !lead || !lead.value) return;
    if (lead.type === 'email') {
      setEditingContact({ ...cand, email: lead.value, emailSource: 'manual' });
      return;
    }
    setManualContact(cand, { website: lead.value });
  }, [setManualContact]);

  // The candidate currently open in the on-card Edit-contact modal (local mode).
  const [editingContact, setEditingContact] = useState(null);
  // The needs-identity-review candidate open in the "confirm this person" modal.
  const [confirmingContact, setConfirmingContact] = useState(null);

  const openIdentityConfirmation = useCallback(async (cand) => {
    if (!cand?.addressConflictPending) {
      setConfirmingContact(cand);
      return;
    }
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, candidateKey: key, action: 'get_address_conflict' }),
    });
    const data = await response.json().catch(() => ({}));
    if (genRef.current !== myGen) return;
    if (!response.ok || !data.success || !data.conflict) {
      setRosterNote(addressTrustFailureMessage(
        data,
        'Could not load the current email choice. Reload the reviewer card and try again.',
      ));
      return;
    }
    setConfirmingContact({ ...cand, addressConflict: data.conflict });
  }, [requestId]);

  // PD confirms a needs-identity-review row IS the right person + supplies corrected
  // contact. The authenticated roster PATCH stores the request-scoped attestation
  // first; only then do we stamp manual contact + the UI marker/opaque id locally.
  const confirmIdentityContact = useCallback(async (cand, updates, evidence) => {
    if (!cand) return false;
    const key = candKey(cand);
    if (!key || !requestId) return false;
    const myGen = genRef.current;
    // An unverified Claude suggestion is ephemeral — it was never recorded on
    // the durable roster (S224), but confirm_identity only updates an existing
    // ACTIVE roster row. Record it first so the attestation has a row to bind
    // to; recordSurfaced upserts, so a re-run after a partial failure is safe.
    const wasUnverified = unverified.some((u) => candKey(u) === key);
    if (wasUnverified) {
      const recordRes = await fetch('/api/workbench/reviewer-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, candidates: [pruneCandidateForRoster(cand)] }),
      });
      const recordData = await recordRes.json().catch(() => ({}));
      if (!recordRes.ok || !recordData.success) {
        throw new Error(recordData.error || 'Could not add this suggestion to the request roster. Please retry.');
      }
      if (genRef.current !== myGen) return false;
    }
    const confirmedCandidate = {
      ...cand,
      ...updates,
      emailSource: 'manual',
      websiteSource: updates.website ? 'manual' : null,
      affiliationSource: 'staff_manual',
      contactEnrichment: {
        ...(cand.contactEnrichment || {}),
        ...updates,
        emailSource: 'manual',
        websiteSource: updates.website ? 'manual' : null,
        affiliationSource: 'staff_manual',
      },
    };
    const response = await fetch('/api/workbench/reviewer-roster', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, action: 'confirm_identity', candidate: confirmedCandidate }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.confirmationId) {
      throw new Error(data.error || 'Could not record identity confirmation. Please retry.');
    }
    if (genRef.current !== myGen) return false;
    const authoritativeConfirmed = data.candidate || confirmedCandidate;
    // The confirmation write has already committed. Keep that server truth in
    // the card even if the following address-evidence write fails and the modal
    // stays open for a retry.
    if (wasUnverified) {
      // The suggestion is now a durable active roster row: move it out of the
      // ephemeral Unverified section so the confirmed card renders (and stays
      // rescuable through the normal needs-identity-review machinery).
      setUnverified((prev) => prev.filter((u) => candKey(u) !== key));
      setRosterActive((prev) => dedupeByName([authoritativeConfirmed, ...prev]));
    }
    applyAuthoritativeRosterCandidate(key, authoritativeConfirmed);
    return verifyAddressContact(authoritativeConfirmed, updates, evidence);
  }, [requestId, unverified, verifyAddressContact, applyAuthoritativeRosterCandidate]);

  const refreshExpiredVerification = useCallback(async (staleCandidates, expectedGeneration) => {
    if (!requestId || !Array.isArray(staleCandidates) || staleCandidates.length === 0) {
      return { refreshed: [], failures: [], stale: false };
    }
    const failures = staleCandidates
      .filter((candidate) => Array.isArray(candidate?.manualContactFields) && candidate.manualContactFields.length > 0)
      .map((candidate) => ({
        name: candidate.name || 'Unknown candidate',
        error: 'Manual contact details were not overwritten by automated refresh; confirm the contact again before adding to Invite.',
      }));
    const refreshableCandidates = staleCandidates.filter((candidate) => (
      !Array.isArray(candidate?.manualContactFields) || candidate.manualContactFields.length === 0
    ));
    if (refreshableCandidates.length === 0) {
      return { refreshed: [], failures, stale: false };
    }
    pushProgress(`Refreshing contact verification for ${refreshableCandidates.length} reviewer(s)…`, expectedGeneration);
    const enrichmentResponse = await fetch('/api/reviewer-finder/enrich-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: refreshableCandidates,
        options: { usePubmed: true, useOrcid: true, useSerpSearch: true, useClaudeSearch: true },
        authorInstitution: analysis?.proposalInfo?.authorInstitution || null,
        requestId,
      }),
    });
    let enrichmentResults = null;
    let streamError = null;
    await readSseStream(enrichmentResponse, ({ event, data }) => {
      if (event === 'error' || data?.type === 'error') {
        streamError = data?.message || 'contact verification refresh failed';
        return;
      }
      if (data?.type === 'progress' && data.overall && genRef.current === expectedGeneration) {
        pushProgress(`Refreshing verification ${data.overall.current}/${data.overall.total}…`, expectedGeneration);
      }
      if (data?.type === 'complete') enrichmentResults = data.results;
    });
    if (genRef.current !== expectedGeneration) {
      return { refreshed: [], failures: [], stale: true };
    }
    if (streamError || !Array.isArray(enrichmentResults)) {
      throw new Error(streamError || 'Contact verification refresh returned no results.');
    }

    const merged = mergeEnrichment(refreshableCandidates, enrichmentResults);
    const ready = [];
    for (let index = 0; index < refreshableCandidates.length; index += 1) {
      const before = refreshableCandidates[index];
      const after = merged[index];
      const newReceipt = after?.automatedIdentityAttestation;
      if (!newReceipt || newReceipt === before?.automatedIdentityAttestation) {
        failures.push({
          name: before?.name || 'Unknown candidate',
          error: 'Contact verification could not be refreshed.',
        });
      } else {
        ready.push(after);
      }
    }

    // POST one row at a time because the roster endpoint returns a count, not
    // per-row identifiers. A recorded=1 response is therefore an exact durable
    // acknowledgement for this candidate; recorded=0 stays retryable.
    const refreshed = [];
    for (const candidate of ready) {
      if (genRef.current !== expectedGeneration) {
        return { refreshed, failures, stale: true };
      }
      const rosterResponse = await fetch('/api/workbench/reviewer-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          candidates: [pruneCandidateForRoster(candidate)],
        }),
      });
      const rosterData = await rosterResponse.json().catch(() => ({}));
      if (genRef.current !== expectedGeneration) {
        return { refreshed, failures, stale: true };
      }
      if (rosterResponse.ok && rosterData.success && rosterData.recorded === 1) {
        refreshed.push(candidate);
      } else {
        failures.push({
          name: candidate.name || 'Unknown candidate',
          error: rosterData.error || 'Refreshed verification could not be written to the active roster.',
        });
      }
    }
    return {
      refreshed,
      failures,
      stale: genRef.current !== expectedGeneration,
    };
  }, [requestId, analysis, pushProgress]);

  const saveSelected = useCallback(async (candidateKeys = selected) => {
    const myGen = genRef.current;
    if (savingRef.current === myGen) return;
    // Filter by isSelectable too (not just `selected`): a needs-identity-review row
    // can't be checked, but this guarantees one never reaches save-candidates even if
    // a stale `selected` entry survives a reclassification (defense-in-depth; the
    // server 422s these anyway).
    const keysToSave = candidateKeys instanceof Set ? candidateKeys : selected;
    const chosen = displayCandidates.filter((c) => keysToSave.has(candKey(c)) && isCandidateSelectable(c));
    if (chosen.length === 0) return;
    savingRef.current = myGen;
    const isCurrent = () => genRef.current === myGen;
    setSavingCount(chosen.length);
    setPhase('saving');
    setError(null); setErrorMeta(null); setProgress([]); setPromotionNotice(null);
    try {
      // Candidates were already enriched at results time (stage 4 of runSearch),
      // so the chosen rows carry contact info + bibliometrics — save them directly.
      const applicantChosen = [];
      const toSave = [];
      const failures = [];
      for (const c of chosen) {
        if (provenanceKindOf(c) === PROVENANCE_KINDS.APPLICANT_SUGGESTED) {
          if (c.suggestionId) applicantChosen.push(c);
          else failures.push({ name: c.name || 'Applicant-referred reviewer', error: 'missing suggestionId' });
        } else {
          toSave.push(c);
        }
      }

      let saved = 0;
      let savedKeys = [];
      let savedResultRosterKeys = [];
      let savedRosterKeys = [];
      let blockedRosterKeys = [];
      let expiredRosterKeys = [];
      let addressVerificationKeys = [];
      let addressRepairKeys = [];
      let identityReviewResults = [];
      let serverRepairResults = [];
      let needsRosterReload = false;
      let refreshedVerificationCandidates = [];
      const rosterWarnings = [];
      if (toSave.length > 0) {
        pushProgress(`Saving ${toSave.length} candidate(s)…`, myGen);
        let receivedResponse = false;
        try {
          const sRes = await fetch('/api/reviewer-finder/save-candidates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId,
              proposalTitle: analysis?.proposalInfo?.title || null,
              programArea: analysis?.proposalInfo?.programArea || null,
              candidates: toSave,
            }),
          });
          receivedResponse = true;
          const sData = await sRes.json().catch(() => ({}));
          const saveResults = Array.isArray(sData.results) ? sData.results : [];
          const correlatedSaveResults = correlateSaveResultsToRosterCandidates(saveResults, toSave);
          const recordRepairCodes = new Set([
            'person_inactive',
            'email_conflict',
            'ambiguous_email_owner',
            'inactive_email_owner',
            'contact_linked_elsewhere',
          ]);
          saved = sData.savedCount || 0;
          savedKeys = Array.isArray(sData.savedKeys) ? sData.savedKeys : [];
          const correlatedSavedKeyResults = correlateSaveResultsToRosterCandidates(
            savedKeys.map((candidateKey) => ({ candidateKey })),
            toSave,
          );
          savedResultRosterKeys = Array.from(new Set([
            ...correlatedSaveResults
              .filter((result) => (
                result?.outcome === 'saved'
                && typeof result?.rosterCandidateKey === 'string'
              ))
              .map((result) => result.rosterCandidateKey),
            ...correlatedSavedKeyResults
              .filter((result) => typeof result?.rosterCandidateKey === 'string')
              .map((result) => result.rosterCandidateKey),
          ]));
          blockedRosterKeys = correlatedSaveResults
            .filter((result) => (
              result?.outcome === 'failed'
              && result?.code === 'applicant_excluded'
              && typeof result?.rosterCandidateKey === 'string'
            ))
            .map((result) => result.rosterCandidateKey);
          expiredRosterKeys = correlatedSaveResults
            .filter((result) => (
              result?.code === 'identity_attestation_required'
              && typeof result?.rosterCandidateKey === 'string'
            ))
            .map((result) => result.rosterCandidateKey);
          addressVerificationKeys = correlatedSaveResults
            .filter((result) => (
              result?.code === 'address_verification_required'
              && typeof result?.rosterCandidateKey === 'string'
            ))
            .map((result) => result.rosterCandidateKey);
          addressRepairKeys = correlatedSaveResults
            .filter((result) => (
              result?.code === 'conflict_record_unavailable'
              && typeof result?.rosterCandidateKey === 'string'
            ))
            .map((result) => result.rosterCandidateKey);
          identityReviewResults = correlatedSaveResults.filter((result) => (
            result?.decision === 'identity_choice_required'
            && !recordRepairCodes.has(result?.code)
            && typeof result?.rosterCandidateKey === 'string'
          ));
          serverRepairResults = correlatedSaveResults.filter((result) => (
            recordRepairCodes.has(result?.code)
            && typeof result?.rosterCandidateKey === 'string'
          ));
          needsRosterReload = saveResults.some((result) => (
            result?.outcome === 'saved' && result?.rosterFinalized === false
          ));
          if (needsRosterReload) {
            rosterWarnings.push('A reviewer was saved, but the Find roster could not be finalized.');
          }
          if (Array.isArray(sData.errors)) failures.push(...sData.errors);
          if ((!sRes.ok || !sData.success) && saved === 0) {
            const detail = formatSaveFailureDetails(sData.errors);
            failures.push({
              name: 'Add to Invite',
              error: detail
                ? `${sData.error || `Save failed (${sRes.status})`} ${detail}`
                : (sData.error || `Save failed (${sRes.status})`),
            });
          }
        } catch (e) {
          if (!receivedResponse && requestId) {
            // The request may have committed before the connection failed. Treat
            // this as unknown-outcome and reload the server-owned roster before a
            // retry can create another person/suggestion.
            try {
              const rosterData = await reloadRoster(myGen);
              if (isCurrent() && rosterData) {
                const currentSavedKeys = Array.isArray(rosterData.savedKeys) ? rosterData.savedKeys : [];
                savedRosterKeys = currentSavedKeys;
                saved = toSave.filter((candidate) => currentSavedKeys.includes(candKey(candidate))).length;
              }
            } catch { /* retain unknown-outcome error below */ }
          }
          const knownSavedRosterKeys = new Set([...savedResultRosterKeys, ...savedRosterKeys]);
          failures.push(...toSave
            .filter((candidate) => !knownSavedRosterKeys.has(candKey(candidate)))
            .map((c) => ({
              name: c.name || 'Unknown candidate',
              error: receivedResponse ? e.message : 'Save outcome is unknown; roster state was refreshed before retry.',
            })));
        }

        const expiredSet = new Set(expiredRosterKeys);
        const expiredCandidates = toSave.filter((candidate) => expiredSet.has(candKey(candidate)));
        if (expiredCandidates.length > 0 && isCurrent()) {
          try {
            const refreshResult = await refreshExpiredVerification(expiredCandidates, myGen);
            if (refreshResult.stale || !isCurrent()) return;
            refreshedVerificationCandidates = refreshResult.refreshed;
            failures.unshift(...refreshResult.failures);
            if (refreshedVerificationCandidates.length > 0) {
              rosterWarnings.push(
                `Contact verification was refreshed for ${refreshedVerificationCandidates.length} reviewer`
                + `${refreshedVerificationCandidates.length === 1 ? '' : 's'}. Review the updated contact details, then add to Invite again.`,
              );
            }
            if (refreshResult.failures.length > 0) {
              rosterWarnings.push(
                `Verification could not be refreshed for ${refreshResult.failures.length} reviewer`
                + `${refreshResult.failures.length === 1 ? '' : 's'}; those rows remain unchanged and retryable.`,
              );
            }
          } catch (refreshError) {
            failures.push({
              name: 'Contact verification refresh',
              error: refreshError.message,
            });
          }
        }
      }
      if (!isCurrent()) return;

      let promoted = 0;
      const promotedCandidates = [];
      if (applicantChosen.length > 0) {
        if (isCurrent()) pushProgress(`Adding ${applicantChosen.length} applicant-referred reviewer(s) to Invite…`, myGen);
        const results = await Promise.all(applicantChosen.map(async (c) => {
          try {
            // Carry the PD's hand-corrections (ONLY the fields marked manual) so the
            // promote route persists them instead of dropping them. Send VALUES only —
            // the server writes to the suggestion's own person record, never a
            // client-supplied id, and forces email/website provenance to 'manual'.
            const manualFields = Array.isArray(c.manualContactFields) ? c.manualContactFields : [];
            const contact = {};
            if (manualFields.includes('email')) contact.email = c.email || null;
            if (manualFields.includes('website')) contact.website = c.website || null;
            if (manualFields.includes('affiliation')) contact.affiliation = c.affiliation || null;
            if (manualFields.includes('hIndex')) contact.hIndex = c.hIndex ?? null;
            const body = { requestId, suggestionId: c.suggestionId };
            if (Object.keys(contact).length > 0) body.contact = contact;

            const res = await fetch('/api/workbench/promote-applicant-reviewer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
              const error = new Error(data.message || data.error || `Adding to Invite failed (${res.status})`);
              error.code = data.code || null;
              throw error;
            }
            return {
              ok: true,
              candidate: c,
              rosterFinalized: data.rosterFinalized === true,
            };
          } catch (e) {
            return { ok: false, candidate: c, error: e.message, code: e.code || null };
          }
        }));
        for (const result of results) {
          if (result.ok) {
            promoted += 1;
            promotedCandidates.push(result.candidate);
            if (!result.rosterFinalized) {
              needsRosterReload = true;
              rosterWarnings.push('An applicant-referred reviewer was added, but the Find roster could not be finalized.');
            }
          } else {
            failures.push({ name: result.candidate.name || 'Applicant-referred reviewer', error: result.error });
            if (result.code === 'address_verification_required') {
              addressVerificationKeys.push(candKey(result.candidate));
            } else if (result.code === 'conflict_record_unavailable') {
              addressRepairKeys.push(candKey(result.candidate));
            } else if (new Set(['person_inactive', 'email_conflict', 'ambiguous_email_owner', 'inactive_email_owner', 'contact_linked_elsewhere']).has(result.code)) {
              serverRepairResults.push({
                rosterCandidateKey: candKey(result.candidate),
                code: result.code,
              });
            }
          }
        }
      }

      // The server owns the durable `saved` transition. The browser only
      // reconciles exact successful keys into its current view.
      if (savedResultRosterKeys.length > 0 || savedRosterKeys.length > 0) {
        const savedSet = new Set([...savedResultRosterKeys, ...savedRosterKeys]);
        const wasSaved = (candidate) => savedSet.has(candKey(candidate));
        if (isCurrent()) {
          const matchedSavedCandidates = displayCandidates.filter(wasSaved);
          const matchedSavedRosterKeys = matchedSavedCandidates.map(candKey).filter(Boolean);
          setCandidates((prev) => prev.filter((c) => !wasSaved(c)));
          setRosterActive((prev) => prev.filter((c) => !wasSaved(c)));
          setRosterSavedKeys((prev) => Array.from(new Set([...prev, ...matchedSavedRosterKeys])));
          setSelected((prev) => {
            const next = new Set(prev);
            matchedSavedCandidates.forEach((candidate) => next.delete(candKey(candidate)));
            return next;
          });
        }
      }
      if (blockedRosterKeys.length > 0 && isCurrent()) {
        const blockedSet = new Set(blockedRosterKeys);
        const wasBlocked = (candidate) => blockedSet.has(candKey(candidate));
        const blockedCandidates = displayCandidates
          .filter(wasBlocked)
          .map((candidate) => ({
            ...candidate,
            promotionDecision: 'blocked_applicant_excluded',
            promotionBlockCode: 'applicant_excluded',
            promotionBlockReason: 'This reviewer is applicant-excluded for the request and cannot be added to Invite.',
          }));
        setCandidates((prev) => prev.filter((candidate) => !wasBlocked(candidate)));
        setRecCandidates((prev) => prev.filter((candidate) => !wasBlocked(candidate)));
        setRosterActive((prev) => prev.filter((candidate) => !wasBlocked(candidate)));
        setRosterBlocked((prev) => dedupeByName([...blockedCandidates, ...prev]));
        setSelected((prev) => {
          const next = new Set(prev);
          displayCandidates.filter(wasBlocked).forEach((candidate) => next.delete(candKey(candidate)));
          return next;
        });
      }
      if (refreshedVerificationCandidates.length > 0 && isCurrent()) {
        const refreshedByRosterKey = new Map(
          refreshedVerificationCandidates.map((candidate) => [candKey(candidate), candidate]),
        );
        const applyRefresh = (candidate) => refreshedByRosterKey.get(candKey(candidate)) || candidate;
        setCandidates((prev) => prev.map(applyRefresh));
        setRecCandidates((prev) => prev.map(applyRefresh));
        setRosterActive((prev) => prev.map(applyRefresh));
        setSelected((prev) => {
          const next = new Set(prev);
          refreshedVerificationCandidates.forEach((candidate) => next.delete(candKey(candidate)));
          return next;
        });
      }

      if ((addressVerificationKeys.length > 0 || addressRepairKeys.length > 0) && isCurrent()) {
        const verificationSet = new Set(addressVerificationKeys);
        const repairSet = new Set(addressRepairKeys);
        const exposeRemedy = (candidate) => {
          const key = candKey(candidate);
          if (!verificationSet.has(key) && !repairSet.has(key)) return candidate;
          return {
            ...candidate,
            addressTrustReceipt: verificationSet.has(key) ? null : candidate.addressTrustReceipt,
            addressVerificationRequired: verificationSet.has(key) || candidate.addressVerificationRequired === true,
            conflictRecordUnavailable: repairSet.has(key) || candidate.conflictRecordUnavailable === true,
          };
        };
        setCandidates((prev) => prev.map(exposeRemedy));
        setRecCandidates((prev) => prev.map(exposeRemedy));
        setRosterActive((prev) => prev.map(exposeRemedy));
        setSelected((prev) => {
          const next = new Set(prev);
          [...addressVerificationKeys, ...addressRepairKeys].forEach((key) => next.delete(key));
          return next;
        });
        if (addressVerificationKeys.length > 0) {
          rosterWarnings.push('Address verification is required. Use “Verify address” on each affected reviewer, then add to Invite again.');
        }
        if (addressRepairKeys.length > 0) {
          rosterWarnings.push('A conflict safety record could not be written. Retry from the reviewer card or create a durable repair request.');
        }
      }

      if (identityReviewResults.length > 0 && isCurrent()) {
        const reasonByKey = new Map(identityReviewResults.map((result) => [
          result.rosterCandidateKey,
          result.code || 'ambiguous_or_name_mismatch',
        ]));
        const exposeIdentityRemedy = (candidate) => {
          const reason = reasonByKey.get(candKey(candidate));
          return reason ? { ...candidate, serverIdentityReviewReason: reason } : candidate;
        };
        setCandidates((prev) => prev.map(exposeIdentityRemedy));
        setRecCandidates((prev) => prev.map(exposeIdentityRemedy));
        setRosterActive((prev) => prev.map(exposeIdentityRemedy));
        setSelected((prev) => {
          const next = new Set(prev);
          identityReviewResults.forEach((result) => next.delete(result.rosterCandidateKey));
          return next;
        });
        rosterWarnings.push('Dataverse identity evidence needs review. Use “Confirm identity” to verify the person and exact address, or set the reviewer aside.');
      }

      if (serverRepairResults.length > 0 && isCurrent()) {
        const reasonByKey = new Map(serverRepairResults.map((result) => [
          result.rosterCandidateKey,
          result.code || 'record_repair_required',
        ]));
        const exposeRepair = (candidate) => {
          const reason = reasonByKey.get(candKey(candidate));
          return reason ? { ...candidate, serverRepairReason: reason } : candidate;
        };
        setCandidates((prev) => prev.map(exposeRepair));
        setRecCandidates((prev) => prev.map(exposeRepair));
        setRosterActive((prev) => prev.map(exposeRepair));
        setSelected((prev) => {
          const next = new Set(prev);
          serverRepairResults.forEach((result) => next.delete(result.rosterCandidateKey));
          return next;
        });
        rosterWarnings.push('Fix the identified reviewer record in AkoyaGO, then use “Retry record check” on the affected card.');
      }

      const totalSucceeded = saved + promoted;
      if (totalSucceeded === 0) {
        if (refreshedVerificationCandidates.length > 0 && isCurrent()) {
          const warning = Array.from(new Set(rosterWarnings)).join(' ');
          setRosterNote(warning);
          setPromotionNotice({ tone: 'warning', message: warning });
          setPhase('results');
          return;
        }
        if ((addressVerificationKeys.length > 0 || addressRepairKeys.length > 0) && isCurrent()) {
          const warning = Array.from(new Set(rosterWarnings)).join(' ');
          setRosterNote(warning);
          setPromotionNotice({ tone: 'warning', message: warning });
          setPhase('results');
          return;
        }
        if (identityReviewResults.length > 0 && isCurrent()) {
          const warning = Array.from(new Set(rosterWarnings)).join(' ');
          setRosterNote(warning);
          setPromotionNotice({ tone: 'warning', message: warning });
          setPhase('results');
          return;
        }
        if (serverRepairResults.length > 0 && isCurrent()) {
          const warning = Array.from(new Set(rosterWarnings)).join(' ');
          setRosterNote(warning);
          setPromotionNotice({ tone: 'warning', message: warning });
          setPhase('results');
          return;
        }
        const detail = formatSaveFailureDetails(failures);
        throw new Error(detail ? `No candidates were saved: ${detail}` : 'No candidates were saved.');
      }

      const messageParts = [];
      if (saved > 0) messageParts.push(`Saved ${saved} of ${toSave.length} to this request's candidate pool.`);
      if (promoted > 0) messageParts.push(`Added ${promoted} of ${applicantChosen.length} applicant-referred reviewer${applicantChosen.length === 1 ? '' : 's'} to Invite.`);
      if (failures.length > 0) {
        const detail = failures.map((f) => `${f.name || 'Unknown candidate'}: ${f.error || 'failed'}`).join('; ');
        messageParts.push(`${failures.length} could not be saved (${detail}).`);
      }
      if (isCurrent()) {
        const message = messageParts.join(' ');
        setPromotionNotice({ tone: 'success', message });
        setPhase('done');
      }
      if (promotedCandidates.length > 0) {
        const promotedKeys = new Set(promotedCandidates.map(candKey));
        if (isCurrent()) {
          setCandidates((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
          setRecCandidates((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
          setRosterActive((prev) => prev.filter((c) => !promotedKeys.has(candKey(c))));
          setSelected((prev) => { const next = new Set(prev); promotedKeys.forEach((k) => next.delete(k)); return next; });
        }
        if (isCurrent()) {
          setRosterSavedKeys((prev) => Array.from(new Set([...prev, ...promotedKeys])));
        }
      }
      if (needsRosterReload && isCurrent()) {
        const snapshot = await reloadRoster(myGen);
        if (isCurrent()) {
          rosterWarnings.push(snapshot
            ? 'The server-owned roster was reloaded before another attempt.'
            : 'Reload this request before another attempt.');
        }
      }
      if (isCurrent() && rosterWarnings.length > 0) {
        setRosterNote(Array.from(new Set(rosterWarnings)).join(' '));
      }
      if (isCurrent() && onSaved && totalSucceeded > 0) onSaved();
    } catch (e) {
      if (isCurrent()) {
        setError(e.message);
        setPromotionNotice({ tone: 'error', message: e.message });
        setPhase('error');
      }
    } finally {
      if (savingRef.current === myGen) savingRef.current = null;
      if (isCurrent()) setSavingCount(0);
    }
  }, [
    displayCandidates,
    selected,
    requestId,
    analysis,
    onSaved,
    pushProgress,
    refreshExpiredVerification,
    reloadRoster,
  ]);

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
