/** @jest-environment node */
import handler from '../../pages/api/admin/external-services';
import { requireSuperuser } from '../../lib/utils/auth';
import { checkForUpdates } from '../../lib/services/external-services/checks';
jest.mock('../../lib/utils/auth',()=>({requireSuperuser:jest.fn()}));
jest.mock('../../lib/services/external-services/checks',()=>({checkForUpdates:jest.fn()}));
jest.mock('../../lib/services/external-services/check-store',()=>({readCheck:jest.fn()}));
jest.mock('../../lib/services/external-services/store',()=>({listServices:jest.fn(),listReviews:jest.fn(),saveService:jest.fn()}));
const response=()=>{const r={setHeader:jest.fn(),json:jest.fn(),status:jest.fn()};r.status.mockReturnValue(r);return r;};
beforeEach(()=>{jest.clearAllMocks();requireSuperuser.mockResolvedValue({profileId:42});});
test('POST derives actor from authentication and disallows caching',async()=>{
 const res=response();await handler({method:'POST',body:{action:'check',id:'assemblyai'}},res);
 expect(checkForUpdates).toHaveBeenCalledWith('assemblyai',42);expect(res.setHeader).toHaveBeenCalledWith('Cache-Control','private, no-store');
});
test('denied POST cannot invoke check',async()=>{requireSuperuser.mockResolvedValue(null);await handler({method:'POST',body:{action:'check',id:'assemblyai'}},response());expect(checkForUpdates).not.toHaveBeenCalled();});
test.each([null,[],{action:'check',id:'assemblyai',profileId:999},{action:'check',id:'assemblyai',url:'https://evil.test'},{action:'other',id:'assemblyai'}])('rejects nonclosed payload %j',async body=>{const res=response();await handler({method:'POST',body},res);expect(res.status).toHaveBeenCalledWith(400);expect(checkForUpdates).not.toHaveBeenCalled();});
