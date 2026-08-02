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
  confirmIdentity,
  listForRequest,
  findCandidateBySuggestionAnchor,
  findCandidatesByKeys,
  removePreviousActiveSearchResults,
} from '../../../lib/services/reviewer-roster-store';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  reconcileRosterEngagement,
  validateRosterPromotionEngagement,
} from '../../../lib/services/workbench/reviewer-roster-projection-service';
import {
  createServerIdentityDecisionReceipt,
  hasServerIdentityDecisionReceipt,
  verifyAutomatedIdentityAttestation,
} from '../../../lib/services/reviewer-candidate-attestation';
import {
  pruneCandidateForRoster,
  reviewerCandidateKey,
} from '../../../shared/components/reviewers/reviewer-search-logic';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Cap candidates per POST — a Find run asks for at most 25, but guard against an
// oversized body regardless.
const MAX_CANDIDATES_PER_POST = 100;
// The store retains up to 300 active/saved rows per request. A single removal
// action must therefore be able to carry every visible prior-result key.
const MAX_PREVIOUS_RESULT_KEYS = 300;
const ROSTER_VERSION_RE = /^[a-f0-9]{64}$/;

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'PATCH') return await handlePatch(req, res, access);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('reviewer-roster error:', error.message);
    return res.status(500).json({ error: 'Reviewer roster operation failed' });
  }
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
  const confirmationId = candidate?.pdIdentityConfirmationId;
  return candidate?.pdIdentityConfirmed === true
    && typeof confirmationId === 'string'
    && confirmationId.length > 0
    && candidate?.staffIdentityConfirmation?.source === 'staff_confirmed'
    && candidate.staffIdentityConfirmation.confirmationId === confirmationId;
}

async function preserveStoredRosterAuthority(requestId, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const storedRows = await findCandidatesByKeys(
    requestId,
    list.map((candidate) => candidate?.candidateKey).filter(Boolean),
  );
  const storedByKey = new Map(storedRows.map((candidate) => [candidate.candidateKey, candidate]));
  return list.map((candidate) => {
    const stored = storedByKey.get(candidate?.candidateKey);
    const freshIdentityReceipt = hasServerIdentityDecisionReceipt(candidate)
      ? candidate.serverIdentityDecisionReceipt
      : null;
    const candidateWithStoredReceipt = stored?.serverIdentityDecisionReceipt
      ? { ...candidate, serverIdentityDecisionReceipt: stored.serverIdentityDecisionReceipt }
      : candidate;
    const storedIdentityReceipt = !freshIdentityReceipt
      && !!stored
      && hasServerIdentityDecisionReceipt(stored)
      && hasServerIdentityDecisionReceipt(candidateWithStoredReceipt)
      ? stored.serverIdentityDecisionReceipt
      : null;
    const identityReceipt = freshIdentityReceipt || storedIdentityReceipt;
    const withIdentityReceipt = identityReceipt
      ? { ...candidate, serverIdentityDecisionReceipt: identityReceipt }
      : candidate;
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
    return {
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
    };
  });
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

    // Dataverse reconciliation is read-only but can outlive a roster mutation.
    // Recheck the same Postgres projection before returning any authority result;
    // a concurrent change wins over both a successful and failed reconciliation.
    const snapshotVerificationStartedAt = Date.now();
    const latestRoster = await listForRequest(requestId);
    const latestRosterVersion = createRosterVersion(requestId, latestRoster);
    const reconciliationMs = elapsedMs(reconciliationStartedAt);
    const snapshotVerificationMs = elapsedMs(snapshotVerificationStartedAt);
    if (latestRosterVersion !== rosterVersion) {
      const telemetry = warmTelemetry({
        mode: 'reconciled',
        authorityState: 'cached',
        reasonCode: 'roster_snapshot_changed',
        rosterReadMs,
        reconciliationMs,
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
        warmTelemetry: telemetry,
      });
    }

    const reconciledAuthorityState = reconciled?.authorityState;
    // The current projection service emits no authority state; reserve stale
    // and error for a future bounded reconciliation result. An unrecognized
    // service value fails closed to stale rather than becoming a new client
    // authority state by accident.
    const authorityState = reconciledAuthorityState === undefined || reconciledAuthorityState === 'current'
      ? 'current'
      : reconciledAuthorityState === 'error'
      ? 'error'
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
      snapshotVerificationMs,
      startedAt,
    });
    emitWarmTelemetry(telemetry);
    // `current` is deliberately limited to this request's engagement
    // reconciliation. It does not represent candidate evidence freshness.
    return res.status(authorityState === 'error' ? 503 : 200).json({
      success: authorityState !== 'error',
      authorityState,
      rosterVersion,
      ...reconciledRoster,
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
  snapshotVerificationMs = null,
  startedAt,
}) {
  return {
    mode,
    authorityState,
    reasonCode,
    rosterReadMs,
    reconciliationMs,
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
    const compact = stripClientRosterAuthority(pruneCandidateForRoster(candidate));
    if (!compact?.name) return null;
    const receipt = await verifyAutomatedIdentityAttestation(
      compact.automatedIdentityAttestation,
      { requestId, candidate: compact },
    );
    const eligibilityStatus = receipt.valid && receipt.eligibilityEvidenceBound
      && (receipt.eligibilityStatus === 'deceased' || receipt.eligibilityStatus === 'emeritus')
      ? receipt.eligibilityStatus
      : 'unknown';
    const preserveEvidence = eligibilityStatus !== 'unknown';
    const bound = bindServerRosterCandidateKey(compact, receipt);
    const identityReceipt = receipt.valid && receipt.identityDecisionBound === true
      ? createServerIdentityDecisionReceipt(bound)
      : null;
    return {
      ...bound,
      ...(identityReceipt
        ? { serverIdentityDecisionReceipt: identityReceipt }
        : {}),
      eligibilityStatus,
      eligibilityReason: preserveEvidence ? compact.eligibilityReason : null,
      eligibilityEvidence: preserveEvidence ? compact.eligibilityEvidence : null,
      contactEnrichment: {
        ...compact.contactEnrichment,
        eligibilityStatus,
        eligibilityReason: preserveEvidence ? compact.contactEnrichment?.eligibilityReason : null,
        eligibilityEvidence: preserveEvidence ? compact.contactEnrichment?.eligibilityEvidence : null,
      },
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
    if (!candidate?.name || !candidate?.email) {
      return res.status(400).json({ error: 'candidate name and email are required to confirm identity' });
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
    }
    const manualCandidate = {
      ...authoritativeCandidate,
      email: candidate.email,
      emailSource: 'manual',
      website: candidate.website || null,
      websiteSource: candidate.website ? 'manual' : null,
      affiliation: candidate.affiliation || null,
      affiliationSource: 'staff_manual',
      contactEnrichment: {
        ...(authoritativeCandidate.contactEnrichment || {}),
        email: candidate.email,
        emailSource: 'manual',
        website: candidate.website || null,
        websiteSource: candidate.website ? 'manual' : null,
        affiliation: candidate.affiliation || null,
        affiliationSource: 'staff_manual',
      },
    };
    const confirmed = await confirmIdentity(requestId, pruneCandidateForRoster(manualCandidate), {
      actorProfileId: access?.profileId || null,
      actorSystemUserId: access?.session?.user?.dynamicsSystemuserId || null,
    });
    if (!confirmed) {
      return res.status(409).json({ error: 'Candidate is no longer active; reload before confirming identity.' });
    }
    return res.status(200).json({ success: true, ...confirmed });
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
