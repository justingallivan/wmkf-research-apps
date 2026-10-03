#!/usr/bin/env node
/**
 * Connor walkthrough support (READ-ONLY, INSTANCE PULL — not a count re-probe):
 * list the native `akoya_requeststatus = "Active"` requests that have NO
 * `akoya_decisiondate` — the ~6% sliver where the "Active = awarded grant in
 * performance period (decided)" reading is imperfect. Point-in-time; for
 * grounding the residual (ii) label confirmation against real records.
 *
 * Native cohort = createdon >= 2024-01-01 (migrated import window was the
 * single 2023-12-03 17:42–18:25Z burst; native spreads 2024–26).
 *
 * Only POST is the OAuth token; every Dataverse call is a GET.
 */

const { loadProbeEnvLocal, getToken } = require('./lib/akoya-readonly-probe-bootstrap');
loadProbeEnvLocal();

async function get(token, urlPath) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*"',
    },
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240)}`);
  return body.value || [];
}

(async () => {
  const token = await getToken();
  console.log(`Native "Active" with NO decision date — ${new Date().toISOString()} (instance pull)\n`);

  const FV = '@OData.Community.Display.V1.FormattedValue';
  const sel = 'akoya_requestnum,akoya_requeststatus,akoya_decisiondate,createdon,akoya_grant,akoya_paid,' +
    'akoya_title,wmkf_meetingdate,_akoya_applicantid_value,_akoya_programid_value,_wmkf_type_value,wmkf_request_type,statecode';

  // For calibration: total native Active, and the no-date subset.
  const allActive = await get(token,
    `/akoya_requests?$filter=${encodeURIComponent(`akoya_requeststatus eq 'Active' and createdon ge 2024-01-01T00:00:00Z`)}&$select=akoya_requestnum,akoya_decisiondate&$top=500`);
  const noDate = await get(token,
    `/akoya_requests?$filter=${encodeURIComponent(`akoya_requeststatus eq 'Active' and akoya_decisiondate eq null and createdon ge 2024-01-01T00:00:00Z`)}&$select=${sel}&$orderby=createdon desc&$top=100`);

  const nWithDate = allActive.filter((r) => r.akoya_decisiondate).length;
  console.log(`native Active total=${allActive.length}  with decision date=${nWithDate}  NO decision date=${allActive.length - nWithDate}`);
  console.log(`(point-in-time; the committed Puzzle-4 aggregate was n=109 / ~94% dated — expect drift, this is an instance read)\n`);

  console.log(`══ The no-decision-date "Active" rows (${noDate.length}) ══\n`);
  for (const r of noDate) {
    console.log(`#${r.akoya_requestnum}  "${(r.akoya_title || '(no title)').slice(0, 70)}"`);
    console.log(`   applicant : ${r[`_akoya_applicantid_value${FV}`] || '—'}`);
    console.log(`   program   : ${r[`_akoya_programid_value${FV}`] || '—'}   type=${r[`_wmkf_type_value${FV}`] || '—'}   reqtype=${r[`wmkf_request_type${FV}`] || '—'}`);
    console.log(`   grant=${r.akoya_grant ?? 'null'}  paid=${r.akoya_paid ?? 'null'}  decisiondate=${r.akoya_decisiondate || 'NULL'}  meetingdate=${r.akoya_meetingdate || r.wmkf_meetingdate || '—'}`);
    console.log(`   createdon=${r.createdon}  state=${r[`statecode${FV}`] || r.statecode}`);
    console.log();
  }

  // Interpretation hooks for the Connor discussion.
  const fundedNoDate = noDate.filter((r) => Number(r.akoya_grant) > 0);
  const dryNoDate = noDate.filter((r) => !(Number(r.akoya_grant) > 0));
  console.log('── for the Connor label check ──');
  console.log(`  no-date Active WITH a grant amount: ${fundedNoDate.length}  → "awarded grant, decision-date just not stamped" (data-entry gap on a real grant)`);
  console.log(`  no-date Active WITHOUT a grant amount: ${dryNoDate.length}  → the genuinely odd ones (Active but no money + no decision) — ask Connor what 'Active' means here`);
  console.log('\nDone (read-only instance pull — residual (ii) "Active" label).');
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
