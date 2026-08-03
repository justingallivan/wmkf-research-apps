/**
 * reviewer-roster-store — Postgres CRUD for `reviewer_find_roster`, the durable
 * per-request reviewer-search candidate roster behind the Workbench Find tab.
 *
 * One row per (request_id, candidate_key). normalized_name remains a conservative
 * cross-run search exclusion aid, but never merges or mutates two same-name
 * people. Status: 'active' (surfaced; selectability is also gated by the
 * candidate blob) | 'excluded' (collapsed, recoverable) | 'ineligible'
 * (deceased; visible but never selectable) | 'saved' (graduated to the
 * Dataverse pool; kept for dedup) | 'coi_dropped' (discovery-time COI drop
 * ledger) | 'blocked' (terminal promotion policy collision; visible but never
 * selectable). See docs/atlas/postgres-reviewer-find-roster.md + migrations
 * 020/023/025/027/029.
 *
 * CJS (mirrors database-service.js) so it can be required by the route and share
 * the CJS `normalizeReviewerName` util with `/discover`. The `candidate` JSON is
 * a pruned render DTO produced by `pruneCandidateForRoster` (reviewer-search-
 * logic.js) — this store treats it as opaque.
 */

const { sql } = require('@vercel/postgres');
const { randomUUID } = require('crypto');
const { normalizeReviewerName } = require('../utils/reviewer-name-match');
const { canonicalManualConfirmation } = require('../utils/reviewer-manual-confirmation');
const { isStaffIdentityConfirmationSatisfied } = require('../utils/reviewer-identity-authority');
const {
  reviewerCandidateKey,
  reviewerSuggestionCandidateKey,
  withReviewerCandidateKey,
} = require('../utils/reviewer-candidate-key');
const { PROVENANCE_KINDS, SEED_ROLES, provenanceKindOf, withReviewerProvenance, sanitizeInstitutionCOIDetails } = require('../utils/reviewer-provenance');
const { ContactParser } = require('../utils/contact-parser');
const { normalizeOrcid } = require('../utils/orcid-normalize');
const { buildAttestation, normalizeAddress } = require('../utils/reviewer-address-trust');
const {
  CONTRACT_VERSIONS,
  STAGES,
  WARM_CACHE_VERSION,
  candidateStageLease,
  canonicalIso,
} = require('./reviewer-stage-freshness');
const {
  STAGE_EVIDENCE_KEYS,
  projectStageEnvelope,
  boundedDigest,
} = require('./workbench/reviewer-stage-projector');
const {
  terminalUpstreamReceipts,
  buildRosterPersistenceReceipt,
} = require('./workbench/reviewer-stage-source-versions');
const { observeReviewerFindWarmEffect } = require('./workbench/reviewer-find-warm-observation');

// Max active/saved rows retained per request. Bounds growth in v1 (a TTL cron is
// a follow-up). Excluded, ineligible, and COI-drop ledger rows are never evicted.
const PER_REQUEST_ACTIVE_CAP = 300;

function sourceKindOf(candidate) {
  return provenanceKindOf(candidate);
}

function rosterStatusForCandidate(candidate) {
  const eligibilityStatus = candidate?.eligibilityStatus
    || candidate?.contactEnrichment?.eligibilityStatus
    || 'unknown';
  return eligibilityStatus === 'deceased' ? 'ineligible' : 'active';
}

function genericEvidenceCandidate(candidate) {
  const generic = { ...(candidate || {}) };
  // Generic writers do not own either completed receipts or a live lease.
  // Conflict updates below retain a server-stored lease; first inserts start
  // without one.
  delete generic.stageFreshness;
  delete generic.stageRefresh;
  delete generic.warmCacheVersion;
  delete generic.proposalContentVersion;
  delete generic.applicantInputVersion;
  for (const field of STAFF_OWNED_FIELDS) delete generic[field];
  return generic;
}

// Store mutations are exported through this one boundary. Warm GET callers
// normally use only listForRequest, but a future accidental mutation from the
// route will cross this wrapper and become an observable postgres_write.
function observedRosterWrite(operation, fn) {
  return async (...args) => observeReviewerFindWarmEffect({
    effectClass: 'postgres_write',
    operation,
  }, () => fn(...args));
}

function candidateFromRow(row) {
  const rawCandidate = row?.candidate;
  const candidate = rawCandidate && typeof rawCandidate === 'object' && row?.candidate_key && !rawCandidate.candidateKey
    ? { ...rawCandidate, candidateKey: row.candidate_key }
    : rawCandidate;
  if (!candidate || typeof candidate !== 'object') return candidate;
  if (candidate.provenance) return sanitizeCandidateWebsite(withReviewerProvenance(candidate));
  if (row.source_kind === 'claude_verified' || row.source_kind === 'database') {
    return sanitizeCandidateWebsite(withReviewerProvenance(candidate, {
      kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
      sources: [candidate.verificationSource, candidate.source],
      seedRole: SEED_ROLES.QUERY_SEED,
    }));
  }
  return sanitizeCandidateWebsite(withReviewerProvenance(candidate));
}

function sanitizeCandidateWebsite(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const name = candidate.name;
  const website = ContactParser.sanitizeWebsiteForCandidate(candidate.website, name);
  const contactEnrichment = candidate.contactEnrichment && typeof candidate.contactEnrichment === 'object'
    ? {
        ...candidate.contactEnrichment,
        website: ContactParser.sanitizeWebsiteForCandidate(candidate.contactEnrichment.website, name),
      }
    : candidate.contactEnrichment;
  return {
    ...candidate,
    website,
    contactEnrichment,
    // Scrub legacy institutionCOIDetails.historical on READ too (S240, Codex re-review
    // F2): rows saved before the historical-COI retirement are never re-written, so the
    // GET path must sanitize or they'd reload as a current conflict.
    institutionCOIDetails: sanitizeInstitutionCOIDetails(candidate.institutionCOIDetails),
  };
}

/**
 * Bulk-record surfaced candidates. Direct deceased evidence records status
 * 'ineligible'; everything else records 'active'. Ineligible is monotonic
 * against later unknown refreshes, while new direct deceased evidence may move
 * an active row to ineligible. Excluded/saved/COI-ledger curation always wins.
 */
async function recordSurfaced(requestId, candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const concurrencyGuarded = Object.prototype.hasOwnProperty.call(options, 'expectedUpdatedAt');
  const expectedUpdatedAt = typeof options.expectedUpdatedAt === 'string'
    ? options.expectedUpdatedAt.trim()
    : '';
  let recorded = 0;
  for (const c of list) {
    const candidate = withReviewerCandidateKey(sanitizeCandidateWebsite(withReviewerProvenance(c)));
    const genericCandidate = genericEvidenceCandidate(candidate);
    const name = candidate && candidate.name;
    const normalized = normalizeReviewerName(name);
    const candidateKey = reviewerCandidateKey(candidate);
    const rosterStatus = rosterStatusForCandidate(candidate);
    if (!normalized || !candidateKey) continue; // unnamed / junk — nothing to correlate
    try {
      // A generic write has no producer envelope that binds its replacement
      // evidence to a stage receipt. Drop every supplied/stored receipt rather
      // than letting a browser-restored or prior receipt certify new evidence.
      // The live refresh lease and staff-owned fields remain server-owned.
      const result = await sql`
        INSERT INTO reviewer_find_roster
          (request_id, candidate_key, normalized_name, display_name, status, candidate, source_kind)
        VALUES (${requestId}, ${candidateKey}, ${normalized}, ${String(name)}, ${rosterStatus}, ${JSON.stringify(genericCandidate)}, ${sourceKindOf(candidate)})
        ON CONFLICT (request_id, candidate_key) DO UPDATE
          SET status = CASE
                WHEN EXCLUDED.status = 'ineligible' THEN 'ineligible'
                ELSE reviewer_find_roster.status
              END,
              candidate = CASE
                WHEN reviewer_find_roster.candidate ? 'addressTrustReceipt'
                  AND (
                    lower(COALESCE(${candidate.email || ''}, '')) = lower(COALESCE(reviewer_find_roster.candidate->'addressTrustReceipt'->>'email', ''))
                    OR lower(COALESCE(${candidate.contactEnrichment?.email || ''}, '')) = lower(COALESCE(reviewer_find_roster.candidate->'addressTrustReceipt'->>'email', ''))
                  )
                THEN ${JSON.stringify(genericCandidate)}::jsonb || jsonb_build_object(
                  'addressTrustReceipt', reviewer_find_roster.candidate->'addressTrustReceipt'
                ) || jsonb_build_object('stageFreshness', '{}'::jsonb)
                  || CASE WHEN reviewer_find_roster.candidate ? 'stageRefresh' THEN jsonb_build_object('stageRefresh', reviewer_find_roster.candidate->'stageRefresh') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'staffIdentityConfirmation' THEN jsonb_build_object('staffIdentityConfirmation', reviewer_find_roster.candidate->'staffIdentityConfirmation') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'pdIdentityConfirmed' THEN jsonb_build_object('pdIdentityConfirmed', reviewer_find_roster.candidate->'pdIdentityConfirmed') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'pdIdentityConfirmationId' THEN jsonb_build_object('pdIdentityConfirmationId', reviewer_find_roster.candidate->'pdIdentityConfirmationId') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'manualContactFields' THEN jsonb_build_object('manualContactFields', reviewer_find_roster.candidate->'manualContactFields') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'warmCacheVersion' THEN jsonb_build_object('warmCacheVersion', reviewer_find_roster.candidate->'warmCacheVersion') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'proposalContentVersion' THEN jsonb_build_object('proposalContentVersion', reviewer_find_roster.candidate->'proposalContentVersion') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'applicantInputVersion' THEN jsonb_build_object('applicantInputVersion', reviewer_find_roster.candidate->'applicantInputVersion') ELSE '{}'::jsonb END
                ELSE ${JSON.stringify(genericCandidate)}::jsonb || jsonb_build_object('stageFreshness', '{}'::jsonb)
                  || CASE WHEN reviewer_find_roster.candidate ? 'stageRefresh' THEN jsonb_build_object('stageRefresh', reviewer_find_roster.candidate->'stageRefresh') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'staffIdentityConfirmation' THEN jsonb_build_object('staffIdentityConfirmation', reviewer_find_roster.candidate->'staffIdentityConfirmation') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'pdIdentityConfirmed' THEN jsonb_build_object('pdIdentityConfirmed', reviewer_find_roster.candidate->'pdIdentityConfirmed') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'pdIdentityConfirmationId' THEN jsonb_build_object('pdIdentityConfirmationId', reviewer_find_roster.candidate->'pdIdentityConfirmationId') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'manualContactFields' THEN jsonb_build_object('manualContactFields', reviewer_find_roster.candidate->'manualContactFields') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'warmCacheVersion' THEN jsonb_build_object('warmCacheVersion', reviewer_find_roster.candidate->'warmCacheVersion') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'proposalContentVersion' THEN jsonb_build_object('proposalContentVersion', reviewer_find_roster.candidate->'proposalContentVersion') ELSE '{}'::jsonb END
                  || CASE WHEN reviewer_find_roster.candidate ? 'applicantInputVersion' THEN jsonb_build_object('applicantInputVersion', reviewer_find_roster.candidate->'applicantInputVersion') ELSE '{}'::jsonb END
              END,
              source_kind = ${sourceKindOf(candidate)},
              updated_at = now()
          WHERE (
                  reviewer_find_roster.status = 'active'
                  OR (reviewer_find_roster.status = 'ineligible' AND EXCLUDED.status = 'ineligible')
                )
            AND (
                  ${!concurrencyGuarded}
                  OR (
                    ${concurrencyGuarded && !!expectedUpdatedAt}
                    AND reviewer_find_roster.updated_at::text = ${expectedUpdatedAt}
                  )
                )
      `;
      recorded += result.rowCount || result.rows?.length || 0;
    } catch (error) {
      console.error('reviewer-roster recordSurfaced row error:', error.message);
    }
  }
  await enforceCap(requestId);
  return recorded;
}

