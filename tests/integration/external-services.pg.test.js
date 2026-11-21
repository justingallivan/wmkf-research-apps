/** @jest-environment node */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { listServices, listReviews, saveService } from '../../lib/services/external-services/store';
import seed from '../../lib/services/external-services/seed.json';
const connectionString=process.env.EXTERNAL_SERVICES_TEST_URL || process.env.TEST_REQUEST_LEDGER_TEST_URL;
if(connectionString && !['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname)) throw new Error('Loopback test database required');
if (!connectionString && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') throw new Error('Scratch database required');
let mockPool;
jest.mock('@vercel/postgres',()=>({db:{connect:()=>mockPool.connect()},sql:{query:(...args)=>mockPool.query(...args)}}));
(connectionString?describe:describe.skip)('external-service persistence in isolated Postgres',()=>{
  const schema='service_test_'+crypto.randomBytes(6).toString('hex'); let admin;
  beforeAll(async()=>{
    admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
    mockPool=new Pool({connectionString,options:`-c search_path=${schema},public`});
    await mockPool.query('CREATE TABLE user_profiles(id INTEGER PRIMARY KEY); INSERT INTO user_profiles VALUES (42)');
    await mockPool.query(fs.readFileSync('lib/db/migrations/106_external_service_reviews.sql','utf8'));
  });
  afterAll(async()=>{await mockPool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  test('migration seeds match public inventory and preserve first implemented review',async()=>{
    const rows=await listServices();expect(rows).toHaveLength(seed.services.length);
    for(const row of rows)expect(row.data).toEqual(seed.services.find(s=>s.id===row.id).data);
    expect((await listReviews('assemblyai'))[0].data).toEqual(seed.assemblyAIReview);
  });
  test('review and service update commit together, stale retries do not duplicate',async()=>{
    const row=(await listServices()).find(s=>s.id==='assemblyai');
    const command={id:row.id,data:{...row.data,nextReviewOn:'2027-01-20'},expectedVersion:row.version,review:{...seed.assemblyAIReview,trigger:'Follow-up'}};
    await saveService(command,42);
    await expect(saveService(command,42)).rejects.toMatchObject({status:409});
    expect(await listReviews(row.id)).toHaveLength(2);
    expect((await listServices()).find(s=>s.id===row.id).data.nextReviewOn).toBe('2027-01-20');
  });
  test('missing review rolls back the companion service update',async()=>{
    const row=(await listServices()).find(s=>s.id==='assemblyai');
    await expect(saveService({id:row.id,data:{...row.data,owner:'Should roll back'},expectedVersion:row.version,review:seed.assemblyAIReview,reviewId:crypto.randomUUID()},42)).rejects.toMatchObject({status:404});
    expect((await listServices()).find(s=>s.id===row.id)).toEqual(row);
  });
  test('new service creation is bounded and duplicate IDs do not overwrite',async()=>{
    const command={id:'test-new-service',data:seed.services[0].data,expectedVersion:0};
    await saveService(command,42);await expect(saveService(command,42)).rejects.toMatchObject({status:409});
    expect((await listServices()).filter(s=>s.id===command.id)).toHaveLength(1);
  });
  test('review update stays bound to service and records the authenticated editor',async()=>{
    const row=(await listServices()).find(s=>s.id==='assemblyai');const review=(await listReviews(row.id))[0];
    await saveService({id:row.id,data:row.data,expectedVersion:row.version,review:{...review.data,followUp:'Observed on next natural run'},reviewId:review.id},42);
    const result=await mockPool.query('SELECT updated_by,data FROM external_service_reviews WHERE id=$1',[review.id]);
    expect(result.rows[0]).toMatchObject({updated_by:42,data:{followUp:'Observed on next natural run'}});
  });
});
