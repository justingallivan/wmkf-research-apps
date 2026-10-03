/**
 * Pure helpers for the in-panel reviewer search (Workbench Find).
 * Kept separate from the React component so they can be unit-tested.
 */

// Name normalization + exact-exclusion live in the CJS util so the server
// (/discover dedup, reviewer-roster-store) and this client module share ONE
// implementation. Re-exported below so existing client imports keep working.
import { normalizeReviewerName as _normalizeReviewerName, partitionByExcluded } from '../../../lib/utils/reviewer-name-match';
import { buildReviewerProvenance, PROVENANCE_KINDS, provenanceGroupOf, provenanceKindOf, formatReferredByReason, sanitizeInstitutionCOIDetails as _sanitizeInstitutionCOIDetails } from '../../../lib/utils/reviewer-provenance';
import { ContactParser } from '../../../lib/utils/contact-parser';
import { parseReferredSeeds as _parseReferredSeeds } from '../../../lib/utils/reviewer-referral-seeds';
import { reviewerSaveKey } from '../../../lib/utils/reviewer-save-key';
import {
  reviewerCandidateKey as _reviewerCandidateKey,
  reviewerSuggestionCandidateKey,
  withReviewerCandidateKey as _withReviewerCandidateKey,
} from '../../../lib/utils/reviewer-candidate-key';
import { emailConfidence } from '../../../lib/utils/reviewer-invite';
import { STAFF_ADDRESS_CHOICE_REASON } from '../../../lib/utils/reviewer-address-trust';
import { projectReviewerContact } from '../../../lib/utils/reviewer-vetted-email';
import { normalizeOrcid } from '../../../lib/utils/orcid-normalize';
import {
  projectCanonicalApplicantContact,
  pruneApplicantKnownReviewer,
} from '../../../lib/utils/applicant-known-reviewer';
import {
  INSTITUTION_STAGE2_PRESENTATION_VERSION,
  isInstitutionStage2PresentationEnabled,
} from '../../utils/institution-stage2-presentation';
import { APPLICANT_ENRICHMENT_CACHE_VERSION } from '../../utils/reviewer-roster-projection';

export { APPLICANT_ENRICHMENT_CACHE_VERSION };
export {
  MAX_ROSTER_CONTACT_LEADS,
  MAX_ROSTER_IDENTITY_ANCHORS,
  MAX_ROSTER_AFFILIATION_ASSERTIONS,
  pruneContactLeads,
  pruneEmailEvidence,
  pruneIdentityDecision,
  pruneIndependentIdentity,
  pruneAffiliationAssertions,
  pruneEligibilityEvidence,
  pruneDataverseContactEvidence,
  pruneCandidateForRoster,
} from '../../utils/reviewer-roster-projection';


/**
 * Merge contact-enrichment results (from /enrich-contacts) back onto the chosen
 * candidates by name, mirroring the standalone Reviewer Finder's save mapping.
 * The enrichment's contact + bibliometric fields take precedence and are also
 * promoted to the candidate top-level, because save-candidates.js reads them off
 * `candidate.*` (email/website/orcid/website/hIndex/i10Index/totalCitations/…),
 * NOT off `candidate.contactEnrichment.*`. The full contactEnrichment object is
 * also attached so the card can render source/year detail.
 *
 * Institution COI is also re-promoted here: enrich-contacts re-evaluates it on the
 * post-enrichment affiliation and flags `contactEnrichment.coiRecomputed`, so the
 * badge matches the affiliation the card actually shows (Codex P2#1).
 *
 * @param {object[]} candidates
 * @param {Array<{name: string, contactEnrichment: object}>|null|undefined} enrichmentResults
 * @returns {object[]}
 */
// Re-export the canonical sanitizer (lib/utils/reviewer-provenance) so existing
// client imports keep working while server (roster-store) + client share ONE impl.
export const sanitizeInstitutionCOIDetails = _sanitizeInstitutionCOIDetails;

export function isCandidateSelectable(c) {
  const eligibilityStatus = c?.eligibilityStatus || c?.contactEnrichment?.eligibilityStatus || 'unknown';
  return eligibilityStatus !== 'deceased'
    && getCandidatePromotionDecision(c)?.decision === 'ready'
    && getCandidateEmailReadiness(c)?.action === 'ready'
    && !c?.hasInstitutionCOI;
}

