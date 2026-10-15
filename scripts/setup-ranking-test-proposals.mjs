#!/usr/bin/env node
/** Twelve marked fictional requests for the dedicated ranking Preview. Read-only
 * by default. Exact IDs and receipt prevent adopting or replacing other data.
 * Uses the factory's journaled sandbox-only GoVerify restore guard at creation.
 * Does not create contacts, emails, payments, or provider jobs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { RANKING_TEST_DATAVERSE as TARGET, RANKING_TEST_REQUESTS as IDS, RANKING_TEST_RUN as RUN } from '../lib/services/proposal-ranking/test-policy.js';
import { RANKING_REHEARSAL_PROPOSALS } from '../lib/services/proposal-ranking/test-fixtures.js';
import { RESEARCH_PROGRAM_IDS } from '../shared/config/researchPrograms.js';
import { withDalContext } from '../lib/dataverse/core/context.js';
import { createRequestWithGoverifyBypass, getRequest, getPayments, getEmails, SOURCE_SELECT } from '../lib/services/test-requests/basic-clone-steps.js';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');
loadEnvLocal();
Object.assign(process.env, { DYNAMICS_URL: TARGET, DYNAMICS_SANDBOX_URL: TARGET, DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'no' });
const execute = process.argv.includes('--execute');
assert(process.argv.slice(2).every(arg => arg === '--execute'));
const RECEIPT = '/private/tmp/ranking-d97-proposal-setup.json';
const SOURCE = '46ff3ea9-8933-4f5d-91a9-3ee8ac54dad5';
const ACCOUNT = '537e3b60-c18f-ee11-8179-000d3a341e8f';
const CURRENCY = '0bc77bca-2c7b-ee11-8179-00224802aaea';
const STAFF = ['29b0de0d-4ff7-ee11-a1fd-000d3a3621c7', '1d49fd66-803e-f111-88b4-6045bd015cb0', 'f2cfa564-ac8b-f111-ab10-6045bd02ed59', 'b53a3bf8-507f-ee11-8179-000d3a341e8f'];
const client = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET), allowTestRequestMarkerWrites: true });
const source = await client.get(`/akoya_requests(${SOURCE})?$select=${SOURCE_SELECT},wmkf_istestrequest`);
assert(source.ok && source.body.wmkf_istestrequest === true && source.body.akoya_purpose == null && source.body.akoya_request == null && source.body.akoya_requesttype === 100000000, 'Blank template changed');
let receipt = fs.existsSync(RECEIPT) ? JSON.parse(fs.readFileSync(RECEIPT, 'utf8')) : null;
if (receipt) {
  assert(receipt.target === TARGET && receipt.runId === RUN);
  for (const entry of Object.values(receipt.requests)) {
    assert(!entry.postCreateStepsSkipped && !entry.goverifyBypass?.restoreManualRecheckRequired
      && (!entry.goverifyBypass || entry.goverifyBypass.restoreVerified === true),
    'A prior workflow restoration is unresolved; recover it before continuing');
  }
}
const existing = [];
for (const id of IDS) {
  const r = await client.get(`/akoya_requests(${id})?$select=akoya_requestid,wmkf_istestrequest,wmkf_testcreationrunid`);
  if (r.status !== 404) {
    assert(r.ok && receipt?.requests[id]?.createAttempted && r.body.wmkf_istestrequest === true && r.body.wmkf_testcreationrunid === RUN, 'Existing request is not owned by this receipt');
    existing.push(id);
  }
}
console.log(JSON.stringify({ target: TARGET, cycle: 'D97', requests: IDS, existing: existing.length, execute }));
if (!execute) process.exit(0);
if (!receipt) {
  receipt = { target: TARGET, runId: RUN, createdAt: new Date().toISOString(), requests: {} };
  fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
}
const save = () => fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2), { mode: 0o600 });
await withDalContext('ranking-test-proposal-setup', async () => {
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    if (!existing.includes(id)) {
      assert(!receipt.requests[id]?.createAttempted, 'Prior ambiguous create must be resolved before retry');
      receipt.requests[id] = { plannedAt: new Date().toISOString() }; save();
      const manifest = {
        target: TARGET, values: { requestId: id, runId: RUN, meetingDate: '2097-12-01' },
        source: { requestId: SOURCE, requestType: 100000000, revision: source.body['@odata.etag'] },
        createBody: { akoya_requestid: id, 'akoya_applicantid@odata.bind': `/accounts(${ACCOUNT})`,
          akoya_title: `TEST: Fictional ranking proposal ${i + 1}`, akoya_requesttype: 100000000,
          akoya_fiscalyear: 'December 2097', wmkf_meetingdate: '2097-12-01',
          wmkf_istestrequest: true, wmkf_testcreationrunid: RUN,
          wmkf_respondreminderenabled: false, wmkf_reviewduereminderenabled: false },
      };
      await createRequestWithGoverifyBypass({ client, manifest, preflightBefore: { grantOption: { value: 100000000 } }, bypassGoverify: true,
        journal: async patch => { receipt.requests[id] = { ...receipt.requests[id], ...patch }; save(); } });
    }
    const row = await getRequest(client, id);
    assert(row.wmkf_istestrequest === true && row.wmkf_testcreationrunid === RUN && row._akoya_applicantid_value === ACCOUNT, 'Request ownership changed');
    if (!receipt.requests[id].configuredAt) {
      const patch = await client.patch(`/akoya_requests(${id})`, {
        wmkf_meetingdate: '2097-12-01', akoya_requeststatus: 'Phase II Pending',
        akoya_request: (i + 1) * 100000,
        'akoya_programid@odata.bind': `/akoya_programs(${RESEARCH_PROGRAM_IDS[i % 2]})`,
        'wmkf_ProgramDirector@odata.bind': `/systemusers(${STAFF[i % STAFF.length]})`,
        'transactioncurrencyid@odata.bind': `/transactioncurrencies(${CURRENCY})`,
      }, { 'If-Match': row['@odata.etag'] });
      assert(patch.ok, `Request configuration failed (${patch.status})`);
      receipt.requests[id].configuredAt = new Date().toISOString(); save();
    }
    const scenario = RANKING_REHEARSAL_PROPOSALS[i];
    const current = await client.get(`/akoya_requests(${id})?$select=akoya_title,akoya_request,_akoya_programid_value,_wmkf_programdirector_value,wmkf_istestrequest,wmkf_testcreationrunid`);
    assert(current.ok && current.body.wmkf_istestrequest === true && current.body.wmkf_testcreationrunid === RUN);
    const title = `TEST: ${scenario.title}`;
    const program = RESEARCH_PROGRAM_IDS[scenario.programKey === 'se' ? 0 : 1];
    assert([`TEST: Fictional ranking proposal ${i + 1}`, title].includes(current.body.akoya_title)
      && [(i + 1) * 100000, scenario.amount].includes(current.body.akoya_request), 'Fixture content was edited; inspect before upgrading');
    if (current.body.akoya_title !== title || current.body.akoya_request !== scenario.amount || current.body._akoya_programid_value !== program) {
      receipt.requests[id].enrichmentAttempted = true; save();
      const enriched = await client.patch(`/akoya_requests(${id})`, { akoya_title: title, akoya_request: scenario.amount,
        'akoya_programid@odata.bind': `/akoya_programs(${program})` }, { 'If-Match': current.body['@odata.etag'] });
      assert(enriched.ok, `Scenario update failed (${enriched.status})`);
    }
    const after = await getRequest(client, id);
    assert(after.akoya_requeststatus === 'Phase II Pending' && after.wmkf_meetingdate.slice(0, 10) === '2097-12-01' && after._wmkf_programdirector_value === STAFF[i % STAFF.length]);
    const inputs = await client.get(`/akoya_requests(${id})?$select=akoya_request,_akoya_programid_value,_transactioncurrencyid_value`);
    assert(inputs.ok && inputs.body.akoya_request === scenario.amount
      && inputs.body._akoya_programid_value === program
      && inputs.body._transactioncurrencyid_value === CURRENCY, 'Ranking inputs differ');
    assert.equal((await getPayments(client, id)).length, 0, 'Unexpected payment');
    assert.equal((await getEmails(client, id)).length, 0, 'Unexpected email');
    receipt.requests[id].scenarioVersion = 2;
    receipt.requests[id].verifiedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ requestId: id, verified: true }));
  }
});
