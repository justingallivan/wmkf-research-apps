/**
 * Ownership: view module: renders a candidate card; controller owns state and operation hooks own commands.
 */
import { useState, useEffect, useRef, useId } from 'react';
import { Pencil, RefreshCw, UserCheck, UserX } from 'lucide-react';
import ContactLeads from '../ContactLeads';
import {
  getCandidateEmailReadiness,
  getCandidatePromotionDecision,
  getCandidateReasonPresentation,
} from '../reviewer-search-logic';
import { buildScholarSearchUrl, isRealScholarProfileUrl } from '../../../../lib/utils/scholar-url';
import { buildGoogleSearchUrl } from '../../../../lib/utils/google-search-url';
import { provenanceLabelForCandidate } from '../../../../lib/utils/reviewer-provenance';
import { activeInstitutionStage2Presentation } from '../../../utils/institution-stage2-presentation';
import { STAFF_ADDRESS_CHOICE_REASON } from '../../../../lib/utils/reviewer-address-trust';
import { priorRequestCardSummary } from '../../../utils/reviewer-prior-request-context';
import { Pill } from './SearchPrimitives';
import {
  affiliationEvidenceLabel,
  affiliationSourceLabel,
  dataverseInstitutionSourceLabel,
  emailOwnershipLabel,
  emailSourceDisplayLabel,
} from './presentation';

