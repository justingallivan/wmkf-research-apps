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
import { commitReadyLineage } from '../../lib/services/initial-assessment/artifact-lineage.js';

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

  it('getRequest refuses a non-GUID id before any request is sent', ctx(async () => {
    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    await expect(deps.getRequest("abc')/$metadata", {})).rejects.toThrow(/valid request GUID/);
    expect(dataverseUrls()).toHaveLength(0);
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

  it('every embedded operation URL inside the $batch body uses the sandbox host, never the production host (Opus mutation: embedded-URL-only host swap)', ctx(async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.includes('/$batch')) return Promise.resolve(multipartResponse([
        { contentId: 1, status: 204 },
        { contentId: 2, status: 204 },
      ]));
      throw new Error(`unexpected fetch to ${href}`);
    });

    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    await deps.runChangeset([
      {
        method: 'PATCH', entitySet: 'wmkf_requestdocuments', key: SAMPLE_ROW.wmkf_requestdocumentid, body: { wmkf_operationstatus: 5 },
      },
      {
        method: 'PATCH', entitySet: 'akoya_requests', key: SAMPLE_REQUEST.akoya_requestid, body: { akoya_title: 'x' },
      },
    ]);

    const batchCall = fetch.mock.calls.find(([url]) => String(url).includes('/$batch'));
    expect(batchCall).toBeDefined();
    const body = batchCall[1].body;
    // Embedded op request lines look like "PATCH https://<host>/... HTTP/1.1"
    // (lib/services/dynamics/changeset.js buildChangesetOp), CRLF-joined.
    const embeddedRequestLines = body.match(/^(?:GET|POST|PATCH|DELETE) https?:\/\/\S+ HTTP\/1\.1\r?$/gm) || [];
    expect(embeddedRequestLines).toHaveLength(2);
    for (const line of embeddedRequestLines) {
      const embeddedUrl = line.split(' ')[1];
      expect(new URL(embeddedUrl).hostname).toBe(SANDBOX_HOSTS[0]);
    }
    expect(body.includes(PROD_HOST)).toBe(false);
  }));
});

describe('createIaSandboxDeps — annotation shape parity with production reads', () => {
  it('maps @odata.etag to _etag and a FormattedValue annotation to its *_formatted field', ctx(async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.includes('akoya_requests(')) return jsonResponse({
        akoya_requestid: SAMPLE_REQUEST.akoya_requestid,
        akoya_requesttype: 1,
        'akoya_requesttype@OData.Community.Display.V1.FormattedValue': 'Grant',
        '@odata.etag': 'W/"request-9"',
      });
      throw new Error(`unexpected fetch to ${href}`);
    });

    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    const result = await deps.getRequest(SAMPLE_REQUEST.akoya_requestid, { select: ['akoya_requestid'] });

    expect(result._etag).toBe('W/"request-9"');
    expect(result.akoya_requesttype_formatted).toBe('Grant');
    expect(result['@odata.etag']).toBeUndefined();
    expect(result['akoya_requesttype@OData.Community.Display.V1.FormattedValue']).toBeUndefined();

    const getCall = fetch.mock.calls.find(([url]) => String(url).includes('akoya_requests('));
    expect(getCall[1]?.headers?.Prefer).toBe('odata.include-annotations="*"');
  }));
});

