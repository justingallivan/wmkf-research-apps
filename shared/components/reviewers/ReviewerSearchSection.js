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
 * user selects; rich candidate cards with COI / mismatch / confidence warnings;
 * results split by provenance group plus Unverified (the last is read-only).
 * The displayed "expertise match %" is verificationConfidence;
 * the composite relevanceScore drives ordering only — and because /discover ranks
 * BEFORE enrichment, the enriched list is RE-RANKED here (shared scorer in
 * lib/utils/relevance-score.js) so the fetched h-index/citations affect order.
 *
 * Props:
 *   - requestId             : akoya_request GUID (save target)
 *   - blobUrl               : proposal blob URL from load-proposal (required to search)
 *   - proposalKey           : stable SharePoint file key (`library::folder::name`) for applicant-enrichment cache
 *   - cycleCode             : grant cycle code (persisted with saved candidates)
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

import { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { Card } from '../Layout';
import { readSseStream } from './sse';
import ReviewerPromptOverridePanel from './ReviewerPromptOverridePanel';
import ContactLeads from './ContactLeads';
import CandidateEditModal from './CandidateEditModal';
import {
  mergeEnrichment,
  parseExcludeList,
  parseReferredSeeds,
  filterExcluded,
  applicantTerminalSuggestionKeys,
  hasValidApplicantEnrichmentCache,
  isCandidateSelectable,
  getCandidatePromotionDecision,
  candidateWasSaved,
  getCandidateEmailReadiness,
  normalizeReviewerName,
  pruneCandidateForRoster,
  dedupeReviewerCandidates,
  reviewerCandidateKey,
  withReviewerCandidateKey,
} from './reviewer-search-logic';
import { reviewerEngagementProjection } from '../../utils/reviewer-engagement';
import { rankByRelevance } from '../../../lib/utils/relevance-score';
import { buildScholarSearchUrl, isRealScholarProfileUrl } from '../../../lib/utils/scholar-url';
import {
  PROVENANCE_KINDS,
  provenanceGroupOf,
  provenanceKindOf,
  provenanceLabelForCandidate,
  withReviewerProvenance,
} from '../../../lib/utils/reviewer-provenance';
import { DEFAULT_REVIEWER_COUNT } from '../../config/reviewerFinderPreferences';

// The four literature sources the discover endpoint understands. The user picks
// which to query (parity with the standalone Reviewer Finder); at least one must
// stay selected or there's nothing to search.
const SEARCH_SOURCES = [
  { key: 'pubmed', label: 'PubMed', icon: '📚', desc: 'Biomedical' },
  { key: 'arxiv', label: 'ArXiv', icon: '📄', desc: 'Physics, math, CS' },
  { key: 'biorxiv', label: 'BioRxiv', icon: '🧬', desc: 'Life sciences' },
  { key: 'chemrxiv', label: 'ChemRxiv', icon: '🧪', desc: 'Chemistry' },
];

const BLOCKED_REFERRAL_REASON = {
  already_surfaced_or_excluded: 'already surfaced or excluded',
  proposal_author: 'proposal author',
  institution_coi: 'PI institution conflict',
};

export function addressTrustFailureMessage(data, fallback) {
  const base = data?.message || data?.error || fallback;
  const actions = Array.isArray(data?.remediation) ? data.remediation : [];
  const repair = actions.find((item) => item?.action === 'create_repair_request');
  const action = repair || actions[0];
  if (!action?.label
    || base.toLowerCase().includes(action.label.toLowerCase())
    || (action.action === 'create_repair_request' && /repair request/i.test(base))) return base;
  return `${base} If the problem persists, use “${action.label}” on this reviewer card.`;
}

function Spinner() {
  return <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />;
}

function Pill({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    green: 'bg-green-100 text-green-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone] || tones.gray}`}>{children}</span>;
}

// Stable per-row id across roster splices + selection. Identity anchors win;
// the fallback includes affiliation, so two different people with the same
// normalized name cannot share selection or enrichment state.
function candKey(c) {
  return reviewerCandidateKey(c);
}

// Dedupe a candidate list by candidate identity/correlation key; first occurrence wins (so a
// freshly-enriched run candidate beats its pruned roster copy). On a collision it
// grafts referral provenance onto the survivor (S320) so a seeded Externally-Referred
// reviewer that discovery also finds never loses its badge/referrer to relevance order.
function dedupeByName(list) {
  return dedupeReviewerCandidates(list);
}

function isApplicantOriginCandidate(c) {
  return !!c && (c.isApplicantRecommended || provenanceKindOf(c) === PROVENANCE_KINDS.APPLICANT_SUGGESTED);
}

function formatSaveFailureDetails(errors = []) {
  const first = Array.isArray(errors) ? errors.find((e) => e?.error || e?.name) : null;
  if (!first) return '';
  const name = first.name || 'Unknown candidate';
  const error = first.error || 'Save failed';
  return `${name}: ${error}`;
}

// State exactly what each affiliation source can support. PubMed is historical
// publication evidence; OpenAlex exposes a last-known institution, not a current
// employment guarantee. Only ORCID-current / staff-confirmed evidence says current.
function affiliationEvidenceLabel(source) {
  if (source === 'pubmed_recency') return 'publication affiliation';
  if (source === 'orcid_current') return 'current (per ORCID)';
  if (source === 'openalex_current') return 'last known (per OpenAlex)';
  if (source === 'scholar_current') return 'reported by Scholar'; // legacy roster rows
  if (source === 'staff_manual' || source === 'staff_confirmed') return 'staff confirmed';
  return null;
}
function affiliationSourceLabel(source) {
  return affiliationEvidenceLabel(source) || 'unspecified source';
}

function dataverseInstitutionSourceLabel(source) {
  if (source === 'staff_confirmed') return 'staff confirmed';
  if (source === 'primary_affiliation') return 'primary affiliation';
  if (source === 'organization') return 'organization';
  return null;
}

function emailOwnershipLabel(evidence) {
  const labels = {
    full_name: 'full-name mailbox match',
    initials_surname: 'initials + surname mailbox match',
    surname_initials: 'surname + initials mailbox match',
    exact_surname: 'exact-surname mailbox match',
    url_slug: 'mailbox matches the profile URL',
    name_adjacent: 'name and address listed together',
  };
  return labels[evidence?.matchClass] || null;
}

// Ported from the standalone Reviewer Finder: build a Google Scholar author-search
// URL as a fallback when we don't have the candidate's real profile URL. Strips
// honorifics and extracts the institution from a messy affiliation string.
// Rich candidate card — ports the standalone Reviewer Finder's CandidateCard into
// the in-panel Workbench: seniority, COI + mismatch + confidence warnings, the
// metrics line (expertise match % + real h-index/citations), enriched contact
// links, a Scholar link, and a publications expander. `readOnly` renders the card
// without a checkbox for the non-selectable Unverified section. `onExclude` adds
// a set-aside action (active cards); `onPromote` adds a restore action (the
// collapsed Excluded section).
export function CandidateCard({ candidate, checked, onToggle, readOnly = false, previousResult = false, onExclude, onPromote, onUseLead, onEdit, onConfirmIdentity, onRequestRepair, onReviewAddressConflict, onRetryAddressCheck, canManage = true }) {
  const [expanded, setExpanded] = useState(false);
  // Identity-unverified rows only: the retrieved-but-unconfirmed evidence panel.
  // Collapsed by default so a list of these stays scannable.
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidencePanelId = `${useId()}-identity-evidence`;
  const c = candidate;
  const confidence = typeof c.verificationConfidence === 'number' ? c.verificationConfidence : undefined;
  const isLowConfidence = confidence !== undefined && confidence < 0.35;
  const isWeakMatch = confidence !== undefined && confidence >= 0.35 && confidence < 0.65;
  const hasInstitutionMismatch = !!c.institutionMismatch;
  const hasExpertiseMismatch = !!c.expertiseMismatch;
  const hasAnyMismatch = hasInstitutionMismatch || hasExpertiseMismatch;
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
  const reason = c.reasoning || c.generatedReasoning || null;
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
  const dataverseInstitutions = Array.isArray(dataverseEvidence?.institutions)
    ? dataverseEvidence.institutions.filter((entry) => entry?.value && dataverseInstitutionSourceLabel(entry.source))
    : [];
  const promotionDecision = getCandidatePromotionDecision(c);
  const needsIdentityConfirmation = promotionDecision?.decision === 'needs_identity_confirmation';
  const missingVerifiedEmail = promotionDecision?.decision === 'missing_email';
  const needsRecordRepair = promotionDecision?.decision === 'needs_record_repair';
  const needsAddressVerification = !needsIdentityConfirmation && emailReadiness.action !== 'ready';

  // Unresolved identity never enters Invite. Suppress contact/bibliometrics that
  // could belong to a namesake while keeping the row actionable in Find.
  const identityUnverified = needsIdentityConfirmation
    && promotionDecision?.reason === 'identity_not_resolved';

  const border = checked ? 'border-blue-500 bg-blue-50'
    : hasAnyCOI ? 'border-red-300 bg-red-50'
    : hasAnyMismatch ? 'border-orange-300 bg-orange-50'
    : isLowConfidence ? 'border-amber-300 bg-amber-50'
    : isWeakMatch ? 'border-yellow-200 bg-yellow-50'
    : 'border-gray-200';

  return (
    <div className={`border rounded-lg p-3 transition-colors ${border}`}>
      <div className="flex items-start gap-3">
        {!readOnly && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`Select ${c.name}`}
            className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
            {c.seniorityEstimate && (
              <Pill tone={c.seniorityEstimate === 'Senior' ? 'purple' : c.seniorityEstimate === 'Mid-career' ? 'blue' : 'green'}>
                {c.seniorityEstimate}
              </Pill>
            )}
          </div>
          {!identityUnverified && c.affiliation && (
            <p className="text-xs text-gray-500 mt-0.5 truncate" title={`Affiliation evidence: ${affiliationSourceLabel(c.affiliationSource || enr.affiliationSource)}${enr.priorAffiliation ? `; previous search value: ${enr.priorAffiliation}` : ''}`}>
              {c.affiliation}
              {affiliationEvidenceLabel(c.affiliationSource || enr.affiliationSource) && (
                <span className="ml-1 text-gray-400">· {affiliationEvidenceLabel(c.affiliationSource || enr.affiliationSource)}</span>
              )}
            </p>
          )}

          {!identityUnverified && dataverseEvidence?.status === 'known' && (
            <div
              className="mt-2 text-xs text-emerald-700"
              title={dataverseEvidence.checkedAt ? `Dataverse checked ${dataverseEvidence.checkedAt}` : undefined}
            >
              ✓ Known in Dataverse by exact {dataverseEvidence.matchKey || 'key'} (checked during this search)
            </div>
          )}
          {knownReviewer?.status === 'known' && (
            <div className="mt-2 p-2 border rounded text-xs bg-emerald-50 border-emerald-200 text-emerald-800">
              <div className="font-medium">✓ Existing linked reviewer record</div>
              {knownReviewer.affiliation && <div>{knownReviewer.affiliation}</div>}
              {knownReviewer.orcid && <div>ORCID {knownReviewer.orcid}</div>}
              {knownReviewer.email && (
                <div>
                  {knownReviewer.email} · {knownReviewer.emailReadiness?.action || 'quick_check'}
                  {knownReviewer.emailReadiness?.reason ? ` — ${knownReviewer.emailReadiness.reason}` : ''}
                </div>
              )}
              {!knownReviewer.email && <div>No stored email address</div>}
            </div>
          )}
          {knownReviewer && knownReviewer.status !== 'known' && (
            <div className="mt-2 p-2 border rounded text-xs bg-amber-50 border-amber-300 text-amber-800">
              ⚠ Existing linked reviewer record needs repair: {
                knownReviewer.status === 'inactive'
                  ? 'the person record is inactive'
                  : knownReviewer.status === 'email_conflict'
                    ? 'the stored email is owned by another or ambiguous reviewer record'
                    : 'the person record could not be loaded'
              }.
            </div>
          )}
          {!identityUnverified && dataverseEvidence?.status === 'review_required' && (
            <div
              className="mt-2 p-2 border rounded text-xs bg-amber-50 border-amber-300 text-amber-800"
              title={dataverseEvidence.checkedAt ? `Dataverse checked ${dataverseEvidence.checkedAt}` : undefined}
            >
              ⚠ Dataverse identity needs review
            </div>
          )}
          {!identityUnverified && dataverseInstitutions.length > 0 && (
            <div className={`mt-1 text-xs ${dataverseInstitutions.length > 1 ? 'text-amber-700' : 'text-gray-500'}`}>
              {dataverseInstitutions.length > 1
                ? 'Multiple affiliation records (may include co-affiliations or history): '
                : 'Dataverse institution: '}
              {dataverseInstitutions.map((entry, index) => (
                <span key={`${entry.source}:${entry.value}`}>
                  {index > 0 ? '; ' : ''}{entry.value} ({dataverseInstitutionSourceLabel(entry.source)})
                </span>
              ))}
            </div>
          )}

          {hasInstitutionCOI && (
            <div className={`mt-2 p-2 border rounded text-xs ${isFlaggedInstitutionCOI ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-red-50 border-red-300 text-red-800'}`}>
              <span className="font-medium">🏛️ Institution COI:</span>{' '}
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
                  ? `🚨 Coauthor COI:`
                  : `⚠️ Possible coauthor overlap:`}
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
          {isLowConfidence && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ Low match ({Math.round(confidence * 100)}%):</span> Publications don't match Claude's description — could be a different person with the same name.
            </div>
          )}
          {isWeakMatch && !hasAnyMismatch && (
            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-300 rounded text-xs text-yellow-800">
              <span className="font-medium">⚡ Weak match ({Math.round(confidence * 100)}%):</span> Some publications match, but relevance is uncertain — verify expertise manually.
            </div>
          )}
          {hasInstitutionMismatch && c.suggestedInstitution && (
            <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-xs text-orange-800">
              <span className="font-medium">⚠️ Institution mismatch:</span> Claude suggested <strong>{c.suggestedInstitution}</strong>, but PubMed shows <strong>{c.affiliation?.split(',')[0] || 'a different institution'}</strong>.
            </div>
          )}
          {hasExpertiseMismatch && Array.isArray(c.expertiseAreas) && c.expertiseAreas.length > 0 && (
            <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-xs text-orange-800">
              <span className="font-medium">⚠️ Expertise mismatch:</span> Claude claimed “{c.expertiseAreas.slice(0, 2).join(', ')}” but no publications matched these terms.
            </div>
          )}

          {lowPublicationCount && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ Few publications found ({lowPublicationFound}):</span> below the usual minimum — surfaced rather than dropped, since the count can be undercounted (e.g. a preprint and its published version collapsing to one). Verify activity manually.
            </div>
          )}
          {aiFlaggedNotRelevant && (
            <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">⚠️ AI flagged as possibly off-topic:</span> the reasoning pass judged this literature-retrieved author a weak topical match — surfaced (ranked last) rather than dropped. Verify relevance manually.
            </div>
          )}

          {needsIdentityConfirmation && (
            <div className="mt-2 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">Keep in Find — identity/contact confirmation required.</span>{' '}
              Confirm the exact person and email before promoting this reviewer to Invite.
            </div>
          )}
          {missingVerifiedEmail && (
            <div className="mt-2 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-800">
              <span className="font-medium">Keep in Find — verified email missing.</span>{' '}
              Add or verify an email before promoting this reviewer to Invite.
            </div>
          )}

          {reason && <p className="text-xs text-gray-700 mt-2"><span className="font-medium">Why: </span>{reason}</p>}

          {c.identityNote && <p className="text-[11px] text-gray-500 mt-2 italic border-t border-gray-100 pt-1.5">{c.identityNote}</p>}

          <div className="mt-2 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className={hasAnyMismatch ? 'text-orange-500' : isLowConfidence ? 'text-amber-500' : isWeakMatch ? 'text-yellow-600' : 'text-green-500'}>
                {hasAnyMismatch || isLowConfidence ? '⚠' : isWeakMatch ? '⚡' : '✓'}
              </span>
              {hasPubCount ? `${pubCount} publications` : 'publication count unavailable'}
              {confidence !== undefined && <span className="text-gray-400">({Math.round(confidence * 100)}% expertise match)</span>}
            </span>
            {!identityUnverified && hIndex != null && <span>· h-index {hIndex}</span>}
            {!identityUnverified && citations != null && <span>· {citations.toLocaleString()} citations</span>}
            {c.isApplicantRecommended
              ? <Pill tone="green">Applicant recommended</Pill>
              : <Pill tone={provenanceGroupOf(c) === 'needs_identity_review' ? 'amber' : 'gray'}>{provenanceLabel}</Pill>}
            {eligibilityStatus === 'emeritus' && <Pill tone="amber">Emeritus / retired</Pill>}
            {previousResult && <Pill tone="blue">Previously found</Pill>}
            {identityUnverified && (
              <Pill tone="amber">⚠ Identity review required</Pill>
            )}
            {missingVerifiedEmail && (
              <Pill tone="amber">⚠ Verified email required</Pill>
            )}
            {needsAddressVerification && (
              <Pill tone={emailReadiness.action === 'blocked' ? 'red' : 'amber'}>
                {emailReadiness.action === 'blocked' ? '⛔ Address conflict' : '⚠ Address verification required'}
              </Pill>
            )}
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
              {email && (
                <>
                  <a
                    href={`mailto:${email}`}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                    title={`Email (from ${emailSource || 'unknown source'}${enr.emailYear ? `, ${enr.emailYear}` : ''})`}
                  >
                    📧 {email}
                  </a>
                  {emailEvidence?.publicationCount > 0 && (
                    <span className="text-gray-600">
                      Evidence: {emailEvidence.publicationCount} recent {emailEvidence.publicationCount === 1 ? 'work' : 'works'}
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
                    </span>
                  )}
                  {emailEvidence?.sourceKind === 'institution_page' && emailEvidence?.sourceUrl && (
                    <span className="text-gray-600">
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
                    </span>
                  )}
                </>
              )}
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border ${
                  emailAction === 'ready'
                    ? 'bg-green-50 text-green-800 border-green-200'
                    : emailAction === 'blocked'
                      ? 'bg-red-50 text-red-800 border-red-200'
                    : emailAction === 'research_only'
                      ? 'bg-red-50 text-red-800 border-red-200'
                      : emailAction === 'quick_check'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-gray-50 text-gray-600 border-gray-200'
                }`}
                title={emailAction === 'missing'
                  ? emailActionReason
                  : `${emailActionReason}. Confidence reflects address provenance and identity-grounded evidence, not deliverability.`}
              >
                {emailAction === 'ready'
                  ? '✓ High-confidence email'
                  : emailAction === 'blocked'
                    ? '⛔ Address conflict must be resolved'
                  : emailAction === 'research_only'
                    ? '⚠ Research only'
                    : emailAction === 'quick_check'
                      ? '⚠ Email needs confirmation'
                    : 'Email not found'}
              </span>
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100" title="Faculty / personal website">
                  🔗 Website
                </a>
              )}
              {orcidUrl && (
                <a href={orcidUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100" title="ORCID profile">
                  ORCID
                </a>
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
                  {evidenceOpen ? 'Hide evidence' : 'Review evidence before confirming'}
                </span>
                <span className="text-gray-500">
                  {' '}(unconfirmed — may be a different person with this name)
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
                      🎓 Search Google Scholar for this name
                    </a>
                    <span className="text-gray-500"> — results may include other people with this name</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-2 flex items-center gap-3">
            {!identityUnverified && pubs.length > 0 && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs text-blue-600 hover:text-blue-800" aria-expanded={expanded}>
                {expanded ? 'Show less' : `View ${pubs.length} recent paper${pubs.length === 1 ? '' : 's'}`}
              </button>
            )}
            {/* Scholar profile/search link suppressed for selectable-but-unverified rows — it
                would nudge staff toward a possibly-wrong namesake profile (Codex re-review LOW). */}
            {!identityUnverified && (
              <a href={scholarUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1" title={hasRealScholar ? "Open this researcher's Google Scholar profile" : 'Search Google Scholar for this researcher'}>
                🎓 {hasRealScholar ? 'Scholar Profile' : 'Scholar Search'}
              </a>
            )}
            {/* Manual contact edit (manage-only): correct a wrong email/website
                (or affiliation/h-index) by hand. A typed email is stamped manual
                → quick check at invite (per-recipient acknowledgement). */}
            {canManage && (onEdit || onReviewAddressConflict) && !identityUnverified
              && c.conflictRecordUnavailable !== true && (
              <button
                type="button"
                onClick={() => (c.addressConflictPending && onReviewAddressConflict
                  ? onReviewAddressConflict(c)
                  : onEdit?.(c))}
                className="text-xs text-gray-500 hover:text-blue-700 flex items-center gap-1"
                title={needsAddressVerification
                  ? 'Review the evidence, correct the address if needed, and verify the exact person and address'
                  : 'Edit contact details (email/website/affiliation) for this candidate'}
              >
                {c.addressConflictPending ? 'Review address conflict' : (needsAddressVerification ? '✓ Verify / edit address' : '✏️ Edit contact')}
              </button>
            )}
            {canManage && onRetryAddressCheck && c.conflictRecordUnavailable === true && (
              <button
                type="button"
                onClick={() => onRetryAddressCheck(c)}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                ↻ Retry conflict check
              </button>
            )}
            {canManage && onRequestRepair && (emailReadiness.action === 'blocked' || c.conflictRecordUnavailable || needsRecordRepair) && (
              <button
                type="button"
                onClick={() => onRequestRepair(c)}
                className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1"
                title="Create a durable repair request if neither address can be verified safely"
              >
                ⚑ Create repair request
              </button>
            )}
            {/* Needs-identity-review escape hatch: a PD who recognizes the person can
                confirm identity + correct the contact, which makes the row selectable
                and lets it pass the save gate (bibliometrics still dropped server-side). */}
            {onConfirmIdentity && canManage && (
              <button
                type="button"
                onClick={() => onConfirmIdentity(c)}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                title="If you recognize this person, confirm their identity and correct the email/website, then add them to the candidate list"
              >
                ✓ This is the right person → edit &amp; add
              </button>
            )}
            {onExclude && (
              <button
                type="button"
                onClick={() => onExclude(c)}
                className="text-xs text-gray-400 hover:text-red-600 ml-auto"
                title="Set aside — moves to the Excluded list and won't be surfaced again by a search for this request (recoverable)"
              >
                ✕ Exclude
              </button>
            )}
            {onPromote && (
              <button
                type="button"
                onClick={() => onPromote(c)}
                className="text-xs text-blue-600 hover:text-blue-800 ml-auto"
                title="Promote back to the active candidate list"
              >
                ↩ Promote back
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

export default function ReviewerSearchSection({
  requestId,
  blobUrl,
  proposalKey = null,
  cycleCode,
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
  savedPoolNames = [],
  onSaved,
  onNavigate,
  manualAddSlot = null,
  canManage = true,
  rosterSnapshot,
  onRetryRoster,
  displayOnly = false,
}) {
  const parentOwnsRoster = rosterSnapshot !== undefined;
  const [phase, setPhase] = useState('idle'); // idle | running | results | saving | done | error
  const busy = phase === 'running' || phase === 'saving';
  const [progress, setProgress] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [unverified, setUnverified] = useState([]); // Claude suggestions the searched databases couldn't verify (read-only)
  const [analysis, setAnalysis] = useState(null);
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
  const exportingRef = useRef(false);

  // Applicant-recommended enrichment (separate flow from the search).
  const [recPhase, setRecPhase] = useState('idle'); // idle | running | done | error
  const [recCandidates, setRecCandidates] = useState([]);
  const [recHandled, setRecHandled] = useState([]);
  const [recProgress, setRecProgress] = useState([]);
  const [recError, setRecError] = useState(null);
  const recRunningRef = useRef(false);

  // Per-user prompt-override editor toggle (S222).
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Imperative guards: prevent double-submit (Finding 8) and let a context change
  // invalidate an in-flight run so a stale stream can't overwrite newer state
  // (Finding 7).
  const runningRef = useRef(false);
  const savingRef = useRef(null);
  const genRef = useRef(0);
  const excludeEditedRef = useRef(false);

  const applyRosterSnapshot = useCallback((data) => {
    setRosterActive(Array.isArray(data?.active) ? data.active : []);
    setRosterExcluded(Array.isArray(data?.excluded) ? data.excluded : []);
    setRosterIneligible(Array.isArray(data?.ineligible) ? data.ineligible : []);
    setRosterBlocked(Array.isArray(data?.blocked) ? data.blocked : []);
    setRosterHandled(Array.isArray(data?.handled) ? data.handled : []);
    setRosterSavedKeys(Array.isArray(data?.savedKeys) ? data.savedKeys : []);
    setRosterNames(Array.isArray(data?.allNames) ? data.allNames : []);
  }, []);

  const reloadRoster = useCallback(async (expectedGeneration = genRef.current) => {
    // Embedded callers receive every snapshot through the dedicated effect
    // below. Returning here keeps a snapshot change from retriggering this
    // legacy bootstrap effect (and from issuing a duplicate default GET).
    if (parentOwnsRoster) return null;
    if (!requestId) return null;
    const res = await fetch(`/api/workbench/reviewer-roster?requestId=${encodeURIComponent(requestId)}`);
    const data = await res.json().catch(() => ({}));
    if (genRef.current !== expectedGeneration) return null;
    if (!res.ok || !data.success) return null;
    applyRosterSnapshot(data);
    return data;
  }, [requestId, applyRosterSnapshot, parentOwnsRoster]);

  // The parent owns warm cached→reconciled bootstrap for the Workbench panel.
  // Standalone callers retain the original internal roster fetch contract.
  useEffect(() => {
    if (!parentOwnsRoster) return;
    if (rosterSnapshot?.requestId !== requestId) {
      setRosterLoaded(false);
      setRosterLoadFailed(false);
      return;
    }
    if (rosterSnapshot?.data) applyRosterSnapshot(rosterSnapshot.data);
    setRosterLoaded(Boolean(rosterSnapshot?.data) && rosterSnapshot.authorityState !== 'error');
    setRosterLoadFailed(rosterSnapshot?.authorityState === 'error');
    setRosterNote(rosterSnapshot?.error || null);
  }, [requestId, parentOwnsRoster, rosterSnapshot, applyRosterSnapshot]);

  // Reset everything when the request or the loaded proposal changes — stale
  // candidates must never be savable under a different proposal (Finding 6).
  // Also (re)loads the durable per-request roster (genRef-guarded) so the
  // active + excluded sets show even before any fresh search this session.
  useEffect(() => {
    genRef.current += 1; // invalidate any in-flight run
    const myGen = genRef.current;
    setPhase('idle'); setProgress([]); setCandidates([]); setUnverified([]); setAnalysis(null);
    setSelected(new Set()); setError(null); setErrorMeta(null); setPromotionNotice(null); setEnrichNote(null); setExportError(null);
    setExcludedRemoved(0); setRosterNote(null); setRemovingPrevious(false);
    if (!parentOwnsRoster) {
      setRosterActive([]); setRosterExcluded([]); setRosterIneligible([]); setRosterBlocked([]); setRosterHandled([]); setRosterSavedKeys([]); setRosterNames([]); setExcludedOpen(false); setRosterLoaded(false); setRosterLoadFailed(false);
    }
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
    if (requestId && !parentOwnsRoster) {
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
    } else if (!parentOwnsRoster) {
      setRosterLoaded(true); // no request → nothing to load; don't block the form
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, blobUrl, reloadRoster, parentOwnsRoster]);

  const retryRosterLoad = useCallback(async () => {
    if (parentOwnsRoster) {
      onRetryRoster?.();
      return;
    }
    const myGen = genRef.current;
    setRosterLoaded(false);
    setRosterLoadFailed(false);
    setRosterNote(null);
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
  }, [reloadRoster, parentOwnsRoster, onRetryRoster]);

  // When the applicant exclude list finishes loading (it can arrive after the
  // proposal), prefill the box — unless the user has already edited it.
  useEffect(() => {
    if (!excludeEditedRef.current) setExcludeText((excludedNames || []).join(', '));
  }, [excludedNames]);

  const pushProgress = useCallback((m) => {
    if (m) setProgress((p) => [...p.slice(-6), m]);
  }, []);

  const runSearch = useCallback(async () => {
    if (displayOnly || !blobUrl || runningRef.current || removingPrevious || noSourcesSelected || !rosterLoaded) return;
    runningRef.current = true;
    const myGen = genRef.current;
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
    setError(null); setErrorMeta(null); setProgress([]); setCandidates([]); setUnverified([]); setSelected(new Set());
    setPromotionNotice(null); setEnrichNote(null); setAnalysis(null); setExcludedRemoved(0); setExportError(null); setBlockedReferredSeeds([]);
    try {
      // 1. Analyze the proposal (Claude). excludedNames soft-blocks Claude's own
      //    suggestions; we still hard-filter discovery results below.
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
          if (data?.message) pushProgress(data.message);
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
      if (analysisTransportError) pushProgress('Analysis results received; continuing after the connection closed.');
      // Stream ended cleanly but no result frame arrived — almost always a
      // timed-out or dropped connection during the long Claude analysis, not a
      // content problem. Name the likely cause so the user knows to just retry.
      if (!analysisResult) throw new Error("The proposal analysis didn't finish — the connection timed out or dropped before results came back. Please run the search again.");
      if (genRef.current !== myGen) return; // context changed — abort
      setAnalysis(analysisResult);

      // 2. Discover + verify + rank across databases.
      pushProgress('Searching databases for candidates…');
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
      streamError = null;
      let discoveryTransportError = null;
      try {
        await readSseStream(dRes, ({ event, data }) => {
          if (event === 'error') { streamError = data?.message || 'Discovery failed'; return; }
          if (data?.error) { streamError = data.error; return; }
          if (data?.message) pushProgress(data.message);
          if (data?.ranked) ranked = data.ranked;
          if (data?.unverified) unverifiedRaw = data.unverified;
          if (Array.isArray(data?.blockedReferredSeeds)) blockedReferredRaw = data.blockedReferredSeeds;
        });
      } catch (transportError) {
        discoveryTransportError = transportError;
      }
      if (streamError) throw new Error(streamError);
      if (discoveryTransportError && !ranked) {
        throw new Error('The candidate discovery connection was interrupted before results arrived. Please run the search again.');
      }
      if (discoveryTransportError) pushProgress('Candidate results received; continuing after the connection closed.');
      if (!ranked) throw new Error('Discovery returned no candidates.');
      if (genRef.current !== myGen) return; // context changed — abort

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
          pushProgress(`Finding contact info & citation metrics for ${keyedKept.length} reviewer(s)…`);
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
              if (data?.type === 'progress' && data.overall) pushProgress(`Enriching ${data.overall.current}/${data.overall.total}…`);
              if (data?.type === 'complete') enrichmentResults = data.results;
            });
          } catch (transportError) {
            if (!enrichmentResults) throw transportError;
            pushProgress('Contact results received; continuing after the connection closed.');
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
      setRosterIneligible((prev) => dedupeByName([
        ...deceasedCandidates.map(pruneCandidateForRoster),
        ...prev,
      ]));
      setUnverified(unverifiedKept.map((c) => withReviewerProvenance(c)));
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
        try {
          const pruned = dedupedEnriched.map(pruneCandidateForRoster);
          const prunedEligible = pruned.filter((candidate) => candidate.eligibilityStatus !== 'deceased');
          const prunedIneligible = pruned.filter((candidate) => candidate.eligibilityStatus === 'deceased');
          const rRes = await fetch('/api/workbench/reviewer-roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, candidates: pruned }),
          });
          if (genRef.current !== myGen) return; // newer search started — don't touch roster state
          if (rRes.ok) {
            // Merge into the existing active roster (prior runs persist), pruned
            // DTOs deduped by normalized name.
            setRosterActive((prev) => dedupeByName([...prunedEligible, ...prev]));
            setRosterIneligible((prev) => dedupeByName([...prunedIneligible, ...prev]));
            setRosterNames((prev) => Array.from(new Set([...prev, ...dedupedEnriched.map((c) => c.name)])));
            setRosterNote(null);
          } else {
            setRosterNote("Couldn't save this search to the request — these candidates may re-appear on a future search.");
          }
        } catch {
          if (genRef.current === myGen) setRosterNote("Couldn't save this search to the request — these candidates may re-appear on a future search.");
        }
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
      runningRef.current = false;
    }
  }, [blobUrl, requestId, excludeText, rosterNames, savedPoolNames, rosterLoaded, removingPrevious, searchSources, noSourcesSelected, reviewerCount, additionalNotes, referredSeedsText, referredBy, pushProgress, displayOnly]);

  // Run the applicant-recommended reviewers through the full verify→COI→enrich
  // pipeline (server-side) and write the enrichment back to their existing rows.
  // Independent of the search; reuses the search's `analysis` when present so the
  // server can skip a second analyze call.
  const enrichRecommended = useCallback(async () => {
    if (!blobUrl || !proposalKey || recRunningRef.current) return;
    recRunningRef.current = true;
    const myGen = genRef.current;
    setRecPhase('running'); setRecError(null); setRecProgress([]); setRecCandidates([]); setRecHandled([]);
    try {
      if (genRef.current !== myGen) return; // abort if context changed before the request fires
      const res = await fetch('/api/workbench/enrich-recommended', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, blobUrl, proposalKey, analysisResult: analysis || undefined }),
      });
      let result = null;
      let handledResult = [];
      let streamError = null;
      await readSseStream(res, ({ event, data }) => {
        if (event === 'error') { streamError = data?.message || 'Enrichment failed'; return; }
        if (data?.error) { streamError = data.error; return; }
        if (data?.message) setRecProgress((p) => [...p.slice(-6), data.message]);
        if (data?.recommended) result = data.recommended;
        if (Array.isArray(data?.handled)) handledResult = data.handled;
      });
      if (streamError) throw new Error(streamError);
      if (genRef.current !== myGen) return; // context changed — abort
      const recommendedResults = Array.isArray(result) ? result : [];
      setRecHandled(handledResult);
      setRecCandidates(recommendedResults.filter((candidate) => (
        (candidate.eligibilityStatus || candidate.contactEnrichment?.eligibilityStatus) !== 'deceased'
      )));
      setRosterIneligible((prev) => dedupeByName([
        ...recommendedResults
          .filter((candidate) => (
            (candidate.eligibilityStatus || candidate.contactEnrichment?.eligibilityStatus) === 'deceased'
          ))
          .map(pruneCandidateForRoster),
        ...prev,
      ]));
      setRecPhase('done');
    } catch (e) {
      if (genRef.current === myGen) { setRecError(e.message); setRecPhase('error'); }
    } finally {
      recRunningRef.current = false;
    }
  }, [blobUrl, proposalKey, requestId, analysis]);

  // Auto-trigger applicant enrichment once both the proposal (blobUrl) and the
  // ingested recommendations are ready. Runs independently of the Claude search —
  // enrichment uses blobUrl directly for COI if no prior analysis result exists.
  // Defined after enrichRecommended to avoid a temporal dead zone reference error.
  const terminalApplicantKeys = useMemo(
    () => applicantTerminalSuggestionKeys(rosterExcluded, rosterSavedKeys),
    [rosterExcluded, rosterSavedKeys],
  );
  const actionableRecommended = useMemo(
    () => recommended.filter((row) => !reviewerEngagementProjection(row).handled),
    [recommended],
  );
  const haveValidCache = hasValidApplicantEnrichmentCache(
    [...rosterActive, ...rosterIneligible],
    proposalKey,
    actionableRecommended,
    terminalApplicantKeys,
  );
  useEffect(() => {
    const selectableCount = actionableRecommended.length;
    if (recPhase !== 'idle' || recRunningRef.current) return;
    if (rosterLoaded && haveValidCache) {
      setRecPhase('done');
      return;
    }
    if (blobUrl && proposalKey && selectableCount > 0 && rosterLoaded && !haveValidCache) {
      enrichRecommended();
    }
  }, [blobUrl, proposalKey, actionableRecommended, recPhase, rosterLoaded, haveValidCache, enrichRecommended]);

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
  const displayCandidates = dedupeByName([...visibleRecCandidates, ...candidates, ...displayRosterActive].map((c) => withReviewerProvenance(c)));
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
  ]), [recHandled, rosterHandled, recommended]);
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
    [...displayCandidates.map(candKey), ...rosterExcluded.map(candKey), ...rosterIneligible.map(candKey)].filter(Boolean)
  );
  const unverifiedToShow = unverified.filter((c) => !knownNameKeys.has(candKey(c)));

  const toggle = (key) => {
    if (displayOnly) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const allSelected = selectableCandidates.length > 0 && selectableCandidates.every((c) => selected.has(candKey(c)));
  const toggleAll = () => {
    if (!displayOnly) setSelected(allSelected ? new Set() : new Set(selectableCandidates.map(candKey)));
  };

  // Move a surfaced candidate into the durable Excluded set (not deleted). Optimistic:
  // splice it out of the active view immediately, persist in the background, restore on
  // failure. The candidate stays in rosterNames so a re-run still won't re-surface it.
  const excludeCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (displayOnly || !key || !requestId) return;
    const pruned = pruneCandidateForRoster(cand);
    setCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRecCandidates((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterExcluded((prev) => dedupeByName([pruned, ...prev]));
    setRosterNames((prev) => Array.from(new Set([...prev, cand.name])));
    setSelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
    try {
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'exclude', candidate: pruned }),
      });
      if (!res.ok) throw new Error('exclude failed');
    } catch {
      // Roll back the optimistic move so the card isn't silently lost.
      setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
      setRosterActive((prev) => dedupeByName([pruned, ...prev]));
      setRosterNote("Couldn't exclude that reviewer — please try again.");
    }
  }, [requestId, displayOnly]);

  // Promote an excluded candidate back to the active, selectable list.
  const promoteCandidate = useCallback(async (cand) => {
    const key = candKey(cand);
    if (displayOnly || !key || !requestId) return;
    const myGen = genRef.current;
    setRosterExcluded((prev) => prev.filter((c) => candKey(c) !== key));
    setRosterActive((prev) => dedupeByName([cand, ...prev]));
    try {
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action: 'promote', candidateKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (genRef.current !== myGen) return;
      if (res.status === 409 && [
        'candidate_not_excluded',
        'reviewer_already_handled',
        'reviewer_anchor_unavailable',
      ].includes(data.code)) {
        const snapshot = await reloadRoster(myGen);
        if (genRef.current === myGen) {
          const stage = data.stage ? ` (${String(data.stage).replaceAll('_', ' ')})` : '';
          setRosterNote(snapshot
            ? `That reviewer is no longer actionable${stage}, so the reviewer roster was reloaded.`
            : 'That reviewer changed elsewhere. Reload this request before continuing.');
        }
        return;
      }
      if (!res.ok || !data.success) throw new Error(data.error || 'promote failed');
    } catch {
      if (genRef.current === myGen) {
        setRosterActive((prev) => prev.filter((c) => candKey(c) !== key));
        setRosterExcluded((prev) => dedupeByName([cand, ...prev]));
        setRosterNote("Couldn't promote that reviewer — please try again.");
      }
    }
  }, [requestId, reloadRoster, displayOnly]);

  const removePreviousResults = useCallback(async () => {
    if (displayOnly || !requestId || busy || removingPrevious || previousSearchRefs.length === 0) return;
    const count = previousSearchKeys.size;
    if (!window.confirm(`Remove ${count} previously found reviewer${count === 1 ? '' : 's'} from this request? Applicant-recommended, saved, excluded, and COI records will be kept.`)) return;
    const myGen = genRef.current;
    setRemovingPrevious(true);
    setRosterNote(null);
    try {
      const res = await fetch('/api/workbench/reviewer-roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          action: 'remove_previous_results',
          candidateRefs: previousSearchRefs,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (genRef.current !== myGen) return;
      if (!res.ok || !data.success) throw new Error(data.error || 'remove failed');
      setRosterActive(Array.isArray(data.active) ? data.active : []);
      setRosterExcluded(Array.isArray(data.excluded) ? data.excluded : []);
      setRosterIneligible(Array.isArray(data.ineligible) ? data.ineligible : []);
      setRosterBlocked(Array.isArray(data.blocked) ? data.blocked : []);
      setRosterHandled(Array.isArray(data.handled) ? data.handled : []);
      setRosterSavedKeys(Array.isArray(data.savedKeys) ? data.savedKeys : []);
      setRosterNames(Array.isArray(data.allNames) ? data.allNames : []);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const key of Array.isArray(data.removedKeys) ? data.removedKeys : []) next.delete(key);
        return next;
      });
      setRosterNote(`${data.removed || 0} previous search result${data.removed === 1 ? '' : 's'} removed.`);
    } catch {
      if (genRef.current === myGen) {
        setRosterNote("Couldn't remove the previous search results — please try again.");
      }
    } finally {
      if (genRef.current === myGen) setRemovingPrevious(false);
    }
  }, [requestId, busy, removingPrevious, previousSearchKeys, previousSearchRefs, displayOnly]);

  // Apply a staff-entered MANUAL contact to a candidate's client state (the row
  // isn't a saved Dataverse record yet). Used by the lead "Use this email"
  // promotion (Slice 4) AND the on-card Edit-contact modal. For email/website it
  // stamps `manual` provenance (so emailConfidence → low → the invite flow requires
  // explicit quick-check acknowledgement) and clears the contact-layer abstain that
  // withheld a value (e.g. verified_domain_contradiction) so save can persist it.
  // NEVER touches name (the find-card key) or any identity field. Auto-selects so
  // the edit is included on save.
  const setManualContact = useCallback((cand, updates) => {
    if (displayOnly || !cand || !updates) return;
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
  }, [displayOnly]);

  const applyAuthoritativeRosterCandidate = useCallback((key, candidate) => {
    if (!key || !candidate) return;
    const replace = (current) => (candKey(current) === key ? candidate : current);
    setCandidates((prev) => prev.map(replace));
    setRecCandidates((prev) => prev.map(replace));
    setRosterActive((prev) => prev.map(replace));
  }, []);

  const verifyAddressContact = useCallback(async (cand, updates, evidence) => {
    if (displayOnly) throw new Error('Reviewer roster actions are unavailable while status is being checked.');
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
    if (genRef.current !== myGen) return;
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
  }, [requestId, applyAuthoritativeRosterCandidate, displayOnly]);

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
    if (displayOnly) return;
    const key = candKey(cand);
    if (!requestId || !key) return;
    const myGen = genRef.current;
    const response = await fetch('/api/workbench/reviewer-address-trust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, candidateKey: key, action: 'retry_check' }),
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
    setRosterNote(`${data.candidate.name || cand.name}: conflict check refreshed.`);
  }, [requestId, applyAuthoritativeRosterCandidate, displayOnly]);

  const requestAddressRepair = useCallback(async (cand) => {
    if (displayOnly) return;
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
    setRosterNote(response.ok && data.success
      ? `${data.message} Repair queue: ${data.adminUrl || '/admin#system-alerts'}`
      : (data.message || data.error || 'Could not create a repair request. Retry from this reviewer card.'));
  }, [requestId, displayOnly]);

  // Slice 4: a quarantined email lead must pass through the evidence form;
  // website-only leads remain a direct non-address edit.
  const useLead = useCallback((cand, lead) => {
    if (displayOnly || !cand || !lead || !lead.value) return;
    if (lead.type === 'email') {
      setEditingContact({ ...cand, email: lead.value, emailSource: 'manual' });
      return;
    }
    setManualContact(cand, { website: lead.value });
  }, [setManualContact, displayOnly]);

  // The candidate currently open in the on-card Edit-contact modal (local mode).
  const [editingContact, setEditingContact] = useState(null);
  // The needs-identity-review candidate open in the "confirm this person" modal.
  const [confirmingContact, setConfirmingContact] = useState(null);

  // PD confirms a needs-identity-review row IS the right person + supplies corrected
  // contact. The authenticated roster PATCH stores the request-scoped attestation
  // first; only then do we stamp manual contact + the UI marker/opaque id locally.
  const confirmIdentityContact = useCallback(async (cand, updates, evidence) => {
    if (displayOnly || !cand) return;
    const key = candKey(cand);
    if (!key || !requestId) return;
    const myGen = genRef.current;
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
    if (genRef.current !== myGen) return;
    const authoritativeConfirmed = data.candidate || confirmedCandidate;
    // The confirmation write has already committed. Keep that server truth in
    // the card even if the following address-evidence write fails and the modal
    // stays open for a retry.
    applyAuthoritativeRosterCandidate(key, authoritativeConfirmed);
    await verifyAddressContact(authoritativeConfirmed, updates, evidence);
  }, [requestId, verifyAddressContact, applyAuthoritativeRosterCandidate, displayOnly]);

  const refreshExpiredVerification = useCallback(async (staleCandidates, expectedGeneration) => {
    if (!requestId || !Array.isArray(staleCandidates) || staleCandidates.length === 0) {
      return { refreshed: [], failures: [], stale: false };
    }
    const failures = staleCandidates
      .filter((candidate) => Array.isArray(candidate?.manualContactFields) && candidate.manualContactFields.length > 0)
      .map((candidate) => ({
        name: candidate.name || 'Unknown candidate',
        error: 'Manual contact details were not overwritten by automated refresh; confirm the contact again before promoting.',
      }));
    const refreshableCandidates = staleCandidates.filter((candidate) => (
      !Array.isArray(candidate?.manualContactFields) || candidate.manualContactFields.length === 0
    ));
    if (refreshableCandidates.length === 0) {
      return { refreshed: [], failures, stale: false };
    }
    pushProgress(`Refreshing contact verification for ${refreshableCandidates.length} reviewer(s)…`);
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
        pushProgress(`Refreshing verification ${data.overall.current}/${data.overall.total}…`);
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
      const rosterResponse = await fetch('/api/workbench/reviewer-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          candidates: [pruneCandidateForRoster(candidate)],
        }),
      });
      const rosterData = await rosterResponse.json().catch(() => ({}));
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

  const saveSelected = useCallback(async () => {
    const myGen = genRef.current;
    if (displayOnly || savingRef.current === myGen) return;
    // Filter by isSelectable too (not just `selected`): a needs-identity-review row
    // can't be checked, but this guarantees one never reaches save-candidates even if
    // a stale `selected` entry survives a reclassification (defense-in-depth; the
    // server 422s these anyway).
    const chosen = displayCandidates.filter((c) => selected.has(candKey(c)) && isCandidateSelectable(c));
    if (chosen.length === 0) return;
    savingRef.current = myGen;
    const isCurrent = () => genRef.current === myGen;
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
      let savedRosterKeys = [];
      let blockedKeys = [];
      let expiredKeys = [];
      let addressVerificationKeys = [];
      let addressRepairKeys = [];
      let identityReviewResults = [];
      let serverRepairResults = [];
      let needsRosterReload = false;
      let refreshedVerificationCandidates = [];
      const rosterWarnings = [];
      if (toSave.length > 0) {
        pushProgress(`Saving ${toSave.length} candidate(s)…`);
        let receivedResponse = false;
        try {
          const sRes = await fetch('/api/reviewer-finder/save-candidates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId,
              proposalTitle: analysis?.proposalInfo?.title || null,
              programArea: analysis?.proposalInfo?.programArea || null,
              grantCycleCode: cycleCode || null,
              candidates: toSave,
            }),
          });
          receivedResponse = true;
          const sData = await sRes.json().catch(() => ({}));
          const saveResults = Array.isArray(sData.results) ? sData.results : [];
          saved = sData.savedCount || 0;
          savedKeys = Array.isArray(sData.savedKeys) ? sData.savedKeys : [];
          blockedKeys = saveResults
            .filter((result) => (
              result?.outcome === 'failed'
              && result?.code === 'applicant_excluded'
              && typeof result?.candidateKey === 'string'
            ))
            .map((result) => result.candidateKey);
          expiredKeys = saveResults
            .filter((result) => (
              result?.code === 'identity_attestation_required'
              && typeof result?.candidateKey === 'string'
            ))
            .map((result) => result.candidateKey);
          addressVerificationKeys = saveResults
            .filter((result) => (
              result?.code === 'address_verification_required'
              && typeof result?.candidateKey === 'string'
            ))
            .map((result) => result.candidateKey);
          addressRepairKeys = saveResults
            .filter((result) => (
              result?.code === 'conflict_record_unavailable'
              && typeof result?.candidateKey === 'string'
            ))
            .map((result) => result.candidateKey);
          identityReviewResults = saveResults.filter((result) => (
            result?.decision === 'identity_choice_required'
            && result?.code !== 'person_inactive'
            && typeof result?.candidateKey === 'string'
          ));
          serverRepairResults = saveResults.filter((result) => (
            new Set([
              'person_inactive',
              'email_conflict',
              'ambiguous_email_owner',
              'inactive_email_owner',
              'contact_linked_elsewhere',
            ]).has(result?.code)
            && typeof result?.candidateKey === 'string'
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
              name: 'Reviewer promotion',
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
          failures.push(...toSave
            .filter((candidate) => (
              !candidateWasSaved(candidate, savedKeys)
              && !savedRosterKeys.includes(candKey(candidate))
            ))
            .map((c) => ({
              name: c.name || 'Unknown candidate',
              error: receivedResponse ? e.message : 'Save outcome is unknown; roster state was refreshed before retry.',
            })));
        }

        const expiredCandidates = toSave.filter((candidate) => candidateWasSaved(candidate, expiredKeys));
        if (expiredCandidates.length > 0 && isCurrent()) {
          try {
            const refreshResult = await refreshExpiredVerification(expiredCandidates, myGen);
            if (refreshResult.stale || !isCurrent()) return;
            refreshedVerificationCandidates = refreshResult.refreshed;
            failures.unshift(...refreshResult.failures);
            if (refreshedVerificationCandidates.length > 0) {
              rosterWarnings.push(
                `Contact verification was refreshed for ${refreshedVerificationCandidates.length} reviewer`
                + `${refreshedVerificationCandidates.length === 1 ? '' : 's'}. Review the updated contact details, then select and promote again.`,
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
        if (isCurrent()) pushProgress(`Promoting ${applicantChosen.length} applicant-referred reviewer(s)…`);
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
              const error = new Error(data.message || data.error || `Promotion failed (${res.status})`);
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
              rosterWarnings.push('A promoted reviewer was saved, but the Find roster could not be finalized.');
            }
          } else {
            failures.push({ name: result.candidate.name || 'Applicant-referred reviewer', error: result.error });
            if (result.code === 'conflict_record_unavailable') {
              addressRepairKeys.push(candKey(result.candidate));
            } else if (new Set(['person_inactive', 'email_conflict', 'ambiguous_email_owner', 'inactive_email_owner']).has(result.code)) {
              serverRepairResults.push({
                candidateKey: candKey(result.candidate),
                code: result.code,
              });
            }
          }
        }
      }

      // The server owns the durable `saved` transition. The browser only
      // reconciles exact successful keys into its current view.
      if (savedKeys.length > 0 || savedRosterKeys.length > 0) {
        const wasSaved = (candidate) => (
          candidateWasSaved(candidate, savedKeys)
          || savedRosterKeys.includes(candKey(candidate))
        );
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
      if (blockedKeys.length > 0 && isCurrent()) {
        const wasBlocked = (candidate) => candidateWasSaved(candidate, blockedKeys);
        const blockedCandidates = displayCandidates
          .filter(wasBlocked)
          .map((candidate) => ({
            ...candidate,
            promotionDecision: 'blocked_applicant_excluded',
            promotionBlockCode: 'applicant_excluded',
            promotionBlockReason: 'This reviewer is applicant-excluded for the request and cannot be promoted.',
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
          rosterWarnings.push('Address verification is required. Use “Verify / edit address” on each affected reviewer, then select and promote again.');
        }
        if (addressRepairKeys.length > 0) {
          rosterWarnings.push('A conflict safety record could not be written. Retry from the reviewer card or create a durable repair request.');
        }
      }

      if (identityReviewResults.length > 0 && isCurrent()) {
        const reasonByKey = new Map(identityReviewResults.map((result) => [
          result.candidateKey,
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
          identityReviewResults.forEach((result) => next.delete(result.candidateKey));
          return next;
        });
        rosterWarnings.push('Dataverse identity evidence needs review. Use “This is the right person” to verify the person and exact address, or set the reviewer aside.');
      }

      if (serverRepairResults.length > 0 && isCurrent()) {
        const reasonByKey = new Map(serverRepairResults.map((result) => [
          result.candidateKey,
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
          serverRepairResults.forEach((result) => next.delete(result.candidateKey));
          return next;
        });
        rosterWarnings.push('A reviewer record must be repaired before promotion. Use “Create repair request” on the affected card.');
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
      if (promoted > 0) messageParts.push(`Promoted ${promoted} of ${applicantChosen.length} applicant-referred reviewer${applicantChosen.length === 1 ? '' : 's'}.`);
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
    }
  }, [
    displayCandidates,
    selected,
    requestId,
    analysis,
    cycleCode,
    onSaved,
    pushProgress,
    refreshExpiredVerification,
    reloadRoster,
    displayOnly,
  ]);

  // Export the SELECTED candidates to an Excel workbook (Request Info + Candidates
  // sheets, built server-side). Slim DTO per row resolves the same fields the card
  // shows (email/orcid/scholar fall back to contactEnrichment); the server fetches
  // request metadata (number/institution/PI) authoritatively by requestId.
  const exportSelected = useCallback(async () => {
    if (displayOnly || exportingRef.current) return;
    const chosen = displayCandidates.filter((c) => selected.has(candKey(c)) && isCandidateSelectable(c));
    if (chosen.length === 0) return;
    exportingRef.current = true;
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
      setExportError(e.message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [displayCandidates, selected, requestId, displayOnly]);

  const onExcludeChange = (ev) => { excludeEditedRef.current = true; setExcludeText(ev.target.value); };

  // The two selectable sections are VIEWS over displayCandidates; selection is
  // keyed by candKey(c) (stable normalized name), so a roster splice can't
  // corrupt it (S224 — replaces the former flat-index invariant).
  // Default order is confidence/relevance rank (server-ranked, preserved). The
  // alpha toggle re-sorts WITHIN each provenance group by display name so the
  // grouping (cited vs literature vs applicant) — which carries meaning — stays
  // intact while a specific name is easy to find. Non-mutating (copy before sort).
  const sortForDisplay = (items) =>
    sortMode === 'alpha'
      ? [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
      : items;
  const provenanceSections = [
    {
      key: 'cited_or_proposal_named',
      title: 'Cited / proposal-named / externally-referred',
      items: sortForDisplay(displayCandidates.filter((c) => provenanceGroupOf(c) === 'cited_or_proposal_named')),
    },
    {
      key: 'literature_retrieved',
      title: 'Literature-retrieved',
      items: sortForDisplay(displayCandidates.filter((c) => provenanceGroupOf(c) === 'literature_retrieved')),
    },
    {
      key: 'applicant_suggested',
      title: 'Applicant-referred',
      items: sortForDisplay(displayCandidates.filter((c) => provenanceGroupOf(c) === 'applicant_suggested')),
    },
    {
      key: 'needs_identity_review',
      title: 'Needs identity review',
      items: sortForDisplay(displayCandidates.filter((c) => provenanceGroupOf(c) === 'needs_identity_review')),
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
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Search for reviewers</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPromptEditor((s) => !s)}
            className="text-xs text-gray-500 hover:text-gray-800"
            title="Edit your personal copy of the analysis / scoring prompts"
          >
            ✎ {showPromptEditor ? 'Hide prompt editor' : 'Edit prompts'}
          </button>
          {busy && <Spinner />}
        </div>
      </div>

      {showPromptEditor && (
        <div className="mb-3">
          <ReviewerPromptOverridePanel onClose={() => setShowPromptEditor(false)} />
        </div>
      )}

      {!blobUrl && (
        <p className="text-sm text-gray-600">Load a proposal document above to search for new reviewers. Candidates already found for this request appear below.</p>
      )}

      {displayOnly && (
        <div role="status" className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
          {rosterSnapshot?.authorityState === 'error'
            ? 'Reviewer status could not be checked. Cached candidates remain visible but all roster actions are disabled.'
            : rosterSnapshot?.authorityState === 'current'
              ? 'Reviewer status is current. Roster actions remain disabled in this rollout.'
              : 'Cached reviewer candidates are display-only while current status is checked. Roster actions remain disabled in this rollout.'}
          {rosterSnapshot?.authorityState === 'error' && onRetryRoster && (
            <button type="button" onClick={onRetryRoster} className="ml-2 underline font-medium">Retry reviewer status</button>
          )}
        </div>
      )}

      {blobUrl && (phase === 'idle' || phase === 'error') && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Searches the selected literature sources using the loaded proposal, verifies expertise, and flags conflicts.
              </p>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Search sources:</label>
                <div className="flex gap-2 flex-wrap">
                  {SEARCH_SOURCES.map(({ key, label, icon, desc }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSearchSources((prev) => ({ ...prev, [key]: !prev[key] }))}
                      disabled={displayOnly}
                      aria-pressed={searchSources[key]}
                      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors flex flex-col items-center min-w-[80px] ${
                        searchSources[key]
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'bg-gray-50 border-gray-200 text-gray-400'
                      }`}
                    >
                      <span className="text-base leading-none">{icon}</span>
                      <span className="font-medium">{label}</span>
                      <span className="opacity-75">{desc}</span>
                    </button>
                  ))}
                </div>
                {noSourcesSelected && (
                  <p className="text-xs text-amber-700 mt-1">Select at least one source to search.</p>
                )}
              </div>
              <div>
                <label htmlFor="reviewer-count" className="block text-xs text-gray-500 mb-1">
                  Number of candidates to find: <span className="font-medium text-gray-700">{reviewerCount}</span>
                </label>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-4">1</span>
                  <input
                    id="reviewer-count"
                    type="range"
                    min="1"
                    max="25"
                    step="1"
                    value={reviewerCount}
                    onChange={(e) => setReviewerCount(parseInt(e.target.value, 10))}
                    disabled={displayOnly}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span className="text-xs text-gray-400 w-6 text-right">25</span>
                </div>
              </div>
              <div>
                <label htmlFor="additional-notes" className="block text-xs text-gray-500 mb-1">
                  Additional context for Claude (optional):
                </label>
                <textarea
                  id="additional-notes"
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                  rows={2}
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  disabled={displayOnly}
                  placeholder="e.g. prioritize clinical trialists; avoid industry-affiliated reviewers"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
                <div>
                  <label htmlFor="referred-seeds" className="block text-xs text-gray-500 mb-1">
                    Externally-referred reviewers (optional):
                  </label>
                  <textarea
                    id="referred-seeds"
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                    rows={2}
                  value={referredSeedsText}
                  onChange={(e) => setReferredSeedsText(e.target.value)}
                  disabled={displayOnly}
                    placeholder="e.g. Jane Smith, jane@uni.edu, University of Example"
                  />
                </div>
                <div>
                  <label htmlFor="referred-by" className="block text-xs text-gray-500 mb-1">
                    Referred by (optional):
                  </label>
                  <input
                    id="referred-by"
                    type="text"
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                  value={referredBy}
                  onChange={(e) => setReferredBy(e.target.value)}
                  disabled={displayOnly}
                    placeholder="Reviewer name"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Exclude these reviewers (one per line or comma-separated){exclusionsUnavailable ? ' — applicant list unavailable, add any by hand' : ''}:
                </label>
                <textarea
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                  rows={2}
                  value={excludeText}
                  onChange={onExcludeChange}
                  disabled={displayOnly}
                  placeholder="e.g. Thomas K. Wood, Jens Hör"
                />
                {exclusionsUnavailable && (
                  <p className="text-xs text-amber-700 mt-1">The applicant exclusion list couldn't be loaded — add exclusions manually above.</p>
                )}
                {excludedRaw && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 cursor-pointer">Applicant's original text</summary>
                    <pre className="text-xs bg-gray-50 text-gray-700 rounded p-2 mt-1 whitespace-pre-wrap">{excludedRaw}</pre>
                  </details>
                )}
              </div>
              {error && !promotionNotice && (
                <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                  {errorMeta?.status === 'analysis_invalid' ? (
                    <>
                      The proposal analysis response was incomplete or unreliable. Please retry the analysis.
                      {errorMeta.retryable && <span className="block text-xs mt-1">Use Try again to rerun the analysis.</span>}
                    </>
                  ) : errorMeta?.status === 'analysis_refused' ? (
                    <>
                      The analysis model declined this request.
                      <span className="block text-xs mt-1">Retrying is unlikely to help. This proposal needs an alternate analysis path; please contact an administrator.</span>
                    </>
                  ) : (
                    <>
                      {error}
                      {previousSearchKeys.size > 0 && (
                        <span className="block text-xs mt-1">
                          The previously found candidates below are unchanged; this attempt did not replace them.
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={rosterLoadFailed ? retryRosterLoad : runSearch}
                disabled={!rosterLoadFailed && (displayOnly || noSourcesSelected || !rosterLoaded || removingPrevious || errorMeta?.status === 'analysis_refused')}
                className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {rosterLoadFailed
                  ? 'Retry reviewer state'
                  : !rosterLoaded
                  ? 'Loading existing candidates…'
                  : errorMeta?.status === 'analysis_refused'
                    ? 'Alternate analysis required'
                    : phase === 'error' ? 'Try again' : 'Run reviewer search'}
              </button>
            </div>
          )}

          {phase === 'running' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Searching… this can take several minutes — please keep this tab open.</p>
              <ul className="text-xs text-gray-500 space-y-0.5">
                {progress.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          {/* Durable roster + this-run results — rendered INDEPENDENT of `phase`
              so the per-request candidate list (active + the collapsed Excluded
              set) shows on reload and even when no proposal is loaded. */}
          {(rosterNote || displayCandidates.length > 0 || rosterExcluded.length > 0 || rosterIneligible.length > 0 || rosterBlocked.length > 0 || phase === 'results' || phase === 'done') && (
            <div className="space-y-3 mt-3">
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
                      disabled={displayOnly || removingPrevious || busy || previousSearchRefs.length !== previousSearchKeys.size}
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
                              onClick={() => setSortMode('relevance')}
                              aria-pressed={sortMode === 'relevance'}
                              className={`px-2 py-0.5 ${sortMode === 'relevance' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                              title="Order by confidence / relevance rank (default)"
                            >
                              Rank
                            </button>
                            <button
                              type="button"
                              onClick={() => setSortMode('alpha')}
                              aria-pressed={sortMode === 'alpha'}
                              className={`px-2 py-0.5 border-l border-gray-200 ${sortMode === 'alpha' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                              title="Order alphabetically by name within each group"
                            >
                              A–Z
                            </button>
                          </span>
                          <button type="button" onClick={toggleAll} disabled={displayOnly} className="text-xs text-blue-600 underline disabled:opacity-40">
                            {allSelected ? 'Clear all' : 'Select all'}
                          </button>
                        </div>
                      </div>
                      <div data-testid="reviewer-candidate-list" className="space-y-4">
                        {provenanceSections.map((section) => {
                          // Slice E: the needs-identity-review section is read-only.
                          const readOnlySection = section.key === 'needs_identity_review';
                          return (
                          <div key={section.key}>
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                              {section.title} ({section.items.length})
                            </p>
                            {section.key === 'needs_identity_review' && (
                              <p className="text-xs text-gray-400 mb-1.5">
                                Identity couldn't be confirmed for these. If you recognize one, use
                                “This is the right person” to correct the contact and add them.
                              </p>
                            )}
                            {section.key === 'applicant_suggested' && (
                              <p className="text-xs text-gray-400 mb-1.5">
                                Named by the applicant — promote only after the identity and exact email are verified.
                              </p>
                            )}
                            <div className="space-y-2">
                              {section.items.map((c) => {
                                // A PD-confirmed needs-review row flips to a normal selectable
                                // card; unconfirmed ones stay read-only but get the "confirm
                                // identity" affordance so a PD can rescue a real reviewer.
                                const selectableNow = isCandidateSelectable(c);
                                const promotionDecision = getCandidatePromotionDecision(c);
                                const canConfirmForPromotion = !selectableNow
                                  && !c.hasInstitutionCOI
                                  && (
                                    !c.isApplicantRecommended
                                    || c.applicantKnownReviewer?.status === 'known'
                                  )
                                  && (c.eligibilityStatus || c.contactEnrichment?.eligibilityStatus) !== 'deceased'
                                  && (
                                    promotionDecision?.decision === 'needs_identity_confirmation'
                                    || promotionDecision?.decision === 'missing_email'
                                  );
                                if (selectableNow && !readOnlySection) {
                                  return <CandidateCard key={candKey(c)} candidate={c} previousResult={previousSearchKeys.has(candKey(c))} checked={selected.has(candKey(c))} readOnly={displayOnly} onToggle={displayOnly ? undefined : () => toggle(candKey(c))} onExclude={displayOnly ? undefined : excludeCandidate} onUseLead={displayOnly ? undefined : useLead} onEdit={displayOnly ? undefined : setEditingContact} canManage={canManage && !displayOnly} />;
                                }
                                if (selectableNow && readOnlySection) {
                                  // needs-review row the PD just confirmed → selectable + editable.
                                  return <CandidateCard key={candKey(c)} candidate={c} previousResult={previousSearchKeys.has(candKey(c))} checked={selected.has(candKey(c))} readOnly={displayOnly} onToggle={displayOnly ? undefined : () => toggle(candKey(c))} onExclude={displayOnly ? undefined : excludeCandidate} onUseLead={displayOnly ? undefined : useLead} onEdit={displayOnly ? undefined : setEditingContact} canManage={canManage && !displayOnly} />;
                                }
                                return <CandidateCard
                                  key={candKey(c)}
                                  candidate={c}
                                  previousResult={previousSearchKeys.has(candKey(c))}
                                  readOnly
                                  onExclude={displayOnly ? undefined : excludeCandidate}
                                  onEdit={(
                                    promotionDecision?.decision === 'ready'
                                    || promotionDecision?.reason === 'contact_claim_mismatch'
                                    || c.applicantContactMismatch === true
                                  ) && !displayOnly ? setEditingContact : undefined}
                                  onRequestRepair={displayOnly ? undefined : requestAddressRepair}
                                  onReviewAddressConflict={displayOnly ? undefined : reviewAddressConflict}
                                  onRetryAddressCheck={displayOnly ? undefined : retryAddressCheck}
                                  onConfirmIdentity={canConfirmForPromotion && !displayOnly ? (cand) => setConfirmingContact(cand) : undefined}
                                  canManage={canManage && !displayOnly}
                                />;
                              })}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                        <button
                          type="button"
                          onClick={saveSelected}
                          disabled={displayOnly || selected.size === 0 || phase === 'saving'}
                          aria-busy={phase === 'saving'}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {phase === 'saving' ? (
                            <>
                              <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                              Promoting {selected.size} selected reviewer{selected.size === 1 ? '' : 's'}…
                            </>
                          ) : (
                            <>Promote {selected.size > 0 ? selected.size : ''} selected to Invite</>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={exportSelected}
                          disabled={displayOnly || selected.size === 0 || exporting}
                          title={selected.size === 0 ? 'Select candidates — or use Select all — to export' : undefined}
                          className="px-4 py-2 bg-white text-gray-900 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {exporting ? 'Exporting…' : `Export ${selected.size > 0 ? selected.size : ''} to Excel`}
                        </button>
                        <button type="button" onClick={runSearch} disabled={displayOnly || !blobUrl || busy || removingPrevious || !rosterLoaded} className="text-sm text-gray-500 underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">Run another search</button>
                      </div>
                      {exportError && (
                        <p className="text-sm text-amber-700">Export failed: {exportError}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        Saved candidates join this request's pool and appear in the Invite tab once you invite and they accept. Excluded and already-surfaced candidates are skipped by the next search.
                      </p>
                    </>
                  )}

                  {/* Collapsed, recoverable Excluded set (durable per request). */}
                  {rosterExcluded.length > 0 && (
                    <details open={excludedOpen} onToggle={(e) => setExcludedOpen(e.currentTarget.open)} className="border border-gray-200 rounded-lg p-2">
                      <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                        Excluded ({rosterExcluded.length}) — set aside for this request; not re-surfaced by a search. Promote one back to reconsider it.
                      </summary>
                      <div className="space-y-2 mt-2">
                        {rosterExcluded.map((c) => (
                          <CandidateCard key={`exc-${candKey(c)}`} candidate={c} readOnly onPromote={displayOnly ? undefined : promoteCandidate} />
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
                          const evidence = candidate.eligibilityEvidence
                            || candidate.contactEnrichment?.eligibilityEvidence;
                          return (
                            <li key={`ineligible-${candKey(candidate)}`}>
                              <span className="font-medium">{candidate.name}</span>
                              {evidence?.url && (
                                <>
                                  {' · '}
                                  <a
                                    href={evidence.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                  >
                                    official source
                                  </a>
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
                        Promotion blocked ({rosterBlocked.length}) — applicant-excluded for this request
                      </summary>
                      <div className="space-y-2 mt-2">
                        {rosterBlocked.map((candidate) => (
                          <CandidateCard
                            key={`blocked-${candKey(candidate)}`}
                            candidate={candidate}
                            readOnly
                          />
                        ))}
                      </div>
                    </details>
                  )}

                  {unverifiedToShow.length > 0 && (
                    <details className="border border-gray-200 rounded-lg p-2">
                      <summary className="text-xs font-medium text-gray-500 cursor-pointer">
                        Unverified suggestions ({unverifiedToShow.length}) — couldn't confirm these in the literature; not selectable
                      </summary>
                      <div className="space-y-2 mt-2">
                        {unverifiedToShow.map((c, i) => (
                          <CandidateCard key={`unv-${c.name}-${i}`} candidate={c} readOnly />
                        ))}
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
                        ? `Promoting ${selected.size} selected reviewer${selected.size === 1 ? '' : 's'}…`
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
      {/* On-card contact editor. Plain edits are local; exact-address verification
          durably updates the request roster. Name is locked here. */}
      {editingContact && (
        <CandidateEditModal
          candidate={editingContact}
          nameEditable={false}
          onApply={(updates) => setManualContact(editingContact, updates)}
          onVerifyAddress={(updates, evidence) => verifyAddressContact(editingContact, updates, evidence)}
          requireAddressVerification={getCandidateEmailReadiness(editingContact).action !== 'ready'}
          onClose={() => setEditingContact(null)}
        />
      )}
      {/* PD identity-override editor for a needs-identity-review row: correct the
          contact + tick "I've verified this person" → row becomes selectable and
          saves with the manual contact (bibliometrics dropped server-side). */}
      {confirmingContact && (
        <CandidateEditModal
          candidate={confirmingContact}
          nameEditable={false}
          confirmMode
          onVerifyAddress={() => {}}
          requireAddressVerification
          onConfirm={(updates, evidence) => confirmIdentityContact(confirmingContact, updates, evidence)}
          onClose={() => setConfirmingContact(null)}
        />
      )}
    </Card>

    {/* Manual reviewer add — slot rendered BELOW the search and ABOVE the optional
        verify card (state + handlers live in ReviewerFindPanel). */}
    {manualAddSlot}

    {handledReviewers.length > 0 && (
      <Card hover={false}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-medium text-gray-900">Already handled</p>
          <span className="text-xs text-gray-500">Not actionable in Find</span>
        </div>
        <ul className="space-y-2">
          {handledReviewers.map((reviewer) => (
            <li key={reviewer.candidateKey || reviewer.suggestionId || reviewer.name} className="flex items-center justify-between gap-3 text-sm border border-gray-200 rounded p-2">
              <span>
                <span className="font-medium text-gray-900">{reviewer.name}</span>
                <span className="ml-2 text-gray-500">{String(reviewer.stage || 'handled').replaceAll('_', ' ')}</span>
              </span>
              <button
                type="button"
                onClick={() => onNavigate?.(['selected', 'declined'].includes(reviewer.stage) ? 'candidates' : 'track')}
                disabled={!onNavigate}
                className="text-xs text-amber-900 underline whitespace-nowrap"
              >
                {reviewer.stage === 'selected'
                  ? 'Open Invite'
                  : reviewer.stage === 'declined'
                    ? 'Open Removed'
                    : 'Open Track'}
              </button>
            </li>
          ))}
        </ul>
      </Card>
    )}

    {/* Applicant-referred reviewer status card — ingestion + enrichment state.
        Enriched candidates surface in the Applicant-referred provenance section
        of the main candidate list above; this card is a status surface only.
        Enrichment fires automatically when both the proposal and the ingested
        recommendations are ready (no manual trigger required). */}
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-gray-900">Applicant-referred reviewers</p>
        {(ingestLoading || recPhase === 'running') && <Spinner />}
      </div>

      {ingestError ? (
        <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
          Couldn't ingest applicant reviewers: {ingestError}{' '}
          <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
        </div>
      ) : ingestLoading ? (
        <p className="text-sm text-gray-500">Materializing the applicant's recommended reviewers…</p>
      ) : (recommended.length === 0 && recommendedFailed.length === 0 && slotsPopulated === 0) ? (
        <p className="text-sm text-gray-600">The applicant did not list any recommended reviewers for this request.</p>
      ) : (recommended.length === 0 && recommendedFailed.length === 0 && slotsPopulated === null) ? (
        <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
          Couldn't confirm the applicant's recommended reviewers.{' '}
          <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
        </div>
      ) : (
        <div className="space-y-3">
          {recommendedFailed.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
              {recommendedFailed.length} of {slotsPopulated ?? (recommended.length + recommendedFailed.length)}{' '}
              applicant-recommended reviewer{recommendedFailed.length === 1 ? '' : 's'} failed to ingest
              {recommendedFailed.some((f) => f.name) && (
                <> ({recommendedFailed.map((f) => f.name).filter(Boolean).join(', ')})</>
              )}
              . They are <span className="font-medium">not</span> saved as candidates.{' '}
              <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
            </div>
          )}
          {knownLookupFailed.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
              {knownLookupFailed.length} materialized reviewer record{knownLookupFailed.length === 1 ? '' : 's'} could not be safely hydrated from Dataverse.{' '}
              <button type="button" onClick={onRetryIngestion} className="underline font-medium">Retry</button>
            </div>
          )}
          {recommended.length > 0 && (
            <ul className="space-y-2">
              {recommended.map((row) => {
                const known = row.applicantKnownReviewer;
                return (
                  <li key={row.suggestionId || row.potentialReviewerId} className="p-2 border border-gray-200 rounded text-xs text-gray-700">
                    <div className="font-medium">{known?.name || row.name || 'Applicant-recommended reviewer'}</div>
                    {known?.status === 'known' ? (
                      <>
                        <div className="text-emerald-700">✓ Existing linked reviewer record</div>
                        {known.affiliation && <div>{known.affiliation}</div>}
                        {known.orcid && <div>ORCID {known.orcid}</div>}
                        <div>
                          {known.email || 'No stored email'}
                          {known.emailReadiness?.action ? ` · ${known.emailReadiness.action}` : ''}
                        </div>
                      </>
                    ) : (
                      <div className="text-amber-700">
                        Existing linked record needs repair ({known?.code || 'person_unavailable'}).
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {recPhase === 'idle' && !blobUrl && recCount > 0 && (
            <p className="text-sm text-gray-500">
              {recCount} applicant-referred reviewer{recCount === 1 ? '' : 's'} ingested — waiting for the proposal to load before verifying.
            </p>
          )}
          {recPhase === 'running' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Verifying applicant-referred reviewers — this can take a minute or two, please keep this tab open.</p>
              <ul className="text-xs text-gray-500 space-y-0.5">
                {recProgress.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {recPhase === 'done' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                {recVerifiedCount === 0 && recIdentityReviewCount === 0
                  ? 'No applicant-referred reviewers could be verified.'
                  : <>
                      {recVerifiedCount > 0
                        ? `${recVerifiedCount} applicant-referred reviewer${recVerifiedCount === 1 ? '' : 's'} verified — see the Applicant-referred section above`
                        : 'No reviewers added to the Applicant-referred section'}
                      {recIdentityReviewCount > 0 && <>; {recIdentityReviewCount} could not be confirmed — see the Identity review section</>}.
                    </>
                }
              </p>
              {recCount > 0 && (
                <button
                  type="button"
                  onClick={() => enrichRecommended()}
                  disabled={displayOnly || !blobUrl || !proposalKey}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Update applicant suggestions
                </button>
              )}
            </div>
          )}
          {recPhase === 'error' && (
            <div className="space-y-2">
              <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{recError}</div>
              <button
                type="button"
                onClick={() => enrichRecommended()}
                disabled={displayOnly || !blobUrl || !proposalKey}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
    </>
  );
}
