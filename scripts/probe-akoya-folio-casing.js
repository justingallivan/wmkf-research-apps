#!/usr/bin/env node
/**
 * READ-ONLY one-off: settle the akoya_folio casing question for Path A A4.
 * The Explorer prompt claims "Paid"/"PAID" casing inconsistency and recommends
 * contains(); memory akoya-payment-field-semantics says akoya_folio="PAID".
 * This probe enumerates the actual distinct akoya_folio values + counts, and
 * tests whether Dataverse $filter string equality is case-insensitive.
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
  return { ok: r.ok, status: r.status, body };
}
async function rawCount(token, filter) {
  // Both /$count?$filter= (Edm.Int32 error) and /$count unfiltered (capped at
  // 5000) and ?$count=true&$top=0 ($top=0 rejected) are broken/unreliable on
  // this instance. The TRUE count comes from $apply countdistinct on the PK.
  const apply = `filter(${filter})/aggregate(akoya_requestpaymentid with countdistinct as value)`;
  const r = await get(token, `/akoya_requestpayments?$apply=${encodeURIComponent(apply)}`);
  if (!r.ok) return `ERR ${r.status}: ${String(JSON.stringify(r.body)).slice(0, 120)}`;
  return r.body.value?.[0]?.value;
}
(async () => {
  const token = await getToken();
  console.log(`akoya_folio casing probe — ${new Date().toISOString()} (read-only)\n`);

  // 1. Distinct values via groupby + countdistinct on PK.
  const grp = await get(token,
    `/akoya_requestpayments?$apply=${encodeURIComponent('groupby((akoya_folio),aggregate(akoya_requestpaymentid with countdistinct as n))')}`);
  if (grp.ok) {
    console.log('--- Distinct akoya_folio values (groupby) ---');
    const rows = (grp.body.value || []).map(r => ({ folio: r.akoya_folio, n: r.n }))
      .sort((a, b) => (b.n || 0) - (a.n || 0));
    for (const r of rows) console.log(`  ${String(r.n).padStart(7)}  ${JSON.stringify(r.folio)}`);
  } else {
    console.log(`groupby failed (${grp.status}): ${String(JSON.stringify(grp.body)).slice(0, 200)}`);
  }

  // 2. Case-insensitivity test: eq 'PAID' vs eq 'Paid' vs eq 'paid'.
  console.log('\n--- Case-insensitivity of eq (counts should match iff CI) ---');
  for (const v of ['PAID', 'Paid', 'paid']) {
    console.log(`  akoya_folio eq '${v}'  → ${await rawCount(token, `akoya_folio eq '${v}'`)}`);
  }
  console.log(`  contains(akoya_folio,'Paid') → ${await rawCount(token, "contains(akoya_folio,'Paid')")}`);
  console.log(`  contains(akoya_folio,'paid') → ${await rawCount(token, "contains(akoya_folio,'paid')")}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
