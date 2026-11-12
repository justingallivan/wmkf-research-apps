/** @jest-environment node */
import {activeMachinePilot,machineAuthPolicy,machineDatabaseEndpoint,machinePilotScope,matchesMachinePilotScope,readMachinePilotPolicy} from '../../lib/services/prompt-jobs/machine-pilot-policy.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='b'.repeat(64),now=Date.parse('2026-11-12T12:00:00Z');
function config(){return {enabled:true,pilotId:id,requestId:id,sourceEventId:id,tenantId:id,audience:id,clientId:id,servicePrincipalId:id,role:'PromptJobs.Execute',promptId:id,promptVersion:1,promptHash:hash,profileHash:hash,databaseIdentity:hash,databaseEndpoint:'db.example:5432',expiresAt:new Date(now+86400000).toISOString()};}
function env(value=config()){return {PROMPT_JOB_MACHINE_PILOT:JSON.stringify(value),DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',PROMPT_JOB_NONCE_SECRET:'x'.repeat(32),POSTGRES_URL:'postgres://synthetic:secret@db.example/fixture',NODE_ENV:'test'};}
const read=(e=env(),deployment='test')=>readMachinePilotPolicy(e,deployment);
test('unset configuration is disabled by default',()=>{expect(readMachinePilotPolicy({},'test')).toBeNull();expect(machineAuthPolicy(null)).toBeNull();});
test.each(['local','preview','test'])('valid %s sandbox returns canonical frozen scope without secrets',deployment=>{
 const e=env({...config(),clientId:id.toUpperCase()});const policy=read(e,deployment);
 expect(policy).toMatchObject({environment:`${deployment}-sandbox`,targetHost:'orgd9e66399.crm.dynamics.com',clientId:id,authorizationScope:`pa-short-title:${id}`,principalKey:`app:entra-v2:${id}:${id}:${id}`});
 expect(Object.isFrozen(policy)).toBe(true);expect(JSON.stringify(policy)).not.toContain(e.POSTGRES_URL);expect(JSON.stringify(policy)).not.toContain(e.PROMPT_JOB_NONCE_SECRET);
});
test.each([
 ['invalid JSON',e=>{e.PROMPT_JOB_MACHINE_PILOT='{';}],['extra field',e=>{const c=config();c.extra=true;e.PROMPT_JOB_MACHINE_PILOT=JSON.stringify(c);}],
 ['missing field',e=>{const c=config();delete c.role;e.PROMPT_JOB_MACHINE_PILOT=JSON.stringify(c);}],['invalid GUID',e=>{const c=config();c.requestId=' '+id;e.PROMPT_JOB_MACHINE_PILOT=JSON.stringify(c);}],
 ['invalid hash',e=>{const c=config();c.profileHash='z'.repeat(64);e.PROMPT_JOB_MACHINE_PILOT=JSON.stringify(c);}],['invalid version',e=>{const c=config();c.promptVersion=0;e.PROMPT_JOB_MACHINE_PILOT=JSON.stringify(c);}],
 ['invalid role',e=>{const c=config();c.role='bad role';e.PROMPT_JOB_MACHINE_PILOT=JSON.stringify(c);}],['invalid expiry',e=>{const c=config();c.expiresAt='not a date';e.PROMPT_JOB_MACHINE_PILOT=JSON.stringify(c);}],
 ['short nonce',e=>{e.PROMPT_JOB_NONCE_SECRET='short';}],['interlock off',e=>{e.DATAVERSE_TARGET_INTERLOCK='off';}],['DAL off',e=>{e.DATAVERSE_DAL_ENFORCEMENT='off';}],
 ['production target',e=>{e.DYNAMICS_URL='https://wmkf.crm.dynamics.com';}],['unknown target',e=>{e.DYNAMICS_URL='https://unknown.crm.dynamics.com';}],
 ['different database host',e=>{e.POSTGRES_URL='postgres://synthetic:secret@other.example/fixture';}],['different database port',e=>{e.POSTGRES_URL='postgres://synthetic:secret@db.example:5555/fixture';}],
])('%s configuration fails closed',(_name,mutate)=>{const e=env();mutate(e);expect(()=>read(e)).toThrow(expect.objectContaining({code:'machine_pilot_configuration',httpStatus:503}));});
test('production deployment and local production runtime refuse configuration',()=>{
 expect(()=>read(env(),'production')).toThrow(expect.objectContaining({code:'machine_pilot_configuration'}));
 expect(()=>read({...env(),NODE_ENV:'production'},'local')).toThrow(expect.objectContaining({code:'machine_pilot_configuration'}));
});
test.each([
 'http://orgd9e66399.crm.dynamics.com', 'https://user@orgd9e66399.crm.dynamics.com',
 'https://orgd9e66399.crm.dynamics.com:444', 'https://orgd9e66399.crm.dynamics.com/path',
 'https://orgd9e66399.crm.dynamics.com/?x=1', 'https://orgd9e66399.crm.dynamics.com/#fragment',
])('non-origin Dataverse target %s refuses',url=>{
 expect(()=>read({...env(),DYNAMICS_URL:url})).toThrow(expect.objectContaining({code:'machine_pilot_configuration'}));
});
test('endpoint uses actual normalized host and default or explicit port',()=>{
 expect(machineDatabaseEndpoint('postgresql://user:password@DB.EXAMPLE/db')).toBe('db.example:5432');expect(machineDatabaseEndpoint('postgres://user:password@db.example:5444/db')).toBe('db.example:5444');
 expect(()=>machineDatabaseEndpoint('https://db.example/db')).toThrow(expect.objectContaining({code:'machine_pilot_configuration'}));
});
test.each(['host=other.example','port=5555','dbname=other','db=other','options=-c%20search_path%3Dpublic','sslmode=disable','sslmode=require&sslmode=verify-full','sslmode=require&host=other.example'])('database query override %s is refused',query=>{
 expect(()=>machineDatabaseEndpoint(`postgres://user:password@db.example/fixture?${query}`)).toThrow(expect.objectContaining({code:'machine_pilot_configuration'}));
});
test.each(['require','verify-full'])('explicit sslmode %s is accepted',mode=>{
 expect(machineDatabaseEndpoint(`postgres://user:password@db.example/fixture?sslmode=${mode}`)).toBe('db.example:5432');
});
test.each(['#fragment','#'])('database URL fragment %s is refused',fragment=>{
 expect(()=>machineDatabaseEndpoint(`postgres://user:password@db.example/fixture${fragment}`)).toThrow(expect.objectContaining({code:'machine_pilot_configuration'}));
});
test('expired, disabled, invalid and overlong windows do not authorize actions',()=>{
 const p=read();expect(activeMachinePilot(p,now)).toBe(true);expect(activeMachinePilot({...p,enabled:false},now)).toBe(false);
 for(const expiry of [new Date(now).toISOString(),new Date(now-1).toISOString(),new Date(now+7*86400000+1).toISOString(),'bad'])expect(activeMachinePilot({...p,expiresAt:expiry},now)).toBe(false);
 expect(activeMachinePilot(p,NaN)).toBe(false);
});
test('scope and auth projections contain only exact pinned fields',()=>{
 const p=read(env({...config(),expiresAt:new Date(Date.now()+86400000).toISOString()}));const scope=machinePilotScope(p);
 expect(scope).toEqual({environment:'test-sandbox',principalKey:`app:entra-v2:${id}:${id}:${id}`,authorizationScope:`pa-short-title:${id}`,requestId:id});
 expect(matchesMachinePilotScope(scope,p)).toBe(true);
 for(const key of Object.keys(scope))expect(matchesMachinePilotScope({...scope,[key]:'other'},p)).toBe(false);
 expect(machineAuthPolicy(p)).toEqual({enabled:true,tenantId:id,audience:id,clientId:id,servicePrincipalId:id,role:'PromptJobs.Execute'});
 expect(machineAuthPolicy({...p,enabled:false})).toBeNull();
});
