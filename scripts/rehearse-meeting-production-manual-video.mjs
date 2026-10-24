#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Exact original-audio upload through the real scoped client token; queue only, no implicit review/approval. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {put} from '@vercel/blob/client';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {fixture:r,prefix,api}=await rehearsalApi(),file='/private/tmp/wmkf-meeting-production-manual-video.json';if(fs.existsSync(file))throw Error('inspect_prior_manual_attempt_before_repeating');
const receipt={requestId:r.requestId,attemptedAt:new Date().toISOString()},save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});save();
try{
 const minted=await api(prefix+'/presentation-video-splits','POST',{action:'manual-upload',bytes:r.audioBytes,contentType:'audio/mp4'});receipt.mintStatus=minted.status;if(minted.status!==200){receipt.error=minted.body;save();throw Error('manual_mint_failed');}
 const {pairing,upload}=minted.body;receipt.pairingId=pairing.id;receipt.pathname=upload.pathname;save();
 const bytes=fs.readFileSync(r.mediaRoot+'/original.m4a');await put(upload.pathname,bytes,{access:'private',token:upload.token,contentType:upload.contentType,multipart:true});receipt.uploaded=true;save();
 const queued=await api(prefix+'/presentation-video-splits','POST',{action:'manual-start',pairingId:pairing.id,expectedReviewId:null});receipt.queued=queued;save();assert.equal(queued.status,202);receipt.splitId=queued.body.split.id;receipt.passed=true;save();console.log(JSON.stringify({paired:true,splitId:receipt.splitId}));
}catch(error){receipt.passed=false;receipt.errorMessage=error.message;save();console.error(JSON.stringify(receipt));process.exitCode=1;}
