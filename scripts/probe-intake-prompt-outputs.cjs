#!/usr/bin/env node
/** Read-only: show the J27 intake prompt outputs on one Request and its AI run records.
 * Owner-run only (production reads need DATAVERSE_ALLOW_PROD_READS=yes set by the owner).
 * Usage: node scripts/probe-intake-prompt-outputs.cjs --target=prod --request=<request number> */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
(async () => {
  const num = arg('request');
  if (arg('target') !== 'prod' || !/^\d{6,8}$/.test(num)) throw new Error('Specify --target=prod --request=<number>');
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('Target URL is not configured');
  const c = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), dryRun: true });
  const ann = { Prefer: 'odata.include-annotations="*"' };
  const fmt = (r, k) => r[`${k}@OData.Community.Display.V1.FormattedValue`] ?? r[k];
  const fields = { 'Short title': 'wmkf_wmkfprojectdescription', 'Executive Summary': 'wmkf_layabstract',
    'Methodology': 'wmkf_ai_methodologysummary', 'Personnel': 'wmkf_ai_teaminfo' };
  const r = await c.get(`/akoya_requests?$filter=akoya_requestnum eq '${num}'&$select=akoya_requestid,akoya_title,_wmkf_projectleader_value,${Object.values(fields).join(',')}`, ann);
  if (!r.ok) throw new Error(`Request HTTP ${r.status}`);
  if (r.body.value.length !== 1) throw new Error(`Request HTTP 200 but ${r.body.value.length} rows`);
  const req = r.body.value[0];
  const words = (t) => (t ? t.trim().split(/\s+/).length : 0);
  const sentences = (t) => (t ? (t.match(/[.!?](\s|$)/g) || []).length : 0);
  console.log(`Request ${num}: "${req.akoya_title}"  | Project Leader: ${fmt(req, '_wmkf_projectleader_value')}`);
  for (const [label, f] of Object.entries(fields)) {
    const t = req[f];
    console.log(`\n=== ${label} (${f}) — ${t ? `${words(t)} words, ${sentences(t)} sentences, ${t.length} chars` : 'EMPTY'}\n${t ?? ''}`);
  }
  const runs = await c.get(`/wmkf_ai_runs?$filter=_wmkf_ai_request_value eq ${req.akoya_requestid}&$orderby=createdon desc&$top=20`, ann);
  if (!runs.ok) throw new Error(`AI run HTTP ${runs.status}`);
  console.log(`\n=== AI run records for this request (${runs.body.value.length}, newest first)`);
  for (const x of runs.body.value) {
    const keep = {};
    for (const [k, v] of Object.entries(x)) {
      if (k.includes('@') || v === null || v === '') continue;
      if (!/^(wmkf_ai_|createdon)/.test(k)) continue;
      if (/rawoutput|promptoverride$/.test(k)) { keep[k] = `<${String(v).length} chars>`; continue; }
      keep[k] = fmt(x, k);
    }
    console.log(JSON.stringify(keep));
  }
})().catch((e) => { console.error(`Probe failed: ${/HTTP|Specify|Target|rows/.test(e.message) ? e.message : 'authentication or transport failure'}`); process.exitCode = 1; });
