#!/usr/bin/env node
/**
 * Connor-walkthrough verification (READ-ONLY): confirm the user's finding that
 * `wmkf_type = "Miscellaneous"` is ~50 records and is a REAL (just uncommon)
 * grant bucket, not junk. wmkf_type is a Lookup → its own entity, so resolve
 * the type record by name via metadata, then enumerate akoya_request rows.
 *
 * Only POST is the OAuth token; every Dataverse call is a GET.
 */

const { loadProbeEnvLocal, getToken } = require('./lib/akoya-readonly-probe-bootstrap');
loadProbeEnvLocal();

async function get(token, urlPath) {
  let next = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`;
  const rows = [];
  let first = null;
  while (next) {
    const r = await fetch(next, {
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
        Prefer: 'odata.include-annotations="*"',
      },
    });
    const t = await r.text();
    let body; try { body = JSON.parse(t); } catch { body = t; }
    if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240)}`);
    if (first === null) first = body;
    if (body.value) { for (const v of body.value) rows.push(v); next = body['@odata.nextLink']; }
    else return body;
  }
  return { value: rows, _first: first };
}

(async () => {
  const token = await getToken();
  console.log(`Verify wmkf_type="Miscellaneous" — ${new Date().toISOString()} (read-only)\n`);

  // 1. resolve the wmkf_type entity's set name + primary id/name attributes
  const md = await get(token,
    `/EntityDefinitions(LogicalName='wmkf_type')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`);
  const setName = md.EntitySetName, idAttr = md.PrimaryIdAttribute, nameAttr = md.PrimaryNameAttribute;
  console.log(`wmkf_type entity: set=${setName}  id=${idAttr}  name=${nameAttr}`);

  const types = await get(token,
    `/${setName}?$select=${idAttr},${nameAttr}&$filter=${encodeURIComponent(`${nameAttr} eq 'Miscellaneous'`)}`);
  if (!types.value.length) { console.log('No wmkf_type record named "Miscellaneous" — STOP.'); process.exit(0); }
  const ids = types.value.map((t) => t[idAttr]);
  console.log(`"Miscellaneous" type record(s): ${ids.join(', ')}\n`);

  // 2. all akoya_request rows with that type
  const orf = ids.map((id) => `_wmkf_type_value eq ${id}`).join(' or ');
  const reqs = (await get(token,
    `/akoya_requests?$filter=${encodeURIComponent(`(${orf})`)}` +
    `&$select=akoya_requestnum,akoya_requeststatus,akoya_grant,akoya_paid,akoya_request,_akoya_applicantid_value,akoya_title,wmkf_request_type,createdon&$orderby=createdon desc`)).value;

  const FV = '@OData.Community.Display.V1.FormattedValue';
  const withGrant = reqs.filter((r) => Number(r.akoya_grant) > 0);
  const withPaid = reqs.filter((r) => Number(r.akoya_paid) > 0);
  const native = reqs.filter((r) => r.createdon >= '2024-01-01');
  const tally = (k, fmt) => { const m = {}; for (const r of reqs) { const v = (fmt ? r[`${k}${FV}`] : r[k]) ?? '(null)'; m[v] = (m[v] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };

  console.log(`══ TOTAL wmkf_type="Miscellaneous": ${reqs.length} rows ══`);
  console.log(`  user said ~50 → ${reqs.length === 50 ? 'EXACT' : reqs.length >= 40 && reqs.length <= 60 ? `CONFIRMED (≈50, exact ${reqs.length})` : `DIVERGES (${reqs.length})`}`);
  console.log(`  with grant>0: ${withGrant.length}   paid>0: ${withPaid.length}   migrated/native split: ${reqs.length - native.length}/${native.length}`);
  console.log(`  total grant $: ${withGrant.reduce((s, r) => s + Number(r.akoya_grant || 0), 0).toLocaleString()}`);
  console.log(`  by status:`); for (const [k, n] of tally('akoya_requeststatus', false)) console.log(`    ${String(n).padStart(3)}  ${k}`);
  console.log(`  by wmkf_request_type:`); for (const [k, n] of tally('wmkf_request_type', true)) console.log(`    ${String(n).padStart(3)}  ${k}`);

  console.log(`\n══ All ${reqs.length} rows (real-grant sniff test) ══`);
  for (const r of reqs) {
    console.log(`#${r.akoya_requestnum}  ${String(r[`akoya_requeststatus`] || '—').padEnd(16)}  grant=${String(r.akoya_grant ?? 'null').padStart(10)}  paid=${String(r.akoya_paid ?? 'null').padStart(10)}  ${(r[`_akoya_applicantid_value${FV}`] || '—')} :: ${(r.akoya_title || '').slice(0, 45)}`);
  }
  console.log('\nDone (read-only verification — wmkf_type=Miscellaneous).');
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
