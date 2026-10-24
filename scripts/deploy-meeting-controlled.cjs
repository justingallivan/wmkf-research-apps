#!/usr/bin/env node
/** One-release production migration operator. Credentials stay in a protected caller-supplied file; no environment dump. */
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),{Client}=require('pg');
const EXPECTED=['086_meeting_presentation_editions.sql','087_meeting_material_preparations.sql','088_meeting_presentation_invitations.sql','089_manual_presentation_video_pairs.sql'];
async function main(){
 const env=JSON.parse(fs.readFileSync(process.argv[2])),url=new URL(env.POSTGRES_URL);
 if(url.hostname!=='ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech'||url.pathname!=='/neondb')throw Error('production_database_identity_mismatch');
 const db=new Client({connectionString:env.POSTGRES_URL});await db.connect();
 try{
 const tracked=(await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r=>r.name);
 const files=fs.readdirSync(path.join(__dirname,'../lib/db/migrations')).filter(f=>f.endsWith('.sql')).sort();
 const pending=files.filter(f=>!tracked.includes(f));
 if(tracked.some(f=>!files.includes(f))||pending.some(f=>!EXPECTED.includes(f)))throw Error('unexpected_migration_allocation');
 console.log(JSON.stringify({phase:'preflight',pending}));
 if(process.argv.includes('--apply')){
  const p=spawnSync(process.execPath,[path.join(__dirname,'apply-migrations.js')],{env:{...process.env,POSTGRES_URL:env.POSTGRES_URL,DATABASE_URL:env.POSTGRES_URL,APPLY_MIGRATIONS_APPLIED_BY:'owner-approved-meeting-controlled-2026-10-24'},stdio:'inherit'});if(p.status!==0)throw Error('migration_runner_failed');
 }
 const names=['meeting_presentation_visibility','meeting_presentation_editions','meeting_material_preparations','meeting_material_preparation_steps','meeting_presentation_invitations','manual_presentation_video_pairs'];
 const tables=(await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1)',[names])).rows.map(r=>r.table_name);
 const rows=(await db.query('SELECT name FROM schema_migrations WHERE name=ANY($1) ORDER BY name',[EXPECTED])).rows;
 const columns=(await db.query("SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE (table_name='presentation_video_splits' AND column_name IN ('manual_pairing_id','source_copy_id')) OR (table_name='meeting_transcript_summary_drafts' AND column_name IN ('generation_outcome','preparation_id','acknowledged_at')) ORDER BY table_name,column_name")).rows;
 const constraints=(await db.query("SELECT conname,convalidated FROM pg_constraint WHERE conname IN ('presentation_visibility_request_edition','presentation_video_source_kind','summary_acknowledgment_truthful_shape') ORDER BY conname")).rows;
 const verified=tables.length===6&&rows.length===4&&columns.length===5&&constraints.length===3&&constraints.every(r=>r.convalidated);
 console.log(JSON.stringify({phase:'schema_readback',verified,tables,tracked:rows,columns,constraints}));
 if(process.argv.includes('--apply')&&!verified)throw Error('physical_schema_not_verified');
 }finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
