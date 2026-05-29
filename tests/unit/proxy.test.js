/**
 * Direct unit coverage for the server-side auth proxy (`proxy.js`).
 *
 * Until now the proxy had NO direct test — the API auth helpers were tested,
 * but the proxy's two distinct responsibilities were not (Codebase eval
 * 2026-05-29, finding #4):
 *
 *   1. The CSP function — per-request nonce generation + Content-Security-Policy
 *      header construction, with dev-vs-prod directive differences.
 *   2. The `authorized` callback — the request-gate that decides whether a
 *      request may proceed: /auth + /external bypasses, the AUTH_REQUIRED kill
 *      switch, the fail-closed idle-timeout gate, and applicant/staff
 *      cross-surface separation.
 *
 * `proxy.js` wraps both in `withAuth(fn, options)`. We mock `next-auth/middleware`
 * so `withAuth` simply hands back its two arguments, letting us drive each
 * piece directly. `next/server` is mocked so `NextResponse.next()` yields a
 * captureable headers map.
 */

// withAuth(fn, options) → expose both for direct invocation.
jest.mock('next-auth/middleware', () => ({
  withAuth: (proxyFn, options) => ({ proxyFn, options }),
}));

// NextResponse.next({ request: { headers } }) → a captureable response object.
const nextCalls = [];
jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn((init) => {
      nextCalls.push(init);
      return { headers: new Map(), __init: init };
    }),
  },
}));

import proxyExport from '../../proxy';
import { _resetWarningsForTests } from '../../lib/utils/auth-policy';

const { proxyFn, options } = proxyExport;
const authorized = options.callbacks.authorized;

// jest.setup.js replaces global.crypto with an encryption-only mock that lacks
// getRandomValues (the Web Crypto primitive proxy.js uses for the nonce).
// Restore a deterministic-but-varying getRandomValues for these tests; a
// module-level counter makes successive nonces differ so uniqueness is testable.
let _ctr = 0;
beforeAll(() => {
  global.crypto.getRandomValues = (arr) => {
    for (let i = 0; i < arr.length; i++) arr[i] = (_ctr + i) % 256;
    _ctr += 7;
    return arr;
  };
});

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
beforeEach(() => {
  nextCalls.length = 0;
  _resetWarningsForTests();
});
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

// A request whose headers Next would clone. The CSP fn reads req.headers via
// `new Headers(req.headers)`; a plain object is an accepted Headers init.
function makeReq(headers = {}) {
  return { headers };
}

// Pull the request-side x-nonce / CSP off the captured NextResponse.next init.
function requestHeader(name) {
  const init = nextCalls[nextCalls.length - 1];
  return init?.request?.headers?.get(name);
}