const IDENTITY_DEPENDENT_STAGES = new Set([
  'identity',
  'institution_domains',
  'institution_coi',
  'coauthor_coi',
  'eligibility',
  'contact',
  'address_trust',
]);
const CONTACT_OWNED_FIELDS = [
  'email', 'emailSource', 'emailPersistAllowed', 'emailEvidence', 'emailAction',
  'emailActionReason', 'website', 'websiteSource', 'websitePersistAllowed',
  'facultyPageUrl', 'affiliation', 'affiliationSource', 'affiliationPersistAllowed',
  'contactStatus', 'contactStatusReason', 'contactLeads', 'contactTierSummary',
  'contactEnrichment',
];
const IDENTITY_OWNED_FIELDS = [
  'identityDecision', 'identityEvidence', 'orcid', 'openAlexAuthorId',
  'identityResolverVersion', 'identityResolvedAt', 'potentialReviewerId',
];
const STAFF_OWNED_FIELDS = [
  'staffIdentityConfirmation', 'pdIdentityConfirmed', 'pdIdentityConfirmationId',
  'addressTrustReceipt', 'manualContactFields',
];

function hasOwn(candidate, field) {
  return Object.prototype.hasOwnProperty.call(candidate || {}, field);
}

function restoreOwnedFields(next, existing, fields) {
  for (const field of fields) {
    if (hasOwn(existing, field)) next[field] = existing[field];
    else delete next[field];
  }
}

function hasStaffIdentityAuthority(candidate) {
  return !!candidate?.staffIdentityConfirmation || candidate?.pdIdentityConfirmed === true;
}

function projectsStaffIdentityAuthority(projectedStageFreshness) {
  return Object.keys(projectedStageFreshness || {}).some((stage) => (
    stage === 'applicant_anchor' || IDENTITY_DEPENDENT_STAGES.has(stage)
  ));
}

/**
 * A cold result is allowed to add the receipts it actually produced, but it
 * must never overwrite staff identity/contact authority. We do not guess that
 * old receipts remain compatible after a conflicting cold identity/contact
 * result: affected receipts are invalidated and the caller receives `partial`.
 */
function mergeColdStageEvidence({
  candidateKey,
  existing,
  coldCandidate,
  evidencePatch,
  projectedStageFreshness,
}) {
  const coldBase = { ...(coldCandidate || {}) };
  const coldAuthorityFields = new Set([
    'stageFreshness', 'stageRefresh', 'warmCacheVersion', 'proposalContentVersion',
    'applicantInputVersion', 'staffIdentityConfirmation', 'pdIdentityConfirmed',
    'pdIdentityConfirmationId', 'addressTrustReceipt', 'manualContactFields',
    'rosterUpdatedAt', 'rosterStatus', 'contactEnrichment', 'proposalEvidence',
    'identityStatus', 'canonicalPersonId', 'canonicalPersonEtag', 'personEtag',
    'seedResolvedPotentialReviewerId',
    ...Object.values(STAGE_EVIDENCE_KEYS).flat(),
  ]);
  for (const field of coldAuthorityFields) delete coldBase[field];

  const next = {
    ...(existing || {}),
    ...coldBase,
    ...(evidencePatch || {}),
    candidateKey,
    warmCacheVersion: WARM_CACHE_VERSION,
  };
  const stageFreshness = { ...(existing?.stageFreshness || {}) };
  delete stageFreshness.roster_persistence;
  let partial = false;
  let code = null;
  const hasStaffIdentity = hasStaffIdentityAuthority(existing);
  const hasManualContact = !!existing?.addressTrustReceipt
    || (Array.isArray(existing?.manualContactFields) && existing.manualContactFields.length > 0);
  const projectsIdentity = projectsStaffIdentityAuthority(projectedStageFreshness);
  const projectsContact = Object.keys(projectedStageFreshness || {}).some((stage) => (
    stage === 'contact' || stage === 'address_trust'
  ));

  if (hasStaffIdentity && projectsIdentity) {
    partial = true;
    code = 'staff_authority_preserved';
    restoreOwnedFields(next, existing, STAFF_OWNED_FIELDS);
    restoreOwnedFields(next, existing, IDENTITY_OWNED_FIELDS);
    for (const stage of IDENTITY_DEPENDENT_STAGES) delete stageFreshness[stage];
  }
  if (hasManualContact && projectsContact) {
    partial = true;
    code = code || 'staff_authority_preserved';
    restoreOwnedFields(next, existing, STAFF_OWNED_FIELDS);
    restoreOwnedFields(next, existing, CONTACT_OWNED_FIELDS);
    delete stageFreshness.contact;
    delete stageFreshness.address_trust;
  }

  for (const [stage, receipt] of Object.entries(projectedStageFreshness || {})) {
    if ((hasStaffIdentity && IDENTITY_DEPENDENT_STAGES.has(stage))
      || (hasManualContact && (stage === 'contact' || stage === 'address_trust'))) {
      continue;
    }
    stageFreshness[stage] = receipt;
  }

  // The stage refresh lease is a live ownership record. A cold write never
  // adopts or clears it; the caller rejects such a row before this helper.
  return {
    candidate: {
      ...next,
      stageFreshness,
      ...(existing?.stageRefresh ? { stageRefresh: existing.stageRefresh } : {}),
    },
    partial,
    code,
  };
}

/**
 * Cold-pipeline sibling of `recordSurfaced`. Each entry carries only producer
 * envelopes already computed by the cold path; this method never runs a
 * provider. New rows receive the projected evidence and terminal receipt in
 * one insert. Existing rows require their own server-read CAS token; otherwise
 * the method preserves the newer/staff-owned row and reports `skipped_stale`
 * rather than silently choosing a winner.
 */
async function recordSurfacedWithStageEvidence(requestId, entries) {
  const outcomes = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    // A batch owns a distinct roster snapshot for each row. A global token
    // would let one candidate's token correlate another candidate's write.
    const expectedUpdatedAt = typeof entry?.expectedUpdatedAt === 'string'
      ? entry.expectedUpdatedAt.trim()
      : '';
    const canUpdateExisting = validRefreshText(expectedUpdatedAt, 128);
    const original = entry?.candidate;
    const candidate = withReviewerCandidateKey(sanitizeCandidateWebsite(withReviewerProvenance(original)));
    const candidateKey = reviewerCandidateKey(candidate);
    const normalized = normalizeReviewerName(candidate?.name);
    const stageEvidence = entry?.stageEvidence;
    if (!candidateKey || !normalized || !stageEvidence || typeof stageEvidence !== 'object' || Array.isArray(stageEvidence)) {
      outcomes.push({ candidateKey: candidateKey || null, outcome: 'rejected', code: 'invalid_cold_stage_evidence' });
      continue;
    }
    // The caller's display candidate is never authority for receipts.  Cold
    // receipts enter only through the same projector used by manual stages;
    // an arbitrary `candidate.stageFreshness` must not hitch a ride here.
    const projectedStageFreshness = {};
    const evidencePatch = {};
    let rejected = null;
    const stageEntries = Object.entries(stageEvidence);
    if (stageEntries.length === 0) {
      outcomes.push({ candidateKey, outcome: 'rejected', code: 'invalid_cold_stage_evidence' });
      continue;
    }
    for (const [stage, envelope] of stageEntries) {
      if (stage === 'roster_persistence') {
        rejected = 'terminal_receipt_server_owned';
        break;
      }
      const projected = projectStageEnvelope({ stage, mode: 'cold_emit', envelope });
      if (!projected.ok) {
        rejected = projected.code;
        break;
      }
      projectedStageFreshness[stage] = projected.value.receipt;
      Object.assign(evidencePatch, projected.value.evidencePatch);
    }
    if (rejected) {
      outcomes.push({ candidateKey, outcome: 'rejected', code: rejected });
      continue;
    }
    try {
      const current = await sql`
        SELECT candidate_key, status, candidate, source_kind,
               updated_at::text AS updated_at_token
        FROM reviewer_find_roster
        WHERE request_id = ${requestId}
          AND candidate_key = ${candidateKey}
        LIMIT 1
      `;
      const row = current.rows?.[0];
      if (!row) {
        const merged = mergeColdStageEvidence({
          candidateKey,
          existing: null,
          coldCandidate: candidate,
          evidencePatch,
          projectedStageFreshness,
        });
        const prepared = applyTerminalReceipt(candidateKey, merged.candidate);
        const inserted = await sql`
          INSERT INTO reviewer_find_roster
            (request_id, candidate_key, normalized_name, display_name, status, candidate, source_kind)
          VALUES (
            ${requestId}, ${candidateKey}, ${normalized}, ${String(prepared.name)}, ${rosterStatusForCandidate(prepared)},
            ${JSON.stringify(prepared)}, ${sourceKindOf(prepared)}
          )
          ON CONFLICT (request_id, candidate_key) DO NOTHING
          RETURNING candidate, updated_at::text AS updated_at_token
        `;
        if (!(inserted.rowCount || inserted.rows?.length)) {
          outcomes.push({ candidateKey, outcome: 'skipped_stale', stageOutcomes: stageOutcomeMap(projectedStageFreshness) });
          continue;
        }
        const terminalMissingBecauseKeyIsNotCanonical = allTerminalUpstreamsComplete(projectedStageFreshness)
          && !prepared.stageFreshness?.roster_persistence;
        outcomes.push({
          candidateKey,
          outcome: terminalMissingBecauseKeyIsNotCanonical ? 'partial' : 'recorded',
          ...(terminalMissingBecauseKeyIsNotCanonical ? { code: 'canonical_candidate_unavailable' } : {}),
          stageOutcomes: stageOutcomeMap(prepared.stageFreshness),
          updatedAt: inserted.rows[0].updated_at_token || null,
        });
        continue;
      }

      const existing = candidateFromRow(row);
      if (row.status !== 'active' || !canUpdateExisting || row.updated_at_token !== expectedUpdatedAt) {
        outcomes.push({ candidateKey, outcome: 'skipped_stale', stageOutcomes: stageOutcomeMap(candidateFromRow(row)?.stageFreshness) });
        continue;
      }
      if (existing?.stageRefresh && Object.keys(existing.stageRefresh).length > 0) {
        outcomes.push({ candidateKey, outcome: 'refresh_in_progress', stageOutcomes: stageOutcomeMap(existing.stageFreshness) });
        continue;
      }
      // A staff-confirmed identity is stronger than a cold batch. The cold
      // envelopes were calculated from a different identity authority, so
      // accepting any anchor/identity-dependent stage would either overwrite
      // staff evidence or invalidate every dependent receipt. Leave the row
      // untouched; a staff-authoritative producer can refresh it later.
      if (hasStaffIdentityAuthority(existing) && projectsStaffIdentityAuthority(projectedStageFreshness)) {
        outcomes.push({
          candidateKey,
          outcome: 'skipped_staff_authority',
          code: 'skipped_staff_authority',
          stageOutcomes: stageOutcomeMap(existing.stageFreshness),
        });
        continue;
      }
      const merged = mergeColdStageEvidence({
        candidateKey,
        existing,
        coldCandidate: candidate,
        evidencePatch,
        projectedStageFreshness,
      });
      const prepared = applyTerminalReceipt(candidateKey, merged.candidate);
      // Do not use an ON CONFLICT update after the snapshot: its update clause
      // cannot prove it saw the same row. The final mutation is a single
      // token-guarded CAS, so a concurrent staff edit wins without a merge.
      const updated = await sql`
        UPDATE reviewer_find_roster
           SET status = CASE
                 WHEN ${rosterStatusForCandidate(prepared)} = 'ineligible' THEN 'ineligible'
                 ELSE reviewer_find_roster.status
               END,
               candidate = ${JSON.stringify(prepared)}::jsonb,
               source_kind = ${sourceKindOf(prepared)},
               updated_at = now()
         WHERE request_id = ${requestId}
           AND candidate_key = ${candidateKey}
           AND status = 'active'
           AND updated_at::text = ${expectedUpdatedAt}
        RETURNING candidate, updated_at::text AS updated_at_token
      `;
      if (!(updated.rowCount || updated.rows?.length)) {
        outcomes.push({ candidateKey, outcome: 'skipped_stale', stageOutcomes: stageOutcomeMap(existing.stageFreshness) });
      } else {
        const terminalMissingBecauseKeyIsNotCanonical = allTerminalUpstreamsComplete(prepared.stageFreshness)
          && !prepared.stageFreshness?.roster_persistence;
        outcomes.push({
          candidateKey,
          outcome: merged.partial || terminalMissingBecauseKeyIsNotCanonical ? 'partial' : 'recorded',
          ...(merged.partial
            ? { code: merged.code }
            : terminalMissingBecauseKeyIsNotCanonical ? { code: 'canonical_candidate_unavailable' } : {}),
          stageOutcomes: stageOutcomeMap(prepared.stageFreshness),
          updatedAt: updated.rows[0].updated_at_token || null,
        });
      }
    } catch (error) {
      console.error('reviewer-roster recordSurfacedWithStageEvidence row error:', error.message);
      outcomes.push({ candidateKey, outcome: 'failed_retryable', code: 'roster_write_failed' });
    }
  }
  await enforceCap(requestId);
  return outcomes;
}

