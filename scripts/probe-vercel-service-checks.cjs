#!/usr/bin/env node
/** Read-only public collector smoke. No env file load, DB, or snapshot write. Account read requires explicit --cli-scope.
 * Run from repository root: node scripts/probe-vercel-service-checks.cjs
 * Optional: --cli-scope=<verified-team-slug> reads FOCUS through the signed-in CLI,
 * then validates the response offline; it never reads or copies CLI credentials.
 * Bundles current sources under ignored .next/probes for Node's local dependency resolution.
 */
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
  const args=process.argv.slice(2);
  if(args.length>1 || (args.length && !/^--cli-scope=[a-zA-Z0-9][a-zA-Z0-9-]{0,100}$/.test(args[0]))) throw new Error('Invalid arguments');
  const outfile = path.resolve('.next/probes/vercel-service-checks.cjs');
  await esbuild.build({entryPoints:['lib/services/external-services/check-sources.js'],outfile,bundle:true,platform:'node',format:'cjs',packages:'external'});
  const { sourcesFor, collectSource } = require(outfile);
  let failed=false;
  for (const source of sourcesFor('vercel-hosting').filter(s=>s.key!=='usage')) {
    const {result}=await collectSource(source,null,AbortSignal.timeout(30000),new Date().toISOString());
    console.log(JSON.stringify({key:result.key,status:result.status,attention:result.attention,excerptCount:result.lines.length}));
    failed ||= result.status==='unavailable';
  }
  if (args.length) {
    const end=new Date();end.setUTCHours(0,0,0,0);
    const start=new Date(end.getTime()-7*86400000);
    const query=new URLSearchParams({from:start.toISOString(),to:end.toISOString()});
    const body=require('node:child_process').execFileSync('vercel',['api',`/v1/billing/charges?${query}`,'--scope',args[0].slice('--cli-scope='.length)],{encoding:'utf8',maxBuffer:9*1024*1024,stdio:['ignore','pipe','pipe']});
    // Only response-shape testing: these dummy values never leave this process.
    const savedFetch=global.fetch;
    const oldToken=process.env.VERCEL_SERVICE_CHECK_TOKEN, oldTeam=process.env.VERCEL_SERVICE_CHECK_TEAM_ID;
    try {
      process.env.VERCEL_SERVICE_CHECK_TOKEN='fixture-only';process.env.VERCEL_SERVICE_CHECK_TEAM_ID='team_fixture';
      global.fetch=async()=>new Response(body);
      const {result}=await collectSource(sourcesFor('vercel-hosting').find(s=>s.key==='usage'),null,undefined,new Date().toISOString());
      console.log(JSON.stringify({key:'usage-shape-only',status:result.status,bytes:Buffer.byteLength(body),retainedLines:result.lines.length,appCredentialTested:false}));
      failed ||= result.status==='unavailable';
    } finally {
      global.fetch=savedFetch;
      if(oldToken===undefined)delete process.env.VERCEL_SERVICE_CHECK_TOKEN;else process.env.VERCEL_SERVICE_CHECK_TOKEN=oldToken;
      if(oldTeam===undefined)delete process.env.VERCEL_SERVICE_CHECK_TEAM_ID;else process.env.VERCEL_SERVICE_CHECK_TEAM_ID=oldTeam;
    }
  }
  process.exitCode=failed?1:0;
})().catch(()=>{console.error('Vercel collector probe failed; no snapshot was written.');process.exitCode=1;});
