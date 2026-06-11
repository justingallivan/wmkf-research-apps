/**
 * API Route: /api/reviewer-finder/grant-cycles
 *
 * GET: Fetch all grant cycles (with proposal/candidate counts + unassigned)
 * POST: Create a new grant cycle (or return existing on shortCode collision)
 * PATCH: Update a grant cycle
 * DELETE: Archive (soft delete) a grant cycle
 *
 * **W3 cutover (2026-05-12)** — Dataverse-only.
 *
 * The previous Postgres implementation was deleted at W3 cutover; the
 * dispatch lives in `lib/services/grant-cycles-dataverse.js` with a
 * loud-fail guard that throws if `WAVE2_BACKEND_GRANT_CYCLES=postgres` is
 * set. Rollback contract: `git revert` the cutover commit + redeploy
 * (Option B per plan §"W3 cutover method").
 */

import {
  listCycles,
  findByShortCode,
  fetchCounts,
  createCycle,
  updateCycleById,
  archiveCycleById,
  normalizeShortCode,
} from '../../../lib/services/grant-cycles-dataverse';
import { requireAppAccess } from '../../../lib/utils/auth';
import { proxifyBlobUrl } from '../../../lib/utils/blob-proxy';
import { isPrivateCycleMaterialPathname, cycleMaterialDownloadPath } from '../../../lib/utils/cycle-material-ref';

// Resolve a single material's user-visible download URL. The single classifier for
// "private" across ALL consumers is the strict `cycle-materials/` pathname prefix
// (isPrivateCycleMaterialPathname) — NOT the JSON `access` field — so the proxy
// route, grant-cycles GET, and both email server-reads agree (Codex SLICE2-5-VERIFY:
// a divergent classifier silently dropped non-prefixed private attachments in
// send-emails). A private ref → the record-scoped cycle-material proxy; a legacy
// public blob URL → the org-asset blob-proxy (Codex SLICE2-3).
function materialDownloadUrl(cycleId, value) {
  if (isPrivateCycleMaterialPathname(value)) {
    return cycleMaterialDownloadPath(cycleId, value);
  }
  return value ? proxifyBlobUrl(value) : value;
}

function proxifyAttachments(cycleId, attachments) {
  if (!attachments || !Array.isArray(attachments)) return attachments;
  return attachments.map(att => ({
    ...att,
    blobUrl: materialDownloadUrl(cycleId, att.pathname || att.blobUrl),
  }));
}

// Apply blob-URL proxying to the user-visible cycle shape.
function proxifyCycle(cycle) {
  return {
    ...cycle,
    reviewTemplateBlobUrl: materialDownloadUrl(cycle.id, cycle.reviewTemplateBlobUrl),
    additionalAttachments: proxifyAttachments(cycle.id, cycle.additionalAttachments),
  };
}

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'PATCH') return handlePatch(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res) {
  try {
    const includeArchived = req.query.includeArchived === 'true';

    // Parallel: list + count aggregation (3 OData queries total).
    const [rawCycles, counts] = await Promise.all([
      listCycles({ includeArchived }),
      fetchCounts(),
    ]);

    const cycles = rawCycles.map(c => {
      // Per-cycle proposal count: join on akoya_fiscalyear. The Dataverse
      // wmkf_fiscalyearcode column is the canonical key; fall back to the
      // displayname (which equals fiscalyearcode in the Postgres-backfilled
      // domain) when fiscalyearcode is missing on a sandbox/legacy row.
      const fyKey = c.fiscalYearCode || c.name;
      const proposalCount = counts.proposalCountsByFiscalYear.get(fyKey) || 0;
      // Per-cycle candidate count: keyed on shortcode (uppercased).
      const candidateCount = c.shortCode
        ? counts.candidateCountsByShortCode.get(c.shortCode.toUpperCase()) || 0
        : 0;
      return proxifyCycle({ ...c, proposalCount, candidateCount });
    });

    return res.status(200).json({
      success: true,
      cycles,
      unassigned: {
        proposalCount: 0, // No analogue under Dataverse — see note below.
        candidateCount: counts.unassignedCandidateCount,
      },
    });
  } catch (error) {
    console.error('Get grant cycles error:', error);
    return res.status(500).json({
      error: 'Failed to fetch grant cycles',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
// Unassigned proposalCount NOTE: the pre-cutover Postgres handler counted
// `proposal_searches` rows with grant_cycle_id IS NULL. Under Dataverse,
// the equivalent would be akoya_request rows with an unrecognized
// akoya_fiscalyear value — but every request has a fiscalyear set, so the
// concept doesn't translate. Surfacing as 0 preserves the response shape
// without inventing a false signal; the client UI only displays the
// candidateCount portion of "unassigned" anyway.

async function handlePost(req, res) {
  try {
    const { name, shortCode } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Duplicate-check by shortCode (active rows). Plan §"Acceptance tests":
    // preserve the existing 200-success-with-message envelope; do NOT
    // return 409. The `cycle` field is a compact { id, name, shortCode }
    // mapping (Codex S147 step-3 review #3 Q1).
    const normalized = normalizeShortCode(shortCode);
    if (normalized) {
      const existing = await findByShortCode(normalized);
      if (existing && existing.isActive) {
        return res.status(200).json({
          success: true,
          cycle: {
            id: existing.id,
            name: existing.name,
            shortCode: existing.shortCode,
          },
          message: 'Cycle with this shortCode already exists',
        });
      }
    }

    const created = await createCycle(req.body);
    return res.status(201).json({
      success: true,
      cycle: proxifyCycle({ ...created, proposalCount: 0, candidateCount: 0 }),
    });
  } catch (error) {
    console.error('Create grant cycle error:', error);
    return res.status(500).json({
      error: 'Failed to create grant cycle',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}

async function handlePatch(req, res) {
  try {
    const { id, ...input } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (Object.keys(input).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updated = await updateCycleById(id, input);
    if (!updated) return res.status(404).json({ error: 'Grant cycle not found' });

    return res.status(200).json({ success: true, cycle: proxifyCycle(updated) });
  } catch (error) {
    console.error('Update grant cycle error:', error);
    return res.status(500).json({
      error: 'Failed to update grant cycle',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}

async function handleDelete(req, res) {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    // Soft delete: PATCH wmkf_isactive=false (NOT row delete). Behavior
    // parity: old Postgres handler returned 200 unconditionally even when
    // the row didn't exist; preserved here (idempotent archive).
    await archiveCycleById(id);
    return res.status(200).json({ success: true, message: 'Grant cycle archived' });
  } catch (error) {
    console.error('Archive grant cycle error:', error);
    return res.status(500).json({
      error: 'Failed to archive grant cycle',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
