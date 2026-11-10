#!/usr/bin/env node
/** Explicit sandbox-only operation. Do not run without separate live-import approval.
 * Credentials are read from one private environment file; no implicit .env.local.
 * Source/mapping must match a reviewed nonblocked offline plan. Output is private.
 */
const fs = require('node:fs');
async function main(argv) {
  const args = {};
  for (let i=0;i<argv.length;i+=2) {
    const key=argv[i];
    if (!['--source','--mapping','--reviewed-plan','--env','--receipt','--execute'].includes(key) || args[key] || !argv[i+1] || argv[i+1].startsWith('--')) throw Error('Required: --source FILE --mapping FILE --reviewed-plan FILE --env PRIVATE_FILE --receipt NEW_FILE --execute sandbox');
    args[key]=argv[i+1];
  }
  if (Object.keys(args).length!==6 || args['--execute']!=='sandbox') throw Error('Explicit sandbox execution arguments required');
  if (process.env.VERCEL_ENV || process.env.NODE_ENV==='production') throw Error('Local rehearsal only');
  const read = key => JSON.parse(fs.readFileSync(args[key],'utf8'));
  const source=read('--source'),mapping=read('--mapping'),reviewedPlan=read('--reviewed-plan');
  const env={...process.env,...require('dotenv').parse(fs.readFileSync(args['--env']))};
  const {assertTarget}=require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
  const target=assertTarget(env);
  if (env.NODE_ENV==='production'||env.VERCEL_ENV) throw Error('Local rehearsal only');
  // No output replacement, even on failure. Receipt contents have no expertise text.
  const fd=fs.openSync(args['--receipt'],'wx',0o600);
  const save=value=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(value,null,2)+'\n',0,'utf8');fs.fsyncSync(fd);};
  let pg;
  try {
    save({success:false,status:'started',targetHost:target.host});
    for (const key of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT']) {
      if (!env[key]) throw Error(`Missing ${key}`); process.env[key]=env[key];
    }
    const {createClient,getAccessToken}=require('../lib/dataverse/client.js');
    const client=createClient({resourceUrl:env.DYNAMICS_URL,token:await getAccessToken(env.DYNAMICS_URL)});
    const {Client}=require('pg');pg=new Client({connectionString:target.connectionString,connectionTimeoutMillis:10000});await pg.connect();
    const {createStore}=require('./lib/expertise-roster-import-store.cjs');
    const {executeImport}=require('./lib/expertise-roster-import-executor.cjs');
    const result=await executeImport({source,mapping,reviewedPlan},createStore({env,client,pg}));
    save(result);
    console.log(JSON.stringify({success:result.success,bridgeCommitted:result.bridgeCommitted,processed:result.rows.length,receipt:args['--receipt']}));
    return result.success?0:2;
  } catch (error) {
    save({success:false,status:'failed',message:error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]')});throw error;
  } finally {fs.closeSync(fd);if(pg)await pg.end();}
}
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(()=>{console.error('Import failed; inspect the private receipt (if created). No automatic cleanup or overwrite was attempted.');process.exitCode=1;});
module.exports={main};
