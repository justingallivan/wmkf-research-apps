/** @jest-environment node */
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {createRecord:jest.fn(),updateRecord:jest.fn(),queryAllRecords:jest.fn()} }));
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
