/**
 * API: /api/workbench/orcid-lookup
 *
 * Read-only ORCID iD lookup for the manual reviewer-add form: given a name (and
 * optionally an affiliation / email), find the person's ORCID iD via ORCID's
 * public search so staff don't have to look it up by hand.
 *
 * Reuses ORCIDService.findContact — the SAME fail-safe resolver the identity
 * spine uses: it gates on a name match (no homonym attach), narrows by
 * affiliation, and ABSTAINS (ambiguous / none) rather than guessing among
 * distinct namesakes. No write happens here; the chosen ORCID is persisted only
 * when the staff member submits the add (manual-reviewer.js, fill-only).
 *
 * Note: ORCID's public API is searchable by name + affiliation, NOT by email.
 * An entered email is accepted (and cross-checked against the matched record's
 * public emails for corroboration) but is not itself a search key.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { ORCIDService } from '../../../lib/services/orcid-service';
import { normalizeOrcid } from '../../../lib/utils/orcid-normalize';

const MAX_NAME = 180;
const MAX_AFFILIATION = 500;
const MAX_EMAIL = 254;

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
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
  const name = cleanString(body.name, MAX_NAME);
  const affiliation = cleanString(body.affiliation, MAX_AFFILIATION);
  const email = cleanString(body.email, MAX_EMAIL).toLowerCase();

  if (!name) return res.status(400).json({ error: 'name is required' });

  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Degrade, don't 500: ORCID lookup is an optional convenience.
    return res.status(200).json({ found: false, reason: 'ORCID lookup is not configured.' });
  }

  try {
    const result = await ORCIDService.findContact({
      name,
      affiliation: affiliation || null,
      clientId,
      clientSecret,
      throwOnError: false,
    });

    // null → no name-confident record; {status:'ambiguous'} → multiple distinct
    // namesakes, deliberately not resolved. Both are "nothing safe to attach".
    if (!result || result.status === 'ambiguous' || !result.orcidId) {
      return res.status(200).json({
        found: false,
        ambiguous: result?.status === 'ambiguous',
        candidateCount: result?.candidateCount || 0,
      });
    }

    const norm = normalizeOrcid(result.orcidId);
    if (norm.state !== 'valid') {
      return res.status(200).json({ found: false });
    }
    const orcid = norm.id;

    // Corroboration signal for the UI: does the matched ORCID record's public
    // email agree with what staff typed (when both are present)?
    const recordEmail = result.email ? String(result.email).toLowerCase() : null;
    const emailMatches = !!(email && recordEmail && email === recordEmail);

    return res.status(200).json({
      found: true,
      orcid,
      orcidUrl: result.orcidUrl || `https://orcid.org/${orcid}`,
      matchedName: result.name || name,
      matchedInstitution: result.matchedInstitution || null,
      institutionCorroborated: !!result.institutionCorroborated,
      recordEmail,
      emailMatches,
    });
  } catch (error) {
    console.error('orcid-lookup error:', error);
    return res.status(502).json({ error: 'ORCID lookup failed', found: false });
  }
}
