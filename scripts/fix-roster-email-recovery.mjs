#!/usr/bin/env node
/**
 * DATA FIX (S317): recover reviewers whose paid-search email landed in the durable
 * roster (emailPersistAllowed=true) but never reached Dataverse (save/enrichment
 * ordering). Two ops:
 *   write   — no Dataverse record owns the email → PATCH it onto the suggestion's
 *             person record (guarded: person email empty + no other owner).
 *   repoint — a sibling record owns the email → repoint the suggestion to that
 *             keeper (like the Walsh fix), guarded against unique-key collision.
 * Dry-run by default; pass --execute to write.
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
const EXECUTE = process.argv.includes('--execute');
const norm = (s) => String(s || '').toLowerCase().replace(/^(dr\.?|prof\.?|professor)\s+/i, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

// Cases derived from probe-roster-has-dataverse-empty + owner check. Pollina skipped (junk munge).
const CASES = [
  { name: 'Nitin Phadnis',     reqNum: '1002860', email: 'phadnis@biology.utah.edu', source: 'claude_search', op: 'write' },
  { name: 'Michael Crair',     reqNum: '1002835', email: 'michael.crair@yale.edu',   source: 'claude_search', op: 'write' },
  { name: 'Carla J. Shatz',    reqNum: '1003034', email: 'cshatz@stanford.edu',       op: 'repoint' },
  { name: 'Tsampikos Kottos',  reqNum: '1002926', email: 'tkottos@wesleyan.edu',      op: 'repoint' },
  { name: 'Harmit Malik',      reqNum: '1002860', email: 'hsmalik@fredhutch.org',     op: 'repoint' },
];

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID, client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status}`); return (await r.json()).access_token;
}
async function get(token, urlPath) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${JSON.stringify(b).slice(0, 160)}`); return b;
}
async function patch(token, urlPath, body) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  return { ok: r.ok, status: r.status, body: b };
}
async function reqGuid(token, num) {
  const b = await get(token, `/akoya_requests?$select=akoya_requestid&$filter=akoya_requestnum eq '${num}'&$top=1`);
  return b.value?.[0]?.akoya_requestid || null;
}
async function ownerOf(token, email) {
  const esc = email.replace(/'/g, "''");
  const b = await get(token, `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,statecode&$filter=wmkf_emailaddress eq '${esc}'&$top=5`);
  return b.value || [];
}

(async () => {
  const token = await getToken();
  console.log(EXECUTE ? '*** EXECUTE MODE ***\n' : '--- DRY RUN (pass --execute) ---\n');
  for (const c of CASES) {
    console.log(`• ${c.name} (req ${c.reqNum}, ${c.op}) → ${c.email}`);
    const rg = await reqGuid(token, c.reqNum);
    if (!rg) { console.log('   ABORT: request not found.\n'); continue; }
    // Find the suggestion whose person name matches and whose email is empty.
    const sugs = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value&$filter=_wmkf_request_value eq ${rg} and wmkf_selected eq true&$top=200`);
    let target = null;
    for (const s of (sugs.value || [])) {
      const p = await get(token, `/wmkf_potentialreviewerses(${s._wmkf_potentialreviewer_value})?$select=wmkf_name,wmkf_emailaddress`);
      if (norm(p.wmkf_name) === norm(c.name) && !p.wmkf_emailaddress) { target = { sugId: s.wmkf_appreviewersuggestionid, personId: s._wmkf_potentialreviewer_value, personName: p.wmkf_name }; break; }
    }
    if (!target) { console.log('   SKIP: no empty-email suggestion matching that name (already fixed?).\n'); continue; }

    if (c.op === 'write') {
      const owners = await ownerOf(token, c.email);
      if (owners.length) { console.log(`   SWITCH-TO-REPOINT NEEDED: email now owned by ${owners.map(o => o.wmkf_name).join(', ')}; not writing.\n`); continue; }
      if (!EXECUTE) { console.log(`   WOULD WRITE email onto ${target.personId} (source=${c.source}).\n`); continue; }
      const res = await patch(token, `/wmkf_potentialreviewerses(${target.personId})`, { wmkf_emailaddress: c.email, wmkf_emailsource: c.source });
      console.log(res.ok ? `   WROTE email=${res.body?.wmkf_emailaddress} source=${res.body?.wmkf_emailsource}\n` : `   WRITE FAILED (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}\n`);
    } else { // repoint
      const owners = await ownerOf(token, c.email);
      const active = owners.filter((o) => o.wmkf_potentialreviewersid.toLowerCase() !== target.personId.toLowerCase());
      if (active.length !== 1) { console.log(`   ABORT: expected 1 keeper owner, found ${active.length} (${active.map(o=>o.wmkf_name).join(', ')}).\n`); continue; }
      const keeper = active[0];
      const keeperSug = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid&$filter=_wmkf_request_value eq ${rg} and _wmkf_potentialreviewer_value eq ${keeper.wmkf_potentialreviewersid}&$top=5`);
      if (keeperSug.value?.length) { console.log(`   ABORT: keeper already has a suggestion on this request (would collide).\n`); continue; }
      console.log(`   keeper: ${keeper.wmkf_name} (${keeper.wmkf_potentialreviewersid})${norm(keeper.wmkf_name) !== norm(c.name) ? '  [NAME DIFFERS from suggestion — see note]' : ''}`);
      if (!EXECUTE) { console.log(`   WOULD REPOINT suggestion ${target.sugId} → keeper.\n`); continue; }
      const res = await patch(token, `/wmkf_appreviewersuggestions(${target.sugId})`, { 'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${keeper.wmkf_potentialreviewersid})` });
      if (!res.ok) { console.log(`   REPOINT FAILED (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}\n`); continue; }
      const chk = await get(token, `/wmkf_appreviewersuggestions(${target.sugId})?$select=_wmkf_potentialreviewer_value`);
      console.log(`   REPOINTED → ${chk._wmkf_potentialreviewer_value} (${chk._wmkf_potentialreviewer_value?.toLowerCase() === keeper.wmkf_potentialreviewersid.toLowerCase() ? 'MATCH' : 'MISMATCH'})\n`);
    }
  }
})().catch((e) => { console.error('FIX ERROR:', e.message); process.exit(1); });
