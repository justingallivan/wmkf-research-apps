import { useMemo } from 'react';
import { reviewerEngagementProjection } from '../../../utils/reviewer-engagement';
import { partitionRediscoveredCandidates } from '../../../utils/reviewer-rediscovery';
import { isCandidateSelectable } from '../reviewer-search-logic';
import { provenanceGroupOf, withReviewerProvenance } from '../../../../lib/utils/reviewer-provenance';
import { candKey, dedupeByName, isApplicantOriginCandidate } from './candidateKeys';

export default function useReviewerSearchProjection({
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
}) {
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

  return {
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
  };
}
