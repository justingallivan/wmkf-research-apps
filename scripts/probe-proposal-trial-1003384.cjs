// Owner-approved, read-only preflight for the Request 1003384 trial.
if(process.argv[2]!=='--approved-request-1003384-preflight'){console.log('Requires --approved-request-1003384-preflight; performs scoped production reads.');process.exit(2);}
const root=require('node:path').resolve(__dirname,'..');
const {createRequire,registerHooks}=require('node:module');
const req=createRequire(root+'/package.json');
registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)) return next(s+'.js',c);throw e;}}});
req('@next/env').loadEnvConfig(root);
process.env.DATAVERSE_TARGET_INTERLOCK='on';
process.env.DATAVERSE_ALLOW_PROD_READS='yes';
delete process.env.DATAVERSE_PROD_WRITE_ACK;
const original=globalThis.fetch;
globalThis.fetch=(input,options={})=>{const u=new URL(typeof input==='string'?input:input.url||input.toString());const m=(options.method||'GET').toUpperCase();const pgHost=new URL(process.env.POSTGRES_URL).hostname.replace('-pooler','');const pgRead=m==='POST'&&u.hostname===pgHost.replace(/^[^.]+\./,'api.')&&u.pathname==='/sql'&&/^\s*SELECT\b/i.test(JSON.parse(options.body||'{}').query||'');if(!pgRead&&!['GET','HEAD'].includes(m)&&!(m==='POST'&&u.hostname==='login.microsoftonline.com'&&/\/oauth2\/v2\.0\/token$/.test(u.pathname))){console.error('BLOCKED',u.hostname,u.pathname,m,Object.keys(JSON.parse(options.body||'{}')));throw Error('preflight_readonly');}return original(input,options);};
(async()=>{
 console.log('CONFIG',JSON.stringify({dynamicsHost:new URL(process.env.DYNAMICS_URL).hostname,sandboxHost:process.env.DYNAMICS_SANDBOX_URL?new URL(process.env.DYNAMICS_SANDBOX_URL).hostname:null,postgresHost:new URL(process.env.POSTGRES_URL).hostname,impersonation:process.env.DYNAMICS_IMPERSONATION_ENABLED,apiKeyConfigured:Boolean(process.env.ANTHROPIC_API_KEY||process.env.CLAUDE_API_KEY),existingTrial:Boolean(process.env.PROMPT_JOB_TRIAL_ACCESS)}));
 const {Client}=req('pg');const client=new Client({connectionString:process.env.POSTGRES_URL});await client.connect();await client.query('BEGIN READ ONLY');
 console.log('TABLES',JSON.stringify((await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'prompt_job%' OR table_name IN ('schema_migrations','prompt_publish_audit')) ORDER BY table_name")).rows));
 const applied=new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(x=>x.name));console.log('PENDING_MIGRATIONS',JSON.stringify(req('./scripts/apply-migrations.js').listMigrationFiles().filter(n=>!applied.has(n))));
 console.log('ACTORS',JSON.stringify((await client.query("SELECT p.id,p.dynamics_systemuser_id FROM user_profiles p WHERE p.id=2 AND p.is_active=true AND EXISTS(SELECT 1 FROM dynamics_user_roles r WHERE r.user_profile_id=p.id AND r.role='superuser') ORDER BY p.id LIMIT 10")).rows));
 await client.query('ROLLBACK');await client.end();
 const {withDalContext}=req('./lib/dataverse/core/context.js');
 await withDalContext('approved-proposal-trial-preflight',async()=>{
  const actor={profileId:2,systemUserId:'29b0de0d-4ff7-ee11-a1fd-000d3a3621c7'}; console.log('ACTOR_AUTHORIZED',await req('./lib/services/prompt-jobs/staff-service.js').authorizeTrialActor(actor)); const profiles=await req('./lib/services/admin/prompt-profiles-service.js').getPromptProfiles();console.log('PROFILES',JSON.stringify(profiles.profiles.map(p=>({key:p.profile.key,revision:p.profile.revision,hash:p.sha256}))));
  for(const name of ['proposal.executive-summary','proposal.methodology']){const v=await req('./lib/dataverse/adapters/ai-prompt.js').listVersions(name);console.log('PROMPT',JSON.stringify({name,rows:v.records.map(x=>({id:x.wmkf_ai_promptid,current:x.wmkf_ai_iscurrent,version:x.wmkf_promptversion}))}));}
 });
})().then(()=>process.exit(0)).catch(e=>{console.error('PREFLIGHT_FAILED',e.code||'',e.message);process.exit(1)});
