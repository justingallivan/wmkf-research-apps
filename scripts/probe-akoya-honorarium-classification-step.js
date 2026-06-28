#!/usr/bin/env node
/**
 * Thread 1 (READ-ONLY): what exactly does staff (Connor) set when classifying a
 * reviewer-honorarium akoya_request the day after the AkoyaGO sync creates it —
 * and is that classification step automatable?
 *
 * Method: the honorarium cohort is akoya_request where akoya_programid = the
 * "Research Reviewer" program. For EVERY honorarium (cohort is small, ~88) pull
 * RetrieveRecordChangeHistory, classify each changing user as STAFF vs SYNC/vendor
 * (app-user metadata + vendor name exclusion, same logic as
 * analyze-akoya-request-staff-edits.js), and for each STAFF-changed field capture
 * the distinct NewValues. A field staff set to the SAME value on every honorarium
 * is deterministic → automatable; a field with many distinct values (amount, dates)
 * is a judgment/data-entry input.
 *
 * Only POST is the OAuth token; every Dataverse call is a GET.
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
const PACE_MS = 120;
const VENDOR_RE = /(bromelkamp|akoyago|akoya go|^#\s|integration|sdk|data ?migration)/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getToken() {
  const res = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }) });
  if (!res.ok) throw new Error(`Token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}
async function get(token, urlPath, _retry = 0) {
  const url = urlPath.startsWith('http') ? urlPath : `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
    'OData-Version': '4.0', Prefer: 'odata.include-annotations="*"' } });
  if (r.status === 429 && _retry < 4) {
    await sleep(((parseInt(r.headers.get('Retry-After') || '0', 10) || 5)) * 1000);
    return get(token, urlPath, _retry + 1);
  }
  const txt = await r.text(); let body; try { body = JSON.parse(txt); } catch { body = txt; }
  return { status: r.status, ok: r.ok, body };
}

(async () => {
  const token = await getToken();
  console.log('Token acquired.');
  console.log('Probe date: 2026-06-28 (dated evidence) — Thread 1: honorarium classification step\n');

  // 1. Research Reviewer program GUID
  const pg = await get(token, `/akoya_programs?$filter=akoya_program eq 'Research Reviewer'&$select=akoya_programid,akoya_program`);
  if (!pg.ok || !pg.body.value?.length) { console.log('Could not resolve Research Reviewer program:', pg.status); process.exit(1); }
  const programId = pg.body.value[0].akoya_programid;
  console.log(`Research Reviewer program = ${programId}`);

  // 2. cohort: all honorarium request ids + created metadata
  let ids = [];
  let url = `/akoya_requests?$select=akoya_requestid,akoya_requestnum,createdon,createdby&$filter=_akoya_programid_value eq ${programId}`;
  while (url) {
    const u = url.startsWith('http') ? url : `${process.env.DYNAMICS_URL}/api/data/v9.2${url}`;
    const resp = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      Prefer: 'odata.maxpagesize=1000,odata.include-annotations="*"' } });
    const t = await resp.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
    if (!resp.ok) { console.log(`cohort pull [${resp.status}]`); break; }
    for (const x of b.value || []) ids.push({ id: x.akoya_requestid, num: x.akoya_requestnum,
      created: x.createdon, createdby: x[`_createdby_value${FV}`] || '' });
    url = b['@odata.nextLink'] || null;
  }
  console.log(`Honorarium cohort = ${ids.length} akoya_request rows.\n`);

  // 3. change history per record
  const field = {};         // logical -> { staffRecs:Set, syncRecs:Set, staffVals:Map(val->count), staffUsers:Map }
  const userAgg = {};       // uid -> { name, count }
  const cls = {};           // uid -> staff?
  let ok = 0, err = 0;
  const touch = (bag, key) => (bag[key] = bag[key] || { staffRecs: new Set(), syncRecs: new Set(), staffVals: new Map(), staffUsers: new Map() });

  for (let i = 0; i < ids.length; i++) {
    const tgt = encodeURIComponent(JSON.stringify({ '@odata.id': `akoya_requests(${ids[i].id})` }));
    const r = await get(token, `/RetrieveRecordChangeHistory(Target=@t)?@t=${tgt}`);
    if (!r.ok) { err++; await sleep(PACE_MS); continue; }
    ok++;
    const details = (r.body.AuditDetailCollection && r.body.AuditDetailCollection.AuditDetails) || [];
    for (const d of details) {
      const rec = d.AuditRecord || {};
      const uid = rec._userid_value || '(none)';
      const uname = rec[`_userid_value${FV}`] || '(unknown)';
      if (!userAgg[uid]) userAgg[uid] = { name: uname, count: 0 };
      const nv = d.NewValue || {};
      for (const k of Object.keys(nv)) {
        if (k.includes('@')) continue;
        if (k.endsWith('_base')) continue;
        let lg = k; if (lg.startsWith('_') && lg.endsWith('_value')) lg = lg.slice(1, -6);
        const val = nv[`${k}${FV}`] ?? nv[k];
        userAgg[uid].count++;
        const f = touch(field, lg);
        f._pending = f._pending || [];
        f._pending.push({ uid, rid: ids[i].num, val: String(val) });
      }
    }
    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${ids.length} (ok ${ok}, err ${err})`);
    await sleep(PACE_MS);
  }
  console.log(`\nHistory: ${ok} ok / ${err} err.\n`);

  // classify users
  for (const uid of Object.keys(userAgg)) {
    let app = null, fullname = userAgg[uid].name;
    if (uid && uid !== '(none)') {
      const s = await get(token, `/systemusers(${uid})?$select=fullname,applicationid`);
      if (s.ok) { app = s.body.applicationid || null; fullname = s.body.fullname || fullname; }
    }
    cls[uid] = { name: fullname, staff: !app && !VENDOR_RE.test(fullname || '') };
  }
  for (const k of Object.keys(field)) {
    const f = field[k];
    for (const p of (f._pending || [])) {
      const c = cls[p.uid] || { staff: false, name: '(unknown)' };
      if (c.staff) { f.staffRecs.add(p.rid); f.staffVals.set(p.val, (f.staffVals.get(p.val) || 0) + 1); f.staffUsers.set(c.name, (f.staffUsers.get(c.name) || 0) + 1); }
      else f.syncRecs.add(p.rid);
    }
    delete f._pending;
  }

  // roster
  console.log('── changing-user roster ──');
  for (const [uid, u] of Object.entries(userAgg).sort((a, b) => b[1].count - a[1].count)) {
    const c = cls[uid] || {}; console.log(`   ${c.staff ? 'STAFF' : 'SYNC '}  ${String(u.count).padStart(5)}  ${c.name || u.name}`);
  }

  // staff-set fields, with determinism
  console.log('\n── fields STAFF set on honoraria (→ the classification step) ──');
  console.log('   recs = # honoraria where staff set it; det = distinct staff values (1 = deterministic)\n');
  const rows = Object.entries(field).map(([k, v]) => ({ k, recs: v.staffRecs.size, det: v.staffVals.size,
    vals: [...v.staffVals.entries()].sort((a, b) => b[1] - a[1]),
    who: [...v.staffUsers.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join(', ') }))
    .filter(r => r.recs > 0).sort((a, b) => b.recs - a.recs);
  for (const r of rows) {
    const det = r.det === 1 ? 'DETERMINISTIC' : `${r.det} distinct`;
    console.log(`   ${r.k}  — recs ${r.recs}, ${det}  [${r.who}]`);
    console.log(`        values: ${r.vals.slice(0, 6).map(([v, c]) => `${v}×${c}`).join('  |  ')}${r.vals.length > 6 ? '  …' : ''}`);
  }

  console.log('\n── SYNC-only fields (set by integration, NOT staff) ──');
  const syncOnly = Object.entries(field).filter(([, v]) => v.staffRecs.size === 0 && v.syncRecs.size > 0)
    .map(([k, v]) => `${k}(${v.syncRecs.size})`).sort();
  console.log('   ' + syncOnly.join(', '));

  console.log('\nMethod: cohort = akoya_programid Research Reviewer; full enumeration; RetrieveRecordChangeHistory per record; staff vs sync by app-user metadata + vendor name. Read-only.');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
