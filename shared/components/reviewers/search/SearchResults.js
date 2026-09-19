import { IdentityComparisonPanel } from './IdentityComparisonPanel';
import { CandidateCard } from './CandidateCard';
import { candKey, isApplicantOriginCandidate } from './candidateKeys';
import {
  canConfirmCandidateForPromotion,
  getCandidatePromotionDecision,
  isCandidateSelectable,
} from '../reviewer-search-logic';
import { activeInstitutionStage2Presentation } from '../../../utils/institution-stage2-presentation';

const BLOCKED_REFERRAL_REASON = {
  already_surfaced_or_excluded: 'already surfaced or excluded',
  proposal_author: 'proposal author',
  institution_coi: 'PI institution conflict',
};

// The durable roster and this-run results are a markup-only view. Selection,
// save, remediation and roster commands remain owned by the facade/controller.
export default function SearchResults({
  rosterNote,
  displayCandidates,
  rosterExcluded,
  rosterIneligible,
  rosterBlocked,
  phase,
  identityComparison,
  enrichNote,
  incompleteCoiCandidates,
  incompleteCoiLabel,
  promotionNotice,
  previousSearchKeys,
  canManage,
  removePreviousResults,
  removingPrevious,
  previousSearchRefs,
  excludedRemoved,
  blockedReferredSeeds,
  unverifiedToShow,
  selected,
  sortMode,
  onSortModeChange,
  allSelected,
  toggleAll,
  readinessSections,
  toggle,
  saveSelected,
  savingCount,
  exportSelected,
  exporting,
  blobUrl,
  busy,
  rosterLoaded,
  exportError,
  excludedOpen,
  onExcludedToggle,
  promoteCandidate,
  excludeCandidate,
  excludeUnverifiedCandidate,
  openIdentityConfirmation,
  enrichRecommended,
  repairCandidateKey,
  repairRequestsByCandidateKey,
  repairRequestsUnavailable,
  retryRosterLoad,
  requestAddressRepair,
  reviewAddressConflict,
  retryAddressCheck,
  useLead,
  setEditingContact,
  runSearch,
  progress,
}) {
  return (
    <>
      {(rosterNote || displayCandidates.length > 0 || rosterExcluded.length > 0 || rosterIneligible.length > 0 || rosterBlocked.length > 0 || phase === 'results' || phase === 'done') && (
        <div className="space-y-3 mt-3">
          <IdentityComparisonPanel comparison={identityComparison} />
          {enrichNote && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{enrichNote}</div>}
          {incompleteCoiCandidates.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
              PubMed coauthor checks were incomplete after automatic retries for {incompleteCoiLabel}.
              {' '}A missing coauthor warning is not conclusive for {incompleteCoiCandidates.length === 1 ? 'that reviewer' : 'those reviewers'}.
            </div>
          )}
          {rosterNote && rosterNote !== promotionNotice?.message && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{rosterNote}</div>}
          {previousSearchKeys.size > 0 && (
            <div className="flex items-center justify-between gap-3 p-3 bg-blue-50 text-blue-800 rounded-lg text-sm">
              <span>
                {previousSearchKeys.size} candidate{previousSearchKeys.size === 1 ? '' : 's'} below {previousSearchKeys.size === 1 ? 'was' : 'were'} restored from an earlier search.
              </span>
              {canManage && (
                <button
                  type="button"
                  onClick={removePreviousResults}
                  disabled={removingPrevious || busy || previousSearchRefs.length !== previousSearchKeys.size}
                  title={previousSearchRefs.length !== previousSearchKeys.size ? 'Reload this request before removing prior results.' : undefined}
                  className="shrink-0 text-xs font-medium underline disabled:opacity-50"
                >
                  {removingPrevious ? 'Removing…' : 'Remove previous results'}
                </button>
              )}
            </div>
          )}
          {excludedRemoved > 0 && (
            <p className="text-xs text-gray-500">
              {excludedRemoved} already-surfaced or excluded {excludedRemoved === 1 ? 'reviewer was' : 'reviewers were'} filtered out of the results.
            </p>
          )}
          {blockedReferredSeeds.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
              <p className="font-medium">Externally-referred reviewer{blockedReferredSeeds.length === 1 ? '' : 's'} blocked</p>
              <ul className="mt-1 text-xs space-y-0.5">
                {blockedReferredSeeds.map((seed, idx) => (
                  <li key={`${seed.name || 'seed'}-${idx}`}>
                    {seed.name || 'Unnamed referral'}: {BLOCKED_REFERRAL_REASON[seed.reason] || seed.reason || 'not selectable'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {displayCandidates.length === 0 && rosterExcluded.length === 0 && rosterIneligible.length === 0 && rosterBlocked.length === 0 && unverifiedToShow.length === 0 ? (
            <p className="text-sm text-gray-600">No candidates were found for this proposal.</p>
          ) : (
            <>
              {displayCandidates.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {displayCandidates.length} candidate{displayCandidates.length === 1 ? '' : 's'} for this request
                      {selected.size > 0 && <> · {selected.size} selected</>}
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center rounded border border-gray-200 overflow-hidden text-xs" role="group" aria-label="Sort order">
                        <button
                          type="button"
                          onClick={() => onSortModeChange('relevance')}
                          aria-pressed={sortMode === 'relevance'}
                          className={`px-2 py-0.5 ${sortMode === 'relevance' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                          title="Order by confidence / relevance rank (default)"
                        >
                          Rank
                        </button>
                        <button
                          type="button"
                          onClick={() => onSortModeChange('alpha')}
                          aria-pressed={sortMode === 'alpha'}
                          className={`px-2 py-0.5 border-l border-gray-200 ${sortMode === 'alpha' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                          title="Order alphabetically by name within each group"
                        >
                          A–Z
                        </button>
                      </span>
                      <button type="button" onClick={toggleAll} className="text-xs text-blue-600 underline">
                        {allSelected ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                  </div>
                  <div data-testid="reviewer-candidate-list" className="space-y-4">
                    {readinessSections.map((section) => (
                      <div key={section.key}>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                          {section.title} ({section.items.length})
                        </p>
                        {section.key === 'needs_review' && (
                          <p className="text-xs text-gray-600 mb-1.5">
                            These reviewers need an identity, address, eligibility, or record issue resolved before they can be added to Invite. Use the primary action shown on each card.
                          </p>
                        )}
                        <div className="space-y-2">
                          {section.items.map((c) => {
                            const selectableNow = isCandidateSelectable(c);
                            const promotionDecision = getCandidatePromotionDecision(c);
                            const canConfirmForPromotion = canConfirmCandidateForPromotion(c);
                            if (selectableNow) {
                              return <CandidateCard
                                key={candKey(c)}
                                candidate={c}
                                previousResult={previousSearchKeys.has(candKey(c))}
                                checked={selected.has(candKey(c))}
                                onToggle={() => toggle(candKey(c))}
                                onAddToInvite={canManage ? () => saveSelected(new Set([candKey(c)])) : undefined}
                                addingToInvite={phase === 'saving'}
                                onExclude={excludeCandidate}
                                onUseLead={useLead}
                                onEdit={setEditingContact}
                                onRetryInstitution={isApplicantOriginCandidate(c) ? enrichRecommended : undefined}
                                canManage={canManage}
                                repairAttention={repairCandidateKey === candKey(c)}
                                repairRequest={repairRequestsByCandidateKey[candKey(c)] || null}
                                repairRequestsUnavailable={repairRequestsUnavailable}
                                onRetryRepairStatus={retryRosterLoad}
                              />;
                            }
                            return <CandidateCard
                              key={candKey(c)}
                              candidate={c}
                              previousResult={previousSearchKeys.has(candKey(c))}
                              readOnly
                              onExclude={excludeCandidate}
                              onEdit={(
                                promotionDecision?.decision === 'ready'
                                || promotionDecision?.reason === 'contact_claim_mismatch'
                                || c.applicantContactMismatch === true
                                || activeInstitutionStage2Presentation(c)?.kind === 'current_conflict'
                              ) ? setEditingContact : undefined}
                              onRequestRepair={requestAddressRepair}
                              onReviewAddressConflict={reviewAddressConflict}
                              onRetryAddressCheck={retryAddressCheck}
                              onRetryInstitution={isApplicantOriginCandidate(c) ? enrichRecommended : undefined}
                              onConfirmIdentity={canConfirmForPromotion ? openIdentityConfirmation : undefined}
                              canManage={canManage}
                              repairAttention={repairCandidateKey === candKey(c)}
                              repairRequest={repairRequestsByCandidateKey[candKey(c)] || null}
                              repairRequestsUnavailable={repairRequestsUnavailable}
                              onRetryRepairStatus={retryRosterLoad}
                            />;
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                    <button
                      type="button"
                      onClick={() => saveSelected()}
                      disabled={selected.size === 0 || phase === 'saving'}
                      aria-busy={phase === 'saving'}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {phase === 'saving' ? (
                        <>
                          <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                          Adding {savingCount} reviewer{savingCount === 1 ? '' : 's'} to Invite…
                        </>
                      ) : (
                        <>Add {selected.size > 0 ? selected.size : ''} selected to Invite</>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={exportSelected}
                      disabled={selected.size === 0 || exporting}
                      title={selected.size === 0 ? 'Select candidates — or use Select all — to export' : undefined}
                      className="px-4 py-2 bg-white text-gray-900 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {exporting ? 'Exporting…' : `Export ${selected.size > 0 ? selected.size : ''} to Excel`}
                    </button>
                    <button type="button" onClick={runSearch} disabled={!blobUrl || busy || removingPrevious || !rosterLoaded} className="text-sm text-gray-500 underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">Run another search</button>
                  </div>
                  {exportError && (
                    <p className="text-sm text-amber-700">Export failed: {exportError}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    Saved candidates join this request's pool and appear in the Invite tab once you invite and they accept. Excluded and already-surfaced candidates are skipped by the next search.
                  </p>
                </>
              )}

              {rosterExcluded.length > 0 && (
                <details open={excludedOpen} onToggle={(e) => onExcludedToggle(e.currentTarget.open)} className="border border-gray-200 rounded-lg p-2">
                  <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                    Excluded ({rosterExcluded.length}) — set aside for this request; not re-surfaced by a search. Use Reconsider to return one to the active list.
                  </summary>
                  <div className="space-y-2 mt-2">
                    {rosterExcluded.map((c) => (
                      <CandidateCard key={`exc-${candKey(c)}`} candidate={c} readOnly onPromote={promoteCandidate} />
                    ))}
                  </div>
                </details>
              )}

              {rosterIneligible.length > 0 && (
                <details className="border border-red-200 bg-red-50 rounded-lg p-2">
                  <summary className="text-xs font-medium text-red-800 cursor-pointer">
                    Not eligible ({rosterIneligible.length}) — official institutional evidence reports these people are deceased
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-red-800">
                    {rosterIneligible.map((candidate) => {
                      const evidence = candidate.eligibilityEvidence || candidate.contactEnrichment?.eligibilityEvidence;
                      return (
                        <li key={`ineligible-${candKey(candidate)}`}>
                          <span className="font-medium">{candidate.name}</span>
                          {evidence?.url && (
                            <>
                              {' · '}
                              <a href={evidence.url} target="_blank" rel="noopener noreferrer" className="underline">official source</a>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {rosterBlocked.length > 0 && (
                <details className="border border-amber-200 bg-amber-50 rounded-lg p-2">
                  <summary className="text-xs font-medium text-amber-900 cursor-pointer">
                    Cannot add to Invite ({rosterBlocked.length}) — applicant-excluded for this request
                  </summary>
                  <div className="space-y-2 mt-2">
                    {rosterBlocked.map((candidate) => (
                      <CandidateCard key={`blocked-${candKey(candidate)}`} candidate={candidate} readOnly />
                    ))}
                  </div>
                </details>
              )}

              {unverifiedToShow.length > 0 && (
                <details className="border border-gray-200 rounded-lg p-2">
                  <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                    Unverified suggestions ({unverifiedToShow.length}) — couldn't confirm these in the literature; not selectable until you confirm one
                  </summary>
                  <p className="text-xs text-gray-400 mt-1.5">
                    If you recognize one, use “Confirm identity” to confirm their
                    identity and correct the contact — that adds them to the candidate
                    list. Exclude sets one aside so searches stop suggesting the name.
                  </p>
                  <div className="space-y-2 mt-2">
                    {unverifiedToShow.map((c) => {
                      const canRescue = !c.hasInstitutionCOI
                        && (c.eligibilityStatus || c.contactEnrichment?.eligibilityStatus) !== 'deceased';
                      return <CandidateCard
                        key={`unv-${candKey(c)}`}
                        candidate={c}
                        readOnly
                        onExclude={excludeUnverifiedCandidate}
                        onConfirmIdentity={canRescue ? openIdentityConfirmation : undefined}
                        canManage={canManage}
                      />;
                    })}
                  </div>
                </details>
              )}
            </>
          )}
          {(phase === 'saving' || promotionNotice) && (
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`sticky bottom-3 z-20 flex items-center gap-2 rounded-lg border p-3 text-sm shadow-md ${
                phase === 'saving'
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : promotionNotice?.tone === 'success'
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : promotionNotice?.tone === 'error'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {phase === 'saving' && (
                <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-blue-300 border-t-blue-700 animate-spin" />
              )}
              <div>
                <p>
                  {phase === 'saving'
                    ? `Adding ${savingCount} reviewer${savingCount === 1 ? '' : 's'} to Invite…`
                    : promotionNotice?.message}
                </p>
                {phase === 'saving' && progress.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-blue-700">
                    {progress.map((message, index) => <li key={index}>{message}</li>)}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
