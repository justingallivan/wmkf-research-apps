#!/usr/bin/env node
/**
 * READ-ONLY follow-up to probe-orcid-cross-store-matches.js (S216): the first probe
 * surfaced that `contact` HAS a native `wmkf_orcid` attribute (falsifying the
 * "GOapply stores are email-only" assumption). This measures whether that attribute
 * is POPULATED and whether a DIRECT ORCID<->ORCID join beats the 11.9% email bridge:
 *   - how many `contact` rows have wmkf_orcid populated (and is it our backfill or pre-existing?)
 *   - direct join: reviewer.wmkf_orcid present in contact.wmkf_orcid set
 *   - of the email-matched contacts, how many already carry an ORCID (agree/conflict/empty)
 * STRICTLY READ-ONLY. Output: console + scripts/.orcid-contact-direct.json
 */
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
const API = `${process.env.DYNAMICS_URL}/api/data/v9.2`;
async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }) });
  if (!r.ok) throw new Error(`Token: ${r.status}`); return (await r.json()).access_token;
}
async function getAll(token, urlPath) {
  let next = `${API}${urlPath}`; const rows = [];
  while (next) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' } });
    const t = await r.text(); let body; try { body = JSON.parse(t); } catch { body = t; }
    if (!r.ok) throw new Error(`GET ${urlPath.slice(0, 70)}: ${r.status} ${String(t).slice(0, 160)}`);
    if (body.value) { for (const v of body.value) rows.push(v); next = body['@odata.nextLink']; } else return body;
  }
  return { value: rows };
}
const normOrcid = (v) => { if (!v) return null; const m = String(v).match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i); return m ? m[1].toUpperCase() : null; };
const normEmail = (e) => (e || '').trim().toLowerCase() || null;

(async () => {
  const token = await getToken();
  const stamp = new Date().toISOString();
  console.log(`ORCID contact direct-join probe — ${stamp} (READ-ONLY)\n${'='.repeat(70)}`);

  // 1. contacts with wmkf_orcid populated
  const contacts = (await getAll(token,
    `/contacts?$select=contactid,emailaddress1,wmkf_orcid,fullname&$filter=${encodeURIComponent('wmkf_orcid ne null')}`)).value;
  for (const c of contacts) { c._orcid = normOrcid(c.wmkf_orcid); c._email = normEmail(c.emailaddress1); }
  const populated = contacts.filter((c) => c._orcid);
  console.log(`\ncontacts with wmkf_orcid populated: ${populated.length}`);
  console.log(`  (rows returned by 'wmkf_orcid ne null': ${contacts.length}; normalize-parseable: ${populated.length})`);
  if (populated.length) console.log(`  sample: ${populated.slice(0, 5).map((c) => `${c.fullname || '?'}<${c._email || 'no-email'}>=${c._orcid}`).join(' | ')}`);

  // 2. reviewer pool ORCIDs + emails
  const reviewers = (await getAll(token,
    `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_orcid`)).value;
  for (const r of reviewers) { r._orcid = normOrcid(r.wmkf_orcid); r._email = normEmail(r.wmkf_emailaddress); }
  const revWithOrcid = reviewers.filter((r) => r._orcid);
  const revOrcidSet = new Set(revWithOrcid.map((r) => r._orcid));

  // 3. DIRECT join: contact.wmkf_orcid that also appears on a reviewer
  const contactOrcidSet = new Set(populated.map((c) => c._orcid));
  const directShared = [...revOrcidSet].filter((o) => contactOrcidSet.has(o));
  console.log(`\nDIRECT ORCID<->ORCID join (reviewer.wmkf_orcid ∈ contact.wmkf_orcid):`);
  console.log(`  reviewer distinct ORCIDs:   ${revOrcidSet.size}`);
  console.log(`  contact distinct ORCIDs:    ${contactOrcidSet.size}`);
  console.log(`  shared (direct matches):    ${directShared.length}`);

  // 4. provenance: of the contact ORCIDs, how many emails-agree vs differ with our reviewer for the same ORCID
  const revByOrcid = new Map(); for (const r of revWithOrcid) if (!revByOrcid.has(r._orcid)) revByOrcid.set(r._orcid, r);
  let emailAgree = 0, emailDiffer = 0, revNoEmail = 0;
  for (const o of directShared) {
    const r = revByOrcid.get(o); const c = populated.find((x) => x._orcid === o);
    if (!r._email || !c._email) revNoEmail++;
    else if (r._email === c._email) emailAgree++; else emailDiffer++;
  }
  console.log(`  of direct matches: same-email ${emailAgree}, different-email ${emailDiffer}, missing-email ${revNoEmail}`);
  console.log(`    (different-email = a cross-store match EMAIL alone would have MISSED)`);

  const out = {
    stamp, contactsWithOrcid: populated.length, reviewerDistinctOrcids: revOrcidSet.size,
    contactDistinctOrcids: contactOrcidSet.size, directSharedMatches: directShared.length,
    directMatchEmail: { agree: emailAgree, differ: emailDiffer, missing: revNoEmail },
  };
  fs.writeFileSync(path.join(__dirname, '.orcid-contact-direct.json'), JSON.stringify(out, null, 2));
  console.log(`\n${'='.repeat(70)}\nArtifact: scripts/.orcid-contact-direct.json`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
