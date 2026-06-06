/**
 * /api/workbench/reviewer-roster — durable per-request reviewer-search candidate
 * roster behind the Workbench Reviewers→Find tab (S224). Pure Postgres
 * (`reviewer_find_roster` via `reviewer-roster-store`); no Dataverse, so no
 * `bypassDynamicsRestrictions` needed. See docs/atlas/postgres-reviewer-find-roster.md.
 *
 *   GET   ?requestId            → { active, excluded, allNames }
 *   POST  { requestId, candidates }                  → record surfaced (status 'active')
 *   PATCH { requestId, action:'exclude', candidate } → set aside
 *   PATCH { requestId, action:'promote', name }      → excluded → active (returns blob)
 *   PATCH { requestId, action:'saved', names }       → graduated to the Dataverse pool
 *
 * App-key tuple matches my-candidates.js so the Find tab's `reviewers`/
 * `reviewer-finder` grants both reach it.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import {
  recordSurfaced,
  setExcluded,
  promote,
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
    if (req.method === 'PATCH') return await handlePatch(req, res);
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

async function handlePatch(req, res) {
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
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required to promote' });
    const candidate = await promote(requestId, name);
    return res.status(200).json({ success: true, candidate });
  }

  if (action === 'saved') {
    const { names } = req.body;
    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'names[] is required to mark saved' });
    }
    const saved = await markSaved(requestId, names);
    return res.status(200).json({ success: true, saved });
  }

  return res.status(400).json({ error: 'Unknown action (expected exclude | promote | saved)' });
}
