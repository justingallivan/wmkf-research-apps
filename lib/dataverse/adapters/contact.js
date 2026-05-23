/**
 * Adapter: contacts (CRM core).
 *
 * Promotion target for reviewers we've actually engaged with. When staff first
 * sends materials (or any direct outreach) to a `wmkf_potentialreviewers` row,
 * we find-or-create a CRM `contact` and link it via `wmkf_contact`. That puts
 * the reviewer into standard CRM workflows (relationship history, future
 * communications) without polluting the contacts table with everyone we ever
 * considered.
 *
 * NOTE on `wmkf_portaloid` (deployed S179, drain plan v7 P2):
 * The `contact.wmkf_portaloid` column + alternate key are reserved for the
 * applicant-portal auth bridge (lib/services/contact-bridge-service.js,
 * forthcoming). Reviewer promotion paths through this adapter MUST NOT set
 * `wmkf_portaloid`: doing so would either claim the OID slot for a contact
 * that isn't actually a portal applicant or trip the alt-key uniqueness once
 * its index reaches Active. If a reviewer is ALSO a portal applicant, the
 * auth bridge will link them on their first portal login; this adapter stays
 * out of that lane.
 */

import { DynamicsService } from '../../services/dynamics-service.js';

const ENTITY_SET = 'contacts';

const FIELD_SELECT = [
  'contactid',
  'firstname',
  'lastname',
  'fullname',
  'emailaddress1',
];

function escapeOdataString(s) {
  return String(s).replace(/'/g, "''");
}

export async function findByEmail(email) {
  if (!email) return null;
  const { records } = await DynamicsService.queryRecords(ENTITY_SET, {
    select: FIELD_SELECT.join(','),
    filter: `emailaddress1 eq '${escapeOdataString(email)}'`,
    top: 1,
  });
  return records[0] || null;
}

/**
 * Find by email, or create a minimal contact with first/last/email. Returns
 * { id, created }.
 */
export async function findOrCreateByEmail({ firstName, lastName, email }, { actingUserSystemId } = {}) {
  if (!email) throw new Error('contact.findOrCreateByEmail: email required');
  const existing = await findByEmail(email);
  if (existing) return { id: existing.contactid, created: false };

  const payload = { emailaddress1: email };
  if (firstName) payload.firstname = firstName;
  if (lastName) payload.lastname = lastName;
  const created = await DynamicsService.createRecord(ENTITY_SET, payload, { actingUserSystemId });
  return { id: created.contactid, created: true };
}

export const ENTITY_SET_NAME = ENTITY_SET;
