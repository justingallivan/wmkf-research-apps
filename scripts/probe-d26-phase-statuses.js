#!/usr/bin/env node
/**
 * READ-ONLY probe: Phase I / Phase II status of the D26 proposals still under
 * consideration, i.e. the Workbench default visibility set for the cycle:
 *   wmkf_meetingdate in December 2026 (lib/utils/cycle-code.js
 *   cycleCodeToOdataFilter), AND (akoya_requeststatus = 'Phase II Pending'
 *   OR wmkf_triagestatus = Advancing) AND NOT Set aside
 *   (shared/config/workbenchVisibility.js buildVisibilityFilter), excluding
 *   test requests (wmkf_istestrequest).
 * Triage values are from the Atlas: Advancing 100000000, Set aside 100000001.
 *
 * Usage (owner-run; production Dataverse read):
 *   node scripts/probe-d26-phase-statuses.js
 *
 * Only the OAuth token call is a POST; every Dataverse call is a GET.
 * Prints request number, program and status labels only.
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

const ADVANCING = 100000000;
const SET_ASIDE = 100000001;
const FILTER = [
  'wmkf_meetingdate ge 2026-12-01T00:00:00Z and wmkf_meetingdate lt 2027-01-01T00:00:00Z',
  `(akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq ${ADVANCING})`,
  `(wmkf_triagestatus eq null or wmkf_triagestatus ne ${SET_ASIDE})`,
  '(wmkf_istestrequest eq null or wmkf_istestrequest eq false)',
].join(' and ');
const SELECT = [
  'akoya_requestnum', 'akoya_requeststatus', 'wmkf_triagestatus',
  'wmkf_phaseistatus', 'wmkf_phaseiistatus', '_akoya_programid_value',
].join(',');

async function getToken() {
  const res = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!res.ok) throw new Error(`Token: ${res.status}`);
  return (await res.json()).access_token;
}

const label = (row, field) => row[`${field}@OData.Community.Display.V1.FormattedValue`]
  ?? (row[field] == null ? '(empty)' : String(row[field]));

function tally(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const key = label(row, field).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

(async () => {
  const token = await getToken();
  const query = `$select=${SELECT}&$filter=${encodeURIComponent(FILTER)}&$orderby=akoya_requestnum asc`;
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2/akoya_requests?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json',
      'OData-MaxVersion': '4.0', 'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    },
  });
  if (!r.ok) throw new Error(`Dataverse ${r.status}`);
  const rows = (await r.json()).value || [];

  console.log(`D26 proposals under consideration: ${rows.length}\n`);
  console.log('request   program                          request status     triage      Phase I status              Phase II status');
  for (const row of rows) {
    console.log([
      String(row.akoya_requestnum).padEnd(9),
      label(row, '_akoya_programid_value').slice(0, 32).padEnd(32),
      label(row, 'akoya_requeststatus').padEnd(18),
      label(row, 'wmkf_triagestatus').padEnd(11),
      label(row, 'wmkf_phaseistatus').trim().padEnd(27),
      label(row, 'wmkf_phaseiistatus'),
    ].join(' '));
  }
  for (const field of ['wmkf_phaseistatus', 'wmkf_phaseiistatus']) {
    console.log(`\n── ${field} ──`);
    for (const [value, n] of tally(rows, field)) console.log(`  ${String(n).padStart(3)}  ${value}`);
  }
  console.log('\nDone (read-only).');
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
