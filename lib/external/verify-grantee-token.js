/**
 * Token + request verification for external GRANTEE deliverables endpoints.
 *
 * Parallel grantee variant of `lib/external/verify-suggestion-token.js`. The
 * reviewer verifier loads `wmkf_appreviewersuggestions` and checks a stored
 * token hash + revocation flag; the grantee token is STATELESS (see
 * grantee-token-lifecycle.js), so there is no hash/revocation layer — the only
 * authoritative checks are: valid signature + not expired (verifyToken),
 * `aud === 'grantee'` (rejects reviewer tokens, which carry no `aud`), and the
 * akoya_request row existing.
 *
 * `sub` IS the akoya_request GUID (the deliverable package lives inline on the
 * request). Returns a discriminated union mirroring the reviewer verifier so
 * routes share an identical fail-closed contract.
 */

import { verifyToken } from '../services/external-token';
import { DynamicsService } from '../services/dynamics-service';
import { bypassDynamicsRestrictions } from '../services/dynamics-context';
import { GRANTEE_AUDIENCE } from './grantee-token-lifecycle';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_meetingdate',
  // Source abstract (applicant-authored) + the grantee deliverables fields
  // (deployed S268). wmkf_abstract is the SOURCE; the portal shows/edits the
  // formatted + approved versions.
  'wmkf_abstract',
  'wmkf_abstractformatted',
  'wmkf_abstractapproved',
  'wmkf_granteeimagefileref',
  'wmkf_granteeimagecaption',
  'wmkf_granteedeliverablestatus',
].join(',');

/**
 * Verify a grantee magic-link token and load its akoya_request in one call.
 *
 * @param {string} jwt - the raw token from the URL
 * @returns {Promise<
 *   | { ok: true, payload: object, requestId: string, request: object }
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
  try {
    request = await bypassDynamicsRestrictions('grantee-token-verify', () =>
      DynamicsService.getRecord('akoya_requests', requestId, {
        select: REQUEST_SELECT,
      }),
    );
  } catch (e) {
    if (e.status === 404 || /Get record failed \(404\)/.test(e.message || '')) {
      return { ok: false, reason: 'not_found' };
    }
    throw e;
  }

  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true, payload: verified.payload, requestId, request };
}