function compactCoiDroppedCandidate(candidate, options = {}) {
  const withProvenance = sanitizeCandidateWebsite(withReviewerProvenance(candidate));
  const details = sanitizeInstitutionCOIDetails(withProvenance.institutionCOIDetails) || {};
  const matchSource = options.matchSource || details.matchSource || null;
  const dropStage = options.dropStage || details.dropStage || null;
  return {
    candidateKey: reviewerCandidateKey(withProvenance),
    name: withProvenance.name || null,
    affiliation: withProvenance.affiliation || withProvenance.primaryAffiliation || null,
    affiliationSource: withProvenance.affiliationSource || withProvenance.contactEnrichment?.affiliationSource || null,
    source: withProvenance.source || null,
    sources: Array.isArray(withProvenance.sources) ? withProvenance.sources.slice(0, 8) : [],
    provenance: withProvenance.provenance || null,
    isReferredSeed: !!withProvenance.isReferredSeed,
    referredBy: withProvenance.referredBy || withProvenance.provenance?.referredBy || null,
    hasInstitutionCOI: true,
    institutionCOIDetails: {
      piInstitution: details.piInstitution || null,
      reviewerInstitution: details.reviewerInstitution || withProvenance.affiliation || withProvenance.primaryAffiliation || null,
      dropDecision: details.dropDecision || 'dropped',
      corroborationReason: details.corroborationReason || null,
      matchedAffiliationSource: details.matchedAffiliationSource || null,
      contradictoryAffiliationSource: details.contradictoryAffiliationSource || null,
      matchSource,
      dropStage,
    },
  };
}

/**
 * Record discovery-time institution-COI hard drops as a durable, non-selectable
 * ledger. Inserts only new names or refreshes an existing coi_dropped row; it never
 * downgrades active/excluded/ineligible/saved rows to avoid changing staff-visible state.
 */
async function recordCoiDropped(requestId, candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  let recorded = 0;
  for (const c of list) {
    const candidate = compactCoiDroppedCandidate(c, options);
    const name = candidate && candidate.name;
    const normalized = normalizeReviewerName(name);
    const candidateKey = reviewerCandidateKey(candidate);
    if (!normalized || !candidateKey) continue;
    try {
      await sql`
        INSERT INTO reviewer_find_roster
          (request_id, candidate_key, normalized_name, display_name, status, candidate, source_kind)
        VALUES (${requestId}, ${candidateKey}, ${normalized}, ${String(name)}, 'coi_dropped', ${JSON.stringify(candidate)}, ${sourceKindOf(candidate)})
        ON CONFLICT (request_id, candidate_key) DO UPDATE
          SET candidate = ${JSON.stringify(candidate)}, source_kind = ${sourceKindOf(candidate)}, updated_at = now()
          WHERE reviewer_find_roster.status = 'coi_dropped'
      `;
      recorded++;
    } catch (error) {
      console.error('reviewer-roster recordCoiDropped row error:', error.message);
    }
  }
  return recorded;
}

class ReviewerRosterCapError extends Error {
  constructor(cause) {
    super('Reviewer roster cap enforcement failed');
    this.name = 'ReviewerRosterCapError';
    this.code = 'reviewer_roster_cap_enforcement_failed';
    this.cause = cause;
  }
}

/**
 * Evict the oldest active/saved rows beyond the per-request cap.
 *
 * Every active-producing writer awaits this before reporting success. Do not
 * swallow an error here: a caller that cannot prove the bounded roster
 * invariant must receive an explicit failure, even though its preceding row
 * mutation may already have committed.
 */
async function enforceCap(requestId) {
  try {
    await sql`
      DELETE FROM reviewer_find_roster
      WHERE request_id = ${requestId}
        AND status IN ('active', 'saved')
        AND id IN (
          SELECT id FROM reviewer_find_roster
          WHERE request_id = ${requestId} AND status IN ('active', 'saved')
          ORDER BY updated_at DESC
          OFFSET ${PER_REQUEST_ACTIVE_CAP}
        )
    `;
  } catch (error) {
    console.error('reviewer-roster enforceCap error:', error.message);
    throw new ReviewerRosterCapError(error);
  }
}

/**
 * Set a candidate aside ('excluded'). Upserts from the submitted blob so it is
 * eviction-tolerant: an exclude on a row the cap already removed recreates it as
 * 'excluded' rather than 404ing. An existing ineligible row remains ineligible.
 */
async function setExcluded(requestId, candidate) {
  const candidateWithProvenance = withReviewerCandidateKey(sanitizeCandidateWebsite(withReviewerProvenance(candidate)));
  const name = candidateWithProvenance && candidateWithProvenance.name;
  const normalized = normalizeReviewerName(name);
  const candidateKey = reviewerCandidateKey(candidateWithProvenance);
  if (!normalized || !candidateKey) throw new Error('reviewer-roster.setExcluded: candidate name/key required');
  await sql`
    INSERT INTO reviewer_find_roster
      (request_id, candidate_key, normalized_name, display_name, status, candidate, source_kind)
    VALUES (${requestId}, ${candidateKey}, ${normalized}, ${String(name)}, 'excluded', ${JSON.stringify(candidateWithProvenance)}, ${sourceKindOf(candidateWithProvenance)})
    ON CONFLICT (request_id, candidate_key) DO UPDATE
      SET status = 'excluded', candidate = ${JSON.stringify(candidateWithProvenance)}, source_kind = ${sourceKindOf(candidateWithProvenance)}, updated_at = now()
      WHERE reviewer_find_roster.status <> 'ineligible'
  `;
}

/**
 * Promote an excluded candidate back to 'active'. No-op (returns null) if the row
 * is gone (cap eviction) — the caller already holds the blob in memory.
 * Returns the stored candidate blob only after the active/saved cap is
 * enforced. A cap-enforcement failure is explicit rather than returning a
 * misleading promotion success.
 */
async function promote(requestId, candidateKey) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  if (!key) return null;
  const res = await sql`
    UPDATE reviewer_find_roster
      SET status = 'active', updated_at = now()
      WHERE request_id = ${requestId} AND candidate_key = ${key} AND status = 'excluded'
      RETURNING candidate
  `;
  const candidate = res.rows[0] ? res.rows[0].candidate : null;
  if (!candidate) return null;
  await enforceCap(requestId);
  return candidate;
}

/**
 * Record an authenticated staff identity confirmation on an existing active
 * roster row. The opaque id is the only client-carried reference; save-candidates
 * re-reads this server record and checks the exact canonical manual contact.
 */