function InstitutionPresentationNotice({
  candidate,
  presentation,
  onConfirmIdentity,
  onEdit,
  onExclude,
  onRetry,
}) {
  if (!presentation?.visible || !presentation.heading || !presentation.detail) return null;
  const remedies = new Set(Array.isArray(presentation.remedies) ? presentation.remedies : []);
  const canEdit = remedies.has('correct_current_institution')
    || remedies.has('record_joint_appointment');
  const actions = [
    remedies.has('confirm_identity') && onConfirmIdentity
      ? { key: 'confirm', label: 'Confirm identity', icon: UserCheck, run: onConfirmIdentity }
      : null,
    canEdit && onEdit
      ? { key: 'edit', label: 'Edit affiliation', icon: Pencil, run: onEdit }
      : null,
    remedies.has('retry_enrichment') && onRetry
      ? { key: 'retry', label: 'Retry enrichment', icon: RefreshCw, run: onRetry }
      : null,
    remedies.has('not_a_fit') && onExclude
      ? { key: 'exclude', label: 'Not a fit', icon: UserX, run: onExclude }
      : null,
  ].filter(Boolean);
  const tone = presentation.tone === 'warning'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-gray-200 bg-gray-50 text-gray-700';

  return (
    <div className={`mt-2 rounded border p-2 text-xs ${tone}`} data-testid="institution-stage2-presentation">
      <p><span className="font-medium">{presentation.heading}:</span>{' '}{presentation.detail}</p>
      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {actions.map(({ key, label, icon: Icon, run }) => (
            <button
              key={key}
              type="button"
              onClick={() => run(candidate)}
              className="inline-flex items-center gap-1 rounded border border-current/20 bg-white px-2 py-1 font-medium hover:bg-gray-50"
              title={`${label} for ${candidate.name}`}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Ported from the standalone Reviewer Finder: build a Google Scholar author-search
// URL as a fallback when we don't have the candidate's real profile URL. Strips
// honorifics and extracts the institution from a messy affiliation string.
// Rich candidate card — ports the standalone Reviewer Finder's CandidateCard into
// the in-panel Workbench: seniority, COI + evidence-quality warnings, the
// metrics line (publication sample + real h-index/citations), enriched contact
// links, a Scholar link, and a publications expander. `readOnly` renders the card
// without a checkbox for the non-selectable Unverified section. `onExclude` adds
// a set-aside action (active cards); `onPromote` adds a restore action (the
// collapsed Excluded section).
export function CandidateCard({ candidate, checked, onToggle, readOnly = false, previousResult = false, onExclude, onPromote, onAddToInvite, addingToInvite = false, onUseLead, onEdit, onConfirmIdentity, onRequestRepair, onReviewAddressConflict, onRetryAddressCheck, onRetryInstitution, canManage = true, repairAttention = false, repairRequest = null, repairRequestsUnavailable = false, onRetryRepairStatus }) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef(null);
  // Identity-unverified rows only: the retrieved-but-unconfirmed evidence panel.
  // Collapsed by default so a list of these stays scannable.
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidencePanelId = `${useId()}-identity-evidence`;
  const selectId = `${useId()}-select`;
  useEffect(() => {
    if (repairAttention && typeof cardRef.current?.scrollIntoView === 'function') {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [repairAttention]);
  const c = candidate;
  const confidence = typeof c.verificationConfidence === 'number' ? c.verificationConfidence : undefined;
  const isLowConfidence = confidence !== undefined && confidence < 0.35;
  const isWeakMatch = confidence !== undefined && confidence >= 0.35 && confidence < 0.65;
  const hasInstitutionMismatch = !!c.institutionMismatch;
  const institutionPresentation = activeInstitutionStage2Presentation(c);
  const hasExpertiseMismatch = !!c.expertiseMismatch;
  const hasInstitutionCOI = !!c.hasInstitutionCOI;
  const institutionCOIDecision = c.institutionCOIDetails?.dropDecision || null;
  const isFlaggedInstitutionCOI = hasInstitutionCOI && institutionCOIDecision === 'flagged';
  const hasCoauthorCOI = !!c.hasCoauthorCOI;
  // S238 graded coauthor COI: 'likely' (strong tie) reads as a real conflict (red);
  // 'possible' (1..threshold-1 shared papers) may be incidental and reads softer (amber).
  // Fallback for any pre-S238 candidate lacking the strength field: treat as 'likely'.
  const coauthorStrength = c.coauthorCOIStrength || (hasCoauthorCOI ? 'likely' : null);
  const hasStrongCoauthorCOI = coauthorStrength === 'likely';
  const hasPossibleCoauthorCOI = coauthorStrength === 'possible';
  // Only a strong (likely) coauthor tie or corroborated institution COI drives
  // the red treatment. Phase-C flagged institution COI is still read-only and
  // save-rejected, but shown amber because independent current evidence
  // contradicts the low-trust match that triggered it.
  const hasAnyCOI = (hasInstitutionCOI && !isFlaggedInstitutionCOI) || hasStrongCoauthorCOI;
  const reasonPresentation = getCandidateReasonPresentation(c);
  const provenanceLabel = provenanceLabelForCandidate(c);
  const pubs = Array.isArray(c.publications) ? c.publications : [];
  // Distinguish "0 publications" (a resolved profile with genuinely no recent
  // works) from "no bibliometric data" (the OpenAlex author never resolved —
  // e.g. an applicant-named person whose typed name doesn't match their
  // publishing name). For the latter, publicationCount5yr is null and there are
  // no pubs, so show "publication count unavailable" rather than a misleading 0.
  const hasPubCount = Number.isFinite(c.publicationCount5yr) || pubs.length > 0;
  const pubCount = Number.isFinite(c.publicationCount5yr) ? c.publicationCount5yr : pubs.length;
  // Track-B candidate surfaced below the minimum-publication bar (S238) — a warning,
  // not a drop: the count can be undercounted when dedup collapses a preprint + its
  // published version of the same work.
  const lowPublicationCount = !!c.lowPublicationCount;
  const lowPublicationFound = Number.isFinite(c.lowPublicationCountFound) ? c.lowPublicationCountFound : pubs.length;
  // AI-flagged-off-topic (S238) — surfaced + sorted last, not dropped; the reasoning
  // pass judged this retrieved candidate possibly off-topic. A warning, never a gate.
  const aiFlaggedNotRelevant = !!c.aiFlaggedNotRelevant;
  const enr = c.contactEnrichment || {};
  const knownReviewer = c.applicantKnownReviewer || null;
  const manualEmail = Array.isArray(c.manualContactFields) && c.manualContactFields.includes('email');
  const email = manualEmail
    ? (c.email || enr.email || null)
    : (knownReviewer?.email || c.email || enr.email || null);
  const emailSource = manualEmail
    ? (c.emailSource || enr.emailSource || null)
    : (knownReviewer?.emailSource || c.emailSource || enr.emailSource || null);
  const emailReadiness = getCandidateEmailReadiness(c);
  // The shared readiness projection includes the current address-trust receipt.
  // Do not let an older enrichment-time emailAction override a later staff
  // attestation; that made a successfully verified roster card still render as
  // "Email needs confirmation" until another enrichment run.
  const emailAction = email ? emailReadiness.action : 'missing';
  const emailActionReason = emailReadiness.reason;
  const emailEvidence = enr.emailEvidence || null;
  const evidencePublications = Array.isArray(emailEvidence?.publications)
    ? emailEvidence.publications.filter((publication) => publication?.url).slice(0, 3)
    : [];
  const ownershipLabel = emailOwnershipLabel(emailEvidence);
  const alternativeAddressCount = Array.isArray(emailEvidence?.alternatives)
    ? emailEvidence.alternatives.length
    : 0;
  const website = c.website || enr.website || null;
  const orcidUrl = c.orcidUrl || enr.orcidUrl || null;
  const scholarUrl = c.googleScholarUrl || enr.googleScholarUrl || buildScholarSearchUrl(c.name, c.affiliation);
  // "Profile" only when the URL is a real Scholar author page, not a search URL
  // (enrichment stores a search URL in googleScholarUrl by default).
  const hasRealScholar = isRealScholarProfileUrl(c.googleScholarUrl || enr.googleScholarUrl);
  const hIndex = c.hIndex ?? enr.hIndex ?? null;
  const citations = c.totalCitations ?? enr.totalCitations ?? null;
  const coauthorships = Array.isArray(c.coauthorships) ? c.coauthorships : [];
  const eligibilityStatus = c.eligibilityStatus || enr.eligibilityStatus || 'unknown';
  const eligibilityEvidence = c.eligibilityEvidence || enr.eligibilityEvidence || null;
  const dataverseEvidence = enr.dataverseContactEvidence || null;
  const priorRequestSummary = priorRequestCardSummary(dataverseEvidence?.priorRequestContext);
  const dataverseInstitutions = Array.isArray(dataverseEvidence?.institutions)
    ? dataverseEvidence.institutions.filter((entry) => entry?.value && dataverseInstitutionSourceLabel(entry.source))
    : [];
  const promotionDecision = getCandidatePromotionDecision(c);
  const needsIdentityConfirmation = promotionDecision?.decision === 'needs_identity_confirmation';
  const needsRecordRepair = promotionDecision?.decision === 'needs_record_repair';
  // A pending stored/found conflict remains directly actionable even when the
  // candidate also needs identity confirmation. In that combined state the
  // address action opens the confirm-mode dialog, which requires both an exact
  // email choice and the explicit right-person checkbox before any write.
  const needsAddressVerification = c.addressConflictPending === true
    || (!needsIdentityConfirmation && emailReadiness.action !== 'ready');
  const needsCombinedReview = needsIdentityConfirmation && c.addressConflictPending === true;

  // Unresolved identity never enters Invite. Suppress contact/bibliometrics that
  // could belong to a namesake while keeping the row actionable in Find.
  const identityUnverified = needsIdentityConfirmation
    && promotionDecision?.reason === 'identity_not_resolved';

  const expertiseTerms = Array.isArray(c.expertiseAreas)
    ? c.expertiseAreas.filter(Boolean).slice(0, 2)
    : [];
  const expertiseSampleCount = pubs.length;
  const expertiseStatus = hasExpertiseMismatch || isLowConfidence
    ? {
        tone: 'amber',
        label: 'Expertise not confirmed',
        detail: expertiseSampleCount > 0
          ? `0 of ${expertiseSampleCount} retrieved paper${expertiseSampleCount === 1 ? '' : 's'} matched the stated expertise.`
          : 'No retrieved papers confirmed the stated expertise.',
      }
    : isWeakMatch || aiFlaggedNotRelevant
      ? {
          tone: 'amber',
          label: 'Expertise needs review',
          detail: expertiseSampleCount > 0
            ? `The ${expertiseSampleCount} retrieved paper${expertiseSampleCount === 1 ? '' : 's'} provided limited support for the stated expertise.`
            : 'The retrieved evidence did not provide enough support for the stated expertise.',
        }
      : confidence === undefined
        ? {
            tone: 'neutral',
            label: 'Expertise evidence',
            detail: expertiseSampleCount > 0
              ? `${expertiseSampleCount} retrieved paper${expertiseSampleCount === 1 ? ' was' : 's were'} available for review.`
              : 'No literature-based expertise assessment is available.',
          }
        : {
          tone: 'neutral',
          label: 'Expertise supported',
          detail: expertiseSampleCount > 0
            ? `Supported by the ${expertiseSampleCount} retrieved paper${expertiseSampleCount === 1 ? '' : 's'} reviewed.`
            : 'No expertise warning was raised by the literature check.',
        };
  const identityEvidence = emailAction === 'ready'
    ? [
        'high-confidence email',
        orcidUrl ? 'ORCID' : null,
        (knownReviewer?.status === 'known' || dataverseEvidence?.status === 'known')
          ? 'existing Dataverse record'
          : null,
      ].filter(Boolean)
    : [];
  const staffVerifiedAddress = emailSource === 'staff_verified'
    || knownReviewer?.addressTrustVerified === true
    || c.addressTrustReceipt?.personConfirmed === true;
  const staffSelectedAddress = emailActionReason === STAFF_ADDRESS_CHOICE_REASON;
  const identityStatus = needsIdentityConfirmation
    ? {
        tone: 'amber',
        label: 'Identity: confirmation required',
        detail: 'Confirm the exact person and contact details before adding this reviewer to Invite.',
      }
    : emailAction === 'ready'
      ? {
        tone: 'green',
        label: 'Identity: verified',
        detail: staffVerifiedAddress
          ? `${email} was ${staffSelectedAddress
            ? 'selected by staff after reviewing the stored and found values'
            : 'verified by staff against recorded evidence'}${knownReviewer?.status === 'known' ? ' and is linked to an existing reviewer record' : ''}.`
          : `Evidence includes ${identityEvidence.join(' + ')}.`,
        }
      : emailAction === 'blocked'
        ? {
            tone: 'red',
            label: 'Identity: address conflict',
            detail: 'The address conflicts with another reviewer record and must be resolved before this reviewer can be added to Invite.',
          }
        : emailAction === 'research_only'
          ? {
              tone: 'amber',
              label: 'Identity: address not verified',
              detail: `${email} was found through ${emailSourceDisplayLabel(emailSource)} but has not been confirmed by first-party evidence, so this reviewer cannot be added to Invite yet.`,
            }
          : emailAction === 'quick_check'
            ? {
                tone: 'amber',
                label: 'Identity: address needs confirmation',
                detail: `The available evidence for ${email} is limited. Verify the exact person and address before adding to Invite.`,
              }
            : {
                tone: 'amber',
                label: 'Identity: verified email required',
                detail: 'No verified email address is available, so this reviewer cannot be added to Invite yet.',
              };

  // Status → remedy routing. Require the exact handler for the candidate's
  // current state so the card never presents a primary action that dead-ends.
  // Routing only — no readiness/trust semantics are decided here.
  const addressConflictHandler = needsIdentityConfirmation
    ? onConfirmIdentity
    : onReviewAddressConflict;
  const canReviewAddressConflict = c.addressConflictPending === true
    && typeof addressConflictHandler === 'function';
  const canEditAddress = c.addressConflictPending !== true
    && !identityUnverified
    && typeof onEdit === 'function';
  const openAddressRemedy = (canManage
    && c.conflictRecordUnavailable !== true
    && (canReviewAddressConflict || canEditAddress))
    ? () => (canReviewAddressConflict ? addressConflictHandler(c) : onEdit(c))
    : null;
  const openIdentityRemedy = (onConfirmIdentity && canManage) ? () => onConfirmIdentity(c) : null;
  const repairEligible = canManage && onRequestRepair
    && c.addressConflictPending !== true
    && (emailReadiness.action === 'blocked' || c.conflictRecordUnavailable);
  const openRepairRemedy = (!repairRequest && !repairRequestsUnavailable && repairEligible)
    ? () => onRequestRepair(c)
    : null;

  const border = checked ? 'border-blue-500 bg-blue-50'
    : hasAnyCOI ? 'border-red-300 bg-red-50'
    : 'border-gray-200 bg-white';

  return (
    <div
      ref={cardRef}
      data-repair-target={repairAttention ? 'true' : undefined}
      className={`border rounded-lg p-3 transition-colors ${border} ${repairAttention ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}
    >
      <div className="flex items-start gap-3">
        {!readOnly && (
          <label htmlFor={selectId} className="mt-0.5 inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-600">
            <input
              id={selectId}
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              aria-label={`Select ${c.name}`}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span>Select</span>
          </label>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
            {c.seniorityEstimate && (
              <Pill
                tone={c.seniorityEstimate === 'Senior' ? 'purple' : c.seniorityEstimate === 'Mid-career' ? 'blue' : 'green'}
                title="Estimated career stage"
              >
                Career stage: {c.seniorityEstimate}
              </Pill>
            )}
          </div>
          {!identityUnverified && c.affiliation && (
            <p className="text-xs text-gray-500 mt-0.5 truncate" title={`Affiliation evidence: ${affiliationSourceLabel(c.affiliationSource || enr.affiliationSource)}${enr.priorAffiliation ? `; previous search value: ${enr.priorAffiliation}` : ''}`}>
              {c.affiliation}
            </p>
          )}

          {!identityUnverified && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
              {hasPubCount && <span>{pubCount} publication{pubCount === 1 ? '' : 's'}</span>}
              {!hasPubCount && <span>Publication count unavailable</span>}
              {hIndex != null && <span>· h-index {hIndex}</span>}
              {citations != null && <span>· {citations.toLocaleString()} citations</span>}
              {previousResult && <span className="text-blue-700">· Found in an earlier search</span>}
            </div>
          )}

          {priorRequestSummary && (
            <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
              <span className="font-medium">Already in AkoyaGO.</span>
              {' '}{priorRequestSummary.replace(/^Already in AkoyaGO\.\s*/, '')}
            </div>
          )}

          {knownReviewer?.status === 'known' && (
            <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
              <span className="font-medium">Existing reviewer record linked.</span>
              {knownReviewer.affiliation ? ` ${knownReviewer.affiliation}.` : ''}
              {' '}Contact readiness is shown under Identity below.
            </div>
          )}
          {knownReviewer && knownReviewer.status !== 'known' && (() => {
            const banner = 'mt-2 p-2 border rounded text-xs bg-amber-50 border-amber-300 text-amber-800';
            const detail = knownReviewer.status === 'inactive'
              ? 'the person record is inactive'
              : knownReviewer.status === 'email_conflict'
                ? 'the stored email is owned by another or ambiguous reviewer record'
                : 'the person record could not be loaded';
            const text = `Existing linked reviewer record needs repair: ${detail}.`;
            if (!openRepairRemedy) return <div className={banner}>{text}</div>;
            return (
              <button
                type="button"
                onClick={openRepairRemedy}
                className={`${banner} block w-full text-left underline underline-offset-2 hover:brightness-95 cursor-pointer`}
                title="Create a durable repair request if neither address can be verified safely"
              >
                {text}
              </button>
            );
          })()}
          {!identityUnverified && dataverseEvidence?.status === 'review_required' && (() => {
            const banner = 'mt-2 p-2 border rounded text-xs bg-amber-50 border-amber-300 text-amber-800';
            const checkedTitle = dataverseEvidence.checkedAt ? `Dataverse checked ${dataverseEvidence.checkedAt}` : undefined;
            if (!openIdentityRemedy) {
              return <div className={banner} title={checkedTitle}>Dataverse identity needs review</div>;
            }
            return (
              <button
                type="button"
                onClick={openIdentityRemedy}
                className={`${banner} block w-full text-left underline underline-offset-2 hover:brightness-95 cursor-pointer`}
                title={`${checkedTitle ? `${checkedTitle}. ` : ''}Confirm this is the right person and correct the contact.`}
              >
                Dataverse identity needs review
              </button>
            );
          })()}

          {hasInstitutionCOI && (
            <div className={`mt-2 p-2 border rounded text-xs ${isFlaggedInstitutionCOI ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-red-50 border-red-300 text-red-800'}`}>
              <span className="font-medium">Institution conflict:</span>{' '}
              {isFlaggedInstitutionCOI
                ? 'Read-only: low-trust institution match contradicted by current-affiliation evidence'
                : 'Same institution as proposal PI'}
              {c.institutionCOIDetails?.reviewerInstitution && <span className="ml-1">({c.institutionCOIDetails.reviewerInstitution})</span>}
            </div>
          )}
          {hasCoauthorCOI && coauthorships.length > 0 && (
            <div className={`mt-2 p-2 rounded text-xs border ${hasStrongCoauthorCOI ? 'bg-red-50 border-red-300 text-red-800' : 'bg-amber-100 border-amber-300 text-amber-800'}`}>
              <span className="font-medium">
                {hasStrongCoauthorCOI
                  ? 'Coauthor conflict:'
                  : 'Possible coauthor overlap:'}
              </span>{' '}
              Co-authored {coauthorships.reduce((s, co) => s + (co.paperCount || 0), 0)} paper(s) with proposal author(s)
              {hasPossibleCoauthorCOI && <span> — may be incidental (e.g. a shared large-collaboration paper); verify</span>}:
              <ul className="mt-1 ml-4 list-disc">
                {coauthorships.map((co, idx) => (
                  <li key={idx}>
                    <strong>{co.proposalAuthor}</strong> ({co.paperCount} paper{co.paperCount > 1 ? 's' : ''})
                    {co.recentPapers?.[0]?.title && (
                      <span className={hasStrongCoauthorCOI ? 'text-red-600' : 'text-amber-700'}> — e.g., “{co.recentPapers[0].title.substring(0, 60)}…”</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {institutionPresentation && (
            <InstitutionPresentationNotice
              candidate={c}
              presentation={institutionPresentation}
              onConfirmIdentity={openIdentityRemedy}
              onEdit={canEditAddress ? () => onEdit(c) : null}
              onExclude={canManage && onExclude ? () => onExclude(c) : null}
              onRetry={canManage && onRetryInstitution ? () => onRetryInstitution(c) : null}
            />
          )}
          {!institutionPresentation && hasInstitutionMismatch && c.suggestedInstitution && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <span className="font-medium">Institution needs review:</span>{' '}
              {c.isApplicantRecommended ? 'The applicant listed' : 'The suggestion listed'} <strong>{c.suggestedInstitution}</strong>,{' '}
              {c.affiliation
                ? <>but linked evidence shows <strong>{c.affiliation.split(',')[0]}</strong>.</>
                : <>but the retrieved publications could not be reconciled with it.</>}
            </div>
          )}

          {!identityUnverified && (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2" role="group" aria-label={`Reviewer evidence status for ${c.name}`}>
              <div className={`rounded border px-2 py-1.5 text-xs ${identityStatus.tone === 'green'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : identityStatus.tone === 'red'
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                <span className="font-medium">
                  <span aria-hidden="true">{identityStatus.tone === 'green' ? '✓ ' : '⚠ '}</span>
                  {identityStatus.label}
                </span>{' '}
                {identityStatus.detail}
              </div>
              <div className={`rounded border px-2 py-1.5 text-xs ${expertiseStatus.tone === 'green'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : expertiseStatus.tone === 'amber'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
                <span className="font-medium">{expertiseStatus.label}: </span>
                {expertiseStatus.detail}
              </div>
            </div>
          )}

          {!identityUnverified && expertiseStatus.tone === 'amber' && expertiseTerms.length > 0 && (
            <p className="mt-1 text-[11px] text-gray-500">
              Suggested for: {expertiseTerms.join(', ')}. Based on retrieved papers, not this person&apos;s full publication record.
            </p>
          )}

          {lowPublicationCount && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <span className="font-medium">Publication activity needs review:</span>{' '}
              only {lowPublicationFound} publication{lowPublicationFound === 1 ? '' : 's'} was retrieved, and the count may be incomplete.
            </div>
          )}

          {identityUnverified && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <span className="font-medium">
                {needsCombinedReview ? 'Review this reviewer before adding them.' : 'Identity confirmation required.'}
              </span>{' '}
              {needsCombinedReview
                ? 'The institution and email found during search differ from the existing AkoyaGO record. Confirm this is the same person and choose which email to use.'
                : openIdentityRemedy
                  ? 'Review the supporting evidence. If it belongs to this person, confirm the identity and contact details. Otherwise choose Not a fit.'
                : 'Review the evidence below. If it does not belong to this person, choose Not a fit. If it does, retry enrichment after the linked reviewer record is repaired.'}
            </div>
          )}
          {reasonPresentation && <p className="text-xs text-gray-700 mt-2"><span className="font-medium">{reasonPresentation.label} </span>{reasonPresentation.text}</p>}

          {c.identityNote && <p className="text-[11px] text-gray-500 mt-2 italic border-t border-gray-100 pt-1.5">{c.identityNote}</p>}

          <div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500">
            {c.isApplicantRecommended && <Pill tone="gray">Applicant recommended</Pill>}
            {eligibilityStatus === 'emeritus' && <Pill tone="amber">Emeritus / retired</Pill>}
          </div>
          {eligibilityStatus === 'emeritus' && eligibilityEvidence?.url && (
            <p className="mt-1 text-[11px] text-amber-700">
              Lower priority because an{' '}
              <a
                href={eligibilityEvidence.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                official institutional source
              </a>{' '}
              identifies this reviewer as emeritus or retired.
            </p>
          )}

          {!identityUnverified && (
            <div className="mt-2 flex items-center flex-wrap gap-2 text-xs">
              {email && emailAction === 'ready' && (
                <>
                  <a
                    href={`mailto:${email}`}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                    title={`Email (from ${emailSource || 'unknown source'}${enr.emailYear ? `, ${enr.emailYear}` : ''})`}
                  >
                    {email}
                  </a>
                </>
              )}
            </div>
          )}

          {/* Slice 3: quarantined contact leads — only when there's no usable
              email (the recovery case) and identity is verified enough to show
              contact. Read-only display; "Use this email" promotion is Slice 4.
              Deduped against the website chip already shown above. NOTE: leads
              live on the live-enriched contactEnrichment; roster-reloaded rows
              drop them until Slice 5 persists a compact form. */}
          {/* Show leads whenever identity is OK and the candidate carries any —
              NOT gated on !email, so promoting one field (e.g. "Use this email")
              doesn't hide the still-unfixed website/faculty-page leads. The
              component self-hides when nothing is left to show, and cleanly
              resolved candidates carry no leads, so this doesn't clutter cards.
              hideValues dedups the email/website already shown as primary chips. */}
          {!identityUnverified && (
            <ContactLeads
              leads={enr.contactLeads}
              hideValues={[email, website]}
              onUse={!readOnly && canManage && onUseLead ? (lead) => onUseLead(candidate, lead) : undefined}
            />
          )}

          {/* Identity-unverified rows suppress the normal contact/bibliometric chips
              above, because those read as verified facts about a specific person and
              this row is not yet resolved to one. Staff still have to decide whether
              this IS the right person, so the same retrieved evidence is offered here
              — collapsed, plain, and explicitly labelled unconfirmed. Deliberately not
              the verified treatment: no mailto, no green ✓ readiness chip, and the
              Scholar link is always a NAME SEARCH, never a stored profile URL (a
              stored profile is exactly the namesake trap). */}
          {identityUnverified && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setEvidenceOpen((v) => !v)}
                aria-expanded={evidenceOpen}
                // Only reference the panel while it exists — the collapsed panel is
                // unmounted, and a dangling aria-controls target confuses screen readers.
                aria-controls={evidenceOpen ? evidencePanelId : undefined}
                className="text-xs text-blue-600 hover:text-blue-800 text-left"
              >
                <span aria-hidden="true">{evidenceOpen ? '▾' : '▸'}</span>{' '}
                <span className="font-medium">
                  {evidenceOpen ? 'Hide supporting evidence' : 'Show supporting evidence'}
                </span>
              </button>
              {evidenceOpen && (
                <div
                  id={evidencePanelId}
                  className="mt-1.5 p-2 rounded border border-gray-200 bg-gray-50 space-y-1.5 text-xs text-gray-700"
                >
                  <p className="text-[11px] text-gray-500">
                    Retrieved for the name “{c.name}”. None of this is confirmed to be the
                    same person as the one named in the proposal — use it to decide, not as
                    a record of who they are.
                  </p>

                  <div>
                    <span className="font-medium">Affiliation: </span>
                    {c.affiliation
                      ? (
                        <>
                          {c.affiliation}
                          {affiliationEvidenceLabel(c.affiliationSource || enr.affiliationSource) && (
                            <span className="text-gray-500">
                              {' '}· {affiliationEvidenceLabel(c.affiliationSource || enr.affiliationSource)}
                            </span>
                          )}
                        </>
                      )
                      : <span className="text-gray-500">none retrieved</span>}
                  </div>

                  {/* Deliberately NOT phrased as "known in Dataverse" (the verified
                      card wording). The match is keyed on the email/ORCID that came
                      out of the SAME search result as the rest of this panel, so it
                      corroborates that the key is on file — not that this is the
                      person the proposal named. Saying otherwise reads as independent
                      identity confirmation when it isn't. */}
                  {dataverseEvidence?.status === 'known' && (
                    <div>
                      <span className="font-medium">Dataverse: </span>
                      the {dataverseEvidence.matchKey || 'key'} above is already on an
                      existing person record — so that {dataverseEvidence.matchKey || 'key'}{' '}
                      is known to us. It does not confirm this is the person the proposal
                      named; it came from the same search result as everything else here.
                    </div>
                  )}
                  {dataverseEvidence?.status === 'review_required' && (
                    <div className="text-amber-700">
                      <span className="font-medium">Dataverse: </span>
                      an existing person record matched but needs review
                    </div>
                  )}
                  {dataverseInstitutions.length > 0 && (
                    <div className={dataverseInstitutions.length > 1 ? 'text-amber-700' : undefined}>
                      <span className="font-medium">
                        {dataverseInstitutions.length > 1
                          ? 'Dataverse institutions (may include co-affiliations or history): '
                          : 'Dataverse institution: '}
                      </span>
                      {dataverseInstitutions.map((entry, index) => (
                        <span key={`${entry.source}:${entry.value}`}>
                          {index > 0 ? '; ' : ''}{entry.value} ({dataverseInstitutionSourceLabel(entry.source)})
                        </span>
                      ))}
                    </div>
                  )}

                  <div>
                    <span className="font-medium">Address on file: </span>
                    {email
                      ? (
                        <>
                          <span className="font-mono break-all">{email}</span>
                          <span className="text-gray-500">
                            {' '}(from {emailSource || 'an unrecorded source'}
                            {enr.emailYear ? `, ${enr.emailYear}` : ''})
                          </span>
                        </>
                      )
                      : <span className="text-gray-500">none retrieved</span>}
                  </div>

                  {/* LOAD-BEARING — this is the identity control, not a detail.
                      Affiliation, address, and the Dataverse match all descend from
                      the same retrieval, so they agree with each other whether or not
                      the right person was retrieved. The papers are the one item a
                      staffer can check against the PROPOSAL, which is evidence the
                      retrieval did not produce. Keep them listed in full and easy to
                      scan; do not truncate, collapse, or drop this list to reduce
                      clutter. */}
                  <div>
                    <span className="font-medium">
                      Recent papers retrieved
                      {pubs.length > 0 && hasPubCount && pubCount > pubs.length
                        ? ` (showing ${pubs.length} of ${pubCount})`
                        : ''}
                      :{' '}
                    </span>
                    {pubs.length === 0
                      ? <span className="text-gray-500">none retrieved</span>
                      : (
                        <span className="text-gray-500">
                          do these match what the proposal is about? This is the check the
                          rest of this panel cannot make.
                        </span>
                      )}
                  </div>
                  {pubs.length > 0 && (
                    <ul className="space-y-0.5">
                      {pubs.map((pub, i) => (
                        <li key={i} className="text-gray-600">
                          • {pub.title}{pub.year ? ` (${pub.year})` : ''}
                          {pub.url && (
                            <a href={pub.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500 hover:text-blue-700">[link]</a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div>
                    <a
                      href={buildScholarSearchUrl(c.name, c.affiliation)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-600 hover:text-purple-800"
                      title="Search Google Scholar by name — results may include other researchers with this name"
                    >
                      Search Google Scholar for this name
                    </a>
                    <span className="text-gray-500"> — results may include other people with this name</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!identityUnverified && (
            <details className="mt-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
              <summary className="cursor-pointer font-medium text-blue-700">Details</summary>
              <div className="mt-2 space-y-1.5">
                <p><span className="font-medium">Source: </span>{provenanceLabel}{previousResult ? ' · found in an earlier search' : ''}</p>
                {c.affiliation && (
                  <p><span className="font-medium">Affiliation evidence: </span>{affiliationSourceLabel(c.affiliationSource || enr.affiliationSource)}</p>
                )}
                {dataverseEvidence?.status === 'known' && (
                  <p title={dataverseEvidence.checkedAt ? `Dataverse checked ${dataverseEvidence.checkedAt}` : undefined}>
                    <span className="font-medium">Dataverse evidence: </span>
                    Existing person record matched by exact {dataverseEvidence.matchKey || 'key'}.
                  </p>
                )}
                {knownReviewer?.status === 'known' && (
                  <p>
                    <span className="font-medium">Dataverse record: </span>
                    Existing reviewer record linked to this applicant recommendation.
                  </p>
                )}
                {dataverseInstitutions.length > 0 && (
                  <p>
                    <span className="font-medium">
                      {dataverseInstitutions.length > 1 ? 'Dataverse institutions: ' : 'Dataverse institution: '}
                    </span>
                    {dataverseInstitutions.map((entry, index) => (
                      <span key={`${entry.source}:${entry.value}`}>
                        {index > 0 ? '; ' : ''}{entry.value} ({dataverseInstitutionSourceLabel(entry.source)})
                      </span>
                    ))}
                    {dataverseInstitutions.length > 1 ? ' · may include co-affiliations or history' : ''}
                  </p>
                )}
                {email && (
                  <p>
                    <span className="font-medium">Email evidence: </span>
                    Address source: {emailSourceDisplayLabel(emailSource)} · {emailAction === 'ready' ? 'verified for Invite' : 'verification required before Invite'}
                    {emailActionReason ? ` · ${emailActionReason}` : ''}
                    {emailEvidence?.publicationCount > 0
                      ? ` · ${emailEvidence.publicationCount} recent ${emailEvidence.publicationCount === 1 ? 'work' : 'works'}`
                      : ''}
                    {evidencePublications.length > 0 && (
                      <>
                        {' ('}
                        {evidencePublications.map((publication, index) => (
                          <span key={publication.url}>
                            {index > 0 ? ', ' : ''}
                            <a
                              href={publication.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-700 hover:underline"
                              title={publication.title || 'Publication evidence'}
                            >
                              {publication.year || index + 1}
                            </a>
                          </span>
                        ))}
                        {')'}
                      </>
                    )}
                  </p>
                )}
                {emailEvidence?.sourceKind === 'institution_page' && emailEvidence?.sourceUrl && (
                  <p>
                    Verified on{' '}
                    <a
                      href={emailEvidence.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 hover:underline"
                      title="Open the institutional page used to verify this address"
                    >
                      official profile
                    </a>
                    {ownershipLabel ? ` · ${ownershipLabel}` : ''}
                    {alternativeAddressCount > 0
                      ? ` · ${alternativeAddressCount} other page ${alternativeAddressCount === 1 ? 'address' : 'addresses'} not selected`
                      : ''}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {website && <a href={website} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">Website</a>}
                  {orcidUrl && <a href={orcidUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">ORCID</a>}
                  <a href={scholarUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline" title={hasRealScholar ? "Open this researcher's Google Scholar profile" : 'Search Google Scholar for this researcher'}>
                    {hasRealScholar ? 'Scholar profile' : 'Scholar search'}
                  </a>
                  {buildGoogleSearchUrl(c.name, c.affiliation) && (
                    <a href={buildGoogleSearchUrl(c.name, c.affiliation)} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
                      Google search
                    </a>
                  )}
                  {openAddressRemedy && !needsAddressVerification && (
                    <button type="button" onClick={openAddressRemedy} className="text-blue-700 hover:underline">Edit contact</button>
                  )}
                </div>
              </div>
            </details>
          )}

          {needsRecordRepair && (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <span className="font-medium">Fix this reviewer record in AkoyaGO, then retry the check.</span>{' '}
              Reviewer record: <code>{c.potentialReviewerId || knownReviewer?.potentialReviewerId || c.name}</code>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {openAddressRemedy && needsAddressVerification && (
              <button
                type="button"
                onClick={openAddressRemedy}
                aria-label={`${needsCombinedReview ? 'Review and confirm' : c.addressConflictPending ? 'Review email choice' : 'Verify address'} for ${c.name}`}
                className={needsCombinedReview
                  ? 'rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800'
                  : 'rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100'}
                title={needsCombinedReview
                  ? 'Confirm the person and choose which email address to use'
                  : 'Review the evidence, correct the address if needed, and verify the exact person and address'}
              >
                {needsCombinedReview ? 'Review and confirm' : c.addressConflictPending ? 'Review email choice' : 'Verify address'}
              </button>
            )}
            {canManage && onRetryAddressCheck && (c.conflictRecordUnavailable === true || needsRecordRepair) && (
              <button
                type="button"
                onClick={() => onRetryAddressCheck(c)}
                aria-label={`${needsRecordRepair ? 'Retry record check' : 'Retry conflict check'} for ${c.name}`}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
              >
                {needsRecordRepair ? 'Retry record check' : 'Retry conflict check'}
              </button>
            )}
            {openRepairRemedy && (
              <button
                type="button"
                onClick={openRepairRemedy}
                aria-label={`Create repair request for ${c.name}`}
                className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                title="Create a durable repair request if neither address can be verified safely"
              >
                Create repair request
              </button>
            )}
            {!repairRequest && repairRequestsUnavailable && repairEligible && (
              <button
                type="button"
                onClick={onRetryRepairStatus}
                disabled={!onRetryRepairStatus}
                aria-label={`Retry repair request status for ${c.name}`}
                className="rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                title="Repair request status could not be checked, so creating another request is temporarily disabled"
              >
                Repair status unavailable · Retry
              </button>
            )}
            {/* Needs-identity-review escape hatch: a PD who recognizes the person can
                confirm identity + correct the contact, which makes the row selectable
                and lets it pass the save gate (bibliometrics still dropped server-side). */}
            {openIdentityRemedy && !needsCombinedReview && (
              <button
                type="button"
                onClick={openIdentityRemedy}
                aria-label={`Confirm identity for ${c.name}`}
                className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
                title="Confirm the exact person and contact details before adding this reviewer to Invite"
              >
                Confirm identity
              </button>
            )}
            {onAddToInvite && (
              <button
                type="button"
                onClick={() => onAddToInvite(c)}
                aria-label={`Add ${c.name} to Invite`}
                disabled={addingToInvite}
                className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addingToInvite ? 'Adding to Invite…' : 'Add to Invite'}
              </button>
            )}
            {!identityUnverified && pubs.length > 0 && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-blue-700 hover:text-blue-900" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'View'} recent papers for ${c.name}`}>
                {expanded ? 'Hide recent papers' : `View ${pubs.length} recent paper${pubs.length === 1 ? '' : 's'}`}
              </button>
            )}
            {onExclude && (
              <button
                type="button"
                onClick={() => onExclude(c)}
                aria-label={`Not a fit: ${c.name}`}
                className="ml-auto text-xs text-gray-500 hover:text-red-700"
                title="Set aside — moves to the Excluded list and won't be surfaced again by a search for this request (recoverable)"
              >
                Not a fit
              </button>
            )}
            {onPromote && (
              <button
                type="button"
                onClick={() => onPromote(c)}
                aria-label={`Reconsider ${c.name}`}
                className="text-xs text-blue-600 hover:text-blue-800 ml-auto"
                title="Return to the active candidate list"
              >
                Reconsider
              </button>
            )}
          </div>

          {expanded && pubs.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {pubs.map((pub, i) => (
                <li key={i} className="text-xs text-gray-600">
                  • {pub.title}{pub.year ? ` (${pub.year})` : ''}
                  {pub.url && (
                    <a href={pub.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-500 hover:text-blue-700">[link]</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

