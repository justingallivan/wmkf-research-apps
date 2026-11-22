#!/usr/bin/env node
/** Read-only CLI-authorized Neon response-shape probe. No app credentials or DB writes.
 * node scripts/probe-neon-service-checks.cjs --cli-scope=<team-slug>
 * Only API responses pass into the actual collectors; CLI OAuth credentials never leave the CLI.
 */
const path=require('node:path');
const {execFileSync}=require('node:child_process');
(async()=>{
 const args=process.argv.slice(2);if(args.length!==1 || !/^--cli-scope=[a-zA-Z0-9][a-zA-Z0-9-]{0,100}$/.test(args[0]))throw new Error('scope required');
 const scope=args[0].slice('--cli-scope='.length);
 const api=p=>execFileSync('vercel',['api',p,'--scope',scope],{encoding:'utf8',maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
 const list=JSON.parse(api('/v1/integrations/configurations?view=account'));
 const matches=list.filter(c=>c.slug==='neon'&&c.installationType==='marketplace');
 if(matches.length!==1 || !/^icfg_[a-zA-Z0-9]+$/.test(matches[0].id))throw new Error('installation mismatch');
 const data=JSON.parse(api(`/v1/integrations/configuration/${matches[0].id}`));
 const outfile=path.resolve('.next/probes/neon-service-checks.cjs');
 await require('esbuild').build({entryPoints:['lib/services/external-services/check-sources.js'],outfile,bundle:true,platform:'node',format:'cjs',packages:'external'});
 process.env.VERCEL_SERVICE_CHECK_TOKEN='fixture-only';process.env.VERCEL_SERVICE_CHECK_TEAM_ID=data.teamId;
 global.fetch=async url=>new Response(JSON.stringify(new URL(url).pathname.endsWith('/configurations')?list:data));
 const {sourcesFor,collectSource}=require(outfile);
 for(const s of sourcesFor('neon')){
  const {result}=await collectSource(s,null,undefined,new Date().toISOString());
  console.log(JSON.stringify({key:result.key,status:result.status,lines:result.lines.length,attention:result.attention,appCredentialTested:false}));
  if(result.status==='unavailable')process.exitCode=1;
 }
})().catch(()=>{console.error('Neon response-shape probe failed; no snapshot written.');process.exitCode=1;});
