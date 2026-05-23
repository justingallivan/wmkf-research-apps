/**
 * MembershipService — Dataverse `wmkf_portalmemberships` reader for the
 * applicant intake portal.
 *
 * Authoritative entity: `wmkf_portalmembership` (entity set
 * `wmkf_portalmemberships`). Slice-0 deployed S178. See
 * `docs/atlas/dataverse-wmkf-portalmembership.md`.
 *
 * Two consumers:
 *   1. `/apply` landing: list approved memberships for institution-select.
 *   2. `/api/intake/submit`: Submitter-role guard against the chosen
 *      account_id (Codex round-1 §1.2; drain plan v7 §"Build pieces" #5).
 *
 * Liveness contract: a membership is "live" iff
 *   wmkf_approvalstatus == 100000002 (Approved) AND statecode == 0 (Active).
 * Both predicates are required — `statecode` is the hard kill switch.
 */

import { DynamicsService } from './dynamics-service';

// Picklist constants (from the entity's atlas page).
export const APPROVAL_STATUS = Object.freeze({
  REJECTED: 100000000,
  REVOKED: 100000001,
  APPROVED: 100000002,
  REQUESTED: 100000003,
});

export const ROLE = Object.freeze({
  SUBMITTER: 100000000,
  CONTRIBUTOR: 100000001,
});

export const STATECODE_ACTIVE = 0;

const SELECT_FIELDS = [
  'wmkf_portalmembershipid',
  '_wmkf_contact_value',
  '_wmkf_account_value',
  'wmkf_role',
  'wmkf_isprimary',
  'wmkf_approvalstatus',
  'statecode',
].join(',');

/**
 * Return the live (approved + active) memberships for a contact.
 */
export async function getLiveMembershipsForContact(contactId) {
  if (!contactId) throw new Error('getLiveMembershipsForContact: contactId required');

  const filter = [
    `_wmkf_contact_value eq ${contactId}`,
    `wmkf_approvalstatus eq ${APPROVAL_STATUS.APPROVED}`,
    `statecode eq ${STATECODE_ACTIVE}`,
  ].join(' and ');

  const { records } = await DynamicsService.queryRecords('wmkf_portalmemberships', {
    select: SELECT_FIELDS,
    filter,
    top: 100,
  });

  return records.map((r) => ({
    membershipId: r.wmkf_portalmembershipid,
    accountId: r._wmkf_account_value,
    contactId: r._wmkf_contact_value,
    role: r.wmkf_role,
    isPrimary: !!r.wmkf_isprimary,
  }));
}

/**
 * Submitter-role guard. Returns true iff the contact has a live
 * (approved + active) membership on the given account with
 * role == Submitter. Used by /api/intake/submit before allowing
 * the submission_jobs INSERT.
 *
 * Contributors (100000001) can edit drafts but cannot submit
 * (per Codex round-1 §1.2).
 */
export async function hasSubmitterRole(contactId, accountId) {
  if (!contactId || !accountId) return false;
  const live = await getLiveMembershipsForContact(contactId);
  return live.some((m) => m.accountId === accountId && m.role === ROLE.SUBMITTER);
}
