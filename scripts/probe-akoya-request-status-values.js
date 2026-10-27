#!/usr/bin/env node
/**
 * READ-ONLY probe: every distinct akoya_requeststatus value with its row
 * count, overall and for requests created on or after a cutoff date.
 * akoya_requeststatus is a free-text String, not a picklist, so the live
 * distribution is the only list of values. Feeds J27 alignment log C4
 * (the arrival status of new J27 proposals).
 *
 * Usage (owner-run; production Dataverse read):
 *   node scripts/probe-akoya-request-status-values.js [--since=2025-01-01]
 *
 * Only the OAuth token call is a POST; every Dataverse call is a GET.
 * Output is status values and counts only; no request rows are printed.
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

const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const since = sinceArg ? sinceArg.slice('--since='.length) : '2025-01-01';
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since must be YYYY-MM-DD');
  process.exit(1);
}

async function getToken() {
  const tenant = process.env.DYNAMICS_TENANT_ID;
  const clientId = process.env.DYNAMICS_CLIENT_ID;
  const secret = process.env.DYNAMICS_CLIENT_SECRET;
  const resource = process.env.DYNAMICS_URL;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: clientId,
      client_secret: secret, scope: `${resource}/.default`,
    }),
  });
  if (!res.ok) throw new Error(`Token: ${res.status}`);
  return (await res.json()).access_token;
}

async function statusDistribution(token, filterXml) {
  const fetchXml =
    `<fetch aggregate="true"><entity name="akoya_request">` +
    `<attribute name="akoya_requeststatus" alias="v" groupby="true"/>` +
    `<attribute name="akoya_requestid" alias="c" aggregate="count"/>` +
    filterXml +
    `</entity></fetch>`;
  const url = `${process.env.DYNAMICS_URL}/api/data/v9.2/akoya_requests?fetchXml=${encodeURIComponent(fetchXml)}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json',
      'OData-MaxVersion': '4.0', 'OData-Version': '4.0',
    },
  });
  if (!r.ok) throw new Error(`Dataverse ${r.status} (FetchXML aggregates cap at 50k rows)`);
  return ((await r.json()).value || [])
    .map((x) => ({ v: x.v, c: x.c || 0 }))
    .sort((a, b) => b.c - a.c);
}

function print(title, rows) {
  const total = rows.reduce((n, r) => n + r.c, 0);
  console.log(`── ${title}: ${rows.length} distinct values, ${total} rows ──`);
  for (const row of rows) {
    const label = row.v === null || row.v === undefined ? '(empty)' : JSON.stringify(row.v);
    console.log(`  ${String(row.c).padStart(7)}  ${label}`);
  }
  console.log();
}

(async () => {
  const token = await getToken();
  print('akoya_requeststatus, all requests', await statusDistribution(token, ''));
  print(
    `akoya_requeststatus, created on or after ${since}`,
    await statusDistribution(
      token,
      `<filter><condition attribute="createdon" operator="on-or-after" value="${since}"/></filter>`,
    ),
  );
  console.log('Done (read-only).');
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
