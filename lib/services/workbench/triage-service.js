// @ts-check
/**
 * Workbench — triage-status write service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for POST /api/workbench/triage; the route is a
 * thin shell (method dispatch, auth, input validation, DAL context, HTTP
 * mapping). Triage is a staff winnowing signal that drives DASHBOARD
 * VISIBILITY ONLY (Advancing vs Set aside; reversible). See
 * docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md.
 *
 * AUTHORIZATION — HARD server-side manage gate (NOT the fail-open/UI-only
 * `canManage` posture used by the org-open reviewer-workflow APIs, S207).
 * This writes an AUTHORITATIVE visibility field, so the gate is enforced
 * here, server-side: superuser OR the request's lead PD
 * (`_wmkf_programdirector_value` non-null and equal to the caller's
 * dynamicsSystemuserId). A null/absent lead PD → 403 for non-superusers
 * (superuser only). Connor edits directly in Dataverse if a non-lead-PD
 * change is needed.
 *
 * Contract (plan Decision 3): plain args, plain 200 body, ServiceHttpError
 * 404/403 (default `{ error }` envelope); ASSUMES a trusted DAL context.
 */

import { getUserRole } from '../../utils/auth';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../service-http-error';

/** @typedef {import('../../utils/actor-ref.js').ActorRef} ActorRef */

/**
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {number} args.triageValue - validated numeric option value
 * @param {string|number|null} args.profileId - caller's profile id (role lookup)
 * @param {ActorRef|null} args.callerSystemId - caller's branded write-actor id.
 *   Must be minted via `actorRefFromSession` (Invariant-Map #10) — a raw string
 *   from request input will not type-check here, so the acting identity is
 *   provably session-derived, not spoofed. Flows to the Dataverse write as
 *   `actingUserSystemId`; null attributes the write to the service principal.
 * @returns {Promise<{ success: true, requestId: string, triageStatus: number }>}
 * @throws {ServiceHttpError} 404 request not found; 403 manage gate
 */
export async function setTriageStatus({ requestId, triageValue, profileId, callerSystemId }) {
  // Derive superuser status server-side. requireAppAccess bypasses app
  // checks for superusers but does NOT expose an isSuperuser flag, so we
  // resolve it explicitly via the canonical (uncached) role helper.
  // Cast: getUserRole is typed `(number)` but is null/undefined-safe at runtime
  // (returns 'read_only' on any falsy id) — pass the value through unchanged.
  const isSuperuser = (await getUserRole(/** @type {any} */ (profileId))) === 'superuser';

  /** @type {Record<string, any> | null} */
  let request;
  try {
    request = await grantRequestAdapter.getById(requestId, {
      select: 'akoya_requestid,_wmkf_programdirector_value',
    });
  } catch {
    request = null;
  }
  if (!request?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  // Hard manage gate: superuser, or the request's lead PD. A null/absent
  // lead PD is superuser-only (no PD to match against → fail closed).
  if (!isSuperuser) {
    const leadPd = request._wmkf_programdirector_value || null;
    const isLeadPd = !!leadPd && !!callerSystemId
      && String(leadPd).toLowerCase() === String(callerSystemId).toLowerCase();
    if (!isLeadPd) {
      throw new ServiceHttpError(
        'Only the lead Program Director (or a superuser) can set triage status for this request.',
        { httpStatus: 403 },
      );
    }
  }

  await grantRequestAdapter.updateById(requestId, {
    wmkf_triagestatus: triageValue,
  }, { actingUserSystemId: callerSystemId });

  return { success: true, requestId, triageStatus: triageValue };
}
