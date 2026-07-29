#!/usr/bin/env node
/**
 * READ-ONLY: examine reviewers where the Postgres roster candidate blob HAS an
 * email but the Dataverse person record's wmkf_emailaddress is EMPTY. For each:
 * roster email + source + emailPersistAllowed + contactStatus + roster.updated_at,
 * vs the Dataverse person's email/createdon/modifiedon. A roster timestamp at/before
 * the suggestion proves a save-time drop. A later timestamp is ambiguous because the
 * normal save flow stamps the suggestion anchor and marks the roster row saved after
 * the Dataverse write; it does NOT by itself prove post-save re-enrichment.
 * Only POST is the OAuth token; every Dataverse call is a GET; Postgres read-only.
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) process.env.POSTGRES_URL = process.env.DATABASE_URL;
const DAYS = Number(process.argv[2] || 90);
const sinceIso = new Date(Date.now() - DAYS * 86400_000).toISOString();
const { sql } = await import('@vercel/postgres');
const norm = (s) => String(s || '').toLowerCase().replace(/^(dr\.?|prof\.?|professor)\s+/i, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
const fmt = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16).replace('T', ' ') : '—');

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID, client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status}`); return (await r.json()).access_token;
}
async function getAll(token, urlPath) {
  let next = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`; const rows = [];
  while (next) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.maxpagesize=500,odata.include-annotations="*"' } });
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
    if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status}`);
    rows.push(...(b.value || [])); next = b['@odata.nextLink'] || null;
  }
  return rows;
}

(async () => {
  const token = await getToken();
  const sugs = await getAll(token, `/wmkf_appreviewersuggestions?$select=_wmkf_potentialreviewer_value,_wmkf_request_value,createdon&$filter=wmkf_selected eq true and createdon ge ${sinceIso}`);
  const personIds = [...new Set(sugs.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const persons = {};
  for (let i = 0; i < personIds.length; i += 20) {
    const orChain = personIds.slice(i, i + 20).map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const rows = await getAll(token, `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_emailsource,createdon,modifiedon&$filter=${encodeURIComponent(orChain)}`);
    for (const p of rows) persons[p.wmkf_potentialreviewersid] = p;
  }
  // No-email-in-Dataverse candidates, keyed for roster lookup.
  const noEmail = sugs.map((s) => {
    const p = persons[s._wmkf_potentialreviewer_value]; if (!p || p.wmkf_emailaddress) return null;
    return { name: p.wmkf_name, requestId: s._wmkf_request_value, savedAt: s.createdon, pCreated: p.createdon, pModified: p.modifiedon, key: `${s._wmkf_request_value}::${norm(p.wmkf_name)}` };
  }).filter(Boolean);

  const reqIds = [...new Set(noEmail.map((r) => r.requestId))];
  const roster = {};
  const res = await sql.query(`SELECT request_id, display_name, status, candidate, updated_at FROM reviewer_find_roster WHERE request_id = ANY($1)`, [reqIds]);
  for (const row of res.rows) {
    const c = row.candidate || {}; const enr = c.contactEnrichment || {};
    roster[`${row.request_id}::${norm(row.display_name)}`] = {
      email: c.email || enr.email || null,
      source: c.emailSource || enr.emailSource || null,
      epa: (c.emailPersistAllowed ?? enr.emailPersistAllowed),
      contactStatus: (c.contactStatus || enr.contactStatus || null),
      status: row.status,
      updatedAt: row.updated_at,
    };
  }

  // Request numbers for readability.
  const reqNum = {};
  for (let i = 0; i < reqIds.length; i += 20) {
    const orChain = reqIds.slice(i, i + 20).map((id) => `akoya_requestid eq ${id}`).join(' or ');
    const rows = await getAll(token, `/akoya_requests?$select=akoya_requestid,akoya_requestnum&$filter=${encodeURIComponent(orChain)}`);
    for (const r of rows) reqNum[r.akoya_requestid] = r.akoya_requestnum;
  }

  console.log(`Reviewers with roster email but EMPTY Dataverse email (last ${DAYS}d):\n`);
  let n = 0;
  for (const r of noEmail) {
    const rr = roster[r.key]; if (!rr || !rr.email) continue;
    n++;
    const rosterAfterSave = rr.updatedAt && r.savedAt ? (new Date(rr.updatedAt) > new Date(r.savedAt)) : null;
    const deltaMs = rr.updatedAt && r.savedAt ? new Date(rr.updatedAt) - new Date(r.savedAt) : null;
    const timingNote = rosterAfterSave === false
      ? '→ roster had email AT/BEFORE save (SAVE DROPPED it)'
      : rosterAfterSave === true && rr.status === 'saved' && deltaMs <= 60_000
        ? '→ roster saved/stamped immediately after Dataverse write (current blob likely save payload; timestamp alone is not proof)'
        : rosterAfterSave === true
          ? '→ roster changed AFTER save (current blob cannot prove what the save payload contained)'
          : '';
    console.log(`• ${r.name}  (req ${reqNum[r.requestId] || '?'})`);
    console.log(`    roster: status=${rr.status}  email=${rr.email}  source=${rr.source || '∅'}  emailPersistAllowed=${rr.epa}  contactStatus=${rr.contactStatus || '∅'}`);
    console.log(`    timing: saved=${fmt(r.savedAt)}  rosterUpdated=${fmt(rr.updatedAt)}  ${timingNote}`);
    console.log(`    dataverse: email=∅  personModified=${fmt(r.pModified)}`);
  }
  console.log(`\nTotal: ${n}`);
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
