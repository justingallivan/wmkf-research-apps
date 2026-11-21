/**
 * Ownership: view module: renders a candidate card; controller owns state and operation hooks own commands.
 */
import { useState, useEffect, useRef, useId } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import ContactLeads from '../ContactLeads';
import { Button } from '../../Layout';
import {
  getCandidateCardStatus,
  getCandidateEmailReadiness,
  getCandidatePromotionDecision,
  getCandidateReasonPresentation,
} from '../reviewer-search-logic';
import { buildScholarSearchUrl, isRealScholarProfileUrl } from '../../../../lib/utils/scholar-url';
import { buildGoogleSearchUrl } from '../../../../lib/utils/google-search-url';
import { provenanceLabelForCandidate } from '../../../../lib/utils/reviewer-provenance';
import { activeInstitutionStage2Presentation } from '../../../utils/institution-stage2-presentation';
import { priorRequestCardSummary } from '../../../utils/reviewer-prior-request-context';
import {
  affiliationEvidenceLabel,
  dataverseInstitutionSourceLabel,
  emailOwnershipLabel,
  emailSourceDisplayLabel,
} from './presentation';

const CHIP_TONES = {
  green: 'border-green-200 bg-green-50 text-green-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-red-200 bg-red-50 text-red-700',
  gray: 'border-gray-200 bg-gray-100 text-gray-700',
};

const MATCH_TONES = {
  ok: { className: 'text-gray-900', Icon: CheckCircle2, iconClass: 'text-green-600' },
  neutral: { className: 'text-gray-900', Icon: Info, iconClass: 'text-gray-500' },
  warn: { className: 'font-medium text-amber-800', Icon: AlertTriangle, iconClass: 'text-amber-600' },
  bad: { className: 'font-medium text-red-700', Icon: XCircle, iconClass: 'text-red-600' },
};

function sameValue(a, b) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  return !left || !right || left === right;
}