export function canConfirmCandidateForPromotion(candidate) {
  const promotionDecision = getCandidatePromotionDecision(candidate);
  const eligibilityStatus = candidate?.eligibilityStatus
    || candidate?.contactEnrichment?.eligibilityStatus;
  return !isCandidateSelectable(candidate)
    && !candidate?.hasInstitutionCOI
    && (!candidate?.isApplicantRecommended || candidate?.applicantKnownReviewer?.status === 'known')
    && eligibilityStatus !== 'deceased'
    && (
      promotionDecision?.decision === 'needs_identity_confirmation'
      || promotionDecision?.decision === 'missing_email'
    );
}

/**
 * Name an exact Find-card action only when the card caller will expose it.
 * Unknown, unavailable, and record-repair cases deliberately remain generic:
 * a repair alert must never instruct staff to create the same alert again.
 */
export function getFindCandidateRepairGuidanceAction(candidate) {
  const promotionDecision = getCandidatePromotionDecision(candidate);
  const identityUnverified = promotionDecision?.decision === 'needs_identity_confirmation'
    && promotionDecision?.reason === 'identity_not_resolved';
  if (candidate?.conflictRecordUnavailable === true) return 'use_primary_action';
  if (promotionDecision?.decision === 'needs_record_repair') return 'retry_record_check';
  if (identityUnverified) {
    return canConfirmCandidateForPromotion(candidate) ? 'confirm_identity' : 'use_primary_action';
  }
  if (candidate?.addressConflictPending === true) return 'review_address_conflict';
  return 'use_primary_action';
}

export function candidateWasSaved(candidate, savedKeys = []) {
  const stableKeys = new Set(Array.isArray(savedKeys) ? savedKeys : []);
  return stableKeys.has(reviewerSaveKey(candidate));
}

/**
 * Bind per-row save results back to the immutable roster key rendered by Find.
 *
 * The save API deliberately returns `reviewerSaveKey(candidate)` as its batch
 * correlation key, while the roster/UI uses `reviewerCandidateKey(candidate)`.
 * Those keys often differ (for example, an ORCID-anchored card). Prefer the
 * server-returned batch index, but require its save key to match before using
 * it. A unique save-key match is the compatibility fallback for older result
 * rows without an index. Ambiguous or malformed results remain unbound so the
 * client cannot mutate the wrong card.
 */
export function correlateSaveResultsToRosterCandidates(results, candidates) {
  const rows = Array.isArray(results) ? results : [];
  const submitted = Array.isArray(candidates) ? candidates : [];
  const bySaveKey = new Map();
  for (const candidate of submitted) {
    const saveKey = reviewerSaveKey(candidate);
    if (!saveKey) continue;
    const matches = bySaveKey.get(saveKey) || [];
    matches.push(candidate);
    bySaveKey.set(saveKey, matches);
  }
  return rows.map((result) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    // `rosterCandidateKey` is derived locally from the submitted batch. Never
    // accept a server/client-carried value for this UI mutation target.
    const { rosterCandidateKey: _discardedRosterCandidateKey, ...cleanResult } = result;
    const saveKey = typeof result?.candidateKey === 'string' ? result.candidateKey : null;
    let matched = null;
    const hasIndex = Object.prototype.hasOwnProperty.call(result, 'index');
    if (saveKey && hasIndex && Number.isInteger(result.index) && result.index >= 0 && result.index < submitted.length) {
      const indexed = submitted[result.index];
      if (reviewerSaveKey(indexed) === saveKey) matched = indexed;
    }
    // A contradictory/malformed explicit index is untrusted. Unique-key lookup
    // exists only for legacy result rows that omitted index entirely.
    if (!matched && saveKey && !hasIndex) {
      const matches = bySaveKey.get(saveKey) || [];
      if (matches.length === 1) [matched] = matches;
    }
    const rosterCandidateKey = reviewerCandidateKey(matched);
    return rosterCandidateKey ? { ...cleanResult, rosterCandidateKey } : cleanResult;
  });
}

