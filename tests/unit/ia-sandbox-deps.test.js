/**
 * Test Request Factory slice 6b, Stage A, item 2 —
 * lib/services/test-requests/ia-sandbox-deps.js.
 *
 * Proves:
 *  1. The constructor refuses any hostname other than the tracked
 *     SANDBOX_HOSTS registry (lib/dataverse/core/target-registry.js).
 *  2. Every sandbox dependency it builds (findByGenerationKey, findByRequest,
 *     getRequest, runChangeset — including the $batch write) routes to the
 *     bound sandbox host, even with `DYNAMICS_URL` set to a real production
 *     hostname from the same registry (never invented).
 *  3. runChangeset stays one atomic request: an embedded 412 failure yields
 *     a rejection and no separate per-op writes are ever attempted.
 *
 * @jest-environment node
 */

import { createIaSandboxDeps } from '../../lib/services/test-requests/ia-sandbox-deps.js';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';

const SANDBOX_URL = `https://${SANDBOX_HOSTS[0]}`;
const PROD_HOST = PRODUCTION_HOSTS[0];

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:ia-sandbox-deps', fn);
}

const ENV_KEYS = [
  'VERCEL_ENV',
  'NODE_ENV',
  'DATAVERSE_TARGET_INTERLOCK',
  'DYNAMICS_URL',
  'DYNAMICS_TENANT_ID',
  'DYNAMICS_CLIENT_ID',
  'DYNAMICS_CLIENT_SECRET',
];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = 'test';
  // Interlock ON, and DYNAMICS_URL deliberately pointed at a PRODUCTION host
  // from the same tracked registry: proves the sandbox deps never fall back
  // to the environment for their target.
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.DYNAMICS_URL = `https://${PROD_HOST}`;
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
  _resetInterlockStateForTests();
  fetch.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const CRLF = '\r\n';

function tokenResponse() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ access_token: 'sandbox-token', expires_in: 3600 }),
    text: () => Promise.resolve(''),
  });
}

function jsonResponse(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

function multipartResponse(ops) {
  const cs = 'changesetresponse_AAA';
  const batch = 'batchresponse_BBB';
  const parts = [`--${batch}`, `Content-Type: multipart/mixed; boundary=${cs}`, ''];
  for (const op of ops) {
    parts.push(`--${cs}`);
    parts.push('Content-Type: application/http');
    parts.push('Content-Transfer-Encoding: binary');
    parts.push(`Content-ID: ${op.contentId}`);
    parts.push('');
    parts.push(`HTTP/1.1 ${op.status} ${op.reason || ''}`.trim());
    parts.push('OData-Version: 4.0');
    parts.push('');
  }
  parts.push(`--${cs}--`);
  parts.push(`--${batch}--`);
  parts.push('');
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? `multipart/mixed; boundary=${batch}` : null) },
    text: () => Promise.resolve(parts.join(CRLF)),
  };
}

const SAMPLE_ROW = {
  wmkf_requestdocumentid: '44444444-4444-4444-4444-444444444444',
  _wmkf_request_value: '33333333-3333-3333-3333-333333333333',
  wmkf_generationkey: 'a'.repeat(64),
};
const SAMPLE_REQUEST = {
  akoya_requestid: '33333333-3333-3333-3333-333333333333',
  _wmkf_currentinitialassessment_value: null,
};

describe('createIaSandboxDeps — host refusal', () => {
  it('throws when constructed with a production host', () => {
    expect(() => createIaSandboxDeps({ resourceUrl: `https://${PROD_HOST}` })).toThrow(/refusing non-sandbox/);
  });

  it('throws when constructed with an unregistered/unknown host', () => {
    expect(() => createIaSandboxDeps({ resourceUrl: 'https://someorg.crm.dynamics.com' })).toThrow(/refusing non-sandbox/);
  });

  it('throws when constructed with an unparseable URL', () => {
    expect(() => createIaSandboxDeps({ resourceUrl: 'not-a-url' })).toThrow(/not a valid URL/);
  });

  it('constructs successfully for the registered sandbox host', () => {
    expect(() => createIaSandboxDeps({ resourceUrl: SANDBOX_URL })).not.toThrow();
  });
});

