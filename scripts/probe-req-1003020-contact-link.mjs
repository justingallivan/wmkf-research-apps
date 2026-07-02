#!/usr/bin/env node
/**
 * READ-ONLY: test the hypothesis that emails on request 1003020's reviewers
 * SURFACED because the person was linked/promoted to an existing CRM contact.
 * For each selected reviewer: is _wmkf_contact_value set? If so, pull the
 * contact's email/name/createdon and compare to the person's email.
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
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.include-annotations="*"' },
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}
const fmt = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) : '—');

(async () => {
  const token = await getToken();
  const sugRes = await get(token, `/wmkf_appreviewersuggestions?$select=_wmkf_potentialreviewer_value&$filter=_wmkf_request_value eq ${REQ_GUID} and wmkf_selected eq true&$top=200`);
  const suggestions = sugRes.value || [];

  const rows = [];
  for (const s of suggestions) {
    const pid = s._wmkf_potentialreviewer_value;
    if (!pid) continue;
    const p = await get(token, `/wmkf_potentialreviewerses(${pid})?$select=wmkf_name,wmkf_emailaddress,_wmkf_contact_value`);
    const contactId = p._wmkf_contact_value || null;
    let contact = null;
    if (contactId) {
      try {
        contact = await get(token, `/contacts(${contactId})?$select=fullname,emailaddress1,emailaddress2,createdon`);
      } catch (e) { contact = { _error: e.message.slice(0, 80) }; }
    }
    rows.push({
      name: p.wmkf_name || '(no name)',
      personEmail: p.wmkf_emailaddress || '∅',
      linked: !!contactId,
      contactName: contact?.fullname || '—',
      contactEmail: contact ? (contact.emailaddress1 || contact.emailaddress2 || '∅') : '—',
      contactCreated: contact?.createdon ? fmt(contact.createdon) : '—',
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  console.log('name | personEmail | contactLinked | contactName | contactEmail | contactCreated');
  console.log('---------------------------------------------------------------------------------');
  for (const r of rows) {
    console.log(`${r.name} | ${r.personEmail} | ${r.linked} | ${r.contactName} | ${r.contactEmail} | ${r.contactCreated}`);
  }
  const linked = rows.filter((r) => r.linked);
  console.log(`\nSUMMARY: ${rows.length} reviewers; ${linked.length} linked to a CRM contact.`);
  console.log('Emails matching the linked contact (surfaced-from-contact):',
    JSON.stringify(rows.filter((r) => r.linked && r.personEmail !== '∅' && r.personEmail.toLowerCase() === String(r.contactEmail).toLowerCase()).map((r) => r.name)));
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