// ───────────────────────────────────────────────────────────────────────────
// CSP function
// ───────────────────────────────────────────────────────────────────────────
describe('proxy CSP function', () => {
  test('sets a per-request nonce on the request x-nonce header and embeds it in the CSP', () => {
    process.env.NODE_ENV = 'production';
    const res = proxyFn(makeReq());

    const nonce = requestHeader('x-nonce');
    expect(nonce).toBeTruthy();
    // base64 of 16 random bytes (24 chars incl. padding).
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);

    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toContain(`'nonce-${nonce}'`);
    // The nonce is also mirrored onto the request CSP header.
    expect(requestHeader('Content-Security-Policy')).toBe(csp);
  });

  test('production CSP is locked down: nonce in script-src, no unsafe-*, upgrade-insecure-requests present', () => {
    process.env.NODE_ENV = 'production';
    const res = proxyFn(makeReq());
    const csp = res.headers.get('Content-Security-Policy');

    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' https:\/\/va\.vercel-scripts\.com/);
    expect(csp).not.toContain("'unsafe-eval'");
    // 'unsafe-inline' must not appear in script-src (it is allowed in style-src).
    const scriptSrc = csp.split('; ').find(d => d.startsWith('script-src'));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  test('development CSP relaxes script-src and drops upgrade-insecure-requests', () => {
    process.env.NODE_ENV = 'development';
    const res = proxyFn(makeReq());
    const csp = res.headers.get('Content-Security-Policy');

    const scriptSrc = csp.split('; ').find(d => d.startsWith('script-src'));
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");
    // localhost is HTTP — upgrading insecure requests would break resource loads.
    expect(csp).not.toContain('upgrade-insecure-requests');
    // dev connect-src allows the websocket dev server.
    expect(csp).toContain('ws://localhost:3000');
  });

  test('style-src allows unsafe-inline in production (no script-execution vector)', () => {
    process.env.NODE_ENV = 'production';
    const res = proxyFn(makeReq());
    const styleSrc = res.headers.get('Content-Security-Policy')
      .split('; ').find(d => d.startsWith('style-src'));
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  test('successive requests get distinct nonces', () => {
    process.env.NODE_ENV = 'production';
    proxyFn(makeReq());
    const first = requestHeader('x-nonce');
    proxyFn(makeReq());
    const second = requestHeader('x-nonce');
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// authorized callback
// ───────────────────────────────────────────────────────────────────────────
describe('proxy authorized callback', () => {
  // Drive isAuthRequired() (read live from env by auth-policy) to "enforce".
  function enforceAuth() {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_REQUIRED = 'true';
    process.env.AZURE_AD_CLIENT_ID = 'c';
    process.env.AZURE_AD_CLIENT_SECRET = 's';
    process.env.AZURE_AD_TENANT_ID = 't';
    delete process.env.EMERGENCY_AUTH_BYPASS;
  }
  function req(pathname) {
    return { nextUrl: { pathname }, headers: {} };
  }
  const fresh = () => Date.now();
  const stale = () => Date.now() - (2 * 60 * 60 * 1000) - 1000; // > 2h idle

  beforeEach(() => { enforceAuth(); });

  test('/auth/* is always allowed (login flow must work pre-auth)', () => {
    expect(authorized({ req: req('/auth/signin'), token: null })).toBe(true);
  });

  test('/external/* and /api/external/* bypass NextAuth (token-authed at the route)', () => {
    expect(authorized({ req: req('/external/review/abc'), token: null })).toBe(true);
    expect(authorized({ req: req('/api/external/review/abc/submit'), token: null })).toBe(true);
  });

  test('external bypass holds even with an expired token (route-level token auth governs)', () => {
    expect(authorized({ req: req('/external/review/abc'), token: { lastActivity: stale() } })).toBe(true);
  });

  test('AUTH_REQUIRED kill switch (non-prod) lets everything through', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_REQUIRED; // isAuthRequired() → false in non-prod
    expect(authorized({ req: req('/'), token: null })).toBe(true);
  });

  describe('idle-timeout gate (fail-closed)', () => {
    test('missing lastActivity is treated as expired → denied', () => {
      expect(authorized({ req: req('/'), token: { azureId: 'a' } })).toBe(false);
    });

    test('lastActivity older than 2h → denied', () => {
      expect(authorized({ req: req('/'), token: { azureId: 'a', lastActivity: stale() } })).toBe(false);
    });

    test('fresh lastActivity + staff token → allowed', () => {
      expect(authorized({ req: req('/'), token: { azureId: 'a', lastActivity: fresh() } })).toBe(true);
    });
  });

  describe('staff surface (non-/apply)', () => {
    test('fresh applicant token is rejected on a staff route', () => {
      const token = { userType: 'applicant', contactOid: 'oid', lastActivity: fresh() };
      expect(authorized({ req: req('/reviewer-finder'), token })).toBe(false);
    });

    test('fresh token without azureId is rejected', () => {
      expect(authorized({ req: req('/'), token: { lastActivity: fresh() } })).toBe(false);
    });

    test('fresh staff token with azureId is allowed', () => {
      expect(authorized({ req: req('/'), token: { azureId: 'a', lastActivity: fresh() } })).toBe(true);
    });
  });

  describe('applicant surface (/apply, /api/apply)', () => {
    test('fresh applicant token with contactOid is allowed', () => {
      const token = { userType: 'applicant', contactOid: 'oid', lastActivity: fresh() };
      expect(authorized({ req: req('/apply'), token })).toBe(true);
      expect(authorized({ req: req('/api/apply/draft'), token })).toBe(true);
    });

    test('fresh staff token is rejected on an applicant route', () => {
      const token = { azureId: 'a', lastActivity: fresh() };
      expect(authorized({ req: req('/apply'), token })).toBe(false);
    });

    test('applicant token missing contactOid is rejected', () => {
      const token = { userType: 'applicant', lastActivity: fresh() };
      expect(authorized({ req: req('/apply'), token })).toBe(false);
    });
  });
});
