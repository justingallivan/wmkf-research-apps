#!/usr/bin/env node
/**
 * Owner-run, read-only: print the actual Invite/Decline Notes for the 13
 * workbook requests whose notes were nonempty in the triage-reason probe.
 * Output contains staff notes: keep it private, not in tracked evidence files.
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-request-decline-notes.cjs --target=prod
 * Offline validation: node scripts/probe-request-decline-notes.cjs --self-test
 * Uses only Dataverse GETs; never changes records or schema.
 */
const REQUESTS = Object.freeze([
  '1002884', '1002891', '1002923', '1002817', '1002819', '1002827',
  '1002840', '1002848', '1002876', '1002883', '1002885', '1002918', '1002932',
]);
const SELECT = 'akoya_requestnum,wmkf_declinereason,wmkf_denialnotes';
async function probe(get, emit = console.log) {
  const { eq } = require('../lib/dataverse/core/odata.js');
  for (const number of REQUESTS) {
    const path = `/akoya_requests?$select=${SELECT}&$filter=${encodeURIComponent(eq('akoya_requestnum', number))}&$top=2`;
    const body = await get(path);
    if (!Array.isArray(body.value)) throw new Error('Invalid response; probe incomplete');
    if (body.value.length !== 1 || body['@odata.nextLink']) {
      emit(JSON.stringify({ request: number, error: 'Expected exactly one request', rows: body.value.length }));
      continue;
    }
    const row = body.value[0];
    if (String(row.akoya_requestnum) !== number) throw new Error('Unexpected request returned; probe incomplete');
    emit(JSON.stringify({
      request: number,
      declineReasonValue: row.wmkf_declinereason ?? null,
      declineReason: row['wmkf_declinereason@OData.Community.Display.V1.FormattedValue'] ?? null,
      inviteDeclineNotes: row.wmkf_denialnotes ?? null,
    }, null, 2));
  }
}
async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--self-test') {
    const assert = require('node:assert/strict');
    const output = [];
    const calls = [];
    await probe(async path => {
      calls.push(path);
      const number = REQUESTS[calls.length - 1];
      return { value: [{ akoya_requestnum: number, wmkf_declinereason: 682090000,
        'wmkf_declinereason@OData.Community.Display.V1.FormattedValue': 'Limited impact',
        wmkf_denialnotes: 'First line.\nSecond line with "quotes".' }] };
    }, text => output.push(JSON.parse(text)));
    assert.equal(new Set(REQUESTS).size, 13);
    assert.equal(calls.length, 13);
    assert.deepEqual(output.map(row => row.request), REQUESTS);
    assert(output.every(row => row.inviteDeclineNotes === 'First line.\nSecond line with "quotes".'));
    assert(calls.every(path => path.startsWith(`/akoya_requests?$select=${SELECT}&`) && path.endsWith('&$top=2')));
    const missing = [];
    await probe(async () => ({ value: [] }), text => missing.push(JSON.parse(text)));
    assert(missing.every(row => row.error && row.rows === 0));
    await assert.rejects(() => probe(async () => ({ value: [{ akoya_requestnum: '9999999' }] })), /Unexpected request/);
    console.log('PASS: exactly 13 scoped reads, full notes preserved, missing and unexpected requests handled.');
    return;
  }
  if (process.argv.length !== 3 || process.argv[2] !== '--target=prod') throw new Error('Specify --target=prod or --self-test');
  if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Owner must set DATAVERSE_ALLOW_PROD_READS=yes');
  const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
  const { classifyTarget } = require('../lib/dataverse/core/interlock.js');
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL;
  if (classifyTarget(resourceUrl) !== 'production') throw new Error('Target must be the registered Production host');
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl), dryRun: true });
  await probe(async path => {
    const result = await client.get(path, { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' });
    if (!result.ok) throw new Error(`HTTP ${result.status}; probe incomplete`);
    return result.body;
  });
}
if (require.main === module) main().catch(error => {
  console.error(`Probe failed: ${/^(Specify|Owner must|Target must|HTTP |Unexpected|Invalid)/.test(error.message) ? error.message : 'authentication or transport failure (details withheld)'}`);
  process.exitCode = 1;
});
module.exports = { probe, REQUESTS };
