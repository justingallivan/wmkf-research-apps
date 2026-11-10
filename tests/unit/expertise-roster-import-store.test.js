/** @jest-environment node */
const {createStore,payload}=require('../../scripts/lib/expertise-roster-import-store.cjs');
const HOST='orgd9e66399.crm.dynamics.com',GUID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function env(){const url='postgres://roster_rehearsal:synthetic@127.0.0.1:55439/roster_rehearsal';return {EXPERTISE_ROSTER_REHEARSAL:'on',DYNAMICS_URL:'https://'+HOST,DYNAMICS_SANDBOX_URL:'https://'+HOST,DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',POSTGRES_URL:url,DATABASE_URL:url,POSTGRES_URL_NON_POOLING:url,POSTGRES_PRISMA_URL:url};}
function pgMock(){return {query:jest.fn(async sql=>{
 if(sql.includes('current_database'))return {rows:[{database:'roster_rehearsal',username:'roster_rehearsal'}]};
 if(sql.includes('pg_get_serial_sequence'))return {rows:[{name:'public.expertise_roster_id_seq'}]};
 if(sql.includes('last_value'))return {rows:[{last_value:'50'}]};
 if(sql.includes('MAX(id)'))return {rows:[{n:sql.includes('expertise_roster_identity')?500:39}]};
 if(sql.startsWith('SELECT roster_id'))return {rows:[{roster_id:500}]};
 return {rows:[]};
})};}
test.each([
 e=>{e.DYNAMICS_URL='https://wmkf.crm.dynamics.com';},e=>{e.POSTGRES_URL='postgres://user:password@remote.invalid/db';},
 e=>{e.DATABASE_URL+='different';},e=>{e.VERCEL_ENV='preview';},e=>{e.NODE_ENV='production';},e=>{e.DATAVERSE_TARGET_INTERLOCK='off';},
])('refuses unsafe bindings before I/O',mutate=>{const e=env();mutate(e);const pg=pgMock(),client={raw:jest.fn()};expect(()=>createStore({env:e,pg,client})).toThrow();expect(pg.query).not.toHaveBeenCalled();expect(client.raw).not.toHaveBeenCalled();});
test('replay with no allocation preserves bridge high-water from other identities',async()=>{
 const pg=pgMock(),s=createStore({env:env(),pg,client:{}});
 await s.bridgeTransaction(90,async bridge=>{await bridge.ensureIdentity(1);expect(await bridge.bind(null,HOST,GUID)).toBe(500);});
 expect(pg.query).toHaveBeenCalledWith("SELECT setval('expertise_roster_id_seq', $1, true)",[500]);
 expect(pg.query).toHaveBeenLastCalledWith('COMMIT');
});
test('new allocation accounts for all old and bridge high-water and inserts binding transactionally',async()=>{
 const pg=pgMock(),base=pg.query.getMockImplementation();pg.query.mockImplementation(sql=>sql.startsWith('SELECT roster_id')?Promise.resolve({rows:[]}):base(sql));
 const s=createStore({env:env(),pg,client:{}});
 await s.bridgeTransaction(90,async b=>expect(await b.bind(null,HOST,GUID)).toBe(501));
 expect(pg.query).toHaveBeenCalledWith('INSERT INTO expertise_roster_identity(id) VALUES($1)',[501]);
 expect(pg.query).toHaveBeenCalledWith('INSERT INTO expertise_roster_binding(roster_id,target_host,dataverse_profile_guid) VALUES($1,$2,$3)',[501,HOST,GUID]);
});
test('inverse-binding conflict rolls back instead of remapping',async()=>{
 const pg=pgMock(),s=createStore({env:env(),pg,client:{}});
 await expect(s.bridgeTransaction(90,b=>b.bind(1,HOST,GUID))).rejects.toThrow(/another numeric/);
 expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK');expect(pg.query.mock.calls.some(([q])=>q==='COMMIT')).toBe(false);
});
test('timed-out Dataverse operation inside bridge transaction causes rollback',async()=>{
 const client={raw:jest.fn().mockRejectedValue(new Error('timeout'))},pg=pgMock(),s=createStore({env:env(),client,pg});
 await expect(s.bridgeTransaction(90,()=>s.findByKey('app_'+GUID))).rejects.toThrow('timeout');
 expect(client.raw).toHaveBeenCalledWith('GET',expect.any(String),undefined,{}, {timeoutMs:30000});
 expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK');
});
test('create payload translates User/state and never performs a PATCH',async()=>{
 expect(payload({wmkf_staffuser:null,statecode:1})).toEqual({statecode:1,statuscode:2});
 const client={raw:jest.fn().mockResolvedValue({ok:true,body:{}})},s=createStore({env:env(),client,pg:pgMock()});
 await s.create({wmkf_staffuser:GUID,statecode:0,wmkf_creationkey:'app_'+GUID});
 expect(client.raw).toHaveBeenCalledWith('POST','/wmkf_expertiseprofiles',expect.objectContaining({'wmkf_StaffUser@odata.bind':`/systemusers(${GUID})`,statuscode:1}),{},{timeoutMs:30000});
});
test('census refuses foreign continuation before credentials can reach it',async()=>{
 const client={raw:jest.fn().mockResolvedValue({ok:true,body:{value:[],'@odata.nextLink':'https://evil.invalid/api/data/v9.2/wmkf_expertiseprofiles'}})};
 const s=createStore({env:env(),client,pg:pgMock()});await expect(s.readTarget()).rejects.toThrow(/Foreign/);expect(client.raw).toHaveBeenCalledTimes(1);
});
test('census failure is a whole-read error rather than missing profiles',async()=>{
 const client={raw:jest.fn().mockResolvedValue({ok:false,status:503})},s=createStore({env:env(),client,pg:pgMock()});await expect(s.readTarget()).rejects.toThrow(/503/);
});
test('inactive key blocks preflight before profile writes',async()=>{
 const client={raw:jest.fn().mockResolvedValueOnce({ok:true,body:{EntitySetName:'wmkf_expertiseprofiles',IsAuditEnabled:{Value:true},IsOptimisticConcurrencyEnabled:true}}).mockResolvedValueOnce({ok:true,body:{value:[{KeyAttributes:['wmkf_creationkey'],EntityKeyIndexStatus:'Pending'}]}})};
 const s=createStore({env:env(),client,pg:pgMock()});await expect(s.preflight({rows:[]})).rejects.toThrow(/not Active/);expect(client.raw.mock.calls.every(c=>c[0]==='GET')).toBe(true);
});