async function confirmIdentity(requestId, candidate, {
  actorProfileId = null,
  actorSystemUserId = null,
  canonicalPerson = null,
  identityEnvelope = null,
  expectedUpdatedAt = null,
} = {}) {
  const safeCandidate = withReviewerCandidateKey(sanitizeCandidateWebsite(withReviewerProvenance(candidate)));
  // These are read projection metadata, not durable candidate evidence.  A
  // confirmation must never write the caller's roster status/token back into
  // JSONB, even though the server still uses the exact token in the SQL CAS.
  const {
    rosterStatus: _rosterStatus,
    rosterUpdatedAt: _rosterUpdatedAt,
    ...candidateForPersistence
  } = safeCandidate;
  const contact = canonicalManualConfirmation(safeCandidate);
  const candidateKey = reviewerCandidateKey(safeCandidate);
  if (!requestId || !candidateKey || !contact.normalizedName || !contact.email) {
    throw new Error('reviewer-roster.confirmIdentity: request, candidate key/name, and email required');
  }
  const projected = projectStageEnvelope({
    stage: 'identity',
    mode: 'manual_refresh',
    envelope: identityEnvelope,
  });
  if (!projected.ok) {
    throw new Error(`reviewer-roster.confirmIdentity: invalid identity evidence (${projected.code || 'rejected'})`);
  }
  const projectedConfirmation = projected.value.evidencePatch.staffIdentityConfirmation;
  const canonical = canonicalPerson && typeof canonicalPerson === 'object'
    ? {
        state: 'confirmed',
        canonicalPersonId: canonicalPerson.canonicalPersonId,
        canonicalPersonEtag: canonicalPerson.canonicalPersonEtag,
        actorId: canonicalPerson.actorId,
        confirmedAt: canonicalPerson.confirmedAt,
      }
    : null;
  if (!isStaffIdentityConfirmationSatisfied(canonical)
    || !isStaffIdentityConfirmationSatisfied(projectedConfirmation)
    || projectedConfirmation.canonicalPersonId !== String(canonical.canonicalPersonId).toLowerCase()
    || projectedConfirmation.canonicalPersonEtag !== canonical.canonicalPersonEtag
    || projectedConfirmation.actorId !== canonical.actorId
    || projectedConfirmation.confirmedAt !== canonical.confirmedAt) {
    throw new Error('reviewer-roster.confirmIdentity: canonical staff identity confirmation required');
  }
  const expected = typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt.trim() : '';
  if (!expected) {
    throw new Error('reviewer-roster.confirmIdentity: current roster version required');
  }
  const confirmationId = randomUUID();
  const confirmation = {
    confirmationId,
    source: 'staff_confirmed',
    ...contact,
    actorProfileId,
    actorSystemUserId,
    ...canonical,
  };
  const confirmedCandidate = {
    ...candidateForPersistence,
    ...projected.value.evidencePatch,
    stageFreshness: {
      ...(candidateForPersistence.stageFreshness || {}),
      identity: projected.value.receipt,
    },
    name: candidateForPersistence.name,
    email: contact.email,
    emailSource: 'manual',
    website: contact.website || null,
    websiteSource: contact.website ? 'manual' : null,
    affiliation: contact.affiliation || null,
    manualContactFields: ['email', 'website', 'affiliation'],
    contactEnrichment: {
      ...(candidateForPersistence.contactEnrichment || {}),
      email: contact.email,
      emailSource: 'manual',
      website: contact.website || null,
      websiteSource: contact.website ? 'manual' : null,
      affiliation: contact.affiliation || null,
      affiliationSource: 'staff_manual',
    },
    pdIdentityConfirmed: true,
    pdIdentityConfirmationId: confirmationId,
    staffIdentityConfirmation: confirmation,
    // A current actor-bound correction supersedes an automated historical
    // stored-vs-enriched mismatch marker. Promotion still re-reads the exact
    // Dataverse person and active email owner before selection.
    applicantContactMismatch: false,
  };

  const res = await sql`
    UPDATE reviewer_find_roster
      SET candidate = candidate || ${JSON.stringify(confirmedCandidate)}::jsonb,
          updated_at = now()
      WHERE request_id = ${requestId}
        AND candidate_key = ${candidateKey}
        AND status = 'active'
        AND updated_at::text = ${expected}
    RETURNING candidate
  `;
  if (!res.rows?.[0]) return null;
  return {
    confirmationId,
    candidate: candidateFromRow(res.rows[0]),
  };
}

async function findIdentityConfirmation(requestId, confirmationId) {
  if (!requestId || !confirmationId) return null;
  const res = await sql`
    SELECT candidate_key, candidate->'staffIdentityConfirmation' AS confirmation
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate->>'pdIdentityConfirmationId' = ${confirmationId}
      AND status IN ('active', 'saved')
    LIMIT 1
  `;
  const row = res.rows?.[0];
  return row?.confirmation
    ? { ...row.confirmation, rosterCandidateKey: row.candidate_key }
    : null;
}

/**
 * Record an authenticated exact-address attestation on an existing roster row.
 * The submitted address may retain or deliberately correct the roster value;
 * the authenticated attestation and evidence make that distinction explicit.
 * When verifiedContact is supplied, every promotion-confirmation field and a
 * matching opaque staff confirmation are renewed in this same guarded update.
 * Promotion later re-reads this exact receipt and binds it to the stable
 * Dataverse person. The receipt alone never grants cross-request authority.
 */
async function attestAddress(requestId, candidateKey, {
  email,
  verifiedContact = null,
  evidenceType,
  evidenceUrl = null,
  note = null,
  actorProfileId = null,
  actorSystemUserId = null,
} = {}) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  const normalizedEmail = normalizeAddress(email);
  if (!requestId || !key || !normalizedEmail) {
    throw new Error('reviewer-roster.attestAddress: requestId, candidateKey, and valid email are required');
  }
  const receiptId = randomUUID();
  const attestation = buildAttestation({
    actorProfileId,
    actorSystemUserId,
    requestId,
    candidateKey: key,
    evidenceType,
    evidenceUrl,
    note,
  });
  const receipt = {
    receiptId,
    email: normalizedEmail,
    personConfirmed: true,
    ...attestation,
  };
  const currentRes = await sql`
    SELECT candidate_key, status, candidate, source_kind,
           updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate_key = ${key}
      AND status IN ('active', 'saved')
    LIMIT 1
  `;
  const currentRow = currentRes.rows?.[0];
  const currentCandidate = candidateFromRow(currentRow);
  if (!currentCandidate) return null;
  const currentEmail = normalizeAddress(
    currentCandidate.email || currentCandidate.contactEnrichment?.email,
  );
  const addressChanged = currentEmail !== normalizedEmail;
  const recordsVerifiedContact = verifiedContact
    && typeof verifiedContact === 'object'
    && !Array.isArray(verifiedContact);
  let contact = null;
  let confirmation = null;
  if (recordsVerifiedContact) {
    const verifiedCandidate = sanitizeCandidateWebsite({
      ...currentCandidate,
      email: normalizedEmail,
      website: verifiedContact.website ?? null,
      affiliation: verifiedContact.affiliation ?? null,
    });
    contact = canonicalManualConfirmation(verifiedCandidate);
    if (!contact.normalizedName || !contact.email) {
      throw new Error('reviewer-roster.attestAddress: verified contact requires candidate name and email');
    }
    confirmation = {
      confirmationId: randomUUID(),
      source: 'staff_confirmed',
      ...contact,
      actorProfileId,
      actorSystemUserId,
      confirmedAt: new Date().toISOString(),
    };
  }
  const manualFields = new Set(
    Array.isArray(currentCandidate.manualContactFields)
      ? currentCandidate.manualContactFields
      : [],
  );
  if (recordsVerifiedContact) {
    manualFields.add('email');
    manualFields.add('website');
    manualFields.add('affiliation');
  } else if (addressChanged) {
    manualFields.add('email');
  }
  const updatedCandidate = {
    ...currentCandidate,
    email: normalizedEmail,
    emailSource: recordsVerifiedContact
      ? 'manual'
      : addressChanged
      ? 'manual'
      : (currentCandidate.emailSource || currentCandidate.contactEnrichment?.emailSource || null),
    ...(recordsVerifiedContact ? {
      website: contact.website || null,
      websiteSource: contact.website ? 'manual' : null,
      affiliation: contact.affiliation || null,
      affiliationSource: 'staff_manual',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: confirmation.confirmationId,
      staffIdentityConfirmation: confirmation,
      applicantContactMismatch: false,
    } : {}),
    emailPersistAllowed: true,
    manualContactFields: Array.from(manualFields),
    addressTrustReceipt: receipt,
    addressVerificationRequired: false,
    contactEnrichment: {
      ...(currentCandidate.contactEnrichment || {}),
      email: normalizedEmail,
      emailSource: recordsVerifiedContact
        ? 'manual'
        : addressChanged
        ? 'manual'
        : (currentCandidate.contactEnrichment?.emailSource || currentCandidate.emailSource || null),
      ...(recordsVerifiedContact ? {
        website: contact.website || null,
        websiteSource: contact.website ? 'manual' : null,
        affiliation: contact.affiliation || null,
        affiliationSource: 'staff_manual',
      } : {}),
      emailPersistAllowed: true,
      addressVerificationRequired: false,
    },
  };
  const res = await sql`
    UPDATE reviewer_find_roster
      SET candidate = ${JSON.stringify(updatedCandidate)}::jsonb,
          updated_at = now()
      WHERE request_id = ${requestId}
        AND candidate_key = ${key}
        AND status IN ('active', 'saved')
        AND updated_at::text = ${currentRow.updated_at_token}
    RETURNING candidate, updated_at::text AS updated_at_token
  `;
  if (!res.rows?.[0]) return null;
  return {
    receiptId,
    receipt,
    candidate: {
      ...candidateFromRow(res.rows[0]),
      rosterUpdatedAt: res.rows[0].updated_at_token || null,
    },
  };
}

/** Clear client-facing conflict blocks only after the person-scoped Dataverse
 * adjudication succeeds. The receipt id and row timestamp make the transition
 * fail closed if another editor changed the candidate meanwhile. */
async function clearAddressTrustBlocks(requestId, candidateKey, {
  receiptId,
  expectedUpdatedAt,
} = {}) {
  const [current] = await findCandidatesByKeys(requestId, [candidateKey]);
  if (!current || !receiptId || current.addressTrustReceipt?.receiptId !== receiptId
    || !expectedUpdatedAt || current.rosterUpdatedAt !== expectedUpdatedAt) return null;
  const applicantKnownReviewer = current.applicantKnownReviewer
    ? {
        ...current.applicantKnownReviewer,
        email: current.email || current.contactEnrichment?.email || current.applicantKnownReviewer.email || null,
        emailSource: 'staff_verified',
        addressConflictPending: false,
        addressTrustVerified: true,
        emailReadiness: {
          level: 'high',
          action: 'ready',
          reason: 'Exact address verified by staff against recorded evidence',
        },
      }
    : current.applicantKnownReviewer;
  const candidate = {
    ...current,
    emailSource: 'staff_verified',
    emailPersistAllowed: true,
    manualContactFields: Array.isArray(current.manualContactFields)
      ? current.manualContactFields.filter((field) => field !== 'email')
      : [],
    addressConflictPending: false,
    conflictRecordUnavailable: false,
    addressVerificationRequired: false,
    applicantContactMismatch: false,
    applicantKnownReviewer,
    contactEnrichment: {
      ...(current.contactEnrichment || {}),
      emailSource: 'staff_verified',
      emailPersistAllowed: true,
      addressConflictPending: false,
      conflictRecordUnavailable: false,
      addressVerificationRequired: false,
    },
  };
  delete candidate.rosterUpdatedAt;
  delete candidate.rosterStatus;
  const res = await sql`
    UPDATE reviewer_find_roster
       SET candidate = ${JSON.stringify(candidate)}::jsonb,
           updated_at = now()
     WHERE request_id = ${requestId}
       AND candidate_key = ${candidateKey}
       AND status IN ('active', 'saved')
       AND updated_at::text = ${expectedUpdatedAt}
       AND candidate->'addressTrustReceipt'->>'receiptId' = ${receiptId}
    RETURNING candidate, updated_at::text AS updated_at_token
  `;
  if (!res.rows?.[0]) return null;
  return {
    ...candidateFromRow(res.rows[0]),
    rosterUpdatedAt: res.rows[0].updated_at_token || null,
  };
}

