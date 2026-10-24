#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Verify reviewed text survived another kind's retry, then publish only the two synthetic drafts. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {prefix,api}=await rehearsalApi(),saved=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-summary-preservation.json')),file='/private/tmp/wmkf-meeting-production-summary-publication.json';
if(fs.existsSync(file))throw Error('inspect_existing_summary_publication');const receipt={requestId:saved.retry.body.preparation.requestId,publications:[],editedDraftPreserved:false};
const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});
try{
 const first=await api(prefix+'/transcriptions/summary-draft');assert.equal(first.status,200);assert.equal(first.body.draft.id,saved.draft.id);assert.equal(first.body.draft.version,saved.draft.version);assert.equal(first.body.draft.text,saved.draft.text);receipt.editedDraftPreserved=true;save();
 for(const kind of ['presentation','discussion']){
  const current=await api(prefix+'/transcriptions/summary-draft?kind='+kind);assert.equal(current.status,200);assert.equal(current.body.draft.state,'ready');
  const draft=current.body.draft;if(!draft.text?.trim())throw Error('empty_synthetic_summary');
  receipt.publications.push({kind,draftId:draft.id,attemptedAt:new Date().toISOString()});save();
  const result=await api(prefix+'/transcriptions/summary-draft/publish','POST',{draftId:draft.id,expectedVersion:draft.version});receipt.publications.at(-1).response=result;save();assert.equal(result.status,200);
 }
 receipt.passed=true;save();console.log(JSON.stringify({passed:true,editedDraftPreserved:true,published:receipt.publications.map(p=>p.kind)}));
}catch(error){receipt.passed=false;receipt.error=error.message;save();console.error(JSON.stringify({error:receipt.error,publications:receipt.publications.map(p=>({kind:p.kind,status:p.response?.status,code:p.response?.body?.code}))}));process.exitCode=1;}
