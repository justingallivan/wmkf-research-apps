#!/usr/bin/env node
/** Synthetic-only isolated Postgres fixture. Refuses non-loopback connections,
 * mismatched aliases, wrong DB/user and any existing public table. No env mutation.
 * Usage: node scripts/prepare-roster-rehearsal.cjs PRIVATE_REHEARSAL_ENV
 */
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');
async function main(){
 const [file,...extra]=process.argv.slice(2);if(!file||extra.length)throw Error('One explicit rehearsal env required');
 const env=require('dotenv').parse(fs.readFileSync(file));
 const aliases=['POSTGRES_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL','DATABASE_URL'];
 const raw=env.POSTGRES_URL; if(!raw||aliases.some(k=>env[k]!==raw))throw Error('All connection aliases must match');
 const u=new URL(raw);if(u.search||u.hash)throw Error('Connection URL options are forbidden');
 if(u.hostname!=='127.0.0.1'||u.port!=='55439'||u.pathname!=='/roster_rehearsal'||u.username!=='roster_rehearsal')throw Error('Not the dedicated local rehearsal target');
 if(env.DYNAMICS_URL!=='https://orgd9e66399.crm.dynamics.com'||env.DYNAMICS_SANDBOX_URL!==env.DYNAMICS_URL||env.DATAVERSE_TARGET_INTERLOCK!=='on'||env.DATAVERSE_DAL_ENFORCEMENT!=='on')throw Error('Rehearsal Dataverse binding invalid');
 const pg=new Client({connectionString:raw,connectionTimeoutMillis:10000});await pg.connect();
 try{
 const identity=(await pg.query('SELECT current_database() AS database, current_user AS username, inet_server_addr()::text AS server, version() AS version')).rows[0];
 if(identity.database!=='roster_rehearsal'||identity.username!=='roster_rehearsal')throw Error('Server identity mismatch');
 if((await pg.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1")).rowCount)throw Error('Database is not empty; no changes made');
 await pg.query('BEGIN');
 await pg.query('CREATE TABLE user_profiles (id INTEGER PRIMARY KEY)');
 await pg.query('INSERT INTO user_profiles VALUES (1)');
 for(const name of ['004_expertise_finder.sql','048_consultant_feedback.sql','050_expertise_roster_contact_link.sql'])await pg.query(fs.readFileSync(path.join(__dirname,'../lib/db/migrations',name),'utf8'));
 await pg.query('ALTER TABLE expertise_roster ADD COLUMN preferred_email VARCHAR(320)');
 await pg.query(fs.readFileSync(path.join(__dirname,'../docs/plans/data/expertise-roster/identity-bridge.sql'),'utf8'));
 await pg.query("INSERT INTO expertise_roster(name,role_type) VALUES ('Synthetic Consultant','Consultant'),('Synthetic Board','Board'),('Synthetic Staff','Research Program Staff')");
 await pg.query("INSERT INTO consultant_feedback(request_id,consultant_roster_id,body_html,received_on,mutation_id,created_by,updated_by) VALUES ('11111111-1111-4111-8111-111111111111',1,'Synthetic feedback',CURRENT_DATE,'22222222-2222-4222-8222-222222222222',1,1)");
 const fk=(await pg.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='consultant_feedback'::regclass AND confrelid='expertise_roster'::regclass")).rows;
 if(fk.length!==1)throw Error('Legacy roster FK not preserved');
 await pg.query('COMMIT');
 console.log(JSON.stringify({syntheticOnly:true,identity,rosterRows:3,feedbackRows:1,bridgeRows:0,oldForeignKey:fk[0].definition,scope:'migration fixture only; not a full application database'}));
 }finally{await pg.end();}
}
main().catch(e=>{console.error(e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
