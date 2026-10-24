#!/usr/bin/env node
/** Real HTTP reader inclusion/exclusion and byte checks. Never logs tokens or capability URLs. */
import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {readerClients} from './lib/meeting-rehearsal-readers.mjs';
const fixture=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-fixture.json')),summaries=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-summary-recovery.json'));
const summaryId=summaries.publications.find(p=>p.kind==='presentation').response.body.transcriptSummary.artifactId,discussionId=summaries.publications.find(p=>p.kind==='discussion').response.body.transcriptSummary.artifactId;
const clients=readerClients(),receipt={phase:'first-approved',readers:{},privacyDenials:[],summaryBytes:{}};
const save=()=>fs.writeFileSync('/private/tmp/wmkf-meeting-production-first-readers.json',JSON.stringify(receipt,null,2),{mode:0o600});
for(const [kind,client]of Object.entries(clients)){
 const r=await client.context();receipt.readers[kind]=r;save();assert.equal(r.status,200);assert.equal(r.body.ok,true);const materials=r.body.materials;
 assert.ok(materials.some(m=>m.member==='material:'+summaryId));assert.ok(materials.some(m=>kind==='presentation'?m.kind==='video':m.canWatch===true));assert.equal(materials.length,kind==='presentation'?2:3);
 let text=await client.open('material:'+summaryId);if(text.status===302){const url=new URL(text.headers.get('Location'));assert.ok(url.protocol==='https:'&&url.hostname.endsWith('.sharepoint.com'));text=await fetch(url,{signal:AbortSignal.timeout(60000)});}assert.equal(text.status,200);const bytes=Buffer.from(await text.arrayBuffer());assert.ok(bytes.toString('utf8').includes('Reviewed synthetic rehearsal summary.'));receipt.summaryBytes[kind]={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};save();
 for(const id of [fixture.recordingDocumentId,discussionId]){const denied=await client.open('material:'+id);receipt.privacyDenials.push({reader:kind,documentId:id,status:denied.status});save();assert.equal(denied.status,404);}
}
assert.equal(receipt.summaryBytes.presentation.sha256,receipt.summaryBytes.briefing.sha256);receipt.passed=true;save();console.log(JSON.stringify({passed:true,readers:['presentation','briefing'],privateSourceDenials:receipt.privacyDenials.length,sameSummaryBytes:true}));
