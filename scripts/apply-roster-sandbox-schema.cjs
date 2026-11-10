#!/usr/bin/env node
/** Explicit sandbox-only wrapper; passes only Dataverse app credentials to schema CLI. */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const [file,mode,...extra]=process.argv.slice(2);
if(!file||!['--dry-run','--execute'].includes(mode)||extra.length)throw Error('ENV_FILE --dry-run|--execute required');
const input=require('dotenv').parse(fs.readFileSync(file));
const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'development',DYNAMICS_SANDBOX_URL:'https://orgd9e66399.crm.dynamics.com',DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on'};
for(const k of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET']){if(!input[k])throw Error(`Missing ${k}`);env[k]=input[k];}
const r=spawnSync(process.execPath,[path.join(__dirname,'apply-dataverse-schema.js'),'--target=sandbox','--wave=-expertise-roster',...(mode==='--execute'?['--execute']:[])],{env,stdio:'inherit'});process.exitCode=r.status??1;
