#!/usr/bin/env node
/**
 * DATA FIX (S317): resolve the Christopher Walsh duplicate on request 1003020.
 * Repoint the request's reviewer suggestion from the EMPTY person record
 * (ce7d4a6b, no email) to the older KEEPER record (18615ea0) that already carries
 * christopher.walsh@childrens.harvard.edu, then deactivate the now-orphaned empty
 * duplicate iff it has no remaining suggestions and no contact link.
 * Mirrors reviewer-suggestion.repointToPotentialReviewer (wmkf_PotentialReviewer bind).
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
const REQ_GUID = '8a0efbb3-8d45-f111-88b4-000d3a306da2';
const EMPTY = 'ce7d4a6b-1a74-f111-ab0f-000d3a306da2';
const KEEPER = '18615ea0-d326-f011-8c4d-6045bd003e28';

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
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`); return b;
}
async function patch(token, urlPath, body) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  return { ok: r.ok, status: r.status, body: b };
}

(async () => {
  const token = await getToken();
  console.log(EXECUTE ? '*** EXECUTE MODE ***\n' : '--- DRY RUN (pass --execute to write) ---\n');

  // 1. The suggestion on this request pointing at the EMPTY record.
  const sug = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,wmkf_selected&$filter=_wmkf_request_value eq ${REQ_GUID} and _wmkf_potentialreviewer_value eq ${EMPTY}&$top=5`);
  if (!sug.value?.length) { console.log('No suggestion on 1003020 points at the empty record — nothing to do (already repointed?).'); return; }
  if (sug.value.length > 1) { console.log(`ABORT: expected 1 suggestion, found ${sug.value.length}.`); return; }
  const suggestionId = sug.value[0].wmkf_appreviewersuggestionid;
  console.log(`Suggestion to repoint: ${suggestionId} (selected=${sug.value[0].wmkf_selected})`);

  // 2. Guard: keeper must not already have a suggestion on this request (unique key).
  const keeperSug = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid&$filter=_wmkf_request_value eq ${REQ_GUID} and _wmkf_potentialreviewer_value eq ${KEEPER}&$top=5`);
  if (keeperSug.value?.length) { console.log(`ABORT: keeper already has a suggestion on 1003020 — would collide. Use the merge flow instead.`); return; }

  // 3. Confirm keeper carries the email.
  const keeper = await get(token, `/wmkf_potentialreviewerses(${KEEPER})?$select=wmkf_name,wmkf_emailaddress`);
  console.log(`Keeper ${KEEPER}: ${keeper.wmkf_name} email=${keeper.wmkf_emailaddress || '∅'}`);
  if (!keeper.wmkf_emailaddress) { console.log('ABORT: keeper has no email; nothing gained.'); return; }

  if (!EXECUTE) {
    console.log(`\nWOULD: repoint suggestion ${suggestionId} → keeper ${KEEPER}`);
    console.log(`WOULD: then evaluate empty record ${EMPTY} for deactivation.`);
    return;
  }

  // 4. Repoint.
  const rep = await patch(token, `/wmkf_appreviewersuggestions(${suggestionId})`, { 'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${KEEPER})` });
  if (!rep.ok) { console.log(`REPOINT FAILED (${rep.status}): ${JSON.stringify(rep.body).slice(0, 240)}`); return; }
  console.log('Repointed OK.');

  // 5. Verify.
  const check = await get(token, `/wmkf_appreviewersuggestions(${suggestionId})?$select=_wmkf_potentialreviewer_value`);
  console.log(`Verify: suggestion now points at ${check._wmkf_potentialreviewer_value} (expected ${KEEPER}) — ${check._wmkf_potentialreviewer_value?.toLowerCase() === KEEPER.toLowerCase() ? 'MATCH' : 'MISMATCH'}`);

  // 6. Report the empty duplicate's state. Deactivation is a SEPARATE, explicitly-
  //    flagged step (--deactivate) so the default write is only the authorized repoint.
  const remaining = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid&$filter=_wmkf_potentialreviewer_value eq ${EMPTY}&$top=5`);
  const emptyRec = await get(token, `/wmkf_potentialreviewerses(${EMPTY})?$select=_wmkf_contact_value,statecode`);
  const orphaned = (remaining.value?.length || 0) === 0 && !emptyRec._wmkf_contact_value;
  console.log(`Empty duplicate ${EMPTY}: remaining suggestions=${remaining.value?.length || 0}, contactLinked=${!!emptyRec._wmkf_contact_value}, statecode=${emptyRec.statecode}.`);
  if (process.argv.includes('--deactivate')) {
    if (!orphaned) { console.log('Not deactivating: record still has references.'); return; }
    const de = await patch(token, `/wmkf_potentialreviewerses(${EMPTY})`, { statecode: 1, statuscode: 2 });
    console.log(de.ok ? `Deactivated empty duplicate ${EMPTY}.` : `Deactivate failed (${de.status}): ${JSON.stringify(de.body).slice(0, 200)}`);
  } else if (orphaned) {
    console.log('Empty duplicate is now orphaned (no suggestions, no contact link) — re-run with --deactivate to deactivate it.');
  }
})().catch((e) => { console.error('FIX ERROR:', e.message); process.exit(1); });
