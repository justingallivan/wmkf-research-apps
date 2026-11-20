/** @jest-environment node */
jest.mock('../../lib/services/dynamics-service',()=>({DynamicsService:{executeChangeset:jest.fn(),createRecord:jest.fn(),updateRecord:jest.fn()}}));
import {DynamicsService} from '../../lib/services/dynamics-service';
import {create,update} from '../../lib/dataverse/adapters/expertise-profile';
const id='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{jest.clearAllMocks();process.env.EXPERTISE_ROSTER_BACKEND='dataverse';process.env.DYNAMICS_URL='https://wmkf.crm.dynamics.com';});
afterEach(()=>delete process.env.EXPERTISE_ROSTER_BACKEND);
test('clear lookup and ETag PATCH are atomic and never fall back',()=>{
 update(id,{wmkf_name:'Person'},'W/"4"',id,{clearStaffUser:true});
 expect(DynamicsService.executeChangeset).toHaveBeenCalledWith([
  {method:'PATCH',url:`wmkf_expertiseprofiles(${id})`,body:{wmkf_name:'Person'},ifMatch:'W/"4"'},
  {method:'DELETE',url:`wmkf_expertiseprofiles(${id})/wmkf_StaffUser/$ref`},
 ],{actingUserSystemId:id,noFallback:true});
});
test('inactive create retains prebound GUID inside atomic create/deactivate',()=>{
 create({wmkf_expertiseprofileid:id,wmkf_name:'Person',statecode:1,statuscode:2},id);
 const [ops,options]=DynamicsService.executeChangeset.mock.calls[0];
 expect(ops[0].body).toMatchObject({wmkf_expertiseprofileid:id,statecode:0,statuscode:1});
 expect(ops[1]).toMatchObject({url:`wmkf_expertiseprofiles(${id})`,body:{statecode:1,statuscode:2}});expect(options.noFallback).toBe(true);
});
