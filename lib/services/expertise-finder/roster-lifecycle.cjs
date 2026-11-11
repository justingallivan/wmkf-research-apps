/** Rehearsal-only write admission and numeric identity allocation.
 * No Production cutover path. Dedicated Client avoids starving consumer SQL pool.
 * Uncertain remote writes retain durable intents; phase operations must refuse them.
 */
const {randomUUID}=require('node:crypto');
const {Client}=require('pg');
const target=require('./roster-rehearsal-target.cjs');
const contract=require('./roster-contract.cjs');
const CONTROL='expertise_roster_cutover';
const SCHEMA=/^roster_rehearsal_[0-9a-f]{32}$/;
const PHASES=['prepared','active','paused','legacy'];
const FREEZE_BODY="BEGIN RAISE EXCEPTION 'Legacy roster is frozen for rehearsal' USING ERRCODE='55000'; END;";
const CONTROL_DDL=`CREATE TABLE expertise_roster_cutover (
 target_host TEXT PRIMARY KEY,
 phase TEXT NOT NULL CHECK (phase IN ('prepared','active','paused','legacy')),
 generation UUID NOT NULL,
 baseline_hash TEXT NOT NULL CHECK (baseline_hash ~ '^[0-9a-f]{64}$'),
 high_water INTEGER NOT NULL CHECK (high_water >= 0),
 pending JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(pending)='object')
)`;
function fail(message='Roster reconciliation is unavailable. Retry with the same creation identity.'){
 return Object.assign(new Error(message),{status:503,code:'roster_reconciliation_required'});
}
function check(ok,message){if(!ok)throw fail(message);}
function assertOperationalSchema(schema){check(SCHEMA.test(schema),'Operational phases require a disposable rehearsal schema; public is refused.');}
function creationKey(key){return typeof key==='string'&&(/^(app|direct)_[0-9a-f-]{36}$/.test(key)&&contract.guid(key.slice(key.indexOf('_')+1))||/^legacy_[0-9a-f-]{36}_[1-9][0-9]*$/.test(key)&&contract.guid(key.slice(7,43)));}
function validateState(row,host){
 check(row&&row.target_host===host&&PHASES.includes(row.phase)&&contract.guid(row.generation)&&/^[0-9a-f]{64}$/.test(row.baseline_hash)&&Number.isSafeInteger(row.high_water)&&row.high_water>=0,'Invalid roster lifecycle state.');
 check(row.pending&&typeof row.pending==='object'&&!Array.isArray(row.pending)&&Object.keys(row.pending).length<=256,'Invalid pending roster intents.');
 for(const [id,p] of Object.entries(row.pending)){
  check(contract.guid(id)&&p&&['create','update'].includes(p.kind),'Invalid pending roster intent.');
  if(p.kind==='create')check(/^app_/.test(p.creationKey)&&creationKey(p.creationKey),'Invalid pending creation identity.');
  else check(contract.guid(p.profileGuid)&&/^W\/"\d+"$/.test(p.etag)&&p.etag.length<=100,'Invalid pending update identity.');
 }
 return row;
}
async function verifyNamespace(client,schema){
 check(schema==='public'||SCHEMA.test(schema),'Invalid rehearsal namespace.');
 const identity=(await client.query('SELECT current_database() AS database,current_user AS username')).rows[0];
 check(identity?.database==='roster_rehearsal'&&identity.username==='roster_rehearsal','Connected rehearsal identity mismatch.');
 const ns=(await client.query('SELECT oid::text AS oid,nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
 check(ns&&(schema==='public'||ns.owned),'Rehearsal namespace is absent or not owned.');
 await client.query(`SET search_path TO "${schema}"`);
 const current=(await client.query('SELECT current_schema() AS name,current_schemas(false)::text[] AS path')).rows[0];
 check(current.name===schema&&current.path.length===1&&current.path[0]===schema,'Rehearsal namespace mismatch.');
 const relations=(await client.query("SELECT x.name,c.relnamespace::text AS namespace,c.relkind FROM unnest($1::text[]) x(name) LEFT JOIN pg_class c ON c.oid=to_regclass(x.name)",[['expertise_roster','expertise_roster_identity','expertise_roster_binding','consultant_feedback']])).rows;
 check(relations.length===4&&relations.every(r=>r.namespace===ns.oid&&r.relkind==='r'),'Rehearsal relations must be local tables.');
 return ns.oid;
}
async function readState(client,host,{lock=false}={}){
 const found=(await client.query("SELECT to_regclass('expertise_roster_cutover')::text AS name")).rows[0];
 check(found&&Object.hasOwn(found,'name'),'Lifecycle presence check failed.');
 if(!found.name){
  const residue=(await client.query("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('expertise_roster') AND tgname IN ('expertise_roster_freeze_dml','expertise_roster_freeze_truncate')) OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('consultant_feedback') AND confrelid=to_regclass('expertise_roster_identity') AND contype='f') AS present")).rows[0];
  check(residue?.present===false,'Missing lifecycle state with cutover residue.');return null;
 }
 const metadata=(await client.query("SELECT relkind,relnamespace=current_schema()::regnamespace AS local FROM pg_class WHERE oid='expertise_roster_cutover'::regclass")).rows[0];
 check(metadata?.relkind==='r'&&metadata.local,'Lifecycle state must be a local table.');
 const rows=(await client.query(`SELECT * FROM expertise_roster_cutover${lock?' FOR UPDATE':''}`)).rows;
 check(rows.length===1,'Lifecycle state must contain exactly one target.');return validateState(rows[0],host);
}
async function verifyFreeze(client){
 const rows=(await client.query("SELECT t.tgname,t.tgenabled,t.tgtype,t.tgnargs,t.tgqual IS NULL AS unconditional,p.prosrc,n.nspname AS namespace FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='expertise_roster'::regclass AND NOT t.tgisinternal ORDER BY t.tgname")).rows;
 check(rows.length===2,'Legacy roster freeze is missing or has unexpected triggers.');
 const expected={expertise_roster_freeze_dml:30,expertise_roster_freeze_truncate:34};
 const ns=(await client.query('SELECT current_schema() AS name')).rows[0].name;
 check(rows.every(r=>expected[r.tgname]===r.tgtype&&r.tgenabled==='O'&&r.tgnargs===0&&r.unconditional&&r.prosrc===FREEZE_BODY&&r.namespace===ns),'Legacy roster freeze definition differs.');
}
async function installFreeze(client){
 check(!(await client.query("SELECT 1 FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname='roster_rehearsal_frozen'")).rowCount,'Freeze function already exists.');
 check(!(await client.query("SELECT 1 FROM pg_trigger WHERE tgrelid='expertise_roster'::regclass AND NOT tgisinternal")).rowCount,'Unexpected legacy roster triggers.');
 await client.query(`CREATE FUNCTION roster_rehearsal_frozen() RETURNS trigger LANGUAGE plpgsql AS $body$${FREEZE_BODY}$body$`);
 await client.query('CREATE TRIGGER expertise_roster_freeze_dml BEFORE INSERT OR UPDATE OR DELETE ON expertise_roster FOR EACH STATEMENT EXECUTE FUNCTION roster_rehearsal_frozen()');
 await client.query('CREATE TRIGGER expertise_roster_freeze_truncate BEFORE TRUNCATE ON expertise_roster FOR EACH STATEMENT EXECUTE FUNCTION roster_rehearsal_frozen()');
 await verifyFreeze(client);
}
async function removeFreeze(client){await verifyFreeze(client);await client.query('DROP TRIGGER expertise_roster_freeze_dml ON expertise_roster');await client.query('DROP TRIGGER expertise_roster_freeze_truncate ON expertise_roster');await client.query('DROP FUNCTION roster_rehearsal_frozen()');}
function definiteRejection(error){return error?.serviceName==='dataverse'&&error.noResponse!==true&&error.isTransient!==true&&[400,401,403,404,409,412,422].includes(error.status);}
function createLifecycle({env=process.env,schema='public',connect}={}){
 const {host,connectionString}=target.assertTarget(env);
 check(schema==='public'||SCHEMA.test(schema),'Invalid rehearsal namespace.');
 async function open({exclusive=false,operational=false}={}){
  if(operational)assertOperationalSchema(schema); // Before connecting or locking.
  check(target.assertTarget(env).connectionString===connectionString,'Rehearsal connection configuration changed.');
  let client,lost=false,key,locked=false;
  try{
   if(connect)client=await connect();else{client=new Client({connectionString,connectionTimeoutMillis:5000,query_timeout:35000});await client.connect();}
   client.on('error',()=>{lost=true;});
   const oid=await verifyNamespace(client,schema);
   key=((0x574d4b46n<<32n)|BigInt(oid)).toString();
   await client.query("SET lock_timeout='5s'");await client.query("SET statement_timeout='30s'");
   await client.query(`SELECT pg_advisory_lock${exclusive?'':'_shared'}($1::bigint)`,[key]);locked=true;
   return {client,host,schema,key,alive:()=>check(!lost,'Roster lifecycle connection was lost.'),async close(){try{if(locked&&!lost)await client.query(`SELECT pg_advisory_unlock${exclusive?'':'_shared'}($1::bigint)`,[key]);}finally{await client.end();}}};
  }catch(error){if(client)await client.end().catch(()=>{});throw error?.status===503?error:fail();}
 }
 async function write(work){
  const session=await open();const {client}=session;
  try{
   const state=await readState(client,host);
   if(state){check(state.phase==='active','Roster editing is paused for reconciliation.');await verifyFreeze(client);}
   const generation=state?.generation;
   async function query(text,values){session.alive();try{return await client.query(text,values);}catch{throw fail();}}
   const lease={
    active:Boolean(state),
    async beforeMutation(intent){
     if(!state)return null;
     const id=randomUUID();validateState({...state,pending:{[id]:intent}},host);
     const r=await query("UPDATE expertise_roster_cutover SET pending=pending || jsonb_build_object($1::text,$2::jsonb) WHERE target_host=$3 AND generation=$4 AND phase='active' AND (SELECT count(*) FROM jsonb_object_keys(pending))<256 RETURNING target_host",[id,JSON.stringify(intent),host,generation]);
     check(r.rowCount===1,'Could not record roster write intent.');return id;
    },
    async rejectMutation(id,error){
     if(!id||!definiteRejection(error))return false;
     try{const r=await query("UPDATE expertise_roster_cutover SET pending=pending-$1::text WHERE target_host=$2 AND generation=$3 AND phase='active' AND pending ? $1 RETURNING target_host",[id,host,generation]);return r.rowCount===1;}catch{return false;}
    },
    async complete({profileGuid,creationKey:trustedKey,attemptId=null}){
     if(!state){await query('SELECT 1');return null;}
     check(contract.guid(profileGuid)&&creationKey(trustedKey),'Profile creation identity needs reconciliation before numeric use.');
     let begun=false;
     try{
      await query('BEGIN');begun=true;
      const current=await readState(client,host,{lock:true});check(current?.phase==='active'&&current.generation===generation,'Roster lifecycle changed during save.');
      let binding=(await query('SELECT roster_id FROM expertise_roster_binding WHERE target_host=$1 AND dataverse_profile_guid=$2',[host,profileGuid])).rows[0];
      let high=current.high_water;
      if(!binding){
       check(high<2147483647,'Roster numeric identity space is exhausted.');high++;
       await query('INSERT INTO expertise_roster_identity(id) VALUES($1)',[high]);
       await query('INSERT INTO expertise_roster_binding(roster_id,target_host,dataverse_profile_guid) VALUES($1,$2,$3)',[high,host,profileGuid]);binding={roster_id:high};
      }
      const remove=Object.entries(current.pending).filter(([id,p])=>id===attemptId||(p.kind==='create'&&p.creationKey===trustedKey)).map(([id])=>id);
      const r=await query("UPDATE expertise_roster_cutover SET high_water=$1,pending=pending-$2::text[] WHERE target_host=$3 AND generation=$4 AND phase='active' RETURNING target_host",[high,remove,host,generation]);check(r.rowCount===1,'Roster binding state changed.');
      await query('COMMIT');begun=false;return binding.roster_id;
     }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error?.status===503?error:fail();}
    },
   };
   return await work(lease);
  }finally{await session.close().catch(()=>{});}
 }
 return {open,write,host,schema};
}
function withRosterWrite(work){return createLifecycle().write(work);}
module.exports={creationKey,createLifecycle,withRosterWrite,readState,validateState,verifyNamespace,verifyFreeze,installFreeze,removeFreeze,assertOperationalSchema,definiteRejection,CONTROL_DDL,CONTROL,SCHEMA,FREEZE_BODY,fail,check};