function PaperList({ pubs }) {
  return (
    <ul className="mt-1 space-y-0.5 pl-4 list-disc marker:text-gray-400">
      {pubs.map((pub, i) => (
        <li key={i} className="text-gray-700">
          {pub.title}{pub.year ? ` (${pub.year})` : ''}
          {pub.url && (
            <a href={pub.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-700 underline underline-offset-2 hover:text-blue-900">
              link
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

// Find-tab candidate card. Anatomy (DESIGN.md Section Order + Status-Once):
// header with one status chip → one match line → Compare details disclosure →
// blocking line (only for an issue the status does not already state) →
// action row with at most one ink primary. The status is computed by
// getCandidateCardStatus from the existing promotion/readiness helpers; this
// view never decides selectability. `readOnly` renders without the Select
// checkbox; `onExclude` adds Not a fit; `onPromote` adds Reconsider (the
// collapsed Excluded section).
export function CandidateCard({ candidate, checked, onToggle, readOnly = false, previousResult = false, onExclude, onPromote, onAddToInvite, addingToInvite = false, onUseLead, onEdit, onConfirmIdentity, onRequestRepair, onReviewAddressConflict, onRetryAddressCheck, onRetryInstitution, canManage = true, repairAttention = false, repairRequest = null, repairRequestsUnavailable = false, onRetryRepairStatus }) {
  const cardRef = useRef(null);
  const baseId = useId();
  const selectId = `${baseId}-select`;
  const titleId = `${baseId}-name`;
  useEffect(() => {
    if (repairAttention && typeof cardRef.current?.scrollIntoView === 'function') {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [repairAttention]);

  const c = candidate;
  const status = getCandidateCardStatus(c);
  const institutionPresentation = activeInstitutionStage2Presentation(c);
  const reasonPresentation = getCandidateReasonPresentation(c);
  const provenanceLabel = provenanceLabelForCandidate(c);
  const pubs = Array.isArray(c.publications) ? c.publications : [];
  // "0 publications" (resolved profile, no recent works) differs from "no
  // bibliometric data" (author never resolved: publicationCount5yr is null).
  const hasPubCount = Number.isFinite(c.publicationCount5yr) || pubs.length > 0;
  const pubCount = Number.isFinite(c.publicationCount5yr) ? c.publicationCount5yr : pubs.length;
  const lowPublicationCount = !!c.lowPublicationCount;
  const lowPublicationFound = Number.isFinite(c.lowPublicationCountFound) ? c.lowPublicationCountFound : pubs.length;
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
  const emailAction = email ? emailReadiness.action : 'missing';
  const emailEvidence = enr.emailEvidence || null;
  const evidencePublications = Array.isArray(emailEvidence?.publications)
    ? emailEvidence.publications.filter((publication) => publication?.url).slice(0, 3)
    : [];
  const ownershipLabel = emailOwnershipLabel(emailEvidence);
  const alternativeAddressCount = Array.isArray(emailEvidence?.alternatives) ? emailEvidence.alternatives.length : 0;
  const website = c.website || enr.website || null;
  const orcidUrl = c.orcidUrl || enr.orcidUrl || null;
  const scholarUrl = c.googleScholarUrl || enr.googleScholarUrl || buildScholarSearchUrl(c.name, c.affiliation);
  const hasRealScholar = isRealScholarProfileUrl(c.googleScholarUrl || enr.googleScholarUrl);
  const googleUrl = buildGoogleSearchUrl(c.name, c.affiliation);
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
  const needsCombinedReview = needsIdentityConfirmation && c.addressConflictPending === true;

  // Unresolved identity never enters Invite. Contact details, metrics and the
  // stored Scholar profile could belong to a namesake, so they stay hidden;
  // the retrieved evidence is offered inside Compare details, labelled
  // unconfirmed, with the Scholar link as a name search only.
  const identityUnverified = needsIdentityConfirmation
    && promotionDecision?.reason === 'identity_not_resolved';

  // Status → remedy routing. A handler is required for every action shown.
  const addressConflictHandler = needsIdentityConfirmation ? onConfirmIdentity : onReviewAddressConflict;
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
  const retryRecordCheck = canManage && onRetryAddressCheck && (c.conflictRecordUnavailable === true || needsRecordRepair)
    ? () => onRetryAddressCheck(c)
    : null;
  const retryInstitution = canManage && onRetryInstitution ? () => onRetryInstitution(c) : null;
  const institutionRemedies = new Set(Array.isArray(institutionPresentation?.remedies) ? institutionPresentation.remedies : []);
  const editAffiliation = canEditAddress
    && (institutionRemedies.has('correct_current_institution') || institutionRemedies.has('record_joint_appointment'))
    ? () => onEdit(c)
    : null;

  const ACTIONS = {
    add_to_invite: onAddToInvite
      ? { label: addingToInvite ? 'Adding to Invite…' : 'Add to Invite', aria: `Add ${c.name} to Invite`, run: () => onAddToInvite(c), disabled: addingToInvite }
      : null,
    confirm_identity: openIdentityRemedy
      ? { label: 'Confirm identity', aria: `Confirm identity for ${c.name}`, run: openIdentityRemedy, title: 'Confirm the exact person and contact details before adding this reviewer to Invite' }
      : null,
    review_and_confirm: openAddressRemedy
      ? { label: 'Review and confirm', aria: `Review and confirm for ${c.name}`, run: openAddressRemedy, title: 'Confirm the person and choose which email address to use' }
      : null,
    review_email_choice: openAddressRemedy
      ? { label: 'Review email choice', aria: `Review email choice for ${c.name}`, run: openAddressRemedy }
      : null,
    verify_address: openAddressRemedy
      ? { label: 'Verify address', aria: `Verify address for ${c.name}`, run: openAddressRemedy, title: 'Review the evidence, correct the address if needed, and verify the exact person and address' }
      : null,
    retry_record_check: retryRecordCheck
      ? { label: needsRecordRepair ? 'Retry record check' : 'Retry conflict check', aria: `${needsRecordRepair ? 'Retry record check' : 'Retry conflict check'} for ${c.name}`, run: retryRecordCheck }
      : null,
    retry_conflict_check: retryRecordCheck
      ? { label: 'Retry conflict check', aria: `Retry conflict check for ${c.name}`, run: retryRecordCheck }
      : null,
    retry_institution: retryInstitution
      ? { label: 'Retry institution check', aria: `Retry institution check for ${c.name}`, run: retryInstitution }
      : null,
  };
  // When the status's own remedy is unavailable, fall back to the other
  // remedy that resolves the same state (missing email: identity dialog or
  // contact edit; unavailable institution check: confirm instead).
  const FALLBACKS = {
    confirm_identity: ['verify_address'],
    retry_institution: ['confirm_identity'],
  };
  const primaryKey = status.primary
    ? [status.primary, ...(FALLBACKS[status.primary] || [])].find((key) => ACTIONS[key])
    : null;
  const primary = primaryKey ? ACTIONS[primaryKey] : null;

  const secondary = [];
  const pushSecondary = (key, action) => {
    if (action && key !== primaryKey && !secondary.some((item) => item.key === key)) secondary.push({ key, ...action });
  };
  if (needsIdentityConfirmation && !needsCombinedReview) pushSecondary('confirm_identity', ACTIONS.confirm_identity);
  if (needsCombinedReview) pushSecondary('review_and_confirm', ACTIONS.review_and_confirm);
  // A partly matching AkoyaGO record is resolved through the identity dialog.
  if (dataverseEvidence?.status === 'review_required' && !needsCombinedReview && !identityUnverified) {
    pushSecondary('confirm_identity', ACTIONS.confirm_identity);
  }
  if (status.key === 'check_email' || (!needsIdentityConfirmation && c.addressConflictPending === true)) {
    pushSecondary(c.addressConflictPending ? 'review_email_choice' : 'verify_address', c.addressConflictPending ? ACTIONS.review_email_choice : ACTIONS.verify_address);
  }
  if (retryRecordCheck) pushSecondary(needsRecordRepair ? 'retry_record_check' : 'retry_conflict_check', needsRecordRepair ? ACTIONS.retry_record_check : ACTIONS.retry_conflict_check);
  if (institutionRemedies.has('retry_enrichment')) pushSecondary('retry_institution', ACTIONS.retry_institution);
  if (editAffiliation) pushSecondary('edit_affiliation', { label: 'Edit affiliation', aria: `Edit affiliation for ${c.name}`, run: editAffiliation });
  if (openRepairRemedy) {
    pushSecondary('create_repair', { label: 'Create repair request', aria: `Create repair request for ${c.name}`, run: openRepairRemedy, title: 'Create a durable repair request if neither address can be verified safely' });
  }
  const repairStatusUnavailable = !repairRequest && repairRequestsUnavailable && repairEligible;
  // Edit contact sits in Compare details when no status action already opens it.
  const editContact = openAddressRemedy
    && !['review_and_confirm', 'review_email_choice', 'verify_address'].some((key) => key === primaryKey || secondary.some((item) => item.key === key))
    ? openAddressRemedy
    : null;

  // Header institution. For an unresolved identity, the retrieved affiliation
  // may be a namesake's, so show the AkoyaGO record or the suggested value.
  const headerInstitution = identityUnverified
    ? (knownReviewer?.affiliation || c.suggestedInstitution || null)
    : (c.affiliation || knownReviewer?.affiliation || null);
  const sourceLine = c.isApplicantRecommended
    ? 'Recommended by the applicant'
    : (/^Externally-Referred/.test(provenanceLabel || '')
      ? provenanceLabel.replace(/^Externally-Referred(?: · )?/, 'Referred').replace(/^Referred(?=\S)/, 'Referred by ')
      : 'Found by literature search');

  // Compare details: AkoyaGO record vs what the search found. The applicant's
  // own listed details join as a third column once the roster projects them.
  // For an unresolved identity, the AkoyaGO match came from the same search
  // result, so it is not an independent record column; it is listed below.
  const recordInstitutionEntries = knownReviewer?.affiliation
    ? [{ value: knownReviewer.affiliation, source: null }]
    : (identityUnverified ? [] : dataverseInstitutions);
  const recordInstitution = recordInstitutionEntries.length
    ? recordInstitutionEntries.map((entry) => entry.value).join('; ')
    : null;
  const recordEmail = knownReviewer?.email || null;
  const foundInstitution = c.affiliation || null;
  const foundEmail = manualEmail ? (c.email || null) : (enr.email || c.email || null);
  const showRecordColumn = Boolean(recordInstitution || recordEmail);
  const institutionDiffers = showRecordColumn && !sameValue(recordInstitution, foundInstitution);
  const emailDiffers = showRecordColumn && !sameValue(recordEmail, foundEmail);
  const compareDefaultOpen = status.key === 'check_identity'
    || institutionDiffers
    || emailDiffers
    || dataverseEvidence?.status === 'review_required';
  const [compareOpen, setCompareOpen] = useState(compareDefaultOpen);

  // Blocking line: only an issue the status chip does not already name.
  const statusNamesCOI = status.key === 'conflict' || status.key === 'possible_conflict';
  const hasInstitutionCOI = !!c.hasInstitutionCOI;
  const isFlaggedInstitutionCOI = hasInstitutionCOI && c.institutionCOIDetails?.dropDecision === 'flagged';
  const coauthorStrength = c.coauthorCOIStrength || (c.hasCoauthorCOI ? 'likely' : null);
  let blocking = null;
  if (!statusNamesCOI && hasInstitutionCOI) {
    blocking = {
      tone: isFlaggedInstitutionCOI ? 'amber' : 'red',
      text: isFlaggedInstitutionCOI
        ? 'Possible institution conflict: a low-confidence match with the PI that current evidence disagrees with.'
        : `Same institution as the PI${c.institutionCOIDetails?.reviewerInstitution ? ` (${c.institutionCOIDetails.reviewerInstitution})` : ''}.`,
    };
  } else if (!statusNamesCOI && coauthorStrength && coauthorships.length > 0) {
    blocking = {
      tone: coauthorStrength === 'likely' ? 'red' : 'amber',
      text: coauthorStrength === 'likely'
        ? 'Coauthor conflict with a proposal author. Details are under Compare details.'
        : 'Possible coauthor overlap with a proposal author; it may be a large collaboration. Details are under Compare details.',
    };
  } else if (needsRecordRepair) {
    blocking = { tone: 'amber', text: 'Fix this reviewer record in AkoyaGO, then use Retry record check.' };
  } else if (needsIdentityConfirmation && !primary && canManage) {
    blocking = {
      tone: 'amber',
      text: "Confirming isn't available for this reviewer yet. If the evidence isn't theirs, choose Not a fit; otherwise repair the linked AkoyaGO record and retry.",
    };
  } else if (!needsIdentityConfirmation && !institutionPresentation && c.institutionMismatch && c.suggestedInstitution) {
    const found = typeof c.affiliation === 'string' ? c.affiliation.split(',')[0].trim() : '';
    blocking = {
      tone: 'amber',
      text: `${c.isApplicantRecommended ? 'The applicant listed' : 'The suggestion listed'} ${c.suggestedInstitution}, but ${found ? `linked evidence shows ${found}` : "the publications found couldn't be matched to it"}.`,
    };
  }

  // Expertise fit, shown inside Compare details.
  const confidence = typeof c.verificationConfidence === 'number' ? c.verificationConfidence : undefined;
  const isLowConfidence = confidence !== undefined && confidence < 0.35;
  const isWeakMatch = confidence !== undefined && confidence >= 0.35 && confidence < 0.65;
  const expertiseTerms = Array.isArray(c.expertiseAreas) ? c.expertiseAreas.filter(Boolean).slice(0, 2) : [];
  const fitWarning = c.expertiseMismatch || isLowConfidence
    ? (pubs.length > 0
      ? `None of the ${pubs.length} retrieved paper${pubs.length === 1 ? '' : 's'} matched the stated expertise.`
      : 'No retrieved papers confirmed the stated expertise.')
    : (isWeakMatch || c.aiFlaggedNotRelevant)
      ? 'The retrieved papers give limited support for the stated expertise.'
      : null;

  const chipTone = CHIP_TONES[status.tone] || CHIP_TONES.gray;
  const matchTone = MATCH_TONES[status.match.tone] || MATCH_TONES.neutral;
  const MatchIcon = matchTone.Icon;
  const border = checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white';

  return (
    <article
      ref={cardRef}
      aria-labelledby={titleId}
      data-repair-target={repairAttention ? 'true' : undefined}
      data-card-status={status.key}
      className={`rounded-xl border px-5 py-4 shadow-sm transition-colors ${border} ${repairAttention ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}
    >
      <div className="flex items-start gap-3">
        {!readOnly && (
          <label htmlFor={selectId} className="mt-1 inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-600">
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
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h4 id={titleId} className="text-base font-semibold text-gray-900">{c.name}</h4>
              {headerInstitution && <p className="truncate text-sm text-gray-500">{headerInstitution}</p>}
              <p className="mt-0.5 text-[13px] text-gray-700">
                {sourceLine}
                {previousResult && <span className="text-gray-500"> · Found in an earlier search</span>}
                {priorRequestSummary && <span className="text-gray-500"> · {priorRequestSummary}</span>}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {eligibilityStatus === 'emeritus' && (
                <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">Emeritus / retired</span>
              )}
              {c.seniorityEstimate && !identityUnverified && (
                <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600" title="Estimated career stage">
                  {c.seniorityEstimate}
                </span>
              )}
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chipTone}`} data-testid="candidate-status-chip">
                {status.label}
              </span>
            </div>
          </div>

          <p className={`mt-3 flex items-start gap-1.5 text-sm ${matchTone.className}`} data-testid="candidate-match-line">
            <MatchIcon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${matchTone.iconClass}`} />
            <span>{status.match.text}</span>
          </p>

          <details
            className="mt-2.5"
            open={compareOpen}
            onToggle={(event) => setCompareOpen(event.currentTarget.open)}
            data-testid="candidate-compare-details"
          >
            <summary className="w-max cursor-pointer text-[13px] font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900">
              Compare details
            </summary>
            <div className="mt-2 space-y-3 text-[13px] text-gray-700">
              {identityUnverified && (
                <p className="text-gray-500">
                  Found for the name “{c.name}”. None of this is confirmed to be the person the proposal named;
                  use it to decide, not as a record of who they are.
                </p>
              )}
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="text-gray-500">
                    <th scope="col" className="w-28 py-1.5 pr-2 font-medium"><span className="sr-only">Detail</span></th>
                    {showRecordColumn && <th scope="col" className="py-1.5 pr-2 font-medium">AkoyaGO record</th>}
                    <th scope="col" className="py-1.5 pr-2 font-medium">{identityUnverified ? 'Found for this name' : 'Found by search'}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-gray-200 align-top">
                    <th scope="row" className="py-1.5 pr-2 font-medium text-gray-500">Institution</th>
                    {showRecordColumn && (
                      <td className={`py-1.5 pr-2 ${institutionDiffers ? 'bg-amber-50 font-medium text-amber-800' : ''}`}>
                        {recordInstitutionEntries.length > 0
                          ? recordInstitutionEntries.map((entry, index) => (
                            <span key={`${entry.source || 'record'}:${entry.value}`}>
                              {index > 0 ? '; ' : ''}{entry.value}
                              {entry.source && <span className="font-normal text-gray-500"> ({dataverseInstitutionSourceLabel(entry.source)})</span>}
                            </span>
                          ))
                          : <span className="text-gray-500">None on record</span>}
                        {recordInstitutionEntries.length > 1 && (
                          <span className="block font-normal text-gray-500">May include joint appointments or history.</span>
                        )}
                      </td>
                    )}
                    <td className={`py-1.5 pr-2 ${institutionDiffers ? 'bg-amber-50 font-medium text-amber-800' : ''}`}>
                      {foundInstitution || <span className="text-gray-500">None found</span>}
                      {foundInstitution && affiliationEvidenceLabel(c.affiliationSource || enr.affiliationSource) && (
                        <span className="font-normal text-gray-500"> · {affiliationEvidenceLabel(c.affiliationSource || enr.affiliationSource)}</span>
                      )}
                    </td>
                  </tr>
                  <tr className="border-t border-gray-200 align-top">
                    <th scope="row" className="py-1.5 pr-2 font-medium text-gray-500">Email</th>
                    {showRecordColumn && (
                      <td className={`break-all py-1.5 pr-2 ${emailDiffers ? 'bg-amber-50 font-medium text-amber-800' : ''}`}>
                        {recordEmail ? <span>{recordEmail}</span> : <span className="text-gray-500">None on record</span>}
                        {recordEmail && emailSource && sameValue(recordEmail, email) && (
                          <span className="font-normal text-gray-500"> · {emailSourceDisplayLabel(emailSource)}</span>
                        )}
                      </td>
                    )}
                    <td className={`break-all py-1.5 pr-2 ${emailDiffers ? 'bg-amber-50 font-medium text-amber-800' : ''}`}>
                      {foundEmail ? <span>{foundEmail}</span> : <span className="text-gray-500">None found</span>}
                      {foundEmail && emailSource && sameValue(foundEmail, email) && !(recordEmail && sameValue(recordEmail, email)) && (
                        <span className="font-normal text-gray-500"> · {emailSourceDisplayLabel(emailSource)}{enr.emailYear ? `, ${enr.emailYear}` : ''}</span>
                      )}
                    </td>
                  </tr>
                  {expertiseTerms.length > 0 && (
                    <tr className="border-t border-gray-200 align-top">
                      <th scope="row" className="py-1.5 pr-2 font-medium text-gray-500">Field</th>
                      {showRecordColumn && <td className="py-1.5 pr-2 text-gray-500">Not recorded</td>}
                      <td className="py-1.5 pr-2">{expertiseTerms.join(', ')}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {institutionPresentation?.heading && institutionPresentation?.detail && status.match.text !== institutionPresentation.detail && (
                <p data-testid="institution-stage2-presentation">
                  <span className="font-medium">{institutionPresentation.heading}:</span> {institutionPresentation.detail}
                </p>
              )}

              {/* Identity-confirmation evidence (AkoyaGO match). For an
                  unresolved identity the match key came from the same search
                  result, so it shows the key is on file, not who this is. */}
              {dataverseEvidence?.status === 'review_required' && (
                <p className="text-amber-800" data-testid="akoyago-review-required">
                  An AkoyaGO person record partly matches this reviewer and needs review before it can be linked.
                </p>
              )}
              {dataverseEvidence?.status === 'known' && (
                <p>
                  {identityUnverified
                    ? `The ${dataverseEvidence.matchKey || 'key'} found for this name is already on an AkoyaGO person record. That does not confirm this is the person the proposal named.`
                    : `An AkoyaGO person record matches this reviewer's ${dataverseEvidence.matchKey || 'details'} exactly.`}
                </p>
              )}
              {identityUnverified && dataverseInstitutions.length > 0 && (
                <p>
                  Institutions on that AkoyaGO record:{' '}
                  {dataverseInstitutions.map((entry, index) => (
                    <span key={`${entry.source}:${entry.value}`}>
                      {index > 0 ? '; ' : ''}{entry.value} ({dataverseInstitutionSourceLabel(entry.source)})
                    </span>
                  ))}.
                  {dataverseInstitutions.length > 1 ? ' These may include joint appointments or history.' : ''}
                </p>
              )}

              {coauthorships.length > 0 && (
                <div>
                  <p className="font-medium text-gray-900">Coauthorship with the proposal authors</p>
                  <ul className="mt-1 space-y-0.5 pl-4 list-disc marker:text-gray-400">
                    {coauthorships.map((co, idx) => (
                      <li key={idx}>
                        {co.proposalAuthor}: {co.paperCount} paper{co.paperCount === 1 ? '' : 's'}
                        {co.recentPapers?.[0]?.title && <span className="text-gray-500">, for example “{co.recentPapers[0].title.substring(0, 80)}”</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* LOAD-BEARING: the papers are the one item a director can check
                  against the PROPOSAL; affiliation, address and the AkoyaGO
                  match all descend from the same retrieval. Keep the list in
                  full and easy to scan; do not truncate it to reduce clutter. */}
              <div>
                <p className="font-medium text-gray-900">
                  {identityUnverified ? 'Recent papers found for this name' : 'Recent papers'}
                  {!identityUnverified && hasPubCount && (
                    <span className="font-normal text-gray-500">
                      {' '}· {pubCount} publication{pubCount === 1 ? '' : 's'}
                      {hIndex != null ? ` · h-index ${hIndex}` : ''}
                      {citations != null ? ` · ${citations.toLocaleString()} citations` : ''}
                    </span>
                  )}
                  {pubs.length > 0 && hasPubCount && pubCount > pubs.length && (
                    <span className="font-normal text-gray-500"> (showing {pubs.length} of {pubCount})</span>
                  )}
                </p>
                {pubs.length === 0
                  ? <p className="text-gray-500">{hasPubCount ? 'None found.' : 'Publication count unavailable.'}</p>
                  : (
                    <>
                      <p className="text-gray-500">Do these match what the proposal is about? This is the check the other details can&apos;t make.</p>
                      <PaperList pubs={pubs} />
                    </>
                  )}
                {lowPublicationCount && (
                  <p className="mt-1 text-amber-800">
                    Only {lowPublicationFound} publication{lowPublicationFound === 1 ? ' was' : 's were'} retrieved, and the count may be incomplete.
                  </p>
                )}
              </div>

              {(fitWarning || reasonPresentation?.kind === 'suggestion') && (
                <div>
                  <p className="font-medium text-gray-900">Fit</p>
                  {fitWarning && <p className="text-amber-800">{fitWarning} Based on retrieved papers, not the full publication record.</p>}
                  {reasonPresentation?.kind === 'suggestion' && <p>{reasonPresentation.text}</p>}
                </div>
              )}

              {!identityUnverified && emailEvidence && (evidencePublications.length > 0 || (emailEvidence.sourceKind === 'institution_page' && emailEvidence.sourceUrl)) && (
                <p>
                  <span className="font-medium text-gray-900">Email evidence: </span>
                  {evidencePublications.length > 0 && (
                    <>
                      listed on {evidencePublications.length === 1 ? 'a paper' : 'papers'} from{' '}
                      {evidencePublications.map((publication, index) => (
                        <span key={publication.url}>
                          {index > 0 ? ', ' : ''}
                          <a href={publication.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2" title={publication.title || 'Publication evidence'}>
                            {publication.year || index + 1}
                          </a>
                        </span>
                      ))}
                    </>
                  )}
                  {emailEvidence.sourceKind === 'institution_page' && emailEvidence.sourceUrl && (
                    <>
                      {evidencePublications.length > 0 ? '; ' : ''}
                      <a href={emailEvidence.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2" title="Open the institutional page used to verify this address">
                        official profile
                      </a>
                      {ownershipLabel ? ` (${ownershipLabel})` : ''}
                      {alternativeAddressCount > 0
                        ? `; ${alternativeAddressCount} other page ${alternativeAddressCount === 1 ? 'address' : 'addresses'} not selected`
                        : ''}
                    </>
                  )}
                </p>
              )}

              {eligibilityStatus === 'emeritus' && eligibilityEvidence?.url && (
                <p>
                  An{' '}
                  <a href={eligibilityEvidence.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2">official institutional source</a>{' '}
                  lists this reviewer as emeritus or retired.
                </p>
              )}

              {c.identityNote && <p className="text-gray-500">{c.identityNote}</p>}

              <p className="text-gray-500">Source: {provenanceLabel}</p>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {identityUnverified ? (
                  <>
                    <a
                      href={buildScholarSearchUrl(c.name, c.affiliation)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 underline underline-offset-2"
                      title="Search Google Scholar by name; results may include other researchers with this name"
                    >
                      Search Google Scholar for this name
                    </a>
                    <span className="text-gray-500">Results may include other people with this name.</span>
                  </>
                ) : (
                  <>
                    {website && <a href={website} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2">Website</a>}
                    {orcidUrl && <a href={orcidUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2">ORCID</a>}
                    <a href={scholarUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2" title={hasRealScholar ? "Open this researcher's Google Scholar profile" : 'Search Google Scholar for this researcher'}>
                      {hasRealScholar ? 'Scholar profile' : 'Scholar search'}
                    </a>
                    {googleUrl && <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2">Google search</a>}
                    {email && emailAction === 'ready' && (
                      <a href={`mailto:${email}`} className="text-blue-700 underline underline-offset-2">Email {email}</a>
                    )}
                    {editContact && (
                      <Button variant="link" type="button" onClick={editContact} className="text-[13px]">Edit contact</Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </details>

          {!identityUnverified && (
            <ContactLeads
              leads={enr.contactLeads}
              hideValues={[email, website]}
              onUse={!readOnly && canManage && onUseLead ? (lead) => onUseLead(candidate, lead) : undefined}
            />
          )}

          {blocking && (
            <p
              className={`mt-3 rounded-lg border px-3 py-2 text-[13px] ${blocking.tone === 'red' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
              data-testid="candidate-blocking-line"
            >
              {blocking.text}
            </p>
          )}

          {(primary || secondary.length > 0 || repairStatusUnavailable || onExclude || onPromote) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              {primary && (
                <Button
                  type="button"
                  size="sm"
                  onClick={primary.run}
                  disabled={primary.disabled}
                  aria-label={primary.aria}
                  title={primary.title}
                >
                  {primary.label}
                </Button>
              )}
              {secondary.map((action) => (
                <Button
                  key={action.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={action.run}
                  disabled={action.disabled}
                  aria-label={action.aria}
                  title={action.title}
                >
                  {action.label}
                </Button>
              ))}
              {repairStatusUnavailable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRetryRepairStatus}
                  disabled={!onRetryRepairStatus}
                  aria-label={`Retry repair request status for ${c.name}`}
                  title="Repair request status could not be checked, so creating another request is temporarily disabled"
                >
                  Repair status unavailable · Retry
                </Button>
              )}
              {onExclude && (
                <Button
                  variant="link"
                  type="button"
                  onClick={() => onExclude(c)}
                  aria-label={`Not a fit: ${c.name}`}
                  title="Set aside: moves to the Excluded list and won't be surfaced again by a search for this request (recoverable)"
                >
                  Not a fit
                </Button>
              )}
              {onPromote && (
                <Button
                  variant="link"
                  type="button"
                  onClick={() => onPromote(c)}
                  aria-label={`Reconsider ${c.name}`}
                  title="Return to the active candidate list"
                >
                  Reconsider
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
