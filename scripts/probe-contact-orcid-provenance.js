#!/usr/bin/env node
/**
 * READ-ONLY provenance probe (S216): the cross-store probe found 409 `contact`
 * rows already carry wmkf_orcid — NOT written by us (contact has no wmkf_orcidurl,
 * our researcher adapter writes both; only 2 reviewers are promoted, 0 ORCID).
 * Where did they come from, and are they a reviewer population or a grant-applicant
 * population? That answer changes the back-propagation design.
 *
 * Signals pulled per contact: createdby/createdon (origin + time clustering),
 * akoya_entitysource + leadsourcecode (CRM source markers), and whether the contact
 * fills an applicant ROLE on any akoya_request. NOTE: the PI is `wmkf_projectleader`,
 * NOT `akoya_primarycontactid` (= foundation liaison) — see memory
 * project-institution-foundation-liaison; joining only on primary-contact undercounts
 * applicants ~200x. We check all three role lookups.
 * STRICTLY READ-ONLY. Output: console + scripts/.orcid-contact-provenance.json
 */
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
const API = `${process.env.DYNAMICS_URL}/api/data/v9.2`;
const FV = '@OData.Community.Display.V1.FormattedValue';
async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }) });
  if (!r.ok) throw new Error(`Token: ${r.status}`); return (await r.json()).access_token;
}
async function getAll(token, urlPath, annotate = false) {
  let next = `${API}${urlPath}`; const rows = [];
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' };
  if (annotate) headers.Prefer = 'odata.include-annotations="*"';
  while (next) {
    const r = await fetch(next, { headers });
    const t = await r.text(); let body; try { body = JSON.parse(t); } catch { body = t; }
    if (!r.ok) throw new Error(`GET ${urlPath.slice(0, 70)}: ${r.status} ${String(t).slice(0, 160)}`);
    if (body.value) { for (const v of body.value) rows.push(v); next = body['@odata.nextLink']; } else return body;
  }
  return { value: rows };
}
const tally = (arr, keyFn) => { const m = new Map(); for (const x of arr) { const k = keyFn(x) || '(none)'; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };

(async () => {
  const token = await getToken();
  const stamp = new Date().toISOString();
  console.log(`Contact ORCID provenance probe — ${stamp} (READ-ONLY)\n${'='.repeat(70)}`);

  const SELECT = 'contactid,fullname,emailaddress1,wmkf_orcid,createdon,modifiedon,_createdby_value,_modifiedby_value,akoya_entitysource,leadsourcecode';
  const contacts = (await getAll(token,
    `/contacts?$select=${SELECT}&$filter=${encodeURIComponent('wmkf_orcid ne null')}`, true)).value;
  console.log(`\ncontacts with wmkf_orcid populated: ${contacts.length}`);

  console.log(`\n--- createdby (origin) ---`);
  for (const [k, n] of tally(contacts, (c) => c[`_createdby_value${FV}`])) console.log(`  ${n.toString().padStart(4)}  ${k}`);

  console.log(`\n--- modifiedby (who last touched) ---`);
  for (const [k, n] of tally(contacts, (c) => c[`_modifiedby_value${FV}`])) console.log(`  ${n.toString().padStart(4)}  ${k}`);

  console.log(`\n--- akoya_entitysource ---`);
  for (const [k, n] of tally(contacts, (c) => c[`akoya_entitysource${FV}`])) console.log(`  ${n.toString().padStart(4)}  ${k}`);

  console.log(`\n--- leadsourcecode ---`);
  for (const [k, n] of tally(contacts, (c) => c[`leadsourcecode${FV}`])) console.log(`  ${n.toString().padStart(4)}  ${k}`);

  console.log(`\n--- createdon by year ---`);
  for (const [k, n] of tally(contacts, (c) => (c.createdon || '').slice(0, 4)).sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${n.toString().padStart(4)}  ${k}`);

  // Are these contacts grant applicants? Check the three akoya_request person ROLES.
  // PI = wmkf_projectleader; akoya_primarycontactid = foundation liaison (NOT the PI).
  const ids = contacts.map((c) => c.contactid);
  const ROLES = ['_akoya_primarycontactid_value', '_wmkf_projectleader_value', '_wmkf_researchleader_value'];
  const hit = Object.fromEntries(ROLES.map((r) => [r, new Set()]));
  const BATCH = 12;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    for (const role of ROLES) {
      const filter = slice.map((id) => `${role} eq ${id}`).join(' or ');
      const found = (await getAll(token, `/akoya_requests?$select=akoya_requestid,${role}&$filter=${encodeURIComponent(filter)}`)).value;
      for (const rq of found) if (rq[role]) hit[role].add(rq[role]);
    }
  }
  const union = new Set([...hit._akoya_primarycontactid_value, ...hit._wmkf_projectleader_value, ...hit._wmkf_researchleader_value]);
  console.log(`\n--- grant-applicant signal (ORCID-contacts filling an akoya_request person role) ---`);
  for (const role of ROLES) console.log(`  ${role.padEnd(34)} ${hit[role].size}`);
  console.log(`  UNION (any role): ${union.size} (${((union.size / contacts.length) * 100).toFixed(1)}%) — these are grant applicants, largely disjoint from reviewers`);

  const out = {
    stamp, total: contacts.length,
    createdBy: tally(contacts, (c) => c[`_createdby_value${FV}`]),
    entitySource: tally(contacts, (c) => c[`akoya_entitysource${FV}`]),
    byYear: tally(contacts, (c) => (c.createdon || '').slice(0, 4)),
    asApplicantByRole: Object.fromEntries(ROLES.map((r) => [r, hit[r].size])),
    asApplicantUnion: union.size,
  };
  fs.writeFileSync(path.join(__dirname, '.orcid-contact-provenance.json'), JSON.stringify(out, null, 2));
  console.log(`\n${'='.repeat(70)}\nArtifact: scripts/.orcid-contact-provenance.json`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
