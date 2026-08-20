/**
 * Pure helpers for the in-panel reviewer search (Workbench Find).
 * Kept separate from the React component so they can be unit-tested.
 */

// Name normalization + exact-exclusion live in the CJS util so the server
// (/discover dedup, reviewer-roster-store) and this client module share ONE
// implementation. Re-exported below so existing client imports keep working.
import { normalizeReviewerName as _normalizeReviewerName, partitionByExcluded } from '../../../lib/utils/reviewer-name-match';
import { mayPersistIdentity } from '../../../lib/services/reviewer-identity-resolver';
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

// Increment when applicant-recommended enrichment semantics change in a way
// that requires existing roster JSON to be recomputed. Unversioned legacy rows
// deliberately miss the cache once and are stamped by the enrichment service.
// v4 (S400): verdict copy overhaul — version-3 rows carry the pre-fix vague
// "contradict the listed institution" reasoning (or a stale mismatch flag the
// success path now reconciles) and must re-enrich rather than replay it.
export const APPLICANT_ENRICHMENT_CACHE_VERSION = 4;

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
    label: 'Suggested because:',
    remedyId: null,
  }),
  identity_review: Object.freeze({
    label: 'Why this needs review:',
    remedyId: 'confirm_identity',
  }),
  record_repair: Object.freeze({
    label: 'Why this needs repair:',
    remedyId: 'create_repair_request',
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
  const kind = decision === 'needs_record_repair'
    ? 'record_repair'
    : (explicitServerIdentityReview || unresolvedIdentity
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
  if (
    receipt?.personConfirmed === true
    && typeof receipt.email === 'string'
    && receipt.email.trim().toLowerCase() === String(email).trim().toLowerCase()
  ) {
    return {
      level: 'high',
      action: 'ready',
      reason: 'Staff verified this exact person and address for promotion',
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

function pruneInstitutionPresentation(value) {
  if (!value || value.version !== INSTITUTION_STAGE2_PRESENTATION_VERSION) return null;
  const bounded = (text, max = 500) => (
    typeof text === 'string' ? text.trim().slice(0, max) || null : null
  );
  const allowedKinds = new Set([
    'compatible',
    'additional',
    'current_conflict',
    'historical',
    'provider_failure',
    'unresolved',
  ]);
  const allowedTones = new Set(['neutral', 'warning']);
  const allowedRemedies = new Set([
    'confirm_identity',
    'correct_current_institution',
    'record_joint_appointment',
    'not_a_fit',
    'retry_enrichment',
    'add_authoritative_evidence',
    'operator_review',
  ]);
  return {
    version: INSTITUTION_STAGE2_PRESENTATION_VERSION,
    visible: value.visible === true,
    kind: allowedKinds.has(value.kind) ? value.kind : 'unresolved',
    tone: allowedTones.has(value.tone) ? value.tone : 'neutral',
    heading: bounded(value.heading, 120),
    detail: bounded(value.detail),
    relationship: bounded(value.relationship, 40) || 'unresolved',
    evidenceContext: bounded(value.evidenceContext, 80) || 'unresolved',
    evidenceInstitution: bounded(value.evidenceInstitution, 180),
    recordedInstitution: bounded(value.recordedInstitution, 180),
    remedies: [...new Set((Array.isArray(value.remedies) ? value.remedies : [])
      .filter((remedy) => allowedRemedies.has(remedy)))],
    legacyHold: value.legacyHold === true,
  };
}

/**
 * Slice 5: compact, bounded `contactLeads` for durable roster storage. Keeps only
 * the fields the card renders (ContactLeads); drops `warnings` (re-derived in the
 * UI) and `evidence` (unused in display today), and caps count + string lengths so
 * a roster row stays small and never carries raw provider payloads (spec §7).
 * `persistable:false` is re-asserted so a roster round-trip can never flip it.
 */
export const MAX_ROSTER_CONTACT_LEADS = 8;
export const MAX_ROSTER_IDENTITY_ANCHORS = 20;
export function pruneContactLeads(leads) {
  if (!Array.isArray(leads)) return [];
  return leads
    .slice(0, MAX_ROSTER_CONTACT_LEADS)
    .map((l) => ({
      type: l && l.type ? String(l.type) : null,
      value: l && typeof l.value === 'string' ? l.value.slice(0, 320) : null,
      sourceUrl: l && typeof l.sourceUrl === 'string' ? l.sourceUrl.slice(0, 500) : null,
      source: l && l.source ? String(l.source) : null,
      confidence: l && l.confidence ? String(l.confidence) : null,
      rejectedReason: l && l.rejectedReason ? String(l.rejectedReason) : null,
      persistable: false,
    }))
    .filter((l) => l.value);
}

export function pruneEmailEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const publications = Array.isArray(evidence.publications)
    ? evidence.publications.slice(0, 5).map((publication) => ({
        pmid: publication?.pmid ? String(publication.pmid).slice(0, 32) : null,
        pmcid: publication?.pmcid ? String(publication.pmcid).slice(0, 32) : null,
        doi: publication?.doi ? String(publication.doi).slice(0, 160) : null,
        title: publication?.title ? String(publication.title).slice(0, 500) : null,
        year: Number.isFinite(publication?.year) ? publication.year : null,
        url: publication?.url ? String(publication.url).slice(0, 500) : null,
        providers: Array.isArray(publication?.providers)
          ? publication.providers.slice(0, 3).map(String)
          : [],
      }))
    : [];
  const alternatives = Array.isArray(evidence.alternatives)
    ? evidence.alternatives
        .slice(0, 8)
        .map((alternative) => ({
          email: alternative?.email ? String(alternative.email).slice(0, 320) : null,
          matchClass: alternative?.matchClass ? String(alternative.matchClass).slice(0, 80) : null,
        }))
        .filter((alternative) => alternative.email)
    : [];
  return {
    sourceKind: evidence.sourceKind ? String(evidence.sourceKind).slice(0, 80) : null,
    sourceUrl: evidence.sourceUrl ? String(evidence.sourceUrl).slice(0, 500) : null,
    action: evidence.action ? String(evidence.action).slice(0, 40) : null,
    ownership: evidence.ownership ? String(evidence.ownership).slice(0, 80) : null,
    ownershipProof: evidence.ownershipProof ? String(evidence.ownershipProof).slice(0, 100) : null,
    matchClass: evidence.matchClass ? String(evidence.matchClass).slice(0, 80) : null,
    alternatives,
    affiliationMatched: evidence.affiliationMatched === true,
    publicationCount: Number.isFinite(evidence.publicationCount) ? evidence.publicationCount : publications.length,
    providers: Array.isArray(evidence.providers) ? evidence.providers.slice(0, 3).map(String) : [],
    publications,
    deliverabilityChecked: evidence.deliverabilityChecked === true,
  };
}

export function pruneIdentityDecision(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  return {
    status: identity.status || null,
    confidenceBand: identity.confidenceBand || null,
    resolverVersion: identity.resolverVersion || null,
    resolvedAt: identity.resolvedAt || null,
    evidenceSummary: identity.evidenceSummary || null,
    anchors: Array.isArray(identity.anchors)
      ? identity.anchors.slice(0, MAX_ROSTER_IDENTITY_ANCHORS).map((anchor) => ({
          type: anchor?.type || null,
          canonicalKey: anchor?.canonicalKey || null,
          sourceUrl: anchor?.sourceUrl || null,
          verifier: anchor?.verifier || null,
        }))
      : null,
  };
}

export function pruneEligibilityEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  return {
    status: evidence.status === 'deceased' || evidence.status === 'emeritus'
      ? evidence.status
      : null,
    url: typeof evidence.url === 'string' ? evidence.url.slice(0, 500) : null,
    title: typeof evidence.title === 'string' ? evidence.title.slice(0, 500) : null,
    snippet: typeof evidence.snippet === 'string' ? evidence.snippet.slice(0, 800) : null,
    sourceDomain: typeof evidence.sourceDomain === 'string' ? evidence.sourceDomain.slice(0, 255) : null,
    checkedAt: typeof evidence.checkedAt === 'string' ? evidence.checkedAt.slice(0, 80) : null,
  };
}

export function pruneDataverseContactEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const statuses = new Set(['known', 'review_required', 'none', 'unavailable']);
  const reasons = new Set([
    'provisional_orcid_match',
    'ambiguous_or_name_mismatch',
    'orcid_email_split',
    'contact_linked_elsewhere',
    'email_mismatch',
    'identity_conflict',
    'lookup_unavailable',
    'partial_enrichment',
    'deadline_exceeded',
  ]);
  const institutionSources = new Set(['staff_confirmed', 'primary_affiliation', 'organization']);
  const recordKinds = Array.isArray(evidence.recordKinds)
    ? Array.from(new Set(evidence.recordKinds.filter((kind) => kind === 'contact' || kind === 'potential_reviewer'))).slice(0, 2)
    : [];
  const institutions = Array.isArray(evidence.institutions)
    ? evidence.institutions.slice(0, 8).flatMap((entry) => {
        const value = boundedText(entry?.value, 500);
        const source = institutionSources.has(entry?.source) ? entry.source : null;
        return value && source ? [{ value, source }] : [];
      })
    : [];
  return {
    status: statuses.has(evidence.status) ? evidence.status : 'unavailable',
    matchKey: evidence.matchKey === 'email' || evidence.matchKey === 'orcid' ? evidence.matchKey : null,
    recordKinds,
    nameConsistent: evidence.nameConsistent === true ? true : evidence.nameConsistent === false ? false : null,
    institutions,
    reason: reasons.has(evidence.reason) ? evidence.reason : null,
    checkedAt: boundedText(evidence.checkedAt, 80),
  };
}

function pruneCoauthorCheckFailures(failures) {
  if (!Array.isArray(failures)) return [];
  return failures.slice(0, 12).map((failure) => ({
    proposalAuthor: typeof failure?.proposalAuthor === 'string'
      ? failure.proposalAuthor.slice(0, 200)
      : null,
    status: Number.isFinite(failure?.status) ? failure.status : null,
    reason: failure?.reason === 'rate_limited' ? 'rate_limited' : 'unavailable',
  }));
}

function pruneManualContactFields(fields) {
  const allowed = new Set(['email', 'website', 'affiliation', 'hIndex']);
  return Array.isArray(fields)
    ? Array.from(new Set(fields.filter((field) => allowed.has(field)))).slice(0, 4)
    : [];
}

function boundedText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : null;
}

function pruneStaffIdentityConfirmation(confirmation) {
  if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) return null;
  const confirmationId = boundedText(confirmation.confirmationId, 100);
  if (!confirmationId || confirmation.source !== 'staff_confirmed') return null;
  return {
    confirmationId,
    source: 'staff_confirmed',
    normalizedName: boundedText(confirmation.normalizedName, 300),
    email: boundedText(confirmation.email, 320),
    website: boundedText(confirmation.website, 500),
    affiliation: boundedText(confirmation.affiliation, 500),
    actorProfileId: typeof confirmation.actorProfileId === 'number'
      ? confirmation.actorProfileId
      : boundedText(confirmation.actorProfileId, 100),
    actorSystemUserId: boundedText(confirmation.actorSystemUserId, 100),
    confirmedAt: boundedText(confirmation.confirmedAt, 80),
  };
}

