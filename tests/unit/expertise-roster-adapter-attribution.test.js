/** @jest-environment node */
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {createRecord:jest.fn(),updateRecord:jest.fn(),queryAllRecords:jest.fn(),executeChangeset:jest.fn()} }));
jest.mock('../../lib/services/expertise-finder/roster-rehearsal-target.cjs', () => ({ assertTarget: jest.fn() }));
import { DynamicsService } from '../../lib/services/dynamics-service';
import {create,update,list} from '../../lib/dataverse/adapters/expertise-profile';
const ID='11111111-1111-4111-8111-111111111111';
const ACTOR='22222222-2222-4222-8222-222222222222';
beforeEach(() => jest.resetAllMocks());
test.each(['create','update'])('%s refuses service-principal fallback after impersonated 403',async kind=>{
 const method=kind==='create'?DynamicsService.createRecord:DynamicsService.updateRecord;
 method.mockImplementation(async (...args)=>{ if(args.at(-1).noFallback) throw Object.assign(new Error('Denied'),{status:403}); return {id:ID}; });
 await expect(kind==='create'?create({wmkf_name:'Test'},ACTOR):update(ID,{wmkf_name:'Test'},'W/"1"',ACTOR)).rejects.toMatchObject({status:403});
 expect(method).toHaveBeenCalledTimes(1);
 expect(method.mock.calls[0].at(-1)).toEqual(expect.objectContaining({actingUserSystemId:ACTOR,noFallback:true}));
});

test('complete roster read explicitly includes both supported lifecycle states',async()=>{
 DynamicsService.queryAllRecords.mockImplementation(async (_entity,options)=>{
  if(!options.filter)throw Error('Export requires a $filter');
  return {records:[{statecode:0},{statecode:1}],capped:false};
 });
 expect(await list()).toEqual([{statecode:0},{statecode:1}]);
 expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith('wmkf_expertiseprofiles',expect.objectContaining({filter:'statecode eq 0 or statecode eq 1',orderby:'wmkf_expertiseprofileid asc'}));
});
test('capped roster read refuses partial results',async()=>{
 DynamicsService.queryAllRecords.mockResolvedValue({records:[{statecode:0}],capped:true});
 await expect(list()).rejects.toThrow('incomplete');
});

test('inactive creation is one attributed atomic create/deactivate operation',async()=>{
 const body={wmkf_name:'Synthetic inactive',wmkf_creationkey:'app_'+ID,statecode:1,statuscode:2};
 await create(body,ACTOR);
 expect(DynamicsService.createRecord).not.toHaveBeenCalled();
 const [ops,options]=DynamicsService.executeChangeset.mock.calls[0];
 expect(options).toEqual({actingUserSystemId:ACTOR,noFallback:true});
 expect(ops).toHaveLength(2);
 expect(ops[0]).toMatchObject({method:'POST',url:'wmkf_expertiseprofiles',body:{statecode:0,statuscode:1,wmkf_creationkey:'app_'+ID}});
 expect(ops[1]).toEqual({method:'PATCH',url:`wmkf_expertiseprofiles(${ops[0].body.wmkf_expertiseprofileid})`,body:{statecode:1,statuscode:2}});
 expect(body.statecode).toBe(1);
});
test('inactive create propagates failed atomic outcome without direct-create fallback',async()=>{
 DynamicsService.executeChangeset.mockRejectedValue(Object.assign(Error('Denied'),{status:403}));
 await expect(create({statecode:1,statuscode:2},ACTOR)).rejects.toMatchObject({status:403});
 expect(DynamicsService.createRecord).not.toHaveBeenCalled();
});

test('invalid inactive status refuses before either write transport',()=>{
 expect(()=>create({statecode:1,statuscode:1},ACTOR)).toThrow('Invalid inactive');
 expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
 expect(DynamicsService.createRecord).not.toHaveBeenCalled();
});