export function getCandidatePromotionDecision(candidate) {
  const knownRepairReason = candidate?.applicantKnownReviewer?.status === 'inactive'
    ? 'person_inactive'
    : (candidate?.applicantKnownReviewer?.status === 'email_conflict' ? 'email_conflict' : null);
  const serverRepairReason = candidate?.serverRepairReason || knownRepairReason;
  if (serverRepairReason) {
    return {
      decision: 'needs_record_repair',
      reason: serverRepairReason,
      email: null,
    };
  }
  const dataverseReason = candidate?.serverIdentityReviewReason
    || candidate?.contactEnrichment?.dataverseContactEvidence?.reason
    || null;
  const dataverseNeedsIdentityChoice = new Set([
    'provisional_orcid_match',
    'ambiguous_or_name_mismatch',
    'orcid_email_split',
    'contact_linked_elsewhere',
    'identity_conflict',
    'manual_contact_changed',
  ]).has(dataverseReason);
  if (candidate?.pdIdentityConfirmed !== true && dataverseNeedsIdentityChoice) {
    return {
      decision: 'needs_identity_confirmation',
      reason: dataverseReason,
      email: null,
    };
  }
  const shared = projectReviewerContact(candidate, {
    staffConfirmed: candidate?.pdIdentityConfirmed === true,
  });
  if (!candidate?.isApplicantRecommended || !candidate?.applicantKnownReviewer) {
    return shared;
  }
  if (
    shared?.decision === 'needs_identity_confirmation'
    && (shared.reason === 'identity_not_resolved' || shared.reason === 'contact_claim_mismatch')
  ) {
    return shared;
  }

  const canonical = projectCanonicalApplicantContact({
    applicantKnownReviewer: candidate.applicantKnownReviewer,
    candidate,
    allowStaffManualContact: true,
  });
  if (canonical.decision === 'ready') {
    return {
      ...shared,
      decision: 'ready',
      reason: null,
      email: canonical.email,
      emailSource: canonical.emailSource,
      emailAction: canonical.emailReadiness?.action || null,
      emailActionReason: canonical.emailReadiness?.reason || null,
    };
  }
  if (canonical.decision === 'missing_email') {
    // The exact person may legitimately have no stored address yet while this
    // request's enrichment produced a vetted, identity-gated pair. Keep that
    // row selectable so the server-owned B1 path can persist the pair before
    // re-reading canonical contact. The shared projection is the authority for
    // this narrow fallback; client-only top-level claims cannot make it ready.
    if (shared?.decision === 'ready') return shared;
    return { ...shared, decision: 'missing_email', reason: 'email_missing' };
  }
  return {
    ...shared,
    decision: 'needs_identity_confirmation',
    reason: canonical.decision,
  };
}

export const CANDIDATE_REASON_PRESENTATION = Object.freeze({
  suggestion: Object.freeze({
    label: 'Why this reviewer was suggested:',
    remedyId: null,
  }),
  identity_review: Object.freeze({
    label: 'Identity concern:',
    remedyId: 'confirm_identity',
  }),
  record_repair: Object.freeze({
    label: 'Why this needs repair:',
    remedyId: 'retry_record_check',
  }),
});

/**
 * Closed presentation contract for candidate reasoning. `reasoning` is used
 * both for positive recommendation rationale and for fail-closed identity
 * explanations; this projection prevents negative copy from inheriting the
 * positive "Suggested because" label and names the corresponding remedy.
 */
export function getCandidateReasonPresentation(candidate) {
  const text = candidate?.reasoning || candidate?.generatedReasoning || null;
  if (!text) return null;
  const decision = getCandidatePromotionDecision(candidate)?.decision;
  const explicitServerIdentityReview = decision === 'needs_identity_confirmation'
    && Boolean(
      candidate?.serverIdentityReviewReason
        || candidate?.contactEnrichment?.dataverseContactEvidence?.reason,
    );
  const unresolvedIdentity = candidate?.identityStatus === 'unresolved'
    || candidate?.verificationStatus === 'unresolved'
    || candidate?.needsIdentification === true;
  // `reasoning` is overloaded: most rows carry the positive expertise rationale,
  // while a smaller set carries an identity failure explanation. Do not relabel
  // a positive recommendation as the reason the identity is questionable.
  const describesIdentityConcern = /could not confirm|unable to confirm|could not be reconciled|different (?:people|person)|may be a different person|identity (?:conflict|mismatch)|ambiguous (?:identity|name)|orcid.+email.+(?:split|differ|different)/i.test(text);
  const kind = decision === 'needs_record_repair'
    ? 'record_repair'
    : ((explicitServerIdentityReview || unresolvedIdentity) && describesIdentityConcern
        ? 'identity_review'
        : 'suggestion');
  return { kind, text, ...CANDIDATE_REASON_PRESENTATION[kind] };
}

