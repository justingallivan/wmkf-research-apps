#!/usr/bin/env node
/**
 * READ-ONLY probe: resolve the three Dataverse lookup GUIDs the honorarium
 * akoya_request create body needs (chunk-4). Run once per environment and set
 * the printed env vars (HONORARIUM_PROGRAM_ID / HONORARIUM_GRANTPROGRAM_ID /
 * HONORARIUM_TYPE_ID). See lib/bill/honorarium-discriminators.js.
 *
 *   akoya_program     = "Research Reviewer"  → akoya_programs.akoya_programid
 *   wmkf_grantprogram = "Honorarium"         → wmkf_grantprograms.<id>
 *   wmkf_type         = "Individual"         → wmkf_types.<id>
 *
 * akoya_program resolves by its verified `akoya_program` name attribute. For
 * wmkf_grantprograms / wmkf_types the primary-name attribute isn't assumed —
 * we list all rows with annotations and match the FormattedValue / any string
 * attribute equal to the target label, printing every candidate so a human can
 * confirm before setting the env var (duplicate-name hazard, atlas).
 *
 * Only POST is the OAuth token; every Dataverse call is a GET.
 */

const fs = require('fs');
const path = require('path');

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

const FV = '@OData.Community.Display.V1.FormattedValue';

function matchByLabel(rows, label, idKey) {
  // Return rows whose primary-name (any string attribute) equals `label`.
  return rows.filter((row) =>
    Object.entries(row).some(([k, v]) =>
      !k.includes('@') && typeof v === 'string' && v.trim().toLowerCase() === label.toLowerCase()),
  ).map((row) => ({ id: row[idKey], statecode: row[`statecode${FV}`] || row.statecode, row }));
}

(async () => {
  const token = await getToken();
  console.log(`Honorarium discriminator probe — ${new Date().toISOString()} (read-only)\n`);

  // 1. akoya_program "Research Reviewer" (verified name attribute).
  const progs = await get(token,
    `/akoya_programs?$select=akoya_programid,akoya_program,statecode&$filter=${encodeURIComponent("akoya_program eq 'Research Reviewer'")}`);
  console.log('akoya_program = "Research Reviewer":');
  for (const p of progs.value || []) console.log(`  HONORARIUM_PROGRAM_ID=${p.akoya_programid}   (statecode=${p[`statecode${FV}`] || p.statecode})`);
  if ((progs.value || []).length !== 1) console.log('  ⚠️  expected exactly ONE active match — confirm by GUID before setting.');

  // 2. wmkf_grantprograms "Honorarium" — list all, match by any string attr.
  const grantprograms = await get(token, `/wmkf_grantprograms?$top=200`);
  console.log('\nwmkf_grantprogram = "Honorarium" candidates:');
  const gpMatches = matchByLabel(grantprograms.value || [], 'Honorarium', Object.keys((grantprograms.value || [])[0] || {}).find(k => k.endsWith('id') && !k.includes('@')));
  for (const m of gpMatches) console.log(`  HONORARIUM_GRANTPROGRAM_ID=${m.id}   (statecode=${m.statecode})`);
  if (!gpMatches.length) console.log('  (no string-attribute match for "Honorarium"; inspect /wmkf_grantprograms manually)');

  // 3. wmkf_types "Individual".
  const types = await get(token, `/wmkf_types?$top=200`);
  console.log('\nwmkf_type = "Individual" candidates:');
  const tMatches = matchByLabel(types.value || [], 'Individual', Object.keys((types.value || [])[0] || {}).find(k => k.endsWith('id') && !k.includes('@')));
  for (const m of tMatches) console.log(`  HONORARIUM_TYPE_ID=${m.id}   (statecode=${m.statecode})`);
  if (!tMatches.length) console.log('  (no string-attribute match for "Individual"; inspect /wmkf_types manually)');

  console.log('\nSet the three env vars above (and BILLCOM_ACCOUNT_*_VALUE) before enabling BILL_ENABLED=true.');
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
