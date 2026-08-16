/**
 * API Route: /api/reviewer-finder/contact-history
 *
 * GET — PI / co-PI history for a single contact across all akoya_request rows.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 3): auth guard →
 * method dispatch → input validation → withDalContext → one service call →
 * result/error→HTTP mapping. The UNION read strategy, merge/dedupe, metadata
 * hydration, and projection live in
 * lib/services/reviewer-finder/contact-history-service.js.
 *
 * Query params:
 *   contactId (required) — GUID of the contact to query history for
 *
 * Response:
 *   { contactId, rows: [...], counts: { pi, copi, total } }
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { getContactHistory } from '../../../lib/services/reviewer-finder/contact-history-service';

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contactId = (req.query.contactId || '').trim();
  if (!contactId) {
    return res.status(400).json({ error: 'contactId is required' });
  }
  // Strict GUID check — contactId is interpolated into the service's OData
  // $filter. The strict shape (vs. the prior permissive [0-9a-fA-F-]{32,40})
  // is the same edge guard every reviewer-surface selector uses (lib/utils/guid.js).
  if (!isGuid(contactId)) {
    return res.status(400).json({ error: 'contactId must be a GUID' });
  }

  return withDalContext('contact-history', async () => {
    try {
      const result = await getContactHistory({ contactId });
      return res.status(200).json(result);
    } catch (err) {
      console.error('[contact-history] error:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  });
}
