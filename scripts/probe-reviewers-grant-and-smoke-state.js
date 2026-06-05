/**
 * Read-only probe (S220) — grounds the reviewer-workflow validation smoke.
 *
 * Reports:
 *   (a) Everyone who currently holds the `reviewers` app grant
 *       (wmkf_appuserappaccesses where wmkf_appkey='reviewers'), with name/email
 *       resolved from systemusers — so we know if granting is even needed.
 *   (b) For the smoke testbed request 1002788 (Connor's purpose-built test,
 *       lead PD Justin): wmkf_appreviewersuggestion rows (total / selected /
 *       invited / accepted / completed) + applicant input slots
 *       (wmkf_potentialreviewer1..5, wmkf_excludedreviewers).
 *
 * No writes. Usage: node scripts/probe-reviewers-grant-and-smoke-state.js
 * (needs .env.local DYNAMICS_* creds + network).
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const RESOURCE = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
const TENANT = process.env.AZURE_AD_TENANT_ID || process.env.DYNAMICS_TENANT_ID;
const CLIENT_ID = process.env.DYNAMICS_CLIENT_ID;
const CLIENT_SECRET = process.env.DYNAMICS_CLIENT_SECRET;

async function getToken() {
  const url = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: `${RESOURCE}/.default`,
    grant_type: 'client_credentials',
  });
  const r = await fetch(url, { method: 'POST', body });
  if (!r.ok) throw new Error(`token failed: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

async function get(token, urlPath) {
  const r = await fetch(`${RESOURCE}/api/data/v9.2${urlPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*"',
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${urlPath} -> ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  if (!RESOURCE || !TENANT || !CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing DYNAMICS_* / AZURE_AD_* env. Need RESOURCE, TENANT, CLIENT_ID, CLIENT_SECRET.');
    process.exit(1);
  }
  const token = await getToken();

  // (a) reviewers grant holders
  console.log('=== reviewers app-grant holders ===');
  const grants = await get(
    token,
    `/wmkf_appuserappaccesses?$filter=${encodeURIComponent("wmkf_appkey eq 'reviewers'")}&$select=wmkf_appuserappaccessid,_wmkf_user_value`,
  );
  if (!grants.value.length) {
    console.log('  (none) — no one holds the reviewers grant yet.');
  } else {
    for (const g of grants.value) {
      const sid = g._wmkf_user_value;
      let who = sid;
      try {
        const u = await get(token, `/systemusers(${sid})?$select=fullname,internalemailaddress,isdisabled`);
        who = `${u.fullname} <${u.internalemailaddress}>${u.isdisabled ? ' [DISABLED]' : ''}`;
      } catch (e) {
        who = `${sid} (lookup failed: ${e.message})`;
      }
      console.log(`  - ${who}`);
    }
  }

  // (b) smoke request 1002788 reviewer state
  console.log('\n=== smoke request 1002788 ===');
  const SLOTS = [1, 2, 3, 4, 5].map((n) => `_wmkf_potentialreviewer${n}_value`);
  const reqSelect = [
    'akoya_requestid', 'akoya_requestnum', 'akoya_requeststatus',
    'wmkf_excludedreviewers', '_wmkf_programdirector_value', ...SLOTS,
  ].join(',');
  const reqs = await get(
    token,
    `/akoya_requests?$filter=${encodeURIComponent("akoya_requestnum eq '1002788'")}&$select=${reqSelect}`,
  );
  if (!reqs.value.length) {
    console.log('  request 1002788 not found.');
    return;
  }
  const req = reqs.value[0];
  console.log(`  status: ${req['akoya_requeststatus@OData.Community.Display.V1.FormattedValue'] || req.akoya_requeststatus}`);
  console.log(`  lead PD: ${req['_wmkf_programdirector_value@OData.Community.Display.V1.FormattedValue'] || req._wmkf_programdirector_value || '(none)'}`);
  console.log(`  excluded reviewers (free text): ${req.wmkf_excludedreviewers || '(none)'}`);
  for (const s of SLOTS) {
    if (req[s]) {
      const label = req[`${s}@OData.Community.Display.V1.FormattedValue`] || req[s];
      console.log(`  applicant ${s}: ${label}`);
    }
  }

  const reqId = req.akoya_requestid;
  const sugg = await get(
    token,
    `/wmkf_appreviewersuggestions?$filter=${encodeURIComponent(`_wmkf_request_value eq ${reqId}`)}&$select=wmkf_appreviewersuggestionid,wmkf_suggestionlabel,wmkf_reviewerfirstname,wmkf_reviewerlastname,wmkf_selected,wmkf_invited,wmkf_accepted,wmkf_reviewstatus,wmkf_applicantdisposition,wmkf_completedat`,
  );
  const rows = sugg.value;
  const n = (p) => rows.filter(p).length;
  console.log(`\n  wmkf_appreviewersuggestion rows: ${rows.length}`);
  console.log(`    selected:  ${n((r) => r.wmkf_selected)}`);
  console.log(`    invited:   ${n((r) => r.wmkf_invited)}`);
  console.log(`    accepted:  ${n((r) => r.wmkf_accepted)}`);
  console.log(`    completed: ${n((r) => r.wmkf_completedat)}`);
  const recommended = n((r) => r.wmkf_applicantdisposition === 100000000);
  const excluded = n((r) => r.wmkf_applicantdisposition === 100000001);
  console.log(`    applicant-recommended disposition: ${recommended}`);
  console.log(`    applicant-excluded disposition:    ${excluded}`);
  if (rows.length) {
    console.log('\n  rows:');
    for (const r of rows) {
      const flags = [
        r.wmkf_selected && 'selected',
        r.wmkf_invited && 'invited',
        r.wmkf_accepted && 'accepted',
        r.wmkf_completedat && 'completed',
      ].filter(Boolean).join(',') || '-';
      const nm = r.wmkf_suggestionlabel || `${r.wmkf_reviewerfirstname || ''} ${r.wmkf_reviewerlastname || ''}`.trim() || '(no name)';
      console.log(`    - ${nm} [${flags}]`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
