#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Actual two-reader correction/retention, replacement and immediate withdrawal proof. One extra synthetic summary call only. */
import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';import {readerClients} from './lib/meeting-rehearsal-readers.mjs';
const {prefix,api}=await rehearsalApi(),clients=readerClients(),first=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-first-readers.json')),file='/private/tmp/wmkf-meeting-production-replacement.json';assert.equal(first.passed,true);if(fs.existsSync(file))throw Error('inspect_existing_replacement_attempt');
const receipt={checks:[],commands:[]},save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});save();
async function command(key,path,method,body,status=200){const record={key,attemptedAt:new Date().toISOString()};receipt.commands.push(record);save();const response=await api(path,method,body);record.response=response;save();assert.equal(response.status,status,key+': '+JSON.stringify(response));return response.body;}
async function bytes(client,member){let r=await client.open(member);if(r.status===302){const url=new URL(r.headers.get('Location'));assert.ok(url.protocol==='https:'&&url.hostname.endsWith('.sharepoint.com'));r=await fetch(url,{signal:AbortSignal.timeout(60000)});}assert.equal(r.status,200);return Buffer.from(await r.arrayBuffer());}
async function oldStillVisible(phase){for(const [kind,c]of Object.entries(clients)){const r=await c.context();assert.equal(r.status,200);assert.deepEqual(r.body.materials.map(m=>m.member).sort(),first.readers[kind].body.materials.map(m=>m.member).sort());const oldSummary=first.readers.presentation.body.materials.find(m=>m.kind==='summary').member;const data=await bytes(c,oldSummary);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),first.summaryBytes[kind].sha256);}receipt.checks.push(phase+': both readers retain exact old approved members/bytes');save();}
try{
 const overview=await api(prefix+'/transcriptions');assert.equal(overview.status,200);const source=overview.body.currentArtifact;
 const generated=await command('newSummaryDraft',prefix+'/transcriptions/summary-draft','POST',{kind:'presentation',expectedCurrentArtifactId:source.id,expectedCurrentFingerprint:source.fingerprint,replaceDraft:null});
 const replacementText='Replacement approved synthetic rehearsal summary.\n'+generated.draft.text;
 const edited=await command('editReplacement',prefix+'/transcriptions/summary-draft','PATCH',{draftId:generated.draft.id,expectedVersion:generated.draft.version,text:replacementText});
 await oldStillVisible('while correction is drafted');
 const published=await command('publishReplacement',prefix+'/transcriptions/summary-draft/publish','POST',{draftId:edited.draft.id,expectedVersion:edited.draft.version});const newMember='material:'+published.transcriptSummary.artifactId;receipt.newMember=newMember;save();
 await oldStillVisible('after new candidate publication, before approval');
 const status=await api(prefix+'/presentation-approval');assert.equal(status.status,200);assert.equal(status.body.candidate.ready,true);
 const approvalBody={action:'approve',expectedVersion:status.body.version,commandId:crypto.randomUUID(),candidateFingerprint:status.body.candidate.fingerprint,videoReviewed:true,summaryReviewed:true};
 const approved=await command('approveReplacement',prefix+'/presentation-approval','POST',approvalBody);receipt.replacementEditionId=approved.activeEditionId;save();
 for(const [kind,c]of Object.entries(clients)){const r=await c.context();assert.equal(r.status,200);assert.ok(r.body.materials.some(m=>m.member===newMember));const content=await bytes(c,newMember);assert.ok(content.toString('utf8').includes('Replacement approved synthetic rehearsal summary.'));}receipt.checks.push('replacement approval switches both readers to reviewed new summary bytes');save();
 const withdrawn=await command('withdraw',prefix+'/presentation-approval','POST',{action:'withdraw',expectedVersion:approved.version,expectedEditionId:approved.activeEditionId});
 for(const [kind,c]of Object.entries(clients)){const r=await c.context();assert.equal(r.status,200);assert.deepEqual(r.body.materials,[]);assert.equal((await c.open(newMember)).status,404);}receipt.checks.push('immediate withdrawal removes presentation members and direct opens from both readers');save();
 await command('staleApproval',prefix+'/presentation-approval','POST',approvalBody,409);
 await command('replayWithdrawnCommandAtFreshVersion',prefix+'/presentation-approval','POST',{...approvalBody,expectedVersion:withdrawn.version},409);receipt.checks.push('neither stale version nor replayed command at a fresh version can revive withdrawn edition');
 receipt.passed=true;save();console.log(JSON.stringify({passed:true,checks:receipt.checks,withdrawn:true}));
}catch(error){receipt.passed=false;receipt.error=error.message;save();console.error(JSON.stringify({error:receipt.error,lastCommand:receipt.commands.at(-1)?.key}));process.exitCode=1;}
