#!/usr/bin/env node
/**
 * READ-ONLY Institutional Funding History probe. Uses the runtime helpers;
 * only the OAuth token call is a POST, and every Dataverse call is a GET.
 * Run with the app's extensionless resolver:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-funding-history-rollups.js 'Wake Forest University'
 * Args are request numbers or exact applicant AKA/names. No args samples several
 * institutions. Does not generate Word files or invoke an LLM.
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

const ACCOUNT_SELECT = 'accountid,name,akoya_aka,wmkf_countofprogramgrants,wmkf_sumofprogramgrants';

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
  const {
    PROGRAM_GRANT_SELECT, programGrantFilter, reconcileProgramGrantRollups,
    qualifyingFundingHistoryGrants, selectMostRecentProgramGrant, formatInstitutionalFundingHistory,
  } = await import('../lib/services/pre-site-visit/funding-history.js');
  const { formatMeetingDate } = await import('../lib/services/pre-site-visit/proposal-core-service.js');
  const token = await getToken();
  console.log(`target host: ${new URL(process.env.DYNAMICS_URL).hostname} (READ-ONLY)`);
  const targets = await resolveTargets(token, process.argv.slice(2));
  for (const target of targets) {
    const account = await get(token, `/accounts(${target.accountId})?$select=${ACCOUNT_SELECT}`);
    let next = `/akoya_requests?$select=${PROGRAM_GRANT_SELECT}&$filter=${encodeURIComponent(programGrantFilter(target.accountId))}`;
    const records = [];
    while (next) {
      const page = await get(token, next);
      for (const row of page.value || []) {
        const normalized = { ...row };
        for (const [key, value] of Object.entries(row)) {
          const suffix = '@OData.Community.Display.V1.FormattedValue';
          if (key.endsWith(suffix)) normalized[`${key.slice(0, -suffix.length)}_formatted`] = value;
        }
        records.push(normalized);
      }
      const nextLink = page['@odata.nextLink'];
      if (nextLink && !nextLink.startsWith(`${process.env.DYNAMICS_URL}/api/data/v9.2/`)) {
        throw new Error('Unexpected pagination host/path');
      }
      next = nextLink ? nextLink.slice(`${process.env.DYNAMICS_URL}/api/data/v9.2`.length) : null;
    }
    const check = reconcileProgramGrantRollups({ records, rollupCount: account.wmkf_countofprogramgrants, rollupSum: account.wmkf_sumofprogramgrants });
    if (!check.ok) throw new Error(`Rollup mismatch: ${check.reason}`);
    const qualifying = qualifyingFundingHistoryGrants(records);
    const latest = selectMostRecentProgramGrant(qualifying);
    console.log(JSON.stringify({
      institution: account.akoya_aka || account.name,
      broadCount: records.length, qualifyingCount: qualifying.length,
      awards: qualifying.map(row => ({ requestNumber: row.akoya_requestnum, amount: row.akoya_grant, program: row._akoya_programid_value_formatted })),
      sentence: formatInstitutionalFundingHistory({
        institutionName: account.akoya_aka || account.name,
        programGrantCount: qualifying.length,
        programGrantSum: qualifying.reduce((sum, row) => sum + Number(row.akoya_grant), 0),
        mostRecentGrant: latest ? {
          awardedIn: String(latest.akoya_fiscalyear || '').trim() || formatMeetingDate(latest.akoya_decisiondate),
          description: latest.wmkf_wmkfprojectdescription,
        } : null,
      }),
    }, null, 2));
  }
})().catch((error) => { console.error('PROBE ERROR:', error.message); process.exit(1); });