async function findAddressTrustReceipt(requestId, candidateKey) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  if (!requestId || !key) return null;
  const res = await sql`
    SELECT status, candidate->'addressTrustReceipt' AS receipt
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate_key = ${key}
      AND status IN ('active', 'saved')
    LIMIT 1
  `;
  return res.rows?.[0]?.receipt
    ? { ...res.rows[0].receipt, rosterStatus: res.rows[0].status, rosterCandidateKey: key }
    : null;
}

/**
 * Server-owned promotion finalizer. A roster row becomes `saved` only after the
 * caller has a real Dataverse suggestion id and the exact linked person id.
 * Existing server evidence is preserved; only the two durable anchors and
 * status are updated. Current promotion callers supply a server-issued
 * `expectedUpdatedAt`, so a changed or evicted row is never recreated after
 * the Dataverse mutation; that is explicit partial success. The legacy
 * no-token upsert exists only for already-validated callers that have no
 * server snapshot to bind.
 */
async function finalizeCandidatePromotion(
  requestId,
  candidate,
  { candidateKey, suggestionId, potentialReviewerId, expectedUpdatedAt } = {},
) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  if (!requestId || !key || !suggestionId || !potentialReviewerId) {
    throw new Error('reviewer-roster finalizeCandidatePromotion: requestId, candidateKey, suggestionId, and potentialReviewerId are required');
  }
  const safeCandidate = withReviewerCandidateKey({
    ...(candidate && typeof candidate === 'object' ? candidate : {}),
    candidateKey: key,
    suggestionId,
    potentialReviewerId,
  });
  const name = safeCandidate?.name;
  const normalized = normalizeReviewerName(name);
  if (!normalized) {
    throw new Error('reviewer-roster finalizeCandidatePromotion: candidate name is required');
  }
  const anchorPatch = JSON.stringify({ suggestionId, potentialReviewerId });
  const expectedToken = typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt.trim() : '';
  // A promotion caller that read an active roster row must bind its final
  // status transition to that exact server-issued row version.  Do not recreate
  // a row after a concurrent edit/delete: the Dataverse side has its own
  // lifecycle interlock, and the caller must surface this as partial success.
  const res = expectedToken
    ? await sql`
      UPDATE reviewer_find_roster
         SET status = 'saved',
             candidate = reviewer_find_roster.candidate || ${anchorPatch}::jsonb,
             updated_at = now()
       WHERE request_id = ${requestId}
         AND candidate_key = ${key}
         AND status IN ('active', 'saved')
         AND updated_at::text = ${expectedToken}
      RETURNING candidate_key
    `
    : await sql`
    INSERT INTO reviewer_find_roster
      (request_id, candidate_key, normalized_name, display_name, status, candidate, source_kind)
    VALUES (
      ${requestId},
      ${key},
      ${normalized},
      ${String(name)},
      'saved',
      ${JSON.stringify(safeCandidate)},
      ${sourceKindOf(safeCandidate)}
    )
    ON CONFLICT (request_id, candidate_key) DO UPDATE
      SET status = 'saved',
          candidate = reviewer_find_roster.candidate || ${anchorPatch}::jsonb,
          updated_at = now()
      WHERE reviewer_find_roster.status IN ('active', 'saved')
    RETURNING candidate_key
  `;
  const saved = (res.rowCount || res.rows?.length || 0) > 0;
  const rawOrcid = safeCandidate.orcid
    || safeCandidate.contactEnrichment?.orcidId
    || safeCandidate.contactEnrichment?.orcid;
  const normalizedOrcid = normalizeOrcid(rawOrcid);
  if (saved && normalizedOrcid.state === 'valid') {
    // A candidate can acquire its ORCID only after its fallback roster key was
    // written, then be surfaced again under an ORCID key. Once one exact person
    // is promoted, retire every active alias with that same validated ORCID so
    // a duplicate card cannot remain selectable after reload.
    try {
      await sql`
        UPDATE reviewer_find_roster
          SET status = 'saved',
              candidate = candidate || ${anchorPatch}::jsonb,
              updated_at = now()
          WHERE request_id = ${requestId}
            AND candidate_key <> ${key}
            AND status = 'active'
            AND lower(COALESCE(
                  candidate->>'orcid',
                  candidate->'contactEnrichment'->>'orcidId',
                  candidate->'contactEnrichment'->>'orcid',
                  candidate->'applicantKnownReviewer'->>'orcid',
                  ''
                )) = lower(${normalizedOrcid.id})
        RETURNING candidate_key
      `;
    } catch (error) {
      // The primary row is already durably saved and Dataverse promotion has
      // succeeded. Alias cleanup is convergence support and must not turn that
      // committed success into a false 500/compensation attempt.
      console.error('reviewer-roster finalizeCandidatePromotion alias cleanup error:', error.message);
    }
  }
  return { saved, candidateKey: key };
}

/**
 * Verify that the server-read roster row has not changed before the caller
 * begins an external promotion mutation.  The server supplies the expected
 * token; no route accepts it as a source of authority.
 */
async function promotionSnapshotIsCurrent(requestId, candidateKey, expectedUpdatedAt) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  const token = typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt.trim() : '';
  if (!requestId || !key || !token) return false;
  const res = await sql`
    SELECT 1
      FROM reviewer_find_roster
     WHERE request_id = ${requestId}
       AND candidate_key = ${key}
       AND status = 'active'
       AND updated_at::text = ${token}
     LIMIT 1
  `;
  return (res.rowCount || res.rows?.length || 0) > 0;
}

/**
 * Persist a terminal server-owned promotion failure on the exact active roster
 * row. Today the only terminal code is an authoritative applicant-excluded
 * suggestion collision. The original evidence blob is retained and augmented
 * with the decision/reason so it remains visible and auditable in Find.
 */
async function markPromotionBlocked(
  requestId,
  candidateKey,
  {
    decision = 'blocked_applicant_excluded',
    code = 'applicant_excluded',
    reason = 'This reviewer is applicant-excluded for the request and cannot be promoted.',
  } = {},
) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  if (!requestId || !key) {
    throw new Error('reviewer-roster markPromotionBlocked: requestId and candidateKey are required');
  }
  const patch = { promotionDecision: decision, promotionBlockCode: code, promotionBlockReason: reason };
  const res = await sql`
    UPDATE reviewer_find_roster
      SET status = 'blocked',
          candidate = candidate || ${JSON.stringify(patch)}::jsonb,
          updated_at = now()
      WHERE request_id = ${requestId}
        AND candidate_key = ${key}
        AND status IN ('active', 'blocked')
    RETURNING candidate_key
  `;
  return { blocked: (res.rowCount || res.rows?.length || 0) > 0, candidateKey: key };
}

/**
 * Stamp the Dataverse id anchor onto an existing Find roster row after
 * save-candidates has created/reused the exact person+suggestion. Best-effort
 * caller-owned operation; this helper only updates the row keyed by the same
 * `(request_id, candidate_key)` roster correlation used at search time.
 */
async function stampSuggestionAnchor(requestId, name, { candidateKey, suggestionId, potentialReviewerId } = {}) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  if (!requestId || !key || !suggestionId) return { updated: 0 };

  const patch = { suggestionId };
  if (potentialReviewerId) patch.potentialReviewerId = potentialReviewerId;

  const res = await sql`
    UPDATE reviewer_find_roster
      SET candidate = candidate || ${JSON.stringify(patch)}::jsonb,
          updated_at = now()
      WHERE request_id = ${requestId}
        AND candidate_key = ${key}
    RETURNING id
  `;
  return { updated: res.rowCount || res.rows?.length || 0 };
}

/**
 * List the roster for a request:
 * { active, excluded, ineligible, blocked, savedKeys, allNames }.
 *   - active   : candidate blobs for the selectable list (status='active')
 *   - excluded : candidate blobs for the collapsed recoverable section
 *   - ineligible: deceased candidate blobs for the non-selectable evidence section
 *   - blocked  : terminal promotion-policy collisions, read-only in Find
 *   - allNames : display_names for EVERY status — the cross-run dedup union
 * `coi_dropped` deliberately stays out of active/excluded so it is neither
 * selectable nor recoverable, while still deduping future searches.
 */
function rosterFromRows(rows) {
  const active = [];
  const excluded = [];
  const ineligible = [];
  const blocked = [];
  const savedKeys = [];
  const allNames = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    allNames.push(row.display_name);
    const candidate = candidateFromRow(row);
    const listedCandidate = candidate && row.updated_at_token
      ? { ...candidate, rosterUpdatedAt: row.updated_at_token }
      : candidate;
    if (row.status === 'active') active.push(listedCandidate);
    else if (row.status === 'excluded') excluded.push(candidate);
    else if (row.status === 'ineligible') ineligible.push(candidate);
    else if (row.status === 'blocked') blocked.push(candidate);
    else if (
      row.status === 'saved'
      && reviewerSuggestionCandidateKey(candidate?.suggestionId) === row.candidate_key
    ) savedKeys.push(row.candidate_key);
  }
  return { active, excluded, ineligible, blocked, savedKeys, allNames };
}

async function listForRequest(requestId) {
  const res = await observeReviewerFindWarmEffect({
    effectClass: 'postgres_read',
    operation: 'reviewer_roster_list',
  }, async () => sql`
      SELECT candidate_key, status, display_name, candidate, source_kind,
             updated_at::text AS updated_at_token
      FROM reviewer_find_roster
      WHERE request_id = ${requestId}
      ORDER BY updated_at DESC
    `);
  return rosterFromRows(res.rows);
}

/**
 * Remove only active candidates produced by prior Find searches.
 *
 * Applicant-suggested rows are durable applicant input, not search history.
 * Saved, excluded, COI-ledger, and active COI-flagged rows are deliberately
 * preserved. Each submitted key is bound to the updated_at token returned by
 * listForRequest, so a row refreshed by a concurrent/new search is retained.
 * Keep the provenance predicate as an explicit allowlist so a future/unknown
 * kind fails closed until its removal semantics are reviewed.
 */
