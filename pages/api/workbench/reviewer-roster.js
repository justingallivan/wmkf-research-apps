/**
 * /api/workbench/reviewer-roster — durable per-request reviewer-search candidate
 * roster behind the Workbench Reviewers→Find tab (S224). Pure Postgres
 * (`reviewer_find_roster` via `reviewer-roster-store`) reconciled on GET with
 * authoritative Dataverse engagement for every suggestion-anchored active row.
 *
 *   GET   ?requestId            → { active, excluded, ineligible, blocked, savedKeys, allNames }
 *   POST  { requestId, candidates }                  → record surfaced
 *     (active, or ineligible only with a bound server eligibility receipt)
 *   PATCH { requestId, action:'exclude', candidate } → set aside
 *   PATCH { requestId, action:'promote', candidateKey } → excluded → active (returns blob; stale/no-op is 409)
 *   PATCH { requestId, action:'saved', candidates }  → rejected; promotion services own graduation
 *   PATCH { requestId, action:'confirm_identity', candidate } → staff attestation
 *   PATCH { requestId, action:'remove_previous_results' } → delete active search history
 *
 * App-key tuple matches my-candidates.js so the Find tab's `reviewers`/
 * `reviewer-finder` grants both reach it.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { createHash } from 'crypto';
import {
  recordSurfaced,
  setExcluded,
  promote,
  listForRequest,
  findCandidateBySuggestionAnchor,
  findCandidatesByKeys,
  removePreviousActiveSearchResults,
} from '../../../lib/services/reviewer-roster-store';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { confirmStructuredRosterIdentity } from '../../../lib/services/reviewer-address-trust-service';
import {
  reconcileRosterEngagement,
  validateRosterPromotionEngagement,
} from '../../../lib/services/workbench/reviewer-roster-projection-service';
import { readReviewerWarmValidation } from '../../../lib/services/workbench/reviewer-warm-validation-service';
import {
  createServerIdentityDecisionReceipt,
  hasServerIdentityDecisionReceipt,
  verifyAutomatedIdentityAttestation,
} from '../../../lib/services/reviewer-candidate-attestation';
import {
  pruneCandidateForRoster,
  reviewerCandidateKey,
} from '../../../shared/components/reviewers/reviewer-search-logic';
import { hasCandidateStaffIdentityConfirmation } from '../../../lib/utils/reviewer-identity-authority';
import {
  observationFromRequest,
  withReviewerFindWarmObservation,
} from '../../../lib/services/workbench/reviewer-find-warm-observation';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Cap candidates per POST — a Find run asks for at most 25, but guard against an
// oversized body regardless.
const MAX_CANDIDATES_PER_POST = 100;
// The store retains up to 300 active/saved rows per request. A single removal
// action must therefore be able to carry every visible prior-result key.
const MAX_PREVIOUS_RESULT_KEYS = 300;
const ROSTER_VERSION_RE = /^[a-f0-9]{64}$/;
const ELIGIBILITY_STATUSES = new Set(['unknown', 'emeritus', 'deceased']);
const ELIGIBILITY_CHECK_STATUSES = new Set([
  'complete', 'not_applicable', 'pending', 'incomplete', 'error',
]);

// These values decide whether a candidate can be promoted, or describe the
// server work that made that decision. A browser may display a prior response,
// but it must not be able to persist one as a new receipt or overwrite a
// stored receipt during POST/PATCH. Receipt-bound eligibility is restored by
// the route below; every other member is restored only from the stored row.
const CLIENT_ROSTER_AUTHORITY_FIELDS = [
  'warmCacheVersion',
  'proposalContentVersion',
  'applicantInputVersion',
  'stageFreshness',
  'legacyStageReceipts',
  'eligibilityStatus',
  'eligibilityCheckStatus',
  'eligibilityReason',
  'eligibilityEvidence',
  'hasInstitutionCOI',
  'institutionCOIDetails',
  'coiRecomputed',
  'hasCoauthorCOI',
  'coauthorCheckStatus',
  'coauthorCheckFailures',
  'coauthorships',
  'coauthorCOIStrength',
  'coauthorSharedPaperTotal',
  'coauthorMaxWithOneAuthor',
  'addressTrustReceipt',
  'addressConflictPending',
  'conflictRecordUnavailable',
  'addressVerificationRequired',
  'serverIdentityReviewReason',
];
const RECEIPT_BOUND_ELIGIBILITY_FIELDS = new Set([
  'eligibilityStatus',
  'eligibilityCheckStatus',
  'eligibilityReason',
  'eligibilityEvidence',
]);

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  // A valid header only creates a bounded correlation scope for the two warm
  // GET modes. It is established after auth, cannot authorize anything, and
  // absent/malformed values preserve the exact pre-observation behavior.
  return withReviewerFindWarmObservation(observationFromRequest(req), async () => {
    try {
      if (req.method === 'GET') return await handleGet(req, res);
      if (req.method === 'POST') return await handlePost(req, res);
      if (req.method === 'PATCH') return await handlePatch(req, res, access);
      return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
      console.error('reviewer-roster error:', error.message);
      return res.status(500).json({ error: 'Reviewer roster operation failed' });
    }
  });
}

function validRequestId(requestId) {
  return typeof requestId === 'string' && GUID_RE.test(requestId);
}

function isServerManagedApplicantCandidate(candidate) {
  return !!(
    candidate
    && typeof candidate === 'object'
    && (
      candidate.suggestionId
      || (typeof candidate.candidateKey === 'string' && candidate.candidateKey.startsWith('suggestion:'))
      || candidate.isApplicantRecommended === true
      || candidate.enrichedProposalKey
      || candidate.provenance?.kind === 'applicant_suggested'
    )
  );
}

// Resolves by the Dataverse anchor, not the canonical key, so an anchor-stamped row
// still keyed `legacy-row:<id>` / `candidate:<fingerprint>` can be excluded, marked
// saved, or identity-confirmed instead of 409-ing with no way forward (S387; Codex
// adversarial review of 5a6c863c). The `candidateKey` equality below is unchanged and
// still binds the action to the exact row the client was shown — the anchor lookup
// widens WHICH row can be found, never WHOSE claim is trusted. Promotion deliberately
// keeps the canonical-key-only lookup: see findCandidateBySuggestionAnchor's header.
async function authoritativeApplicantCandidate(requestId, candidate) {
  if (!candidate?.suggestionId) return null;
  const stored = await findCandidateBySuggestionAnchor(requestId, candidate.suggestionId);
  if (!stored || stored.candidateKey !== candidate.candidateKey) return null;
  return pruneCandidateForRoster(stored);
}

function stripClientRosterAuthority(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const {
    staffIdentityConfirmation: _staffIdentityConfirmation,
    manualContactFields: _manualContactFields,
    pdIdentityConfirmed: _pdIdentityConfirmed,
    pdIdentityConfirmationId: _pdIdentityConfirmationId,
    serverIdentityDecisionReceipt: _serverIdentityDecisionReceipt,
    ...withoutStaffAuthority
  } = candidate;
  const safe = { ...withoutStaffAuthority };
  for (const field of CLIENT_ROSTER_AUTHORITY_FIELDS) delete safe[field];
  if (safe.contactEnrichment && typeof safe.contactEnrichment === 'object'
    && !Array.isArray(safe.contactEnrichment)) {
    const contactEnrichment = { ...safe.contactEnrichment };
    for (const field of CLIENT_ROSTER_AUTHORITY_FIELDS) delete contactEnrichment[field];
    safe.contactEnrichment = contactEnrichment;
  }
  return safe;
}

function valueFromCandidateOrEnrichment(candidate, field) {
  if (candidate && Object.prototype.hasOwnProperty.call(candidate, field)) {
    return { present: true, value: candidate[field] };
  }
  if (candidate?.contactEnrichment
    && Object.prototype.hasOwnProperty.call(candidate.contactEnrichment, field)) {
    return { present: true, value: candidate.contactEnrichment[field] };
  }
  return { present: false, value: undefined };
}

function restoreStoredRosterAuthority(candidate, stored, {
  allowReceiptBoundEligibility = false,
  allowReceiptBoundEligibilityCheckStatus = false,
} = {}) {
  if (!stored || !candidate || typeof candidate !== 'object') return candidate;
  const restored = { ...candidate };
  const contactEnrichment = candidate.contactEnrichment
    && typeof candidate.contactEnrichment === 'object'
    && !Array.isArray(candidate.contactEnrichment)
    ? { ...candidate.contactEnrichment }
    : {};
  for (const field of CLIENT_ROSTER_AUTHORITY_FIELDS) {
    if (
      allowReceiptBoundEligibility
      && RECEIPT_BOUND_ELIGIBILITY_FIELDS.has(field)
      && (field !== 'eligibilityCheckStatus' || allowReceiptBoundEligibilityCheckStatus)
    ) continue;
    const storedValue = valueFromCandidateOrEnrichment(stored, field);
    if (!storedValue.present) continue;
    restored[field] = storedValue.value;
    contactEnrichment[field] = storedValue.value;
  }
  return { ...restored, contactEnrichment };
}

function receiptBoundEligibility(candidate, receipt) {
  const bound = receipt?.valid === true && receipt.eligibilityEvidenceBound === true;
  // v3 eligibility digests deliberately exclude this status. Its claim is
  // therefore not authoritative until the v4 receipt projection binds it.
  const checkStatusBound = bound && receipt?.projectionVersion >= 4;
  const eligibilityStatus = bound && ELIGIBILITY_STATUSES.has(receipt.eligibilityStatus)
    ? receipt.eligibilityStatus
    : 'unknown';
  const eligibilityCheckStatus = checkStatusBound && ELIGIBILITY_CHECK_STATUSES.has(receipt.eligibilityCheckStatus)
    ? receipt.eligibilityCheckStatus
    : null;
  const eligibilityReason = bound
    ? (candidate?.eligibilityReason ?? candidate?.contactEnrichment?.eligibilityReason ?? null)
    : null;
  const eligibilityEvidence = bound
    ? (candidate?.eligibilityEvidence ?? candidate?.contactEnrichment?.eligibilityEvidence ?? null)
    : null;
  return {
    bound,
    checkStatusBound,
    eligibilityStatus,
    eligibilityCheckStatus,
    eligibilityReason,
    eligibilityEvidence,
  };
}

function withReceiptBoundEligibility(candidate, eligibility) {
  return {
    ...candidate,
    eligibilityStatus: eligibility.eligibilityStatus,
    eligibilityCheckStatus: eligibility.eligibilityCheckStatus,
    eligibilityReason: eligibility.eligibilityReason,
    eligibilityEvidence: eligibility.eligibilityEvidence,
    contactEnrichment: {
      ...(candidate.contactEnrichment || {}),
      eligibilityStatus: eligibility.eligibilityStatus,
      eligibilityCheckStatus: eligibility.eligibilityCheckStatus,
      eligibilityReason: eligibility.eligibilityReason,
      eligibilityEvidence: eligibility.eligibilityEvidence,
    },
  };
}

function isReceiptBoundEligibilityCandidate(candidate) {
  return candidate?.receiptBoundEligibility === true;
}

function isReceiptBoundEligibilityCheckStatusCandidate(candidate) {
  return candidate?.receiptBoundEligibilityCheckStatus === true;
}

function removeReceiptBoundEligibilityMarker(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const {
    receiptBoundEligibility: _receiptBoundEligibility,
    receiptBoundEligibilityCheckStatus: _receiptBoundEligibilityCheckStatus,
    ...safe
  } = candidate;
  return safe;
}

function bindServerRosterCandidateKey(candidate, receipt) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const {
    candidateKey: _submittedCandidateKey,
    ...candidateWithoutClientKey
  } = candidate;
  const candidateKey = receipt?.valid === true && receipt?.rosterCandidateKey
    ? receipt.rosterCandidateKey
    : reviewerCandidateKey(candidateWithoutClientKey);
  return candidateKey
    ? { ...candidateWithoutClientKey, candidateKey }
    : candidateWithoutClientKey;
}

function hasStoredStaffAuthority(candidate) {
  return hasCandidateStaffIdentityConfirmation(candidate);
}

async function preserveStoredRosterAuthority(requestId, candidates, {
  storedRows: suppliedStoredRows = null,
} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const storedRows = Array.isArray(suppliedStoredRows)
    ? suppliedStoredRows
    : await findCandidatesByKeys(
      requestId,
      list.map((candidate) => candidate?.candidateKey).filter(Boolean),
    );
  const storedByKey = new Map(storedRows.map((candidate) => [candidate.candidateKey, candidate]));
  return list.map((markedCandidate) => {
    const allowReceiptBoundEligibility = isReceiptBoundEligibilityCandidate(markedCandidate);
    const allowReceiptBoundEligibilityCheckStatus = isReceiptBoundEligibilityCheckStatusCandidate(markedCandidate);
    const candidate = removeReceiptBoundEligibilityMarker(markedCandidate);
    const stored = storedByKey.get(candidate?.candidateKey);
    const withStoredAuthority = restoreStoredRosterAuthority(candidate, stored, {
      allowReceiptBoundEligibility,
      allowReceiptBoundEligibilityCheckStatus,
    });
    const freshIdentityReceipt = hasServerIdentityDecisionReceipt(withStoredAuthority)
      ? withStoredAuthority.serverIdentityDecisionReceipt
      : null;
    const candidateWithStoredReceipt = stored?.serverIdentityDecisionReceipt
      ? { ...withStoredAuthority, serverIdentityDecisionReceipt: stored.serverIdentityDecisionReceipt }
      : withStoredAuthority;
    const storedIdentityReceipt = !freshIdentityReceipt
      && !!stored
      && hasServerIdentityDecisionReceipt(stored)
      && hasServerIdentityDecisionReceipt(candidateWithStoredReceipt)
      ? stored.serverIdentityDecisionReceipt
      : null;
    const identityReceipt = freshIdentityReceipt || storedIdentityReceipt;
    const withIdentityReceipt = identityReceipt
      ? { ...withStoredAuthority, serverIdentityDecisionReceipt: identityReceipt }
      : withStoredAuthority;
    const preserveStoredTrue = (field) => {
      const incoming = withIdentityReceipt?.[field]
        ?? withIdentityReceipt?.contactEnrichment?.[field];
      const storedValue = stored?.[field] ?? stored?.contactEnrichment?.[field];
      return storedValue === true || incoming === true ? true : incoming;
    };
    const withAddressAuthority = stored
      ? {
          ...withIdentityReceipt,
          addressConflictPending: preserveStoredTrue('addressConflictPending'),
          conflictRecordUnavailable: preserveStoredTrue('conflictRecordUnavailable'),
          addressVerificationRequired: preserveStoredTrue('addressVerificationRequired'),
          contactEnrichment: {
            ...(withIdentityReceipt.contactEnrichment || {}),
            addressConflictPending: preserveStoredTrue('addressConflictPending'),
            conflictRecordUnavailable: preserveStoredTrue('conflictRecordUnavailable'),
            addressVerificationRequired: preserveStoredTrue('addressVerificationRequired'),
          },
        }
      : withIdentityReceipt;
    if (!stored || !hasStoredStaffAuthority(stored)) return withAddressAuthority;
    const confirmation = stored.staffIdentityConfirmation;
    const email = confirmation.email || null;
    const website = confirmation.website || null;
    const affiliation = confirmation.affiliation || null;
    return restoreStoredRosterAuthority({
      ...pruneCandidateForRoster({
        ...withAddressAuthority,
        name: stored.name || withAddressAuthority.name,
        email,
        emailSource: email ? 'manual' : null,
        website,
        websiteSource: website ? 'manual' : null,
        affiliation,
        affiliationSource: 'staff_manual',
        manualContactFields: stored.manualContactFields,
        contactEnrichment: {
          ...(withAddressAuthority.contactEnrichment || {}),
          email,
          emailSource: email ? 'manual' : null,
          website,
          websiteSource: website ? 'manual' : null,
          affiliation,
          affiliationSource: 'staff_manual',
        },
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: stored.pdIdentityConfirmationId,
        staffIdentityConfirmation: confirmation,
      }),
      ...(identityReceipt
        ? { serverIdentityDecisionReceipt: identityReceipt }
        : {}),
    }, stored, {
      allowReceiptBoundEligibility,
      allowReceiptBoundEligibilityCheckStatus,
    });
  });
}

// Non-applicant staff corrections carry a browser-supplied contact, but never a
// browser-supplied candidate blob. Resolve the opaque key to the exact active
// roster row first, then pass only that server row through the same authority
// restoration used by resurfacing/exclude. Besides retaining nested receipts,
// this prevents a candidate key for one row from being combined with another
// row's name or promotion evidence before `confirmIdentity` writes it.
async function authoritativeNonApplicantCandidate(requestId, candidate) {
  const candidateKey = typeof candidate?.candidateKey === 'string'
    ? candidate.candidateKey.trim()
    : '';
  if (!candidateKey) return null;
  const storedRows = await findCandidatesByKeys(requestId, [candidateKey]);
  const stored = storedRows.find((row) => (
    row?.candidateKey === candidateKey && row.rosterStatus === 'active'
  ));
  if (!stored) return null;
  const [authoritative] = await preserveStoredRosterAuthority(requestId, [
    stripClientRosterAuthority(pruneCandidateForRoster(stored)),
  ], { storedRows: [stored] });
  return authoritative?.candidateKey === candidateKey ? authoritative : null;
}

async function handleGet(req, res) {
  const { requestId } = req.query;
  if (!validRequestId(requestId)) {
    return res.status(400).json({ error: 'Valid requestId (GUID) is required' });
  }

  // The request scope must be established before the client-selectable mode is
  // considered. Missing mode intentionally retains the original blocking GET
  // contract until the Find UI migrates to the two-phase bootstrap.
  const modeResult = parseRosterGetMode(req.query);
  if (!modeResult.valid) {
    return res.status(400).json({ error: modeResult.error, code: 'invalid_roster_mode' });
  }

  const startedAt = Date.now();
  const roster = await listForRequest(requestId);
  const rosterReadMs = elapsedMs(startedAt);

  if (modeResult.mode === 'cached') {
    const rosterVersion = createRosterVersion(requestId, roster);
    const telemetry = warmTelemetry({
      mode: 'cached',
      authorityState: 'cached',
      reasonCode: 'cached_snapshot',
      rosterReadMs,
      startedAt,
    });
    emitWarmTelemetry(telemetry);
    return res.status(200).json({
      success: true,
      authorityState: 'cached',
      rosterVersion,
      ...roster,
      warmTelemetry: telemetry,
    });
  }

  if (modeResult.mode === 'reconciled') {
    const versionResult = parseRosterVersion(req.query);
    if (!versionResult.valid) {
      return res.status(400).json({ error: versionResult.error, code: 'invalid_roster_version' });
    }
    const rosterVersion = createRosterVersion(requestId, roster);
    if (versionResult.rosterVersion !== rosterVersion) {
      const telemetry = warmTelemetry({
        mode: 'reconciled',
        authorityState: 'cached',
        reasonCode: 'roster_snapshot_changed',
        rosterReadMs,
        startedAt,
      });
      emitWarmTelemetry(telemetry);
      return res.status(409).json({
        success: false,
        code: 'roster_snapshot_changed',
        error: 'Reviewer roster changed; reload the cached snapshot before reconciling.',
        authorityState: 'cached',
        rosterVersion,
        ...roster,
        warmTelemetry: telemetry,
      });
    }

    const reconciliationStartedAt = Date.now();
    let reconciled;
    let reconciliationError = null;
    try {
      reconciled = await withDalContext('workbench-reviewer-roster-get', () => (
        reconcileRosterEngagement({ requestId, roster })
      ));
    } catch (error) {
      reconciliationError = error;
    }

    // Warm validation is a separate, metadata-only authoritative read. It is
    // deliberately still attempted after an engagement failure so the cached
    // panel can distinguish a proposal/input problem from an engagement outage;
    // neither partial success is enough to make the panel current.
    const validationStartedAt = Date.now();
    let warmValidation;
    let validationError = null;
    try {
      warmValidation = await withDalContext('workbench-reviewer-roster-warm-validation', () => (
        readReviewerWarmValidation({ requestId, roster })
      ));
    } catch (error) {
      validationError = error;
    }

    // Every bounded authoritative read above is read-only but can outlive a
    // roster mutation. Recheck only after all of them complete; a concurrent
    // change wins over success and failure alike.
    const snapshotVerificationStartedAt = Date.now();
    const latestRoster = await listForRequest(requestId);
    const latestRosterVersion = createRosterVersion(requestId, latestRoster);
    const reconciliationMs = elapsedMs(reconciliationStartedAt);
    const validationMs = elapsedMs(validationStartedAt);
    const snapshotVerificationMs = elapsedMs(snapshotVerificationStartedAt);
    if (latestRosterVersion !== rosterVersion) {
      const telemetry = warmTelemetry({
        mode: 'reconciled',
        authorityState: 'cached',
        reasonCode: 'roster_snapshot_changed',
        rosterReadMs,
        reconciliationMs,
        validationMs,
        snapshotVerificationMs,
        startedAt,
      });
      emitWarmTelemetry(telemetry);
      return res.status(409).json({
        success: false,
        code: 'roster_snapshot_changed',
        error: 'Reviewer roster changed; reload the cached snapshot before reconciling.',
        authorityState: 'cached',
        rosterVersion: latestRosterVersion,
        ...latestRoster,
        warmTelemetry: telemetry,
      });
    }

    if (reconciliationError) {
      const telemetry = warmTelemetry({
        mode: 'reconciled',
        authorityState: 'error',
        reasonCode: 'authority_reconciliation_failed',
        rosterReadMs,
        reconciliationMs,
        validationMs,
        snapshotVerificationMs,
        startedAt,
      });
      emitWarmTelemetry(telemetry);
      console.error('reviewer-roster reconciliation error:', reconciliationError.message);
      return res.status(503).json({
        success: false,
        code: 'authority_reconciliation_failed',
        error: 'Reviewer authority could not be reconciled; retry before taking action.',
        authorityState: 'error',
        rosterVersion,
        ...latestRoster,
        warmValidation: warmValidation || null,
        warmTelemetry: telemetry,
      });
    }

    if (validationError) {
      const telemetry = warmTelemetry({
        mode: 'reconciled',
        authorityState: 'error',
        reasonCode: 'authority_reconciliation_failed',
        rosterReadMs,
        reconciliationMs,
        validationMs,
        snapshotVerificationMs,
        startedAt,
      });
      emitWarmTelemetry(telemetry);
      console.error('reviewer-roster warm validation error:', validationError.message);
      return res.status(503).json({
        success: false,
        code: 'authority_reconciliation_failed',
        error: 'Reviewer authority could not be reconciled; retry before taking action.',
        authorityState: 'error',
        rosterVersion,
        ...latestRoster,
        warmValidation: null,
        warmTelemetry: telemetry,
      });
    }

    const reconciledAuthorityState = reconciled?.authorityState;
    // The current projection service emits no authority state; reserve stale
    // and error for a future bounded reconciliation result. An unrecognized
    // service value fails closed to stale rather than becoming a new client
    // authority state by accident.
    const engagementAuthorityState = reconciledAuthorityState === undefined || reconciledAuthorityState === 'current'
      ? 'current'
      : reconciledAuthorityState === 'error'
      ? 'error'
      : 'stale';
    const validationAuthorityState = warmValidation?.state === 'current'
      ? 'current'
      : warmValidation?.state === 'error'
        ? 'error'
        : 'stale';
    const authorityState = engagementAuthorityState === 'error' || validationAuthorityState === 'error'
      ? 'error'
      : engagementAuthorityState === 'current' && validationAuthorityState === 'current'
        ? 'current'
        : 'stale';
    const { authorityState: _serviceAuthorityState, ...reconciledRoster } = reconciled || {};
    const telemetry = warmTelemetry({
      mode: 'reconciled',
      authorityState,
      reasonCode: authorityState === 'current'
        ? 'authority_current'
        : authorityState === 'error'
        ? 'authority_reconciliation_failed'
        : 'authority_stale',
      rosterReadMs,
      reconciliationMs,
      validationMs,
      snapshotVerificationMs,
      startedAt,
    });
    emitWarmTelemetry(telemetry);
    // `current` means this panel generation completed engagement, proposal
    // metadata, and applicant-input reads. It is never candidate-stage or
    // promotion authority; `warmValidation.candidatePlans` remains the
    // server-derived receipt freshness projection.
    return res.status(authorityState === 'error' ? 503 : 200).json({
      success: authorityState !== 'error',
      authorityState,
      rosterVersion,
      ...reconciledRoster,
      warmValidation,
      warmTelemetry: telemetry,
    });
  }

  // Temporary compatibility response for current callers which do not send a
  // mode. Keep this exact response shape until the client migration lands.
  const reconciled = await withDalContext('workbench-reviewer-roster-get', () => (
    reconcileRosterEngagement({ requestId, roster })
  ));
  return res.status(200).json({ success: true, ...reconciled });
}

function parseRosterGetMode(query = {}) {
  const rawMode = query?.mode;
  if (rawMode === undefined) return { valid: true, mode: 'compatibility' };
  if (Array.isArray(rawMode)) {
    return { valid: false, error: 'mode must be supplied once as cached or reconciled' };
  }
  if (rawMode === 'cached' || rawMode === 'reconciled') {
    return { valid: true, mode: rawMode };
  }
  return { valid: false, error: 'mode must be cached or reconciled' };
}

function parseRosterVersion(query = {}) {
  const rawVersion = query?.rosterVersion;
  if (Array.isArray(rawVersion) || typeof rawVersion !== 'string' || !ROSTER_VERSION_RE.test(rawVersion)) {
    return { valid: false, error: 'A single valid rosterVersion is required for reconciled mode' };
  }
  return { valid: true, rosterVersion: rawVersion };
}

function createRosterVersion(requestId, roster) {
  return createHash('sha256')
    .update(`${String(requestId).toLowerCase()}\n${stableStringify(roster)}`)
    .digest('hex');
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

function elapsedMs(startedAt) {
  return Math.min(600000, Math.max(0, Date.now() - startedAt));
}

function warmTelemetry({
  mode,
  authorityState,
  reasonCode,
  rosterReadMs,
  reconciliationMs = null,
  validationMs = null,
  snapshotVerificationMs = null,
  startedAt,
}) {
  return {
    mode,
    authorityState,
    reasonCode,
    rosterReadMs,
    reconciliationMs,
    validationMs,
    snapshotVerificationMs,
    totalMs: elapsedMs(startedAt),
  };
}

function emitWarmTelemetry(telemetry) {
  // Bounded mode/state/timing metadata only: no candidate, proposal, provider,
  // or request data is emitted here.
  console.info('reviewer-roster-warm-telemetry', telemetry);
}

async function handlePost(req, res) {
  const { requestId, candidates } = req.body || {};
  if (!validRequestId(requestId)) {
    return res.status(400).json({ error: 'Valid requestId (GUID) is required' });
  }
  if (!Array.isArray(candidates)) {
    return res.status(400).json({ error: 'candidates[] is required' });
  }
  if (candidates.length > MAX_CANDIDATES_PER_POST) {
    return res.status(400).json({ error: `Too many candidates (max ${MAX_CANDIDATES_PER_POST})` });
  }
  if (candidates.some(isServerManagedApplicantCandidate)) {
    return res.status(400).json({
      error: 'Applicant-recommended roster rows are server-managed',
      code: 'server_managed_applicant_candidate',
    });
  }
  // Prune server-side too — never persist raw enrichment internals even if a
  // client sent them. Eligibility is server-issued evidence: overwrite the
  // browser's fields from the request/candidate-bound receipt, or clear them.
  const pruned = (await Promise.all(candidates.map(async (candidate) => {
    const submitted = pruneCandidateForRoster(candidate);
    if (!submitted?.name) return null;
    // Verify the signed candidate projection before stripping authority fields.
    // The receipt is the one browser-carried authority that is safe to consume;
    // all non-receipt fields are removed immediately afterward.
    const receipt = await verifyAutomatedIdentityAttestation(
      submitted.automatedIdentityAttestation,
      { requestId, candidate: submitted },
    );
    const compact = stripClientRosterAuthority(submitted);
    if (!compact?.name) return null;
    const eligibility = receiptBoundEligibility(submitted, receipt);
    const bound = bindServerRosterCandidateKey(compact, receipt);
    const identityReceipt = receipt.valid && receipt.identityDecisionBound === true
      ? createServerIdentityDecisionReceipt(bound)
      : null;
    return {
      ...withReceiptBoundEligibility(bound, eligibility),
      ...(identityReceipt
        ? { serverIdentityDecisionReceipt: identityReceipt }
        : {}),
      receiptBoundEligibility: eligibility.bound,
      receiptBoundEligibilityCheckStatus: eligibility.checkStatusBound,
    };
  }))).filter(Boolean);
  const authoritativePruned = await preserveStoredRosterAuthority(requestId, pruned);
  const recorded = await recordSurfaced(requestId, authoritativePruned);
  return res.status(200).json({ success: true, recorded });
}

async function handlePatch(req, res, access) {
  const { requestId, action } = req.body || {};
  if (!validRequestId(requestId)) {
    return res.status(400).json({ error: 'Valid requestId (GUID) is required' });
  }

  if (action === 'exclude') {
    const { candidate } = req.body;
    if (!candidate || !candidate.name) {
      return res.status(400).json({ error: 'candidate (with name) is required to exclude' });
    }
    let candidateToExclude = stripClientRosterAuthority(pruneCandidateForRoster(candidate));
    if (isServerManagedApplicantCandidate(candidate)) {
      candidateToExclude = await authoritativeApplicantCandidate(requestId, candidate);
      if (!candidateToExclude) {
        return res.status(409).json({ error: 'Applicant reviewer row is stale or missing; reload before excluding it.' });
      }
    } else {
      [candidateToExclude] = await preserveStoredRosterAuthority(requestId, [candidateToExclude]);
    }
    await setExcluded(requestId, candidateToExclude);
    return res.status(200).json({ success: true });
  }

  if (action === 'promote') {
    const { candidateKey } = req.body;
    if (!candidateKey) return res.status(400).json({ error: 'candidateKey is required to promote' });
    const [storedCandidate] = await findCandidatesByKeys(requestId, [candidateKey]);
    if (!storedCandidate || storedCandidate.rosterStatus !== 'excluded') {
      return res.status(409).json({
        success: false,
        error: 'Candidate is no longer excluded; reload the reviewer roster.',
        code: 'candidate_not_excluded',
      });
    }
    const promotionAuthority = await withDalContext('workbench-reviewer-roster-promote', () => (
      validateRosterPromotionEngagement({ requestId, candidate: storedCandidate })
    ));
    if (!promotionAuthority.allowed) {
      return res.status(409).json({ success: false, ...promotionAuthority });
    }
    const candidate = await promote(requestId, candidateKey);
    if (!candidate) {
      return res.status(409).json({
        success: false,
        error: 'Candidate is no longer excluded; reload the reviewer roster.',
        code: 'candidate_not_excluded',
      });
    }
    return res.status(200).json({ success: true, candidate });
  }

  if (action === 'saved') {
    return res.status(409).json({
      error: 'Roster saved state is server-owned; use the reviewer promotion endpoint.',
      code: 'server_owned_transition',
    });
  }

  if (action === 'confirm_identity') {
    const { candidate } = req.body;
    if (!candidate?.email) {
      return res.status(400).json({ error: 'candidate email is required to confirm identity' });
    }
    let authoritativeCandidate = stripClientRosterAuthority(pruneCandidateForRoster(candidate));
    if (isServerManagedApplicantCandidate(candidate)) {
      authoritativeCandidate = await authoritativeApplicantCandidate(requestId, candidate);
      if (!authoritativeCandidate) {
        return res.status(409).json({ error: 'Applicant reviewer row is stale or missing; reload before confirming identity.' });
      }
      if (authoritativeCandidate?.applicantKnownReviewer?.status !== 'known') {
        return res.status(422).json({
          error: 'The exact applicant-linked reviewer record must be available before identity can be confirmed.',
          code: 'applicant_hydration_required',
        });
      }
    } else {
      authoritativeCandidate = await authoritativeNonApplicantCandidate(requestId, candidate);
      if (!authoritativeCandidate) {
        return res.status(409).json({
          error: 'Candidate is no longer active or does not match this roster row; reload before confirming identity.',
          code: 'candidate_not_active',
        });
      }
    }
    const confirmed = await withDalContext('workbench-reviewer-roster-confirm-identity', () => (
      confirmStructuredRosterIdentity({
        requestId,
        // This is the server-resolved row, not the browser candidate. The
        // service re-reads it once more before calculating the confirmation.
        candidateKey: authoritativeCandidate.candidateKey,
        manualContact: {
          email: candidate.email,
          website: candidate.website,
          affiliation: candidate.affiliation,
        },
        actorProfileId: access?.profileId || null,
        actorSystemUserId: access?.session?.user?.dynamicsSystemuserId || null,
      })
    ));
    if (!confirmed?.success) {
      return res.status(409).json(confirmed || {
        success: false,
        code: 'candidate_stale',
        error: 'Candidate is no longer active; reload before confirming identity.',
      });
    }
    return res.status(200).json(confirmed);
  }

  if (action === 'remove_previous_results') {
    const { candidateRefs } = req.body;
    // Do not impose a per-key character cap: server-generated fallback keys
    // contain an encoded affiliation fingerprint and can legitimately be long.
    // Aggregate input remains bounded by MAX_PREVIOUS_RESULT_KEYS + the 2 MB body
    // limit, and the store requires an exact request/key/timestamp match.
    const invalidRefs = !Array.isArray(candidateRefs)
      || candidateRefs.length === 0
      || candidateRefs.length > MAX_PREVIOUS_RESULT_KEYS
      || candidateRefs.some((ref) => (
        !ref
        || typeof ref.candidateKey !== 'string'
        || !ref.candidateKey.trim()
        || typeof ref.updatedAt !== 'string'
        || !ref.updatedAt.trim()
        || ref.updatedAt.length > 80
      ));
    if (invalidRefs) {
      return res.status(400).json({ error: `candidateRefs[] must contain 1-${MAX_PREVIOUS_RESULT_KEYS} valid key/timestamp pairs` });
    }
    const result = await removePreviousActiveSearchResults(requestId, candidateRefs);
    return res.status(200).json({ success: true, ...result });
  }

  return res.status(400).json({ error: 'Unknown action (expected exclude | promote | saved | confirm_identity | remove_previous_results)' });
}
