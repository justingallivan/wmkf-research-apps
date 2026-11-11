#!/usr/bin/env node
/** Read-only Contact-create/deactivate trigger preflight, sandbox only.
 * PRIVATE_FULL_ENV NEW_PRIVATE_JSON. Definitions stay in private output.
 */
const fs=require('node:fs'),path=require('node:path');
const {parse}=require('dotenv');
const {assertTarget}=require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
const {classifyFlowDefinition,flowNamesEntity,isPlatformStep}=require('./probe-test-request-factory-production-readiness.js');
async function main([input,out,...extra]){
 if(!input||!out||extra.length||![input,out].every(path.isAbsolute))throw Error('Two absolute paths required');
 const stat=fs.lstatSync(input);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Private input required');
 const env=parse(fs.readFileSync(input)),{host}=assertTarget(env);
 if(env.NODE_ENV==='production'||env.VERCEL_ENV)throw Error('Local sandbox only');
 const parent=fs.realpathSync(path.dirname(out)),root=fs.realpathSync(path.resolve(__dirname,'..'));
 if(parent===root||parent.startsWith(root+path.sep)||(fs.statSync(parent).mode&0o077))throw Error('Private external output required');
 for(const k of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT'])process.env[k]=env[k];
 const {createClient,getAccessToken}=require('../lib/dataverse/client.js');
 const client=createClient({resourceUrl:env.DYNAMICS_URL,token:await getAccessToken(env.DYNAMICS_URL)});
 async function all(url){const rows=[],seen=new Set();while(url){if(seen.has(url)||seen.size>=20)throw Error('Incomplete metadata census');seen.add(url);if(url.startsWith('http')){const u=new URL(url);if(u.protocol!=='https:'||u.host!==host||!u.pathname.startsWith('/api/data/v9.2/'))throw Error('Foreign continuation refused');}const r=await client.raw('GET',url,undefined,{}, {timeoutMs:30000});if(!r.ok||!Array.isArray(r.body.value))throw Error('Metadata query refused');rows.push(...r.body.value);url=r.body['@odata.nextLink'];}return rows;}
 const workflows=await all("/workflows?$select=name,category,mode,triggeroncreate,triggeronupdateattributelist,xaml&$filter=primaryentity eq 'contact' and type eq 1 and statecode eq 1");
 const steps=await all("/sdkmessageprocessingsteps?$select=name,stage,mode,filteringattributes,ishidden&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)&$filter=(sdkmessageid/name eq 'Create' or sdkmessageid/name eq 'Update' or sdkmessageid/name eq 'SetState') and statecode eq 0");
 const applicable=steps.filter(row=>!row.sdkmessagefilterid?.primaryobjecttypecode||['none','contact'].includes(row.sdkmessagefilterid.primaryobjecttypecode));
 const flows=await all('/workflows?$select=name,clientdata&$filter=category eq 5 and statecode eq 1');
 const classified=flows.map(row=>({...row,...classifyFlowDefinition(row.clientdata)}));
 const relevant=classified.filter(row=>!row.readable||flowNamesEntity(row.definition,['contact','contacts']));
 const summary={classic:workflows.map(w=>({name:w.name,onCreate:w.triggeroncreate,updateAttributes:w.triggeronupdateattributelist,category:w.category,readable:Boolean(w.xaml)})),customSteps:applicable.filter(row=>!isPlatformStep(row)).map(row=>({name:row.name,message:row.sdkmessageid?.name,entity:row.sdkmessagefilterid?.primaryobjecttypecode,attributes:row.filteringattributes,type:row.plugintypeid?.typename})),hiddenPlatformSteps:applicable.filter(isPlatformStep).length,activeCloudFlows:flows.length,relevantCloudFlows:relevant.map(row=>({name:row.name,readable:row.readable,triggers:row.definition?.triggers}))};
 fs.writeFileSync(out,JSON.stringify({targetHost:host,checkedAt:new Date().toISOString(),summary,workflows,steps:applicable,cloudFlows:relevant},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(summary));
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('Contact trigger preflight incomplete; no write authorized by this probe.');process.exitCode=1;});
