/** @jest-environment node */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { listServices, listReviews, saveService } from '../../lib/services/external-services/store';
import { claimCheck, finishCheck, readCheck, interruptCheck } from '../../lib/services/external-services/check-store';
import { sourcesFor, collectSource } from '../../lib/services/external-services/check-sources';
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
    await mockPool.query(fs.readFileSync('lib/db/migrations/107_external_service_inventory_followups.sql','utf8'));
    await mockPool.query(fs.readFileSync('lib/db/migrations/108_external_service_checks.sql','utf8'));
    await mockPool.query("INSERT INTO external_service_checks(service_id,snapshot) VALUES ('assemblyai','{\"upgradeProbe\":true}')");
    await expect(mockPool.query("INSERT INTO external_service_checks(service_id) VALUES ('openai')")).rejects.toMatchObject({code:'23514'});
    await mockPool.query(fs.readFileSync('lib/db/migrations/109_openai_service_checks.sql','utf8'));
    expect((await mockPool.query("SELECT snapshot FROM external_service_checks WHERE service_id='assemblyai'")).rows[0].snapshot).toEqual({upgradeProbe:true});
    await expect(mockPool.query("INSERT INTO external_service_checks(service_id) VALUES ('vercel-hosting')")).rejects.toMatchObject({code:'23514'});
    await mockPool.query(fs.readFileSync('lib/db/migrations/110_vercel_service_checks.sql','utf8'));
    expect((await mockPool.query("SELECT snapshot FROM external_service_checks WHERE service_id='assemblyai'")).rows[0].snapshot).toEqual({upgradeProbe:true});
    await expect(mockPool.query("INSERT INTO external_service_checks(service_id) VALUES ('neon')")).rejects.toMatchObject({code:'23514'});
    await mockPool.query(fs.readFileSync('lib/db/migrations/111_neon_service_checks.sql','utf8'));
    expect((await mockPool.query("SELECT snapshot FROM external_service_checks WHERE service_id='assemblyai'")).rows[0].snapshot).toEqual({upgradeProbe:true});
    await expect(mockPool.query("INSERT INTO external_service_checks(service_id) VALUES ('cloudmersive')")).rejects.toMatchObject({code:'23514'});
    await mockPool.query(fs.readFileSync('lib/db/migrations/112_cloudmersive_service_checks.sql','utf8'));
    expect((await mockPool.query("SELECT snapshot FROM external_service_checks WHERE service_id='assemblyai'")).rows[0].snapshot).toEqual({upgradeProbe:true});
    await mockPool.query("DELETE FROM external_service_checks WHERE service_id='assemblyai'");
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
  test('rejects another service’s review and rolls back the attempted service change',async()=>{
    const row=(await listServices()).find(s=>s.id==='openai');
    const review=(await listReviews('assemblyai'))[0];
    await expect(saveService({id:row.id,data:{...row.data,owner:'Wrong service'},expectedVersion:row.version,review:review.data,reviewId:review.id},42)).rejects.toMatchObject({status:404});
    expect((await listServices()).find(s=>s.id===row.id)).toEqual(row);
    expect((await listReviews('assemblyai')).find(r=>r.id===review.id).data).toEqual(review.data);
  });
  test('malformed UUID and out-of-range version reject before connecting',async()=>{
    const connect=jest.spyOn(mockPool,'connect');
    const command={id:'assemblyai',data:seed.services.find(s=>s.id==='assemblyai').data,expectedVersion:1,review:seed.assemblyAIReview};
    await expect(saveService({...command,reviewId:'-'.repeat(36)},42)).rejects.toMatchObject({status:400});
    await expect(saveService({...command,expectedVersion:2147483648},42)).rejects.toMatchObject({status:400});
    expect(connect).not.toHaveBeenCalled();connect.mockRestore();
  });

  test('500-service cap rejects creation without inserting a 501st row',async()=>{
    const before=Number((await mockPool.query('SELECT count(*) FROM external_services')).rows[0].count);
    await mockPool.query("INSERT INTO external_services(id,data) SELECT 'cap-service-'||n, $1::jsonb FROM generate_series(1,$2::integer) n",[JSON.stringify(seed.services[0].data),500-before]);
    try {
      await expect(saveService({id:'over-cap',data:seed.services[0].data,expectedVersion:0},42)).rejects.toMatchObject({status:400});
      expect((await mockPool.query('SELECT count(*)::int AS count FROM external_services')).rows[0].count).toBe(500);
      expect((await mockPool.query("SELECT id FROM external_services WHERE id='over-cap'")).rows).toHaveLength(0);
    } finally { await mockPool.query("DELETE FROM external_services WHERE id LIKE 'cap-service-%'"); }
  });
  test('200-review cap rolls back the companion service edit',async()=>{
    await saveService({id:'cap-review-service',data:seed.services[0].data,expectedVersion:0},42);
    const ids=Array.from({length:200},()=>crypto.randomUUID());
    await mockPool.query("INSERT INTO external_service_reviews(id,service_id,data) SELECT value::uuid,'cap-review-service',$2::jsonb FROM jsonb_array_elements_text($1::jsonb)",[JSON.stringify(ids),JSON.stringify(seed.assemblyAIReview)]);
    const row=(await listServices()).find(s=>s.id==='cap-review-service');
    await expect(saveService({id:row.id,data:{...row.data,owner:'Must roll back'},expectedVersion:row.version,review:seed.assemblyAIReview},42)).rejects.toMatchObject({status:400});
    expect((await listServices()).find(s=>s.id===row.id)).toEqual(row);
    expect((await mockPool.query('SELECT count(*)::int AS count FROM external_service_reviews WHERE service_id=$1',[row.id])).rows[0].count).toBe(200);
  });
  test('inventory follow-up migration is repeatable and preserves operator edits',async()=>{
    await mockPool.query(`UPDATE external_services SET data=jsonb_set(data,'{notes}','"Operator note"') WHERE id='europe-pmc'`);
    const before=(await listServices()).find(s=>s.id==='assemblyai');
    await mockPool.query(fs.readFileSync('lib/db/migrations/107_external_service_inventory_followups.sql','utf8'));
    expect((await listServices()).find(s=>s.id==='europe-pmc').data.notes).toBe('Operator note');
    expect((await listServices()).find(s=>s.id==='assemblyai').version).toBe(before.version);
    const seedReview=(await listReviews('assemblyai')).find(r=>r.id==='438dce63-e462-4e8d-877b-8aefc8f40840');
    expect(seedReview.data.links.filter(l=>l.href==='https://www.assemblyai.com/benchmarks')).toHaveLength(1);
  });

  test('first benchmark addition preserves review edits and increments the parent version',async()=>{
    const id='438dce63-e462-4e8d-877b-8aefc8f40840';
    const original=(await listReviews('assemblyai')).find(r=>r.id===id);
    const edited={...original.data,followUp:'Operator follow-up',links:original.data.links.filter(l=>l.href!=='https://www.assemblyai.com/benchmarks')};
    await mockPool.query('UPDATE external_service_reviews SET data=$1::jsonb WHERE id=$2',[JSON.stringify(edited),id]);
    const before=(await listServices()).find(s=>s.id==='assemblyai');
    await mockPool.query(fs.readFileSync('lib/db/migrations/107_external_service_inventory_followups.sql','utf8'));
    const after=(await listServices()).find(s=>s.id==='assemblyai');
    expect(after.version).toBe(before.version+1);expect(after.data).toEqual(before.data);
    const review=(await listReviews('assemblyai')).find(r=>r.id===id);
    expect(review.data).toEqual({...edited,links:[...edited.links,{label:'Vendor benchmark comparison',href:'https://www.assemblyai.com/benchmarks'}]});
  });

  test('manual checks are fenced, recoverable, and never change service/review state',async()=>{
    const before=(await listServices()).find(s=>s.id==='assemblyai');const reviews=await listReviews('assemblyai');
    const claim=await claimCheck('assemblyai',42);
    await expect(claimCheck('assemblyai',42)).rejects.toMatchObject({status:409});
    expect((await readCheck('assemblyai')).running).toBe(true);
    await mockPool.query("UPDATE external_service_checks SET lease_expires_at=now()-interval '1 second' WHERE service_id='assemblyai'");
    expect((await readCheck('assemblyai')).interrupted).toBe(true);
    const replacement=await claimCheck('assemblyai',42);
    await expect(finishCheck('assemblyai',claim.token,{checkedAt:'old'})).rejects.toMatchObject({status:409});
    const snapshot={checkedAt:new Date().toISOString(),sources:[],baselines:{pricing:{fingerprint:'retained',lines:[],observedAt:'today'}}};
    await finishCheck('assemblyai',replacement.token,snapshot);
    expect((await claimCheck('assemblyai',42)).cached.checkedAt).toBe(snapshot.checkedAt);
    expect((await listServices()).find(s=>s.id==='assemblyai')).toEqual(before);expect(await listReviews('assemblyai')).toEqual(reviews);
    expect((await mockPool.query("SELECT checked_by FROM external_service_checks WHERE service_id='assemblyai'")).rows[0].checked_by).toBe(42);
  });
  test.each(['microsoft','google','service-custom',null,['assemblyai']])('unsupported manual-check target rejects before SQL: %j',async id=>{
    const query=jest.spyOn(mockPool,'query');await expect(claimCheck(id,42)).rejects.toMatchObject({status:400});expect(query).not.toHaveBeenCalled();query.mockRestore();
  });

  test('OpenAI coverage SQL reads only matching recent model IDs',async()=>{
    await mockPool.query('CREATE TABLE api_usage_log(model text, created_at timestamp DEFAULT now())');
    try {
      await mockPool.query("INSERT INTO api_usage_log(model) VALUES ('gpt-unpriced-test'),('claude-test'),('ft:gpt-test:private')");
      await mockPool.query("INSERT INTO api_usage_log(model,created_at) VALUES ('gpt-old-test',now()-interval '8 days')");
      const checked=await collectSource(sourcesFor('openai')[1],undefined,undefined,new Date().toISOString());
      expect(checked.result.status).toBe('baseline');
      expect(checked.result.lines.join()).toContain('gpt-unpriced-test: 1 logged requests; NO LOCAL RATE');
      for (const excluded of ['claude-test','private','gpt-old-test']) expect(checked.result.lines.join()).not.toContain(excluded);
    } finally {await mockPool.query('DROP TABLE api_usage_log');}
  });

  test.each(['openai','vercel-hosting','neon','cloudmersive'])('%s check persists after allowlist expansion without editing the service',async id=>{
    const before=(await listServices()).find(s=>s.id===id);
    const claim=await claimCheck(id,42);
    const snapshot={checkedAt:new Date().toISOString(),sources:[{key:'models',status:'baseline',lines:['Model list checked']}],baselines:{}};
    await finishCheck(id,claim.token,snapshot);
    expect(await readCheck(id)).toMatchObject(snapshot);
    expect((await listServices()).find(s=>s.id===id)).toEqual(before);
    await expect(mockPool.query("INSERT INTO external_service_checks(service_id) VALUES ('microsoft')")).rejects.toMatchObject({code:'23514'});
  });

  test('missing check storage preserves an explicit setup state',async()=>{
    await mockPool.query('ALTER TABLE external_service_checks RENAME TO check_storage_test_hidden');
    try { expect(await readCheck('assemblyai')).toEqual({setupRequired:true});expect((await listReviews('assemblyai')).length).toBeGreaterThan(0); }
    finally {await mockPool.query('ALTER TABLE check_storage_test_hidden RENAME TO external_service_checks');}
  });
  test('failed and expired attempts cannot finish or interrupt their replacement',async()=>{
    const first=await claimCheck('serpapi',42);
    await expect(finishCheck('serpapi',first.token,{large:'x'.repeat(200001)})).rejects.toMatchObject({status:503});
    await interruptCheck('serpapi',first.token);expect((await readCheck('serpapi')).interrupted).toBe(true);
    await expect(finishCheck('serpapi',first.token,{})).rejects.toMatchObject({status:409});
    const next=await claimCheck('serpapi',42);await interruptCheck('serpapi',first.token);
    expect((await readCheck('serpapi')).running).toBe(true);
    await finishCheck('serpapi',next.token,{checkedAt:new Date().toISOString()});
  });
  test('human review revision changes only on a saved review, not a service edit',async()=>{
    const first=await claimCheck('anthropic',42);await interruptCheck('anthropic',first.token);
    const row=(await listServices()).find(s=>s.id==='anthropic');
    await saveService({id:row.id,data:{...row.data,owner:'Updated owner'},expectedVersion:row.version},42);
    const second=await claimCheck('anthropic',42);expect(second.reviewRevision).toBe(first.reviewRevision);await interruptCheck('anthropic',second.token);
    await saveService({id:row.id,data:row.data,expectedVersion:row.version+1,review:seed.assemblyAIReview},42);
    const third=await claimCheck('anthropic',42);expect(third.reviewRevision).not.toBe(second.reviewRevision);await interruptCheck('anthropic',third.token);
  });

  test('review acknowledgement must follow the completed check in database time',async()=>{
    const row=(await listServices()).find(s=>s.id==='serpapi');
    await saveService({id:row.id,data:row.data,expectedVersion:row.version,review:seed.assemblyAIReview},42);
    await mockPool.query("UPDATE external_service_reviews SET updated_at=now()-interval '120 seconds' WHERE service_id='serpapi'");
    await mockPool.query("UPDATE external_service_checks SET checked_at=now()-interval '61 seconds' WHERE service_id='serpapi'");
    const during=await claimCheck('serpapi',42);expect(during.reviewAfterCheck).toBe(false);await interruptCheck('serpapi',during.token);
    await mockPool.query("UPDATE external_service_reviews SET updated_at=now() WHERE service_id='serpapi'");
    const after=await claimCheck('serpapi',42);expect(after.reviewAfterCheck).toBe(true);await interruptCheck('serpapi',after.token);
  });

});
