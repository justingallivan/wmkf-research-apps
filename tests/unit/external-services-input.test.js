/** @jest-environment node */
import handler from '../../pages/api/admin/external-services';
import seed from '../../lib/services/external-services/seed.json';
import { db, sql } from '@vercel/postgres';
jest.mock('../../lib/utils/auth',()=>({requireSuperuser:jest.fn(async()=>({profileId:42}))}));
jest.mock('@vercel/postgres',()=>({db:{connect:jest.fn()},sql:{query:jest.fn()}}));
const valid={id:'assemblyai',data:seed.services[0].data,expectedVersion:1,review:seed.assemblyAIReview};
const res=()=>{const r={setHeader:jest.fn(),status:jest.fn(),json:jest.fn()};r.status.mockReturnValue(r);return r;};
beforeEach(()=>jest.clearAllMocks());
test.each([null, [], 'body', {...valid,review:false}, {...valid,review:'x'}, {...valid,reviewId:['438dce63-e462-4e8d-877b-8aefc8f40840']}, {...valid,reviewId:false}, {...valid,reviewId:0}])('malformed body rejects without connecting: %j',async body=>{
  const r=res();await handler({method:'PUT',body,query:{}},r);expect(r.status).toHaveBeenCalledWith(400);expect(db.connect).not.toHaveBeenCalled();
});
test('repeated service ID query parameters reject without querying',async()=>{
  const r=res();await handler({method:'GET',query:{id:['assemblyai','openai']}},r);expect(r.status).toHaveBeenCalledWith(400);expect(sql.query).not.toHaveBeenCalled();
});
