/** Shared Admin assignment, authenticated identity and active-profile checks for coordinator-only actions. */
import { getRole, eligibleStaff } from '../board-writeups/config.js';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';

export async function resolveCoordinatorAccess({ profileId, actingUserSystemId }, dependencies = { getRole, eligibleStaff }) {
  if (!Number.isSafeInteger(profileId) || profileId < 1 || !isGuid(actingUserSystemId)) return false;
  const role = await dependencies.getRole('programCoordinator');
  if (!role?.value?.systemUserId || role.value.systemUserId.toLowerCase() !== actingUserSystemId.toLowerCase()) return false;
  const staff = await dependencies.eligibleStaff(actingUserSystemId, { app: false });
  return staff.profileId === profileId;
}

export async function requireCoordinatorAccess(actor, dependencies) {
  if (!await resolveCoordinatorAccess(actor, dependencies)) {
    throw new ServiceHttpError('The assigned Program Coordinator must perform this action.', {
      httpStatus: 403, code: 'meeting_coordinator_required',
    });
  }
}

/** Shared Admin staffing is independent of any request's legacy coordinator field. */
export async function getAssignedCoordinator(dependencies = { getRole, eligibleStaff }) {
  const role = await dependencies.getRole('programCoordinator');
  if (!isGuid(role?.value?.systemUserId || '') || !role.revision) {
    throw new ServiceHttpError('Assign an active Program Coordinator in Shared Admin before sending materials emails.', {
      httpStatus: 503, code: 'meeting_coordinator_unavailable',
    });
  }
  const staff = await dependencies.eligibleStaff(role.value.systemUserId, { app: false });
  if (!staff?.email || !Number.isSafeInteger(staff.profileId)) {
    throw new ServiceHttpError('The assigned Program Coordinator needs an active staff profile and mailbox.', {
      httpStatus: 503, code: 'meeting_coordinator_unavailable',
    });
  }
  return { systemUserId: staff.systemUserId.toLowerCase(), profileId: staff.profileId,
    name: String(staff.name || '').trim(), email: staff.email.trim().toLowerCase(), revision: role.revision };
}

/** Compare every assignment/mailbox field frozen by the server-side preview. */
export function assertCoordinatorSender(coordinator, { actorId, profileId, fromEmail }, expected) {
  if (!coordinator || coordinator.systemUserId !== String(actorId || '').toLowerCase()
    || coordinator.profileId !== profileId || coordinator.email !== String(fromEmail || '').trim().toLowerCase()) {
    throw new ServiceHttpError('The assigned Program Coordinator must personally send this email.', {
      httpStatus: 403, code: 'meeting_coordinator_required',
    });
  }
  if (expected && ['systemUserId', 'profileId', 'name', 'email', 'revision'].some(key => expected[key] !== coordinator[key])) {
    throw new ServiceHttpError('The Program Coordinator assignment changed. Refresh the email preview.', {
      httpStatus: 409, code: 'site_visit_materials_preview_stale',
    });
  }
  return coordinator;
}