async function removePreviousActiveSearchResults(requestId, candidateRefs) {
  const refsByKey = new Map();
  for (const ref of Array.isArray(candidateRefs) ? candidateRefs : []) {
    const candidateKey = typeof ref?.candidateKey === 'string' ? ref.candidateKey.trim() : '';
    const updatedAt = typeof ref?.updatedAt === 'string' ? ref.updatedAt.trim() : '';
    if (candidateKey && updatedAt) refsByKey.set(candidateKey, { candidate_key: candidateKey, updated_at_token: updatedAt });
  }
  const refs = Array.from(refsByKey.values());
  if (refs.length === 0) return { removed: 0, removedKeys: [], ...await listForRequest(requestId) };
  const res = await sql`
    WITH deleted AS (
      DELETE FROM reviewer_find_roster AS roster
      USING jsonb_to_recordset(${JSON.stringify(refs)}::jsonb)
        AS target(candidate_key text, updated_at_token text)
      WHERE roster.request_id = ${requestId}
        AND roster.candidate_key = target.candidate_key
        AND roster.updated_at::text = target.updated_at_token
        AND roster.status = 'active'
        AND roster.candidate->>'hasInstitutionCOI' IS DISTINCT FROM 'true'
        AND roster.source_kind IN (
          'cited_reference',
          'proposal_named',
          'referred',
          'literature_retrieved',
          'grounded_seed',
          'barred_parametric',
          'claude_verified',
          'database'
        )
      RETURNING roster.candidate_key
    )
    SELECT
      (SELECT COUNT(*)::int FROM deleted) AS removed,
      COALESCE((SELECT jsonb_agg(candidate_key) FROM deleted), '[]'::jsonb) AS removed_keys,
      COALESCE(
        (
          SELECT jsonb_agg(to_jsonb(remaining) ORDER BY remaining.updated_at DESC)
          FROM (
            SELECT candidate_key, status, display_name, candidate, source_kind,
                   updated_at, updated_at::text AS updated_at_token
            FROM reviewer_find_roster
            WHERE request_id = ${requestId}
              AND candidate_key NOT IN (SELECT candidate_key FROM deleted)
          ) remaining
        ),
        '[]'::jsonb
      ) AS roster_rows
  `;
  const result = res.rows?.[0] || {};
  return {
    removed: Number(result.removed) || 0,
    removedKeys: Array.isArray(result.removed_keys) ? result.removed_keys : [],
    ...rosterFromRows(result.roster_rows),
  };
}

/**
 * Fetch the stored candidate blob for one suggestion on a request, keyed by the
 * canonical `(request_id, suggestion:<suggestionId>)` roster key AND the exact
 * `suggestionId` embedded in the pruned DTO. This is an id anchor, NOT the
 * normalized name (which folds distinct people, e.g. Hamit/Harmit). Used by
 * promote-applicant-reviewer to recover the vetted enrichment email that
 * `enrich-recommended` wrote to the roster but never to Dataverse. Returns the
 * sanitized candidate blob plus server-owned `rosterStatus`, or null when no id-anchored row exists (legacy rows
 * predating `suggestionId`, or a legacy name-only saved row) — the caller must then
 * skip, never fall back to a name match.
 */
async function findCandidateBySuggestion(requestId, suggestionId) {
  if (!requestId || !suggestionId) return null;
  const candidateKey = reviewerSuggestionCandidateKey(suggestionId);
  if (!candidateKey) return null;
  const res = await sql`
    SELECT candidate_key, status, display_name, candidate, source_kind,
           updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate_key = ${candidateKey}
      AND lower(candidate->>'suggestionId') = lower(${suggestionId})
    LIMIT 1
  `;
  if (!res.rows[0]) return null;
  const row = res.rows[0];
  const candidate = candidateFromRow(row);
  return candidate ? {
    ...candidate,
    rosterStatus: row.status,
    rosterUpdatedAt: row.updated_at_token || null,
  } : null;
}

/**
 * Return exactly one server-owned roster row by its canonical correlation key.
 * Unlike `findCandidateBySuggestion`, this helper makes no claim that the key
 * is an applicant anchor; callers must prove that separately from the stored
 * row plus authoritative Dataverse reads.
 */
async function findCandidateByKey(requestId, candidateKey) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  if (!requestId || !key || key.length > 560) return null;
  const res = await sql`
    SELECT candidate_key, status, display_name, candidate, source_kind,
           updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate_key = ${key}
    LIMIT 1
  `;
  if (!res.rows?.[0]) return null;
  const row = res.rows[0];
  const candidate = candidateFromRow(row);
  return candidate ? {
    ...candidate,
    candidateKey: row.candidate_key,
    rosterStatus: row.status,
    rosterUpdatedAt: row.updated_at_token || null,
  } : null;
}

/**
 * Resolve a suggestion to its roster row by the DATAVERSE ANCHOR rather than by the
 * canonical key, preferring the canonical row when both shapes exist.
 *
 * Why this exists (S387): `stampSuggestionAnchor` writes `suggestionId` into a blob
 * without re-keying the row, so a row can carry the anchor while keyed
 * `legacy-row:<id>` (migration 025) or `candidate:<fingerprint>` (a search-origin row
 * that later matched a suggestion). `findCandidateBySuggestion` only matches the
 * canonical key, so those rows are invisible to it and the roster's exclude /
 * mark-saved / confirm-identity actions 409 — staff can see a card they cannot action
 * at all (confirmed by Codex adversarial review of 5a6c863c).
 *
 * DELIBERATELY NOT used by promote-applicant-reviewer. Promotion is the one path where
 * resolving a pre-identity-spine row would be fail-OPEN: those blobs predate the
 * resolver, so their gate inputs are all null and `requiresStaffIdentityConfirmation`
 * would wave them through. Promotion stays canonical-key-only, and canonicalization is
 * a reviewed data migration (scripts/recanonicalize-reviewer-roster-anchors.mjs), not a
 * runtime side effect.
 */
async function findCandidateBySuggestionAnchor(requestId, suggestionId) {
  if (!requestId || !suggestionId) return null;
  const canonicalKey = reviewerSuggestionCandidateKey(suggestionId);
  if (!canonicalKey) return null;
  const res = await sql`
    SELECT candidate_key, status, display_name, candidate, source_kind,
           updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND lower(candidate->>'suggestionId') = lower(${suggestionId})
    ORDER BY (candidate_key = ${canonicalKey}) DESC, updated_at DESC
    LIMIT 1
  `;
  if (!res.rows[0]) return null;
  const row = res.rows[0];
  const candidate = candidateFromRow(row);
  return candidate ? {
    ...candidate,
    rosterStatus: row.status,
    rosterUpdatedAt: row.updated_at_token || null,
  } : null;
}

async function findCandidatesByKeys(requestId, candidateKeys) {
  if (!requestId) return [];
  // Candidate keys may include an encoded affiliation fingerprint; bound the
  // batch count, not an individual server-generated key's character length.
  const keys = Array.from(new Set((Array.isArray(candidateKeys) ? candidateKeys : [])
    .map((key) => (typeof key === 'string' ? key.trim() : ''))
    .filter(Boolean)))
    .slice(0, 100);
  if (keys.length === 0) return [];
  const res = await sql`
    SELECT candidate_key, status, display_name, candidate, source_kind,
           updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate_key IN (
        SELECT value FROM jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)
      )
  `;
  return res.rows.map((row) => {
    const candidate = candidateFromRow(row);
    return candidate ? {
      ...candidate,
      rosterStatus: row.status,
      rosterUpdatedAt: row.updated_at_token || null,
    } : null;
  }).filter(Boolean);
}

async function findEligibilityByCandidateKey(requestId, candidateKey) {
  if (!requestId || !candidateKey) return null;
  const res = await sql`
    SELECT status, candidate
    FROM reviewer_find_roster
    WHERE request_id = ${requestId} AND candidate_key = ${candidateKey}
    LIMIT 1
  `;
  if (!res.rows?.[0]) return null;
  const row = res.rows[0];
  const candidate = candidateFromRow(row);
  return {
    rosterStatus: row.status,
    eligibilityStatus: candidate?.eligibilityStatus
      || candidate?.contactEnrichment?.eligibilityStatus
      || null,
    evidence: candidate?.eligibilityEvidence
      || candidate?.contactEnrichment?.eligibilityEvidence
      || null,
  };
}

/**
 * Backstop-reconciliation scan (Fix A, S317): roster rows (active/saved) whose blob
 * carries a `suggestionId` id anchor AND an enrichment email flagged persistable —
 * i.e. candidates whose vetted email may have failed to reach Dataverse. The
 * `emailPersistAllowed='true'` + non-empty-email predicates are a cheap DB pre-filter;
 * the AUTHORITATIVE gate (`pickVettedEmail`, incl. identity) and the live Dataverse
 * email-empty / ownership checks run in the reconciler service per row. Newest first,
 * capped by `limit`. Returns `{ requestId, candidate }` with the sanitized blob.
 */
async function findReconcilableCandidates(limit = 200) {
  const cap = Math.min(1000, Math.max(1, Number(limit) || 200));
  const res = await sql`
    SELECT request_id, status, display_name, candidate, source_kind
    FROM reviewer_find_roster
    WHERE status IN ('active', 'saved')
      AND candidate->>'suggestionId' IS NOT NULL
      AND (candidate->>'emailPersistAllowed' = 'true'
           OR candidate->'contactEnrichment'->>'emailPersistAllowed' = 'true')
      AND COALESCE(NULLIF(candidate->>'email', ''), NULLIF(candidate->'contactEnrichment'->>'email', '')) IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT ${cap}
  `;
  return res.rows.map((row) => ({ requestId: row.request_id, candidate: candidateFromRow(row) }));
}

const REFRESH_STAGES = new Set(STAGES);

function boundedRefreshText(value, max = 100) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}
function validRefreshText(value, max = 100) { return typeof value === 'string' && value.length > 0 && value.length <= max; }

function allTerminalUpstreamsComplete(stageFreshness) {
  return !!terminalUpstreamReceipts(stageFreshness);
}

function rosterPersistenceReceipt(candidateKey, stageFreshness, completedAt = new Date().toISOString()) {
  return buildRosterPersistenceReceipt({ candidateKey, stageFreshness, completedAt });
}

function stageOutcomeMap(stageFreshness) {
  return Object.fromEntries(Object.entries(stageFreshness || {}).map(([stage, receipt]) => [stage, receipt?.state || 'unknown']));
}

function safeRefreshTarget(requestId, candidateKey, expectedUpdatedAt, stage) {
  return !!requestId
    && validRefreshText(candidateKey, 560)
    && validRefreshText(expectedUpdatedAt, 128)
    && REFRESH_STAGES.has(stage);
}

function stageLeaseBlock(candidate) {
  const blocker = candidateStageLease(candidate);
  if (!blocker) return null;
  if (!blocker.valid) {
    return {
      outcome: 'lease_repair_required',
      code: 'lease_repair_required',
      leaseStage: blocker.stage,
    };
  }
  return {
    outcome: blocker.expired ? 'lease_recovery_required' : 'refresh_in_progress',
    code: blocker.expired ? 'lease_recovery_required' : 'candidate_refresh_in_progress',
    leaseStage: blocker.stage,
  };
}

