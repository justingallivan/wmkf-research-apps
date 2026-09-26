/**
 * Test Request Factory `reviews` recipe sandbox deps (slice 6c-ii Stage B):
 * lib/services/test-requests/reviews-sandbox-deps.js. Mirrors
 * tests/unit/ia-sandbox-deps.test.js's shape.
 *
 * Proves:
 *  1. Host refusal (production/unknown/unparseable).
 *  2. Every dependency (findAnyPersonByEmail, getPersonById,
 *     getSuggestionById, createPerson, createSuggestion, runChangeset —
 *     including the embedded $batch URLs) routes to the bound sandbox host
 *     only, even with DYNAMICS_URL pointed at a production host from the
 *     same tracked registry.
 *  3. findAnyPersonByEmail fails closed when SYNTHETIC_REVIEWER_ISOLATION is
 *     off, and applies NO marker/active/Contact filter (P2-4) — it returns a
 *     real, non-synthetic, inactive, or Contact-linked row exactly as it
 *     returns a synthetic one; the caller (the CLI reservation resolver)
 *     applies that classification itself.
 *  4. createPerson is the one sanctioned marker write (raw opted-out
 *     client); createSuggestion goes through write-core (which would refuse
 *     any marker field with no opt-out).
 *  5. runChangeset stays one atomic $batch request.
 *
 * @jest-environment node
 */

import { createReviewsSandboxDeps } from '../../lib/services/test-requests/reviews-sandbox-deps.js';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { _resetInterlockStateForTests } from '../../lib/dataverse/core/interlock.js';

const SANDBOX_URL = `https://${SANDBOX_HOSTS[0]}`;
const PROD_HOST = PRODUCTION_HOSTS[0];

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:reviews-sandbox-deps', fn);
}

const ENV_KEYS = [
  'VERCEL_ENV', 'NODE_ENV', 'DATAVERSE_TARGET_INTERLOCK',
  'DYNAMICS_URL', 'DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET',
  'SYNTHETIC_REVIEWER_ISOLATION',
];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = 'test';
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.DYNAMICS_URL = `https://${PROD_HOST}`;
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
  process.env.SYNTHETIC_REVIEWER_ISOLATION = 'on';
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
    ok: true, status: 200,
    json: () => Promise.resolve({ access_token: 'sandbox-token', expires_in: 3600 }),
    text: () => Promise.resolve(''),
  });
}

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300, status,
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

const PERSON_ID = '55555555-5555-4555-8555-555555555555';
const SUGGESTION_ID = '66666666-6666-4666-8666-666666666666';
const SYNTHETIC_ROW = {
  wmkf_potentialreviewersid: PERSON_ID,
  wmkf_emailaddress: 'throwaway@example.test',
  wmkf_issyntheticreviewer: true,
  statecode: 0,
};

describe('createReviewsSandboxDeps — host refusal', () => {
  it('throws when constructed with a production host', () => {
    expect(() => createReviewsSandboxDeps({ resourceUrl: `https://${PROD_HOST}` })).toThrow(/refusing non-sandbox/);
  });
  it('throws when constructed with an unregistered host', () => {
    expect(() => createReviewsSandboxDeps({ resourceUrl: 'https://someorg.crm.dynamics.com' })).toThrow(/refusing non-sandbox/);
  });
  it('throws when constructed with an unparseable URL', () => {
    expect(() => createReviewsSandboxDeps({ resourceUrl: 'not-a-url' })).toThrow(/not a valid URL/);
  });
  it('constructs successfully for the registered sandbox host', () => {
    expect(() => createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL })).not.toThrow();
  });
});

