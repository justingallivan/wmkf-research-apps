/**
 * Best-effort, non-authoritative Find institution measurement (migration 051).
 * Only fixed vocabulary and digests enter Postgres. Never persist candidate,
 * assertion, actor, provider, or error text. A missing insert is a coverage gap,
 * never a reason to change a reviewer decision.
 */
'use strict';

const { createHash } = require('crypto');
const { sql } = require('../postgres/client');
const { provenanceKindOf } = require('../utils/reviewer-provenance');

const EVENTS = new Set([
  'roster_upsert', 'staff_excluded', 'staff_restored',
  'staff_identity_confirmed', 'staff_contact_edited',
  'save_saved', 'save_rejected',
]);
const SOURCES = new Set(['server_applicant', 'roster_unverified', 'stored_roster']);
const RELATIONSHIPS = new Set(['same', 'parent_child', 'sibling', 'related_other', 'distinct', 'unresolved']);
const CONTEXTS = new Set([
  'compatible', 'compatible_with_additional', 'current_conflict',
  'current_related_unclear', 'historical_difference', 'historical_related',
  'difference_unknown_time', 'related_unknown_time', 'unresolved',
]);
const SOURCE_TYPES = new Set(['publication', 'orcid_employment', 'official_profile', 'applicant_record', 'staff_record', 'reviewer_self_report']);
const CURRENTNESS = new Set(['current', 'historical', 'unknown']);
const AUTHOR_SPECIFIC = new Set(['true', 'false', 'unknown']);
const SOURCE_KINDS = new Set([
  'cited_reference', 'proposal_named', 'applicant_suggested',
  'literature_retrieved', 'grounded_seed', 'barred_parametric',
]);
const OUTCOMES = new Set(['saved', 'identity_hold', 'institution_coi', 'contact_hold', 'stale_or_invalid', 'ineligible', 'other']);
const INSERT_TIMEOUT_MS = 2000;
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60000;
const breaker = { failures: 0, suspendedUntil: 0 };