/**
 * Stable correlation key for one surfaced candidate row.
 *
 * This is deliberately not a name-only identity claim. Prefer durable person
 * anchors when discovery has them; otherwise use reviewerSaveKey's composite
 * name/email/ORCID/affiliation fingerprint. The key is stamped before
 * enrichment and then preserved, so promoted affiliation evidence or a newly
 * found email cannot change selection state or attach another same-name
 * candidate's enrichment.
 */
export const reviewerCandidateKey = _reviewerCandidateKey;
export const withReviewerCandidateKey = _withReviewerCandidateKey;

/**
 * Project the invitation service's authoritative address-source classifier
 * onto a Find-tab candidate. "missing" is UI-only: the send path still
 * re-derives high/low from the persisted person row immediately before send.
 *
 * @param {object} candidate
 * @returns {{ level: 'high'|'low'|'missing', action: 'ready'|'blocked'|'quick_check'|'research_only'|'missing', reason: string }}
 */
export function getCandidateEmailReadiness(candidate) {
  const enrichment = candidate?.contactEnrichment || {};
  const known = pruneApplicantKnownReviewer(candidate?.applicantKnownReviewer);
  const manualEmail = Array.isArray(candidate?.manualContactFields)
    && candidate.manualContactFields.includes('email');
  if (!manualEmail && known?.status === 'known' && known.email) {
    return known.emailReadiness;
  }
  const email = candidate?.email || enrichment.email || null;
  if (!email) {
    return {
      level: 'missing',
      action: 'missing',
      reason: 'No email address found during contact enrichment',
    };
  }
  if (candidate?.conflictRecordUnavailable === true || enrichment.conflictRecordUnavailable === true) {
    return {
      level: 'low',
      action: 'blocked',
      reason: 'The address conflict could not be recorded safely; retry or request repair',
    };
  }
  if (candidate?.addressVerificationRequired === true || enrichment.addressVerificationRequired === true) {
    return {
      level: 'low',
      action: 'research_only',
      reason: 'Staff must verify this exact person and address before promotion',
    };
  }
  if (candidate?.addressConflictPending === true || enrichment.addressConflictPending === true) {
    return {
      level: 'low',
      action: 'blocked',
      reason: 'Stored and newly found addresses conflict and require resolution',
    };
  }
  const receipt = candidate?.addressTrustReceipt;
  const addressChoiceEmail = typeof candidate?.addressChoice?.selectedEmail === 'string'
    ? candidate.addressChoice.selectedEmail.trim().toLowerCase()
    : null;
  const resolvedStaffChoice = receipt?.evidenceType === 'staff_address_choice'
    && ['keep_stored', 'use_found'].includes(candidate?.addressChoice?.decision)
    && addressChoiceEmail === String(email).trim().toLowerCase();
  if (
    receipt?.personConfirmed === true
    && typeof receipt.email === 'string'
    && receipt.email.trim().toLowerCase() === String(email).trim().toLowerCase()
    && (receipt.evidenceType !== 'staff_address_choice' || resolvedStaffChoice)
  ) {
    return {
      level: 'high',
      action: 'ready',
      reason: resolvedStaffChoice
        ? STAFF_ADDRESS_CHOICE_REASON
        : 'Staff verified this exact person and address for promotion',
    };
  }
  const confidence = emailConfidence({
    email,
    emailSource: candidate?.emailSource || enrichment.emailSource || null,
    identityStatus: candidate?.identityStatus
      || enrichment.identityStatus
      || enrichment.identity?.status
      || null,
  });
  if (confidence.level === 'low' && enrichment.contactStatusReason) {
    return { ...confidence, reason: enrichment.contactStatusReason };
  }
  return confidence;
}

