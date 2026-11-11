#!/usr/bin/env node
/** Read-only sandbox prompt/roster probe. Optional app credentials permit only
 * the model-list GET; provider inference and all sandbox writes are refused. */
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {parse}=require('dotenv');
const {buildSync}=require('esbuild');
const {assertTarget}=require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
async function main(){
 const filename=process.argv[2],staffFile=process.argv[3];if(![3,4].includes(process.argv.length)||!filename||!path.isAbsolute(filename)||(staffFile&&!path.isAbsolute(staffFile)))throw Error('Absolute private env paths required');
 const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Private regular env required');
 const env=parse(fs.readFileSync(filename));const {host}=assertTarget(env);
 const allowed=['DYNAMICS_URL','DYNAMICS_SANDBOX_URL','DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT','EXPERTISE_ROSTER_REHEARSAL','POSTGRES_URL','DATABASE_URL','POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL'];
 process.env=Object.fromEntries(allowed.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));process.env.NODE_ENV='development';
 if(staffFile){const staffStat=fs.lstatSync(staffFile);if(!staffStat.isFile()||staffStat.isSymbolicLink()||(staffStat.mode&0o077))throw Error('Private staff env required');const staff=parse(fs.readFileSync(staffFile));if(!staff.CLAUDE_API_KEY)throw Error('Application provider key unavailable');process.env.CLAUDE_API_KEY=staff.CLAUDE_API_KEY;}
 let modelListSucceeded=false;
 const originalFetch=global.fetch;global.fetch=async(input,options={})=>{const u=new URL(typeof input==='string'?input:input.url),method=String(options.method||'GET').toUpperCase();if(u.protocol!=='https:')throw Error('Network refused');if(u.hostname==='api.anthropic.com'){if(!staffFile||method!=='GET'||u.pathname!=='/v1/models')throw Error('Provider operation refused');const response=await originalFetch(input,{...options,redirect:'error'});if(response.ok)modelListSucceeded=true;return response;}if(!['login.microsoftonline.com',host].includes(u.hostname))throw Error('Network refused');if((u.hostname===host&&method!=='GET')||(u.hostname==='login.microsoftonline.com'&&(method!=='POST'||!/^\/[0-9a-f-]+\/oauth2\/v2\.0\/token$/i.test(u.pathname))))throw Error('Non-read operation refused');return originalFetch(input,{...options,redirect:'error'});};
 const entry=`
 import {createHash} from 'node:crypto';
 import {withDalContext} from './lib/dataverse/core/context.js';
 import {resolveToolPrompt} from './lib/services/tool-prompt-resolver.js';
 import {getCachedAvailableModels} from './lib/services/model-resolver.js';
 import {matchRosterSnapshot,assertRosterPrompt,EXPERTISE_FINDER_ROSTER_V2_ROW,buildRosterV2Variables} from './lib/services/expertise-finder/roster-match-contract.js';
 import {composeToolPromptPair} from './lib/services/tool-prompt-composer.js';
 import {DATA_CLASSES,wrapUntrustedContent,EXPERTISE_FINDER_PROPOSAL_MAX_CHARS} from './lib/utils/ai-payload-boundary.js';
 export async function run(){
  const snapshot=await withDalContext('roster-model-probe',()=>matchRosterSnapshot());
  const resolved=await resolveToolPrompt(EXPERTISE_FINDER_ROSTER_V2_ROW.promptName,EXPERTISE_FINDER_ROSTER_V2_ROW);assertRosterPrompt(resolved);
  const proposal='Synthetic grant research proposal for a controlled matching rehearsal. '.repeat(4);
  const wrapped=wrapUntrustedContent({text:proposal,source:'expertise-finder.match.proposalText',dataClass:DATA_CLASSES.PROPOSAL_TEXT,maxChars:EXPERTISE_FINDER_PROPOSAL_MAX_CHARS,label:'research proposal'});
  const vars=buildRosterV2Variables({rosterMembers:snapshot.rows,leadGuids:snapshot.leadGuids,wrappedProposal:wrapped.text});
  const pair=composeToolPromptPair({systemPrompt:resolved.systemPrompt,body:resolved.body},vars,{nonces:[]});
  const hash=value=>createHash('sha256').update(value).digest('hex');
  return {modelListed:getCachedAvailableModels().some(item=>item.id===resolved.model),promptSource:resolved.source,promptVersion:resolved.version,rawModel:resolved.rawModel,model:resolved.model,maxTokens:resolved.maxTokens,modelRegistry:'static fallback; no provider key or model-list request',promptSystemHash:hash(resolved.systemPrompt),promptBodyHash:hash(resolved.body),rosterCount:snapshot.rows.length,eligibleLeadCount:snapshot.leadGuids.length,syntheticInputUtf8Bytes:Buffer.byteLength(pair.systemPrompt)+Buffer.byteLength(pair.body),inputTokenEstimateMethod:'one token per UTF-8 byte; conservative heuristic, not a provider token count',inputEstimatedTokens:Buffer.byteLength(pair.systemPrompt)+Buffer.byteLength(pair.body)};
 }`;
 const compiled=buildSync({stdin:{contents:entry,resolveDir:path.resolve(__dirname,'..'),sourcefile:'roster-model-probe-entry.js'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'}).outputFiles[0].text;
 const mod=new Module(path.join(__dirname,'probe-roster-matching-bundle.cjs'),module);mod.filename=path.join(__dirname,'probe-roster-matching-bundle.cjs');mod.paths=module.paths;mod._compile(compiled,mod.filename);
 const result=await mod.exports.run();if(staffFile&&(!modelListSucceeded||!result.modelListed))throw Error('Provider model list unavailable or resolved model absent');if(staffFile)result.modelRegistry='live read-only model-list GET';console.log(JSON.stringify(result));
}
main().catch(()=>{console.error('Read-only roster model probe failed; no sensitive details emitted.');process.exitCode=1;});