describe('createReviewsSandboxDeps — every dependency routes to the bound sandbox host only', () => {
  let captured;

  beforeEach(() => {
    captured = [];
    fetch.mockImplementation((url, init = {}) => {
      captured.push(String(url));
      const href = String(url);
      if (new URL(href).hostname === 'login.microsoftonline.com') return tokenResponse();
      if (href.includes('/$batch')) return Promise.resolve(multipartResponse([{ contentId: 1, status: 204 }]));
      if (href.includes('wmkf_potentialreviewerses') && init.method === 'POST') return jsonResponse({ ...SYNTHETIC_ROW });
      if (href.includes('wmkf_potentialreviewerses') && href.includes(`(${PERSON_ID})`)) return jsonResponse({ ...SYNTHETIC_ROW });
      if (href.includes('wmkf_potentialreviewerses')) return jsonResponse({ value: [SYNTHETIC_ROW] });
      if (href.includes('wmkf_appreviewersuggestions') && init.method === 'POST') return jsonResponse({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
      if (href.includes('wmkf_appreviewersuggestions') && init.method === 'PATCH') return { ok: true, status: 204, text: () => Promise.resolve('') };
      if (href.includes('wmkf_appreviewersuggestions')) return jsonResponse({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
      return jsonResponse({ value: [] });
    });
  });

  function dataverseUrls() {
    return captured.filter((url) => new URL(url).hostname !== 'login.microsoftonline.com');
  }

  it('findAnyPersonByEmail reads from the sandbox host only and returns the row', ctx(async () => {
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    const row = await deps.findAnyPersonByEmail('throwaway@example.test');
    expect(row.wmkf_potentialreviewersid).toBe(PERSON_ID);
    for (const url of dataverseUrls()) expect(new URL(url).hostname).toBe(SANDBOX_HOSTS[0]);
  }));

  it('findAnyPersonByEmail fails closed when SYNTHETIC_REVIEWER_ISOLATION is off', ctx(async () => {
    process.env.SYNTHETIC_REVIEWER_ISOLATION = 'off';
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    await expect(deps.findAnyPersonByEmail('throwaway@example.test')).rejects.toMatchObject({ code: 'synthetic_reviewer_isolation_disabled' });
    expect(dataverseUrls()).toHaveLength(0);
  }));

  it('findAnyPersonByEmail applies NO marker filter: returns a row whose marker is not true (P2-4)', ctx(async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (new URL(href).hostname === 'login.microsoftonline.com') return tokenResponse();
      return jsonResponse({ value: [{ ...SYNTHETIC_ROW, wmkf_issyntheticreviewer: false }] });
    });
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    const row = await deps.findAnyPersonByEmail('throwaway@example.test');
    expect(row.wmkf_issyntheticreviewer).toBe(false);
  }));

  it('findAnyPersonByEmail applies NO Contact-link filter: returns a Contact-linked row (P2-4)', ctx(async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (new URL(href).hostname === 'login.microsoftonline.com') return tokenResponse();
      return jsonResponse({ value: [{ ...SYNTHETIC_ROW, _wmkf_contact_value: '77777777-7777-4777-8777-777777777777' }] });
    });
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    const row = await deps.findAnyPersonByEmail('throwaway@example.test');
    expect(row._wmkf_contact_value).toBe('77777777-7777-4777-8777-777777777777');
  }));

  it('findAnyPersonByEmail applies NO active/statecode filter: returns an inactive row (P2-4)', ctx(async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (new URL(href).hostname === 'login.microsoftonline.com') return tokenResponse();
      return jsonResponse({ value: [{ ...SYNTHETIC_ROW, statecode: 1 }] });
    });
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    const row = await deps.findAnyPersonByEmail('throwaway@example.test');
    expect(row.statecode).toBe(1);
  }));

  it('findAnyPersonByEmail throws ambiguous_email_owner on more than one match', ctx(async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (new URL(href).hostname === 'login.microsoftonline.com') return tokenResponse();
      return jsonResponse({ value: [SYNTHETIC_ROW, { ...SYNTHETIC_ROW, wmkf_potentialreviewersid: 'other' }] });
    });
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    await expect(deps.findAnyPersonByEmail('throwaway@example.test')).rejects.toMatchObject({ code: 'ambiguous_email_owner' });
  }));

  it('getPersonById / getSuggestionById read from the sandbox host only', ctx(async () => {
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    await deps.getPersonById(PERSON_ID, { select: ['wmkf_potentialreviewersid'] });
    await deps.getSuggestionById(SUGGESTION_ID, { select: ['wmkf_appreviewersuggestionid'] });
    for (const url of dataverseUrls()) expect(new URL(url).hostname).toBe(SANDBOX_HOSTS[0]);
  }));

  it('createPerson POSTs the marker-carrying body to the sandbox host only (the one sanctioned marker write)', ctx(async () => {
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    const created = await deps.createPerson({ wmkf_potentialreviewersid: PERSON_ID, wmkf_issyntheticreviewer: true, wmkf_emailaddress: 'throwaway@example.test' });
    expect(created.wmkf_potentialreviewersid).toBe(PERSON_ID);
    const postCall = fetch.mock.calls.find(([url, init]) => init?.method === 'POST' && String(url).includes('wmkf_potentialreviewerses'));
    expect(postCall).toBeDefined();
    for (const url of dataverseUrls()) expect(new URL(url).hostname).toBe(SANDBOX_HOSTS[0]);
  }));

  it('createSuggestion (no marker) goes through write-core, bound to the sandbox host only', ctx(async () => {
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    const created = await deps.createSuggestion({ wmkf_appreviewersuggestionid: SUGGESTION_ID, wmkf_suggestionlabel: 'x' });
    expect(created.wmkf_appreviewersuggestionid).toBe(SUGGESTION_ID);
    for (const url of dataverseUrls()) expect(new URL(url).hostname).toBe(SANDBOX_HOSTS[0]);
  }));

  it('createSuggestion refuses a marker field (write-core has no opt-out)', ctx(async () => {
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    await expect(deps.createSuggestion({ wmkf_appreviewersuggestionid: SUGGESTION_ID, wmkf_issyntheticreviewer: true }))
      .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
  }));

  it('runChangeset writes the $batch to the sandbox host only', ctx(async () => {
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    const result = await deps.runChangeset([
      { method: 'PATCH', entitySet: 'wmkf_appreviewersuggestions', key: SUGGESTION_ID, body: { wmkf_reviewstatus: 100000001 } },
    ]);
    expect(result.ok).toBe(true);
    const batchCalls = dataverseUrls().filter((url) => url.includes('/$batch'));
    expect(batchCalls).toHaveLength(1);
    expect(new URL(batchCalls[0]).hostname).toBe(SANDBOX_HOSTS[0]);
    expect(dataverseUrls().some((url) => new URL(url).hostname === PROD_HOST)).toBe(false);
  }));
});

