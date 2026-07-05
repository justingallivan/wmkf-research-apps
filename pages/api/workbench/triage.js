/**
 * API: /api/workbench/triage
 *
 * POST — set the triage status (`wmkf_triagestatus`) on a request. Triage is a
 * staff winnowing signal that drives DASHBOARD VISIBILITY ONLY (Advancing vs
 * Set aside; reversible). It replaces the throwaway d26Allowlist.js. See
 * docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md.
 *
 * AUTHORIZATION — HARD server-side manage gate (NOT the fail-open/UI-only
 * `canManage` posture used by the org-open reviewer-workflow APIs, S207). This
 * writes an AUTHORITATIVE visibility field, so the gate is enforced server-side:
 *
 *   requireAppAccess('reviewers')  AND
 *   ( caller is a superuser
 *     OR the request's lead PD (`_wmkf_programdirector_value`) is non-null AND
 *        equals the caller's dynamicsSystemuserId )
 *
 * A null/absent lead PD → 403 for non-superusers (superuser only). Connor edits
 * directly in Dataverse if a non-lead-PD change is needed.
 *
 * Body: { requestId (akoya_request GUID), triageStatus (numeric option value) }.
 */

import { requireAppAccess, getUserRole } from '../../../lib/utils/auth';
import * as grantRequestAdapter from '../../../lib/dataverse/adapters/grant-request.js';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { isGuid } from '../../../lib/utils/guid';
import { isValidTriageValue } from '../../../shared/config/triageStatus';

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  // Read requestId directly off req.body (not via an intermediate var) so the
  // trust-boundary-guid gate tracks the taint root through to the isGuid guard.
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const triageStatus = req.body?.triageStatus;

  // GUID-validate BEFORE requestId becomes a record-id selector (check:trust-boundary-guid).
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  if (!isValidTriageValue(triageStatus)) {
    return res.status(400).json({ error: 'triageStatus must be a valid triage option value' });
  }
  const triageValue = Number(triageStatus);

  return bypassDynamicsRestrictions('workbench-triage', async () => {
    try {
      // Derive superuser status server-side. requireAppAccess bypasses app
      // checks for superusers but does NOT expose an isSuperuser flag, so we
      // resolve it explicitly via the canonical (uncached) role helper.
      const isSuperuser = (await getUserRole(access.profileId)) === 'superuser';

      let request;
      try {
        request = await grantRequestAdapter.getById(requestId, {
          select: 'akoya_requestid,_wmkf_programdirector_value',
        });
      } catch {
        request = null;
      }
      if (!request?.akoya_requestid) {
        return res.status(404).json({ error: `No request found for ${requestId}` });
      }

      // Hard manage gate: superuser, or the request's lead PD. A null/absent
      // lead PD is superuser-only (no PD to match against → fail closed).
      if (!isSuperuser) {
        const leadPd = request._wmkf_programdirector_value || null;
        const callerSystemId = access.session?.user?.dynamicsSystemuserId || null;
        const isLeadPd = !!leadPd && !!callerSystemId
          && String(leadPd).toLowerCase() === String(callerSystemId).toLowerCase();
        if (!isLeadPd) {
          return res.status(403).json({ error: 'Only the lead Program Director (or a superuser) can set triage status for this request.' });
        }
      }

      await grantRequestAdapter.updateById(requestId, {
        wmkf_triagestatus: triageValue,
      }, { actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null });

      return res.status(200).json({ success: true, requestId, triageStatus: triageValue });
    } catch (error) {
      console.error('workbench triage error:', error);
      return res.status(500).json({
        error: 'Failed to set triage status',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
