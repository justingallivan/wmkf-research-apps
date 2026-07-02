#!/usr/bin/env node
/** READ-ONLY: investigate the Christopher Walsh duplicate person records —
 * ids, email, contact link, createdon, and which suggestions/requests point at each.
 * Only POST is the OAuth token; every Dataverse call is a GET. */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID, client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status}`); return (await r.json()).access_token;
}
async function get(token, urlPath) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.include-annotations="*"' } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`); return b;
}
const fmt = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16).replace('T', ' ') : '—');
(async () => {
  const token = await getToken();
  const people = await get(token, `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_emailsource,_wmkf_contact_value,wmkf_primaryaffiliation,createdon&$filter=contains(wmkf_name,'Walsh')&$top=20`);
  for (const p of (people.value || [])) {
    const id = p.wmkf_potentialreviewersid;
    // suggestions pointing at this person
    const sug = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_selected&$filter=_wmkf_potentialreviewer_value eq ${id}&$top=50`);
    const reqNums = [];
    for (const s of (sug.value || [])) {
      const rq = s['_wmkf_request_value@OData.Community.Display.V1.FormattedValue'] || s._wmkf_request_value;
      reqNums.push(`${rq}${s.wmkf_selected ? '' : '(unsel)'}`);
    }
    console.log(`--- ${p.wmkf_name} | ${id}`);
    console.log(`    email=${p.wmkf_emailaddress || '∅'} (src=${p.wmkf_emailsource || '∅'}) contactLinked=${!!p._wmkf_contact_value} created=${fmt(p.createdon)}`);
    console.log(`    affiliation=${(p.wmkf_primaryaffiliation || '').slice(0, 120)}`);
    console.log(`    suggestions(${sug.value?.length || 0}): ${reqNums.join(', ') || '—'}`);
  }
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
