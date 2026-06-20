#!/usr/bin/env node

/**
 * Read-only probe: how much grantee-deliverable data is already populated on
 * akoya_request? Run before the Option-1 migration (move the deliverable package
 * — status, image ref, caption, + new lifecycle dates — into a related
 * wmkf_granteedeliverable table) to confirm the backfill is empty/cheap.
 *
 * Counts requests with a non-null value in each of the three live fields:
 *   wmkf_granteedeliverablestatus  (any lifecycle status set)
 *   wmkf_granteeimagefileref       (an uploaded image)
 *   wmkf_granteeimagecaption       (a caption)
 *
 * READ-ONLY. No writes. Exit 0 always (informational).
 *   node scripts/probe-grantee-deliverable-data.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) { const k = m[1]; let v = m[2].trim().replace(/^["']|["']$/g, ''); if (!process.env[k]) process.env[k] = v; }
  }
}

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function countWhere(tok, filter) {
  // $count=true returns the full @odata.count for the filter regardless of $top.
  const url = `${process.env.DYNAMICS_URL}/api/data/v9.2/akoya_requests?$filter=${encodeURIComponent(filter)}&$count=true&$top=1`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${tok}`, 'OData-Version': '4.0', Accept: 'application/json', Prefer: 'odata.include-annotations="*"' },
  });
  if (!r.ok) throw new Error(`query ${r.status}: ${await r.text()}`);
  const body = await r.json();
  return body['@odata.count'];
}

async function sample(tok, filter, n = 10) {
  const url = `${process.env.DYNAMICS_URL}/api/data/v9.2/akoya_requests?$filter=${encodeURIComponent(filter)}&$top=${n}&$select=akoya_requestnum,wmkf_granteedeliverablestatus,wmkf_granteeimagefileref,wmkf_granteeimagecaption`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`sample ${r.status}: ${await r.text()}`);
  return (await r.json()).value;
}

(async () => {
  const tok = await token();
  const statusCount = await countWhere(tok, 'wmkf_granteedeliverablestatus ne null');
  const imageCount = await countWhere(tok, 'wmkf_granteeimagefileref ne null');
  const captionCount = await countWhere(tok, 'wmkf_granteeimagecaption ne null');

  console.log('--- Grantee deliverable data on akoya_request (read-only) ---');
  console.log('rows with a deliverable STATUS set :', statusCount);
  console.log('rows with an IMAGE ref            :', imageCount);
  console.log('rows with a CAPTION               :', captionCount);

  const anyFilter = 'wmkf_granteedeliverablestatus ne null or wmkf_granteeimagefileref ne null or wmkf_granteeimagecaption ne null';
  const total = await countWhere(tok, anyFilter);
  console.log('rows with ANY deliverable data    :', total);
  if (total > 0) {
    console.log('\nsample (up to 10):');
    for (const row of await sample(tok, anyFilter)) {
      console.log(`  #${row.akoya_requestnum}  status=${row.wmkf_granteedeliverablestatus}  image=${row.wmkf_granteeimagefileref ? 'Y' : '-'}  caption=${row.wmkf_granteeimagecaption ? 'Y' : '-'}`);
    }
  }
  console.log(`\nVERDICT: ${total === 0 ? 'CLEAN — no live package data; Option-1 migration needs no backfill.' : `${total} row(s) carry package data — backfill required.`}`);
})().catch((e) => { console.error('probe error:', e.message); process.exit(2); });
