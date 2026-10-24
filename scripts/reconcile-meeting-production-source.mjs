#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Explicit source-publication reconciliation only; no provider generation or blind create retry. */
import fs from 'node:fs';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {prefix,api}=await rehearsalApi(),w=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-workflow.json'));
const result=await api(prefix+'/transcriptions/publications/'+w.correctionId+'/reconcile','POST',{});fs.writeFileSync('/private/tmp/wmkf-meeting-production-source-reconcile.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