describe('createIaSandboxDeps — trusted DAL context is required', () => {
  it('the three read dependencies throw outside a trusted DAL context', async () => {
    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    await expect(deps.findByGenerationKey('key')).rejects.toThrow(/trusted Dataverse context/);
    await expect(deps.findByRequest(SAMPLE_REQUEST.akoya_requestid, {})).rejects.toThrow(/trusted Dataverse context/);
    await expect(deps.getRequest(SAMPLE_REQUEST.akoya_requestid, {})).rejects.toThrow(/trusted Dataverse context/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runChangeset throws outside a trusted DAL context', () => {
    const deps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });
    expect(() => deps.runChangeset([
      { method: 'PATCH', entitySet: 'akoya_requests', key: SAMPLE_REQUEST.akoya_requestid, body: { x: 1 } },
    ])).toThrow(/trusted Dataverse context/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('createIaSandboxDeps — resourceUrl origin validation (P3.1)', () => {
  it('rejects http (non-https) resource URLs', () => {
    expect(() => createIaSandboxDeps({ resourceUrl: `http://${SANDBOX_HOSTS[0]}` })).toThrow(/must use https:/);
  });

  it('rejects a resourceUrl carrying a path, query, or trailing slash', () => {
    expect(() => createIaSandboxDeps({ resourceUrl: `${SANDBOX_URL}/` })).toThrow(/bare origin/);
    expect(() => createIaSandboxDeps({ resourceUrl: `${SANDBOX_URL}/api/data/v9.2` })).toThrow(/bare origin/);
    expect(() => createIaSandboxDeps({ resourceUrl: `${SANDBOX_URL}?x=1` })).toThrow(/bare origin/);
  });

  it('rejects a resourceUrl carrying a non-default port or userinfo', () => {
    expect(() => createIaSandboxDeps({ resourceUrl: `https://${SANDBOX_HOSTS[0]}:8443` })).toThrow(/bare origin/);
    expect(() => createIaSandboxDeps({ resourceUrl: `https://user:pass@${SANDBOX_HOSTS[0]}` })).toThrow(/bare origin/);
  });
});

describe('createIaSandboxDeps — end-to-end with commitReadyLineage (required by Stage A round 2)', () => {
  it('commitReadyLineage, driven entirely by sandbox deps, reaches the $batch and activates the Ready lineage', ctx(async () => {
    const GENERATION_KEY = 'a'.repeat(64);
    const state = {
      row: {
        wmkf_requestdocumentid: SAMPLE_ROW.wmkf_requestdocumentid,
        wmkf_artifacttype: 100000000,
        wmkf_operationstatus: 100000000, // GENERATING
        wmkf_lifecyclestate: 100000000, // DRAFT
        wmkf_generationkey: GENERATION_KEY,
        wmkf_claimtoken: 'claim-1',
        _wmkf_request_value: SAMPLE_REQUEST.akoya_requestid,
        '@odata.etag': 'W/"row-1"',
        modifiedon: new Date().toISOString(),
      },
      request: {
        akoya_requestid: SAMPLE_REQUEST.akoya_requestid,
        _wmkf_currentinitialassessment_value: null,
        '@odata.etag': 'W/"request-1"',
      },
    };

    fetch.mockImplementation((url, init) => {
      const href = String(url);
      if (href.includes('login.microsoftonline.com')) return tokenResponse();
      if (href.includes('/$batch')) {
        const opCount = (String(init.body).match(/Content-ID: \d+/g) || []).length;
        // Apply the exact mutation THIS changeset performs (no prior-ready
        // rows to supersede): target -> Ready/Draft with the SharePoint
        // metadata, request pointer -> the target row.
        state.row = {
          ...state.row,
          wmkf_operationstatus: 100000001, // READY
          wmkf_sharepointdriveid: 'drive',
          wmkf_sharepointitemid: 'item',
          '@odata.etag': 'W/"row-2"',
        };
        state.request = {
          ...state.request,
          _wmkf_currentinitialassessment_value: state.row.wmkf_requestdocumentid,
          '@odata.etag': 'W/"request-2"',
        };
        const ops = Array.from({ length: opCount }, (_, i) => ({ contentId: i + 1, status: 204 }));
        return Promise.resolve(multipartResponse(ops));
      }
      if (href.includes('wmkf_requestdocuments')) return jsonResponse({ value: [state.row] });
      if (href.includes('akoya_requests(')) return jsonResponse(state.request);
      throw new Error(`unexpected fetch to ${href}`);
    });

    const metadata = {
      siteId: 'site', driveId: 'drive', id: 'item',
      webUrl: 'https://example.sharepoint.com/item', versionId: '1.0', eTag: '"1"',
      size: 10, lastModified: '2026-07-29T12:00:00Z',
    };
    const sandboxDeps = createIaSandboxDeps({ resourceUrl: SANDBOX_URL });

    const result = await commitReadyLineage(state.row, { metadata, claimToken: 'claim-1' }, sandboxDeps);

    expect(result.wmkf_operationstatus).toBe(100000001);
    expect(result._etag).toBe('W/"row-2"');
    const batchCalls = fetch.mock.calls.filter(([u]) => String(u).includes('/$batch'));
    expect(batchCalls).toHaveLength(1);
    for (const [u] of fetch.mock.calls) {
      const href = String(u);
      if (href.includes('login.microsoftonline.com')) continue;
      expect(new URL(href).hostname).toBe(SANDBOX_HOSTS[0]);
    }
  }));
});