async function startStageRefresh(requestId, candidateKey, expectedUpdatedAt, stage, { attemptId = randomUUID(), reason = 'manual_refresh', startedAt = new Date().toISOString() } = {}) {
  const safeReason = ['manual_refresh', 'stage_missing', 'stage_incomplete', 'prior_refresh_incomplete', 'stage_contract_changed', 'proposal_content_changed', 'candidate_input_changed'].includes(reason)
    ? reason : 'unclassified_miss';
  if (!safeRefreshTarget(requestId, candidateKey, expectedUpdatedAt, stage) || !validRefreshText(attemptId) || !canonicalIso(startedAt)) {
    return { outcome: 'rejected' };
  }
  const lease = JSON.stringify({
    refreshAttemptId: boundedRefreshText(attemptId),
    refreshStartedAt: boundedRefreshText(startedAt, 80),
    reason: safeReason,
  });
  const res = await sql`
    UPDATE reviewer_find_roster
       SET candidate = candidate || jsonb_build_object(
             'stageRefresh',
             COALESCE(candidate->'stageRefresh', '{}'::jsonb)
               || jsonb_build_object(${stage}::text, ${lease}::jsonb)
           ),
           updated_at = now()
     WHERE request_id = ${requestId}
       AND candidate_key = ${candidateKey}
       AND status = 'active'
       AND updated_at::text = ${expectedUpdatedAt}
       AND COALESCE(candidate->'stageRefresh', '{}'::jsonb) = '{}'::jsonb
    RETURNING candidate, updated_at::text AS updated_at_token
  `;
  if (!(res.rowCount || res.rows?.length)) {
    const current = await findCandidateByKey(requestId, candidateKey);
    return stageLeaseBlock(current) || { outcome: 'skipped_stale' };
  }
  return {
    outcome: 'recorded',
    candidate: candidateFromRow({ candidate: res.rows[0].candidate, candidate_key: candidateKey }),
    updatedAt: res.rows[0].updated_at_token || null,
  };
}

async function readStageRefreshSnapshot(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, { allowLegacyLease = false } = {}) {
  const res = allowLegacyLease ? await sql`
    SELECT candidate_key, status, candidate, updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate_key = ${candidateKey}
      AND status = 'active'
      AND updated_at::text = ${expectedUpdatedAt}
      AND (
        candidate->'stageRefresh'->${stage}->>'refreshAttemptId' = ${attemptId}
        OR candidate->'stageFreshness'->${stage}->>'refreshAttemptId' = ${attemptId}
      )
    LIMIT 1
  ` : await sql`
    SELECT candidate_key, status, candidate, updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate_key = ${candidateKey}
      AND status = 'active'
      AND updated_at::text = ${expectedUpdatedAt}
      AND (
        candidate->'stageRefresh'->${stage}->>'refreshAttemptId' = ${attemptId}
      )
    LIMIT 1
  `;
  const row = res.rows?.[0];
  if (!row) return null;
  const candidate = candidateFromRow(row);
  return candidate ? { candidate, updatedAt: row.updated_at_token || null } : null;
}

function applyTerminalReceipt(candidateKey, candidate, completedAt = new Date().toISOString()) {
  const stageFreshness = { ...(candidate?.stageFreshness || {}) };
  const terminal = rosterPersistenceReceipt(candidateKey, stageFreshness, completedAt);
  if (terminal) stageFreshness.roster_persistence = terminal;
  else delete stageFreshness.roster_persistence;
  return { ...candidate, warmCacheVersion: WARM_CACHE_VERSION, stageFreshness };
}

function completedCandidateForStage(candidateKey, candidate, stage, evidencePatch, receipt) {
  const stageFreshness = { ...(candidate?.stageFreshness || {}), [stage]: receipt };
  const stageRefresh = { ...(candidate?.stageRefresh || {}) };
  delete stageRefresh[stage];
  return applyTerminalReceipt(candidateKey, {
    ...candidate,
    ...(evidencePatch || {}),
    stageFreshness,
    stageRefresh,
  }, receipt.completedAt || new Date().toISOString());
}

function expectedStructuredSourceVersion(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * The historical exact-address receipt remains a compatibility/audit record
 * for promotion callers.  It is deliberately validated here instead of
 * accepting an arbitrary accompanying JSONB patch from the address action.
 */
function projectStructuredAddressReceipt(receipt, { requestId, candidateKey, email } = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.personConfirmed !== true
    || typeof receipt.receiptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(receipt.receiptId)
    || normalizeAddress(receipt.email) !== normalizeAddress(email)
    || receipt.requestId !== requestId || receipt.candidateKey !== candidateKey) {
    return null;
  }
  try {
    const attestation = buildAttestation({
      actorProfileId: receipt.actorProfileId,
      actorSystemUserId: receipt.actorSystemUserId,
      requestId,
      candidateKey,
      evidenceType: receipt.evidenceType,
      evidenceUrl: receipt.evidenceUrl,
      note: receipt.note,
      attestedAt: receipt.attestedAt,
    });
    const canonicalPersonId = typeof receipt.canonicalPersonId === 'string'
      && receipt.canonicalPersonId.trim().length > 0
      && receipt.canonicalPersonId.trim().length <= 80
      ? receipt.canonicalPersonId.trim()
      : null;
    const canonicalPersonEtag = typeof receipt.canonicalPersonEtag === 'string'
      && receipt.canonicalPersonEtag.trim().length > 0
      && receipt.canonicalPersonEtag.trim().length <= 240
      ? receipt.canonicalPersonEtag.trim()
      : null;
    if (!canonicalPersonId || !canonicalPersonEtag) return null;
    return {
      receiptId: receipt.receiptId,
      email: normalizeAddress(email),
      personConfirmed: true,
      ...attestation,
      canonicalPersonId,
      canonicalPersonEtag,
    };
  } catch {
    return null;
  }
}

/**
 * Dedicated structured-address completion.  Unlike ordinary one-stage
 * refreshes, one staff exact-address decision replaces the contact and
 * address-trust receipts as one logical event.  Both envelopes are projected
 * before the row is read/written, and one candidate-key + updated-at CAS
 * publishes the pair plus the derived terminal receipt (or invalidates it).
 */
async function completeStructuredAddressVerification(
  requestId,
  candidateKey,
  expectedUpdatedAt,
  {
    contactEnvelope,
    addressTrustEnvelope,
    expectedSourceVersions,
    legacyAddressReceipt = null,
  } = {},
) {
  if (!requestId || !validRefreshText(candidateKey, 560) || !validRefreshText(expectedUpdatedAt, 128)) {
    return { outcome: 'rejected', code: 'invalid_refresh_target' };
  }
  const contactExpectedSource = expectedStructuredSourceVersion(expectedSourceVersions?.contact);
  const addressExpectedSource = expectedStructuredSourceVersion(expectedSourceVersions?.address_trust);
  const projectedContact = projectStageEnvelope({
    stage: 'contact', mode: 'manual_refresh', envelope: contactEnvelope,
  });
  const projectedAddressTrust = projectStageEnvelope({
    stage: 'address_trust', mode: 'manual_refresh', envelope: addressTrustEnvelope,
  });
  if (!contactExpectedSource || !addressExpectedSource
    || !projectedContact.ok || !projectedAddressTrust.ok
    || projectedContact.value.receipt.sourceVersion !== contactExpectedSource
    || projectedAddressTrust.value.receipt.sourceVersion !== addressExpectedSource) {
    return { outcome: 'rejected', code: 'invalid_structured_stage_evidence' };
  }
  const structuredReceipt = projectStructuredAddressReceipt(legacyAddressReceipt, {
    requestId,
    candidateKey,
    email: projectedContact.value.evidencePatch.email,
  });
  if (!structuredReceipt
    || projectedAddressTrust.value.evidencePatch.addressTrustEmail !== structuredReceipt.email) {
    return { outcome: 'rejected', code: 'invalid_structured_address_receipt' };
  }

  const current = await findCandidateByKey(requestId, candidateKey);
  if (!current || current.rosterStatus !== 'active' || current.rosterUpdatedAt !== expectedUpdatedAt) {
    return { outcome: 'skipped_stale' };
  }
  const leaseBlock = stageLeaseBlock(current);
  if (leaseBlock) return leaseBlock;
  const stageFreshness = {
    ...(current.stageFreshness || {}),
    contact: projectedContact.value.receipt,
    address_trust: projectedAddressTrust.value.receipt,
  };
  const nextCandidate = applyTerminalReceipt(candidateKey, {
    ...current,
    ...projectedContact.value.evidencePatch,
    ...projectedAddressTrust.value.evidencePatch,
    addressTrustReceipt: structuredReceipt,
    stageFreshness,
  }, projectedAddressTrust.value.receipt.completedAt || new Date().toISOString());
  delete nextCandidate.rosterUpdatedAt;
  delete nextCandidate.rosterStatus;

  const res = await sql`
    UPDATE reviewer_find_roster
       SET candidate = ${JSON.stringify(nextCandidate)}::jsonb,
           updated_at = now()
     WHERE request_id = ${requestId}
       AND candidate_key = ${candidateKey}
       AND status = 'active'
       AND updated_at::text = ${expectedUpdatedAt}
    RETURNING candidate, updated_at::text AS updated_at_token
  `;
  if (!(res.rowCount || res.rows?.length)) return { outcome: 'skipped_stale' };
  return {
    outcome: 'recorded',
    candidate: candidateFromRow({ candidate: res.rows[0].candidate, candidate_key: candidateKey }),
    updatedAt: res.rows[0].updated_at_token || null,
  };
}

async function replaceLeasedCandidate(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, candidate, { allowLegacyLease = false } = {}) {
  const res = allowLegacyLease ? await sql`
    UPDATE reviewer_find_roster
       SET candidate = ${JSON.stringify(candidate)}::jsonb,
           updated_at = now()
     WHERE request_id = ${requestId}
       AND candidate_key = ${candidateKey}
       AND status = 'active'
       AND updated_at::text = ${expectedUpdatedAt}
       AND (
         reviewer_find_roster.candidate->'stageRefresh'->${stage}->>'refreshAttemptId' = ${attemptId}
         OR reviewer_find_roster.candidate->'stageFreshness'->${stage}->>'refreshAttemptId' = ${attemptId}
       )
    RETURNING candidate, updated_at::text AS updated_at_token
  ` : await sql`
    UPDATE reviewer_find_roster
       SET candidate = ${JSON.stringify(candidate)}::jsonb,
           updated_at = now()
     WHERE request_id = ${requestId}
       AND candidate_key = ${candidateKey}
       AND status = 'active'
       AND updated_at::text = ${expectedUpdatedAt}
       AND (
         reviewer_find_roster.candidate->'stageRefresh'->${stage}->>'refreshAttemptId' = ${attemptId}
       )
    RETURNING candidate, updated_at::text AS updated_at_token
  `;
  if (!(res.rowCount || res.rows?.length)) return { outcome: 'skipped_stale' };
  return {
    outcome: 'recorded',
    candidate: candidateFromRow({ candidate: res.rows[0].candidate, candidate_key: candidateKey }),
    updatedAt: res.rows[0].updated_at_token || null,
  };
}

