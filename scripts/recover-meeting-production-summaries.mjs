#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Resume the yielded summary publication with its same draft/version; never regenerate provider output. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {prefix,api}=await rehearsalApi(),file='/private/tmp/wmkf-meeting-production-summary-recovery.json',receipt={publications:[]};if(fs.existsSync(file))throw Error('inspect_previous_recovery_before_repeating');
const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});
try{for(const kind of ['presentation','discussion']){
 const current=await api(prefix+'/transcriptions/summary-draft?kind='+kind);assert.equal(current.status,200);const draft=current.body.draft;assert.ok(['ready','publishing'].includes(draft.state));
 receipt.publications.push({kind,draftId:draft.id,expectedVersion:draft.version,priorState:draft.state,attemptedAt:new Date().toISOString()});save();
 const result=await api(prefix+'/transcriptions/summary-draft/publish','POST',{draftId:draft.id,expectedVersion:draft.version});receipt.publications.at(-1).response=result;save();assert.equal(result.status,200,JSON.stringify(result));
}receipt.passed=true;save();console.log(JSON.stringify({passed:true,providerRegeneration:false,published:receipt.publications.map(p=>p.kind)}));}catch(error){receipt.passed=false;receipt.error=error.message;save();console.error(JSON.stringify({error:receipt.error}));process.exitCode=1;}
