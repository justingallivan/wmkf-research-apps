#!/usr/bin/env node
/** One-release operator: refuses pending/red checks, requires --execute, verifies exact prior cohort and rolls back partial settings updates. No provider or mail call. */
const fs=require('fs'),{execFileSync}=require('child_process');
const project='prj_56SJKzNer1aV38kKVoP8tl3X0lf3',scope='justin-gallivans-projects',sha='d4f73e62ad68d0da9ba0b85c0e701f1b1f402d7f';
const keys=['MEETING_MATERIAL_PREPARATION_ACCESS','MEETING_MANUAL_VIDEO_PAIRING_ACCESS','MEETING_PRESENTATION_INVITATION_ACCESS'];
const run=(args,input)=>execFileSync('vercel',args.concat(['--scope',scope]),{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const checks=JSON.parse(execFileSync('gh',['api',`repos/justingallivan/wmkf-research-apps/commits/${sha}/check-runs`],{encoding:'utf8'})).check_runs;
if(checks.length<9||checks.some(c=>c.status!=='completed'||!['success','skipped'].includes(c.conclusion)))throw Error('release_checks_not_all_green');
const metadata=JSON.parse(run([`api`,`/v10/projects/${project}/env?decrypt=false`]));
const before={};for(const key of keys){const row=metadata.envs.find(e=>e.key===key&&e.target.length===1&&e.target[0]==='production');if(!row)throw Error('exclusive_production_control_missing');before[key]={id:row.id,value:JSON.parse(run(['api',`/v1/projects/${project}/env/${row.id}`])).value};if(before[key].value!=='test:185415ef-3750-4806-84c7-fb6dd032af31')throw Error('unexpected_prior_cohort');}
const receipt={at:new Date().toISOString(),sourceCommit:sha,checks:checks.map(({name,status,conclusion})=>({name,status,conclusion})),before,after:{},changed:[]};
fs.writeFileSync('/private/tmp/meeting-ordinary-activation.json',JSON.stringify(receipt,null,2),{mode:0o600});
if(!process.argv.includes('--execute')){console.log('Verified all checks; dry-run only');process.exit(0);}
try{for(const key of keys){run(['env','update',key,'--environment','production','--project',project,'--yes'],'on');receipt.changed.push(key);receipt.after[key]=JSON.parse(run(['api',`/v1/projects/${project}/env/${before[key].id}`])).value;if(receipt.after[key]!=='on')throw Error('readback_mismatch');fs.writeFileSync('/private/tmp/meeting-ordinary-activation.json',JSON.stringify(receipt,null,2),{mode:0o600});}receipt.settingsVerified=true;}catch(error){for(const key of receipt.changed)run(['env','update',key,'--environment','production','--project',project,'--yes'],before[key].value);receipt.rolledBack=true;throw error;}finally{fs.writeFileSync('/private/tmp/meeting-ordinary-activation.json',JSON.stringify(receipt,null,2),{mode:0o600});}
console.log(JSON.stringify({settingsVerified:receipt.settingsVerified,flags:receipt.after}));
