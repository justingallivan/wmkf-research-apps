#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Launch only the owned loopback rehearsal package with its explicit isolated configuration and write fence. */
const fs=require('fs'),{spawn}=require('child_process'),{parseEnv}=require('node:util');
const e=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-app-env.json')),oidc=parseEnv(fs.readFileSync('/private/tmp/wmkf-meeting-new-project-preview.env','utf8'));
if(e.NEXTAUTH_URL!=='http://127.0.0.1:3179'||new URL(e.POSTGRES_URL).pathname!=='/meeting_coord_rehearsal_20261023'||!e.NODE_OPTIONS.includes('install-meeting-rehearsal-fence'))throw Error('isolated_launch_scope_required');
try{process.kill(Number(fs.readFileSync('/private/tmp/wmkf-meeting-local-production-rehearsal.pid','utf8')),'SIGTERM')}catch{}
const p=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','3179'],{cwd:'/private/tmp/wmkf-meeting-hosted-Is1C8P',env:{...process.env,...e,VERCEL_OIDC_TOKEN:oidc.VERCEL_OIDC_TOKEN},stdio:['ignore',fs.openSync('/private/tmp/wmkf-meeting-local-production-rehearsal.log','a'),fs.openSync('/private/tmp/wmkf-meeting-local-production-rehearsal-error.log','a')]});fs.writeFileSync('/private/tmp/wmkf-meeting-local-production-rehearsal.pid',String(p.pid));p.on('exit',code=>{console.log('rehearsal server exit '+code);process.exitCode=code});
