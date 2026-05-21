#!/usr/bin/env node
/**
 * READ-ONLY: dump a single wmkf_potentialreviewers row by id, plus any
 * suggestions referencing it. Used to chase the 412 in Edit Candidate save.
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

const ID = process.argv[2] || '538989a9-f044-f111-88b4-000d3a306da2';

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
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240)}`);
  return body;
}

(async () => {
  const token = await getToken();
  console.log(`Probe: wmkf_potentialreviewers(${ID})\n`);
  try {
    const row = await get(token, `/wmkf_potentialreviewerses(${ID})`);
    console.log('Row:');
    for (const k of Object.keys(row).sort()) {
      if (k.startsWith('@') || k.includes('@OData')) continue;
      console.log(`  ${k.padEnd(38)} = ${JSON.stringify(row[k])}`);
    }
  } catch (e) {
    console.log(`Row fetch failed: ${e.message}`);
  }

  console.log('\nSuggestions referencing this person:');
  const sugs = await get(token,
    `/wmkf_appreviewersuggestions?$filter=${encodeURIComponent(`_wmkf_potentialreviewer_value eq ${ID}`)}&$select=wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_selected,createdon&$top=20`);
  for (const s of (sugs.value || [])) {
    console.log(`  ${s.wmkf_appreviewersuggestionid}  req=${s._wmkf_request_value}  selected=${s.wmkf_selected}  createdon=${s.createdon}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
