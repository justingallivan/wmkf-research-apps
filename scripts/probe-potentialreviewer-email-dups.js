#!/usr/bin/env node
/**
 * READ-ONLY probe: are there duplicate wmkf_potentialreviewers rows on the
 * email that's tripping the 412 entity-key error from Edit Candidate save?
 *
 * Default email = chrischang@princeton.edu (the row from the bug report,
 * id 538989a9-f044-f111-88b4-000d3a306da2). Override with --email=foo@bar.
 *
 * Output: every row matching the email (with id, name, org, createdon,
 * modifiedon) so we can tell whether (a) it's a single self-collision
 * (Dataverse alternate-key oddity on unchanged value) or (b) there really
 * are two+ rows sharing the email.
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

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a, true];
}));
const EMAIL = args.email || 'chrischang@princeton.edu';

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
  return body.value || [];
}

(async () => {
  const token = await getToken();
  console.log(`Probe: wmkf_potentialreviewers rows with email = ${EMAIL}\n`);

  const sel = 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_organizationname,' +
    '_wmkf_contact_value,createdon,modifiedon,statecode';
  const safe = EMAIL.replace(/'/g, "''");
  const rows = await get(token,
    `/wmkf_potentialreviewerses?$filter=${encodeURIComponent(`wmkf_emailaddress eq '${safe}'`)}&$select=${sel}&$orderby=createdon asc&$top=50`);

  console.log(`Found ${rows.length} row(s).\n`);
  for (const r of rows) {
    console.log(`  id            : ${r.wmkf_potentialreviewersid}`);
    console.log(`  name          : ${r.wmkf_name || '(blank)'}`);
    console.log(`  email         : ${r.wmkf_emailaddress}`);
    console.log(`  org           : ${r.wmkf_organizationname || '(blank)'}`);
    console.log(`  contact link  : ${r._wmkf_contact_value || '(none)'}`);
    console.log(`  statecode     : ${r.statecode} (${r['statecode@OData.Community.Display.V1.FormattedValue']})`);
    console.log(`  createdon     : ${r.createdon}`);
    console.log(`  modifiedon    : ${r.modifiedon}`);
    console.log('');
  }

  if (rows.length === 0) {
    console.log('No rows. Either the email was edited away or the wrong env is being probed.');
  } else if (rows.length === 1) {
    console.log('Single row — the 412 is a self-collision on alternate-key revalidation.');
    console.log('Fix at adapter layer: skip writing fields whose value equals the existing row.');
  } else {
    console.log(`⚠️  ${rows.length} rows share this email. The alternate key is being violated by REAL duplicate data.`);
    console.log('   Connor / data steward needs to consolidate before any update on this email will succeed.');
  }
})().catch((e) => { console.error(e); process.exit(1); });
