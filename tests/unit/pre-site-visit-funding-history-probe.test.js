/** Exercise the real read-only CLI with all HTTP requests intercepted locally. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../..');
let tempDir;
let preload;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'funding-history-probe-'));
  preload = path.join(tempDir, 'mock-http.cjs');
  fs.writeFileSync(preload, `
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const label = '@OData.Community.Display.V1.FormattedValue';
global.fetch = async function(input) {
  const url = new URL(input);
  let body;
  if (url.hostname === 'login.microsoftonline.com') {
    body = { access_token: 'test-token' };
  } else if (url.hostname !== 'funding-history-probe.invalid') {
    throw new Error('Unmocked host');
  } else if (url.pathname.endsWith('/akoya_requests') && url.searchParams.get('$filter').includes('akoya_requestnum')) {
    const id = url.searchParams.get('$filter').includes('1000001') ? first : second;
    body = { value: url.searchParams.get('$filter').includes('9999999') ? [] : [{ _akoya_applicantid_value: id, ['_akoya_applicantid_value' + label]: 'Fallback U' }] };
  } else if (url.pathname.endsWith('/accounts')) {
    body = { value: [] };
  } else if (url.pathname.includes('/accounts(')) {
    body = { akoya_aka: 'N/A', name: 'unknown', wmkf_countofprogramgrants: 1,
      wmkf_sumofprogramgrants: process.env.PROBE_TEST_MISMATCH === 'on' && url.pathname.includes(first) ? 999 : 100 };
  } else if (url.pathname.endsWith('/akoya_requests')) {
    body = { value: [{ akoya_requestnum: '900001', akoya_requestid: first, akoya_grant: 100,
      wmkf_request_type: 100000001, ['_wmkf_type_value' + label]: 'Program',
      ['_wmkf_grantprogram_value' + label]: 'Research', akoya_decisiondate: '2020-06-15' }] };
  } else {
    throw new Error('Unmocked request');
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
};
`);
});

afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

function runProbe(mismatch, targets = ['1000001', '1000002']) {
  return spawnSync(process.execPath, [
    '--require', preload, '--import', path.join(root, 'scripts/lib/use-extensionless.mjs'),
    path.join(root, 'scripts/probe-funding-history-rollups.js'), ...targets,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DYNAMICS_URL: 'https://funding-history-probe.invalid',
      DYNAMICS_TENANT_ID: 'test', DYNAMICS_CLIENT_ID: 'test', DYNAMICS_CLIENT_SECRET: 'test',
      PROBE_TEST_MISMATCH: mismatch ? 'on' : 'off' },
  });
}

test('continues after a rollup mismatch and exits unsuccessfully with a complete summary', () => {
  const result = runProbe(true);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Rollup mismatch');
  expect(result.stdout).toContain('"institution": "Fallback U"');
  expect(result.stdout).toContain('The most recent of these grants was awarded in June 2020.');
  expect(result.stdout).toContain('Summary: {"passed":1,"failed":1}');
});

test('successful multi-institution probe reports every institution and uses the scoped wording', () => {
  const result = runProbe(false);
  expect(result.status).toBe(0);
  expect(result.stdout.match(/"institution": "Fallback U"/g)).toHaveLength(2);
  expect(result.stdout).toContain('1 Research or Undergraduate Education - Science & Engineering award totaling $100');
  expect(result.stdout).toContain('Summary: {"passed":2,"failed":0}');
});


test('missing requested targets count as failures while a valid target is still checked', () => {
  const result = runProbe(false, ['9999999', 'Missing Institution', '1000001']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('request 9999999: not found');
  expect(result.stderr).toContain('account "Missing Institution": not found');
  expect(result.stdout).toContain('"institution": "Fallback U"');
  expect(result.stdout).toContain('Summary: {"passed":1,"failed":2}');
});

test('all requested targets missing cannot produce a successful empty probe', () => {
  const result = runProbe(false, ['9999999']);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Summary: {"passed":0,"failed":1}');
});
