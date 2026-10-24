#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** One owned video-worker tick and safe status reload; no automatic repeats. */
import fs from 'node:fs';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {prefix,api}=await rehearsalApi(),file='/private/tmp/wmkf-meeting-production-video-drains.json',j=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{ticks:[]};
const tick=await api('/api/cron/drain-presentation-video-splits','POST',{});j.ticks.push({at:new Date().toISOString(),response:tick});fs.writeFileSync(file,JSON.stringify(j,null,2),{mode:0o600});const current=await api(prefix+'/presentation-video-splits');j.current=current;fs.writeFileSync(file,JSON.stringify(j,null,2),{mode:0o600});console.log(JSON.stringify({tick,current}));
