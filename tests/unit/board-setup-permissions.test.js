/** @jest-environment node */
import { saveRole, saveCycle, resumeConfig, loadStaffing, staffingCapabilities, staffDirectory, boardActor } from '../../lib/services/board-writeups/config';
import { emptyState } from '../../lib/services/board-writeups/store';
import { PROGRAM_ID } from '../../lib/services/board-writeups/model';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const actor = { systemUserId: ID, profileId: 'staff' };
function setup({ admin = false, manager = ID, active = true, app = true } = {}) {
  let cycle = { version: 1, cycle: 'D26', programId: PROGRAM_ID, active: false, rosterConfirmed: false, requestIds: [], materialsDue: null, boardEnds: null, adminId: null };
  const state = emptyState(); let rev = 'old';
  const d = {
    getUser: async () => ({ isdisabled: false, internalemailaddress: 'staff@wmkeck.org' }),
    resolveSystemUserToProfile: async () => 'staff', profile: async () => ({ is_active: active, superuser: admin }),
    listAppKeysForUser: async () => app ? ['reviewers'] : [],
    getSettingStrict: async key => ({ found: true, revision: key.includes('.cycle.') ? rev : 'role', value: JSON.stringify(key.includes('.cycle.') ? cycle : { version: 1, systemUserId: key === 'board_writeups.grants_manager' ? manager : OTHER }) }),
    setSettingIfUnchanged: jest.fn(async (key, value, revision) => { if (key.includes('.cycle.')) { expect(revision).toBe(rev); cycle = JSON.parse(value); rev = 'new'; } }),
    mutateCycle: async (_cycle, fn) => fn(state), readCycle: async () => ({ state }),
  };
  return { d, cycle, state };
}
test.each([['system admin', { admin: true, manager: OTHER }], ['assigned Grants Manager', {}]])('%s can save roles, cycle and resume a pending save', async (_name, options) => {
  const { d, cycle, state } = setup(options);
  await saveRole(actor, 'president', { version: 1, systemUserId: OTHER }, 'role', d);
  await saveCycle(actor, { ...cycle, boardEnds: '2026-12-10' }, 'old', '', d);
  expect(d.setSettingIfUnchanged).toHaveBeenCalledTimes(2);
  expect(state.configHistory).toHaveLength(1);
  state.configIntent = { id: 'pending', value: { ...cycle, boardEnds: '2026-12-11' }, expectedRevision: 'new', actorId: ID };
  await resumeConfig('D26', actor, d);
  expect(state.configIntent).toBeNull();
  expect(d.setSettingIfUnchanged).toHaveBeenCalledTimes(3);
});
test.each([
  ['unassigned staff', { manager: OTHER }], ['inactive Manager', { active: false }], ['Manager without app access', { app: false }],
])('%s cannot mutate any setup operation', async (_name, options) => {
  const { d, cycle } = setup(options);
  for (const operation of [() => saveRole(actor, 'cso', { version: 1, systemUserId: ID }, 'role', d), () => saveCycle(actor, cycle, 'old', '', d), () => resumeConfig('D26', actor, d)]) await expect(operation()).rejects.toBeTruthy();
  expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
});
test('forged profile binding and stale revisions cannot save cycle setup', async () => {
  const { d, cycle } = setup();
  await expect(saveRole({ ...actor, profileId: 'someone-else' }, 'cso', { version: 1, systemUserId: ID }, 'role', d)).rejects.toMatchObject({ code: 'board_actor_mismatch' });
  await expect(saveCycle(actor, cycle, 'stale', '', d)).rejects.toMatchObject({ code: 'board_settings_changed' });
  expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
});

test.each([['admin', { admin: true }], ['Grants Manager', {}]])('%s can load shared staffing without loading a cycle', async (_label, options) => {
  const { d } = setup(options);
  d.staffDirectory = jest.fn(async () => [{ systemUserId: ID, name: 'Staff' }]);
  d.readCycle = jest.fn(() => { throw new Error('Must not read cycle'); });
  const value = await loadStaffing(actor, d);
  expect(value.canManageSharedRoles).toBe(true);
  expect(Object.keys(value.roles)).toEqual(['president', 'cso', 'grantsManager', 'programCoordinator']);
  expect(value.staff).toHaveLength(1);
  expect(d.readCycle).not.toHaveBeenCalled();
});
test.each([{ manager: OTHER }, { active: false }, { app: false }])('unauthorized staffing reads are rejected: %j', async options => {
  const { d } = setup(options);
  d.staffDirectory = jest.fn();
  await expect(loadStaffing(actor, d)).rejects.toBeTruthy();
  await expect(staffingCapabilities(actor, d)).rejects.toBeTruthy();
  expect(d.staffDirectory).not.toHaveBeenCalled();
});