describe('createIaSandboxDeps — every dependency routes to the bound sandbox host', () => {
  let captured;

  beforeEach(() => {
    captured = [];
    fetch.mockImplementation((url) => {
      captured.push(String(url));
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.includes('/$batch')) return Promise.resolve(multipartResponse([
        { contentId: 1, status: 204 },
      ]));
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [SAMPLE_ROW] });
      if (href.includes('akoya_requests(')) return jsonResponse(SAMPLE_REQUEST);
      return jsonResponse({ value: [] });
    });
  });

  function dataverseUrls() {
    return captured.filter((url) => !url.includes('login.microsoftonline.com'));
  }

  it('findByGenerationKey reads from the sandbox host only', ctx(async () => {
    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    const result = await deps.findByGenerationKey(SAMPLE_ROW.wmkf_generationkey);
    expect(result.records).toEqual([SAMPLE_ROW]);
    expect(dataverseUrls().length).toBeGreaterThan(0);
    for (const url of dataverseUrls()) {
      expect(new URL(url).hostname).toBe(SANDBOX_HOSTS[0]);
    }
  }));

  it('findByRequest reads from the sandbox host only', ctx(async () => {
    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    const result = await deps.findByRequest(SAMPLE_ROW._wmkf_request_value, {});
    expect(result.records).toEqual([SAMPLE_ROW]);
    for (const url of dataverseUrls()) {
      expect(new URL(url).hostname).toBe(SANDBOX_HOSTS[0]);
    }
  }));

  it('getRequest reads from the sandbox host only', ctx(async () => {
    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    const result = await deps.getRequest(SAMPLE_REQUEST.akoya_requestid, { select: ['akoya_requestid'] });
    expect(result).toEqual(SAMPLE_REQUEST);
    for (const url of dataverseUrls()) {
      expect(new URL(url).hostname).toBe(SANDBOX_HOSTS[0]);
    }
  }));

  it('runChangeset writes the $batch to the sandbox host only', ctx(async () => {
    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    const result = await deps.runChangeset([
      {
        method: 'PATCH',
        entitySet: 'wmkf_requestdocuments',
        key: SAMPLE_ROW.wmkf_requestdocumentid,
        body: { wmkf_operationstatus: 5 },
      },
    ]);
    expect(result.ok).toBe(true);
    const batchCalls = dataverseUrls().filter((url) => url.includes('/$batch'));
    expect(batchCalls).toHaveLength(1);
    expect(new URL(batchCalls[0]).hostname).toBe(SANDBOX_HOSTS[0]);
    // Never fell back to the production host DYNAMICS_URL points at.
    expect(dataverseUrls().some((url) => new URL(url).hostname === PROD_HOST)).toBe(false);
  }));
});

describe('createIaSandboxDeps — runChangeset atomicity', () => {
  it('an embedded 412 failure rejects the whole changeset with exactly one $batch request', ctx(async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.includes('/$batch')) return Promise.resolve(multipartResponse([
        { contentId: 1, status: 204 },
        { contentId: 2, status: 412, reason: 'Precondition Failed' },
      ]));
      throw new Error(`unexpected fetch to ${href}`);
    });

    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    await expect(deps.runChangeset([
      {
        method: 'PATCH', entitySet: 'wmkf_requestdocuments', key: SAMPLE_ROW.wmkf_requestdocumentid, body: { wmkf_operationstatus: 5 },
      },
      {
        method: 'PATCH', entitySet: 'akoya_requests', key: SAMPLE_REQUEST.akoya_requestid, body: { akoya_title: 'x' },
      },
    ])).rejects.toMatchObject({ status: 412 });

    const batchCalls = fetch.mock.calls.filter(([url]) => String(url).includes('/$batch'));
    expect(batchCalls).toHaveLength(1);
  }));
});
