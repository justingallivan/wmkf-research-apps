/**
 * /api/workbench/reviewer-roster — durable per-request reviewer-search candidate
 * roster behind the Workbench Reviewers→Find tab (S224). Pure Postgres
 * (`reviewer_find_roster` via `reviewer-roster-store`); no Dataverse, so no
 * `bypassDynamicsRestrictions` needed. See docs/atlas/postgres-reviewer-find-roster.md.
 *
 *   GET   ?requestId            → { active, excluded, allNames }
 *   POST  { requestId, candidates }                  → record surfaced (status 'active')
 *   PATCH { requestId, action:'exclude', candidate } → set aside
 *   PATCH { requestId, action:'promote', candidateKey } → excluded → active (returns blob)
 *   PATCH { requestId, action:'saved', candidates }  → graduated to the Dataverse pool
 *   PATCH { requestId, action:'confirm_identity', candidate } → staff attestation
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
} from '../../../lib/services/reviewer-roster-store';
import { pruneCandidateForRoster } from '../../../shared/components/reviewers/reviewer-search-logic';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Cap candidates per POST — a Find run asks for at most 25, but guard against an
// oversized body regardless.
const MAX_CANDIDATES_PER_POST = 100;

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
  // Prune server-side too — never persist raw enrichment internals even if a
  // client sent them.
  const pruned = candidates.map(pruneCandidateForRoster).filter((c) => c && c.name);
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
    await setExcluded(requestId, pruneCandidateForRoster(candidate));
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
    const pruned = candidates.map(pruneCandidateForRoster).filter((candidate) => candidate?.name && candidate?.candidateKey);
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
    const manualCandidate = {
      ...candidate,
      emailSource: 'manual',
      websiteSource: candidate.website ? 'manual' : null,
      affiliationSource: 'staff_manual',
      contactEnrichment: {
        ...(candidate.contactEnrichment || {}),
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

  return res.status(400).json({ error: 'Unknown action (expected exclude | promote | saved | confirm_identity)' });
}