export function mergeEnrichment(candidates, enrichmentResults) {
  if (!Array.isArray(candidates)) return [];
  if (!Array.isArray(enrichmentResults) || enrichmentResults.length === 0) return candidates;
  const byKey = new Map();
  const candidateNameCounts = new Map();
  const resultNameCounts = new Map();
  const byName = new Map();
  for (const candidate of candidates) {
    const name = String(candidate?.name || '');
    candidateNameCounts.set(name, (candidateNameCounts.get(name) || 0) + 1);
  }
  for (const r of enrichmentResults) {
    const key = reviewerCandidateKey(r);
    if (key && r?.contactEnrichment) byKey.set(key, r);
    const name = String(r?.name || '');
    if (name && r?.contactEnrichment) {
      resultNameCounts.set(name, (resultNameCounts.get(name) || 0) + 1);
      byName.set(name, r);
    }
  }
  return candidates.map((candidate, index) => {
    const c = withReviewerCandidateKey(candidate);
    const uniqueNameMatch = candidateNameCounts.get(c.name) === 1
      && resultNameCounts.get(c.name) === 1
      ? byName.get(c.name)
      : null;
    const enriched = byKey.get(c.candidateKey)
      // Legacy callers sometimes return only name + contactEnrichment. A name
      // join is safe only when that name is unique on BOTH sides.
      || uniqueNameMatch
      // enrichCandidates preserves strict input order. This fallback supports
      // legacy callers that have not stamped candidateKey yet, but only when
      // the response is a complete 1:1 list.
      || (enrichmentResults.length === candidates.length ? enrichmentResults[index] : null);
    if (!enriched) return candidate;
    const e = enriched.contactEnrichment;
    if (!e) return c;
    const contactEnrichment = {
      ...e,
      website: ContactParser.sanitizeWebsiteForCandidate(e.website, c.name) || null,
    };
    return {
      ...c,
      automatedIdentityAttestation: enriched.automatedIdentityAttestation || null,
      addressConflictPending: enriched.addressConflictPending === true
        || e.addressConflictPending === true
        || c.addressConflictPending === true,
      conflictRecordUnavailable: enriched.conflictRecordUnavailable === true
        || e.conflictRecordUnavailable === true
        || c.conflictRecordUnavailable === true,
      addressVerificationRequired: enriched.addressVerificationRequired === true
        || e.addressVerificationRequired === true
        || c.addressVerificationRequired === true,
      serverIdentityReviewReason: enriched.serverIdentityReviewReason
        || e.serverIdentityReviewReason
        || c.serverIdentityReviewReason
        || null,
      contactEnrichment,
      eligibilityStatus: e.eligibilityStatus || enriched.eligibilityStatus || c.eligibilityStatus || 'unknown',
      eligibilityReason: e.eligibilityReason || enriched.eligibilityReason || c.eligibilityReason || null,
      eligibilityEvidence: e.eligibilityEvidence || enriched.eligibilityEvidence || c.eligibilityEvidence || null,
      // Institution COI re-evaluated server-side against the post-enrichment
      // affiliation (enrich-contacts). `coiRecomputed` distinguishes "ran and
      // found none" (override the discover value) from "didn't run" (keep it).
      // (Codex P2#1.)
      hasInstitutionCOI: e.coiRecomputed ? !!e.hasInstitutionCOI : c.hasInstitutionCOI,
      institutionCOIDetails: sanitizeInstitutionCOIDetails(e.coiRecomputed ? e.institutionCOIDetails : c.institutionCOIDetails),
      email: e.email || c.email,
      // Defensive: a document-file URL (e.g. a paper PDF) must never ride through
      // the merge as a website. Sanitized at ingestion already; re-guarded here.
      website: ContactParser.sanitizeWebsiteForCandidate(e.website || c.website, c.name),
      facultyPageUrl: e.facultyPageUrl || c.facultyPageUrl,
      department: e.department || c.department,
      orcid: e.orcid || e.orcidId || c.orcid,
      orcidUrl: e.orcidUrl || c.orcidUrl,
      googleScholarId: e.googleScholarId || c.googleScholarId,
      googleScholarUrl: e.googleScholarUrl || c.googleScholarUrl,
      // Bibliometrics: prefer enrichment, but `?? c` so a real 0 isn't dropped.
      hIndex: e.hIndex ?? c.hIndex,
      i10Index: e.i10Index ?? c.i10Index,
      totalCitations: e.totalCitations ?? c.totalCitations,
      // Affiliation-evidence pin (S224 #16): enrichment may have replaced the
      // discovery affiliation with identity-trusted ORCID-current or OpenAlex-
      // last-known evidence. Promote it + its provenance so the card labels the source and the
      // client re-rank scores the same affiliation the server persisted.
      affiliation: e.affiliation || c.affiliation,
      affiliationSource: e.affiliationSource || c.affiliationSource,
      // Recency rank input: enrichment carries the discovery value through so the
      // client re-rank matches the server (`?? c` so a real 0 isn't dropped).
      publicationCount5yr: e.publicationCount5yr ?? c.publicationCount5yr,
    };
  });
}

