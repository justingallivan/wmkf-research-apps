/**
 * Pure, read-only classifier for historical reviewer promotions whose selected
 * suggestion points to an email-empty person. It never decides identity from a
 * name: an exact-email counterpart becomes class D only when the caller supplies
 * independent same-person evidence and an unblocked reviewer-merge plan.
 *
 * The returned manifest shape deliberately excludes email values. It keeps only
 * source/gate state and opaque record IDs/ETags so artifacts are useful for drift
 * review without becoming another store of reviewer contact data.
 */

import { createHash } from 'node:crypto';

const ACTIONS = Object.freeze({
  D: 'human_reviewed_reviewer_merge',
  C: 'product_confirmation_then_promotion',
  U: 'staff_identity_review',
  E: 'manual_case_specific_remediation',
  N: 'report_only',
});

function compact(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeOrcid(value) {
  const match = String(value || '').toUpperCase().match(/\d{4}-\d{4}-\d{4}-[\dX]{4}/);
  return match ? match[0] : null;
}

export function hasReceiptBoundOrcidMatch({
  candidateOrcid,
  ownerOrcid,
  attestation,
} = {}) {
  const normalizedCandidate = normalizeOrcid(candidateOrcid);
  const normalizedOwner = normalizeOrcid(ownerOrcid);
  return attestation?.valid === true
    && attestation?.identityDecisionBound === true
    && Boolean(normalizedCandidate)
    && normalizedCandidate === normalizedOwner;
}

export function summarizeReviewerMergePlan(plan) {
  const referenceScanComplete = Boolean(
    plan
    && plan.keeper
    && plan.loser
    && Array.isArray(plan.repoint)
    && Array.isArray(plan.collisions)
    && Array.isArray(plan.slotRepoints),
  );
  const etagComplete = Boolean(
    referenceScanComplete
    && plan.keeper.etag
    && plan.loser.etag
    && plan.repoint.every((entry) => entry?.etag)
    && plan.collisions.every((entry) => entry?.etag)
    && plan.slotRepoints.every((entry) => entry?.etag),
  );
  const representedReferenceReasons = new Set(['loser_has_contact', 'loser_engaged']);
  const otherReferenceCount = Array.isArray(plan?.reasons)
    ? plan.reasons.filter((reason) => (
        reason?.code && !representedReferenceReasons.has(reason.code)
      )).length
    : 0;
  return {
    blocked: plan?.blocked !== false,
    etagComplete,
    referenceScanComplete,
    otherReferenceCount,
  };
}

function redactedOwner(owner) {
  return {
    personId: compact(owner?.personId || owner?.wmkf_potentialreviewersid),
    etag: compact(owner?.etag || owner?._etag),
    statecode: owner?.statecode ?? null,
  };
}

function referenceSummary(references = {}) {
  return {
    suggestionCount: Number(references.suggestionCount) || 0,
    engagedSuggestionCount: Number(references.engagedSuggestionCount) || 0,
    contactLinked: references.contactLinked === true,
    applicantSlotCount: Number(references.applicantSlotCount) || 0,
    otherReferenceCount: Number(references.otherReferenceCount) || 0,
    scanComplete: references.scanComplete === true,
  };
}

function unsafeReferences(summary) {
  return !summary.scanComplete
    || summary.engagedSuggestionCount > 0
    || summary.contactLinked
    || summary.applicantSlotCount > 0
    || summary.otherReferenceCount > 0;
}

export function classifyReviewerPromotionRepair(input = {}) {
  const suggestion = input.suggestion || {};
  const person = input.person || {};
  const projection = input.contactProjection || {};
  const references = referenceSummary(input.references);
  const owners = (Array.isArray(input.exactEmailOwners) ? input.exactEmailOwners : [])
    .filter((owner) => owner && (owner.statecode === 0 || owner.active === true));
  const personId = compact(person.personId || person.wmkf_potentialreviewersid);
  const personHasEmail = Boolean(compact(person.email || person.wmkf_emailaddress));
  const selected = suggestion.selected === true || suggestion.wmkf_selected === true;

  let classification;
  let reasons;
  if (!selected || personHasEmail) {
    classification = 'N';
    reasons = [!selected ? 'suggestion_not_selected' : 'canonical_person_has_email'];
  } else if (unsafeReferences(references)) {
    classification = 'E';
    reasons = [!references.scanComplete ? 'reference_scan_incomplete' : 'engaged_or_referenced_person'];
  } else if (projection.decision !== 'ready') {
    classification = 'U';
    reasons = [`contact_projection_${projection.decision || 'unavailable'}`];
  } else if (owners.length === 0) {
    classification = 'C';
    reasons = ['coherent_contact_no_exact_email_owner'];
  } else if (owners.length > 1) {
    classification = 'U';
    reasons = ['multiple_active_exact_email_owners'];
  } else {
    const ownerId = compact(owners[0].personId || owners[0].wmkf_potentialreviewersid);
    if (ownerId && personId && ownerId.toLowerCase() === personId.toLowerCase()) {
      classification = 'N';
      reasons = ['exact_email_owner_is_current_person'];
    } else if (
      input.independentlyConfirmedSamePerson === true
      && input.mergePlan?.blocked === false
      && input.mergePlan?.etagComplete === true
    ) {
      classification = 'D';
      reasons = ['unique_active_exact_email_owner_and_reviewable_merge'];
    } else {
      classification = 'U';
      reasons = [
        input.independentlyConfirmedSamePerson === true
          ? 'merge_plan_not_safe'
          : 'same_person_not_independently_confirmed',
      ];
    }
  }

  return {
    requestId: compact(input.requestId),
    requestNumber: compact(input.requestNumber),
    suggestionId: compact(suggestion.suggestionId || suggestion.wmkf_appreviewersuggestionid),
    suggestionEtag: compact(suggestion.etag || suggestion._etag),
    personId,
    personEtag: compact(person.etag || person._etag),
    rosterCandidateKey: compact(input.roster?.candidateKey),
    rosterUpdatedAt: compact(input.roster?.updatedAt),
    contactEvidence: {
      decision: compact(projection.decision),
      reason: compact(projection.reason),
      emailSource: compact(projection.emailSource),
      emailPersistAllowed: projection.emailPersistAllowed === true,
      websitePersistAllowed: projection.websitePersistAllowed === true,
      affiliationPersistAllowed: projection.affiliationPersistAllowed === true,
      assertedEmailPresent: Boolean(compact(projection.email)),
    },
    exactEmailOwners: owners.map(redactedOwner)
      .sort((a, b) => String(a.personId).localeCompare(String(b.personId))),
    references,
    classification,
    reasons,
    proposedAction: ACTIONS[classification],
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function buildReviewerPromotionRepairManifest(rows, metadata = {}) {
  const sortedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => canonicalize(row))
    .sort((a, b) => [
      a.requestNumber || '',
      a.requestId || '',
      a.suggestionId || '',
      a.personId || '',
    ].join('|').localeCompare([
      b.requestNumber || '',
      b.requestId || '',
      b.suggestionId || '',
      b.personId || '',
    ].join('|')));
  const body = canonicalize({
    artifactType: 'reviewer_promotion_repair_classifier_v1',
    dryRun: true,
    schemaVersion: 1,
    sourceCommit: compact(metadata.sourceCommit),
    observedAt: compact(metadata.observedAt),
    rows: sortedRows,
  });
  const manifestHash = createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex');
  return { ...body, manifestHash };
}
