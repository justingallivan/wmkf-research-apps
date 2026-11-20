/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/expertise-profile', () => ({ get: jest.fn(), list: jest.fn(), byCreationKey: jest.fn(), create: jest.fn(), update: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/contact', () => ({ getByIdWithSelect: jest.fn() }));
jest.mock('../../lib/services/expertise-finder/roster-binding', () => ({ ensureProfileBinding: jest.fn() }));
import * as profiles from '../../lib/dataverse/adapters/expertise-profile';
import * as users from '../../lib/dataverse/adapters/system-user';
import * as contacts from '../../lib/dataverse/adapters/contact';
import { ensureProfileBinding } from '../../lib/services/expertise-finder/roster-binding';
import { saveRoster } from '../../lib/services/expertise-finder/roster-service';
import contract from '../../lib/services/expertise-finder/roster-contract.cjs';
const id = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const contact = '33333333-3333-4333-8333-333333333333';
const input = { name: 'Person', mutation_id: id };
const record = { ...contract.encode(contract.normalize({ name: 'Person' })), wmkf_expertiseprofileid: id, wmkf_creationkey: 'app_' + id, '@odata.etag': 'W/"1"' };
beforeEach(() => {
  jest.resetAllMocks(); process.env.EXPERTISE_ROSTER_BACKEND = 'dataverse'; process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com'; process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
  profiles.list.mockResolvedValue([]); profiles.get.mockResolvedValue(record); users.getById.mockResolvedValue({ isdisabled: false }); contacts.getByIdWithSelect.mockResolvedValue({ statecode: 0 });
});
afterEach(() => { delete process.env.EXPERTISE_ROSTER_BACKEND; delete process.env.DYNAMICS_IMPERSONATION_ENABLED; });
test('missing actor or disabled impersonation cannot write', async () => {
  await expect(saveRoster(input, null, { create: true })).rejects.toMatchObject({ status: 403 });
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false';
  await expect(saveRoster(input, actor, { create: true })).rejects.toMatchObject({ status: 503 });
  expect(profiles.create).not.toHaveBeenCalled();
});
test('binding failure before create is retryable under same key', async () => {
  profiles.byCreationKey.mockResolvedValueOnce(null).mockResolvedValue(record);
  ensureProfileBinding.mockRejectedValueOnce(Error('DB down')).mockResolvedValueOnce(40);
  await expect(saveRoster(input, actor, { create: true })).rejects.toThrow('DB down');
  expect(await saveRoster(input, actor, { create: true })).toMatchObject({ member: { id } });
  expect(profiles.create).not.toHaveBeenCalled();
});
test('replay payload mismatch rejects rather than changing prior creation', async () => {
  profiles.byCreationKey.mockResolvedValue(record);
  await expect(saveRoster({ ...input, name: 'Different' }, actor, { create: true })).rejects.toMatchObject({ status: 409 });
  expect(profiles.create).not.toHaveBeenCalled(); expect(ensureProfileBinding).toHaveBeenCalledWith('wmkf.crm.dynamics.com', id, 'app_' + id);
});
test('ordinary category edit retains Contact even when it has become inactive', async () => {
  profiles.get.mockResolvedValue({ ...record, wmkf_contactguid: contact });
  await saveRoster({ id, etag: 'W/"1"', role_type: 'Research Program Staff', dataverse_user_id: actor }, actor);
  expect(profiles.update).toHaveBeenCalledWith(id, expect.objectContaining({ wmkf_contactguid: contact, 'wmkf_StaffUser@odata.bind': `/systemusers(${actor})` }), 'W/"1"', actor, { clearStaffUser: false });
  expect(contacts.getByIdWithSelect).not.toHaveBeenCalled();
});
test('inactive profile reserves Contact identity with readable conflict', async () => {
  profiles.list.mockResolvedValue([{ ...record, statecode: 1, wmkf_contactguid: contact }]);
  profiles.byCreationKey.mockResolvedValue(null);
  await expect(saveRoster({ ...input, dataverse_contact_id: contact }, actor, { create: true })).rejects.toMatchObject({ status: 409 });
  expect(profiles.create).not.toHaveBeenCalled();
});
test('unrecognized fields and roles fail closed', async () => {
  await expect(saveRoster({ ...input, actor }, actor, { create: true })).rejects.toMatchObject({ status: 400 });
  await expect(saveRoster({ ...input, role_type: 'Other' }, actor, { create: true })).rejects.toMatchObject({ status: 400 });
  expect(profiles.create).not.toHaveBeenCalled();
});

test('prebinding failure cannot leave a visible unbound Dataverse person', async () => {
  profiles.byCreationKey.mockResolvedValue(null); ensureProfileBinding.mockRejectedValue(Error('DB unavailable'));
  await expect(saveRoster(input, actor, {create:true})).rejects.toThrow('DB unavailable');
  expect(profiles.create).not.toHaveBeenCalled();
});
test('prebinds the exact proposed Dataverse GUID before creation', async () => {
  const order=[]; ensureProfileBinding.mockImplementation(async()=>{order.push('bind');return 40;});
  profiles.byCreationKey.mockResolvedValueOnce(null).mockResolvedValue(record);
  profiles.create.mockImplementation(async()=>{order.push('create');});
  await saveRoster(input, actor, {create:true});
  expect(order).toEqual(['bind','create','bind']);
  expect(profiles.create).toHaveBeenCalledWith(expect.objectContaining({wmkf_expertiseprofileid:id}), actor);
  expect(profiles.create.mock.calls[0][0]).not.toHaveProperty('wmkf_StaffUser@odata.bind');
});
test('clearing an existing User requests atomic reference removal and keeps Contact', async () => {
  profiles.get.mockResolvedValue({ ...record, wmkf_category:100000000, _wmkf_staffuser_value:actor, wmkf_contactguid:contact });
  await saveRoster({id,etag:'W/"1"',dataverse_user_id:null},actor);
  const [profileId,body,etag,who,options]=profiles.update.mock.calls[0];
  expect([profileId,etag,who,options]).toEqual([id,'W/"1"',actor,{clearStaffUser:true}]);
  expect(body).not.toHaveProperty('wmkf_StaffUser@odata.bind'); expect(body.wmkf_contactguid).toBe(contact);
});

test.each([null, {isdisabled:true}])('missing/disabled User gives actionable validation (%s)', async user=>{
  users.getById.mockResolvedValue(user);
  await expect(saveRoster({...input,role_type:'Research Program Staff',dataverse_user_id:actor},actor,{create:true})).rejects.toMatchObject({status:400,message:'Choose an enabled staff account.'});
});
test('missing Contact 404 gives actionable validation', async()=>{
  contacts.getByIdWithSelect.mockRejectedValue(Object.assign(Error('raw provider 404'),{status:404}));
  await expect(saveRoster({...input,dataverse_contact_id:contact},actor,{create:true})).rejects.toMatchObject({status:400,message:'That Contact no longer exists. Choose another Contact.'});
});

test('failed binding confirmation after create retries the existing keyed person', async () => {
  profiles.byCreationKey.mockResolvedValueOnce(null).mockResolvedValue(record);
  ensureProfileBinding.mockResolvedValueOnce(40).mockRejectedValueOnce(Error('confirmation unavailable')).mockResolvedValueOnce(40);
  await expect(saveRoster(input,actor,{create:true})).rejects.toThrow('confirmation unavailable');
  expect(await saveRoster(input,actor,{create:true})).toMatchObject({member:{id}});
  expect(profiles.create).toHaveBeenCalledTimes(1);
});
