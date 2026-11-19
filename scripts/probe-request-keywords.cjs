#!/usr/bin/env node
/** Read-only: show which Request field holds the main discipline keyword.
 * Prints (1) how many Requests have each candidate field filled, overall and created in the
 * last 12 months, and (2) the three candidate fields, with the linked keyword's Type / Branch
 * / Group, for each Request number given or, with none given, for the 25 most recently
 * created Requests from the last 60 days (--days=<n>) that have any of the fields filled. Candidates: the lookups `wmkf_programlevel3` and
 * `wmkf_programareaserved`, and the text field `wmkf_ai_keywords`.
 * Owner-run only (production reads need DATAVERSE_ALLOW_PROD_READS=yes set by the owner).
 * Usage: node scripts/probe-request-keywords.cjs --target=prod [--request=<number>[,<number>...]] [--days=<n>] */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const LOOKUPS = ['_wmkf_programlevel3_value', '_wmkf_programareaserved_value'];
const TEXT = 'wmkf_ai_keywords';
(async () => {
  const numbers = (arg('request') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const days = Number(arg('days') || 60);
  if (arg('target') !== 'prod' || numbers.some((n) => !/^\d{6,8}$/.test(n)) || !Number.isInteger(days) || days < 1 || days > 730) {
    throw new Error('Specify --target=prod and, optionally, --request=<number>[,<number>...]');
  }
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('Target URL is not configured');
  const c = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), dryRun: true });
  const ann = { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' };
  const get = async (path, headers) => {
    const r = await c.get(path, headers);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${path.split('?')[0]}`);
    return r.body;
  };
  const fmt = (r, k) => r[`${k}@OData.Community.Display.V1.FormattedValue`] ?? r[k] ?? '(blank)';
  const count = async (filter) =>
    (await get(`/akoya_requests?$select=akoya_requestid&$filter=${encodeURIComponent(filter)}&$count=true&$top=1`,
      { Prefer: 'odata.include-annotations="*"' }))['@odata.count'];

  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  console.log(`# Requests with each field filled (all time / created since ${since})`);
  for (const field of [...LOOKUPS, TEXT]) {
    const all = await count(`${field} ne null`);
    const recent = await count(`${field} ne null and createdon ge ${since}`);
    console.log(`  ${field}: ${all} / ${recent}`);
  }

  const cache = new Map();
  const keyword = async (id) => {
    if (!id) return '(empty)';
    if (!cache.has(id)) {
      const k = await get(`/wmkf_programlevel3s(${id})?$select=wmkf_name,wmkf_keywordtype,wmkf_keyworddisciplinebranch,wmkf_keyworddisciplinegroup`, ann);
      cache.set(id, `"${k.wmkf_name}"  [Type: ${fmt(k, 'wmkf_keywordtype')} | Branch: ${fmt(k, 'wmkf_keyworddisciplinebranch')} | Group: ${fmt(k, 'wmkf_keyworddisciplinegroup')}]`);
    }
    return cache.get(id);
  };
  const select = `akoya_requestnum,akoya_title,createdon,_akoya_programid_value,${LOOKUPS.join(',')},${TEXT}`;
  const show = async (req) => {
    console.log(`\n# Request ${req.akoya_requestnum}: "${req.akoya_title}" (created ${String(req.createdon).slice(0, 10)}; program ${fmt(req, '_akoya_programid_value')})`);
    for (const field of LOOKUPS) console.log(`  ${field}: ${await keyword(req[field])}`);
    const text = req[TEXT];
    console.log(`  ${TEXT}: ${text ? `${text.length} chars: ${text.slice(0, 400)}` : '(empty)'}`);
  };
  if (numbers.length) {
    for (const num of numbers) {
      const r = await get(`/akoya_requests?$filter=akoya_requestnum eq '${num}'&$select=${select}`, ann);
      if (r.value.length !== 1) { console.log(`\n# Request ${num}: ${r.value.length} rows found`); continue; }
      await show(r.value[0]);
    }
  } else {
    const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const filter = `(${[...LOOKUPS, TEXT].map((f) => `${f} ne null`).join(' or ')}) and createdon ge ${from}`;
    const r = await get(`/akoya_requests?$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=createdon desc&$top=25`, ann);
    console.log(`\n# Most recent Requests created since ${from} with any keyword field filled: ${r.value.length} shown (limit 25)`);
    for (const req of r.value) await show(req);
  }
})().catch((e) => { console.error(`Probe failed: ${/HTTP|Specify|Target/.test(e.message) ? e.message : 'authentication or transport failure'}`); process.exitCode = 1; });
