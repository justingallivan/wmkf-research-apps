#!/usr/bin/env node
/**
 * READ-ONLY: for request 1003020's selected reviewers, show whether an email
 * looks ENRICHMENT-WRITTEN (at save) vs MANUALLY ADDED LATER, using timestamps.
 * Compares the person record's createdon vs modifiedon and who modified it,
 * against when the suggestion row was created (the save moment).
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

const REQ_GUID = process.argv[2] || '8a0efbb3-8d45-f111-88b4-000d3a306da2';

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*"',
    },
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const fmt = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) : '—');

(async () => {
  const token = await getToken();
  const sugRes = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,createdon&$filter=_wmkf_request_value eq ${REQ_GUID} and wmkf_selected eq true&$top=200`);
  const suggestions = sugRes.value || [];

  const rows = [];
  for (const s of suggestions) {
    const pid = s._wmkf_potentialreviewer_value;
    let p = {};
    if (pid) {
      p = await get(token, `/wmkf_potentialreviewerses(${pid})?$select=wmkf_name,wmkf_emailaddress,createdon,modifiedon,_modifiedby_value,_createdby_value`);
    }
    const created = p.createdon;
    const modified = p.modifiedon;
    const modBy = p['_modifiedby_value@OData.Community.Display.V1.FormattedValue'] || p['modifiedby@OData.Community.Display.V1.FormattedValue'] || '?';
    const deltaMin = (created && modified) ? Math.round((new Date(modified) - new Date(created)) / 60000) : null;
    rows.push({
      name: p.wmkf_name || '(no name)',
      email: p.wmkf_emailaddress || '∅',
      saved: fmt(s.createdon),
      pCreated: fmt(created),
      pModified: fmt(modified),
      deltaMin,
      modBy,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  console.log('name | email | suggestionSaved | personCreated | personModified | Δmin(created→modified) | modifiedBy');
  console.log('-------------------------------------------------------------------------------------------------------');
  for (const r of rows) {
    console.log(`${r.name} | ${r.email} | ${r.saved} | ${r.pCreated} | ${r.pModified} | ${r.deltaMin ?? '—'} | ${r.modBy}`);
  }
  console.log('\nNote: a large Δ (person modified long after created) + email present suggests a LATER edit (possibly manual). A near-zero Δ means email landed at create/save time (enrichment).');
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
