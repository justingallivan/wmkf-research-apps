#!/usr/bin/env node

/**
 * Read-only probe: is auditing enabled (and capturing change history) for the
 * custom settings table wmkf_appsystemsetting? This decides whether an
 * accidentally-blanked admin email default can be recovered natively from
 * Dataverse's audit log (vs. needing a code seed / backup).
 *
 * Checks, all GET:
 *   1. Org-level isauditenabled (master switch).
 *   2. Entity-level IsAuditEnabled for wmkf_appsystemsetting.
 *   3. Attribute-level IsAuditEnabled for wmkf_settingvalue (the value column).
 *   4. Whether audit rows actually exist for the table (proof history is captured).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const { DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!DYNAMICS_URL || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  console.error('Missing Dynamics credentials in env');
  process.exit(1);
}

const tokenResp = await fetch(
  `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: DYNAMICS_CLIENT_ID,
      client_secret: DYNAMICS_CLIENT_SECRET,
      scope: `${DYNAMICS_URL}/.default`,
    }).toString(),
  },
);
const token = (await tokenResp.json()).access_token;
if (!token) { console.error('Failed to acquire token'); process.exit(1); }

const base = `${DYNAMICS_URL}/api/data/v9.2`;
async function get(path) {
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, json, text };
}

// 1. Org master switch
const org = await get(`/organizations?$select=name,isauditenabled`);
const orgRow = org.json?.value?.[0];
console.log('=== 1. Org-level auditing ===');
console.log(org.ok ? `  isauditenabled = ${orgRow?.isauditenabled}` : `  ERROR ${org.status}: ${org.text.slice(0, 200)}`);

// 2. Entity-level
const ent = await get(`/EntityDefinitions(LogicalName='wmkf_appsystemsetting')?$select=LogicalName,IsAuditEnabled`);
console.log('\n=== 2. Entity wmkf_appsystemsetting ===');
console.log(ent.ok ? `  IsAuditEnabled = ${JSON.stringify(ent.json?.IsAuditEnabled)}` : `  ERROR ${ent.status}: ${ent.text.slice(0, 200)}`);

// 3. Attribute-level (the value column)
const attr = await get(`/EntityDefinitions(LogicalName='wmkf_appsystemsetting')/Attributes(LogicalName='wmkf_settingvalue')?$select=LogicalName,IsAuditEnabled`);
console.log('\n=== 3. Attribute wmkf_settingvalue ===');
console.log(attr.ok ? `  IsAuditEnabled = ${JSON.stringify(attr.json?.IsAuditEnabled)}` : `  ERROR ${attr.status}: ${attr.text.slice(0, 200)}`);

// 4. Do audit rows actually exist for this table?
const aud = await get(`/audits?$filter=${encodeURIComponent("objecttypecode eq 'wmkf_appsystemsetting'")}&$select=createdon,action,operation,_userid_value&$top=5&$orderby=createdon desc`);
console.log('\n=== 4. Audit rows for wmkf_appsystemsetting (top 5) ===');
if (aud.ok) {
  const rows = aud.json?.value || [];
  console.log(`  ${rows.length} row(s) returned`);
  for (const r of rows) {
    console.log(`   ${r.createdon}  action=${r.action} operation=${r.operation}  by=${r['_userid_value@OData.Community.Display.V1.FormattedValue'] || r._userid_value}`);
  }
} else {
  console.log(`  ERROR ${aud.status}: ${aud.text.slice(0, 300)}`);
}
