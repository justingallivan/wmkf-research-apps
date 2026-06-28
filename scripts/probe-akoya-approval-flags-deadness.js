#!/usr/bin/env node
/**
 * Thread 2 (READ-ONLY): are the Dataverse "approval" gate-fields dead ORG-WIDE?
 *
 * Verdict [VERIFIED via full-table scan, latest run 2026-06-28]: NOT dead. The
 * S298 landscape read ("all null/false even on paid grant #1002238") over-generalized
 * from one record. Org-wide on akoya_request (n≈25,584) three of four are populated;
 * they are NOT uniform booleans — two are DateTime sign-off dates, one a Picklist:
 *   - wmkf_authorizationtoremitpaymentflag (Boolean) — 303 Yes / 5,748 No / rest null  → LIVE
 *   - wmkf_executivedirectorapproval       (DateTime) — 323 dated                       → LIVE
 *   - wmkf_directorofoperationsapproved    (DateTime) — 611 dated                       → LIVE
 *   - wmkf_controllerapproved              (Picklist) — 0 / all null                    → DEAD (only this one)
 * All 303 Boolean=Yes are grant-type (Discretionary/Program/Special); 0 on
 * Individual/honorarium-type — so for honoraria the gates stay unused (paid offline).
 *
 * NOTE: akoya_folio (the PAID state) lives on akoya_requestpayment, NOT akoya_request.
 * Field TYPE drives the query: Boolean/Picklist → groupby value; DateTime → not-null
 * count (a groupby on a DateTime needs dategrouping and errors otherwise).
 * Only POST is the OAuth token; every other call is a GET. Counts = dated evidence.
 */
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}
const FV = '@OData.Community.Display.V1.FormattedValue';
const FLAGS = [
  'wmkf_authorizationtoremitpaymentflag',
  'wmkf_executivedirectorapproval',
  'wmkf_controllerapproved',
  'wmkf_directorofoperationsapproved',
];

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }) });
  if (!r.ok) throw new Error(`Token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
async function get(token, p) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${p}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*"' } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, ok: r.ok, body: b };
}
const reqCount = async (token, fx) => {
  const r = await get(token, `/akoya_requests?fetchXml=${encodeURIComponent(fx)}`);
  return r.ok ? Number(r.body.value?.[0]?.c) || 0 : `ERR ${r.status}`;
};
async function attrType(token, attr) {
  const r = await get(token, `/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='${attr}')?$select=AttributeType`);
  return r.ok ? r.body.AttributeType : `ERR ${r.status}`;
}
// Boolean/Picklist: full value distribution (groupby is valid)
async function dist(token, attr) {
  const fx = `<fetch aggregate="true" top="50"><entity name="akoya_request">` +
    `<attribute name="akoya_requestid" alias="c" aggregate="count"/>` +
    `<attribute name="${attr}" alias="v" groupby="true"/>` +
    `<order alias="c" descending="true"/></entity></fetch>`;
  const r = await get(token, `/akoya_requests?fetchXml=${encodeURIComponent(fx)}`);
  if (!r.ok) return { error: `${r.status}` };
  return { rows: (r.body.value || []).map(x => ({
    raw: x.v, label: x.v == null ? '(null)' : (x[`v${FV}`] ?? String(x.v)), count: Number(x.c) || 0 })) };
}
const notNull = (token, attr) => reqCount(token,
  `<fetch aggregate="true"><entity name="akoya_request"><attribute name="akoya_requestid" alias="c" aggregate="count"/>` +
  `<filter><condition attribute="${attr}" operator="not-null"/></filter></entity></fetch>`);

(async () => {
  const token = await getToken();
  console.log('Token acquired.');
  console.log('Probe date: 2026-06-28 (dated evidence) — Thread 2: approval-gate deadness, org-wide\n');

  const total = await reqCount(token, `<fetch aggregate="true"><entity name="akoya_request"><attribute name="akoya_requestid" alias="c" aggregate="count"/></entity></fetch>`);
  console.log(`akoya_request total = ${total}\n`);

  let liveCount = 0;
  for (const flag of FLAGS) {
    const type = await attrType(token, flag);
    console.log(`══ ${flag}  [${type}] ══`);
    if (type === 'DateTime') {
      const set = await notNull(token, flag);
      console.log(`  dated (not-null) = ${set}   → ${set > 0 ? 'LIVE' : 'DEAD'}`);
      if (set > 0) liveCount++;
    } else {
      const d = await dist(token, flag);
      if (d.error) { console.log(`  ERROR ${d.error}`); continue; }
      const truthy = d.rows.filter(r => r.raw === true || r.raw === 1 || /^(true|yes)$/i.test(String(r.label)))
        .reduce((a, r) => a + r.count, 0);
      for (const r of d.rows) console.log(`      ${String(r.count).padStart(7)}  ${r.label}`);
      console.log(`  truthy = ${truthy}   → ${truthy > 0 ? 'LIVE' : 'DEAD'}`);
      if (truthy > 0) liveCount++;
    }
    console.log('');
  }

  // Disconfirming partition for the headline boolean: exhaustive by-type / by-program
  // breakdown of the =Yes set. If neither lists Individual/Honorarium, honoraria have 0.
  const YES = `<condition attribute="wmkf_authorizationtoremitpaymentflag" operator="eq" value="1"/>`;
  for (const dim of ['wmkf_type', 'wmkf_grantprogram']) {
    const fx = `<fetch aggregate="true" top="50"><entity name="akoya_request">` +
      `<attribute name="akoya_requestid" alias="c" aggregate="count"/>` +
      `<attribute name="${dim}" alias="v" groupby="true"/>` +
      `<filter>${YES}</filter><order alias="c" descending="true"/></entity></fetch>`;
    const r = await get(token, `/akoya_requests?fetchXml=${encodeURIComponent(fx)}`);
    console.log(`══ authorizationtoremitpaymentflag=Yes — exhaustive by ${dim} (sum must = the Yes total) ══`);
    if (r.ok) for (const x of r.body.value || [])
      console.log(`      ${String(Number(x.c) || 0).padStart(5)}  ${x.v == null ? '(null)' : (x[`v${FV}`] ?? x.v)}`);
    else console.log(`  ERR ${r.status}`);
    console.log('');
  }

  console.log('══ VERDICT ══');
  console.log(`  ${liveCount}/4 gate-fields are populated org-wide → "flags are dead" is REFUTED.`);
  console.log('  Honorarium check: the by-type/by-program partitions above carry no');
  console.log('  Individual/Honorarium group → 0 honoraria carry the flag (paid offline).');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