/**
 * Complete one leased stage and, in the same guarded write, converge (or
 * invalidate) the terminal roster receipt. No caller can provide an arbitrary
 * JSONB patch: `projectStageEnvelope` owns every stage's field allowlist.
 */
async function completeStageRefreshWithEvidence(
  requestId,
  candidateKey,
  expectedUpdatedAt,
  stage,
  attemptId,
  envelope,
) {
  if (!safeRefreshTarget(requestId, candidateKey, expectedUpdatedAt, stage) || !validRefreshText(attemptId)) {
    return { outcome: 'rejected' };
  }
  const projected = projectStageEnvelope({ stage, mode: 'manual_refresh', envelope });
  if (!projected.ok) return { outcome: 'rejected', code: projected.code };
  const { evidencePatch, receipt } = projected.value;
  const snapshot = await readStageRefreshSnapshot(
    requestId, candidateKey, expectedUpdatedAt, stage, attemptId,
  );
  if (!snapshot) return { outcome: 'skipped_stale' };
  const nextCandidate = completedCandidateForStage(
    candidateKey, snapshot.candidate, stage, evidencePatch, receipt,
  );
  const persisted = await replaceLeasedCandidate(
    requestId, candidateKey, snapshot.updatedAt, stage, attemptId, nextCandidate,
  );
  if (persisted.outcome !== 'recorded') return persisted;
  if (receipt.state === 'incomplete') return { ...persisted, outcome: 'failed_retryable' };
  if (receipt.state === 'failed') return { ...persisted, outcome: 'failed_terminal' };
  return persisted;
}

async function completeStageRefresh(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, receipt = {}) {
  const state = receipt.state || 'current';
  const completedAt = Object.prototype.hasOwnProperty.call(receipt, 'completedAt')
    ? receipt.completedAt
    : (state === 'current' || state === 'not_applicable' ? new Date().toISOString() : null);
  return completeStageRefreshWithEvidence(
    requestId,
    candidateKey,
    expectedUpdatedAt,
    stage,
    attemptId,
    {
      outcome: state,
      evidencePatch: {},
      receipt: { ...receipt, completedAt },
    },
  );
}

async function writeFailedStageRefresh(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, {
  state,
  failureCode,
  reasonCode,
  expectedSourceVersion,
  requireExpiredBefore = null,
  allowLegacyLease = false,
} = {}) {
  if (!safeRefreshTarget(requestId, candidateKey, expectedUpdatedAt, stage)
    || !validRefreshText(attemptId)
    || !['incomplete', 'failed'].includes(state)
    || !['retryable_failure', 'terminal_failure'].includes(failureCode)
    || !expectedStructuredSourceVersion(expectedSourceVersion)) {
    return { outcome: 'rejected' };
  }
  const snapshot = await readStageRefreshSnapshot(
    requestId, candidateKey, expectedUpdatedAt, stage, attemptId, { allowLegacyLease },
  );
  if (!snapshot) return { outcome: 'skipped_stale' };
  // The service selects the candidate-wide lease owner before it calls this
  // store primitive. Repeat that narrow guard here so a future direct caller
  // cannot clear an expired secondary lease while a different stage owns the
  // row. Legacy stageFreshness-only leases have no stageRefresh owner and
  // remain eligible for their exact-stage compatibility recovery below.
  const leaseOwner = candidateStageLease(snapshot.candidate);
  if (requireExpiredBefore !== null && leaseOwner && !leaseOwner.valid) return { outcome: 'skipped_stale' };
  if (requireExpiredBefore !== null && leaseOwner && leaseOwner.stage !== stage) return { outcome: 'skipped_stale' };
  const liveLease = snapshot.candidate?.stageRefresh?.[stage]
    || snapshot.candidate?.stageFreshness?.[stage];
  if (requireExpiredBefore !== null) {
    const startedAt = liveLease?.refreshStartedAt;
    if (!canonicalIso(startedAt) || Date.now() - Date.parse(startedAt) <= requireExpiredBefore) {
      return { outcome: 'skipped_stale' };
    }
  }
  const sourceVersion = expectedSourceVersion.toLowerCase();
  const resultVersion = boundedDigest('reviewer-stage-failure-result:v1', { candidateKey, stage, failureCode });
  const receipt = {
    state,
    contractVersion: CONTRACT_VERSIONS[stage],
    sourceVersion,
    resultVersion,
    completedAt: null,
    reasonCode: null,
    failureCode,
  };
  const nextCandidate = completedCandidateForStage(candidateKey, snapshot.candidate, stage, {}, receipt);
  const persisted = await replaceLeasedCandidate(
    requestId, candidateKey, snapshot.updatedAt, stage, attemptId, nextCandidate, { allowLegacyLease },
  );
  if (persisted.outcome !== 'recorded') return persisted;
  return { ...persisted, outcome: state === 'failed' ? 'failed_terminal' : 'failed_retryable' };
}

async function failStageRefresh(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, {
  terminal = false,
  errorCode,
  expectedSourceVersion,
} = {}) {
  const failureCode = ['retryable_failure', 'terminal_failure'].includes(errorCode)
    ? errorCode
    : (terminal ? 'terminal_failure' : 'retryable_failure');
  const result = await writeFailedStageRefresh(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, {
    state: terminal ? 'failed' : 'incomplete',
    failureCode,
    reasonCode: terminal ? 'stage_incomplete' : 'prior_write_incomplete',
    expectedSourceVersion,
  });
  const outcome = terminal ? 'failed_terminal' : 'failed_retryable';
  return result.outcome === 'recorded' ? { ...result, outcome } : result;
}

async function recoverExpiredStageRefresh(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, {
  leaseMs = 15 * 60 * 1000,
  expectedSourceVersion,
} = {}) {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) return { outcome: 'rejected' };
  const result = await writeFailedStageRefresh(requestId, candidateKey, expectedUpdatedAt, stage, attemptId, {
    state: 'incomplete',
    failureCode: 'retryable_failure',
    reasonCode: 'prior_refresh_incomplete',
    expectedSourceVersion,
    requireExpiredBefore: leaseMs,
    allowLegacyLease: true,
  });
  return result.outcome === 'recorded' ? { ...result, outcome: 'failed_retryable' } : result;
}

/** Explicit, provider-free legacy repair. The route does not dispatch this
 * stage yet; it exists so the later UI action cannot accidentally use a full
 * enrichment path to repair a missing terminal receipt. */
async function finalizeCachedRosterEvidence(requestId, candidateKey, expectedUpdatedAt) {
  if (!safeRefreshTarget(requestId, candidateKey, expectedUpdatedAt, 'roster_persistence')) {
    return { outcome: 'rejected' };
  }
  const current = await findCandidateByKey(requestId, candidateKey);
  if (!current || current.rosterStatus !== 'active' || current.rosterUpdatedAt !== expectedUpdatedAt) {
    return { outcome: 'skipped_stale' };
  }
  const nextCandidate = applyTerminalReceipt(candidateKey, current);
  if (!nextCandidate.stageFreshness?.roster_persistence) return { outcome: 'rejected', code: 'upstream_receipts_incomplete' };
  // Row projection metadata is returned alongside the candidate JSONB for CAS
  // callers, but is not part of the durable candidate document.
  delete nextCandidate.rosterStatus;
  delete nextCandidate.rosterUpdatedAt;
  const res = await sql`
    UPDATE reviewer_find_roster
       SET candidate = ${JSON.stringify(nextCandidate)}::jsonb,
           updated_at = now()
     WHERE request_id = ${requestId}
       AND candidate_key = ${candidateKey}
       AND status = 'active'
       AND updated_at::text = ${expectedUpdatedAt}
    RETURNING candidate, updated_at::text AS updated_at_token
  `;
  if (!(res.rowCount || res.rows?.length)) return { outcome: 'skipped_stale' };
  return {
    outcome: 'recorded',
    candidate: candidateFromRow({ candidate: res.rows[0].candidate, candidate_key: candidateKey }),
    updatedAt: res.rows[0].updated_at_token || null,
  };
}

module.exports = {
  PER_REQUEST_ACTIVE_CAP,
  recordSurfaced: observedRosterWrite('reviewer_roster_write', recordSurfaced),
  recordSurfacedWithStageEvidence: observedRosterWrite('reviewer_roster_write', recordSurfacedWithStageEvidence),
  recordCoiDropped: observedRosterWrite('reviewer_roster_write', recordCoiDropped),
  setExcluded: observedRosterWrite('reviewer_roster_write', setExcluded),
  promote: observedRosterWrite('reviewer_roster_write', promote),
  confirmIdentity: observedRosterWrite('reviewer_roster_write', confirmIdentity),
  findIdentityConfirmation,
  attestAddress: observedRosterWrite('reviewer_roster_write', attestAddress),
  clearAddressTrustBlocks: observedRosterWrite('reviewer_roster_write', clearAddressTrustBlocks),
  findAddressTrustReceipt,
  finalizeCandidatePromotion: observedRosterWrite('reviewer_roster_write', finalizeCandidatePromotion),
  promotionSnapshotIsCurrent,
  markPromotionBlocked: observedRosterWrite('reviewer_roster_write', markPromotionBlocked),
  stampSuggestionAnchor: observedRosterWrite('reviewer_roster_write', stampSuggestionAnchor),
  listForRequest,
  removePreviousActiveSearchResults: observedRosterWrite('reviewer_roster_write', removePreviousActiveSearchResults),
  findCandidateBySuggestion,
  findCandidateByKey,
  findCandidateBySuggestionAnchor,
  findCandidatesByKeys,
  findEligibilityByCandidateKey,
  findReconcilableCandidates,
  startStageRefresh: observedRosterWrite('reviewer_roster_write', startStageRefresh),
  completeStageRefresh: observedRosterWrite('reviewer_roster_write', completeStageRefresh),
  completeStageRefreshWithEvidence: observedRosterWrite('reviewer_roster_write', completeStageRefreshWithEvidence),
  completeStructuredAddressVerification: observedRosterWrite('reviewer_roster_write', completeStructuredAddressVerification),
  failStageRefresh: observedRosterWrite('reviewer_roster_write', failStageRefresh),
  recoverExpiredStageRefresh: observedRosterWrite('reviewer_roster_write', recoverExpiredStageRefresh),
  finalizeCachedRosterEvidence: observedRosterWrite('reviewer_roster_write', finalizeCachedRosterEvidence),
  rosterPersistenceReceipt,
  allTerminalUpstreamsComplete,
};
