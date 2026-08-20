/**
 * /api/workbench/reviewer-roster — durable per-request reviewer-search candidate
 * roster behind the Workbench Reviewers→Find tab (S224). Pure Postgres
 * (`reviewer_find_roster` via `reviewer-roster-store`) reconciled on GET with
 * authoritative Dataverse engagement for every suggestion-anchored active row.
 *
 *   GET   ?requestId            → { active, excluded, ineligible, blocked, savedKeys, allNames, repairRequests }
 *   POST  { requestId, candidates }                  → record surfaced
 *     (active, or ineligible only with a bound server eligibility receipt)
 *   PATCH { requestId, action:'exclude', candidate } → set aside
 *   PATCH { requestId, action:'promote', candidateKey } → excluded → active (returns blob; stale/no-op is 409)
 *   PATCH { requestId, action:'saved', candidates }  → rejected; promotion services own graduation
 *   PATCH { requestId, action:'confirm_identity', candidate } → staff attestation
 *   PATCH { requestId, action:'update_contact_draft', candidateKey, updates } → roster-only website/affiliation edit
 *   PATCH { requestId, action:'remove_previous_results' } → delete active search history
 *
 * App-key tuple matches my-candidates.js so the Find tab's `reviewers`/
 * `reviewer-finder` grants both reach it.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import {
  recordSurfaced,
  setExcluded,
  promote,
  confirmIdentity,
  updateContactDraft,
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
import { resolveProposalPI } from '../../../lib/services/proposal-pi-identity';
import { fetchCoPIs } from '../../../lib/services/proposal-participants';
import { DeduplicationService } from '../../../lib/services/deduplication-service';
import { normalizeReviewerName } from '../../../lib/utils/reviewer-name-match';
import { ContactParser } from '../../../lib/utils/contact-parser';
import {
  PROVENANCE_KINDS,
  provenanceKindOf,
} from '../../../lib/utils/reviewer-provenance';
import {
  pruneCandidateForRoster,
  reviewerCandidateKey,
} from '../../../shared/components/reviewers/reviewer-search-logic';
import { listOpenAddressRepairRequests } from '../../../lib/services/reviewer-address-trust-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Cap candidates per POST — a Find run asks for at most 25, but guard against an
// oversized body regardless.
const MAX_CANDIDATES_PER_POST = 100;
// The store retains up to 300 active/saved rows per request. A single removal
// action must therefore be able to carry every visible prior-result key.
const MAX_PREVIOUS_RESULT_KEYS = 300;

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
      || candidate.enrichedProposalKey
      // Raw legacy flags remain explicit because an untrusted provenance object
      // can short-circuit inference. Use truthiness: pruning normalizes these to
      // booleans before persistence, so string-valued legacy payloads must be
      // rejected at the same boundary too.
      || !!candidate.isApplicantRecommended
      || !!candidate.applicantRecommended
      || provenanceKindOf(candidate) === PROVENANCE_KINDS.APPLICANT_SUGGESTED
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
    serverIdentityReviewReason: _serverIdentityReviewReason,
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

function dedupeProposalAuthorNames(names) {
  const byNormalizedName = new Map();
  for (const name of Array.isArray(names) ? names : []) {
    const normalized = normalizeReviewerName(name);
    if (normalized && !byNormalizedName.has(normalized)) byNormalizedName.set(normalized, name);
  }
  return Array.from(byNormalizedName.values());
}

async function findProposalAuthorMatch(requestId, candidates) {
  // Co-investigators are server-derivable here from the canonical
  // wmkf_apprequestperson Co-PI junction; no browser-carried proposal analysis is
  // trusted. resolveProposalPI also supplies both contact and canonical PI name
  // forms when available, covering a structured-name variant at this boundary.
  const { piIdentity, coPIs } = await withDalContext(
    'workbench-reviewer-roster-confirm-author-check',
    async () => ({
      piIdentity: await resolveProposalPI(requestId),
      coPIs: await fetchCoPIs(requestId),
    }),
  );
  const proposalAuthors = dedupeProposalAuthorNames([
    piIdentity?.canonicalName,
    piIdentity?.contactName,
    ...coPIs,
  ]);
  if (proposalAuthors.length === 0) return null;
  const authorFilter = DeduplicationService.filterProposalAuthors(
    (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate?.name),
    proposalAuthors,
  );
  return authorFilter.excluded[0] || null;
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
    // This marker is server-owned and fail-closed. A roster refresh may carry a
    // stale or missing browser copy, but only authenticated confirmation should
    // clear the stored review requirement.
    const withIdentityReviewReason = stored?.serverIdentityReviewReason
      ? { ...withAddressAuthority, serverIdentityReviewReason: stored.serverIdentityReviewReason }
      : withAddressAuthority;
    if (!stored || !hasStoredStaffAuthority(stored)) return withIdentityReviewReason;
    const confirmation = stored.staffIdentityConfirmation;
    const email = confirmation.email || null;
    const website = confirmation.website || null;
    const affiliation = confirmation.affiliation || null;
    return {
      ...pruneCandidateForRoster({
        ...withIdentityReviewReason,
        name: stored.name || withIdentityReviewReason.name,
        email,
        emailSource: email ? 'manual' : null,
        website,
        websiteSource: website ? 'manual' : null,
        affiliation,
        affiliationSource: 'staff_manual',
        manualContactFields: stored.manualContactFields,
        contactEnrichment: {
          ...(withIdentityReviewReason.contactEnrichment || {}),
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
  const roster = await listForRequest(requestId);
  const reconciled = await withDalContext('workbench-reviewer-roster-get', () => (
    reconcileRosterEngagement({ requestId, roster })
  ));
  const candidateKeys = ['active', 'excluded', 'ineligible', 'blocked']
    .flatMap((bucket) => (Array.isArray(reconciled?.[bucket]) ? reconciled[bucket] : []))
    .map((candidate) => candidate?.candidateKey)
    .filter(Boolean);
  let repairRequests = [];
  let repairRequestsUnavailable = false;
  try {
    repairRequests = await listOpenAddressRepairRequests({ requestId, candidateKeys });
  } catch (error) {
    repairRequestsUnavailable = true;
    console.error('reviewer-roster repair request lookup failed:', error.message);
  }
  return res.status(200).json({
    success: true,
    ...reconciled,
    repairRequests,
    repairRequestsUnavailable,
  });
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
    // Compare both the submitted name and the server-stored roster name. The
    // latter closes a renamed-payload bypass for ephemeral unverified rows, which
    // are recorded immediately before this rescue action.
    let storedCandidate = null;
    if (candidate.candidateKey) {
      [storedCandidate] = await findCandidatesByKeys(requestId, [candidate.candidateKey]);
    }
    const proposalAuthorMatch = await findProposalAuthorMatch(
      requestId,
      [authoritativeCandidate, storedCandidate],
    );
    if (proposalAuthorMatch) {
      return res.status(422).json({
        success: false,
        error: 'Proposal authors cannot be added as reviewers for their own request.',
        code: 'proposal_author_candidate',
      });
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

  if (action === 'update_contact_draft') {
    const { candidateKey, updates } = req.body;
    const allowedFields = new Set(['website', 'affiliation']);
    const updateKeys = updates && typeof updates === 'object' && !Array.isArray(updates)
      ? Object.keys(updates)
      : [];
    if (typeof candidateKey !== 'string' || !candidateKey.trim() || candidateKey.trim().length > 1024) {
      return res.status(400).json({ error: 'candidateKey is required and must not exceed 1024 characters' });
    }
    if (updateKeys.length === 0 || updateKeys.some((field) => !allowedFields.has(field))) {
      return res.status(400).json({
        error: 'updates must contain only website and/or affiliation',
        code: 'invalid_contact_draft',
      });
    }
    if (updateKeys.some((field) => updates[field] !== null && typeof updates[field] !== 'string')) {
      return res.status(400).json({ error: 'website and affiliation must be strings or null' });
    }
    const website = typeof updates.website === 'string' ? updates.website.trim() : updates.website;
    const affiliation = typeof updates.affiliation === 'string' ? updates.affiliation.trim() : updates.affiliation;
    if (website && website.length > 500) {
      return res.status(400).json({ error: 'website exceeds 500 characters' });
    }
    if (website) {
      let parsedWebsite = null;
      try {
        parsedWebsite = new URL(website);
      } catch { /* handled below */ }
      if (
        !parsedWebsite
        || !['http:', 'https:'].includes(parsedWebsite.protocol)
        || ContactParser.isDocumentUrl(website)
      ) {
        return res.status(400).json({
          error: 'website must be an http(s) profile page, not a document link',
          code: 'invalid_contact_draft',
        });
      }
    }
    if (affiliation && affiliation.length > 500) {
      return res.status(400).json({ error: 'affiliation exceeds 500 characters' });
    }
    let candidate = null;
    try {
      candidate = await updateContactDraft(requestId, candidateKey, {
        ...(Object.prototype.hasOwnProperty.call(updates, 'website') ? { website } : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'affiliation') ? { affiliation } : {}),
      });
    } catch (error) {
      if (error?.code === 'invalid_contact_draft') {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      throw error;
    }
    if (!candidate) {
      return res.status(409).json({
        error: 'Candidate changed or is no longer active; reload before editing contact details.',
        code: 'candidate_stale',
      });
    }
    return res.status(200).json({ success: true, candidate });
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

  return res.status(400).json({ error: 'Unknown action (expected exclude | promote | saved | confirm_identity | update_contact_draft | remove_previous_results)' });
}
