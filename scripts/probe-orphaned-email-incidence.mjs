#!/usr/bin/env node
/**
 * READ-ONLY: quantify how often reviewer person records were saved with an
 * ORPHANED email (empty wmkf_emailaddress but an extractable email in the
 * affiliation) — the durable fingerprint of incomplete contact enrichment
 * (Gap 1/3). A retained proxy for enrichment-timeout frequency, since Vercel
 * runtime logs are not kept. Reports the rate over a recency window and how
 * many distinct requests are affected.
 * Only POST is the OAuth token; every Dataverse call is a GET.
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
const DAYS = Number(process.argv[2] || 90);
const sinceIso = new Date(Date.now() - DAYS * 86400_000).toISOString();

const { ContactParser } = await import('../lib/utils/contact-parser.js');

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID, client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status}`); return (await r.json()).access_token;
}
async function getAll(token, urlPath) {
  let next = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`; const rows = [];
  while (next) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.maxpagesize=500' } });
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
    if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
    rows.push(...(b.value || [])); next = b['@odata.nextLink'] || null;
  }
  return rows;
}

(async () => {
  const token = await getToken();
  // All SELECTED suggestions created in the window, with their person id + request.
  const sugs = await getAll(token, `/wmkf_appreviewersuggestions?$select=_wmkf_potentialreviewer_value,_wmkf_request_value,createdon&$filter=wmkf_selected eq true and createdon ge ${sinceIso}`);
  const personIds = [...new Set(sugs.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  console.log(`Window: last ${DAYS}d (since ${sinceIso.slice(0,10)})`);
  console.log(`Selected suggestions: ${sugs.length}; distinct persons: ${personIds.length}\n`);

  // Hydrate persons in chunks.
  const persons = {};
  const CHUNK = 20;
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const chunk = personIds.slice(i, i + CHUNK);
    const orChain = chunk.map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const rows = await getAll(token, `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_primaryaffiliation,wmkf_organizationname,wmkf_metricsupdatedat&$filter=${encodeURIComponent(orChain)}`);
    for (const p of rows) persons[p.wmkf_potentialreviewersid] = p;
  }

  let noEmail = 0, orphaned = 0, noMetrics = 0;
  const orphanedByReq = {}; const orphanNames = [];
  for (const s of sugs) {
    const p = persons[s._wmkf_potentialreviewer_value]; if (!p) continue;
    const email = p.wmkf_emailaddress || null;
    if (!email) noEmail++;
    if (!p.wmkf_metricsupdatedat) noMetrics++;
    if (!email) {
      const aff = p.wmkf_primaryaffiliation || p.wmkf_organizationname || '';
      const extracted = ContactParser.extractPrimaryEmail(aff);
      if (extracted) {
        orphaned++;
        orphanedByReq[s._wmkf_request_value] = (orphanedByReq[s._wmkf_request_value] || 0) + 1;
        orphanNames.push(`${p.wmkf_name} <${extracted}>`);
      }
    }
  }
  const n = sugs.length || 1;
  const pct = (x) => `${x} (${(100 * x / n).toFixed(1)}%)`;
  console.log(`no email at all       : ${pct(noEmail)}`);
  console.log(`ORPHANED (email in aff): ${pct(orphaned)}   <-- recoverable by the Tier-0 fix`);
  console.log(`no metrics (proxy)    : ${pct(noMetrics)}`);
  console.log(`\nRequests with >=1 orphaned reviewer: ${Object.keys(orphanedByReq).length}`);
  console.log('Orphaned per request:', JSON.stringify(orphanedByReq));
  console.log('\nOrphaned reviewers:'); for (const nm of orphanNames) console.log('  -', nm);
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
