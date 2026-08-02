/**
 * Reviewer Find stage evidence projector.
 *
 * Producers return the closed envelope documented in
 * `REVIEWER_WARM_STAGE_PRODUCER_SPEC.md`; this module is the single boundary
 * that converts it into persistable roster evidence. It is deliberately pure:
 * it starts no provider work, reads no authority, and accepts no browser DTO.
 */

const { createHash } = require('crypto');
const {
  CONTRACT_VERSIONS,
  canonicalIso,
  boundedVersion,
} = require('../reviewer-stage-freshness');

const EXECUTION_MODES = new Set(['cold_emit', 'manual_refresh']);
const RECEIPT_STATES = new Set(['current', 'not_applicable', 'incomplete', 'failed']);
const NOT_APPLICABLE_REASONS = new Set([
  'server_not_applicable',
  'identity_not_authoritative',
  'no_proposal_authors',
  'no_trusted_domains',
  'missing_email',
]);
const FAILURE_CODES = new Set([
  'retryable_failure',
  'terminal_failure',
  'authority_changed',
  'provider_unavailable',
  'partial_coverage',
  'missing_required_input',
]);
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS_EVIDENCE_TYPES = new Set([
  'publication_corresponding_author', 'institution_page', 'direct_correspondence', 'other',
]);
const OPAQUE_SOURCE_VERSION_RE = /^[a-f0-9]{64}$/i;

// Top-level roster fields are the only evidence a stage may mutate. Nested
// values remain bounded below; this prevents a producer from replacing a
// different stage's receipt, promotion marker, or arbitrary candidate DTO.
const STAGE_EVIDENCE_KEYS = Object.freeze({
  applicant_anchor: Object.freeze([
    'applicantInputVersion', 'suggestionId', 'potentialReviewerId', 'applicantKnownReviewer',
  ]),
  identity: Object.freeze([
    'identityDecision', 'identityEvidence', 'orcid', 'openAlexAuthorId',
    'identityResolverVersion', 'identityResolvedAt', 'potentialReviewerId',
    // The proposal version is authority captured by the server around the
    // proposal-dependent identity operation.  It is not accepted from a
    // browser candidate blob; only the identity producer may carry it through
    // this allowlist, and its value is restricted below.
    'proposalContentVersion', 'staffIdentityConfirmation', 'pdIdentityConfirmed', 'pdIdentityConfirmationId',
  ]),
  institution_domains: Object.freeze([
    'institutionDomainEvidence', 'trustedInstitutionDomains', 'plausibleInstitutionDomains',
  ]),
  institution_coi: Object.freeze(['hasInstitutionCOI', 'institutionCOIDetails', 'institutionCoiEvidence']),
  coauthor_coi: Object.freeze([
    'hasCoauthorCOI', 'coauthorships', 'coauthorSharedPaperTotal',
    'coauthorMaxWithOneAuthor', 'coauthorCOIStrength', 'coauthorCheckStatus',
    'coauthorCheckFailures', 'coauthorAuthorResults', 'proposalAuthorVersion',
  ]),
  eligibility: Object.freeze([
    'eligibilityStatus', 'eligibilityCheckStatus', 'eligibilityReason', 'eligibilityEvidence',
  ]),
  contact: Object.freeze([
    'email', 'emailSource', 'emailPersistAllowed', 'emailEvidence', 'emailAction',
    'emailActionReason', 'website', 'websiteSource', 'websitePersistAllowed',
    'facultyPageUrl', 'affiliation', 'affiliationSource', 'affiliationPersistAllowed',
    'contactStatus', 'contactStatusReason', 'contactLeads', 'contactTierSummary',
    // Coupled server-read person version used to reproduce warm sources.
    // Browser DTOs cannot choose this allowlisted stage or its input.
    'canonicalPersonId', 'canonicalPersonEtag', 'personEtag',
  ]),
  address_trust: Object.freeze([
    'addressTrustStatus', 'addressTrustReason', 'addressTrustEmail',
    'addressTrustSource', 'addressTrustEvidence',
  ]),
  roster_persistence: Object.freeze([]),
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value, depth = 0, budget = { entries: 0 }) {
  if (depth > 5) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.normalize('NFKC').trim();
    return normalized.length <= 2048 ? normalized : null;
  }
  if (Array.isArray(value)) {
    if (value.length > 16) return null;
    const result = [];
    for (const entry of value) {
      const canonical = canonicalValue(entry, depth + 1, budget);
      if (canonical === null && entry !== null) return null;
      result.push(canonical);
    }
    return result;
  }
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 32) return null;
  const result = {};
  for (const [key, entry] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)) return null;
    budget.entries += 1;
    if (budget.entries > 96) return null;
    const canonical = canonicalValue(entry, depth + 1, budget);
    if (canonical === null && entry !== null) return null;
    result[key] = canonical;
  }
  return result;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function boundedDigest(namespace, value) {
  return createHash('sha256')
    .update(`${namespace}\n${stableStringify(value)}`)
    .digest('hex');
}

