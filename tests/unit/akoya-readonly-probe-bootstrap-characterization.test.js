/** @jest-environment node */

/**
 * Characterizes the three legacy Akoya probes in a synthetic checkout. Every
 * child gets dummy credentials and a deny-by-default fetch replacement before
 * the script loads; no project env file or network is reachable.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPTS = [
  'probe-akoya-wmkf-type-misc.js',
  'probe-akoya-wmkf-type-taxonomy.js',
  'probe-akoya-active-nodate.js',
];
const DYNAMICS_URL = 'https://fixture.example.test';
const TOKEN_URL = 'https://login.microsoftonline.com/tenant-fixture/oauth2/v2.0/token';
const FIXED_ISO = '2026-10-01T12:34:56.000Z';

function ok(body, status = 200) {
  return { status, body };
}

function baselineResponses(script) {
  if (script === SCRIPTS[0]) {
    const firstRows = [{ akoya_requestnum: 'M-1', akoya_grant: 10, akoya_paid: 0, createdon: '2025-01-01' }];
    const secondRows = [{ akoya_requestnum: 'M-2', akoya_grant: 20, akoya_paid: 0, createdon: '2024-01-01' }];
    return [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'wmkf_typeid', PrimaryNameAttribute: 'wmkf_name' }),
      ok({ value: [{ wmkf_typeid: 'type-1', wmkf_name: 'Miscellaneous' }] }),
      ok({ value: firstRows, '@odata.nextLink': `${DYNAMICS_URL}/api/data/v9.2/akoya_requests?$skiptoken=2` }),
      ok({ value: secondRows }),
    ];
  }
  if (script === SCRIPTS[1]) {
    return [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryNameAttribute: 'wmkf_name', PrimaryIdAttribute: 'wmkf_typeid' }),
      ok({ value: [{ wmkf_typeid: 'type-1', wmkf_name: 'One', createdon: '2024-01-01', statecode: 0 }],
        '@odata.nextLink': `${DYNAMICS_URL}/api/data/v9.2/wmkf_types?$skiptoken=2` }),
      ok({ value: [{ wmkf_typeid: 'type-2', wmkf_name: 'Two', createdon: '2025-01-01', statecode: 0 }] }),
      ok({ value: [{ g: 'type-1', c: '2' }, { g: 'type-2', c: '1' }] }),
      ok({ value: [{ g: 'type-1', c: '1' }] }),
      ok({ value: [{ g: 'type-2', c: '1' }] }),
      ok({ value: [{ t: 'One', p: 'One', c: '1' }, { t: 'Two', p: 'Other', c: '1' }] }),
    ];
  }
  return [
    ok({ access_token: 'token-fixture' }),
    ok({ value: [
      { akoya_requestnum: 'A-1', akoya_decisiondate: '2025-01-01' },
      { akoya_requestnum: 'A-2', akoya_decisiondate: null },
    ] }),
    ok({ value: [{ akoya_requestnum: 'A-2', akoya_grant: 12, createdon: '2025-01-01', akoya_title: 'No-date fixture' }],
      '@odata.nextLink': `${DYNAMICS_URL}/api/data/v9.2/akoya_requests?$skiptoken=ignored` }),
  ];
}

function makeFixture(root, { responses = [], envText, envPresent = true } = {}) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'elsewhere'), { recursive: true });
  for (const script of SCRIPTS) {
    fs.copyFileSync(path.join(REPO_ROOT, 'scripts', script), path.join(root, 'scripts', script));
  }
  const bootstrapPath = path.join(REPO_ROOT, 'scripts', 'lib', 'akoya-readonly-probe-bootstrap.js');
  if (fs.existsSync(bootstrapPath)) fs.copyFileSync(bootstrapPath, path.join(root, 'scripts', 'lib', 'akoya-readonly-probe-bootstrap.js'));
  if (envPresent) fs.writeFileSync(path.join(root, '.env.local'), envText ?? [
    'DYNAMICS_TENANT_ID=tenant-fixture',
    'DYNAMICS_CLIENT_ID=client-fixture',
    'DYNAMICS_CLIENT_SECRET=secret-fixture',
    `DYNAMICS_URL=${DYNAMICS_URL}`,
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'elsewhere', '.env.local'), [
    'DYNAMICS_TENANT_ID=decoy-tenant', 'DYNAMICS_CLIENT_ID=decoy-client',
    'DYNAMICS_CLIENT_SECRET=decoy-secret', 'DYNAMICS_URL=https://decoy.example.test',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'responses.json'), JSON.stringify(responses));
  fs.writeFileSync(path.join(root, 'fetch-preload.cjs'), `
const fs = require('fs');
const path = require('path');
const root = process.env.FIXTURE_ROOT;
const requestsPath = path.join(root, 'requests.json');
const responses = JSON.parse(fs.readFileSync(path.join(root, 'responses.json'), 'utf8'));
const originalDate = Date;
const fixed = new originalDate(process.env.FIXED_ISO);
global.Date = class FixedDate extends originalDate {
  constructor(...args) { super(...(args.length ? args : [fixed])); }
  static now() { return fixed.getTime(); }
};
global.fetch = async (input, init = {}) => {
  const url = String(input);
  const request = { url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? String(init.body) : null };
  const prior = fs.existsSync(requestsPath) ? JSON.parse(fs.readFileSync(requestsPath, 'utf8')) : [];
  prior.push(request);
  fs.writeFileSync(requestsPath, JSON.stringify(prior));
  const response = responses[prior.length - 1];
  if (!response) throw new Error('Denied unplanned fetch: ' + url);
  if (response.reject) throw new Error(response.reject);
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: async () => { if (response.textFailure) throw new Error('fixture text failed'); return response.rawText ?? JSON.stringify(response.body); },
    json: async () => { if (response.jsonFailure) throw new SyntaxError('fixture JSON failed'); return response.body; },
  };
};
`);
}

function runProbe({ script, responses = baselineResponses(script), envText, envPresent = true, env = {}, setup }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akoya-probe-characterization-'));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    makeFixture(root, { responses, envText, envPresent });
    setup?.(root);
    const stdoutPath = path.join(root, 'stdout.txt');
    const stderrPath = path.join(root, 'stderr.txt');
    const stdoutFd = fs.openSync(stdoutPath, 'w');
    const stderrFd = fs.openSync(stderrPath, 'w');
    const childEnv = {
      PATH: process.env.PATH || '',
      FIXTURE_ROOT: root,
      FIXED_ISO,
      ...env,
    };
    const child = spawnSync(process.execPath, ['--require', path.join(root, 'fetch-preload.cjs'), path.join(root, 'scripts', script)], {
      cwd: path.join(root, 'elsewhere'),
      env: childEnv,
      stdio: ['ignore', stdoutFd, stderrFd],
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    if (fs.statSync(stdoutPath).size > 2 * 1024 * 1024 || fs.statSync(stderrPath).size > 2 * 1024 * 1024) {
      throw new Error('Synthetic probe exceeded the 2 MiB output cap');
    }
    const stdout = fs.readFileSync(stdoutPath, 'utf8');
    const stderr = fs.readFileSync(stderrPath, 'utf8');
    const requests = fs.existsSync(path.join(root, 'requests.json'))
      ? JSON.parse(fs.readFileSync(path.join(root, 'requests.json'), 'utf8')) : [];
    return { status: child.status, error: child.error, stdout, stderr, requests, root, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function tokenRequest(result, tenant = 'tenant-fixture') {
  expect(result.requests[0].url).toBe(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`);
  expect(result.requests[0].method).toBe('POST');
  expect(result.requests[0].headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
  return new URLSearchParams(result.requests[0].body);
}

describe('legacy read-only Akoya probe bootstrap characterization', () => {
  test.each(SCRIPTS)('%s preserves its successful report and token wire request', (script) => {
    const result = runProbe({ script });
    try {
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      if (script !== SCRIPTS[1]) expect(result.stdout).toContain(FIXED_ISO);
      const form = tokenRequest(result);
      expect([...form.entries()]).toEqual([
        ['grant_type', 'client_credentials'], ['client_id', 'client-fixture'],
        ['client_secret', 'secret-fixture'], ['scope', `${DYNAMICS_URL}/.default`],
      ]);
      expect(result.requests.slice(1).every((request) => request.method === 'GET')).toBe(true);
      expect(result.requests.slice(1).every((request) => request.headers.Authorization === 'Bearer token-fixture')).toBe(true);
      expect(result.requests.slice(1).every((request) => request.headers.Accept === 'application/json'
        && request.headers['OData-Version'] === '4.0'
        && request.headers.Prefer === 'odata.include-annotations="*"')).toBe(true);
      if (script === SCRIPTS[0]) {
        expect(result.stdout).toContain('TOTAL wmkf_type="Miscellaneous": 2 rows');
        expect(result.stdout).toContain('#M-2');
        expect(result.requests).toHaveLength(5);
        expect(result.requests[1].url).toBe(`${DYNAMICS_URL}/api/data/v9.2/EntityDefinitions(LogicalName='wmkf_type')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`);
        expect(result.requests[2].url).toContain('/wmkf_types?$select=wmkf_typeid,wmkf_name&$filter=');
        expect(result.requests[3].url).toContain('/akoya_requests?$filter=');
        expect(result.requests[4].url).toBe(`${DYNAMICS_URL}/api/data/v9.2/akoya_requests?$skiptoken=2`);
        const typesQuery = new URL(result.requests[2].url);
        const requestsQuery = new URL(result.requests[3].url);
        expect(typesQuery.searchParams.get('$filter')).toBe("wmkf_name eq 'Miscellaneous'");
        expect(requestsQuery.searchParams.get('$filter')).toBe('(_wmkf_type_value eq type-1)');
        expect(requestsQuery.searchParams.get('$select')).toBe('akoya_requestnum,akoya_requeststatus,akoya_grant,akoya_paid,akoya_request,_akoya_applicantid_value,akoya_title,wmkf_request_type,createdon');
        expect(requestsQuery.searchParams.get('$orderby')).toBe('createdon desc');
      } else if (script === SCRIPTS[1]) {
        expect(result.stdout).toContain('wmkf_type taxonomy (2)');
        expect(result.stdout).toContain('Two');
        expect(result.requests).toHaveLength(8);
        expect(result.requests[1].url).toContain("/EntityDefinitions(LogicalName='wmkf_type')?");
        expect(result.requests[2].url).toContain('/wmkf_types?$select=wmkf_typeid,wmkf_name,createdon,statecode&$orderby=createdon asc&$top=200');
        expect(result.requests[3].url).toBe(`${DYNAMICS_URL}/api/data/v9.2/wmkf_types?$skiptoken=2`);
        expect(result.requests[4].url).toContain('/akoya_requests?fetchXml=');
        expect(result.requests[7].url).toContain('/akoya_requests?fetchXml=');
      } else {
        expect(result.stdout).toContain('native Active total=2');
        expect(result.stdout).toContain('No-date fixture');
        expect(result.requests).toHaveLength(3);
        const firstQuery = new URL(result.requests[1].url);
        const secondQuery = new URL(result.requests[2].url);
        expect(firstQuery.searchParams.get('$filter')).toBe("akoya_requeststatus eq 'Active' and createdon ge 2024-01-01T00:00:00Z");
        expect(firstQuery.searchParams.get('$select')).toBe('akoya_requestnum,akoya_decisiondate');
        expect(firstQuery.searchParams.get('$top')).toBe('500');
        expect(secondQuery.searchParams.get('$filter')).toBe("akoya_requeststatus eq 'Active' and akoya_decisiondate eq null and createdon ge 2024-01-01T00:00:00Z");
        expect(secondQuery.searchParams.get('$orderby')).toBe('createdon desc');
        expect(secondQuery.searchParams.get('$select')).toContain('_wmkf_type_value');
        expect(secondQuery.searchParams.get('$top')).toBe('100');
        expect(result.requests.some((request) => request.url.includes('$skiptoken=ignored'))).toBe(false);
      }
    } finally { result.cleanup(); }
  });

  test.each(SCRIPTS)('%s stops before data reads when token fetch rejects', (script) => {
    const responses = [{ reject: 'synthetic token transport failure' }];
    const result = runProbe({ script, responses });
    try {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('PROBE ERROR: synthetic token transport failure');
      expect(result.requests).toHaveLength(1);
    } finally { result.cleanup(); }
  });

  test('miscellaneous probe exits 0 when its type lookup is empty', () => {
    const result = runProbe({ script: SCRIPTS[0], responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
      ok({ value: [] }),
    ] });
    try {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('No wmkf_type record named "Miscellaneous" — STOP.');
      expect(result.requests).toHaveLength(3);
    } finally { result.cleanup(); }
  });

  test('taxonomy preserves its logged failed aggregate and metadata exit behavior', () => {
    const aggregateFailure = runProbe({ script: SCRIPTS[1], responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryNameAttribute: 'name', PrimaryIdAttribute: 'id' }),
      ok({ value: [] }),
      ok({ value: [] }),
      ok({ value: [] }),
      { status: 503, body: { error: 'aggregate unavailable' } },
      ok({ value: [] }),
      ok({ value: [] }),
    ] });
    try {
      expect(aggregateFailure.status).toBe(0);
      expect(aggregateFailure.stdout).toContain('[agg wmkf_type 503]');
    } finally { aggregateFailure.cleanup(); }

    const metadataFailure = runProbe({ script: SCRIPTS[1], responses: [
      ok({ access_token: 'token-fixture' }), { status: 502, body: { error: 'metadata unavailable' } },
    ] });
    try {
      expect(metadataFailure.status).toBe(1);
      expect(metadataFailure.stderr).toContain('wmkf_type metadata 502');
    } finally { metadataFailure.cleanup(); }
  });

  test('taxonomy logs a failed type-list request and continues its aggregate reads', () => {
    const result = runProbe({ script: SCRIPTS[1], responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryNameAttribute: 'name', PrimaryIdAttribute: 'id' }),
      { status: 503, body: { error: 'type list unavailable' } },
      ok({ value: [] }), ok({ value: [] }), ok({ value: [] }), ok({ value: [] }),
    ] });
    try {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('[list 503]');
      expect(result.requests).toHaveLength(7);
      expect(result.requests[3].url).toContain('/akoya_requests?fetchXml=');
    } finally { result.cleanup(); }
  });

  test.each([SCRIPTS[0], SCRIPTS[2]])('%s throws on a failed GET', (script) => {
    const result = runProbe({ script, responses: [
      ok({ access_token: 'token-fixture' }), { status: 502, body: { error: 'GET unavailable' } },
    ] });
    try {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('PROBE ERROR: GET ');
      expect(result.stderr).toContain('502');
      expect(result.requests).toHaveLength(2);
    } finally { result.cleanup(); }
  });

  test('loader resolves only the synthetic checkout root and ignores a cwd decoy', () => {
    const result = runProbe({ script: SCRIPTS[0] });
    try {
      const form = tokenRequest(result);
      expect(form.get('client_id')).toBe('client-fixture');
      expect(result.requests[0].url).toBe(TOKEN_URL);
      expect(result.requests.some((request) => request.url.includes('decoy.example'))).toBe(false);
    } finally { result.cleanup(); }
  });

  test('parser keeps its legacy grammar, line order, quoting, and truthy precedence', () => {
    const envText = [
      'DYNAMICS_TENANT_ID=first',
      'DYNAMICS_TENANT_ID=second',
      ' DYNAMICS_CLIENT_ID=leading-space-ignored',
      'dynamics_client_id=lowercase-ignored',
      'export DYNAMICS_CLIENT_ID=export-ignored',
      "DYNAMICS_CLIENT_ID='single-quoted'",
      'DYNAMICS_CLIENT_SECRET="  secret with spaces  "',
      'DYNAMICS_URL=https://fixture.example.test/path?x=a=b#frag  ',
      'DYNAMICS_URL=https://later-duplicate.example.test',
      'DYNAMICS_TENANT_ID=crlf-ignored\r',
      '# comment',
    ].join('\n');
    const result = runProbe({ script: SCRIPTS[0], envText, responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
      ok({ value: [] }),
    ] });
    try {
      const form = tokenRequest(result, 'first');
      expect(form.get('client_id')).toBe("'single-quoted'");
      expect(form.get('client_secret')).toBe('  secret with spaces  ');
      expect(form.get('scope')).toBe('https://fixture.example.test/path?x=a=b#frag/.default');
      expect(result.requests[0].url).toBe('https://login.microsoftonline.com/first/oauth2/v2.0/token');
    } finally { result.cleanup(); }
  });

  test('missing file, empty file, absent credentials, and empty quoted values stay literal', () => {
    for (const envPresent of [false, true]) {
      const result = runProbe({ script: SCRIPTS[0], envPresent, envText: '', env: {}, responses: [
        ok({ access_token: 'token-fixture' }),
        ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
        ok({ value: [] }),
      ] });
      try {
        expect(result.requests[0].url).toContain('/undefined/');
        const form = new URLSearchParams(result.requests[0].body);
        expect(form.get('client_id')).toBe('undefined');
        expect(form.get('client_secret')).toBe('undefined');
        expect(form.get('scope')).toBe('undefined/.default');
      } finally { result.cleanup(); }
    }

    const emptyQuoted = runProbe({ script: SCRIPTS[0], envText: [
      'DYNAMICS_TENANT_ID=tenant-fixture', 'DYNAMICS_CLIENT_ID=client-fixture',
      'DYNAMICS_CLIENT_SECRET=""', `DYNAMICS_URL=${DYNAMICS_URL}`,
    ].join('\n'), responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
      ok({ value: [] }),
    ] });
    try {
      expect(new URLSearchParams(emptyQuoted.requests[0].body).get('client_secret')).toBe('');
    } finally { emptyQuoted.cleanup(); }
  });

  test('an empty duplicate value permits the next assignment to populate it', () => {
    const result = runProbe({ script: SCRIPTS[0], envText: [
      'DYNAMICS_TENANT_ID=tenant-fixture', 'DYNAMICS_CLIENT_ID=',
      'DYNAMICS_CLIENT_ID=late-client', 'DYNAMICS_CLIENT_SECRET=secret-fixture',
      `DYNAMICS_URL=${DYNAMICS_URL}`,
    ].join('\n'), responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
      ok({ value: [] }),
    ] });
    try {
      expect(new URLSearchParams(result.requests[0].body).get('client_id')).toBe('late-client');
    } finally { result.cleanup(); }
  });

  test('token URL encoding preserves special characters and trailing slash in scope', () => {
    const secret = 'secret +&=%/ value';
    const url = 'https://fixture.example.test/';
    const result = runProbe({ script: SCRIPTS[0], envText: [
      'DYNAMICS_TENANT_ID=tenant +&', 'DYNAMICS_CLIENT_ID=client +&=',
      `DYNAMICS_CLIENT_SECRET=${secret}`, `DYNAMICS_URL=${url}`,
    ].join('\n'), responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
      ok({ value: [] }),
    ] });
    try {
      expect(result.requests[0].url).toBe('https://login.microsoftonline.com/tenant +&/oauth2/v2.0/token');
      const form = new URLSearchParams(result.requests[0].body);
      expect(form.get('client_id')).toBe('client +&=');
      expect(form.get('client_secret')).toBe(secret);
      expect(form.get('scope')).toBe(`${url}/.default`);
    } finally { result.cleanup(); }
  });

  test.each([
    ['non-2xx full token body', { status: 401, rawText: `x${'y'.repeat(600)}`, body: null }, /Token: 401 x/],
    ['token body read rejection', { status: 401, textFailure: true, body: null }, /PROBE ERROR: fixture text failed/],
    ['invalid token JSON', { status: 200, jsonFailure: true, body: null }, /PROBE ERROR: fixture JSON failed/],
    ['missing access_token', ok({}), null],
  ])('token response behavior: %s', (_label, tokenResponse, expectedError) => {
    const result = runProbe({ script: SCRIPTS[0], responses: [tokenResponse, ...[
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
      ok({ value: [] }),
    ]] });
    try {
      if (expectedError) {
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(expectedError);
        if (_label === 'non-2xx full token body') expect(result.stderr).toContain('y'.repeat(600));
        expect(result.requests).toHaveLength(1);
      } else {
        expect(result.status).toBe(0);
        expect(result.requests).toHaveLength(3);
        expect(result.requests[1].headers.Authorization).toBe('Bearer undefined');
      }
    } finally { result.cleanup(); }
  });


  test.each([
    ['missing', undefined, false, 'undefined', 'child-tenant'],
    ['empty', '', true, 'file-client', 'child-tenant'],
    ['nonempty', 'preexisting-client', true, 'preexisting-client', 'child-tenant'],
  ])('loader precedence for %s environment values', (_label, clientEnv, envPresent, expectedClient, expectedTenant) => {
    const envText = 'DYNAMICS_TENANT_ID=tenant-from-file\nDYNAMICS_CLIENT_ID=file-client\nDYNAMICS_CLIENT_SECRET=file-secret\nDYNAMICS_URL=https://fixture.example.test';
    const env = { DYNAMICS_TENANT_ID: 'child-tenant', DYNAMICS_CLIENT_SECRET: 'child-secret', DYNAMICS_URL: DYNAMICS_URL };
    if (clientEnv !== undefined) env.DYNAMICS_CLIENT_ID = clientEnv;
    const result = runProbe({ script: SCRIPTS[0], envText, envPresent, env, responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
      ok({ value: [] }),
    ] });
    try {
      const form = tokenRequest(result, expectedTenant);
      expect(form.get('client_id')).toBe(expectedClient);
      expect(result.requests[0].url).toContain(expectedTenant);
    } finally { result.cleanup(); }
  });

  test('CRLF assignments are skipped and loader read failures stay outside PROBE ERROR catch', () => {
    const crlf = runProbe({ script: SCRIPTS[0], envText: 'DYNAMICS_TENANT_ID=ignored\r\nDYNAMICS_CLIENT_ID=ignored\r\nDYNAMICS_CLIENT_SECRET=ignored\r\nDYNAMICS_URL=https://ignored.example.test\r\n', responses: [
      ok({ access_token: 'token-fixture' }),
      ok({ EntitySetName: 'wmkf_types', PrimaryIdAttribute: 'id', PrimaryNameAttribute: 'name' }),
      ok({ value: [] }),
    ] });
    try {
      expect(crlf.requests[0].url).toContain('undefined');
      expect(new URLSearchParams(crlf.requests[0].body).get('client_id')).toBe('undefined');
      expect(new URLSearchParams(crlf.requests[0].body).get('scope')).toBe('undefined/.default');
    } finally { crlf.cleanup(); }

    const readFailure = runProbe({ script: SCRIPTS[0], setup: (root) => {
      fs.rmSync(path.join(root, '.env.local'));
      fs.mkdirSync(path.join(root, '.env.local'));
    } });
    try {
      expect(readFailure.status).not.toBe(0);
      expect(readFailure.stderr).not.toContain('PROBE ERROR:');
      expect(readFailure.requests).toHaveLength(0);
    } finally { readFailure.cleanup(); }
  });

  test('copied helper import is inert; explicit calls load env and fetch uncached tokens', () => {
    const importOnly = runProbe({ script: 'helper-import-only.cjs', responses: [], setup: (root) => {
      fs.writeFileSync(path.join(root, 'scripts', 'helper-import-only.cjs'), `
const fs = require('fs');
let envFileCalls = 0;
const existsSync = fs.existsSync;
const readFileSync = fs.readFileSync;
fs.existsSync = function(filePath, ...args) { if (String(filePath).endsWith('.env.local')) envFileCalls++; return existsSync.call(fs, filePath, ...args); };
fs.readFileSync = function(filePath, ...args) { if (String(filePath).endsWith('.env.local')) envFileCalls++; return readFileSync.call(fs, filePath, ...args); };
const before = process.env.DYNAMICS_CLIENT_ID;
require('./lib/akoya-readonly-probe-bootstrap');
console.log(JSON.stringify({ before: before ?? null, after: process.env.DYNAMICS_CLIENT_ID ?? null, envFileCalls }));
`);
    } });
    try {
      expect(importOnly.status).toBe(0);
      expect(importOnly.stdout.trim()).toBe('{"before":null,"after":null,"envFileCalls":0}');
      expect(importOnly.requests).toHaveLength(0);
    } finally { importOnly.cleanup(); }

    const explicitCalls = runProbe({ script: 'helper-token-calls.cjs', responses: [
      ok({ access_token: 'one' }), ok({ access_token: 'two' }),
    ], setup: (root) => {
      fs.appendFileSync(path.join(root, '.env.local'), '\nPROBE_2_KEY=fixture-value');
      fs.writeFileSync(path.join(root, 'scripts', 'helper-token-calls.cjs'), `
const fs = require('fs');
let envFileCalls = 0;
const existsSync = fs.existsSync;
const readFileSync = fs.readFileSync;
fs.existsSync = function(filePath, ...args) { if (String(filePath).endsWith('.env.local')) envFileCalls++; return existsSync.call(fs, filePath, ...args); };
fs.readFileSync = function(filePath, ...args) { if (String(filePath).endsWith('.env.local')) envFileCalls++; return readFileSync.call(fs, filePath, ...args); };
const { loadProbeEnvLocal, getToken } = require('./lib/akoya-readonly-probe-bootstrap');
const imported = process.env.DYNAMICS_CLIENT_ID ?? null;
loadProbeEnvLocal();
(async () => {
  const first = await getToken();
  process.env.DYNAMICS_CLIENT_ID = 'updated-client';
  const second = await getToken();
  console.log(JSON.stringify({ imported, loaded: process.env.DYNAMICS_CLIENT_ID, arbitrary: process.env.PROBE_2_KEY, first, second, envFileCalls }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
`);
    } });
    try {
      expect(explicitCalls.status).toBe(0);
      expect(explicitCalls.stdout.trim()).toBe('{"imported":null,"loaded":"updated-client","arbitrary":"fixture-value","first":"one","second":"two","envFileCalls":2}');
      expect(explicitCalls.requests).toHaveLength(2);
      expect(new URLSearchParams(explicitCalls.requests[0].body).get('client_id')).toBe('client-fixture');
      expect(new URLSearchParams(explicitCalls.requests[1].body).get('client_id')).toBe('updated-client');
    } finally { explicitCalls.cleanup(); }
  });
});