/**
 * Render a 0–1 or 0–100 score as an integer percentage, or null if absent.
 * Discovery returns relevanceScore as 0–100 and verificationConfidence as 0–1.
 */
export function asPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

/**
 * Normalize a reviewer name for exclusion / dedup matching. Re-exported from the
 * shared CJS util (`lib/utils/reviewer-name-match`) so the client, the
 * `/discover` server dedup, and the roster store all use ONE implementation.
 */
export const normalizeReviewerName = _normalizeReviewerName;

/** Parse a comma/newline-separated exclude textbox into a clean name list. */
export function parseExcludeList(text) {
  if (!text) return [];
  return String(text)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseReferredSeeds(text, referredBy = '') {
  return _parseReferredSeeds(text, referredBy);
}

/**
 * Referral-preserving collision merge (S320 pre-merge fix). When a seeded
 * externally-referred reviewer and a candidate discovery independently finds
 * normalize to the SAME name, `dedupeByName` keeps the first occurrence — which is
 * relevance-order, NOT provenance. Without this, if the discovery copy outranks the
 * seed the survivor loses its `referred` provenance (Externally-Referred badge +
 * `referredBy`). This grafts the referral labeling onto the kept survivor so the
 * badge/referrer survive regardless of ranking order.
 *
 * Deliberately conservative:
 * - Only fires when the DROPPED copy is `referred` and the kept one is a plain
 *   discovery/literature kind. It never touches `applicant_suggested` survivors
 *   (that lane has its own promote-by-suggestionId save path), and is a no-op when
 *   the survivor is already `referred`.
 * - Grafts ONLY provenance/label fields (`referred` source, `referredBy`, and the
 *   durable `Referred by …` match-reason prefix that `my-candidates` reload parses).
 *   It does NOT copy contact/identity/bibliometrics across copies, so the
 *   unresolved/name-only referred-seed contact-null safety is preserved — the
 *   survivor keeps its own resolution status.
 */
export function mergeReferredProvenance(keep, incoming) {
  if (!keep || !incoming) return keep;
  const keepKind = provenanceKindOf(keep);
  const incomingReferred = provenanceKindOf(incoming) === PROVENANCE_KINDS.REFERRED;
  const keepReferred = keepKind === PROVENANCE_KINDS.REFERRED;
  const keepApplicant = keepKind === PROVENANCE_KINDS.APPLICANT_SUGGESTED;
  if (!incomingReferred || keepReferred || keepApplicant) return keep;

  const referredBy = incoming.referredBy
    || incoming.provenance?.referredBy
    || keep.referredBy
    || null;
  const sources = Array.from(new Set([
    ...(Array.isArray(keep.sources) ? keep.sources : []),
    'referred',
  ]));
  let reasoning = keep.reasoning || keep.generatedReasoning || '';
  // Durable-string contract: my-candidates reload reconstructs `referredBy` from the
  // leading "Referred by {name}." line in wmkf_matchreason. Prepend it (once) so a
  // grafted survivor round-trips the referrer, matching a native referred seed.
  if (referredBy && !/^Referred by /i.test(reasoning)) {
    reasoning = formatReferredByReason(referredBy, reasoning);
  }
  const upgraded = {
    ...keep,
    sources,
    reasoning,
    referredBy: referredBy || null,
    isReferredSeed: true,
  };
  // force past buildReviewerProvenance's pre-built-provenance short-circuit so the
  // kind is re-derived to `referred` (keep already carries a literature provenance).
  upgraded.provenance = buildReviewerProvenance(upgraded, {
    force: true,
    kind: PROVENANCE_KINDS.REFERRED,
    referredBy,
  });
  return upgraded;
}

/**
 * Dedupe candidates by a name key, first-occurrence wins, but on a collision graft
 * referral provenance onto the survivor via {@link mergeReferredProvenance}. Shared
 * by the panel's `dedupeByName` so the visible + savable list can never drop a
 * seeded referral's Externally-Referred badge when discovery also finds the person.
 */
export function dedupeByNamePreferReferred(list, keyFn) {
  const posByKey = new Map();
  const out = [];
  for (const c of (Array.isArray(list) ? list : [])) {
    const k = keyFn(c);
    if (!k) continue;
    if (posByKey.has(k)) {
      const pos = posByKey.get(k);
      out[pos] = mergeReferredProvenance(out[pos], c);
      continue;
    }
    posByKey.set(k, out.length);
    out.push(c);
  }
  return out;
}

function exactReviewerIdentityKey(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  // Applicant suggestions retain their own lifecycle lane even after they point
  // at the same person as a search result. Promotion-by-suggestionId has distinct
  // durable semantics; this helper only collapses aliases within a lane.
  const lane = candidate.isApplicantRecommended
    || provenanceKindOf(candidate) === PROVENANCE_KINDS.APPLICANT_SUGGESTED
    ? 'applicant'
    : 'search';
  const personId = candidate.potentialReviewerId
    || candidate.seedResolvedPotentialReviewerId
    || candidate.applicantKnownReviewer?.potentialReviewerId;
  if (typeof personId === 'string' && personId.trim()) {
    return `${lane}:person:${personId.trim().toLowerCase()}`;
  }
  const rawOrcid = candidate.orcid
    || candidate.contactEnrichment?.orcidId
    || candidate.contactEnrichment?.orcid
    || candidate.applicantKnownReviewer?.orcid;
  const orcid = normalizeOrcid(rawOrcid);
  return orcid.state === 'valid' ? `${lane}:orcid:${orcid.id}` : null;
}

function exactAddressReceiptMatches(candidate) {
  const receipt = candidate?.addressTrustReceipt;
  const email = String(candidate?.email || candidate?.contactEnrichment?.email || '')
    .trim()
    .toLowerCase();
  return receipt?.personConfirmed === true
    && !!receipt?.receiptId
    && !!email
    && String(receipt.email || '').trim().toLowerCase() === email;
}

function candidateAuthorityScore(candidate) {
  let score = 0;
  if (candidate?.pdIdentityConfirmed === true && candidate?.pdIdentityConfirmationId) score += 100;
  if (exactAddressReceiptMatches(candidate)) score += 50;
  if (candidate?.serverIdentityDecisionReceipt?.source === 'automated_resolver') score += 20;
  const emailSource = candidate?.emailSource || candidate?.contactEnrichment?.emailSource;
  if (emailSource === 'manual' || emailSource === 'staff_verified') score += 10;
  if (candidate?.contactEnrichment?.dataverseContactEvidence?.status === 'known') score += 5;
  return score;
}

/**
 * Collapse only proven identity aliases (exact person id or checksum-valid ORCID).
 * Distinct correlation keys remain distinct when no exact anchor exists, so
 * same-name people are never merged. On an alias collision the strongest
 * server/staff contact authority wins, while referral provenance is retained.
 */
export function dedupeReviewerCandidates(list) {
  const posByKey = new Map();
  const out = [];
  for (const candidate of (Array.isArray(list) ? list : [])) {
    const key = exactReviewerIdentityKey(candidate)
      || `candidate:${reviewerCandidateKey(candidate) || ''}`;
    if (!key || key === 'candidate:') continue;
    if (!posByKey.has(key)) {
      posByKey.set(key, out.length);
      out.push(candidate);
      continue;
    }
    const pos = posByKey.get(key);
    const current = out[pos];
    const incomingWins = candidateAuthorityScore(candidate) > candidateAuthorityScore(current);
    const preferred = incomingWins ? candidate : current;
    const other = incomingWins ? current : candidate;
    out[pos] = mergeReferredProvenance(preferred, other);
  }
  return out;
}

/**
 * Drop any candidate whose name normalizes to an excluded name. Exact (not fuzzy)
 * normalized match so it never over-filters. This is what makes the panel's
 * "applicant-excluded names are blocked from the results" claim TRUE — /discover
 * searches databases independently of the Claude soft-block, so excluded people
 * must be filtered client-side too (Codex S210, Finding 3).
 *
 * @returns {{ kept: object[], removed: object[] }}
 */
export function filterExcluded(candidates, excludedNames) {
  return partitionByExcluded(candidates, excludedNames, (c) => c && c.name);
}

export function applicantTerminalSuggestionKeys(rosterExcluded, savedKeys) {
  const terminal = new Set();
  for (const candidate of Array.isArray(rosterExcluded) ? rosterExcluded : []) {
    const canonicalKey = reviewerSuggestionCandidateKey(candidate?.suggestionId);
    if (canonicalKey && candidate?.candidateKey === canonicalKey) terminal.add(canonicalKey);
  }
  for (const key of Array.isArray(savedKeys) ? savedKeys : []) {
    if (typeof key !== 'string' || !key.startsWith('suggestion:')) continue;
    const canonicalKey = reviewerSuggestionCandidateKey(key.slice('suggestion:'.length));
    if (canonicalKey === key) terminal.add(key);
  }
  return terminal;
}

export function hasValidApplicantEnrichmentCache(
  rosterActive,
  proposalKey,
  expectedRecommendations,
  terminalSuggestionKeys = [],
) {
  if (!proposalKey || !Array.isArray(expectedRecommendations) || expectedRecommendations.length === 0) {
    return false;
  }
  const expectedKeys = new Set(expectedRecommendations
    .map((candidate) => reviewerSuggestionCandidateKey(candidate?.suggestionId))
    .filter(Boolean));
  if (expectedKeys.size !== expectedRecommendations.length) return false;

  for (const key of terminalSuggestionKeys || []) {
    if (expectedKeys.has(key)) expectedKeys.delete(key);
  }
  if (expectedKeys.size === 0) return true;

  const canonicalRowsByKey = new Map();
  const stage2PresentationRequired = isInstitutionStage2PresentationEnabled();
  for (const candidate of Array.isArray(rosterActive) ? rosterActive : []) {
    const canonicalKey = reviewerSuggestionCandidateKey(candidate?.suggestionId);
    if (
      canonicalKey
      && expectedKeys.has(canonicalKey)
      && candidate?.candidateKey === canonicalKey
      && candidate?.enrichedProposalKey === proposalKey
      && candidate?.applicantEnrichmentCacheVersion === APPLICANT_ENRICHMENT_CACHE_VERSION
      && (!stage2PresentationRequired
        || candidate?.eligibilityStatus === 'deceased'
        || candidate?.institutionPresentation?.version === INSTITUTION_STAGE2_PRESENTATION_VERSION)
      && candidate?.applicantKnownReviewer
      && candidate.applicantKnownReviewer.status !== 'unavailable'
      && (candidate.isApplicantRecommended || provenanceKindOf(candidate) === PROVENANCE_KINDS.APPLICANT_SUGGESTED)
    ) {
      canonicalRowsByKey.set(canonicalKey, candidate);
    }
  }
  if (canonicalRowsByKey.size !== expectedKeys.size) return false;

  // Applicant enrichment now fails closed unless every non-deceased row has an
  // explicit identity-gate result. Only the exact canonical suggestion rows for
  // the current recommendation set count: legacy candidate keys cannot poison a
  // newly written cache, and a partial roster write cannot masquerade as a
  // complete batch.
  return Array.from(canonicalRowsByKey.values()).every((c) => (
    c?.eligibilityStatus === 'deceased'
      || c?.pdIdentityConfirmed === true
      || c?.identityStatus === 'confirmed'
      || c?.identityStatus === 'probable'
      || c?.identityStatus === 'unresolved'
  ));
}
