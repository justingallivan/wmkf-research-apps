/** @jest-environment node */
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {createRecord:jest.fn(),updateRecord:jest.fn()} }));
jest.mock('../../lib/services/expertise-finder/roster-rehearsal-target.cjs', () => ({ assertTarget: jest.fn() }));
import { DynamicsService } from '../../lib/services/dynamics-service';
import {create,update} from '../../lib/dataverse/adapters/expertise-profile';
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
