#!/usr/bin/env node
/**
 * Read-only probe: how many PDs already have a saved reviewer-email-templates
 * preference, and what shape (full snapshot vs partial)? Informs the S297
 * migration decision (existing full snapshots override the new admin defaults).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('='); if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
const { DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
const tokenResp = await fetch(`https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: DYNAMICS_CLIENT_ID, client_secret: DYNAMICS_CLIENT_SECRET, scope: `${DYNAMICS_URL}/.default` }).toString(),
});
const token = (await tokenResp.json()).access_token;
if (!token) { console.error('no token'); process.exit(1); }

const filter = encodeURIComponent("wmkf_preferencekey eq 'reviewer_email_templates'");
const url = `${DYNAMICS_URL}/api/data/v9.2/wmkf_appuserpreferences?$filter=${filter}&$select=wmkf_preferencevalue,wmkf_isencrypted,_ownerid_value`;
const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
if (!r.ok) { console.error(`ERROR ${r.status}: ${(await r.text()).slice(0, 300)}`); process.exit(1); }
const rows = (await r.json()).value || [];

console.log(`=== ${rows.length} PD(s) have a saved reviewer_email_templates pref ===\n`);
const TYPES = ['invitation', 'materials', 'followup', 'thankyou'];
for (const row of rows) {
  const owner = row['_ownerid_value@OData.Community.Display.V1.FormattedValue'] || row._ownerid_value;
  if (row.wmkf_isencrypted) { console.log(`- ${owner}: ENCRYPTED (len ${String(row.wmkf_preferencevalue || '').length})`); continue; }
  let parsed = null;
  try { parsed = JSON.parse(row.wmkf_preferencevalue); } catch { console.log(`- ${owner}: UNPARSEABLE`); continue; }
  const shape = TYPES.map((t) => {
    const has = parsed?.[t];
    if (!has) return `${t}:—`;
    const fields = ['subject', 'body'].filter((f) => typeof has[f] === 'string' && has[f].length > 0);
    return `${t}:${fields.join('+') || 'empty'}`;
  }).join('  ');
  console.log(`- ${owner}: ${shape}`);
}