function reject(code) {
  return { ok: false, code };
}

function projectCoauthorAuthorResults(value) {
  if (!Array.isArray(value) || value.length > 16) return null;
  const seenAuthors = new Set();
  const results = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return null;
    const keys = Object.keys(entry);
    if (keys.some((key) => !['author', 'status', 'sharedPaperCount', 'papers'].includes(key))) return null;
    const author = typeof entry.author === 'string' ? entry.author.normalize('NFKC').trim() : '';
    if (!author || author.length > 200 || seenAuthors.has(author.toLocaleLowerCase('en-US'))) return null;
    if (!['complete', 'failed'].includes(entry.status)) return null;
    if (!Number.isInteger(entry.sharedPaperCount) || entry.sharedPaperCount < 0 || entry.sharedPaperCount > 10000) return null;
    const papers = entry.papers === undefined ? [] : entry.papers;
    if (!Array.isArray(papers) || papers.length > 3) return null;
    const projectedPapers = [];
    for (const paper of papers) {
      if (!isPlainObject(paper) || Object.keys(paper).some((key) => !['pmid', 'title', 'year'].includes(key))) return null;
      const pmid = paper.pmid === undefined ? null : String(paper.pmid).trim();
      const title = paper.title === undefined ? null : String(paper.title).normalize('NFKC').trim();
      const year = paper.year === undefined ? null : paper.year;
      if ((pmid !== null && (!pmid || pmid.length > 32))
        || (title !== null && (!title || title.length > 400))
        || (year !== null && (!Number.isInteger(year) || year < 1800 || year > 2100))) return null;
      projectedPapers.push({ pmid, title, year });
    }
    seenAuthors.add(author.toLocaleLowerCase('en-US'));
    results.push({ author, status: entry.status, sharedPaperCount: entry.sharedPaperCount, papers: projectedPapers });
  }
  return results;
}

