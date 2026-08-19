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
const {
  reviewerCandidateKey,
  reviewerSuggestionCandidateKey,
  withReviewerCandidateKey,
} = require('../utils/reviewer-candidate-key');
const { PROVENANCE_KINDS, SEED_ROLES, provenanceKindOf, withReviewerProvenance, sanitizeInstitutionCOIDetails } = require('../utils/reviewer-provenance');
const { ContactParser } = require('../utils/contact-parser');
const { normalizeOrcid } = require('../utils/orcid-normalize');
const { buildAttestation, normalizeAddress } = require('../utils/reviewer-address-trust');

// Max active/saved rows retained per request. Bounds growth in v1 (a TTL cron is
// a follow-up). Excluded, ineligible, and COI-drop ledger rows are never evicted.
const PER_REQUEST_ACTIVE_CAP = 300;

function sourceKindOf(candidate) {
  return provenanceKindOf(candidate);
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
    const name = candidate && candidate.name;
    const normalized = normalizeReviewerName(name);
    const candidateKey = reviewerCandidateKey(candidate);
    const eligibilityStatus = candidate.eligibilityStatus
      || candidate.contactEnrichment?.eligibilityStatus
      || 'unknown';
    const rosterStatus = eligibilityStatus === 'deceased' ? 'ineligible' : 'active';
    if (!normalized || !candidateKey) continue; // unnamed / junk — nothing to correlate
    try {
      const result = await sql`
        INSERT INTO reviewer_find_roster
          (request_id, candidate_key, normalized_name, display_name, status, candidate, source_kind)
        VALUES (${requestId}, ${candidateKey}, ${normalized}, ${String(name)}, ${rosterStatus}, ${JSON.stringify(candidate)}, ${sourceKindOf(candidate)})
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
                THEN ${JSON.stringify(candidate)}::jsonb || jsonb_build_object(
                  'addressTrustReceipt', reviewer_find_roster.candidate->'addressTrustReceipt'
                )
                ELSE ${JSON.stringify(candidate)}::jsonb
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

/** Evict the oldest active/saved rows beyond the per-request cap. */
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
 * Returns the stored candidate blob on success.
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
  return res.rows[0] ? res.rows[0].candidate : null;
}

/**
 * Record an authenticated staff identity confirmation on an existing active
 * roster row. The opaque id is the only client-carried reference; save-candidates
 * re-reads this server record and checks the exact canonical manual contact.
 */
async function confirmIdentity(requestId, candidate, {
  actorProfileId = null,
  actorSystemUserId = null,
} = {}) {
  const safeCandidate = withReviewerCandidateKey(sanitizeCandidateWebsite(withReviewerProvenance(candidate)));
  const contact = canonicalManualConfirmation(safeCandidate);
  const candidateKey = reviewerCandidateKey(safeCandidate);
  if (!requestId || !candidateKey || !contact.normalizedName || !contact.email) {
    throw new Error('reviewer-roster.confirmIdentity: request, candidate key/name, and email required');
  }
  const confirmationId = randomUUID();
  const confirmation = {
    confirmationId,
    source: 'staff_confirmed',
    ...contact,
    actorProfileId,
    actorSystemUserId,
    confirmedAt: new Date().toISOString(),
  };
  const confirmedCandidate = {
    ...safeCandidate,
    name: safeCandidate.name,
    email: contact.email,
    emailSource: 'manual',
    website: contact.website || null,
    websiteSource: contact.website ? 'manual' : null,
    affiliation: contact.affiliation || null,
    manualContactFields: ['email', 'website', 'affiliation'],
    contactEnrichment: {
      ...(safeCandidate.contactEnrichment || {}),
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
    RETURNING candidate
  `;
  if (!res.rows?.[0]) return null;
  return {
    confirmationId,
    candidate: candidateFromRow(res.rows[0]),
  };
}

/**
 * Persist non-address contact draft fields on an existing active Find row.
 * This updates only the request-scoped Postgres roster; it never writes the
 * Dataverse person. Email changes remain exclusively owned by attestAddress /
 * confirmIdentity because they require exact-person evidence.
 */
async function updateContactDraft(requestId, candidateKey, updates = {}) {
  const key = typeof candidateKey === 'string' ? candidateKey.trim() : '';
  const hasWebsite = Object.prototype.hasOwnProperty.call(updates, 'website');
  const hasAffiliation = Object.prototype.hasOwnProperty.call(updates, 'affiliation');
  if (!requestId || !key || (!hasWebsite && !hasAffiliation)) return null;

  const currentRes = await sql`
    SELECT candidate_key, status, candidate, source_kind,
           updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
      AND candidate_key = ${key}
      AND status = 'active'
    LIMIT 1
  `;
  const currentRow = currentRes.rows?.[0];
  const current = candidateFromRow(currentRow);
  if (!current) return null;

  const manualFields = new Set(Array.isArray(current.manualContactFields)
    ? current.manualContactFields
    : []);
  const contactEnrichment = { ...(current.contactEnrichment || {}) };
  const next = { ...current, contactEnrichment };
  if (hasWebsite) {
    const submittedWebsite = typeof updates.website === 'string' ? updates.website.trim() : '';
    const website = ContactParser.sanitizeWebsiteForCandidate(submittedWebsite, current.name) || null;
    if (submittedWebsite && !website) {
      const error = new Error('Website must be a valid individual profile page, not a document or directory link.');
      error.code = 'invalid_contact_draft';
      throw error;
    }
    manualFields.add('website');
    next.website = website;
    next.websiteSource = website ? 'manual' : null;
    next.websitePersistAllowed = !!website;
    contactEnrichment.website = website;
    contactEnrichment.websiteSource = website ? 'manual' : null;
    contactEnrichment.websitePersistAllowed = !!website;
    contactEnrichment.contactStatus = null;
    contactEnrichment.contactStatusReason = null;
  }
  if (hasAffiliation) {
    const affiliation = typeof updates.affiliation === 'string'
      ? updates.affiliation.trim() || null
      : null;
    manualFields.add('affiliation');
    next.affiliation = affiliation;
    next.affiliationSource = 'staff_manual';
    next.affiliationPersistAllowed = true;
    contactEnrichment.affiliation = affiliation;
    contactEnrichment.affiliationSource = 'staff_manual';
    contactEnrichment.affiliationPersistAllowed = true;
  }
  next.manualContactFields = Array.from(manualFields);

  const applicantManaged = currentRow.source_kind === 'applicant_suggested'
    || current.isApplicantRecommended === true
    || current.provenance?.kind === 'applicant_suggested';
  if (!applicantManaged) {
    // Website/affiliation participate in both automated and staff-confirmation
    // contact digests. Editing either makes those exact bundles stale. Clear the
    // obsolete grants and surface the explicit confirmation remedy immediately;
    // never leave a card looking promotable only to fail later with an opaque
    // identity_attestation_required response.
    delete next.automatedIdentityAttestation;
    delete next.pdIdentityConfirmed;
    delete next.pdIdentityConfirmationId;
    delete next.staffIdentityConfirmation;
    next.serverIdentityReviewReason = 'manual_contact_changed';
  }

  const res = await sql`
    UPDATE reviewer_find_roster
      SET candidate = ${JSON.stringify(next)}::jsonb,
          updated_at = now()
      WHERE request_id = ${requestId}
        AND candidate_key = ${key}
        AND status = 'active'
        AND updated_at = ${currentRow.updated_at_token}::timestamptz
    RETURNING candidate_key, status, candidate, source_kind,
              updated_at::text AS updated_at_token
  `;
  const row = res.rows?.[0];
  const candidate = candidateFromRow(row);
  return candidate ? {
    ...candidate,
    rosterStatus: row.status,
    rosterUpdatedAt: row.updated_at_token || null,
  } : null;
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
 * status are updated. If the active row was evicted, the server may recreate it
 * from the already-validated candidate so cross-run dedup still converges.
 */
async function finalizeCandidatePromotion(
  requestId,
  candidate,
  { candidateKey, suggestionId, potentialReviewerId } = {},
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
  const res = await sql`
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
  const res = await sql`
    SELECT candidate_key, status, display_name, candidate, source_kind,
           updated_at::text AS updated_at_token
    FROM reviewer_find_roster
    WHERE request_id = ${requestId}
    ORDER BY updated_at DESC
  `;
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

module.exports = {
  PER_REQUEST_ACTIVE_CAP,
  recordSurfaced,
  recordCoiDropped,
  setExcluded,
  promote,
  confirmIdentity,
  updateContactDraft,
  findIdentityConfirmation,
  attestAddress,
  clearAddressTrustBlocks,
  findAddressTrustReceipt,
  finalizeCandidatePromotion,
  markPromotionBlocked,
  stampSuggestionAnchor,
  listForRequest,
  removePreviousActiveSearchResults,
  findCandidateBySuggestion,
  findCandidateBySuggestionAnchor,
  findCandidatesByKeys,
  findEligibilityByCandidateKey,
  findReconcilableCandidates,
};