function presidentWithoutWorkbench() {
  const f = setup({ admin: true });
  f.d.resolveSystemUserToProfile = async id => id === ID ? 'staff' : 'president';
  f.d.profile = async id => ({ is_active: true, superuser: id === 'staff' });
  f.d.listAppKeysForUser = jest.fn(async () => []);
  return f;
}
test('President and Program Coordinator can be saved without Workbench; CSO and Grants Manager cannot', async () => {
  const { d } = presidentWithoutWorkbench();
  await saveRole(actor, 'president', { version: 1, systemUserId: OTHER }, 'role', d);
  await saveRole(actor, 'programCoordinator', { version: 1, systemUserId: OTHER }, 'role', d);
  expect(d.setSettingIfUnchanged).toHaveBeenCalledTimes(2);
  expect(d.setSettingIfUnchanged).toHaveBeenLastCalledWith('board_writeups.program_coordinator', JSON.stringify({ version: 1, systemUserId: OTHER }), 'role', 'staff');
  for (const role of ['cso', 'grantsManager']) await expect(saveRole(actor, role, { version: 1, systemUserId: OTHER }, 'role', d)).rejects.toMatchObject({ code: 'board_staff_app_access' });
  expect(d.setSettingIfUnchanged).toHaveBeenCalledTimes(2);
  await expect(boardActor({ systemUserId: OTHER, profileId: 'president' }, d)).rejects.toMatchObject({ code: 'board_staff_app_access' });
});
test.each(['disabled', 'inactive', 'unlinked', 'external'])('President still rejects %s staff', async problem => {
  const { d } = presidentWithoutWorkbench();
  d.getUser = async id => ({ isdisabled: id === OTHER && problem === 'disabled', internalemailaddress: id === OTHER && problem === 'external' ? 'staff@example.org' : 'staff@wmkeck.org' });
  if (problem === 'inactive') d.profile = async id => ({ is_active: id !== 'president', superuser: id === 'staff' });
  if (problem === 'unlinked') d.resolveSystemUserToProfile = async id => id === ID ? 'staff' : null;
  await expect(saveRole(actor, 'president', { version: 1, systemUserId: OTHER }, 'role', d)).rejects.toMatchObject({ code: 'board_staff_unavailable' });
  expect(d.setSettingIfUnchanged).not.toHaveBeenCalled();
});
test.each(['president', 'cso', 'grantsManager'])('activation validates Workbench according to the %s assignment', async role => {
  const { d, cycle } = presidentWithoutWorkbench();
  cycle.cycle = 'J27';
  const getSetting = d.getSettingStrict;
  d.getSettingStrict = async key => key.includes('.cycle.') ? getSetting(key) : ({ found: true, revision: 'role', value: JSON.stringify({ version: 1, systemUserId: key === { president: 'board_writeups.president', cso: 'board_writeups.cso', grantsManager: 'board_writeups.grants_manager' }[role] ? OTHER : ID }) });
  const save = saveCycle(actor, { ...cycle, active: true, rosterConfirmed: true, requestIds: [OTHER], materialsDue: '2027-06-01', boardEnds: '2027-06-10', adminId: ID }, 'old', '', d);
  if (role === 'president') await expect(save).resolves.toMatchObject({ value: { active: true } });
  else { await expect(save).rejects.toMatchObject({ code: 'board_staff_app_access' }); expect(d.setSettingIfUnchanged).not.toHaveBeenCalled(); }
});
test('first Program Coordinator assignment saves against an absent setting', async () => {
  const { d } = presidentWithoutWorkbench();
  const getSetting = d.getSettingStrict;
  d.getSettingStrict = async key => key === 'board_writeups.program_coordinator' ? { found: false } : getSetting(key);
  await expect(saveRole(actor, 'programCoordinator', { version: 1, systemUserId: OTHER }, null, d)).resolves.toEqual({ value: null, revision: null });
  expect(d.setSettingIfUnchanged).toHaveBeenCalledWith('board_writeups.program_coordinator', JSON.stringify({ version: 1, systemUserId: OTHER }), null, 'staff');
});
test('an unassigned Program Coordinator does not block activation', async () => {
  const { d, cycle } = presidentWithoutWorkbench();
  cycle.cycle = 'J27';
  d.listAppKeysForUser = jest.fn(async () => ['reviewers']);
  const getSetting = d.getSettingStrict;
  d.getSettingStrict = async key => key === 'board_writeups.program_coordinator' ? { found: false } : getSetting(key);
  await expect(saveCycle(actor, { ...cycle, active: true, rosterConfirmed: true, requestIds: [OTHER], materialsDue: '2027-06-01', boardEnds: '2027-06-10', adminId: ID }, 'old', '', d)).resolves.toMatchObject({ value: { active: true } });
});
test('directory includes President-only staff and marks operational eligibility', async () => {
  const { d } = presidentWithoutWorkbench();
  d.listActiveProfiles = async () => [{ id: 'staff' }, { id: 'president' }, { id: 'missing' }];
  d.resolveProfileToSystemUser = async id => id === 'missing' ? null : { systemuserid: id === 'staff' ? ID : OTHER };
  d.getUser = async id => ({ isdisabled: false, internalemailaddress: 'staff@wmkeck.org', fullname: id === ID ? 'Admin' : 'President Only' });
  expect(await staffDirectory(d)).toEqual([
    expect.objectContaining({ systemUserId: ID, canUseWorkbench: true }),
    expect.objectContaining({ systemUserId: OTHER, canUseWorkbench: false }),
  ]);
});