/**
 * Prune an enriched candidate down to the fields `CandidateCard` actually
 * renders, for durable storage in `reviewer_find_roster` (S224). Keeps the card
 * fully renderable after reload while dropping heavy raw enrichment internals.
 * The compact, server-attested identity decision is retained so W4.1 evidence
 * can reach the save boundary after a reload; raw tierResults remain excluded.
 * The SINGLE source for the roster DTO shape so the server store + client merge
 * agree.
 */
export function pruneCandidateForRoster(c) {
  if (!c || typeof c !== 'object') return c;
  const e = c.contactEnrichment || {};
  const provenance = buildReviewerProvenance(c);
  const persistFlag = (name) => {
    if (c[name] === false || e[name] === false) return false;
    if (c[name] === true || e[name] === true) return true;
    return undefined;
  };
  const currentOrcidAffiliation = Array.isArray(e.tierResults?.orcid?.affiliations)
    ? e.tierResults.orcid.affiliations.find((aff) => aff?.current === true)
    : null;
  const currentOrcidInstitutionRor = currentOrcidAffiliation
    && String(currentOrcidAffiliation.disambiguationSource || '').toUpperCase() === 'ROR'
    ? currentOrcidAffiliation.disambiguatedOrganizationId || null
    : null;
  // Capture the identity-resolver verdict NOW (before it's dropped) as safe
  // boolean persist-permission flags, so a candidate saved AFTER a roster reload
  // (when contactEnrichment.identity / tierResults are gone) still honors the
  // resolver gate (Codex post-impl HIGH). Mirror save-candidates' block logic:
  //   blockByIdentity = identity present AND verdict < probable
  //   blockScholar    = blockByIdentity OR the Scholar profile was name/inst-skipped
  const identity = e.identity || null;
  const scholarSkipped = !!e.tierResults?.openalex_author?.skipped;
  const identityPersistAllowed = !identity || mayPersistIdentity(identity.status);
  const scholarPersistAllowed = identityPersistAllowed && !scholarSkipped;
  return {
    // Render-safe persist flags consumed by save-candidates for roster-reloaded rows.
    identityPersistAllowed,
    scholarPersistAllowed,
    emailPersistAllowed: persistFlag('emailPersistAllowed'),
    websitePersistAllowed: persistFlag('websitePersistAllowed'),
    affiliationPersistAllowed: persistFlag('affiliationPersistAllowed'),
    // A render-safe contactEnrichment SUBSET so CandidateCard's `enr.*` reads
    // (emailSource/emailYear/priorAffiliation/affiliationSource/links/metrics)
    // still work after reload. NEVER raw tierResults; identity is reduced to
    // the exact fields covered by the server receipt and persistence writer.
    contactEnrichment: {
      identity: pruneIdentityDecision(identity),
      email: e.email || null,
      emailSource: e.emailSource || null,
      emailYear: e.emailYear || null,
      emailAction: e.emailAction || null,
      emailActionReason: e.emailActionReason || null,
      emailEvidence: pruneEmailEvidence(e.emailEvidence),
      contactStatus: e.contactStatus || null,
      contactStatusReason: e.contactStatusReason || null,
      verifiedInstitutionDomain: e.verifiedInstitutionDomain || null,
      anchoredInstitutionDomains: Array.isArray(e.anchoredInstitutionDomains) ? e.anchoredInstitutionDomains.slice(0, 8) : [],
      plausibleInstitutionDomains: Array.isArray(e.plausibleInstitutionDomains) ? e.plausibleInstitutionDomains.slice(0, 12) : [],
      website: ContactParser.sanitizeWebsiteForCandidate(e.website, c.name) || null,
      websiteSource: e.websiteSource === 'manual' ? 'manual' : (e.websiteSource || null),
      orcid: e.orcid || e.orcidId || null,
      orcidId: e.orcidId || null,
      orcidUrl: e.orcidUrl || null,
      googleScholarUrl: e.googleScholarUrl || null,
      googleScholarId: e.googleScholarId || null,
      affiliationSource: e.affiliationSource || null,
      openAlexInstitutionId: e.openAlexInstitutionId || null,
      openAlexInstitutionRor: e.openAlexInstitutionRor || null,
      orcidInstitutionRor: e.orcidInstitutionRor || currentOrcidInstitutionRor || null,
      priorAffiliation: e.priorAffiliation || null,
      hIndex: e.hIndex ?? null,
      totalCitations: e.totalCitations ?? null,
      emailPersistAllowed: persistFlag('emailPersistAllowed'),
      websitePersistAllowed: persistFlag('websitePersistAllowed'),
      affiliationPersistAllowed: persistFlag('affiliationPersistAllowed'),
      // Slice 5: compact quarantined leads so the ContactLeads section survives a
      // roster reload. Bounded + stripped of raw payloads; persistable stays false.
      contactLeads: pruneContactLeads(e.contactLeads),
      eligibilityStatus: e.eligibilityStatus || c.eligibilityStatus || 'unknown',
      eligibilityReason: e.eligibilityReason || c.eligibilityReason || null,
      eligibilityEvidence: pruneEligibilityEvidence(e.eligibilityEvidence || c.eligibilityEvidence),
      dataverseContactEvidence: pruneDataverseContactEvidence(e.dataverseContactEvidence),
    },
    name: c.name,
    affiliation: c.affiliation || null,
    affiliationSource: c.affiliationSource || e.affiliationSource || null,
    seniorityEstimate: c.seniorityEstimate || null,
    verificationConfidence: typeof c.verificationConfidence === 'number' ? c.verificationConfidence : null,
    // Identity-review markers (Slice E): provenanceGroupOf keys on these to route a
    // candidate to the non-selectable `needs_identity_review` group. They MUST survive
    // a roster reload — otherwise a deferred/unresolved candidate recorded as
    // surfaced-active loses its marker and becomes silently selectable again on reload
    // (the gate would only hold for the live run). Persist all three the group test reads.
    identityStatus: c.identityStatus || e.identity?.status || null,
    eligibilityStatus: c.eligibilityStatus || e.eligibilityStatus || 'unknown',
    eligibilityReason: c.eligibilityReason || e.eligibilityReason || null,
    eligibilityEvidence: pruneEligibilityEvidence(c.eligibilityEvidence || e.eligibilityEvidence),
    needsIdentification: !!c.needsIdentification,
    verificationStatus: c.verificationStatus || null,
    // Source / provenance flags the card branches on.
    isClaudeSuggestion: !!c.isClaudeSuggestion,
    source: c.source || null,
    sources: Array.isArray(c.sources) ? c.sources : [],
    provenance,
    isReferredSeed: !!c.isReferredSeed,
    referredBy: c.referredBy || c.provenance?.referredBy || null,
    seedResolvedPotentialReviewerId: c.seedResolvedPotentialReviewerId || null,
    seedResolvedContactId: c.seedResolvedContactId || null,
    seedIdentityMatchKey: c.seedIdentityMatchKey || null,
    seedIdentityNameConsistent: c.seedIdentityNameConsistent === false ? false : (c.seedIdentityNameConsistent === true ? true : null),
    isApplicantRecommended: !!c.isApplicantRecommended,
    applicantKnownReviewer: pruneApplicantKnownReviewer(c.applicantKnownReviewer),
    applicantContactMismatch: c.applicantContactMismatch === true,
    serverRepairReason: typeof c.serverRepairReason === 'string'
      ? c.serverRepairReason.slice(0, 100)
      : null,
    enrichedProposalKey: c.enrichedProposalKey || null,
    applicantEnrichmentCacheVersion: Number.isInteger(c.applicantEnrichmentCacheVersion)
      ? c.applicantEnrichmentCacheVersion
      : null,
    suggestionId: c.suggestionId || null,
    // COI + mismatch detail.
    hasInstitutionCOI: !!c.hasInstitutionCOI,
    institutionCOIDetails: sanitizeInstitutionCOIDetails(c.institutionCOIDetails),
    hasCoauthorCOI: !!c.hasCoauthorCOI,
    coauthorships: Array.isArray(c.coauthorships) ? c.coauthorships : [],
    coauthorCheckStatus: c.coauthorCheckStatus === 'complete' || c.coauthorCheckStatus === 'incomplete'
      ? c.coauthorCheckStatus
      : null,
    coauthorCheckFailures: pruneCoauthorCheckFailures(c.coauthorCheckFailures),
    // S238 graded coauthor COI + thin-evidence/off-topic warnings — persist so the
    // card's severity and warnings survive a roster reload (else a 'possible' overlap
    // regresses to red via the UI fallback, and the warnings vanish entirely).
    coauthorCOIStrength: c.coauthorCOIStrength || null,
    coauthorSharedPaperTotal: Number.isFinite(c.coauthorSharedPaperTotal) ? c.coauthorSharedPaperTotal : null,
    coauthorMaxWithOneAuthor: Number.isFinite(c.coauthorMaxWithOneAuthor) ? c.coauthorMaxWithOneAuthor : null,
    aiFlaggedNotRelevant: !!c.aiFlaggedNotRelevant,
    lowPublicationCount: !!c.lowPublicationCount,
    lowPublicationCountFound: Number.isFinite(c.lowPublicationCountFound) ? c.lowPublicationCountFound : null,
    institutionMismatch: !!c.institutionMismatch,
    institutionPresentation: pruneInstitutionPresentation(c.institutionPresentation),
    suggestedInstitution: c.suggestedInstitution || null,
    expertiseMismatch: !!c.expertiseMismatch,
    // Verification-incoherence flag (Fix 11) drives the relevance-score −15
    // down-weight; retain it (like institutionMismatch/expertiseMismatch above) so
    // the penalty survives a roster reload + the Workbench client re-rank. Fold the
    // redundant `incoherentVerification` alias into the canonical field here.
    verificationIncoherence: !!(c.verificationIncoherence || c.incoherentVerification),
    verificationIncoherenceReasons: Array.isArray(c.verificationIncoherenceReasons) ? c.verificationIncoherenceReasons : [],
    expertiseAreas: Array.isArray(c.expertiseAreas) ? c.expertiseAreas : null,
    keywords: Array.isArray(c.keywords) ? c.keywords : null,
    reasoning: c.reasoning || c.generatedReasoning || null,
    // Plain-language identity-spine note (confirmed/probable/needs-review + why);
    // persisted so it survives a roster reload like `reasoning`.
    identityNote: c.identityNote || null,
    // Contact + bibliometrics (prefer the merged top-level, fall back to enrichment).
    email: c.email || e.email || null,
    emailSource: c.isApplicantRecommended
      ? (c.emailSource || e.emailSource || null)
      : (e.emailSource || null),
    emailYear: e.emailYear || null,
    emailAction: e.emailAction || null,
    emailActionReason: e.emailActionReason || null,
    // Defensive: re-guard the persisted website so a document-file URL can't ride
    // through the prune (mirrors mergeEnrichment; sanitized at ingestion too).
    website: ContactParser.sanitizeWebsiteForCandidate(c.website || e.website, c.name) || null,
    orcid: c.orcid || e.orcid || e.orcidId || null,
    orcidUrl: c.orcidUrl || e.orcidUrl || null,
    googleScholarUrl: c.googleScholarUrl || e.googleScholarUrl || null,
    googleScholarId: c.googleScholarId || e.googleScholarId || null,
    priorAffiliation: e.priorAffiliation || null,
    hIndex: c.hIndex ?? e.hIndex ?? null,
    i10Index: c.i10Index ?? e.i10Index ?? null,
    totalCitations: c.totalCitations ?? e.totalCitations ?? null,
    publicationCount5yr: Number.isFinite(c.publicationCount5yr) ? c.publicationCount5yr : (e.publicationCount5yr ?? null),
    publications: Array.isArray(c.publications)
      ? c.publications.slice(0, 10).map((p) => ({ title: p && p.title, year: p && p.year, url: p && p.url }))
      : [],
    relevanceScore: typeof c.relevanceScore === 'number' ? c.relevanceScore : null,
    automatedIdentityAttestation: typeof c.automatedIdentityAttestation === 'string'
      && c.automatedIdentityAttestation.length <= 4096
      ? c.automatedIdentityAttestation
      : null,
    candidateKey: reviewerCandidateKey(c),
    manualContactFields: pruneManualContactFields(c.manualContactFields),
    // UI convenience only. Save-candidates derives authority by looking up the
    // opaque confirmation id in the request-scoped server roster.
    pdIdentityConfirmed: c.pdIdentityConfirmed === true,
    pdIdentityConfirmationId: typeof c.pdIdentityConfirmationId === 'string'
      ? c.pdIdentityConfirmationId
      : null,
    staffIdentityConfirmation: pruneStaffIdentityConfirmation(c.staffIdentityConfirmation),
    addressConflictPending: c.addressConflictPending === true || e.addressConflictPending === true,
    conflictRecordUnavailable: c.conflictRecordUnavailable === true || e.conflictRecordUnavailable === true,
    addressVerificationRequired: c.addressVerificationRequired === true || e.addressVerificationRequired === true,
    serverIdentityReviewReason: c.serverIdentityReviewReason || e.serverIdentityReviewReason || null,
  };
}
