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
 *
 * Ownership: this public facade owns the Stage 2 view contract and public
 * defaults/exports. useReviewerSearchController owns state, lifecycle, and
 * composition; operation hooks own commands; search view modules render; and
 * existing reviewer-search-logic/sharedutils retain canonical policy;
 * candidateKeys delegates to them.
 */

import { Card } from '../Layout';
import { REDISCOVERED_STAGE_LABELS } from '../../utils/reviewer-rediscovery';
import { buildGoogleSearchUrl } from '../../../lib/utils/google-search-url';
import {
  activeInstitutionStage2Presentation,
} from '../../utils/institution-stage2-presentation';
import { CandidateCard } from './search/CandidateCard';
import { addressTrustFailureMessage } from './search/presentation';
import SearchControls from './search/SearchControls';
import SearchResults from './search/SearchResults';
import SearchContactModals from './search/SearchContactModals';
import HandledReviewers from './search/HandledReviewers';
import ApplicantReviewerStatus from './search/ApplicantReviewerStatus';
import useReviewerSearchController from './search/useReviewerSearchController';

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
  const {
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
  } = useReviewerSearchController({
    requestId,
    blobUrl,
    proposalKey,
    excludedNames,
    exclusionsUnavailable,
    excludedRaw,
    recommended,
    recommendedFailed,
    knownLookupFailed,
    slotsPopulated,
    ingestLoading,
    ingestError,
    onRetryIngestion,
    savedPool,
    onSaved,
    onNavigate,
    manualAddSlot,
    canManage,
    repairCandidateKey,
  });

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
