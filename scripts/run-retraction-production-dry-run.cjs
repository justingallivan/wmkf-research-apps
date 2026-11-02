#!/usr/bin/env node
/** Owner-authorized deployed dry-run ONLY. Fixed production project/domain;
 * requires an exact expected release SHA and refuses an existing publication.
 * Cron bearer stays in memory/private temp files, never argv/output. Every
 * worker request is hardcoded to dryRun=1; no publish or scheduler mutation.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const { Client } = require('pg');
const { withVerifyFullSslmode } = require('../lib/db/pg-connection-string');
const { fingerprint } = require('./backup-retractions.cjs');
const ROOT=path.resolve(__dirname,'..');
const PROJECT='prj_56SJKzNer1aV38kKVoP8tl3X0lf3';
const TEAM='team_bAyoqgvSJhFJC3blheJgTMXQ';
const DOMAIN='applications.wmkeck.org';
function command(args,cwd=ROOT){return execFileSync('vercel',args,{cwd,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});}
function api(endpoint){return JSON.parse(command(['api',endpoint,'--scope',TEAM]));}
async function main(){
 const expected=process.env.INTEGRITY_EXPECTED_RELEASE_SHA;
 if(!/^[a-f0-9]{40}$/.test(expected||''))throw new Error('exact_release_sha_required');
 const project=api(`/v9/projects/${PROJECT}`);const deployment=project.targets?.production;
 if(project.id!==PROJECT||project.accountId!==TEAM||deployment?.readyState!=='READY'||deployment.meta?.githubCommitSha!==expected)throw new Error('production_release_not_ready_or_mismatched');
 if(project.crons?.definitions?.some(job=>job.path.split('?')[0]==='/api/cron/refresh-retractions'))throw new Error('monthly_schedule_must_be_absent');
 const alias=JSON.parse(command(['inspect',DOMAIN,'--json','--scope',TEAM]));
 if(alias.id!==deployment.id||alias.target!=='production')throw new Error('production_domain_deployment_mismatch');
 const linked=path.dirname(execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:ROOT,encoding:'utf8'}).trim());
 const link=JSON.parse(fs.readFileSync(path.join(linked,'.vercel/project.json')));
 if(link.projectId!==PROJECT||link.orgId!==TEAM)throw new Error('linked_project_mismatch');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'integrity-dryrun-'));fs.chmodSync(temp,0o700);
 let client;
 try{
  const file=path.join(temp,'production.env');command(['env','pull',file,'--environment=production','--yes'],linked);fs.chmodSync(file,0o600);
  const env=dotenv.parse(fs.readFileSync(file));const dbUrl=new URL(env.POSTGRES_URL);
  if(env.NEON_PROJECT_ID!=='falling-surf-05640504'||dbUrl.hostname!=='ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech'||dbUrl.pathname!=='/neondb'||env.RETRACTION_REFRESH_ENABLED!=='on'||!env.CRON_SECRET)throw new Error('production_dryrun_configuration_mismatch');
  client=new Client({connectionString:withVerifyFullSslmode(env.POSTGRES_URL),application_name:'integrity-dryrun-readback',connectionTimeoutMillis:10000,query_timeout:30000});await client.connect();
  await client.query('BEGIN READ ONLY');
  const before=await fingerprint(client);const start=(await client.query('SELECT NOW()::text AS started')).rows[0].started;
  const prior=(await client.query('SELECT COUNT(*)::int AS count FROM retraction_dataset')).rows[0].count;
  await client.query('ROLLBACK');if(prior!==0)throw new Error('existing_publication_detected');
  const response=await fetch(`https://${DOMAIN}/api/cron/refresh-retractions?dryRun=1`,{method:'GET',headers:{Authorization:`Bearer ${env.CRON_SECRET}`},redirect:'manual',signal:AbortSignal.timeout(270000)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Object.assign(new Error('non_json_worker_response'),{status:response.status});
  const outcome=await response.json();
  if(!response.ok||outcome.success!==true||outcome.status!=='dry_run'||outcome.dryRun!==true||outcome.published!==false||outcome.auditRecorded!==true)throw Object.assign(new Error('worker_dryrun_not_successful'),{status:response.status,workerCode:/^[a-z_]+$/.test(outcome.error||'')?outcome.error:undefined});
  await client.query('BEGIN READ ONLY');const after=await fingerprint(client);
  const published=(await client.query('SELECT COUNT(*)::int AS count FROM retraction_dataset')).rows[0].count;
  const audits=(await client.query("SELECT id,job_name,status,records_processed,records_deleted,started_at,completed_at,details FROM maintenance_runs WHERE job_name='retraction-refresh-dryrun' AND started_at>=$1::timestamptz ORDER BY id DESC LIMIT 3",[start])).rows;
  await client.query('ROLLBACK');
  const current=api(`/v9/projects/${PROJECT}`);
  const scheduled=current.crons?.definitions?.some(job=>job.path.split('?')[0]==='/api/cron/refresh-retractions');
  if(before.rowsSha256!==after.rowsSha256||before.count!==after.count||published!==0||scheduled||!audits.some(a=>a.status==='completed'&&a.details?.checksum===outcome.checksum))throw new Error('dryrun_readback_mismatch');
  console.log(JSON.stringify({observedAt:new Date().toISOString(),deployment:{id:deployment.id,url:deployment.url,sha:expected},request:{domain:DOMAIN,path:'/api/cron/refresh-retractions?dryRun=1',method:'GET'},outcome,readback:{corpusCount:after.count,corpusRowsSha256:after.rowsSha256,corpusUnchanged:true,publicationMetadataRows:published,monthlySchedulePresent:false,audits}},null,2));
 }finally{if(client)await client.end();fs.rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(JSON.stringify({error:error.message,name:error.name,code:error.code,status:error.status,workerCode:error.workerCode}));process.exitCode=1;});
