#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** One authenticated server-side drain tick, then reload the owned request. No browser lifetime or implicit provider retry. */
import fs from 'node:fs';import {rehearsalApi} from './lib/meeting-rehearsal-api.mjs';
const {prefix,api}=await rehearsalApi();const file='/private/tmp/wmkf-meeting-production-drains.json',log=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{ticks:[]};
const tick=await api('/api/cron/drain-meeting-material-preparations','POST',{});log.ticks.push({at:new Date().toISOString(),response:tick});fs.writeFileSync(file,JSON.stringify(log,null,2),{mode:0o600});
const current=await api(prefix+'/preparation');log.current=current;fs.writeFileSync(file,JSON.stringify(log,null,2),{mode:0o600});console.log(JSON.stringify({tick,current:current.body}));
