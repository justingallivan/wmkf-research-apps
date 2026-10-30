#!/usr/bin/env node
/** Offline only: prepare durable request state; readback logic is in the client port.
 * No tokens, network, draft creation or execute mode. Live transport is not wired.
 */
const fs=require('node:fs'),path=require('node:path');
const client=require('../lib/prompt-publication/first-publication-client');
const {parseJson}=require('../lib/prompt-publication/json-contract');
function main(args){
 if(args.length!==6||args[0]!=='--observation'||args[2]!=='--request-id'||args[4]!=='--output'||!path.isAbsolute(args[1])||!path.isAbsolute(args[5])||fs.existsSync(args[5]))throw new Error('Use --observation ABS --request-id UUID --output NEW_ABS; no execute mode.');
 const input=parseJson(fs.readFileSync(args[1],'utf8'));
 const state=client.prepare(input.observation,input.expectedActor,args[3]);
 fs.writeFileSync(args[5],JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('Prepared original request state. No draft creation or publication; retain this file and UUID on unknown outcomes.');
}
module.exports={main};if(require.main===module)main(process.argv.slice(2));
