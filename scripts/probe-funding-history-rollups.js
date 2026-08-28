#!/usr/bin/env node
/**
 * READ-ONLY probe — Institutional Funding History data contract (S467).
 *
 * Question: do the account rollups `wmkf_countofprogramgrants` /
 * `wmkf_sumofprogramgrants` agree with the live `akoya_request` rows matching
 * the rollups' own predicate (`wmkf_typeforrollup eq 'Program' and
 * akoya_grant gt 0`, recovered from their FormulaDefinition 2026-08-28)?
 * The Pre-Site writeup fails closed on disagreement
 * (lib/services/pre-site-visit/funding-history.js), so a systematic mismatch
 * here would block every generation — cheaper to learn from a read than from
 * a mutating smoke on a real request.
 *
 * For each target account it prints: rollups vs live count/sum, the most
 * recent RESEARCH program grant (decision date, else meeting date; ambiguous if
 * any program grant has neither), and the exact sentence the writeup would render.
 *
 * Targets: CLI args may be request numbers (resolved to the applicant account)
 * or account AKA/names. With no args: Request 1002379's applicant, "Emory
 * University", the four accounts with the highest program-grant count, and one
 * account with requests but zero program grants.
 *
 * The pure logic is REPLICATED here (the lib module's import chain is
 * extensionless and does not load under plain Node); keep it in step with
 * funding-history.js — predicate, cents comparison, recency, tie-break, sentence.
 *
 * Only the OAuth token call is a POST; every Dataverse call is a GET.
 * No records are created, updated, or deleted.
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

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_SELECT = 'accountid,name,akoya_aka,wmkf_countofprogramgrants,wmkf_sumofprogramgrants,wmkf_countofprogramgrants_date,wmkf_sumofprogramgrants_date,akoya_mostrecentgrant,akoya_countofawards,akoya_countofrequests';
const REQUEST_SELECT = 'akoya_requestid,akoya_requestnum,akoya_fiscalyear,akoya_decisiondate,wmkf_meetingdate,akoya_grant,_wmkf_grantprogram_value,wmkf_wmkfprojectdescription';
const RESEARCH_LABEL = 'Research';
const isResearch = (r) => String(r['_wmkf_grantprogram_value@OData.Community.Display.V1.FormattedValue'] || '').trim() === RESEARCH_LABEL;

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
  if (!r.ok) throw new Error(`GET ${urlPath.slice(0, 120)} → ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

const esc = (s) => String(s).replace(/'/g, "''");

// ── replicated from lib/services/pre-site-visit/funding-history.js ──
function programGrantFilter(applicantId) {
  if (!GUID.test(applicantId)) throw new Error('applicantId must be a GUID');
  return `_akoya_applicantid_value eq ${applicantId} and wmkf_typeforrollup eq 'Program' and akoya_grant gt 0`;
}
const cents = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null);
function reconcile(records, rollupCount, rollupSum) {
  const liveCount = records.length;
  const liveSum = records.reduce((t, r) => t + (Number(r.akoya_grant) || 0), 0);
  const count = Number(rollupCount);
  const rc = Number.isFinite(count) ? count : 0;
  if (rc !== liveCount) return { ok: false, reason: `rollup count ${rc} != live count ${liveCount}`, liveCount, liveSum };
  const rcents = cents(rollupSum);
  if (liveCount === 0) {
    return rcents === null || rcents === 0
      ? { ok: true, liveCount, liveSum }
      : { ok: false, reason: `rollup sum ${rollupSum} with zero live rows`, liveCount, liveSum };
  }
  if (rcents === null || rcents !== cents(liveSum)) return { ok: false, reason: `rollup sum ${rollupSum} != live sum ${liveSum}`, liveCount, liveSum };
  return { ok: true, liveCount, liveSum };
}
const clean = (v) => (v == null ? null : (String(v).trim() || null));
function recency(row) {
  const v = clean(row.akoya_decisiondate) || clean(row.wmkf_meetingdate);
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}
function tieBreak(a, b) {
  const an = Number(a?.akoya_requestnum); const bn = Number(b?.akoya_requestnum);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  return String(a?.akoya_requestnum || '').localeCompare(String(b?.akoya_requestnum || ''))
    || String(a?.akoya_requestid || '').localeCompare(String(b?.akoya_requestid || ''));
}
function mostRecent(records) {
  let best = null; let bestT = -Infinity; const undated = [];
  for (const row of records) {
    const t = recency(row);
    if (t === null) { undated.push(row.akoya_requestnum || row.akoya_requestid); continue; }
    if (t > bestT || (t === bestT && tieBreak(row, best) > 0)) { best = row; bestT = t; }
  }
  return { best, undated };
}
function formatAwardTotal(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e6) return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  return `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')} million`;
}
function monthYear(v) {
  const t = clean(v); if (!t) return null; const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}
function inlineDescription(v) {
  const text = clean(v); if (!text) return null;
  const trimmed = text.replace(/[.\s]+$/, ''); if (!trimmed) return null;
  if (trimmed.length > 1 && /[A-Z]/.test(trimmed[0]) && /[a-z]/.test(trimmed[1])) return trimmed[0].toLowerCase() + trimmed.slice(1);
  return trimmed;
}
function sentence({ institutionName, programGrantCount, programGrantSum, mostRecentGrant }) {
  const name = clean(institutionName);
  const count = Number(programGrantCount);
  if (!(Number.isFinite(count) && count > 0)) return `${name} has not previously received a program grant from WMKF.`;
  const total = formatAwardTotal(programGrantSum);
  const first = total
    ? `${name} has received ${count} award${count === 1 ? '' : 's'} totaling ${total} from WMKF.`
    : `${name} has received ${count} award${count === 1 ? '' : 's'} from WMKF.`;
  const awardedIn = clean(mostRecentGrant?.awardedIn);
  if (!awardedIn) return first;
  const d = inlineDescription(mostRecentGrant?.description);
  const q = clean(mostRecentGrant?.qualifier);
  return `${first} The most recent ${q ? `${q} ` : ''}grant was awarded in ${awardedIn}${d ? ` ${d}` : ''}.`;
}
// ── end replicated logic ──

async function resolveTargets(token, args) {
  const targets = []; // { label, accountId }
  const pushAccount = (label, id) => { if (id && !targets.some((t) => t.accountId === id)) targets.push({ label, accountId: id }); };

  async function byRequestNumber(num) {
    const r = await get(token, `/akoya_requests?$select=akoya_requestid,_akoya_applicantid_value&$filter=akoya_requestnum eq '${esc(num)}'&$top=1`);
    const row = r.value?.[0];
    if (!row?._akoya_applicantid_value) { console.log(`  ! request ${num}: not found or no applicant`); return; }
    pushAccount(`request ${num} → ${row['_akoya_applicantid_value@OData.Community.Display.V1.FormattedValue'] || 'applicant'}`, row._akoya_applicantid_value);
  }
  async function byName(name) {
    const r = await get(token, `/accounts?$select=accountid,name,akoya_aka&$filter=akoya_aka eq '${esc(name)}' or name eq '${esc(name)}'&$top=3`);
    if (!r.value?.length) { console.log(`  ! account "${name}": not found`); return; }
    for (const a of r.value) pushAccount(`account "${a.akoya_aka || a.name}"`, a.accountid);
  }

  if (args.length) {
    for (const a of args) await (/^\d{5,}$/.test(a) ? byRequestNumber(a) : byName(a));
    return targets;
  }
  await byRequestNumber('1002379');
  await byName('Emory University');
  const top = await get(token, `/accounts?$select=accountid,name,akoya_aka,wmkf_countofprogramgrants&$filter=wmkf_countofprogramgrants gt 0&$orderby=wmkf_countofprogramgrants desc&$top=4`);
  for (const a of top.value || []) pushAccount(`top-count account "${a.akoya_aka || a.name}"`, a.accountid);
  const zero = await get(token, `/accounts?$select=accountid,name,akoya_aka,akoya_countofrequests&$filter=wmkf_countofprogramgrants eq 0 and akoya_countofrequests gt 3&$orderby=akoya_countofrequests desc&$top=1`);
  for (const a of zero.value || []) pushAccount(`zero-program-grant account "${a.akoya_aka || a.name}"`, a.accountid);
  return targets;
}

(async () => {
  const token = await getToken();
  console.log(`target host: ${new URL(process.env.DYNAMICS_URL).hostname}  (READ-ONLY, ${new Date().toISOString()})`);
  console.log(`predicate: ${programGrantFilter('00000000-0000-0000-0000-000000000000').replace('00000000-0000-0000-0000-000000000000', '<applicantId>')}\n`);

  const targets = await resolveTargets(token, process.argv.slice(2));
  const summary = { agree: 0, disagree: 0, ambiguous: 0, total: targets.length };

  for (const target of targets) {
    console.log(`══ ${target.label}  (${target.accountId})`);
    const acct = await get(token, `/accounts(${target.accountId})?$select=${ACCOUNT_SELECT}`);
    const live = await get(token, `/akoya_requests?$select=${REQUEST_SELECT}&$filter=${encodeURIComponent(programGrantFilter(target.accountId))}&$count=true`);
    const rows = live.value || [];
    const rec = reconcile(rows, acct.wmkf_countofprogramgrants, acct.wmkf_sumofprogramgrants);
    const name = clean(acct.akoya_aka) || clean(acct.name);

    console.log(`  rollups : count=${acct.wmkf_countofprogramgrants ?? 'null'}  sum=${acct.wmkf_sumofprogramgrants ?? 'null'}  (count updated ${acct.wmkf_countofprogramgrants_date || '?'}; sum updated ${acct.wmkf_sumofprogramgrants_date || '?'})`);
    console.log(`  live    : count=${rec.liveCount}  sum=${rec.liveSum}  (@odata.count=${live['@odata.count'] ?? '?'}; nextLink=${live['@odata.nextLink'] ? 'YES — paginated' : 'no'})`);
    console.log(`  other   : akoya_countofawards=${acct.akoya_countofawards ?? 'null'}  akoya_mostrecentgrant=${acct.akoya_mostrecentgrant || 'null'}`);

    const { best: newestOverall, undated } = mostRecent(rows);
    const { best } = mostRecent(rows.filter(isResearch));
    const qualifier = best && newestOverall && best.akoya_requestid !== newestOverall.akoya_requestid ? 'research' : null;
    if (rec.ok) summary.agree += 1; else summary.disagree += 1;
    if (undated.length) summary.ambiguous += 1;

    console.log(`  reconcile: ${rec.ok ? 'AGREE' : `DISAGREE — ${rec.reason}`}${undated.length ? `   | UNDATED program grants (would fail closed): ${undated.join(', ')}` : ''}`);
    if (!rec.ok || undated.length) {
      for (const r of rows.sort((a, b) => (recency(b) ?? -1) - (recency(a) ?? -1))) {
        console.log(`      ${String(r.akoya_requestnum || '?').padEnd(9)} grant=${String(r.akoya_grant ?? 'null').padStart(11)}  decision=${r.akoya_decisiondate || '-'}  meeting=${r.wmkf_meetingdate || '-'}  fy=${r.akoya_fiscalyear || '-'}`);
      }
    }
    if (best) {
      console.log(`  newest  : ${best.akoya_requestnum} (research${qualifier ? `; newest program grant overall is ${newestOverall.akoya_requestnum}` : ''})  decision=${best.akoya_decisiondate || '-'}  meeting=${best.wmkf_meetingdate || '-'}  fy=${best.akoya_fiscalyear || '-'}  desc=${best.wmkf_wmkfprojectdescription ? `"${String(best.wmkf_wmkfprojectdescription).slice(0, 90)}"` : 'null'}`);
    }
    const text = sentence({
      institutionName: name,
      programGrantCount: acct.wmkf_countofprogramgrants,
      programGrantSum: acct.wmkf_sumofprogramgrants,
      mostRecentGrant: best ? {
        awardedIn: clean(best.akoya_fiscalyear) || monthYear(best.akoya_decisiondate || best.wmkf_meetingdate),
        description: best.wmkf_wmkfprojectdescription,
        qualifier,
      } : null,
    });
    const wouldRender = rec.ok && !undated.length && !live['@odata.nextLink'];
    console.log(`  writeup : ${wouldRender ? 'RENDERS' : 'FAILS CLOSED (409)'}${wouldRender ? ` → "${text}"` : `  (sentence if allowed: "${text}")`}\n`);
  }

  console.log(`── summary: ${summary.total} accounts · agree ${summary.agree} · disagree ${summary.disagree} · with undated program grants ${summary.ambiguous}`);
  console.log('Done (read-only).');
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
