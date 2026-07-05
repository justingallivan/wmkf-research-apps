/**
 * API Route: /api/admin/policies
 *
 * Admin endpoint for publishing new versions of wmkf_policy slots.
 *
 * GET  — Returns the visible slots (server allowlist) with their active
 *        version + full version history + per-version isActive/isResidue
 *        derived flags. parentEtag returned so the client can pass it back
 *        as If-Match on publish.
 * POST  — Publish a new version. Body:
 *        { slotCode, versionLabel, title, body, effectiveDate?, parentEtag, requestId? }
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): multi-verb
 * dispatch inside ONE withDalContext (the historical route had a single shared
 * bypass for both verbs — P1m base case; label kept) → one service call per
 * verb → per-verb result/error→HTTP mapping (the POST status→HTTP map per
 * plan §5 stays here). Business logic lives in
 * lib/services/admin/policies-service.js.
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { listSlots, publishPolicy } from '../../../lib/services/admin/policies-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    return await withDalContext('admin-policies', async () => {
      if (req.method === 'GET') {
        return res.json(await listSlots());
      }
      return await handlePost(req, res, gate.profileId);
    });
  } catch (err) {
    console.error('[admin/policies] unexpected error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

async function handlePost(req, res, profileId) {
  const { slotCode, versionLabel, title, body, effectiveDate, parentEtag } = req.body || {};
  const requestId = (req.body && req.body.requestId) || undefined;

  let outcome;
  let auditWritten;
  try {
    ({ outcome, auditWritten } = await publishPolicy({
      slotCode, versionLabel, title, body, effectiveDate, parentEtag, requestId, profileId,
    }));
  } catch (err) {
    if (err instanceof ServiceHttpError) {
      return res.status(err.httpStatus).json(err.body ?? { error: err.message });
    }
    throw err;
  }

  const responseBody = {
    status: outcome.status,
    child: outcome.child,
    parent: outcome.parent,
    priorRetired: outcome.priorRetired,
    auditWritten,
    warnings: [...(outcome.warnings || [])],
    orphan: outcome.orphan || null,
    freshState: outcome.freshState || null,
  };
  if (!auditWritten) {
    responseBody.warnings.push('audit_finalize_failed');
    if (responseBody.status === 'completed') responseBody.status = 'partial';
  }

  // HTTP status mapping per plan §5
  const httpStatus =
    outcome.status === 'concurrency_conflict' ? 409 :
    outcome.status === 'label_conflict' ? 409 :
    outcome.status === 'slot_not_provisioned' ? 500 :
    outcome.status === 'duplicate_slot_rows' ? 500 :
    outcome.status === 'failed' ? 500 :
    200;
  return res.status(httpStatus).json(responseBody);
}
