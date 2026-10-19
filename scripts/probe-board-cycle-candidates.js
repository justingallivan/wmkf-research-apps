#!/usr/bin/env node
/** Read-only D26 Board candidate census; --mark-tests corrects only owner-approved 1003223/1003224. */
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');
async function main() {
  const apply = process.argv[3] === '--mark-tests';
  assert(process.argv.length === (apply ? 4 : 3), 'Usage: node scripts/probe-board-cycle-candidates.js <credential-env-file> [--mark-tests]');
  const env = parseEnv(fs.readFileSync(process.argv[2], 'utf8'));
  for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET']) {
    assert(env[key], 'Application credential missing'); process.env[key] = env[key];
  }
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'yes' });
  if (apply) process.env.DATAVERSE_PROD_WRITE_ACK = `Owner-approved Board test marker correction ${new Date().toISOString().slice(0, 10)}`;
  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  const target = 'https://wmkf.crm.dynamics.com';
  const client = createClient({ resourceUrl: target, token: await getAccessToken(target) });
  if (apply) {
    for (const number of ['1003223', '1003224']) console.log(JSON.stringify(await client.maintainD26TrialTestMarker(number, { apply: true })));
  }
  let path = "/akoya_requests?$select=akoya_requestid,akoya_requestnum,akoya_requeststatus,_wmkf_grantprogram_value,wmkf_meetingdate,wmkf_istestrequest,wmkf_testcreationrunid&$filter=_wmkf_grantprogram_value eq c247b11a-a7cb-ee11-9078-000d3a341e8f and wmkf_meetingdate ge 2026-12-01T00:00:00Z and wmkf_meetingdate lt 2027-01-01T00:00:00Z";
  const rows = [];
  for (let page = 0; path && page < 30; page++) {
    const r = await client.get(path);
    assert(r.ok && Array.isArray(r.body?.value), `Read failed: ${r.status}`);
    rows.push(...r.body.value); path = r.body['@odata.nextLink'];
  }
  assert(!path, 'Incomplete pagination');
  const ordinary = rows.filter(r => (r.wmkf_istestrequest === false || r.wmkf_istestrequest === null) && r.wmkf_testcreationrunid === null);
  const candidates = ordinary.filter(r => r.akoya_requeststatus === 'Phase II Pending');
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), target, total: rows.length, ordinary: ordinary.length, candidateCount: candidates.length,
    candidateNumbers: candidates.map(r => r.akoya_requestnum).sort(),
    correctedTests: rows.filter(r => ['1003223', '1003224'].includes(r.akoya_requestnum)).map(r => ({ number: r.akoya_requestnum, test: r.wmkf_istestrequest, runIdPresent: Boolean(r.wmkf_testcreationrunid) })) }, null, 2));
}
main().catch(error => { console.error(`Board census failed: ${error.message}`); process.exitCode = 1; });
