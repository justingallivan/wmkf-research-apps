/**
 * Adapter: wmkf_apprequestpersons (grant-request person-role junction).
 *
 * Byte-mirrors lib/services/proposal-participants.js's fetchCoPIs query — the
 * only Wave-4 caller against this entity set (Co-PI display list, built from
 * the wmkf_apprequestperson junction, role = Co-PI). Restriction-context
 * posture is CALLER-OWNED, matching the other Wave-3/4 adapters: this module
 * issues the raw transport call and leaves the trust boundary to the caller.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_apprequestpersons');

// wmkf_apprequestperson.wmkf_role option value for Co-PI. Kept local to this
// adapter — the same constant proposal-participants.js used inline.
const ROLE_COPI = 100000001;

/**
 * Byte-mirror of proposal-participants.fetchCoPIs's inline queryRecords call:
 * select/expand/filter/orderby/top unchanged. Returns the raw queryRecords
 * result (`{ records, ... }`) so the caller keeps its own dedupe/name-join
 * logic.
 */
export async function queryCoPIs(requestId) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: '_wmkf_contact_value,wmkf_authorposition',
    expand: 'wmkf_Contact($select=fullname,firstname,lastname)',
    filter: `_wmkf_request_value eq ${requestId} and wmkf_role eq ${ROLE_COPI}`,
    orderby: 'wmkf_authorposition asc,createdon asc',
    top: 50, // defensive cap; expected cardinality is 0-5 per request
  });
}

/**
 * Business-filter query passthrough — mirrors DynamicsService.queryRecords
 * arg-for-arg, exactly like grant-request.js's queryRequests. Byte-mirror of
 * reviewer-finder/generate-emails.js's inline Co-PI-names lookup (same role
 * filter as queryCoPIs, but no `$expand` and a caller-owned select).
 */
export async function queryPersons(options) {
  return DynamicsService.queryRecords(ENTITY_SET, options);
}

/**
 * Business-filter paginated-scan passthrough — mirrors
 * DynamicsService.queryAllRecords arg-for-arg, exactly like grant-request.js's
 * queryAllRequests. Byte-mirror of reviewer-finder/contact-history.js's
 * inline PI/Co-PI junction scan.
 */
export async function queryAllPersons(options) {
  return DynamicsService.queryAllRecords(ENTITY_SET, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
