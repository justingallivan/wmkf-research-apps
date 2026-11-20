#!/usr/bin/env node
// End-to-end impersonation smoke. Run after Connor grants Delegate role
// to the # WMK: Research Review App Suite app user.
//
//   Step 1: PATCH akoya_request 1002379 wmkf_ai_summary with MSCRMCallerID=Justin.
//           Expect 204; verify _modifiedby_value === JUSTIN_SYSTEMUSERID.
//   Step 2: POST a wmkf_ai_run row with MSCRMCallerID=Justin.
//           Expect 201; verify _createdby_value === JUSTIN_SYSTEMUSERID.
//
// Mirrors the post-grant verification plan in
// docs/CONNOR_DELEGATE_ROLE_REQUEST.md without going through the UI.

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

const JUSTIN_SYSTEMUSERID = '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7';
const APP_USER_ID = '53e97fb3-a006-f111-8406-000d3a352682';
const REQUEST_NUMBER = '1002379';

// wmkf_ai_run picklist values from lib/services/dynamics-service.js
const TASK_TYPE_PHASE_I = 682090000; // phase_i_summary
const STATUS_COMPLETED = 682090000;

let TOKEN = null;

async function getToken() {
  if (TOKEN) return TOKEN;
  const res = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!res.ok) throw new Error(`Token: ${res.status} ${await res.text()}`);
  TOKEN = (await res.json()).access_token;
  return TOKEN;
}

async function dv(method, pathSuffix, { body, impersonate, prefer } = {}) {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
  };
  if (body) headers['Content-Type'] = 'application/json';
  if (impersonate) headers['MSCRMCallerID'] = impersonate;
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${pathSuffix}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, ok: res.ok, headers: res.headers, data };
}

function expect(label, cond, detail = '') {
  const mark = cond ? '✓' : '✗';
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 2;
}

async function main() {
  console.log('=== Impersonation re-smoke ===');
  console.log(`Justin systemuserid: ${JUSTIN_SYSTEMUSERID}`);
  console.log(`App user systemuserid: ${APP_USER_ID}`);
  console.log('');

  // Lookup request GUID
  console.log(`Step 0: Look up akoya_request ${REQUEST_NUMBER}`);
  const lookup = await dv('GET', `/akoya_requests?$select=akoya_requestid,wmkf_ai_summary&$filter=akoya_requestnum eq '${REQUEST_NUMBER}'`);
  if (!lookup.ok || !lookup.data?.value?.length) {
    console.error('  ✗ Lookup failed:', lookup.status, lookup.data);
    process.exit(1);
  }
  const requestGuid = lookup.data.value[0].akoya_requestid;
  const currentSummary = lookup.data.value[0].wmkf_ai_summary;
  console.log(`  ✓ requestid: ${requestGuid}`);
  console.log(`  ✓ current wmkf_ai_summary: ${JSON.stringify(currentSummary)?.slice(0, 80)}`);
  console.log('');

  // Step 1: impersonated PATCH
  console.log('Step 1: Impersonated PATCH on akoya_request');
  const newSummary = `(impersonation re-smoke ${new Date().toISOString().slice(0,10)} — please run /phase-i-dynamics with overwrite=true to restore the real summary)`;
  const patch = await dv('PATCH', `/akoya_requests(${requestGuid})`, {
    body: { wmkf_ai_summary: newSummary },
    impersonate: JUSTIN_SYSTEMUSERID,
  });
  expect('PATCH returned 204', patch.status === 204, `got ${patch.status}`);
  if (patch.status !== 204) {
    console.error('    body:', patch.data);
    process.exit(1);
  }

  const verify = await dv('GET', `/akoya_requests(${requestGuid})?$select=_modifiedby_value,wmkf_ai_summary`);
  const modifiedBy = verify.data?._modifiedby_value;
  expect('_modifiedby_value === Justin', modifiedBy === JUSTIN_SYSTEMUSERID, `got ${modifiedBy}`);
  expect('wmkf_ai_summary updated', verify.data?.wmkf_ai_summary === newSummary);
  console.log('');

  // Step 2: impersonated POST to wmkf_ai_runs
  console.log('Step 2: Impersonated POST to wmkf_ai_runs');
  const create = await dv('POST', '/wmkf_ai_runs', {
    body: {
      'wmkf_ai_Request@odata.bind': `/akoya_requests(${requestGuid})`,
      wmkf_ai_tasktype: TASK_TYPE_PHASE_I,
      wmkf_ai_status: STATUS_COMPLETED,
      wmkf_ai_model: 'impersonation-resmoke',
      wmkf_ai_notes: `Re-smoke after Delegate-role grant on ${new Date().toISOString()}`,
    },
    impersonate: JUSTIN_SYSTEMUSERID,
    prefer: 'return=representation',
  });
  expect('POST returned 201', create.status === 201, `got ${create.status}`);
  if (create.status !== 201) {
    console.error('    body:', create.data);
    process.exit(1);
  }
  const newRunId = create.data?.wmkf_ai_runid;
  const createdBy = create.data?._createdby_value;
  expect('wmkf_ai_runid present', !!newRunId, newRunId);
  expect('_createdby_value === Justin', createdBy === JUSTIN_SYSTEMUSERID, `got ${createdBy}`);
  console.log('');

  console.log('=== Summary ===');
  if (process.exitCode === 2) {
    console.log('FAIL — see ✗ markers above.');
  } else {
    console.log('PASS — impersonation working end-to-end.');
    console.log('');
    console.log('Next:');
    console.log(`  - akoya_request 1002379 wmkf_ai_summary now holds a sentinel; run /phase-i-dynamics overwrite=true to restore.`);
    console.log(`  - Created wmkf_ai_run row: ${newRunId}`);
    console.log(`  - Tail Vercel preview logs to confirm zero "Impersonated write rejected" warnings.`);
    console.log(`  - Then flip prod env: vercel env add DYNAMICS_IMPERSONATION_ENABLED production, redeploy, smoke once.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