describe('createReviewsSandboxDeps — runChangeset atomicity', () => {
  it('an embedded 412 failure rejects the whole changeset with exactly one $batch request and no separate writes', ctx(async () => {
    fetch.mockImplementation((url) => {
      const href = String(url);
      if (new URL(href).hostname === 'login.microsoftonline.com') return tokenResponse();
      if (href.includes('/$batch')) return Promise.resolve(multipartResponse([
        { contentId: 1, status: 204 },
        { contentId: 2, status: 412, reason: 'Precondition Failed' },
      ]));
      throw new Error(`unexpected fetch to ${href}`);
    });
    const deps = createReviewsSandboxDeps({ resourceUrl: SANDBOX_URL });
    await expect(deps.runChangeset([
      { method: 'PATCH', entitySet: 'wmkf_appreviewanswers', keyPredicate: `_wmkf_appreviewersuggestion_value=${SUGGESTION_ID},wmkf_questionkey='riskLevel'`, body: { wmkf_answervalue: 1 } },
      { method: 'PATCH', entitySet: 'wmkf_appreviewersuggestions', key: SUGGESTION_ID, body: { wmkf_reviewstatus: 100000001 }, ifMatch: 'W/"1"' },
    ])).rejects.toMatchObject({ status: 412 });
    const batchCalls = fetch.mock.calls.filter(([url]) => String(url).includes('/$batch'));
    expect(batchCalls).toHaveLength(1);
  }));
});
