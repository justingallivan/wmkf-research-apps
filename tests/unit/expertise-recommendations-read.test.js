/** @jest-environment node */
jest.mock('../../lib/services/dynamics-service.js',()=>({DynamicsService:{queryAllRecords:jest.fn(),getRecord:jest.fn()}}));
import {DynamicsService} from '../../lib/services/dynamics-service.js';
import {processAnnotations} from '../../lib/services/dynamics/annotations.js';
import {withDalContext} from '../../lib/dataverse/core/context.js';
import {readRecommendationsRosterProjection} from '../../lib/dataverse/adapters/expertise-recommendations-read.js';
const roster=require('../../lib/services/expertise-finder/roster-contract.cjs');
const origin='https://orgd9e66399.crm.dynamics.com',id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const original=process.env;
function raw(extra={}){return {wmkf_expertiseprofileid:id,_etag:'W/"123"',wmkf_name:'Synthetic staff',wmkf_category:roster.CATEGORIES['Research Program Staff'],statecode:0,wmkf_leadpdeligible:true,wmkf_contactguid:null,_wmkf_staffuser_value:user,...Object.fromEntries(roster.TEXT.map(k=>[roster.column(k),null])),...extra};}
const call=()=>withDalContext('test-recommendations',()=>readRecommendationsRosterProjection());
beforeEach(()=>{jest.clearAllMocks();process.env={...original,DYNAMICS_URL:origin,DYNAMICS_SANDBOX_URL:origin,DATAVERSE_DAL_ENFORCEMENT:'on',DATAVERSE_TARGET_INTERLOCK:'on'};delete process.env.VERCEL_ENV;DynamicsService.queryAllRecords.mockResolvedValue({records:[raw()],totalCount:1,capped:false});DynamicsService.getRecord.mockResolvedValue({systemuserid:user,isdisabled:false});});
afterAll(()=>{process.env=original;});
test('reads all profiles and exact candidate state with strict pinned transport',async()=>{
 const result=await call();expect(result).toMatchObject({targetHost:'orgd9e66399.crm.dynamics.com',projection:{complete:true,profiles:[{profile_guid:id,etag:'W/"123"',dataverse_user_id:user}],users:[{userGuid:user,disabled:false}]}});
 expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('wmkf_expertiseprofiles',expect.objectContaining({select:['wmkf_expertiseprofileid','wmkf_name','wmkf_category','statecode','wmkf_leadpdeligible','wmkf_contactguid','_wmkf_staffuser_value',...roster.TEXT.map(roster.column)].join(','),filter:'wmkf_expertiseprofileid ne null',orderby:'wmkf_expertiseprofileid asc',strictPagination:true,primaryKey:'wmkf_expertiseprofileid',expectedOrigin:origin}));
 expect(DynamicsService.getRecord).toHaveBeenCalledWith('systemusers',user,{select:'systemuserid,isdisabled',strictRead:true,expectedOrigin:origin});
});
test('disabled candidates are preserved; invalid known rows are not candidate reads',async()=>{
 DynamicsService.queryAllRecords.mockResolvedValue({records:[raw(),raw({wmkf_expertiseprofileid:'33333333-3333-4333-8333-333333333333',wmkf_category:-1})],totalCount:2,capped:false});DynamicsService.getRecord.mockResolvedValue({systemuserid:user,isdisabled:true});
 const {projection}=await call();expect(projection.users).toEqual([{userGuid:user,disabled:true}]);expect(projection.profiles).toHaveLength(2);expect(DynamicsService.getRecord).toHaveBeenCalledTimes(1);
});
test('requires caller context and forbids selectors before I/O',async()=>{
 await expect(readRecommendationsRosterProjection()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Trusted Dataverse context is required.'});await expect(withDalContext('test',()=>readRecommendationsRosterProjection({id}))).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Roster read takes no selectors.'});expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
});
test.each([['target',e=>{e.DYNAMICS_URL='https://wmkf.crm.dynamics.com';}],['sandbox alias',e=>{e.DYNAMICS_SANDBOX_URL='https://wmkf.crm.dynamics.com';}],['DAL',e=>{e.DATAVERSE_DAL_ENFORCEMENT='off';}],['interlock',e=>{e.DATAVERSE_TARGET_INTERLOCK='off';}],['production',e=>{e.VERCEL_ENV='production';}]])('%s misconfiguration refuses before transport',async(_name,mutate)=>{mutate(process.env);await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Sandbox roster target is unavailable or changed.'});expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();});
test.each([[{records:[raw()],totalCount:2,capped:false},'Roster read is incomplete.'],[{records:[raw()],totalCount:1,capped:true},'Roster read is incomplete.'],[{records:[raw()],totalCount:1},'Roster read is incomplete.'],[{records:[raw()],totalCount:1,capped:false,hasMore:true},'Roster read is incomplete.'],[{records:[raw(),raw()],totalCount:2,capped:false},'Duplicate roster identity.']])('incomplete or duplicate census refuses',async(result,message)=>{DynamicsService.queryAllRecords.mockResolvedValue(result);await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message});expect(DynamicsService.getRecord).not.toHaveBeenCalled();});
test.each(['wmkf_name','wmkf_category','statecode','wmkf_leadpdeligible','wmkf_contactguid','_wmkf_staffuser_value','wmkf_role','_etag'])('missing %s refuses before user reads',async field=>{const row=raw();delete row[field];DynamicsService.queryAllRecords.mockResolvedValue({records:[row],totalCount:1,capped:false});await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Roster row is incomplete or malformed.'});expect(DynamicsService.getRecord).not.toHaveBeenCalled();});
test.each([{statecode:2},{wmkf_leadpdeligible:null},{_etag:['W/"123"']}])('malformed raw state refuses rather than coercing',async fields=>{DynamicsService.queryAllRecords.mockResolvedValue({records:[raw(fields)],totalCount:1,capped:false});await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Roster row is incomplete or malformed.'});expect(DynamicsService.getRecord).not.toHaveBeenCalled();});
test.each([{systemuserid:id,isdisabled:false},{systemuserid:user,isdisabled:null},{systemuserid:user}])('mismatched or nonboolean User refuses',async value=>{DynamicsService.getRecord.mockResolvedValue(value);await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Candidate User read is incomplete.'});});
test('environment change during an awaited read fails closed',async()=>{DynamicsService.queryAllRecords.mockImplementation(async()=>{process.env.DYNAMICS_URL='https://wmkf.crm.dynamics.com';return {records:[raw()],totalCount:1,capped:false};});await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Sandbox roster target is unavailable or changed.'});expect(DynamicsService.getRecord).not.toHaveBeenCalled();});
test('environment change while reading a candidate User refuses after the await',async()=>{
 DynamicsService.getRecord.mockImplementation(async()=>{process.env.DATAVERSE_TARGET_INTERLOCK='off';return {systemuserid:user,isdisabled:false};});
 await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Sandbox roster target is unavailable or changed.'});
});
test('valid inactive and consultation-only rows do not trigger User reads',async()=>{
 const inactive=raw({wmkf_expertiseprofileid:'33333333-3333-4333-8333-333333333333',statecode:1,wmkf_leadpdeligible:false});
 const consult=raw({wmkf_expertiseprofileid:'44444444-4444-4444-8444-444444444444',wmkf_leadpdeligible:false});
 DynamicsService.queryAllRecords.mockResolvedValue({records:[inactive,consult],totalCount:2,capped:false});
 const {projection}=await call();expect(projection.profiles).toHaveLength(2);expect(projection.users).toEqual([]);expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('raw OData ETag is transformed by actual annotation processing',async()=>{
 const record=raw();delete record._etag;record['@odata.etag']='W/"321"';
 DynamicsService.queryAllRecords.mockResolvedValue({records:[processAnnotations(record)],totalCount:1,capped:false});
 expect((await call()).projection.profiles[0].etag).toBe('W/"321"');
});
test('duplicate eligible User links refuse before any candidate read',async()=>{
 DynamicsService.queryAllRecords.mockResolvedValue({records:[raw(),raw({wmkf_expertiseprofileid:'33333333-3333-4333-8333-333333333333'})],totalCount:2,capped:false});
 await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Duplicate candidate User.'});expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});
test('uppercase profile GUID refuses before candidate reads',async()=>{
 DynamicsService.queryAllRecords.mockResolvedValue({records:[raw({wmkf_expertiseprofileid:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'})],totalCount:1,capped:false});
 await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Roster row is incomplete or malformed.'});expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});
test.each([Object.assign(Error('User 404'),{status:404}),Object.assign(Error('Redirect refused'),{code:'redirect'}),Error('No response')])('candidate User transport errors propagate',async error=>{
 DynamicsService.getRecord.mockRejectedValue(error);await expect(call()).rejects.toBe(error);
});
test('multiple candidate Users are read in sorted order',async()=>{
 const other='33333333-3333-4333-8333-333333333333',otherProfile='44444444-4444-4444-8444-444444444444';
 DynamicsService.queryAllRecords.mockResolvedValue({records:[raw({wmkf_expertiseprofileid:otherProfile,_wmkf_staffuser_value:other}),raw()],totalCount:2,capped:false});
 DynamicsService.getRecord.mockImplementation(async(_entity,value)=>({systemuserid:value,isdisabled:false}));
 const result=await call();expect(DynamicsService.getRecord.mock.calls.map(args=>args[1])).toEqual([user,other]);expect(result.projection.users.map(item=>item.userGuid)).toEqual([user,other]);
});
test('target drift during first sorted User read stops before the second',async()=>{
 const other='33333333-3333-4333-8333-333333333333';
 DynamicsService.queryAllRecords.mockResolvedValue({records:[raw(),raw({wmkf_expertiseprofileid:'44444444-4444-4444-8444-444444444444',_wmkf_staffuser_value:other})],totalCount:2,capped:false});
 DynamicsService.getRecord.mockImplementation(async()=>{process.env.DATAVERSE_TARGET_INTERLOCK='off';return {systemuserid:user,isdisabled:false};});
 await expect(call()).rejects.toMatchObject({code:'expertise_roster_read_unavailable',message:'Sandbox roster target is unavailable or changed.'});
 expect(DynamicsService.getRecord).toHaveBeenCalledTimes(1);expect(DynamicsService.getRecord.mock.calls[0][1]).toBe(user);
});
