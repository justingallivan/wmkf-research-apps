#!/usr/bin/env node
/**
 * READ-ONLY dry-run of the Fix-A reconciler against live data. Uses the REAL
 * roster query (findReconcilableCandidates) + the REAL gate (pickVettedEmail);
 * mirrors the reconciler's live Dataverse checks with raw GETs. Reports what the
 * cron WOULD do (write / repoint / alert / skip) without mutating anything.
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) process.env.POSTGRES_URL = process.env.DATABASE_URL;

const { findReconcilableCandidates } = await import('../lib/services/reviewer-roster-store.js');
const { pickVettedEmail } = await import('../lib/utils/reviewer-vetted-email.js');

const eq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
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
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status}`); return b;
}
const esc = (s) => String(s).replace(/'/g, "''");

(async () => {
  const token = await getToken();
  const rows = await findReconcilableCandidates(1000);
  const out = { scanned: rows.length, write: [], repoint: [], alert: [], skip: 0 };

  for (const { requestId, candidate } of rows) {
    const suggestionId = candidate && candidate.suggestionId;
    const vetted = pickVettedEmail(candidate);
    if (!suggestionId || !vetted) { out.skip++; continue; }
    let sug;
    try { sug = await get(token, `/wmkf_appreviewersuggestions(${suggestionId})?$select=_wmkf_request_value,_wmkf_potentialreviewer_value,wmkf_selected`); }
    catch { out.skip++; continue; }
    if (!sug || !eq(sug._wmkf_request_value, requestId) || !sug.wmkf_selected) { out.skip++; continue; }
    const personId = sug._wmkf_potentialreviewer_value;
    if (!personId) { out.skip++; continue; }
    const person = await get(token, `/wmkf_potentialreviewerses(${personId})?$select=wmkf_name,wmkf_emailaddress`);
    if (person && person.wmkf_emailaddress) { out.skip++; continue; }

    const owners = (await get(token, `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,statecode&$filter=wmkf_emailaddress eq '${esc(vetted.email)}'&$top=3`)).value || [];
    const others = owners.filter((o) => !eq(o.wmkf_potentialreviewersid, personId));
    const label = `${person.wmkf_name || '?'} <${vetted.email}> [${vetted.source || '?'}] req ${requestId.slice(0, 8)}`;

    if (others.length === 0) { out.write.push(label); continue; }
    if (others.length === 1 && others[0].statecode === 0) {
      const keeperSug = (await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid&$filter=_wmkf_request_value eq ${requestId} and _wmkf_potentialreviewer_value eq ${others[0].wmkf_potentialreviewersid}&$top=1`)).value || [];
      if (keeperSug.length) out.alert.push(`${label} — keeper_has_suggestion`);
      else out.repoint.push(`${label} → keeper ${others[0].wmkf_name}`);
      continue;
    }
    out.alert.push(`${label} — ${others.length > 1 ? 'ambiguous_owner' : 'inactive_owner'}`);
  }

  console.log(`DRY RUN — scanned ${out.scanned} reconcilable roster candidate(s)\n`);
  console.log(`WOULD WRITE   (${out.write.length}):`); out.write.forEach((x) => console.log('  +', x));
  console.log(`WOULD REPOINT (${out.repoint.length}):`); out.repoint.forEach((x) => console.log('  ~', x));
  console.log(`WOULD ALERT   (${out.alert.length}):`); out.alert.forEach((x) => console.log('  !', x));
  console.log(`SKIPPED (already resolved / not selected / gate): ${out.skip}`);
})().catch((e) => { console.error('DRYRUN ERROR:', e.message); process.exit(1); });
