#!/usr/bin/env node
'use strict';
/** Owner-authorized bounded rehearsal: fresh database only, on the tracked non-production test endpoint.
 * Never reads or writes the production database. No provider calls or email dispatch.
 * Usage: node scripts/prepare-meeting-hosted-rehearsal.cjs <dedicated-preview-env> <operator-env-output> --execute
 */
const fs=require('node:fs');const {parseEnv}=require('node:util');const {Client}=require('pg');
const {bootstrapFreshDatabase}=require('./lib/fresh-database-bootstrap');const {getBootstrapGroups}=require('./setup-database');
const HOST='ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech',DATABASE='meeting_coord_rehearsal_20261023';
// Profile 1 is reserved/skipped by the normal Dataverse identity map.
const AZURE_ID='893369cc-1925-40ec-bbc6-6f12b0684a31';
async function main(){
 if(process.argv[4]!=='--execute')throw Error('explicit_execute_required');
 const env=parseEnv(fs.readFileSync(process.argv[2],'utf8'));const url=new URL(env.POSTGRES_URL);
 if(url.hostname!==HOST||url.pathname!=='/neondb'||!url.username||!url.password||[...url.searchParams.keys()].some(k=>!['sslmode','channel_binding'].includes(k)))throw Error('isolated_database_target_mismatch');
 url.searchParams.set('sslmode','verify-full');
 const admin=new Client({connectionString:url.toString(),connectionTimeoutMillis:10000,query_timeout:30000});await admin.connect();let actor;
 try{const rows=await admin.query('SELECT name,display_name,azure_id,azure_email,is_active,needs_linking FROM user_profiles WHERE azure_id=$1 AND is_active=true',[AZURE_ID]);if(rows.rowCount!==1||rows.rows[0].needs_linking!==false)throw Error('existing_owner_identity_unverified');actor=rows.rows[0];if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[DATABASE])).rowCount)throw Error('rehearsal_database_already_exists');await admin.query(`CREATE DATABASE ${DATABASE}`);}finally{await admin.end();}
 url.pathname=`/${DATABASE}`;fs.writeFileSync(process.argv[3],`POSTGRES_URL=${JSON.stringify(url.toString())}\nDATABASE_URL=${JSON.stringify(url.toString())}\n`,{mode:0o600});
 console.log(JSON.stringify({createdDatabase:DATABASE,isolatedHost:HOST,recoveryEnvironmentPersisted:true}));
 const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:10000,query_timeout:30000});await client.connect();
 try{await bootstrapFreshDatabase(client,getBootstrapGroups());await client.query('BEGIN');const r=await client.query('INSERT INTO user_profiles(id,name,display_name,azure_id,azure_email,is_active,needs_linking) VALUES(2,$1,$2,$3,$4,true,false) RETURNING id',[actor.name,actor.display_name,actor.azure_id,actor.azure_email]);await client.query("INSERT INTO dynamics_user_roles(user_profile_id,role) VALUES($1,'superuser')",[r.rows[0].id]);await client.query("SELECT setval(pg_get_serial_sequence('user_profiles','id'),2)");await client.query('COMMIT');console.log(JSON.stringify({bootstrapComplete:true,ownerProfileId:r.rows[0].id,migrationCount:Number((await client.query('SELECT count(*) AS count FROM schema_migrations')).rows[0].count)}));}finally{await client.end();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({code:error.code||error.message||error.name}));process.exitCode=1;});
