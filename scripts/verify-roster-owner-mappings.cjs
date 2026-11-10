#!/usr/bin/env node
/** Scoped live read-only checks and private confirmation receipt. */
const fs=require('node:fs');const {Client}=require('pg');
async function main(){
 const [envFile,output]=process.argv.slice(2);if(!envFile||!output)throw Error('ENV_FILE NEW_PRIVATE_RECEIPT required');
 const env=require('dotenv').parse(fs.readFileSync(envFile));
 for(const k of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET'])process.env[k]=env[k];
 process.env.DATAVERSE_TARGET_INTERLOCK='on';process.env.DATAVERSE_ALLOW_PROD_READS='yes';
 const {getAccessToken,createClient}=require('../lib/dataverse/client.js');const users={};
 for(const host of ['wmkf.crm.dynamics.com','orgd9e66399.crm.dynamics.com']){
 const url='https://'+host,c=createClient({resourceUrl:url,token:await getAccessToken(url)});
 const r=await c.get('/systemusers?'+new URLSearchParams({$select:'systemuserid,fullname,internalemailaddress,isdisabled',$filter:"internalemailaddress eq 'jsader@wmkeck.org'"}));
 if(!r.ok||r.body['@odata.nextLink']||r.body.value.length!==1||r.body.value[0].isdisabled)throw Error('John account not uniquely enabled');users[host]=r.body.value[0];
 }
 const pg=new Client({connectionString:env.POSTGRES_URL,options:'-c default_transaction_read_only=on',connectionTimeoutMillis:10000});await pg.connect();let refs;
 try{refs=(await pg.query('SELECT id, consultant_roster_id, status FROM consultant_feedback WHERE consultant_roster_id=35')).rows;}finally{await pg.end();}
 const result={checkedAt:new Date().toISOString(),readOnly:true,john:users,placeholderFeedbackReferences:refs};
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({johnEnabledBothEnvironments:true,placeholderFeedbackReferenceCount:refs.length,placeholderFeedbackIds:refs.map(r=>r.id)}));
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
