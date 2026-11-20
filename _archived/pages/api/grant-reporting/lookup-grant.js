/**
 * API Route: /api/grant-reporting/lookup-grant
 *
 * POST: Look up a Dynamics request by request number AND list its SharePoint
 *       documents in a single round-trip. The frontend uses the result to
 *       prefill header fields and populate document pickers.
 *
 * Data boundary: staff-shared, scoped by `grant-reporting` or
 * `batch-phase-i-summaries` app access. Any user with that grant can look up
 * any request by its number — grant records are foundation-owned and are not
 * partitioned per program director at this layer. The trusted DAL context is
 * appropriate because the surface only returns whitelisted header fields plus
 * SharePoint file listings — never raw Dynamics rows.
 *
 * Request body: { requestNumber: string }
 *
 * Response contract (all outcomes are status 200; failure modes are non-fatal —
 * the frontend can fall back to upload-only):
 * {
 *   found, requestId, header, documents, errors: { dynamics, sharepoint }
 * }
 * — see lib/services/grant-reporting/lookup-grant-service.js for field detail.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result→HTTP mapping. Business logic (header projection, SharePoint
 * bucket listing, best-guess classification) lives in the service;
 * `classifyFile`'s canonical home is lib/services/grant-reporting/classify-file.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { lookupGrant } from '../../../lib/services/grant-reporting/lookup-grant-service';

// Lookup is generic (request lookup + SharePoint doc listing) — any app that
// needs to target an akoya_request by request number can reuse this endpoint.
const APP_KEYS = ['grant-reporting', 'batch-phase-i-summaries'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, ...APP_KEYS);
  if (!access) return;

  const { requestNumber } = req.body || {};
  if (!requestNumber || typeof requestNumber !== 'string') {
    return res.status(400).json({ error: 'requestNumber is required' });
  }

  return withDalContext('grant-reporting-lookup', async () => {
    const result = await lookupGrant({ requestNumber });
    return res.status(200).json(result);
  });
}
