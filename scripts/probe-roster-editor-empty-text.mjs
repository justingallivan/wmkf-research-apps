import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
// Bounded sandbox-only editor canary. Retains one inactive synthetic profile.
// Usage: node --import ./scripts/lib/use-extensionless.mjs scripts/probe-roster-editor-empty-text.mjs PRIVATE_DIR
const [dir,...extra]=process.argv.slice(2);if(!dir||extra.length)throw Error('PRIVATE_DIR required');
if(fs.existsSync(`${dir}/empty-editor-verification.json`))throw Error('Receipt already exists; preserve prior evidence.');
Object.assign(process.env,dotenv.parse(fs.readFileSync(`${dir}/full.env`)),{DYNAMICS_IMPERSONATION_ENABLED:'true'});
const {saveRoster}=await import('../lib/services/expertise-finder/roster-service.js');
const {withDalContext}=await import('../lib/dataverse/core/context.js');
const {DynamicsService}=await import('../lib/services/dynamics-service.js');
const {default:contract}=await import('../lib/services/expertise-finder/roster-contract.cjs');
const actor=JSON.parse(fs.readFileSync(`${dir}/staff-edit-run.json`)).actors[0];
const runPath=`${dir}/empty-editor-run.json`;
const fixture={name:'Synthetic blank-form editor canary',role_type:'Consultant',is_active:false,lead_pd_eligible:false,...Object.fromEntries(contract.TEXT.map(k=>[k,'']))};
const input=fs.existsSync(runPath)?JSON.parse(fs.readFileSync(runPath)):{mutation_id:randomUUID(),...fixture};
assert(contract.guid(input.mutation_id),'Canonical mutation UUID required');
assert.deepEqual(input,{mutation_id:input.mutation_id,...fixture},'Retained input must be the exact unlinked inactive synthetic fixture');
assert(contract.guid(actor),'Approved actor receipt required');
if(!fs.existsSync(runPath))fs.writeFileSync(runPath,JSON.stringify(input,null,2),{mode:0o600,flag:'wx'});
const originalInput=structuredClone(input);
const batches=[];const original=DynamicsService.executeChangeset;
DynamicsService.executeChangeset=async function(...args){const result=await original.apply(this,args);batches.push(result);return result;};
const result=await withDalContext('roster-inactive-editor-canary',async()=>{
 const first=await saveRoster(input,actor,{create:true});assert.equal(first.member.is_active,false);
 const writes=batches.length;assert(writes<=1);if(writes){assert.equal(batches[0].ok,true);assert.equal(batches[0].operations.length,2);assert(batches[0].operations.every(x=>x.status>=200&&x.status<300));}
 const replay=await saveRoster(input,actor,{create:true});assert.equal(replay.member.id,first.member.id);assert.equal(replay.member.etag,first.member.etag);assert.equal(batches.length,writes);
 await assert.rejects(saveRoster({...input,name:input.name+' conflicting'},actor,{create:true}),e=>e.status===409);
 const raw=await DynamicsService.getRecord('wmkf_expertiseprofiles',first.member.id,{select:'wmkf_expertiseprofileid,statecode,statuscode,wmkf_creationkey,_createdby_value,_modifiedby_value,'+contract.TEXT.map(contract.column).join(',')});
 assert.equal(raw.statecode,1);assert.equal(raw.statuscode,2);assert.equal(raw.wmkf_creationkey,'app_'+input.mutation_id);assert.equal(raw._createdby_value,actor);assert.equal(raw._modifiedby_value,actor);
 for(const k of contract.TEXT){assert.equal(raw[contract.column(k)]??null,null);assert.equal(input[k],'');}
 assert.deepEqual(input,originalInput);
 return {success:true,originalInputPreserved:true,optionalTextReadbackNull:true,at:new Date().toISOString(),profileGuid:first.member.id,actor,operations:(batches[0]?.operations||[]).map(x=>({status:x.status,contentId:x.contentId})),replaySameGuidAndEtag:true,conflictStatus:409,independentRead:raw};
});
fs.writeFileSync(`${dir}/empty-editor-verification.json`,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({success:true,profileGuid:result.profileGuid,operations:result.operations,replay:true,conflict:409}));
