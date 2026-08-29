#!/usr/bin/env node
/**
 * Read-only inventory of everything the writeup pipeline has left on one
 * Request (default 1002379, the production smoke vehicle since 2026-08-17),
 * as input to an owner-confirmed cleanup list. Prints identities, statuses,
 * timestamps, and SharePoint references — never document content, prompt
 * bodies, or credentials.
 *
 * Reads (all GET; the only POST is the OAuth token call):
 *   - akoya_request: pointers (wmkf_currentinitialassessment /
 *     wmkf_currentpresitevisit / wmkf_currentfinalwriteup),
 *     wmkf_researchwriteuptype, modifiedon/modifiedby.
 *   - wmkf_requestdocuments for the request: every registry row, oldest first,
 *     with artifact/operation/lifecycle, prompt/version, AI run, SharePoint
 *     item/folder/file, reopen fields, milestone fields, orphan-cleanup JSON,
 *     created/modified.
 *   - wmkf_ai_runs bound to the request (wmkf_ai_Request), with status/source/
 *     model/prompt version, and which registry row (if any) references each.
 *   - Per-record change history on the akoya_request row via
 *     RetrieveRecordChangeHistory (documented as working on ONE request in
 *     docs/DATAVERSE_POWER_TOOLS_DESIGN.md; a 403/empty result is reported,
 *     not fatal) — to catch any test mutation to the request itself.
 *
 * Usage: node scripts/probe-request-1002379-test-inventory.js [--request=1002379] [--since=2026-08-17]
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

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const REQUEST_NUM = arg('request', '1002379');
const SINCE = arg('since', '2026-08-17');
if (!/^\d{6,8}$/.test(REQUEST_NUM)) throw new Error('--request must be a request number');
if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) throw new Error('--since must be YYYY-MM-DD');

const ARTIFACT = { 100000000: 'Initial Assessment', 100000001: 'Pre Site Visit', 100000002: 'Final Writeup', 100000003: 'Applicant Slides', 100000004: 'Other Applicant Materials', 100000005: 'Recording', 100000006: 'Transcript', 100000007: 'Transcript Summary' };
const OPERATION = { 100000000: 'Generating', 100000001: 'Ready', 100000002: 'Failed' };
const LIFECYCLE = { 100000000: 'Draft', 100000001: 'Review', 100000002: 'Board Ready', 100000003: 'Superseded', 100000004: 'Final' };
const RUN_STATUS = { 682090000: 'completed', 682090001: 'failed', 682090002: 'needs_review' };
const RUN_SOURCE = { 682090000: 'PowerAutomate Auto', 682090001: 'Vercel User', 682090002: 'Vercel Test', 682090003: 'Vercel Interactive', 682090004: 'PowerAutomate Test', 682090005: 'PowerAutomate Manual' };

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status}`);
  return (await r.json()).access_token;
}

async function get(token, urlPath, { soft = false } = {}) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.include-annotations="*"' },
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) {
    if (soft) return { __error: r.status, message: (body?.error?.message || String(body)).slice(0, 200) };
    throw new Error(`GET ${urlPath.slice(0, 140)} → ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

const fmt = (v) => (v == null || v === '' ? '—' : String(v));
const ts = (v) => (v ? String(v).replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—');
const short = (id) => (id ? String(id).slice(0, 8) : '—');
const byName = (row, field) => row[`${field}@OData.Community.Display.V1.FormattedValue`] || null;

async function main() {
  const token = await getToken();

  // ── Request row + pointers ────────────────────────────────────────────────
  const reqSel = 'akoya_requestid,akoya_requestnum,akoya_title,modifiedon,_modifiedby_value,wmkf_researchwriteuptype,_wmkf_currentinitialassessment_value,_wmkf_currentpresitevisit_value,_wmkf_currentfinalwriteup_value,_akoya_applicantid_value';
  const reqRes = await get(token, `/akoya_requests?$select=${reqSel}&$filter=akoya_requestnum eq '${REQUEST_NUM}'&$top=2`);
  if (reqRes.value.length !== 1) throw new Error(`Expected exactly one request ${REQUEST_NUM}, got ${reqRes.value.length}`);
  const req = reqRes.value[0];
  const requestId = req.akoya_requestid;

  console.log(`# Test-mutation inventory — Request ${REQUEST_NUM} (${requestId})`);
  console.log(`# Window: since ${SINCE}; read-only; generated ${new Date().toISOString()}\n`);
  console.log('## akoya_request row');
  console.log(`- name: ${fmt(req.akoya_title)}`);
  console.log(`- applicant: ${fmt(byName(req, '_akoya_applicantid_value'))}`);
  console.log(`- modifiedon: ${ts(req.modifiedon)} by ${fmt(byName(req, '_modifiedby_value'))}`);
  console.log(`- wmkf_researchwriteuptype: ${fmt(byName(req, 'wmkf_researchwriteuptype') || req.wmkf_researchwriteuptype)}`);
  console.log(`- pointer wmkf_currentinitialassessment: ${fmt(req._wmkf_currentinitialassessment_value)}`);
  console.log(`- pointer wmkf_currentpresitevisit:     ${fmt(req._wmkf_currentpresitevisit_value)}`);
  console.log(`- pointer wmkf_currentfinalwriteup:     ${fmt(req._wmkf_currentfinalwriteup_value)}`);

  // ── Registry rows ─────────────────────────────────────────────────────────
  const docSel = [
    'wmkf_requestdocumentid', 'wmkf_name', 'wmkf_artifacttype', 'wmkf_operationstatus', 'wmkf_lifecyclestate',
    'wmkf_cyclecode', 'wmkf_producer', 'wmkf_promptname', 'wmkf_promptversion', 'wmkf_templateversion',
    'wmkf_sharepointdriveid', 'wmkf_sharepointitemid', 'wmkf_sharepointfolderpath', 'wmkf_filename', 'wmkf_sharepointversionid', 'wmkf_sharepointweburl',
    'wmkf_attemptcount', 'wmkf_lasterrorcode', 'wmkf_lastfailedat', 'wmkf_orphancleanupjson', 'wmkf_orphancleanupoverflowjson',
    'wmkf_milestoneversionid', 'wmkf_milestonecreatedat',
    'wmkf_reopencycleid', 'wmkf_reopenreasoncode', 'wmkf_reopenreasonnote',
    '_wmkf_airun_value', '_wmkf_sourcedocument_value', '_createdby_value', 'createdon', 'modifiedon',
  ].join(',');
  const docs = (await get(token, `/wmkf_requestdocuments?$select=${docSel}&$filter=_wmkf_request_value eq ${requestId}&$orderby=createdon asc&$top=500`)).value;
  const docById = new Map(docs.map((d) => [d.wmkf_requestdocumentid, d]));
  const pointers = new Set([req._wmkf_currentinitialassessment_value, req._wmkf_currentpresitevisit_value, req._wmkf_currentfinalwriteup_value].filter(Boolean));

  console.log(`\n## wmkf_requestdocument rows for this request: ${docs.length} (${docs.filter((d) => d.createdon >= SINCE).length} created since ${SINCE})`);
  const summary = {};
  for (const d of docs) {
    const k = `${ARTIFACT[d.wmkf_artifacttype] || d.wmkf_artifacttype} / ${OPERATION[d.wmkf_operationstatus] || '?'} / ${LIFECYCLE[d.wmkf_lifecyclestate] || '?'}`;
    summary[k] = (summary[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(summary)) console.log(`- ${n} × ${k}`);
  console.log('');
  console.log('| # | row id | created | artifact | op | lifecycle | cycle | prompt v | AI run | SharePoint item | file | reopen | milestone | attempts/err | pointer | source row | orphan json |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  docs.forEach((d, i) => {
    const reopen = d.wmkf_reopencycleid ? `${short(d.wmkf_reopencycleid)} ${fmt(d.wmkf_reopenreasoncode)}${d.wmkf_reopenreasonnote ? ` "${String(d.wmkf_reopenreasonnote).slice(0, 30)}"` : ''}` : '—';
    const milestone = d.wmkf_milestoneversionid ? `v${d.wmkf_milestoneversionid} @ ${ts(d.wmkf_milestonecreatedat)}` : '—';
    const err = `${fmt(d.wmkf_attemptcount)}${d.wmkf_lasterrorcode ? ` / ${d.wmkf_lasterrorcode}` : ''}`;
    const orphan = (d.wmkf_orphancleanupjson || d.wmkf_orphancleanupoverflowjson) ? 'YES' : '—';
    const pointer = pointers.has(d.wmkf_requestdocumentid) ? '◀ current' : '';
    console.log(`| ${i + 1} | ${d.wmkf_requestdocumentid} | ${ts(d.createdon)} | ${ARTIFACT[d.wmkf_artifacttype] || d.wmkf_artifacttype} | ${OPERATION[d.wmkf_operationstatus] || '?'} | ${LIFECYCLE[d.wmkf_lifecyclestate] || '?'} | ${fmt(d.wmkf_cyclecode)} | ${fmt(d.wmkf_promptname)} v${fmt(d.wmkf_promptversion)} | ${short(d._wmkf_airun_value)} | ${fmt(d.wmkf_sharepointitemid)} | ${fmt(d.wmkf_sharepointfolderpath)}/${fmt(d.wmkf_filename)} (sp v${fmt(d.wmkf_sharepointversionid)}) | ${reopen} | ${milestone} | ${err} | ${pointer} | ${short(d._wmkf_sourcedocument_value)} | ${orphan} |`);
  });

  // Distinct SharePoint items (the files that would need deleting)
  const items = new Map();
  for (const d of docs) {
    if (!d.wmkf_sharepointitemid) continue;
    const key = `${d.wmkf_sharepointdriveid}|${d.wmkf_sharepointitemid}`;
    if (!items.has(key)) items.set(key, { drive: d.wmkf_sharepointdriveid, item: d.wmkf_sharepointitemid, path: `${d.wmkf_sharepointfolderpath}/${d.wmkf_filename}`, url: d.wmkf_sharepointweburl, rows: [] });
    items.get(key).rows.push(short(d.wmkf_requestdocumentid));
  }
  console.log(`\n## Distinct SharePoint files referenced: ${items.size}`);
  for (const it of items.values()) console.log(`- item ${it.item} (drive ${short(it.drive)}…) ${it.path} — rows ${it.rows.join(', ')}${it.url ? `\n  ${it.url}` : ''}`);

  // Orphan-cleanup records
  const orphans = docs.filter((d) => d.wmkf_orphancleanupjson || d.wmkf_orphancleanupoverflowjson);
  if (orphans.length) {
    console.log('\n## Rows carrying orphan-cleanup work (retained copies the app already knows about)');
    for (const d of orphans) {
      let parsed; try { parsed = JSON.parse(d.wmkf_orphancleanupjson || '[]'); } catch { parsed = d.wmkf_orphancleanupjson; }
      console.log(`- ${short(d.wmkf_requestdocumentid)}: ${JSON.stringify(parsed).slice(0, 400)}${d.wmkf_orphancleanupoverflowjson ? ' (+overflow)' : ''}`);
    }
  }

  // ── AI runs ───────────────────────────────────────────────────────────────
  const runSel = 'wmkf_ai_runid,createdon,wmkf_ai_status,wmkf_ai_runsource,wmkf_ai_model,wmkf_ai_promptversion,_wmkf_ai_prompt_value,_createdby_value';
  const runs = (await get(token, `/wmkf_ai_runs?$select=${runSel}&$filter=_wmkf_ai_request_value eq ${requestId}&$orderby=createdon asc&$top=500`)).value;
  const referenced = new Map();
  for (const d of docs) if (d._wmkf_airun_value) referenced.set(d._wmkf_airun_value, short(d.wmkf_requestdocumentid));
  console.log(`\n## wmkf_ai_run rows bound to this request: ${runs.length} (${runs.filter((r) => r.createdon >= SINCE).length} since ${SINCE})`);
  console.log('| run id | created | status | source | model | prompt | v | created by | referenced by row |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) {
    console.log(`| ${r.wmkf_ai_runid} | ${ts(r.createdon)} | ${RUN_STATUS[r.wmkf_ai_status] || r.wmkf_ai_status} | ${RUN_SOURCE[r.wmkf_ai_runsource] || r.wmkf_ai_runsource} | ${fmt(r.wmkf_ai_model)} | ${fmt(byName(r, '_wmkf_ai_prompt_value'))} | ${fmt(r.wmkf_ai_promptversion)} | ${fmt(byName(r, '_createdby_value'))} | ${referenced.get(r.wmkf_ai_runid) || '(unreferenced)'} |`);
  }

  // ── Change history on the request row itself ─────────────────────────────
  console.log(`\n## akoya_request change history since ${SINCE} (RetrieveRecordChangeHistory)`);
  const hist = await get(token, `/RetrieveRecordChangeHistory(Target=@t)?@t={'@odata.id':'akoya_requests(${requestId})'}`, { soft: true });
  if (hist.__error) {
    console.log(`- unavailable: HTTP ${hist.__error} ${hist.message}`);
  } else {
    const details = hist?.AuditDetailCollection?.AuditDetails || [];
    const recent = details.filter((a) => (a?.AuditRecord?.createdon || '') >= SINCE);
    console.log(`- ${details.length} audit detail(s) total; ${recent.length} since ${SINCE}`);
    for (const a of recent) {
      const rec = a.AuditRecord || {};
      const changed = (a.NewValue && Object.keys(a.NewValue).filter((k) => !k.startsWith('@') && !k.startsWith('_') || k.startsWith('_wmkf'))) || [];
      console.log(`  - ${ts(rec.createdon)} ${fmt(rec['action@OData.Community.Display.V1.FormattedValue'])} by ${fmt(rec['_userid_value@OData.Community.Display.V1.FormattedValue'])}: ${changed.join(', ') || '(no attribute list)'}`);
    }
  }
  console.log('\n# End of inventory (no writes performed).');
}

main().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
