/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/expertise-profile', () => ({ get: jest.fn(), list: jest.fn(), users: jest.fn(), update: jest.fn(), create: jest.fn(), byCreationKey: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/contact', () => ({ getByIdWithSelect: jest.fn() }));
jest.mock('../../lib/services/expertise-finder/roster-rehearsal-target.cjs', () => ({ assertTarget: jest.fn() }));
import * as profiles from '../../lib/dataverse/adapters/expertise-profile';
import * as users from '../../lib/dataverse/adapters/system-user';
import { saveRoster, listRoster } from '../../lib/services/expertise-finder/roster-service';
import { processAnnotations } from '../../lib/services/dynamics/annotations';
const contract = require('../../lib/services/expertise-finder/roster-contract.cjs');
const ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
let row;
const oldImpersonation = process.env.DYNAMICS_IMPERSONATION_ENABLED;
beforeEach(() => {
 jest.resetAllMocks(); process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
 row = processAnnotations({wmkf_expertiseprofileid:ID,wmkf_name:'Test Staff',wmkf_category:contract.CATEGORIES['Research Program Staff'],statecode:0,wmkf_leadpdeligible:true,_wmkf_staffuser_value:USER,'@odata.etag':'W/"123"'});
 profiles.get.mockImplementation(async () => row); profiles.update.mockResolvedValue();
 users.getById.mockResolvedValue({isdisabled:false});
});
afterAll(() => { if(oldImpersonation === undefined) delete process.env.DYNAMICS_IMPERSONATION_ENABLED; else process.env.DYNAMICS_IMPERSONATION_ENABLED=oldImpersonation; });
test('transport ETag survives list decoding and conditional edit', async () => {
 profiles.list.mockResolvedValue([row]); profiles.users.mockResolvedValue([]);
 const listed = await listRoster(); expect(listed.members[0].etag).toBe('W/"123"');
 await saveRoster({...listed.members[0], name:'Renamed'}, ACTOR);
 expect(profiles.update).toHaveBeenCalledWith(ID,expect.objectContaining({wmkf_name:'Renamed'}),'W/"123"',ACTOR);
});
test.each([undefined,'W/"122"'])('missing/stale ETag %s refuses writes', async etag => {
 await expect(saveRoster({id:ID,etag,name:'Renamed'},ACTOR)).rejects.toMatchObject({status:409});
 expect(profiles.update).not.toHaveBeenCalled();
});
test('deactivation retains disabled historical User and clears eligibility', async () => {
 users.getById.mockResolvedValue({isdisabled:true});
 await saveRoster({id:ID,etag:'W/"123"',is_active:false},ACTOR);
 expect(profiles.update).toHaveBeenCalledWith(ID,expect.objectContaining({statecode:1,wmkf_leadpdeligible:false,'wmkf_StaffUser@odata.bind':`/systemusers(${USER})`}), 'W/"123"',ACTOR);
});
test.each([{lead_pd_eligible:true},{dataverse_user_id:ACTOR,lead_pd_eligible:false}])('disabled User cannot become eligible or newly linked: %j', async fields => {
 users.getById.mockResolvedValue({isdisabled:true});
 await expect(saveRoster({id:ID,etag:'W/"123"',...fields},ACTOR)).rejects.toMatchObject({status:400});
 expect(profiles.update).not.toHaveBeenCalled();
});
test('post-commit hydration failure remains a saved result with warning', async () => {
 profiles.get.mockResolvedValueOnce(row).mockRejectedValueOnce(new Error('read unavailable'));
 const result = await saveRoster({id:ID,etag:'W/"123"',name:'Renamed'},ACTOR);
 expect(result).toMatchObject({success:true,member:{name:'Renamed',etag:null},warning:expect.stringContaining('Saved.')});
 expect(profiles.update).toHaveBeenCalledTimes(1);
});
test('unlinked actor and disabled impersonation cannot write', async () => {
 await expect(saveRoster({id:ID},null)).rejects.toMatchObject({status:403});
 process.env.DYNAMICS_IMPERSONATION_ENABLED='false';
 await expect(saveRoster({id:ID},ACTOR)).rejects.toMatchObject({status:503});
 expect(profiles.get).not.toHaveBeenCalled(); expect(profiles.update).not.toHaveBeenCalled();
});
