/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/expertise-profile', () => ({ get: jest.fn(), list: jest.fn(), users: jest.fn(), update: jest.fn(), create: jest.fn(), byCreationKey: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/contact', () => ({ getByIdWithSelect: jest.fn() }));
jest.mock('../../lib/services/expertise-finder/roster-rehearsal-target.cjs', () => ({ assertTarget: jest.fn() }));
jest.mock('../../lib/services/expertise-finder/roster-lifecycle.cjs', () => ({ ...jest.requireActual('../../lib/services/expertise-finder/roster-lifecycle.cjs'), withRosterWrite: jest.fn() }));
import * as profiles from '../../lib/dataverse/adapters/expertise-profile';
import * as users from '../../lib/dataverse/adapters/system-user';
import { saveRoster, listRoster } from '../../lib/services/expertise-finder/roster-service';
import { processAnnotations } from '../../lib/services/dynamics/annotations';
const contract = require('../../lib/services/expertise-finder/roster-contract.cjs');
const lifecycle = require('../../lib/services/expertise-finder/roster-lifecycle.cjs');
const lease = {beforeMutation:jest.fn(), rejectMutation:jest.fn(), complete:jest.fn()};
const ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
let row;
const oldImpersonation = process.env.DYNAMICS_IMPERSONATION_ENABLED;
beforeEach(() => {
 jest.resetAllMocks(); lease.active=false; lifecycle.withRosterWrite.mockImplementation(work => work(lease));
 lease.beforeMutation.mockResolvedValue('44444444-4444-4444-8444-444444444444'); lease.complete.mockResolvedValue(1);
 process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
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
test.each([undefined,'W/"122"','*','W/"abc"'])('missing/stale ETag %s refuses writes', async etag => {
 await expect(saveRoster({id:ID,etag,name:'Renamed'},ACTOR)).rejects.toMatchObject({status:409});
 expect(profiles.update).not.toHaveBeenCalled(); expect(lease.beforeMutation).not.toHaveBeenCalled();
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

test('inactive creation recovers an uncertain commit by exact creation key and values',async()=>{
 const input={name:'Synthetic inactive',role_type:'Consultant',is_active:false,mutation_id:ID};
 const stored={...contract.encode(contract.normalize({name:input.name,role_type:input.role_type,is_active:false})),wmkf_expertiseprofileid:ID,_etag:'W/"9"'};
 profiles.byCreationKey.mockResolvedValueOnce(null).mockResolvedValueOnce(stored);
 profiles.create.mockRejectedValue(Object.assign(Error('Unconfirmed batch'),{status:200}));
 const result=await saveRoster(input,ACTOR,{create:true});
 expect(result.member).toMatchObject({id:ID,is_active:false});
 expect(profiles.byCreationKey).toHaveBeenNthCalledWith(2,'app_'+ID);
 expect(profiles.create).toHaveBeenCalledTimes(1);
});


test.each([true,false])('blank form text creates and replays canonically (active=%s)',async active=>{
 const input={name:'Synthetic blank form',role_type:'Consultant',is_active:active,mutation_id:ID,...Object.fromEntries(contract.TEXT.map(k=>[k,'']))};
 const original=structuredClone(input);
 const stored={wmkf_expertiseprofileid:ID,wmkf_name:input.name,wmkf_category:contract.CATEGORIES.Consultant,statecode:active?0:1,wmkf_leadpdeligible:false,_etag:'W/"9"',...Object.fromEntries(contract.TEXT.map(k=>[contract.column(k),null]))};
 profiles.byCreationKey.mockResolvedValueOnce(null).mockResolvedValue(stored);
 const first=await saveRoster(input,ACTOR,{create:true});const replay=await saveRoster(input,ACTOR,{create:true});
 expect(first.member.id).toBe(replay.member.id);expect(profiles.create).toHaveBeenCalledTimes(1);
 for(const k of contract.TEXT)expect(profiles.create.mock.calls[0][0][contract.column(k)]).toBeNull();
 expect(input).toEqual(original);
});
test('optional text normalization preserves nonempty whitespace and names',()=>{
 const value=contract.normalize({name:' Name ',role:' ',expertise:' original source '});
 expect(value.name).toBe(' Name ');expect(value.role).toBe(' ');expect(value.expertise).toBe(' original source ');
});


test('records update intent before the remote mutation and binds the trusted stored key', async () => {
 row.wmkf_creationkey='direct_'+ID;
 await saveRoster({id:ID,etag:'W/"123"',name:'Renamed'},ACTOR);
 expect(lease.beforeMutation).toHaveBeenCalledWith({kind:'update',profileGuid:ID,etag:'W/"123"'});
 expect(lease.beforeMutation.mock.invocationCallOrder[0]).toBeLessThan(profiles.update.mock.invocationCallOrder[0]);
 expect(lease.complete).toHaveBeenCalledWith({profileGuid:ID,creationKey:'direct_'+ID,attemptId:'44444444-4444-4444-8444-444444444444'});
 expect(profiles.update.mock.calls[0][1]).not.toHaveProperty('wmkf_creationkey');
});

test('classifies the mutation error, not a subsequent recovery read error', async () => {
 const mutationError=Object.assign(new Error('write uncertain'),{status:503});
 const readError=new Error('recovery read failed');
 profiles.byCreationKey.mockResolvedValueOnce(null).mockRejectedValueOnce(readError);
 profiles.create.mockRejectedValueOnce(mutationError);
 await expect(saveRoster({name:'Synthetic inactive',role_type:'Consultant',is_active:false,mutation_id:ID},ACTOR,{create:true})).rejects.toBe(readError);
 expect(lease.rejectMutation).toHaveBeenCalledTimes(1);
 expect(lease.rejectMutation).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444',mutationError);
 expect(lease.beforeMutation.mock.invocationCallOrder[0]).toBeLessThan(profiles.create.mock.invocationCallOrder[0]);
});

test('retries a confirmed create after binding failure without creating again', async () => {
 const input={name:'Synthetic inactive',role_type:'Consultant',is_active:false,mutation_id:ID};
 const stored={...contract.encode(contract.normalize({name:input.name,role_type:input.role_type,is_active:false})),wmkf_expertiseprofileid:ID,wmkf_creationkey:'app_'+ID,_etag:'W/"9"'};
 profiles.byCreationKey.mockResolvedValueOnce(null).mockResolvedValue(stored);
 lease.complete.mockRejectedValueOnce(new Error('bridge unavailable')).mockResolvedValueOnce(1);
 await expect(saveRoster(input,ACTOR,{create:true})).rejects.toThrow('bridge unavailable');
 const result=await saveRoster(input,ACTOR,{create:true});
 expect(result.member.id).toBe(ID);
 expect(profiles.create).toHaveBeenCalledTimes(1);
 expect(profiles.create.mock.calls[0][0].wmkf_creationkey).toBe('app_'+ID);
 expect(lease.complete).toHaveBeenLastCalledWith({profileGuid:ID,creationKey:'app_'+ID,attemptId:null});
});

test('confirmed update with binding failure returns a saved warning', async () => {
 row.wmkf_creationkey='direct_'+ID;
 lease.complete.mockRejectedValueOnce(new Error('bridge unavailable'));
 const result=await saveRoster({id:ID,etag:'W/"123"',name:'Renamed'},ACTOR);
 expect(result).toMatchObject({success:true,warning:expect.stringContaining('numeric roster reconciliation')});
 expect(profiles.update).toHaveBeenCalledTimes(1);
 expect(lease.rejectMutation).not.toHaveBeenCalled();
});

test('request cannot choose a creation key', async () => {
 await expect(saveRoster({name:'Synthetic',role_type:'Consultant',is_active:false,mutation_id:ID,wmkf_creationkey:'app_'+USER},ACTOR,{create:true})).rejects.toMatchObject({status:400});
 expect(profiles.create).not.toHaveBeenCalled(); expect(lease.beforeMutation).not.toHaveBeenCalled();
});


test.each([undefined,null,'','app_invalid','legacy_'+ID+'_0','direct_'+USER.toUpperCase().replace('2','A')])('active lifecycle refuses invalid stored creation key %s before mutation',async key=>{
 lease.active=true;row.wmkf_creationkey=key;
 await expect(saveRoster({id:ID,etag:'W/"123"',name:'Renamed'},ACTOR)).rejects.toMatchObject({status:503,code:'roster_reconciliation_required'});
 expect(lease.beforeMutation).not.toHaveBeenCalled();expect(profiles.update).not.toHaveBeenCalled();expect(lease.complete).not.toHaveBeenCalled();
});
test.each(['app_'+ID,'direct_'+ID,'legacy_'+ID+'_42'])('active lifecycle accepts stored creation key %s',async key=>{
 lease.active=true;row.wmkf_creationkey=key;
 await saveRoster({id:ID,etag:'W/"123"',name:'Renamed'},ACTOR);
 expect(profiles.update).toHaveBeenCalledTimes(1);
 expect(lease.complete).toHaveBeenCalledWith(expect.objectContaining({creationKey:key}));
});
test('absent lifecycle permits updating a profile without a stored creation key',async()=>{
 lease.active=false;delete row.wmkf_creationkey;
 await expect(saveRoster({id:ID,etag:'W/"123"',name:'Renamed'},ACTOR)).resolves.toMatchObject({success:true});
 expect(profiles.update).toHaveBeenCalledTimes(1);
});
