#!/usr/bin/env node
/**
 * READ-ONLY: RetrieveRecordChangeHistory for Alcino Silva's potential-reviewer
 * person record on request 1003020, to see exactly when/how/by-whom
 * wmkf_emailaddress changed (old->new value + true actor). Requires table
 * auditing to be enabled; prints a clear message if it is not.
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
const NAME_MATCH = (process.argv[3] || 'Alcino Silva').toLowerCase();

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
  return { ok: r.ok, status: r.status, body };
}
const fmt = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 19) : '—');

(async () => {
  const token = await getToken();
  // Find Silva's person id from the request's selected suggestions.
  const sugRes = await get(token, `/wmkf_appreviewersuggestions?$select=_wmkf_potentialreviewer_value&$filter=_wmkf_request_value eq ${REQ_GUID} and wmkf_selected eq true&$top=200`);
  if (!sugRes.ok) { console.error('suggestion query failed:', sugRes.status, JSON.stringify(sugRes.body).slice(0, 200)); return; }
  let pid = null, pname = null;
  for (const s of (sugRes.body.value || [])) {
    const id = s._wmkf_potentialreviewer_value;
    if (!id) continue;
    const p = await get(token, `/wmkf_potentialreviewerses(${id})?$select=wmkf_name`);
    const nm = p.ok ? (p.body.wmkf_name || '') : '';
    if (nm.toLowerCase().includes(NAME_MATCH)) { pid = id; pname = nm; break; }
  }
  if (!pid) { console.log(`Could not find a selected reviewer matching "${NAME_MATCH}".`); return; }
  console.log(`Person: ${pname} (${pid})\n`);

  // RetrieveRecordChangeHistory (unbound function, Target = entity reference).
  const target = encodeURIComponent(JSON.stringify({ '@odata.id': `wmkf_potentialreviewerses(${pid})` }));
  const hist = await get(token, `/RetrieveRecordChangeHistory(Target=@t)?@t=${target}`);
  if (!hist.ok) {
    console.log(`Audit history unavailable (status ${hist.status}). Likely auditing is NOT enabled for this table.`);
    console.log('Detail:', typeof hist.body === 'string' ? hist.body.slice(0, 300) : JSON.stringify(hist.body).slice(0, 400));
    return;
  }
  const details = hist.body?.AuditDetailCollection?.AuditDetails || [];
  console.log(`Audit entries: ${details.length}\n`);
  for (const d of details) {
    const a = d.AuditRecord || {};
    const when = fmt(a.createdon);
    const actor = a['_userid_value@OData.Community.Display.V1.FormattedValue'] || a['userid@OData.Community.Display.V1.FormattedValue'] || '?';
    const op = a['operation@OData.Community.Display.V1.FormattedValue'] || a.operation;
    const action = a['action@OData.Community.Display.V1.FormattedValue'] || a.action;
    const oldEmail = d.OldValue?.wmkf_emailaddress;
    const newEmail = d.NewValue?.wmkf_emailaddress;
    const emailChanged = (oldEmail !== undefined || newEmail !== undefined);
    const changedAttrs = Object.keys(d.NewValue || {}).filter((k) => !k.startsWith('@'));
    console.log(`${when} | ${actor} | ${action}/${op} | email: ${emailChanged ? `${oldEmail ?? '∅'} -> ${newEmail ?? '∅'}` : '(unchanged)'} | changed: ${changedAttrs.join(',') || '—'}`);
  }
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
