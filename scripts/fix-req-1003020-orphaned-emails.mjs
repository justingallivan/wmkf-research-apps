#!/usr/bin/env node
/**
 * DATA FIX (S317): populate wmkf_emailaddress for the two request-1003020 reviewers
 * whose email was orphaned in the affiliation by a partial enrichment run
 * (Christopher Walsh, Schahram Akbarian). Recomputes the email from the PERSISTED
 * affiliation with the same ContactParser.extractPrimaryEmail the shipped fix uses,
 * stamps wmkf_emailsource='affiliation', and guards on:
 *   - idempotency: skip if the email field is already set;
 *   - duplicate: skip if another person already owns that email (alt-key would 412).
 * Dry-run by default; pass --execute to write. Only writes are the two PATCHes.
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
const EXECUTE = process.argv.includes('--execute');
const TARGETS = [
  { name: 'Christopher Walsh', id: 'ce7d4a6b-1a74-f111-ab0f-000d3a306da2' },
  { name: 'Schahram Akbarian', id: '21be9bef-1874-f111-ab0f-000d3a306da2' },
];

const { ContactParser } = await import('../lib/utils/contact-parser.js');

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
async function api(token, method, urlPath, body) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let parsed; try { parsed = JSON.parse(t); } catch { parsed = t; }
  return { ok: r.ok, status: r.status, body: parsed };
}
async function get(token, urlPath) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' },
  });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  return b;
}

(async () => {
  const token = await getToken();
  console.log(EXECUTE ? '*** EXECUTE MODE — will write ***\n' : '--- DRY RUN (pass --execute to write) ---\n');
  for (const t of TARGETS) {
    const p = await get(token, `/wmkf_potentialreviewerses(${t.id})?$select=wmkf_name,wmkf_emailaddress,wmkf_emailsource,wmkf_primaryaffiliation`);
    const current = p.wmkf_emailaddress || null;
    const aff = p.wmkf_primaryaffiliation || '';
    const extracted = ContactParser.extractPrimaryEmail(aff);
    console.log(`=== ${p.wmkf_name} (${t.id}) ===`);
    console.log(`  current email : ${current || '∅'}`);
    console.log(`  affiliation   : ${aff.slice(0, 160)}`);
    console.log(`  extracted     : ${extracted || '(none)'}`);

    if (current) { console.log('  SKIP: email already set (idempotency).\n'); continue; }
    if (!extracted) { console.log('  SKIP: no email extractable from affiliation.\n'); continue; }

    // Duplicate guard: does another active person already own this email?
    const esc = extracted.replace(/'/g, "''");
    const dup = await get(token, `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,statecode&$filter=wmkf_emailaddress eq '${esc}'&$top=5`);
    const others = (dup.value || []).filter((r) => r.wmkf_potentialreviewersid.toLowerCase() !== t.id.toLowerCase());
    if (others.length) {
      console.log(`  SKIP: email already owned by ${others.length} other person row(s): ${others.map((o) => o.wmkf_name).join(', ')} — would 412 on the unique key.\n`);
      continue;
    }

    if (!EXECUTE) { console.log(`  WOULD WRITE: wmkf_emailaddress='${extracted}', wmkf_emailsource='affiliation'\n`); continue; }

    const res = await api(token, 'PATCH', `/wmkf_potentialreviewerses(${t.id})`, {
      wmkf_emailaddress: extracted,
      wmkf_emailsource: 'affiliation',
    });
    if (res.ok) console.log(`  WROTE: email=${res.body?.wmkf_emailaddress} source=${res.body?.wmkf_emailsource}\n`);
    else console.log(`  WRITE FAILED (${res.status}): ${JSON.stringify(res.body).slice(0, 240)}\n`);
  }
})().catch((e) => { console.error('FIX ERROR:', e.message); process.exit(1); });