function projectAddressTrustEvidence(value) {
  if (value === null) return null;
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  const allowed = new Set([
    'canonicalPersonId', 'canonicalPersonEtag', 'actorId', 'attestedAt', 'evidenceType', 'evidenceUrl',
  ]);
  if (keys.some((key) => !allowed.has(key))) return null;
  const canonicalPersonId = typeof value.canonicalPersonId === 'string'
    ? value.canonicalPersonId.trim().toLowerCase()
    : null;
  const canonicalPersonEtag = typeof value.canonicalPersonEtag === 'string'
    ? value.canonicalPersonEtag.trim()
    : null;
  const actorId = typeof value.actorId === 'string' ? value.actorId.trim() : null;
  const attestedAt = value.attestedAt;
  const evidenceType = value.evidenceType;
  const evidenceUrl = value.evidenceUrl === undefined ? null : value.evidenceUrl;
  if (!canonicalPersonId || !GUID_RE.test(canonicalPersonId)
    || !canonicalPersonEtag || canonicalPersonEtag.length > 240
    || !actorId || actorId.length > 120
    || !canonicalIso(attestedAt) || !ADDRESS_EVIDENCE_TYPES.has(evidenceType)
    || (evidenceUrl !== null && (typeof evidenceUrl !== 'string' || evidenceUrl.length > 2000 || !/^https?:\/\//i.test(evidenceUrl)))) return null;
  return {
    canonicalPersonId,
    canonicalPersonEtag,
    actorId,
    attestedAt,
    evidenceType,
    evidenceUrl,
  };
}

function projectStaffIdentityConfirmation(value) {
  if (!isPlainObject(value)) return null;
  const allowed = new Set([
    'state', 'canonicalPersonId', 'canonicalPersonEtag', 'actorId', 'confirmedAt',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const canonicalPersonId = typeof value.canonicalPersonId === 'string'
    ? value.canonicalPersonId.trim().toLowerCase()
    : null;
  const canonicalPersonEtag = typeof value.canonicalPersonEtag === 'string'
    ? value.canonicalPersonEtag.trim()
    : null;
  const actorId = typeof value.actorId === 'string' ? value.actorId.trim() : null;
  if (value.state !== 'confirmed'
    || !canonicalPersonId || !GUID_RE.test(canonicalPersonId)
    || !canonicalPersonEtag || canonicalPersonEtag.length > 240
    || !actorId || actorId.length > 120
    || !canonicalIso(value.confirmedAt)) return null;
  return {
    state: 'confirmed',
    canonicalPersonId,
    canonicalPersonEtag,
    actorId,
    confirmedAt: value.confirmedAt,
  };
}

function projectEvidencePatch(stage, evidencePatch) {
  if (!isPlainObject(evidencePatch || {})) return reject('invalid_evidence_patch');
  const allowlist = STAGE_EVIDENCE_KEYS[stage];
  if (!allowlist) return reject('unknown_stage');
  const result = {};
  for (const [key, value] of Object.entries(evidencePatch || {})) {
    if (!allowlist.includes(key)) return reject('evidence_key_rejected');
    if (key === 'coauthorAuthorResults') {
      const authorResults = projectCoauthorAuthorResults(value);
      if (authorResults === null) return reject('evidence_value_rejected');
      result[key] = authorResults;
      continue;
    }
    if (key === 'addressTrustEvidence') {
      const addressEvidence = projectAddressTrustEvidence(value);
      if (addressEvidence === null && value !== null) return reject('evidence_value_rejected');
      result[key] = addressEvidence;
      continue;
    }
    if (key === 'staffIdentityConfirmation') {
      const confirmation = projectStaffIdentityConfirmation(value);
      if (confirmation === null) return reject('evidence_value_rejected');
      result[key] = confirmation;
      continue;
    }
    const canonical = canonicalValue(value);
    if (canonical === null && value !== null) return reject('evidence_value_rejected');
    // The only proposal-derived value carried through this generic evidence
    // channel is a sealed opaque author-set fingerprint. It deliberately does
    // not retain author prose, proposal text, or arbitrary provider payloads.
    if (key === 'proposalAuthorVersion' && (
      typeof canonical !== 'string' || !/^[a-f0-9]{64}$/i.test(canonical)
    )) return reject('evidence_value_rejected');
    if (key === 'proposalContentVersion' && (
      typeof canonical !== 'string' || !/^[a-f0-9]{64}$/i.test(canonical)
    )) return reject('evidence_value_rejected');
    result[key] = canonical;
  }
  const canonicalPersonKeys = ['canonicalPersonId', 'canonicalPersonEtag', 'personEtag'];
  if (canonicalPersonKeys.some((key) => Object.prototype.hasOwnProperty.call(result, key))) {
    const canonicalPersonId = result.canonicalPersonId;
    const canonicalPersonEtag = result.canonicalPersonEtag;
    const personEtag = result.personEtag;
    if (stage !== 'contact'
      || typeof canonicalPersonId !== 'string' || !GUID_RE.test(canonicalPersonId)
      || typeof canonicalPersonEtag !== 'string' || canonicalPersonEtag.length === 0 || canonicalPersonEtag.length > 240
      || (personEtag !== undefined && personEtag !== canonicalPersonEtag)) {
      return reject('evidence_value_rejected');
    }
    result.canonicalPersonId = canonicalPersonId.toLowerCase();
    result.canonicalPersonEtag = canonicalPersonEtag;
    result.personEtag = canonicalPersonEtag;
  }
  return { ok: true, value: result };
}

function projectReceipt(stage, envelope) {
  const receipt = isPlainObject(envelope?.receipt) ? envelope.receipt : null;
  const state = receipt?.state || envelope?.outcome;
  if (!RECEIPT_STATES.has(state) || envelope?.outcome !== state) return reject('invalid_receipt_state');
  if (receipt.contractVersion !== CONTRACT_VERSIONS[stage]) return reject('invalid_contract_version');
  // Source versions are exclusively shared SHA-256 dependency snapshots.  In
  // particular, a producer's `source_version_missing` placeholder or any
  // locally-derived label may be rendered as a failed result, but can never
  // cross this common persistence boundary.
  if (typeof receipt.sourceVersion !== 'string' || !OPAQUE_SOURCE_VERSION_RE.test(receipt.sourceVersion)) {
    return reject('invalid_source_version');
  }
  const reasonCode = receipt.reasonCode ?? receipt.reason ?? null;
  const failureCode = receipt.failureCode ?? receipt.errorCode ?? null;
  if (state === 'current' && (reasonCode !== null || failureCode !== null)) return reject('current_receipt_explains_result');
  if (state === 'not_applicable' && !NOT_APPLICABLE_REASONS.has(reasonCode)) return reject('invalid_reason_code');
  if (state !== 'not_applicable' && reasonCode !== null) return reject('unexpected_reason_code');
  if ((state === 'incomplete' || state === 'failed') && !FAILURE_CODES.has(failureCode)) return reject('invalid_failure_code');
  if (state !== 'incomplete' && state !== 'failed' && failureCode !== null) return reject('unexpected_failure_code');
  const completedAt = receipt.completedAt === null || receipt.completedAt === undefined
    ? null
    : receipt.completedAt;
  if ((state === 'current' || state === 'not_applicable') && !canonicalIso(completedAt)) {
    return reject('invalid_completed_at');
  }
  if ((state === 'incomplete' || state === 'failed') && completedAt !== null) {
    return reject('failure_completed_at_rejected');
  }
  if (!boundedVersion(receipt.resultVersion)) return reject('invalid_result_version');
  const resultVersion = receipt.resultVersion;
  return {
    ok: true,
    value: {
      state,
      contractVersion: CONTRACT_VERSIONS[stage],
      sourceVersion: receipt.sourceVersion,
      resultVersion,
      completedAt,
      reasonCode: reasonCode || null,
      failureCode: failureCode || null,
    },
  };
}

/**
 * Validate and canonicalize a producer result. The output is safe for the
 * roster store, but only store methods may persist it.
 */
function projectStageEnvelope({ stage, mode, envelope, now = new Date().toISOString() } = {}) {
  if (!EXECUTION_MODES.has(mode)) return reject('invalid_execution_mode');
  if (!Object.prototype.hasOwnProperty.call(STAGE_EVIDENCE_KEYS, stage)) return reject('unknown_stage');
  if (!isPlainObject(envelope)) return reject('invalid_envelope');
  const evidence = projectEvidencePatch(stage, envelope.evidencePatch || {});
  if (!evidence.ok) return evidence;
  const receipt = projectReceipt(stage, envelope);
  if (!receipt.ok) return receipt;
  return { ok: true, value: { evidencePatch: evidence.value, receipt: receipt.value } };
}

module.exports = {
  EXECUTION_MODES,
  RECEIPT_STATES,
  NOT_APPLICABLE_REASONS,
  FAILURE_CODES,
  STAGE_EVIDENCE_KEYS,
  canonicalValue,
  projectCoauthorAuthorResults,
  boundedDigest,
  projectStageEnvelope,
};
