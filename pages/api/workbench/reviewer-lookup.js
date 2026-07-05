/**
 * API: /api/workbench/reviewer-lookup
 *
 * Read-only cross-store identity lookup for the manual reviewer add form. The
 * matching/orchestration core lives in lib/services/reviewer-identity-lookup.js
 * (pure, auth-free, unit/smoke-testable); this file is the thin HTTP shell —
 * auth, input parsing/validation, and the Dynamics restriction context.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { normalizeOrcid } from '../../../lib/utils/orcid-normalize';
import { lookupReviewerIdentity } from '../../../lib/services/reviewer-identity-lookup';

// Re-exported so manual-reviewer.js (and existing tests) keep importing it from
// this route; the implementation now lives in the lib service.
export { lookupReviewerIdentity };

const MAX_NAME = 180;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function normalizeEmail(email) {
  return cleanString(email, MAX_EMAIL).toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const body = req.body || {};
  const name = cleanString(body.name, MAX_NAME);
  const email = normalizeEmail(body.email);
  const orcidRaw = cleanString(body.orcid, 64);
  const orcidNorm = orcidRaw ? normalizeOrcid(orcidRaw) : { state: 'empty' };
  const orcid = orcidNorm.state === 'valid' ? orcidNorm.id : null;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email must be a valid email address' });
  if (orcidRaw && !orcid) return res.status(400).json({ error: 'orcid must be a valid ORCID iD' });

  return withDalContext('workbench-reviewer-lookup', async () => {
    try {
      const out = await lookupReviewerIdentity({ name, email: email || null, orcid });
      return res.status(200).json(out);
    } catch (error) {
      console.error('reviewer-lookup error:', error);
      return res.status(500).json({
        error: 'Failed to look up reviewer',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