function allowed(value, values) {
  return values.has(value) ? value : null;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cardSnapshotDigest(candidate) {
  return digest(JSON.stringify([
    candidate?.candidateKey || null,
    candidate?.suggestedInstitution || null,
    candidate?.affiliation || null,
    candidate?.institutionMismatch === true,
    candidate?.institutionPresentation?.version || null,
  ]));
}

function classifiedOutcome(code, saved = false) {
  if (saved) return 'saved';
  if (['identity_unresolved', 'identity_confirmation_required', 'identity_attestation_required', 'identity_unavailable', 'identity_verification_required', 'ambiguous_or_name_mismatch'].includes(code)) return 'identity_hold';
  if (code === 'institution_coi') return 'institution_coi';
  if (['missing_verified_email', 'address_conflict', 'contact_claim_mismatch', 'address_verification_required', 'conflict_record_unavailable', 'contact_verification_unavailable', 'anti_scrape_email', 'email_conflict'].includes(code)) return 'contact_hold';
  if (code === 'candidate_ineligible') return 'ineligible';
  if (['invalid_candidate', 'candidate_stale', 'candidate_excluded', 'applicant_excluded', 'person_inactive', 'reviewer_engagement_changed', 'suggestion_etag_missing', 'restore_required', 'already_handled'].includes(code)) return 'stale_or_invalid';
  return 'other';
}

function buildRow({ requestId, candidate, eventType, captureSource, assessment, legacyHold, outcomeCategory }) {
  if (!requestId || !candidate?.candidateKey || !EVENTS.has(eventType) || !SOURCES.has(captureSource)) return null;
  const trusted = captureSource === 'server_applicant';
  const evidence = trusted ? assessment?.evidenceAssertion : null;
  const recorded = trusted ? assessment?.recordedAssertion : null;
  return {
    caseKey: digest(`${requestId}\0${candidate.candidateKey}`),
    cardSnapshotDigest: cardSnapshotDigest(candidate),
    eventType,
    captureSource,
    sourceKind: allowed(provenanceKindOf(candidate), SOURCE_KINDS),
    legacyHold: trusted && typeof legacyHold === 'boolean' ? legacyHold : null,
    relationship: trusted ? allowed(assessment?.relationship, RELATIONSHIPS) : null,
    evidenceContext: trusted ? allowed(assessment?.evidenceContext, CONTEXTS) : null,
    evidenceSourceType: allowed(evidence?.sourceType, SOURCE_TYPES),
    evidenceCurrentness: allowed(evidence?.currentness, CURRENTNESS),
    evidenceAuthorSpecific: allowed(String(evidence?.authorSpecific), AUTHOR_SPECIFIC),
    recordedSourceType: allowed(recorded?.sourceType, SOURCE_TYPES),
    recordedCurrentness: allowed(recorded?.currentness, CURRENTNESS),
    additionalAffiliationCount: trusted && Array.isArray(assessment?.additionalAffiliations)
      ? Math.min(assessment.additionalAffiliations.length, 20)
      : null,
    // These are deliberately unavailable until separate, server-bound proof
    // and complete extra-affiliation COI screening exist. No auto-clear score.
    independentIdentity: 'not_evaluable',
    additionalCoi: 'not_screened',
    proposedAction: 'not_evaluable',
    outcomeCategory: allowed(outcomeCategory, OUTCOMES),
  };
}

async function recordInstitutionMeasurement(input) {
  if (!measurementEnabled()) return 'disabled';
  if (Date.now() < breaker.suspendedUntil) return 'skipped';
  try {
    const row = buildRow(input || {});
    if (!row) return 'skipped';
    const write = sql`
      INSERT INTO reviewer_institution_measurement_events
        (case_key, card_snapshot_digest, event_type, capture_source, source_kind,
         legacy_hold, relationship, evidence_context, evidence_source_type,
         evidence_currentness, evidence_author_specific, recorded_source_type,
         recorded_currentness, additional_affiliation_count,
         independent_identity, additional_coi, proposed_action, outcome_category)
      VALUES
        (${row.caseKey}, ${row.cardSnapshotDigest}, ${row.eventType}, ${row.captureSource}, ${row.sourceKind},
         ${row.legacyHold}, ${row.relationship}, ${row.evidenceContext}, ${row.evidenceSourceType},
         ${row.evidenceCurrentness}, ${row.evidenceAuthorSpecific}, ${row.recordedSourceType},
         ${row.recordedCurrentness}, ${row.additionalAffiliationCount},
         ${row.independentIdentity}, ${row.additionalCoi}, ${row.proposedAction}, ${row.outcomeCategory})
    `;
    let timeoutId;
    let result;
    try {
      result = await Promise.race([
        write.then(() => 'inserted'),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), INSERT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
    if (result !== 'inserted') console.warn('[reviewer-institution-measurement] insert timed out; coverage incomplete');
    if (result === 'inserted') {
      breaker.failures = 0;
      breaker.suspendedUntil = 0;
    } else {
      breaker.failures += 1;
    }
    if (breaker.failures >= FAILURE_THRESHOLD) {
      breaker.failures = 0;
      breaker.suspendedUntil = Date.now() + COOLDOWN_MS;
    }
    return result;
  } catch (error) {
    breaker.failures += 1;
    if (breaker.failures >= FAILURE_THRESHOLD) {
      breaker.failures = 0;
      breaker.suspendedUntil = Date.now() + COOLDOWN_MS;
    }
    console.warn('[reviewer-institution-measurement] insert failed; coverage incomplete:', error?.code || error?.name || 'Error');
    return 'failed';
  }
}

function measurementEnabled() {
  return process.env.REVIEWER_INSTITUTION_MEASUREMENT === 'on';
}

module.exports = {
  recordInstitutionMeasurement,
  measurementEnabled,
  classifiedOutcome,
  _internals: { buildRow, cardSnapshotDigest, breaker, resetBreaker() { breaker.failures = 0; breaker.suspendedUntil = 0; } },
};
