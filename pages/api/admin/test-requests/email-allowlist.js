/**
 * API Route: /api/admin/test-requests/email-allowlist
 *
 * GET — the superuser-edited test-Request email allowlist and the fixed
 *   Foundation domain rule (production plan *Owner decisions*, S546).
 * PUT — Body: { addresses: string[] } replaces the list. Invalid addresses
 *   reject the whole write with 400 and their errors; Foundation addresses are
 *   dropped because they are always allowed.
 *
 * Superuser only. Storage: `testRequestEmailAllowlist` in
 * `wmkf_appsystemsettings`, written with the editor's identity.
 */

import { requireSuperuser } from '../../../../lib/utils/auth';
import {
  FOUNDATION_EMAIL_DOMAIN,
  MAX_ALLOWLIST_ADDRESSES,
  readTestRequestEmailAllowlistForAdmin,
  writeTestRequestEmailAllowlist,
} from '../../../../lib/services/test-requests/email-allowlist';

export const config = {
  api: { bodyParser: { sizeLimit: '32kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'GET') {
    const state = await readTestRequestEmailAllowlistForAdmin();
    return res.status(200).json({ ...state, foundationDomain: FOUNDATION_EMAIL_DOMAIN, maxAddresses: MAX_ALLOWLIST_ADDRESSES });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Array.isArray(body.addresses)) {
    return res.status(400).json({ error: 'The request body must contain only an addresses list.' });
  }
  try {
    const result = await writeTestRequestEmailAllowlist(body.addresses, gate.profileId);
    if (!result.ok) return res.status(400).json({ error: 'Some addresses are not valid.', details: result.errors });
    return res.status(200).json({ ok: true, addresses: result.addresses });
  } catch (error) {
    console.error('Admin test-request email allowlist PUT error:', error);
    return res.status(500).json({ error: 'Saving the test-request email allowlist failed.' });
  }
}
