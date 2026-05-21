#!/usr/bin/env node
/**
 * One-off: repair Christopher Chang's split-person state.
 *
 * State before:
 *   Row A (canonical, 2025-04-29): wmkf_potentialreviewers
 *     id  = 6e30fbc1-1f25-f011-8c4d-6045bd0530cf
 *     email = chrischang@princeton.edu, org = "Princeton"
 *   Row B (re-discovered 2026-04-30, wrong email/org from Google scrape):
 *     id  = 538989a9-f044-f111-88b4-000d3a306da2
 *     email = lp9904@princeton.edu (assistant), org = "Department of Chemistry, University of California, Berkeley..."
 *   Suggestion e64f4caa-f044-f111-88b4-6045bd019e44 currently points at Row B.
 *
 * Actions (dry-run by default; pass --execute to apply):
 *   1. Repoint suggestion e64f4caa -> Row A.
 *   2. Update Row A's wmkf_organizationname from "Princeton" to "Princeton University"
 *      (was today's intended correction in the modal).
 *
 * NOT done: deactivating Row B. There may be a researcher sidecar / contact
 * link still attached; leaving Row B in place is the safe default. Audit
 * those separately if you want to fully reap.
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

const EXECUTE = process.argv.includes('--execute');

const SUGGESTION_ID = 'e64f4caa-f044-f111-88b4-6045bd019e44';
const ROW_A_ID      = '6e30fbc1-1f25-f011-8c4d-6045bd0530cf'; // keep
const ROW_B_ID      = '538989a9-f044-f111-88b4-000d3a306da2'; // currently linked, will be unlinked
const NEW_ORG       = 'Princeton University';

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
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' },
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240)}`);
  return body;
}

async function patch(token, urlPath, payload) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      Accept: 'application/json', 'OData-Version': '4.0', 'If-Match': '*',
    },
    body: JSON.stringify(payload),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`PATCH ${urlPath}: ${r.status} ${t.slice(0, 400)}`);
}

(async () => {
  const token = await getToken();
  console.log(`fix-chris-chang-suggestion — mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}\n`);

  // Pre-check Row A still has the canonical email and is still the right target.
  const rowA = await get(token, `/wmkf_potentialreviewerses(${ROW_A_ID})`);
  console.log(`Row A (${ROW_A_ID}):`);
  console.log(`  name  : ${rowA.wmkf_name}`);
  console.log(`  email : ${rowA.wmkf_emailaddress}`);
  console.log(`  org   : ${rowA.wmkf_organizationname}`);
  if ((rowA.wmkf_emailaddress || '').toLowerCase() !== 'chrischang@princeton.edu') {
    throw new Error(`Aborting: Row A no longer holds chrischang@princeton.edu (now ${rowA.wmkf_emailaddress}). Re-investigate before running.`);
  }

  // Pre-check the suggestion still points at Row B.
  const sug = await get(token, `/wmkf_appreviewersuggestions(${SUGGESTION_ID})`);
  console.log(`\nSuggestion (${SUGGESTION_ID}):`);
  console.log(`  current _wmkf_potentialreviewer_value : ${sug._wmkf_potentialreviewer_value}`);
  console.log(`  _wmkf_request_value                   : ${sug._wmkf_request_value}`);
  if (sug._wmkf_potentialreviewer_value !== ROW_B_ID) {
    throw new Error(`Aborting: suggestion no longer points at Row B (points at ${sug._wmkf_potentialreviewer_value}). Re-investigate.`);
  }

  console.log(`\nPlanned writes:`);
  console.log(`  1. PATCH wmkf_appreviewersuggestions(${SUGGESTION_ID})`);
  console.log(`     wmkf_PotentialReviewer@odata.bind = /wmkf_potentialreviewerses(${ROW_A_ID})`);
  console.log(`  2. PATCH wmkf_potentialreviewerses(${ROW_A_ID})`);
  console.log(`     wmkf_organizationname = "${NEW_ORG}"  (was "${rowA.wmkf_organizationname}")`);

  if (!EXECUTE) {
    console.log(`\nDry run. Re-run with --execute to apply.`);
    return;
  }

  console.log(`\nExecuting...`);
  await patch(token, `/wmkf_appreviewersuggestions(${SUGGESTION_ID})`, {
    'wmkf_PotentialReviewer@odata.bind': `/wmkf_potentialreviewerses(${ROW_A_ID})`,
  });
  console.log(`  ✓ suggestion repointed`);

  await patch(token, `/wmkf_potentialreviewerses(${ROW_A_ID})`, {
    wmkf_organizationname: NEW_ORG,
  });
  console.log(`  ✓ Row A org updated to "${NEW_ORG}"`);

  // Verify.
  const sugAfter = await get(token, `/wmkf_appreviewersuggestions(${SUGGESTION_ID})`);
  const rowAfter = await get(token, `/wmkf_potentialreviewerses(${ROW_A_ID})`);
  console.log(`\nPost-write verification:`);
  console.log(`  suggestion linked to        : ${sugAfter._wmkf_potentialreviewer_value} (expected ${ROW_A_ID})`);
  console.log(`  Row A wmkf_organizationname : ${rowAfter.wmkf_organizationname}`);
  console.log(`\nDone.`);
})().catch((e) => { console.error(e); process.exit(1); });
