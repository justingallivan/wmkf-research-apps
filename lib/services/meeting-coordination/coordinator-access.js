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
