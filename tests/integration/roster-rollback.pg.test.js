/** @jest-environment node */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const dotenv=require('dotenv');
const {createRosterPgFixture}=require('../helpers/roster-pg-fixture.cjs');
const {runCutover}=require('../../scripts/lib/expertise-roster-cutover.cjs');
const {planImport,TEXT_POLICY}=require('../../scripts/lib/expertise-roster-import-plan.cjs');
const host='orgd9e66399.crm.dynamics.com',envFile=process.env.ROSTER_LIVE_SQL_TEST_ENV;
const live=envFile?describe:describe.skip;
const contact='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',contact2='cccccccc-cccc-4ccc-8ccc-cccccccccccc',contact3='dddddddd-dddd-4ddd-8ddd-dddddddddddd',user='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('rollback refuses public before connecting',async()=>{
 const connect=jest.fn();await expect(runCutover({schema:'public',phase:'rollback',connect,execute:true})).rejects.toThrow(/public is refused/);expect(connect).not.toHaveBeenCalled();
});
live('disposable roster rollback',()=>{
 let db,dir,env,review,snapshot,connect;
 const timestamp='2026-04-05T06:07:08.123456Z';
 const clone=()=>structuredClone(snapshot);
 const run=(phase,extra={})=>runCutover({env,schema:db.schema,phase,acknowledge:host,manifestPath:path.join(dir,'baseline.json'),receiptPath:path.join(dir,randomUUID()+'.json'),execute:true,review,connect,readTarget:async()=>clone(),...extra});
 const profile=id=>snapshot.profiles.find(p=>p.profileGuid===id);
 const state=async()=>({
  rows:(await db.primary.query('SELECT to_jsonb(r)::text AS row FROM expertise_roster r ORDER BY id')).rows,
  control:(await db.primary.query('SELECT * FROM expertise_roster_cutover')).rows,
  seq:(await db.primary.query('SELECT last_value,is_called FROM expertise_roster_id_seq')).rows,
  fk:(await db.primary.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='consultant_feedback'::regclass AND contype='f' ORDER BY conname")).rows,
  triggers:(await db.primary.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='expertise_roster'::regclass AND NOT tgisinternal ORDER BY tgname")).rows,
 });
 beforeEach(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'roster-rollback-'));env=dotenv.parse(fs.readFileSync(envFile));db=await createRosterPgFixture(envFile);
  await db.primary.query("SET TIME ZONE 'America/Los_Angeles'");
  connect=async()=>{const client=await db.connect();await client.query("SET TIME ZONE 'America/Los_Angeles'");return client;};
  await db.primary.query("UPDATE expertise_roster SET role='', created_at='2020-01-01 01:02:03.123456',updated_at='2020-02-02 04:05:06.654321' WHERE id=1");
  await db.primary.query("UPDATE expertise_roster SET role_type='Research Program Staff',dataverse_contact_id=$1 WHERE id=1",[contact]);
  await db.primary.query("UPDATE expertise_roster SET dataverse_contact_id=$1 WHERE id=2",[contact2]);
  await db.primary.query("INSERT INTO expertise_roster(id,name,role_type,dataverse_contact_id) VALUES(3,'Synthetic swap','Consultant',$1)",[contact3]);
  const {rows}=await db.primary.query('SELECT * FROM expertise_roster ORDER BY id');
  const source={version:1,datasetId:randomUUID(),sequenceHighWater:42,rows:JSON.parse(JSON.stringify(rows))};
  const mapping={version:1,datasetId:source.datasetId,targetHost:host,rows:rows.map(row=>({legacyId:row.id,confirmed:true,active:row.id===1||row.id===3,exclude:row.id===35,staffUserGuid:row.id===1?user:null,contactGuid:row.id===2?contact2:row.id===3?contact3:null,leadPdEligible:row.id===1}))};
  const {id:ignored,...amy}=rows.find(row=>row.id===2);amy.name='Baseline Amy';amy.dataverse_contact_id=null;
  mapping.newProfiles=[{mutationId:randomUUID(),row:JSON.parse(JSON.stringify(amy)),decision:{staffUserGuid:null,contactGuid:null,leadPdEligible:false,active:true,confirmed:true}}];
  snapshot={version:1,complete:true,targetHost:host,profiles:[]};
  const reviewedPlan=planImport(source,snapshot,mapping,[host]);const receiptRows=[];
  for(const row of reviewedPlan.rows){
   const rosterId=row.legacyId??40;
   await db.primary.query('INSERT INTO expertise_roster_identity(id) VALUES($1)',[rosterId]);
   const receipt={legacyId:row.legacyId,rosterId,creationKey:row.creationKey};
   if(row.action==='exclude')receipt.status='identity-only';else{
    receipt.status='bound';receipt.profileGuid=randomUUID();
    snapshot.profiles.push({profileGuid:receipt.profileGuid,values:{...row.values,'@odata.etag':'W/"1"',createdon:timestamp,modifiedon:timestamp}});
    await db.primary.query('INSERT INTO expertise_roster_binding VALUES($1,$2,$3)',[rosterId,host,receipt.profileGuid]);
   }
   receiptRows.push(receipt);
  }
  review={source,mapping,reviewedPlan,importReceipt:{version:2,success:true,bridgeCommitted:true,targetHost:host,datasetId:source.datasetId,textPolicy:TEXT_POLICY,sourceHash:reviewedPlan.sourceHash,mappingHash:reviewedPlan.mappingHash,rows:receiptRows}};
  // Slice A's baseline projection intentionally omits audit fields.
  const baselineRead=async()=>{const c=clone();for(const p of c.profiles){delete p.values.createdon;delete p.values.modifiedon;}return c;};
  await run('prepare',{readTarget:baselineRead});
  if(!expect.getState().currentTestName.includes('abort terminal refuses rollback')){await run('activate',{readTarget:baselineRead});await run('pause');}
 });
 afterEach(async()=>{try{if(db)await db.cleanup();}finally{if(dir)fs.rmSync(dir,{recursive:true,force:true});db=dir=null;}});
 test('dry-run reports planned counts without changing state or private files',async()=>{
  const before=await state(),files=fs.readdirSync(dir).sort(),censusBefore=clone();
  const result=await run('rollback',{execute:false});
  expect(result).toMatchObject({status:'dry-run',currentPhase:'paused',changedRows:0,insertedRows:1,nextLegacyId:43});
  expect(await state()).toEqual(before);expect(fs.readdirSync(dir).sort()).toEqual(files);expect(snapshot).toEqual(censusBefore);
 });
 test('unchanged empty text and microsecond audit remain physically unchanged',async()=>{
  const before=(await db.primary.query("SELECT to_jsonb(r)::text AS value FROM expertise_roster r WHERE id IN (1,35) ORDER BY id")).rows;
  expect(await run('rollback')).toMatchObject({status:'committed',currentPhase:'legacy'});
  expect((await db.primary.query("SELECT to_jsonb(r)::text AS value FROM expertise_roster r WHERE id IN (1,35) ORDER BY id")).rows).toEqual(before);
  expect((await db.primary.query('SELECT role,created_at::text,updated_at::text FROM expertise_roster WHERE id=1')).rows[0]).toEqual({role:'',created_at:'2020-01-01 01:02:03.123456',updated_at:'2020-02-02 04:05:06.654321'});
 });
 test('lead deactivation preserves the original sandbox-null Contact',async()=>{
  const lead=profile(review.importReceipt.rows.find(r=>r.legacyId===1).profileGuid);
  lead.values.statecode=1;lead.values.wmkf_leadpdeligible=false;lead.values.modifiedon=timestamp;
  await run('rollback');
  expect((await db.primary.query('SELECT is_active,dataverse_contact_id FROM expertise_roster WHERE id=1')).rows[0]).toEqual({is_active:false,dataverse_contact_id:contact});
 });
 test('baseline override returned to original SQL value leaves audit physically untouched',async()=>{
  const original=(await db.primary.query("SELECT to_jsonb(r)::text AS value FROM expertise_roster r WHERE id=2")).rows;
  const row=profile(review.importReceipt.rows.find(r=>r.legacyId===2).profileGuid);row.values.statecode=0;
  await run('rollback');
  expect((await db.primary.query("SELECT to_jsonb(r)::text AS value FROM expertise_roster r WHERE id=2")).rows).toEqual(original);
 });
 test('newly allocated binding inserts its row at the reserved ID',async()=>{
  const id=randomUUID(),p=structuredClone(snapshot.profiles[1]);p.profileGuid=id;p.values.wmkf_creationkey='app_'+id;p.values.wmkf_name='New synthetic';p.values.statecode=0;p.values.wmkf_contactguid=null;
  snapshot.profiles.push(p);await db.primary.query('INSERT INTO expertise_roster_identity(id) VALUES(43)');
  await db.primary.query('INSERT INTO expertise_roster_binding VALUES(43,$1,$2)',[host,id]);
  await db.primary.query('UPDATE expertise_roster_cutover SET high_water=43');
  expect(await run('rollback')).toMatchObject({status:'committed',insertedRows:2,nextLegacyId:44});
  expect((await db.primary.query('SELECT id,name FROM expertise_roster WHERE id IN (40,43) ORDER BY id')).rows).toEqual([{id:40,name:'Baseline Amy'},{id:43,name:'New synthetic'}]);
 });
 test('active Contact slots can swap without transient uniqueness failure',async()=>{
  const two=profile(review.importReceipt.rows.find(r=>r.legacyId===2).profileGuid);
  const three=profile(review.importReceipt.rows.find(r=>r.legacyId===3).profileGuid);
  two.values.statecode=0;two.values.wmkf_contactguid=contact3;three.values.wmkf_contactguid=contact2;
  await run('rollback');
  expect((await db.primary.query('SELECT id,dataverse_contact_id FROM expertise_roster WHERE id IN (2,3) ORDER BY id')).rows).toEqual([{id:2,dataverse_contact_id:contact3},{id:3,dataverse_contact_id:contact2}]);
 });
 test.each(['app','direct','legacy'])('new unbound %s profile refuses without changing paused SQL',async prefix=>{
  const id=randomUUID(),sourceProfile=structuredClone(snapshot.profiles[0]);sourceProfile.profileGuid=id;
  sourceProfile.values.wmkf_creationkey=prefix==='legacy'?`legacy_${randomUUID()}_99`:`${prefix}_${id}`;snapshot.profiles.push(sourceProfile);
  const before=await state();await expect(run('rollback')).rejects.toThrow(/unbound/i);expect(await state()).toEqual(before);
 });
 test('missing bound profile and malformed audit timestamp refuse without writes',async()=>{
  const saved=snapshot.profiles.pop(),before=await state();await expect(run('rollback')).rejects.toThrow(/binding|profile/i);expect(await state()).toEqual(before);
  snapshot.profiles.push(saved);saved.values.wmkf_name='Changed';saved.values.modifiedon='invalid';
  await expect(run('rollback')).rejects.toThrow(/audit timestamp/i);expect(await state()).toEqual(before);
 });
 test.each([
  ['unsupported User',p=>{p.values.wmkf_staffuser=randomUUID();},/User/i],
  ['unsupported lead',p=>{p.values.wmkf_leadpdeligible=false;},/lead eligibility/i],
  ['oversized text',p=>{p.values.wmkf_name='x'.repeat(256);},/legacy column|profile fields/i],
  ['linked email edit',p=>{p.values.wmkf_preferredemail='new@example.test';},/Preferred email/i],
 ])('%s refuses and preserves paused state',async(_label,mutate,reason)=>{
  const before=await state();mutate(snapshot.profiles[0]);
  await expect(run('rollback')).rejects.toThrow(reason);expect(await state()).toEqual(before);
 });
 test('duplicate active Contact refuses without changing paused state',async()=>{
  const before=await state(),two=profile(review.importReceipt.rows.find(r=>r.legacyId===2).profileGuid);
  two.values.statecode=0;two.values.wmkf_contactguid=contact3;
  await expect(run('rollback')).rejects.toThrow(/active Contact/i);expect(await state()).toEqual(before);
 });
 test('pending intent refuses and preserves paused state',async()=>{
  const id=randomUUID();await db.primary.query('UPDATE expertise_roster_cutover SET pending=$1::jsonb',[JSON.stringify({[id]:{kind:'create',creationKey:'app_'+id}})]);
  const before=await state();await expect(run('rollback')).rejects.toThrow(/Unsettled/i);expect(await state()).toEqual(before);
 });
 test('linked email refusal can be resolved by resume, revert, pause and retry',async()=>{
  const lead=profile(review.importReceipt.rows.find(r=>r.legacyId===1).profileGuid);
  lead.values.wmkf_preferredemail='new@example.test';
  await expect(run('rollback')).rejects.toThrow(/Preferred email/i);
  await run('resume');lead.values.wmkf_preferredemail=null;await run('pause');
  expect(await run('rollback')).toMatchObject({status:'committed'});
 });
 test('sequence exhaustion preserves paused state',async()=>{
  await db.primary.query('UPDATE expertise_roster_cutover SET high_water=2147483647');
  const before=await state();await expect(run('rollback')).rejects.toThrow(/sequence/i);expect(await state()).toEqual(before);
 });
 test('changed and inserted audit timestamps use UTC wall time despite non-UTC sessions',async()=>{
  const p=profile(review.importReceipt.rows.find(r=>r.legacyId===1).profileGuid);
  p.values.wmkf_name='Changed synthetic';p.values.modifiedon='2025-06-07T08:09:10.123456Z';
  await run('rollback');
  const rows=(await db.primary.query('SELECT id,created_at::text,updated_at::text,created_by,updated_by FROM expertise_roster WHERE id IN (1,40) ORDER BY id')).rows;
  expect(rows[0]).toMatchObject({id:1,created_at:'2020-01-01 01:02:03.123456',updated_at:'2025-06-07 08:09:10.123456',updated_by:null});
  expect(rows[1]).toMatchObject({id:40,created_at:'2026-04-05 06:07:08.123456',updated_at:'2026-04-05 06:07:08.123456',created_by:null,updated_by:null});
 });
 test('abort terminal refuses rollback',async()=>{
  await run('abort');const before=await state();
  await expect(run('rollback')).rejects.toThrow(/terminal action/i);expect(await state()).toEqual(before);
 });
 test('bad private manifest refuses without changing paused state',async()=>{
  const manifestPath=path.join(dir,'baseline.json');const manifest=JSON.parse(fs.readFileSync(manifestPath));
  manifest.generation=randomUUID();fs.writeFileSync(manifestPath,JSON.stringify(manifest),{mode:0o600});
  const before=await state();await expect(run('rollback')).rejects.toThrow(/manifest/i);expect(await state()).toEqual(before);
 });
 test('feedback pointing to an identity with no restored row refuses',async()=>{
  await db.primary.query('INSERT INTO expertise_roster_identity(id) VALUES(43)');
  await db.primary.query('UPDATE expertise_roster_cutover SET high_water=43');
  await db.primary.query("INSERT INTO consultant_feedback(request_id,consultant_roster_id,body_html,received_on,mutation_id,created_by,updated_by) VALUES($1,43,'Synthetic',CURRENT_DATE,$2,1,1)",[randomUUID(),randomUUID()]);
  const before=await state();await expect(run('rollback')).rejects.toThrow(/Feedback/i);expect(await state()).toEqual(before);
 });
 test('changed second census refuses atomically',async()=>{
  const before=await state();let calls=0;
  await expect(run('rollback',{readTarget:async()=>{const c=clone();if(++calls===2)c.profiles[0].values['@odata.etag']='W/"2"';return c;}})).rejects.toThrow(/census changed/i);
  expect(await state()).toEqual(before);
 });
 test('fault after sequence restart rolls back freeze, FK, sequence and data',async()=>{
  const before=await state();let injected=false;
  const failing=async()=>{const c=await connect(),query=c.query.bind(c);c.query=async(...args)=>{const result=await query(...args);if(/^ALTER SEQUENCE .* RESTART WITH /i.test(args[0])){injected=true;throw Error('fault after restart');}return result;};return c;};
  await expect(run('rollback',{connect:failing})).rejects.toThrow();expect(injected).toBe(true);expect(await state()).toEqual(before);
 });
 test('lost COMMIT is observed without replaying after a legacy insert',async()=>{
  let injected=false;const receiptPath=path.join(dir,'lost.json');
  const losing=async()=>{const c=await connect(),query=c.query.bind(c);c.query=async(...args)=>{const result=await query(...args);if(args[0]==='COMMIT'&&!injected){injected=true;throw Error('lost COMMIT');}return result;};return c;};
  await expect(run('rollback',{connect:losing,receiptPath})).rejects.toThrow(/lost COMMIT/);expect(injected).toBe(true);
  expect(JSON.parse(fs.readFileSync(receiptPath)).status).toBe('commit-unknown');
  const inserted=await db.primary.query("INSERT INTO expertise_roster(name,role_type) VALUES('After rollback','Consultant') RETURNING id");
  expect(inserted.rows[0].id).toBe(43);
  expect(await run('rollback',{readTarget:jest.fn(()=>{throw Error('unexpected census');})})).toMatchObject({status:'observed'});
  await expect(run('abort')).rejects.toThrow(/terminal action/i);
 });
});
