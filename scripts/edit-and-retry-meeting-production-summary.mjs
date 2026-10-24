#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Save a reviewed presentation draft, then explicitly retry only the known failed discussion step. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {prefix,api}=await rehearsalApi(),file='/private/tmp/wmkf-meeting-production-summary-preservation.json';if(fs.existsSync(file))throw Error('inspect_existing_summary_retry_receipt');
const original=await api(prefix+'/transcriptions/summary-draft');assert.equal(original.status,200);assert.equal(original.body.draft.state,'ready');
const text='Reviewed synthetic rehearsal summary.\n'+original.body.draft.text;
const edited=await api(prefix+'/transcriptions/summary-draft','PATCH',{draftId:original.body.draft.id,expectedVersion:original.body.draft.version,text});assert.equal(edited.status,200);
const receipt={draft:edited.body.draft,discussionRetryAttempted:false};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});
const status=await api(prefix+'/preparation'),p=status.body.preparation,s=p.steps.find(s=>s.kind==='discussion_summary');assert.equal(s.state,'blocked');assert.equal(s.failureCode,'summary_generation_failed');
receipt.discussionRetryAttempted=true;fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});const retry=await api(prefix+'/preparation','POST',{action:'retry',preparationId:p.id,stepId:s.id,expectedVersion:s.version});receipt.retry=retry;assert.equal(retry.status,202);fs.writeFileSync(file,JSON.stringify(receipt,null,2),{mode:0o600});console.log('Reviewed presentation text saved; only the known failed discussion step was explicitly retried.');
