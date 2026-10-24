#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Journal each application command once. A failed/ambiguous command stops for reconciliation; never automatically retries provider work. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {fixture:r,prefix,api}=await rehearsalApi(),file='/private/tmp/wmkf-meeting-production-workflow.json';
const log=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{requestId:r.requestId,commands:{}};
const save=()=>fs.writeFileSync(file,JSON.stringify(log,null,2),{mode:0o600});
async function once(key,path,method,body,status=200){const prior=log.commands[key];if(prior){if(prior.response?.status===status)return prior.response.body;throw Error('reconciliation_required_'+key);}
 log.commands[key]={path,method,attemptedAt:new Date().toISOString()};save();const response=await api(path,method,body);log.commands[key].response=response;save();assert.equal(response.status,status,key+': '+JSON.stringify(response));return response.body;}
try{
 const published=await once('publishSource',prefix+'/transcriptions/'+r.jobId+'/publish','POST',{expectedVersion:1,expectedCurrentArtifactId:null,expectedCurrentFingerprint:null});
 const overview=await api(prefix+'/transcriptions');log.overview=overview;save();assert.equal(overview.status,200);const artifact=overview.body.currentArtifact;assert.ok(artifact?.id);
 const draft=await once('createCorrection',prefix+'/transcriptions/materials/'+artifact.id+'/corrections','POST',{},201);
 const op=draft.correction?.operationId||draft.correction?.id;assert.ok(op,'correction operation id missing');log.correctionId=op;save();
 const corrected=await once('saveBoundary',prefix+'/transcriptions/corrections/'+op,'PATCH',{expectedVersion:draft.correction.version,speakerNames:{A:'Ada Example',B:'Noah Sample',C:'Synthetic Staff'},presentationEndMs:9500});
 const attendance=await once('prepareAttendance',prefix+'/transcriptions/corrections/'+op+'/attendance','POST',{expectedVersion:corrected.correction.version});
 const review=attendance.correction.attendanceReview;assert.ok(review,'attendance review missing');
 const confirmed=await once('confirmAttendance',prefix+'/transcriptions/corrections/'+op,'PATCH',{expectedVersion:attendance.correction.version,speakerNames:attendance.correction.speakerNames,attendanceConfirmation:{reviewId:review.id,kept:review.decision.rows.map(()=>true)}});
 const prepared=await once('startPreparation',prefix+'/preparation','POST',{action:'start',source:{kind:'correction',operationId:op,expectedVersion:confirmed.correction.version}},202);
 log.preparationId=prepared.preparation.id;log.initialPreparation=prepared.preparation;log.sourceReviewPrepared=true;save();console.log(JSON.stringify({sourceReviewPrepared:true,preparationId:log.preparationId}));
}catch(error){log.error=error.message;save();console.error(JSON.stringify({error:log.error}));process.exitCode=1;}
