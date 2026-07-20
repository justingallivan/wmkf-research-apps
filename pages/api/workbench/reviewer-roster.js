/**
 * /api/workbench/reviewer-roster — durable per-request reviewer-search candidate
 * roster behind the Workbench Reviewers→Find tab (S224). Pure Postgres
 * (`reviewer_find_roster` via `reviewer-roster-store`); no Dataverse, so no
 * `bypassDynamicsRestrictions` needed. See docs/atlas/postgres-reviewer-find-roster.md.
 *
 *   GET   ?requestId            → { active, excluded, ineligible, allNames }
 *   POST  { requestId, candidates }                  → record surfaced
 *     (active, or ineligible only with a bound server eligibility receipt)
 *   PATCH { requestId, action:'exclude', candidate } → set aside
 *   PATCH { requestId, action:'promote', candidateKey } → excluded → active (returns blob)
 *   PATCH { requestId, action:'saved', candidates }  → graduated to the Dataverse pool
 *   PATCH { requestId, action:'confirm_identity', candidate } → staff attestation
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
  markSaved,
  listForRequest,
  findCandidateBySuggestion,
  removePreviousActiveSearchResults,
} from '../../../lib/services/reviewer-roster-store';
import { verifyAutomatedIdentityAttestation } from '../../../lib/services/reviewer-candidate-attestation';
import { pruneCandidateForRoster } from '../../../shared/components/reviewers/reviewer-search-logic';

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
      || candidate.isApplicantRecommended === true
      || candidate.enrichedProposalKey
      || candidate.provenance?.kind === 'applicant_suggested'
    )
  );
}

async function authoritativeApplicantCandidate(requestId, candidate) {
  if (!candidate?.suggestionId) return null;
  const stored = await findCandidateBySuggestion(requestId, candidate.suggestionId);
  if (!stored || stored.candidateKey !== candidate.candidateKey) return null;
  return pruneCandidateForRoster(stored);
}

async function handleGet(req, res) {
  const { requestId } = req.query;
  if (!validRequestId(requestId)) {
    return res.status(400).json({ error: 'Valid requestId (GUID) is required' });
  }
  const roster = await listForRequest(requestId);
  return res.status(200).json({ success: true, ...roster });
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
    const compact = pruneCandidateForRoster(candidate);
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
    return {
      ...compact,
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
  const recorded = await recordSurfaced(requestId, pruned);
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
    let candidateToExclude = pruneCandidateForRoster(candidate);
    if (isServerManagedApplicantCandidate(candidate)) {
      candidateToExclude = await authoritativeApplicantCandidate(requestId, candidate);
      if (!candidateToExclude) {
        return res.status(409).json({ error: 'Applicant reviewer row is stale or missing; reload before excluding it.' });
      }
    }
    await setExcluded(requestId, candidateToExclude);
    return res.status(200).json({ success: true });
  }

  if (action === 'promote') {
    const { candidateKey } = req.body;
    if (!candidateKey) return res.status(400).json({ error: 'candidateKey is required to promote' });
    const candidate = await promote(requestId, candidateKey);
    return res.status(200).json({ success: true, candidate });
  }

  if (action === 'saved') {
    const { candidates } = req.body;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'candidates[] is required to mark saved' });
    }
    const pruned = [];
    for (const candidate of candidates) {
      let safeCandidate = pruneCandidateForRoster(candidate);
      if (isServerManagedApplicantCandidate(candidate)) {
        safeCandidate = await authoritativeApplicantCandidate(requestId, candidate);
        if (!safeCandidate) {
          return res.status(409).json({ error: 'Applicant reviewer row is stale or missing; reload before marking it saved.' });
        }
      }
      if (safeCandidate?.name && safeCandidate?.candidateKey) pruned.push(safeCandidate);
    }
    if (pruned.length !== candidates.length) {
      return res.status(400).json({ error: 'Every saved candidate requires name and candidateKey' });
    }
    const saved = await markSaved(requestId, pruned);
    return res.status(200).json({ success: true, saved });
  }

  if (action === 'confirm_identity') {
    const { candidate } = req.body;
    if (!candidate?.name || !candidate?.email) {
      return res.status(400).json({ error: 'candidate name and email are required to confirm identity' });
    }
    let authoritativeCandidate = candidate;
    if (isServerManagedApplicantCandidate(candidate)) {
      authoritativeCandidate = await authoritativeApplicantCandidate(requestId, candidate);
      if (!authoritativeCandidate) {
        return res.status(409).json({ error: 'Applicant reviewer row is stale or missing; reload before confirming identity.' });
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
    const invalidRefs = !Array.isArray(candidateRefs)
      || candidateRefs.length === 0
      || candidateRefs.length > MAX_PREVIOUS_RESULT_KEYS
      || candidateRefs.some((ref) => (
        !ref
        || typeof ref.candidateKey !== 'string'
        || !ref.candidateKey.trim()
        || ref.candidateKey.length > 256
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
