/**
 * Staff + Board/Consultant recipient directory for Site Visit logistics.
 *
 * Staff identity is joined from active Postgres profiles to enabled Dataverse
 * system users. External roster identity stays expertise_roster.id; email is a
 * maintained preferred address, never inferred from a name.
 */

import { sql } from '@vercel/postgres';
import * as systemUserAdapter from '../../dataverse/adapters/system-user.js';
import { ServiceHttpError } from '../service-http-error.js';
import { normalizeSiteVisitEmail } from '../../../shared/config/siteVisit.js';

export { normalizeSiteVisitEmail };

const DEFAULT_DEPENDENCIES = {
  async listProfiles() {
    return (await sql`
      SELECT id, name, display_name, azure_email, dynamics_systemuser_id
      FROM user_profiles
      WHERE is_active = true AND azure_email IS NOT NULL
      ORDER BY COALESCE(display_name, name), id
    `).rows;
  },
  async listRoster() {
    return (await sql`
      SELECT id, name, role_type, role, affiliation, preferred_email
      FROM expertise_roster
      WHERE is_active = true AND role_type IN ('Board', 'Consultant')
      ORDER BY role_type, name, id
    `).rows;
  },
  async listSystemUsers() {
    return systemUserAdapter.queryUsers({
      select: 'systemuserid,fullname,internalemailaddress,isdisabled',
      filter: 'isdisabled eq false',
      top: 500,
    });
  },
};

export async function getActiveStaffRecipientDirectory(dependencies = DEFAULT_DEPENDENCIES) {
  const [profiles, userResult] = await Promise.all([
    dependencies.listProfiles(),
    dependencies.listSystemUsers(),
  ]);
  const systemUsers = (userResult?.records || []).filter((row) => row.isdisabled === false);
  const byId = new Map(systemUsers.map((row) => [
    String(row.systemuserid || '').toLowerCase(),
    row,
  ]));
  const byEmail = new Map();
  for (const row of systemUsers) {
    const email = normalizeSiteVisitEmail(row.internalemailaddress);
    if (!email) continue;
    const current = byEmail.get(email) || [];
    current.push(row);
    byEmail.set(email, current);
  }

  const staff = [];
  for (const profile of profiles || []) {
    const profileEmail = normalizeSiteVisitEmail(profile.azure_email);
    if (!profileEmail) continue;
    const mapped = profile.dynamics_systemuser_id
      ? byId.get(String(profile.dynamics_systemuser_id).toLowerCase())
      : null;
    const candidates = mapped ? [mapped] : (byEmail.get(profileEmail) || []);
    if (candidates.length !== 1) continue;
    const user = candidates[0];
    const userEmail = normalizeSiteVisitEmail(user.internalemailaddress);
    if (!userEmail || userEmail !== profileEmail) continue;
    staff.push({
      kind: 'staff',
      profileId: Number(profile.id),
      name: String(user.fullname || profile.display_name || profile.name || profileEmail),
      email: userEmail,
      systemUserId: user.systemuserid,
    });
  }

  return staff.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSiteVisitRecipientDirectory(dependencies = DEFAULT_DEPENDENCIES) {
  const [staff, roster] = await Promise.all([
    getActiveStaffRecipientDirectory(dependencies),
    dependencies.listRoster(),
  ]);
  const external = (roster || []).map((row) => ({
    kind: 'roster',
    rosterId: Number(row.id),
    name: String(row.name || ''),
    email: normalizeSiteVisitEmail(row.preferred_email),
    roleType: row.role_type,
    role: row.role || null,
    affiliation: row.affiliation || null,
  }));

  return {
    staff,
    external,
  };
}

function manualRecipient(ref) {
  const email = normalizeSiteVisitEmail(ref?.email);
  const name = String(ref?.name || '').trim().slice(0, 255);
  if (!email) {
    throw new ServiceHttpError('Every manual attendee must have a valid email address.', {
      httpStatus: 400,
      code: 'site_visit_attendee_email_invalid',
    });
  }
  return { kind: 'manual', name: name || email, email, systemUserId: null };
}

export async function resolveSiteVisitRecipientRefs(
  refs,
  { allowManual = true, staffOnly = false, directory: suppliedDirectory = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!Array.isArray(refs)) {
    throw new ServiceHttpError('Attendees must be an array.', {
      httpStatus: 400,
      code: 'site_visit_attendees_invalid',
    });
  }
  const directory = suppliedDirectory || await getSiteVisitRecipientDirectory(dependencies);
  const staff = new Map(directory.staff.map((row) => [String(row.profileId), row]));
  const roster = new Map(directory.external.map((row) => [String(row.rosterId), row]));
  const resolved = [];
  for (const ref of refs) {
    let row;
    if (ref?.kind === 'staff') row = staff.get(String(ref.profileId));
    else if (!staffOnly && ref?.kind === 'roster') row = roster.get(String(ref.rosterId));
    else if (!staffOnly && allowManual && ref?.kind === 'manual') row = manualRecipient(ref);
    if (!row || !row.email || (staffOnly && row.kind !== 'staff')) {
      throw new ServiceHttpError('An attendee could not be resolved from the current directory.', {
        httpStatus: 409,
        code: 'site_visit_attendee_unresolved',
      });
    }
    resolved.push(row);
  }
  return resolved;
}

export const SITE_VISIT_RECIPIENT_DIRECTORY_DEPENDENCIES = DEFAULT_DEPENDENCIES;
