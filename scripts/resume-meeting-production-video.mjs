#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** New cut admission only after the prior failed attempt was inspected and no VM command was dispatched. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {prefix,api}=await rehearsalApi(),file='/private/tmp/wmkf-meeting-production-manual-video.json',r=JSON.parse(fs.readFileSync(file));
const status=await api(prefix+'/presentation-video-splits');const old=status.body.splits.find(s=>s.id===r.splitId);assert.equal(old.state,'failed');assert.equal(old.failureCode,'presentation_video_start_failed');
const pairing=await api(prefix+'/presentation-video-splits','POST',{action:'manual-status'});assert.equal(pairing.status,200);assert.equal(pairing.body.pairing.id,r.pairingId);assert.equal(pairing.body.pairing.state,'ready');
const queued=await api(prefix+'/presentation-video-splits','POST',{action:'manual-start',pairingId:r.pairingId,expectedReviewId:null});assert.equal(queued.status,202);r.priorFailedSplitId=r.splitId;r.splitId=queued.body.split.id;r.resumed=queued;fs.writeFileSync(file,JSON.stringify(r,null,2),{mode:0o600});console.log(JSON.stringify({reusedOriginalAudio:true,splitId:r.splitId}));
