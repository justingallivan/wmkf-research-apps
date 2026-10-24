#!/usr/bin/env node
/** Real Neon durable-state proof; refuses every database except the owned isolated rehearsal DB. No Dataverse/provider/email calls. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createEditionStore} from '../lib/services/post-presentation-materials/edition-store.js';
import {createPreparationStore} from '../lib/services/meeting-coordination/preparation-store.js';
import {REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE} from '../shared/config/requestDocument.js';
const e=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=process.argv[3];
const url=new URL(e.POSTGRES_URL);
if(process.argv[4]!=='--execute'||url.hostname!=='ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech'||url.pathname!=='/meeting_coord_rehearsal_20261023')throw Error('isolated_target_required');
const uuid=()=>crypto.randomUUID(),id=uuid(),actor=uuid(),receipt={requestId:id,syntheticOnly:true,checks:[],cleaned:false};
const save=()=>fs.writeFileSync(out,JSON.stringify(receipt,null,2),{mode:0o600});save();
const pool=new pg.Pool({connectionString:e.POSTGRES_URL,connectionTimeoutMillis:10000,query_timeout:15000});
const editions=createEditionStore(pool),preps=createPreparationStore(pool);
const members=()=>[TYPE.PRESENTATION_TRANSCRIPT,TYPE.TRANSCRIPT_SUMMARY,TYPE.PRESENTATION_VIDEO].map(type=>({documentId:uuid(),requestId:id,type,driveId:'synthetic-drive',itemId:uuid(),filename:type===TYPE.PRESENTATION_VIDEO?'cut.mp4':'summary.txt',contentType:type===TYPE.PRESENTATION_VIDEO?'video/mp4':'text/plain',size:10,eTag:'e1',sha256:'a'.repeat(64),splitId:type===TYPE.PRESENTATION_VIDEO?uuid():null,quickXorHash:type===TYPE.PRESENTATION_VIDEO?'synthetic-qxh':null}));
const approve=(version)=>({requestId:id,profileId:2,expectedVersion:version,commandId:uuid(),revisionId:uuid(),endMs:12437,members:members(),fingerprint:crypto.randomBytes(32).toString('hex')});
try{
 await editions.enroll({requestId:id,profileId:2});
 const first=approve(1);await editions.approve(first);const old=await editions.read(id);
 const input={requestId:id,siteVisitId:uuid(),fingerprint:'b'.repeat(64),input:{source:{kind:'published',artifactId:uuid(),fingerprint:'c'.repeat(64)},files:{}},profileId:2,actingUserSystemId:actor};
 const p=await preps.create(input),same=await preps.create(input);assert.equal(p.id,same.id);assert.equal(p.steps.length,5);receipt.checks.push('duplicate preparation start reuses five durable steps');
 const s=await preps.claim({requestId:id});assert.equal(s.kind,'source');assert.equal(await preps.claim({requestId:id}),null);
 await preps.finish({id:s.id,leaseToken:s.lease_token,state:'succeeded',source:{id:input.input.source.artifactId,fingerprint:input.input.source.fingerprint}});
 const t=await preps.claim({requestId:id});assert.equal(t.kind,'transcripts');await preps.finish({id:t.id,leaseToken:t.lease_token,state:'blocked',failureCode:'synthetic_transient_failure'});
 const blocked=await preps.read(p.id,id),step=blocked.steps.find(x=>x.id===t.id);
 await preps.retry({requestId:id,preparationId:p.id,stepId:t.id,expectedVersion:step.version,profileId:2,actingUserSystemId:actor});
 const resumed=await preps.claim({requestId:id});assert.equal(resumed.id,t.id);assert.equal((await preps.read(p.id,id)).steps.find(x=>x.kind==='source').state,'succeeded');
 await preps.finish({id:resumed.id,leaseToken:resumed.lease_token,state:'succeeded'});receipt.checks.push('exclusive claim and selective failed-step retry preserve completed source');
 assert.equal((await editions.read(id)).active_edition_id,old.active_edition_id);receipt.checks.push('approved edition remains active while correction preparation is drafted');
 const second=approve(2);await editions.approve(second);const current=await editions.read(id);assert.notEqual(current.active_edition_id,old.active_edition_id);
 const retained=(await pool.query('SELECT members FROM meeting_presentation_editions WHERE id=$1',[old.active_edition_id])).rows[0];assert.deepEqual(retained.members,old.members);receipt.checks.push('replacement approval retains old edition members');
 await editions.withdraw({requestId:id,profileId:2,expectedVersion:3,expectedEditionId:current.active_edition_id});assert.equal((await editions.read(id)).active_edition_id,null);
 await assert.rejects(editions.approve(second),{code:'presentation_edition_changed'});receipt.checks.push('withdrawal persists and stale approval cannot revive it');
 receipt.passed=true;save();
}catch(error){receipt.passed=false;receipt.error=error.code||error.message;receipt.errorMessage=error.message;save();process.exitCode=1;}
finally{
 await pool.query('DELETE FROM meeting_material_preparation_steps WHERE preparation_id IN (SELECT id FROM meeting_material_preparations WHERE request_id=$1)',[id]);
 await pool.query('DELETE FROM meeting_material_preparations WHERE request_id=$1',[id]);
 await pool.query('UPDATE meeting_presentation_visibility SET active_edition_id=NULL WHERE request_id=$1',[id]);
 await pool.query('DELETE FROM meeting_presentation_editions WHERE request_id=$1',[id]);
 await pool.query('DELETE FROM meeting_presentation_visibility WHERE request_id=$1',[id]);
 receipt.cleaned=true;save();await pool.end();console.log(JSON.stringify(receipt));
}
