/** @jest-environment node */
import { getAssignedCoordinator, assertCoordinatorSender } from '../../lib/services/meeting-coordination/coordinator-access';
const ID = '22222222-2222-4222-8222-222222222222';
const staff = { systemUserId: ID, profileId: 7, name: ' Casey ', email: 'PC@wmkeck.org' };
const dependencies = () => ({ getRole: jest.fn(async () => ({ value: { systemUserId: ID }, revision: 'r1' })), eligibleStaff: jest.fn(async () => staff) });
test('shared assignment resolves an active staff profile without requiring the unrelated reviewers app', async () => {
  const d = dependencies();
  const coordinator = await getAssignedCoordinator(d);
  expect(coordinator).toEqual({ ...staff, name: 'Casey', email: 'pc@wmkeck.org', revision: 'r1' });
  expect(d.eligibleStaff).toHaveBeenCalledWith(ID, { app: false });
  expect(assertCoordinatorSender(coordinator, { actorId: ID, profileId: 7, fromEmail: 'PC@wmkeck.org' })).toBe(coordinator);
});
test.each([null, { value: null, revision: 'r1' }, { value: { systemUserId: ID }, revision: null }])('missing or unversioned role refuses: %j', async role => {
  const d = dependencies(); d.getRole.mockResolvedValue(role);
  await expect(getAssignedCoordinator(d)).rejects.toMatchObject({ code: 'meeting_coordinator_unavailable' });
  expect(d.eligibleStaff).not.toHaveBeenCalled();
});
test('inactive staff and lookup failures cannot fall back to the clicking actor', async () => {
  const d = dependencies(); d.eligibleStaff.mockRejectedValue(new Error('inactive'));
  await expect(getAssignedCoordinator(d)).rejects.toThrow('inactive');
});
test.each([{ actorId: '33333333-3333-4333-8333-333333333333' }, { profileId: 8 }, { fromEmail: 'helper@wmkeck.org' }])('actor mismatch fails closed: %j', async change => {
  const coordinator = await getAssignedCoordinator(dependencies());
  expect(() => assertCoordinatorSender(coordinator, { actorId: ID, profileId: 7, fromEmail: coordinator.email, ...change })).toThrow('personally send');
});
test('a changed role revision refuses even when the same coordinator is assigned again', async () => {
  const coordinator = await getAssignedCoordinator(dependencies());
  expect(() => assertCoordinatorSender(coordinator, { actorId: ID, profileId: 7, fromEmail: coordinator.email }, { ...coordinator, revision: 'old' })).toThrow('assignment changed');
});
