/**
 * Read-only probe (S209) — grounds the Workbench Phase 2 smoke + Phase 3 plan.
 *
 * For each of the 35 D26 allowlist requests, reports:
 *   (a) wmkf_appreviewersuggestion rows: total / selected / accepted
 *       → what the Workbench Reviewers tab (Invite/Track/Completed) will show.
 *   (b) Legacy applicant inputs Phase 3 must ingest:
 *       - wmkf_potentialreviewer1..5 lookup slots (populated?)
 *       - wmkf_excludedreviewers free-text (present?)
 *
 * No writes. Usage: node scripts/probe-d26-reviewer-inputs.js
 * (needs .env.local DYNAMICS_* creds + network).
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

const NUMS = [
  '1002836', '1002850', '1002852', '1002872', '1002874', '1002903',
  '1002912', '1002926', '1002959', '1002963', '1002964', '1003000',
  '1003010', '1003013', '1003020', '1003024', '1003038', '1003046',
  '1002794', '1002821', '1002833', '1002835', '1002860', '1002873',
  '1002886', '1002913', '1002916', '1002953', '1002988', '1003023',
  '1003034', '1003036', '1003070', '1003074', '1003075',
];

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
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*"',
    },
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const SLOTS = [1, 2, 3, 4, 5].map(n => `_wmkf_potentialreviewer${n}_value`);

async function main() {
  const token = await getToken();

  // 1) Requests: status + slots + excluded text. Chunked OR-chain on number.
  const reqSelect = [
    'akoya_requestid', 'akoya_requestnum', 'akoya_requeststatus',
    'wmkf_excludedreviewers', ...SLOTS,
  ].join(',');

  const byNum = {};
  const CH = 12;
  for (let i = 0; i < NUMS.length; i += CH) {
    const chunk = NUMS.slice(i, i + CH);
    const filter = chunk.map(n => `akoya_requestnum eq '${n}'`).join(' or ');
    const data = await get(token, `/akoya_requests?$select=${reqSelect}&$filter=${encodeURIComponent(filter)}&$top=50`);
    for (const r of (data.value || [])) byNum[r.akoya_requestnum] = r;
  }

  // 2) Suggestion counts per request GUID.
  const idToNum = {};
  for (const n of NUMS) { const r = byNum[n]; if (r) idToNum[r.akoya_requestid] = n; }
  const ids = Object.keys(idToNum);
  const sugByNum = {}; // num -> {total, selected, accepted}
  for (let i = 0; i < ids.length; i += CH) {
    const chunk = ids.slice(i, i + CH);
    const filter = chunk.map(id => `_wmkf_request_value eq ${id}`).join(' or ');
    const data = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_selected,wmkf_accepted&$filter=${encodeURIComponent(filter)}&$top=2000`);
    for (const s of (data.value || [])) {
      const n = idToNum[s._wmkf_request_value];
      if (!n) continue;
      const b = sugByNum[n] || (sugByNum[n] = { total: 0, selected: 0, accepted: 0 });
      b.total++;
      if (s.wmkf_selected === true) b.selected++;
      if (s.wmkf_accepted === true) b.accepted++;
    }
  }

  // Report
  let withSlots = 0, withExcluded = 0, withCandidates = 0, withAccepted = 0, missing = 0;
  console.log('\nnum       status            cand(sel/acc)  slots  excludedText');
  console.log('-'.repeat(78));
  for (const n of NUMS) {
    const r = byNum[n];
    if (!r) { console.log(`${n}  (NOT FOUND)`); missing++; continue; }
    const slotsSet = SLOTS.filter(s => r[s]).length;
    const excl = (r.wmkf_excludedreviewers || '').trim();
    const sug = sugByNum[n] || { total: 0, selected: 0, accepted: 0 };
    if (slotsSet > 0) withSlots++;
    if (excl) withExcluded++;
    if (sug.total > 0) withCandidates++;
    if (sug.accepted > 0) withAccepted++;
    const status = (r.akoya_requeststatus || '—').padEnd(16);
    const candStr = `${sug.total}(${sug.selected}/${sug.accepted})`.padEnd(13);
    const exclStr = excl ? `${excl.length} chars: ${excl.slice(0, 32).replace(/\s+/g, ' ')}…` : '—';
    console.log(`${n}  ${status}  ${candStr}  ${slotsSet}/5    ${exclStr}`);
  }
  console.log('-'.repeat(78));
  console.log(`\nSummary of ${NUMS.length} D26 allowlist requests:`);
  console.log(`  found:                 ${NUMS.length - missing}/${NUMS.length}${missing ? ` (MISSING: ${missing})` : ''}`);
  console.log(`  with existing candidates (suggestion rows): ${withCandidates}`);
  console.log(`  with ≥1 ACCEPTED reviewer:                  ${withAccepted}`);
  console.log(`  with ≥1 legacy reviewer slot populated:     ${withSlots}`);
  console.log(`  with excluded-reviewer free-text:           ${withExcluded}`);
}

main().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
