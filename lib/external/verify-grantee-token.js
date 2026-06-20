/**
 * Token + request verification for external GRANTEE deliverables endpoints.
 *
 * Parallel grantee variant of `lib/external/verify-suggestion-token.js`. The
 * reviewer verifier loads `wmkf_appreviewersuggestions` and checks a stored
 * token hash + revocation flag; the grantee token is STATELESS (see
 * grantee-token-lifecycle.js), so there is no hash/revocation layer — the only
 * authoritative checks are: valid signature + not expired (verifyToken),
 * `aud === 'grantee'` (rejects reviewer tokens, which carry no `aud`), and the
 * akoya_request row existing. The related deliverable row is read-only here:
 * absence is "not started" and external routes must fail closed.
 *
 * `sub` IS the akoya_request GUID. Returns a discriminated union mirroring the
 * reviewer verifier so routes share an identical fail-closed contract.
 */

import { verifyToken } from '../services/external-token';
import { DynamicsService } from '../services/dynamics-service';
import { bypassDynamicsRestrictions } from '../services/dynamics-context';
import { getDeliverableForRequest } from '../services/grantee-deliverable-record';
import { GRANTEE_AUDIENCE } from './grantee-token-lifecycle';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  // Source abstract (applicant-authored) + formatted/approved abstracts. The
  // related wmkf_granteedeliverable row owns status/image/caption/dates.
  'wmkf_abstract',
  'wmkf_abstractformatted',
  'wmkf_abstractapproved',
].join(',');

/**
 * Verify a grantee magic-link token and load its akoya_request in one call.
 *
 * @param {string} jwt - the raw token from the URL
 * @returns {Promise<
 *   | { ok: true, payload: object, requestId: string, request: object, deliverable: object|null }
 *   | { ok: false, reason: 'no_token'|'expired'|'invalid_signature'|'invalid_claim'|'malformed'|'not_found' }
 * >}
 */
export async function verifyGranteeToken(jwt) {
  const verified = await verifyToken(jwt);
  if (!verified.valid) {
    return { ok: false, reason: verified.reason };
  }

  // Audience guard: reject any token not minted for the grantee surface. A
  // reviewer token has no `aud` claim, so this also blocks cross-surface replay.
  // Absent/mismatched `aud` is NOT legacy-compatible here.
  if (verified.payload.aud !== GRANTEE_AUDIENCE) {
    return { ok: false, reason: 'invalid_claim' };
  }

  const requestId = verified.payload.subject;
  if (!requestId) {
    return { ok: false, reason: 'malformed' };
  }

  // External verification has no Dynamics restriction context; bypass ambient
  // restrictions so the lookup always resolves.
  let request;
  let deliverable;
  try {
    const loaded = await bypassDynamicsRestrictions('grantee-token-verify', async () => {
      const req = await DynamicsService.getRecord('akoya_requests', requestId, {
        select: REQUEST_SELECT,
      });
      const del = await getDeliverableForRequest(requestId);
      return { req, del };
    });
    request = loaded.req;
    deliverable = loaded.del;
  } catch (e) {
    if (e.status === 404 || /Get record failed \(404\)/.test(e.message || '')) {
      return { ok: false, reason: 'not_found' };
    }
    throw e;
  }

  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true, payload: verified.payload, requestId, request, deliverable: deliverable || null };
}
