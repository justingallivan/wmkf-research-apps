#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
import fs from 'node:fs';import assert from 'node:assert/strict';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const reconciled=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-source-reconcile.json'));assert.equal(reconciled.body.publication.state,'published');
const {prefix,api}=await rehearsalApi();const status=await api(prefix+'/preparation'),p=status.body.preparation,step=p.steps.find(s=>s.kind==='source');assert.equal(step.state,'blocked');
const retry=await api(prefix+'/preparation','POST',{action:'retry',preparationId:p.id,stepId:step.id,expectedVersion:step.version});assert.equal(retry.status,202);fs.writeFileSync('/private/tmp/wmkf-meeting-production-source-resume.json',JSON.stringify(retry),{mode:0o600});console.log('Reconciled source step explicitly resumed; no provider call repeated.');
