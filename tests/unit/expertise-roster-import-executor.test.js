/** @jest-environment node */
const {planImport}=require('../../scripts/lib/expertise-roster-import-plan.cjs');
const {executeImport}=require('../../scripts/lib/expertise-roster-import-executor.cjs');
const original=require('../fixtures/expertise-roster/source.json');
const originalMapping=require('../fixtures/expertise-roster/mapping.json');
const HOST='orgd9e66399.crm.dynamics.com';
const USER='33333333-3333-4333-8333-333333333333';
const MUTATION='55555555-5555-4555-8555-555555555555';
function fixture(){
 const source=structuredClone(original);source.sequenceHighWater=90;
 source.rows.push({...source.rows[0],id:35,name:'Synthetic excluded placeholder'});
 const mapping=structuredClone(originalMapping);
 Object.assign(mapping.rows[0],{roleType:'Research Program Staff',staffUserGuid:USER,leadPdEligible:true});
 mapping.rows.push({legacyId:35,confirmed:true,exclude:true,active:false,leadPdEligible:false,staffUserGuid:null,contactGuid:null});
 const {id,...newRow}=source.rows[0];
 mapping.newProfiles=[{mutationId:MUTATION,row:{...newRow,name:'Synthetic staged staff',role_type:'Research Program Staff',is_active:false},decision:{confirmed:true,active:false,leadPdEligible:false,staffUserGuid:null,contactGuid:null}}];
 const target={version:1,complete:true,targetHost:HOST,profiles:[]};
 const reviewedPlan=planImport(source,target,mapping,[HOST]);
 return {source,mapping,reviewedPlan};
}
function memoryStore(){
 const profiles=new Map(),identities=new Set(),bindings=new Map();let serial=0;
 const store={targetHost:HOST,profiles,identities,bindings,
  readTarget:jest.fn(async()=>({version:1,complete:true,targetHost:HOST,profiles:[...profiles.values()]})),
  preflight:jest.fn(async()=>{}),
  findByKey:jest.fn(async key=>profiles.get(key)||null),
  create:jest.fn(async values=>{if(profiles.has(values.wmkf_creationkey))throw Error('duplicate key');profiles.set(values.wmkf_creationkey,{profileGuid:`aaaaaaaa-aaaa-4aaa-8aaa-${String(++serial).padStart(12,'0')}`,values:structuredClone(values)});}),
  bridgeTransaction:jest.fn(async(floor,work)=>{
   const ids=new Set(identities),bs=new Map(bindings);let n=Math.max(floor,...ids);
   try { await work({ensureIdentity:async id=>ids.add(id),lookup:async(id,host)=>bs.get(`${host}:${id}`)||null,
    bind:async(id,host,guid)=>{
     if(store.failBinding)throw Error('bridge unavailable');
     const inverse=[...bs].find(([key,value])=>key.startsWith(host+':')&&value===guid);
     if(inverse){const existing=Number(inverse[0].split(':')[1]);if(id!==null&&id!==existing)throw Error('inverse conflict');return existing;}
     if(id===null){id=++n;ids.add(id);}const key=`${host}:${id}`;
     if(bs.has(key)&&bs.get(key)!==guid)throw Error('binding conflict');bs.set(key,guid);return id;
    }}); } catch(error) { error.bridgeCommitted=false; error.rollbackSucceeded=true; throw error; }
   identities.clear();for(const id of ids)identities.add(id);bindings.clear();for(const [k,v]of bs)bindings.set(k,v);
   if(store.loseCommitResponse)throw Object.assign(new Error('COMMIT response lost'),{transactionPhase:'commit',bridgeCommitted:null,rollbackSucceeded:true});
  })};return store;
}
test('category override, exclusion tombstone and new-person allocation preserve source and replay identity',async()=>{
 const f=fixture(),before=structuredClone(f),s=memoryStore();
 const r=await executeImport(f,s);expect(r.success).toBe(true);expect(r.bridgeCommitted).toBe(true);
 expect(r.rows.map(x=>x.rosterId)).toEqual([1,35,91]);expect(s.identities.has(35)).toBe(true);
 expect(s.bindings.has(HOST+':35')).toBe(false);expect(s.profiles.size).toBe(2);
 expect([...s.profiles.values()][0].values).toMatchObject({wmkf_category:100000000,wmkf_staffuser:USER,wmkf_leadpdeligible:true});
 expect([...s.profiles.values()][1].values).toMatchObject({statecode:1,wmkf_staffuser:null,wmkf_leadpdeligible:false});
 expect(f).toEqual(before);
 const replay=await executeImport(f,s);expect(replay.rows.map(x=>x.rosterId)).toEqual([1,35,91]);expect(s.create).toHaveBeenCalledTimes(2);
});
test('lost create response recovers exact keyed row without duplicate create',async()=>{
 const f=fixture(),s=memoryStore(),create=s.create.getMockImplementation();
 s.create.mockImplementation(async v=>{await create(v);throw Error('response lost');});
 expect((await executeImport(f,s)).success).toBe(true);expect(s.profiles.size).toBe(2);expect(s.create).toHaveBeenCalledTimes(2);
});
test('SQL failure retains created profiles but reports no committed bridge; replay recovers',async()=>{
 const f=fixture(),s=memoryStore();s.failBinding=true;
 const failed=await executeImport(f,s);expect(failed.success).toBe(false);expect(failed.bridgeCommitted).toBe(false);
 expect(failed.failure.creationKey).toBe(f.reviewedPlan.rows[0].creationKey);expect(s.identities.size).toBe(0);expect(s.profiles.size).toBe(1);
 s.failBinding=false;expect((await executeImport(f,s)).success).toBe(true);expect(s.profiles.size).toBe(2);expect(s.create).toHaveBeenCalledTimes(2);
});
test('later failure rolls back ALL bridge rows and does not report earlier rows saved',async()=>{
 const f=fixture(),s=memoryStore(),create=s.create.getMockImplementation();
 s.create.mockImplementation(async v=>{if(v.wmkf_creationkey.startsWith('app_'))throw Error('create unavailable');return create(v);});
 const r=await executeImport(f,s);expect(r.success).toBe(false);expect(r.rows.map(x=>x.status)).toEqual(['profile-retained-bridge-unconfirmed','identity-unconfirmed','failed']);
 expect(r.rows.every(x=>x.rosterId===null)).toBe(true);expect(s.bindings.size).toBe(0);expect(s.identities.size).toBe(0);
});
test('changed source, mapping, target or absent high-water rejects before writes',async()=>{
 for(const change of [f=>f.source.rows[0].name='Changed',f=>f.mapping.rows[0].active=false,f=>f.reviewedPlan.targetHost='other',f=>{delete f.source.sequenceHighWater;f.reviewedPlan.sourceHash=require('../../scripts/lib/expertise-roster-import-plan.cjs').fingerprint(f.source);}]){
  const f=fixture(),s=memoryStore();change(f);await expect(executeImport(f,s)).rejects.toThrow();expect(s.create).not.toHaveBeenCalled();expect(s.bridgeTransaction).not.toHaveBeenCalled();
 }
});
test('intervening profile changes are refused without overwrites',async()=>{
 const f=fixture(),s=memoryStore();await executeImport(f,s);s.create.mockClear();
 [...s.profiles.values()][0].values.wmkf_name='Human edit';
 await expect(executeImport(f,s)).rejects.toThrow(/conflicts/);expect(s.create).not.toHaveBeenCalled();
});
test('binding conflict refuses profile creation; other target binding stays independent',async()=>{
 const f=fixture(),s=memoryStore();s.bindings.set(HOST+':1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 expect((await executeImport(f,s)).success).toBe(false);expect(s.create).not.toHaveBeenCalled();
 s.bindings.clear();s.bindings.set('wmkf.crm.dynamics.com:1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 expect((await executeImport(f,s)).success).toBe(true);expect(s.bindings.get('wmkf.crm.dynamics.com:1')).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
});
test('exclusion cannot silently remove an existing target profile or binding',async()=>{
 const f=fixture(),s=memoryStore();s.bindings.set(HOST+':35','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 const r=await executeImport(f,s);expect(r.success).toBe(false);expect(s.bindings.get(HOST+':35')).toBeTruthy();
 const excluded=f.reviewedPlan.rows.find(r=>r.legacyId===35);s.profiles.set(excluded.creationKey,{profileGuid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',values:excluded.values});
 await expect(executeImport(f,s)).rejects.toThrow(/conflicts/);
});
test('new staging cannot supply a numeric ID or reuse a mutation UUID',()=>{
 const f=fixture(),target={version:1,complete:true,targetHost:HOST,profiles:[]};
 f.mapping.newProfiles[0].row.id=99;expect(()=>planImport(f.source,target,f.mapping,[HOST])).toThrow(/guessed/);
 delete f.mapping.newProfiles[0].row.id;f.mapping.newProfiles.push(f.mapping.newProfiles[0]);expect(()=>planImport(f.source,target,f.mapping,[HOST])).toThrow(/duplicate/);
});
test('tampered reviewed values or identities cannot execute under unchanged input hashes',async()=>{
 for(const change of [r=>r.values.wmkf_name='Reviewed different person',r=>r.legacyId=99,r=>r.creationKey='app_'+MUTATION]){
  const f=fixture(),s=memoryStore();change(f.reviewedPlan.rows[0]);await expect(executeImport(f,s)).rejects.toThrow(/payload changed/);expect(s.create).not.toHaveBeenCalled();
 }
});
test('caller mutation during an awaited census cannot change the captured import',async()=>{
 const f=fixture(),s=memoryStore();let release;
 s.readTarget.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const running=executeImport(f,s);f.source.rows[0].name='Mutated after start';f.mapping.rows[0].active=false;
 release({version:1,complete:true,targetHost:HOST,profiles:[]});
 expect((await running).success).toBe(true);
 expect([...s.profiles.values()][0].values.wmkf_name).toBe(original.rows[0].name);
 expect([...s.profiles.values()][0].values.statecode).toBe(0);
});
test('new target duplicate-name warning requires renewed review',async()=>{
 const f=fixture(),s=memoryStore();s.profiles.set('direct_other',{profileGuid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',values:{wmkf_creationkey:'direct_other',wmkf_name:f.source.rows[0].name,wmkf_contactguid:null,wmkf_staffuser:null}});
 await expect(executeImport(f,s)).rejects.toThrow(/warnings changed/);expect(s.create).not.toHaveBeenCalled();
});
test('changed sequence high-water alone fails the input-hash guard',async()=>{
 const f=fixture(),s=memoryStore();f.source.sequenceHighWater++;
 await expect(executeImport(f,s)).rejects.toThrow('Reviewed inputs changed');
 expect(s.readTarget).not.toHaveBeenCalled();expect(s.create).not.toHaveBeenCalled();
});
test('competing create with different values is recorded and never bound or overwritten',async()=>{
 const f=fixture(),s=memoryStore(),create=s.create.getMockImplementation();
 s.create.mockImplementation(async values=>{await create({...values,wmkf_name:'Competing profile values'});throw Error('duplicate key');});
 const r=await executeImport(f,s);
 expect(r).toMatchObject({success:false,bridgeCommitted:false,rollbackSucceeded:true,failure:{phase:'rows',creationKey:f.reviewedPlan.rows[0].creationKey,message:expect.stringContaining('differs at wmkf_name')}});
 expect(r.rows).toHaveLength(1);expect(r.rows[0]).toMatchObject({status:'failed',createAttempted:true,profileOutcome:'observed',profileGuid:expect.any(String),rosterId:null});
 expect(s.bindings.size).toBe(0);expect(s.create).toHaveBeenCalledTimes(1);
 expect([...s.profiles.values()][0].values.wmkf_name).toBe('Competing profile values');
 await expect(executeImport(f,s)).rejects.toThrow(/conflicts/);
});
test('a failed create with unavailable readback has unknown profile outcome',async()=>{
 const f=fixture(),s=memoryStore();s.create.mockRejectedValue(new Error('create timed out'));
 s.findByKey.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('readback timed out'));
 const r=await executeImport(f,s);
 expect(r.rows[0]).toMatchObject({status:'failed',createAttempted:true,profileOutcome:'unknown',rosterId:null});
 expect(r.failure.creationKey).toBe(f.reviewedPlan.rows[0].creationKey);
});
test('failure before create is distinguishable from uncertain create',async()=>{
 const f=fixture(),s=memoryStore();s.findByKey.mockRejectedValue(new Error('initial read failed'));
 const r=await executeImport(f,s);
 expect(r.rows[0]).toMatchObject({status:'failed',createAttempted:false,profileOutcome:'not-checked'});
 expect(s.create).not.toHaveBeenCalled();
});
test('lost COMMIT response is transaction-level unknown, even when data committed; replay resolves it',async()=>{
 const f=fixture(),s=memoryStore();s.loseCommitResponse=true;
 const r=await executeImport(f,s);
 expect(r).toMatchObject({version:2,success:false,bridgeCommitted:null,rollbackSucceeded:true,failure:{phase:'commit',creationKey:null}});
 expect(r.rows.every(row=>row.rosterId===null)).toBe(true);expect(s.bindings.size).toBe(2);
 s.loseCommitResponse=false;const replay=await executeImport(f,s);
 expect(replay).toMatchObject({success:true,bridgeCommitted:true});expect(replay.rows.map(row=>row.rosterId)).toEqual([1,35,91]);
 expect(s.create).toHaveBeenCalledTimes(2);
});
test('sequence advancement failure is transaction-level, not attributed to last row',async()=>{
 const f=fixture(),s=memoryStore(),tx=s.bridgeTransaction.getMockImplementation();
 s.bridgeTransaction.mockImplementation((floor,work)=>tx(floor,async b=>{await work(b);throw Object.assign(new Error('setval failed'),{transactionPhase:'sequence'});}));
 const r=await executeImport(f,s);
 expect(r).toMatchObject({bridgeCommitted:false,failure:{phase:'sequence',creationKey:null,message:'setval failed'}});
 expect(s.bindings.size).toBe(0);expect(r.rows).toHaveLength(3);
});
test('identity reservation failure names the unattempted row',async()=>{
 const f=fixture(),s=memoryStore();
 s.bridgeTransaction.mockImplementation(async(_floor,work)=>{try{await work({ensureIdentity:async()=>{throw Error('reserve failed');}});}catch(e){e.bridgeCommitted=false;throw e;}});
 const r=await executeImport(f,s);
 expect(r.failure).toMatchObject({phase:'reserve-identities',creationKey:f.reviewedPlan.rows[0].creationKey});
 expect(r.rows[0]).toMatchObject({status:'failed',createAttempted:false,profileOutcome:'not-checked'});
});

test('retained normalized new profile binds and replays without create or source mutation',async()=>{
 const f=fixture(),s=memoryStore();f.mapping.newProfiles[0].row.role='';
 f.source.rows[0].keywords='';
 const before={source:structuredClone(f.source),mapping:structuredClone(f.mapping)};
 f.reviewedPlan=planImport(f.source,await s.readTarget(),f.mapping,[HOST]);
 for(const row of f.reviewedPlan.rows.filter(r=>r.action!=='exclude'))await s.create(row.values);
 s.create.mockClear();
 f.reviewedPlan=JSON.parse(JSON.stringify(planImport(f.source,await s.readTarget(),f.mapping,[HOST])));
 expect(f.reviewedPlan.rows[2].action).toBe('unchanged');
 const r=await executeImport(f,s);expect(r.success).toBe(true);expect(r.textPolicy).toBe('empty-string-to-null-v1');
 expect(r.rows[0].normalizedEmptyFields).toEqual(['keywords']);expect(r.rows[2].normalizedEmptyFields).toEqual(['role']);
 expect(r.rows[2]).toMatchObject({createAttempted:false,profileOutcome:'observed',rosterId:91});
 expect(s.create).not.toHaveBeenCalled();expect(f.source).toEqual(before.source);expect(f.mapping).toEqual(before.mapping);
 expect((await executeImport(f,s)).rows.map(r=>r.rosterId)).toEqual([1,35,91]);expect(s.create).not.toHaveBeenCalled();
});
test('old or unknown text policy refuses before target I/O',async()=>{
 for(const policy of [undefined,'future-policy']){const f=fixture(),s=memoryStore();f.reviewedPlan.textPolicy=policy;
 await expect(executeImport(f,s)).rejects.toThrow('Text policy changed; review a fresh plan');expect(s.readTarget).not.toHaveBeenCalled();}
});
test('normalization evidence tampering fails reviewed projection guard',async()=>{
 const f=fixture(),s=memoryStore();f.reviewedPlan.rows[0].normalizedEmptyFields=['role'];
 await expect(executeImport(f,s)).rejects.toThrow('Reviewed execution payload changed');expect(s.bridgeTransaction).not.toHaveBeenCalled();
});
test('raw empty-to-null input edits still fail the hash guard',async()=>{
 const f=fixture(),s=memoryStore();f.mapping.newProfiles[0].row.role='';
 f.reviewedPlan=planImport(f.source,await s.readTarget(),f.mapping,[HOST]);s.readTarget.mockClear();
 f.mapping.newProfiles[0].row.role=null;
 await expect(executeImport(f,s)).rejects.toThrow('Reviewed inputs changed');expect(s.readTarget).not.toHaveBeenCalled();
});
test('stale empty payload cannot execute merely by adding the new policy marker',async()=>{
 const f=fixture(),s=memoryStore();f.mapping.newProfiles[0].row.role='';
 f.reviewedPlan=planImport(f.source,await s.readTarget(),f.mapping,[HOST]);f.reviewedPlan.rows[2].values.wmkf_role='';
 await expect(executeImport(f,s)).rejects.toThrow('Reviewed execution payload changed');expect(s.bridgeTransaction).not.toHaveBeenCalled();
});

test('policy marker without normalization metadata still refuses execution',async()=>{
 const f=fixture(),s=memoryStore();delete f.reviewedPlan.rows[0].normalizedEmptyFields;
 await expect(executeImport(f,s)).rejects.toThrow('Reviewed execution payload changed');expect(s.bridgeTransaction).not.toHaveBeenCalled();
});
