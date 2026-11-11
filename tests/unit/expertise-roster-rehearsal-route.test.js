/** @jest-environment node */
jest.mock('../../lib/utils/auth',()=>({requireAppAccess:jest.fn(async()=>({session:{}}))}));
jest.mock('../../lib/utils/actor-ref',()=>({actorRefFromSession:()=> '11111111-1111-4111-8111-111111111111'}));
jest.mock('../../lib/dataverse/core/context',()=>({withDalContext:(_scope,fn)=>fn()}));
jest.mock('../../lib/services/expertise-finder/roster-rehearsal-target.cjs',()=>({enabled:()=>true,assertTarget:jest.fn()}));
jest.mock('../../lib/services/expertise-finder/roster-service',()=>({saveRoster:jest.fn(),listRoster:jest.fn()}));
import handler from '../../pages/api/expertise-finder/roster';
import {saveRoster} from '../../lib/services/expertise-finder/roster-service';
beforeEach(()=>jest.clearAllMocks());
test.each([200,201,302,undefined,700])('error status %s is sanitized 503, never successful HTTP',async status=>{
 saveRoster.mockRejectedValue(Object.assign(Error('raw platform response must not escape'),{status}));
 const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
 await handler({method:'POST',body:{},query:{}},res);
 expect(res.status).toHaveBeenCalledWith(503);
 expect(res.json).toHaveBeenCalledWith({error:'Roster operation outcome unavailable. Reload or retry with the same creation identity.'});
});
test.each([[403,403],[409,409],[412,409]])('valid status %s retains refusal/conflict mapping',async(input,expected)=>{
 saveRoster.mockRejectedValue(Object.assign(Error('Denied'),{status:input}));
 const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
 await handler({method:'POST',body:{},query:{}},res);
 expect(res.status).toHaveBeenCalledWith(expected);
});
