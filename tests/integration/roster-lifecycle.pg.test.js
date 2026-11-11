/** @jest-environment node */
// Opt-in: the fixture verifies its private target and fingerprints public before/after.
const {readFileSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const {parse}=require('dotenv');
const {createRosterPgFixture}=require('../helpers/roster-pg-fixture.cjs');
const {createLifecycle,installFreeze,CONTROL_DDL}=require('../../lib/services/expertise-finder/roster-lifecycle.cjs');
const run=process.env.ROSTER_LIVE_SQL_TEST_ENV?describe:describe.skip;
run('roster lifecycle allocation in disposable PostgreSQL schema',()=>{
 let fixture,db,lifecycle,host;
 const key=id=>'app_'+id;
 const complete=(id,creationKey=key(id))=>lifecycle.write(lease=>lease.complete({profileGuid:id,creationKey}));
 beforeAll(async()=>{
  const env=parse(readFileSync(process.env.ROSTER_LIVE_SQL_TEST_ENV));
  fixture=await createRosterPgFixture(process.env.ROSTER_LIVE_SQL_TEST_ENV);db=fixture.primary;
  lifecycle=createLifecycle({env,schema:fixture.schema,connect:fixture.connect});host=lifecycle.host;
  await db.query(CONTROL_DDL);
  await db.query('INSERT INTO expertise_roster_cutover(target_host,phase,generation,baseline_hash,high_water) VALUES($1,$2,$3,$4,42)',[host,'active',randomUUID(),'a'.repeat(64)]);
  await installFreeze(db);
 });
 afterAll(async()=>{if(fixture)await fixture.cleanup();});
 beforeEach(async()=>{
  await db.query('DELETE FROM expertise_roster_binding');
  await db.query('DELETE FROM expertise_roster_identity');
  await db.query("UPDATE expertise_roster_cutover SET phase='active',high_water=42,pending='{}'::jsonb");
 });
 test('concurrent distinct and identical profiles allocate unique, stable identities',async()=>{
  const a=randomUUID(),b=randomUUID();
  const results=await Promise.all([complete(a),complete(b),complete(a)]);
  expect(results[0]).toBe(results[2]);expect(results[0]).not.toBe(results[1]);
  expect(results.slice(0,2).sort((x,y)=>x-y)).toEqual([43,44]);
  expect((await db.query('SELECT count(*)::int AS n FROM expertise_roster_binding')).rows[0].n).toBe(2);
  expect((await db.query('SELECT high_water FROM expertise_roster_cutover')).rows[0].high_water).toBe(44);
 });
 test('known binding is reused without advancing high water',async()=>{
  const id=randomUUID();await db.query('INSERT INTO expertise_roster_identity(id) VALUES(9)');
  await db.query('INSERT INTO expertise_roster_binding(roster_id,target_host,dataverse_profile_guid) VALUES(9,$1,$2)',[host,id]);
  expect(await complete(id)).toBe(9);
  expect((await db.query('SELECT high_water FROM expertise_roster_cutover')).rows[0].high_water).toBe(42);
 });
 test('definite rejection removes intent while uncertain rejection retains it',async()=>{
  const id=randomUUID();let definite,unknown;
  await lifecycle.write(async lease=>{
   definite=await lease.beforeMutation({kind:'create',creationKey:key(id)});
   unknown=await lease.beforeMutation({kind:'update',profileGuid:id,etag:'W/"123"'});
   expect(await lease.rejectMutation(definite,{serviceName:'dataverse',status:412})).toBe(true);
   expect(await lease.rejectMutation(unknown,{serviceName:'dataverse',status:503,noResponse:true})).toBe(false);
  });
  const pending=(await db.query('SELECT pending FROM expertise_roster_cutover')).rows[0].pending;
  expect(pending).not.toHaveProperty(definite);expect(pending).toHaveProperty(unknown);
 });
 test('trusted creation key clears matching uncertain intents but not unrelated ones',async()=>{
  const id=randomUUID(),other=randomUUID();let matching,unrelated;
  await lifecycle.write(async lease=>{
   matching=await lease.beforeMutation({kind:'create',creationKey:key(id)});
   unrelated=await lease.beforeMutation({kind:'create',creationKey:key(other)});
   await expect(lease.complete({profileGuid:id,creationKey:'invalid'})).rejects.toMatchObject({status:503});
   expect(await lease.complete({profileGuid:id,creationKey:key(id)})).toBe(43);
  });
  const pending=(await db.query('SELECT pending FROM expertise_roster_cutover')).rows[0].pending;
  expect(pending).not.toHaveProperty(matching);expect(pending).toHaveProperty(unrelated);
 });
 test('paused lifecycle refuses work before callback',async()=>{
  await db.query("UPDATE expertise_roster_cutover SET phase='paused'");
  const work=jest.fn();await expect(lifecycle.write(work)).rejects.toMatchObject({status:503});expect(work).not.toHaveBeenCalled();
 });
 test('exhaustion refuses new allocation and preserves state',async()=>{
  await db.query('UPDATE expertise_roster_cutover SET high_water=2147483647');
  await expect(complete(randomUUID())).rejects.toMatchObject({status:503});
  expect((await db.query('SELECT count(*)::int AS n FROM expertise_roster_binding')).rows[0].n).toBe(0);
  expect((await db.query('SELECT high_water FROM expertise_roster_cutover')).rows[0].high_water).toBe(2147483647);
 });
 test('unknown COMMIT outcome reuses the committed binding on retry',async()=>{
  const id=randomUUID();let injected=false;
  const env=parse(readFileSync(process.env.ROSTER_LIVE_SQL_TEST_ENV));
  const uncertain=createLifecycle({env,schema:fixture.schema,connect:async()=>{
   const client=await fixture.connect();const query=client.query.bind(client);
   client.query=async (...args)=>{
    const result=await query(...args);
    if(args[0]==='COMMIT'&&!injected){injected=true;throw new Error('lost COMMIT response');}
    return result;
   };
   return client;
  }});
  await expect(uncertain.write(lease=>lease.complete({profileGuid:id,creationKey:key(id)}))).rejects.toMatchObject({status:503});
  expect(injected).toBe(true);
  expect(await complete(id)).toBe(43);
  expect((await db.query('SELECT high_water FROM expertise_roster_cutover')).rows[0].high_water).toBe(43);
  expect((await db.query('SELECT count(*)::int AS n FROM expertise_roster_binding')).rows[0].n).toBe(1);
 });
 test('intent survives a lost session after beforeMutation',async()=>{
  const id=randomUUID();let intent,session;
  const env=parse(readFileSync(process.env.ROSTER_LIVE_SQL_TEST_ENV));
  const losing=createLifecycle({env,schema:fixture.schema,connect:async()=>{session=await fixture.connect();return session;}});
  await expect(losing.write(async lease=>{
   intent=await lease.beforeMutation({kind:'create',creationKey:key(id)});
   await session.end();
   await lease.beforeMutation({kind:'create',creationKey:key(id)});
  })).rejects.toMatchObject({status:503});
  const pending=(await db.query('SELECT pending FROM expertise_roster_cutover')).rows[0].pending;
  expect(pending[intent]).toEqual({kind:'create',creationKey:key(id)});
  await lifecycle.write(async lease=>{expect(await lease.complete({profileGuid:id,creationKey:key(id)})).toBe(43);});
  expect((await db.query('SELECT pending FROM expertise_roster_cutover')).rows[0].pending).toEqual({});
 });
 test('freeze rejects legacy writes without consuming the default sequence',async()=>{
  const before=(await db.query('SELECT last_value,is_called FROM expertise_roster_id_seq')).rows[0];
  for(const sql of [
   "INSERT INTO expertise_roster(name,role_type) VALUES('Synthetic frozen','Consultant')",
   "UPDATE expertise_roster SET name='Synthetic changed' WHERE id=1",
   'DELETE FROM expertise_roster WHERE id=1',
   'TRUNCATE expertise_roster, consultant_feedback',
  ]) await expect(db.query(sql)).rejects.toMatchObject({code:'55000'});
  expect((await db.query('SELECT last_value,is_called FROM expertise_roster_id_seq')).rows[0]).toEqual(before);
 });
 test('operational access to public is rejected before connecting',async()=>{
  const connect=jest.fn();const env=parse(readFileSync(process.env.ROSTER_LIVE_SQL_TEST_ENV));
  const publicLifecycle=createLifecycle({env,schema:'public',connect});
  await expect(publicLifecycle.open({operational:true})).rejects.toMatchObject({status:503});expect(connect).not.toHaveBeenCalled();
 });
});
