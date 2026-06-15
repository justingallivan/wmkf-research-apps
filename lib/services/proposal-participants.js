/**
 * Proposal participants — shared reads for a request's people.
 *
 * Co-PI display list comes from the `wmkf_apprequestperson` junction ONLY
 * (role = Co-PI). Per docs/INTAKE_PORTAL_SCHEMA_CHANGES.md the legacy
 * `wmkf_copi1..5_value` slot fields are obsolete read-only backfill, and the
 * PI-history UNION strategy applies to the PI lookup, not to Co-PIs. The PI
 * itself is the request's `wmkf_projectleader` lookup (resolved by callers).
 *
 * Extracted from pages/api/external/review/[token]/context.js (S258) so the
 * Workbench Proposal tab and the external-reviewer context share one source.
 */

import { DynamicsService } from './dynamics-service';

// wmkf_apprequestperson.wmkf_role option value for Co-PI.
const ROLE_COPI = 100000001;

/**
 * Build the Co-PI display list from the wmkf_apprequestperson junction.
 * Returns an array of display name strings, de-duped by contact, ordered by
 * `wmkf_authorposition` then createdon. Names only — no role/effort/contact id.
 *
 * Caller must already be inside a Dynamics restriction context (this issues a
 * plain read via DynamicsService).
 */
export async function fetchCoPIs(requestId) {
  if (!requestId) return [];
  const { records } = await DynamicsService.queryRecords('wmkf_apprequestpersons', {
    select: '_wmkf_contact_value,wmkf_authorposition',
    expand: 'wmkf_Contact($select=fullname,firstname,lastname)',
    filter: `_wmkf_request_value eq ${requestId} and wmkf_role eq ${ROLE_COPI}`,
    orderby: 'wmkf_authorposition asc,createdon asc',
    top: 50, // defensive cap; expected cardinality is 0-5 per request
  });

  const byContactId = new Map();
  for (const row of records) {
    const cid = row._wmkf_contact_value;
    if (!cid || byContactId.has(cid)) continue;
    const c = row.wmkf_Contact;
    const name = c?.fullname
      || [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim();
    if (!name) continue;
    byContactId.set(cid, name);
  }
  return Array.from(byContactId.values());
}
