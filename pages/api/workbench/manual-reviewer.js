/**
 * API: /api/workbench/manual-reviewer
 *
 * POST one sparse staff-entered reviewer into a request's durable candidate
 * pool. This is Phase 1 only: no enrichment runs here. Also captures
 * REFERRALS (S249) via `referredBy` — same abstain-or-confirm resolution
 * flow, provenance `referred`.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → input parsing/validation (branch-independent checks
 * stay here per the P1m template) → withDalContext → one service call →
 * result/error→HTTP mapping. The identity-resolution / conflict / exclusion
 * pipeline lives in lib/services/workbench/manual-reviewer-service.js, whose
 * typed errors carry the exact historical `{ error, code, ... }` envelopes.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { normalizeOrcid } from '../../../lib/utils/orcid-normalize';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { addManualReviewer } from '../../../lib/services/workbench/manual-reviewer-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 180;
const MAX_EMAIL = 254;
const MAX_AFFILIATION = 500;
const MAX_NOTE = 1000;
const RESOLUTION_MODES = new Set(['reuse_reviewer', 'reuse_contact', 'create_new']);

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const body = req.body || {};
  const requestId = cleanString(body.requestId, 64);
  const name = cleanString(body.name, MAX_NAME);
  const email = cleanString(body.email, MAX_EMAIL).toLowerCase();
  const affiliation = cleanString(body.affiliation, MAX_AFFILIATION);
  const note = cleanString(body.note, MAX_NOTE);
  const referredBy = cleanString(body.referredBy, MAX_NAME);
  const orcidRaw = cleanString(body.orcid, 64);
  const orcidNorm = orcidRaw ? normalizeOrcid(orcidRaw) : { state: 'empty' };
  const orcid = orcidNorm.state === 'valid' ? orcidNorm.id : null;
  const resolution = body.resolution || null;

  if (!requestId) return res.status(400).json({ error: 'requestId is required (akoya_request GUID)' });
  if (!GUID_RE.test(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email must be a valid email address' });
  if (orcidRaw && !orcid) return res.status(400).json({ error: 'orcid must be a valid ORCID iD' });
  if (resolution) {
    if (!RESOLUTION_MODES.has(resolution.mode)) return res.status(400).json({ error: 'resolution.mode is invalid' });
    if (resolution.reviewerId && !GUID_RE.test(resolution.reviewerId)) return res.status(400).json({ error: 'resolution.reviewerId must be a GUID' });
    if (resolution.contactId && !GUID_RE.test(resolution.contactId)) return res.status(400).json({ error: 'resolution.contactId must be a GUID' });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return withDalContext('workbench-manual-reviewer', async () => {
    try {
      const result = await addManualReviewer({
        requestId, name, email, affiliation, note, referredBy, orcid, resolution, actingUserSystemId,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('manual-reviewer error:', error);
      return res.status(500).json({
        error: 'Failed to add manual reviewer',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
