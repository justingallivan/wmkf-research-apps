#!/usr/bin/env node
// Variant of probe-impersonation-resmoke.js that takes a target staff
// systemuserid (or email) as CLI arg. Used to repeat the smoke as a
// narrower-role staff user, surfacing any
// table-level 403s the rollout doc anticipated.
//
//   node scripts/probe-impersonation-as-user.js staff.user@example.org \
//     --request=<test-request-number>

const fs = require('fs');
const path = require('path');

const CLI_ARGS = process.argv.slice(2);
const TARGET_USER = CLI_ARGS.find((arg) => !arg.startsWith('--'));
const requestArg = CLI_ARGS.find((arg) => arg.startsWith('--request='));
const REQUEST_NUMBER = requestArg?.slice('--request='.length);
if (!TARGET_USER || !REQUEST_NUMBER) {
  console.error('Usage: node scripts/probe-impersonation-as-user.js <email|systemuserid> --request=<test-request-number>');
  process.exit(1);
}

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

const TASK_TYPE_PHASE_I = 682090000;
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
  return { status: res.status, ok: res.ok, data };
}

function expect(label, cond, detail = '') {
  const mark = cond ? '✓' : '✗';
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 2;
}

async function resolveUser(idOrEmail) {
  if (/^[0-9a-f-]{36}$/i.test(idOrEmail)) {
    const r = await dv('GET', `/systemusers(${idOrEmail})?$select=systemuserid,fullname,internalemailaddress,domainname`);
    if (!r.ok) throw new Error(`User lookup by id failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
  const filter = `internalemailaddress eq '${idOrEmail}' or domainname eq '${idOrEmail}'`;
  const r = await dv('GET', `/systemusers?$select=systemuserid,fullname,internalemailaddress,domainname&$filter=${encodeURIComponent(filter)}`);
  if (!r.ok || !r.data?.value?.length) throw new Error(`User lookup failed for ${idOrEmail}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.value[0];
}

async function listRoles(systemuserid) {
  const r = await dv('GET', `/systemusers(${systemuserid})/systemuserroles_association?$select=name`);
  return (r.data?.value || []).map(x => x.name).sort();
}

async function main() {
  console.log(`=== Impersonation smoke as ${TARGET_USER} ===\n`);

  console.log('Step 0a: Resolve target user');
  const user = await resolveUser(TARGET_USER);
  const targetId = user.systemuserid;
  console.log(`  ✓ ${user.fullname} <${user.internalemailaddress}> ${targetId}`);

  console.log('\nStep 0b: List roles');
  const roles = await listRoles(targetId);
  for (const r of roles) console.log(`  - ${r}`);

  console.log(`\nStep 0c: Look up akoya_request ${REQUEST_NUMBER}`);
  const lookup = await dv('GET', `/akoya_requests?$select=akoya_requestid&$filter=akoya_requestnum eq '${REQUEST_NUMBER}'`);
  if (!lookup.ok || !lookup.data?.value?.length) {
    console.error('  ✗ Lookup failed:', lookup.status, lookup.data);
    process.exit(1);
  }
  const requestGuid = lookup.data.value[0].akoya_requestid;
  console.log(`  ✓ requestid: ${requestGuid}`);

  console.log('\nStep 1: Impersonated PATCH on akoya_request (wmkf_ai_summary)');
  const newSummary = `(impersonation smoke as ${user.internalemailaddress} ${new Date().toISOString().slice(0,10)} — please run /phase-i-dynamics with overwrite=true to restore)`;
  const patch = await dv('PATCH', `/akoya_requests(${requestGuid})`, {
    body: { wmkf_ai_summary: newSummary },
    impersonate: targetId,
  });
  expect('PATCH 204', patch.status === 204, `got ${patch.status}`);
  if (patch.status !== 204) console.error('    body:', JSON.stringify(patch.data));

  if (patch.status === 204) {
    const verify = await dv('GET', `/akoya_requests(${requestGuid})?$select=_modifiedby_value`);
    expect('_modifiedby_value === target', verify.data?._modifiedby_value === targetId, `got ${verify.data?._modifiedby_value}`);
  }

  console.log('\nStep 2: Impersonated POST to wmkf_ai_runs');
  const create = await dv('POST', '/wmkf_ai_runs', {
    body: {
      'wmkf_ai_Request@odata.bind': `/akoya_requests(${requestGuid})`,
      wmkf_ai_tasktype: TASK_TYPE_PHASE_I,
      wmkf_ai_status: STATUS_COMPLETED,
      wmkf_ai_model: 'impersonation-resmoke',
      wmkf_ai_notes: `Re-smoke as ${user.internalemailaddress} on ${new Date().toISOString()}`,
    },
    impersonate: targetId,
    prefer: 'return=representation',
  });
  expect('POST 201', create.status === 201, `got ${create.status}`);
  if (create.status !== 201) {
    console.error('    body:', JSON.stringify(create.data));
  } else {
    expect('_createdby_value === target', create.data?._createdby_value === targetId, `got ${create.data?._createdby_value}`);
    console.log(`  wmkf_ai_runid: ${create.data.wmkf_ai_runid}`);
  }

  console.log('\n=== Summary ===');
  if (process.exitCode === 2) {
    console.log('FAIL — see ✗ markers above. Likely a table-level privilege gap on the target staff user.');
  } else {
    console.log(`PASS — impersonation works for ${user.internalemailaddress}.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
