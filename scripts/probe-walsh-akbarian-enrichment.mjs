#!/usr/bin/env node
/**
 * READ-ONLY: for Walsh & Akbarian on request 1003020, confirm whether
 * enrichment RAN (wmkf_lastchecked / wmkf_metricsupdatedat / wmkf_hindex set)
 * and whether the PERSISTED affiliation contains an email that the real
 * ContactParser.extractPrimaryEmail can pull out. Distinguishes
 * "enrichment ran but saw a different affiliation" from "parser can't extract".
 * Only POST is the OAuth token; every Dataverse call is a GET.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}
const REQ_GUID = '8a0efbb3-8d45-f111-88b4-000d3a306da2';
const NAMES = ['Walsh', 'Akbarian', 'Silva']; // Silva as the positive control

const { ContactParser } = await import('../lib/utils/contact-parser.js');

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
async function get(token, urlPath) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.include-annotations="*"' },
  });
  const t = await r.text(); let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

(async () => {
  const token = await getToken();
  const sugRes = await get(token, `/wmkf_appreviewersuggestions?$select=_wmkf_potentialreviewer_value&$filter=_wmkf_request_value eq ${REQ_GUID} and wmkf_selected eq true&$top=200`);
  for (const s of (sugRes.value || [])) {
    const id = s._wmkf_potentialreviewer_value; if (!id) continue;
    const p = await get(token, `/wmkf_potentialreviewerses(${id})?$select=wmkf_name,wmkf_emailaddress,wmkf_emailsource,wmkf_primaryaffiliation,wmkf_organizationname,wmkf_hindex,wmkf_areaofexpertise,wmkf_lastchecked,wmkf_metricsupdatedat`);
    const nm = p.wmkf_name || '';
    if (!NAMES.some((n) => nm.toLowerCase().includes(n.toLowerCase()))) continue;
    const aff = p.wmkf_primaryaffiliation || p.wmkf_organizationname || '';
    const parsed = ContactParser.extractPrimaryEmail(aff);
    console.log(`\n=== ${nm} ===`);
    console.log(`  persisted email     : ${p.wmkf_emailaddress || '∅'}  (source: ${p.wmkf_emailsource || '∅'})`);
    console.log(`  enrichment ran?     : lastChecked=${p.wmkf_lastchecked || '∅'}  metricsUpdatedAt=${p.wmkf_metricsupdatedat || '∅'}  hIndex=${p.wmkf_hindex ?? '∅'}`);
    console.log(`  persisted affiliation: ${aff.slice(0, 200)}`);
    console.log(`  ContactParser.extractPrimaryEmail(affiliation) => ${parsed || '(none)'}`);
    console.log(`  VERDICT: enrichment ${p.wmkf_lastchecked ? 'RAN' : 'did NOT run'}; affiliation ${parsed ? 'CONTAINS an extractable email' : 'has no extractable email'}; email field ${p.wmkf_emailaddress ? 'set' : 'EMPTY'}`);
  }
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
