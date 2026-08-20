#!/usr/bin/env node

/**
 * Read-only, aggregate-only probe: which twin of the program-area-served /
 * support-type / population-served field pairs actually carries data?
 *
 * For each candidate field on akoya_request, reports via FetchXML aggregates:
 *   - populated row count (total)
 *   - populated count split by legacy-import provenance (akoya_dc_importid
 *     not-null = migrated from the prior grants system)
 *   - populated count per creation year (cutoff detection)
 *
 * Emits counts and years only — no record values, ids, or names.
 * Auth pattern mirrors scripts/dynamics-schema-diff.js (client credentials).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const contents = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sep = trimmed.indexOf('=');
      if (sep === -1) continue;
      const key = trimmed.slice(0, sep).trim();
      const value = trimmed.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const { DYNAMICS_URL, DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!DYNAMICS_URL || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  console.error('Missing DYNAMICS_URL / DYNAMICS_TENANT_ID / DYNAMICS_CLIENT_ID / DYNAMICS_CLIENT_SECRET');
  process.exit(1);
}

const tokenResp = await fetch(`https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: DYNAMICS_CLIENT_ID,
    client_secret: DYNAMICS_CLIENT_SECRET,
    scope: `${DYNAMICS_URL}/.default`,
  }),
});
if (!tokenResp.ok) { console.error('Auth failed:', tokenResp.status); process.exit(1); }
const { access_token } = await tokenResp.json();
console.log('✓ Authenticated');

async function fetchXml(xml) {
  const url = `${DYNAMICS_URL}/api/data/v9.2/akoya_requests?fetchXml=${encodeURIComponent(xml)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 300);
    throw new Error(`HTTP ${resp.status}: ${body}`);
  }
  return (await resp.json()).value;
}

const countXml = (conditions) => `
<fetch aggregate="true">
  <entity name="akoya_request">
    <attribute name="akoya_requestid" alias="n" aggregate="count"/>
    <filter type="and">${conditions}</filter>
  </entity>
</fetch>`;

const yearXml = (field) => `
<fetch aggregate="true">
  <entity name="akoya_request">
    <attribute name="akoya_requestid" alias="n" aggregate="count"/>
    <attribute name="createdon" alias="yr" groupby="true" dategrouping="year"/>
    <filter type="and"><condition attribute="${field}" operator="not-null"/></filter>
  </entity>
</fetch>`;

const FIELDS = [
  'wmkf_programareaserved_socal',
  'wmkf_programareaservedsocal',
  'wmkf_programareaserved_research',
  'wmkf_programareaservedresearch',
  'wmkf_supporttype',
  'wmkf_supporttype2',
  'wmkf_populationserved',
  'wmkf_populationserved2',
  // akoyaGO "Data Conversion" crosswalk family (legacy Blackbaud keys)
  'akoya_dc_importid',
  'akoya_dc_app',
  'akoya_dc_num',
  'akoya_dc_ser',
  'akoya_dc_payeeser',
  'akoya_dc_finished',
];

async function safeCount(label, conditions) {
  try {
    const rows = await fetchXml(countXml(conditions));
    return rows[0]?.n ?? 0;
  } catch (err) {
    return `ERR ${err.message.slice(0, 120)}`;
  }
}

const results = [];
for (const f of FIELDS) {
  const populated = await safeCount(f, `<condition attribute="${f}" operator="not-null"/>`);
  const migrated = await safeCount(f,
    `<condition attribute="${f}" operator="not-null"/><condition attribute="akoya_dc_importid" operator="not-null"/>`);
  const native = await safeCount(f,
    `<condition attribute="${f}" operator="not-null"/><condition attribute="akoya_dc_importid" operator="null"/>`);
  results.push({ field: f, populated, legacy_import: migrated, native });
}
console.log('\n=== Populated counts by twin and provenance ===');
console.table(results);

console.log('\n=== Populated rows per creation year (cutoff detection) ===');
for (const f of FIELDS) {
  try {
    const rows = await fetchXml(yearXml(f));
    const hist = rows
      .map(r => `${r.yr}:${r.n}`)
      .join('  ');
    console.log(`${f}\n  ${hist || '(no populated rows)'}`);
  } catch (err) {
    console.log(`${f}\n  ERR ${err.message.slice(0, 120)}`);
  }
}

console.log('\nDone. Aggregate counts only; no record-level data emitted.');
