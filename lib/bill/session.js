/**
 * BILL.com session-token cache.
 *
 * One module-level cache per Vercel function instance. Session valid 30 min
 * from `fetchedAt` (5-min safety margin under BILL's 35-min inactivity timeout).
 *
 * Cold-start serialization: concurrent callers awaiting a cache miss share one
 * in-flight login promise. On promise rejection, the cached promise is cleared
 * BEFORE the rejection propagates — otherwise future callers await a forever-
 * rejected promise until process recycle (Codex Q1.1).
 *
 * Cross-instance trade-off: module state is per-instance. Concurrent cold
 * starts across Vercel instances will each log in. Acceptable at our volume
 * (~85 reviewers/cycle vs. 200/hr login limit). Documented in BILL_LIB_DESIGN.md.
 */

import { safeFetch } from '../utils/safe-fetch.js';
import { BillAuthError, BillRateLimitError, BillServerError, BillError } from './errors.js';
import { classify } from './classify.js';
import { redactString } from './redact.js';

const SESSION_TTL_MS = 30 * 60 * 1000;        // 30 min (5-min safety margin under 35-min inactivity)
const LOGIN_TIMEOUT_MS = 30_000;
const LOGIN_RETRY_MAX = 1;                     // login retries hard-capped at 1 (200/hr login limit)
const LOGIN_RETRY_BACKOFF_BASE_MS = 2_000;

const cache = {
  session: null,        // { sessionId, fetchedAt }
  inFlightPromise: null, // Promise<sessionId> | null
};

function nowMs() { return Date.now(); }

function isFresh(session) {
  if (!session) return false;
  return nowMs() - session.fetchedAt < SESSION_TTL_MS;
}

/**
 * Login to BILL and return the session id. Direct call, no caching.
 * @internal
 */
async function doLogin() {
  const baseUrl = process.env.BILL_BASE_URL;
  const devKey = process.env.BILL_DEV_KEY;
  const username = process.env.BILL_USERNAME;
  const password = process.env.BILL_PASSWORD;
  const organizationId = process.env.BILL_ORG_ID;

  if (!baseUrl) throw new BillError('BILL_BASE_URL not configured');
  if (!devKey || !username || !password || !organizationId) {
    throw new BillError('BILL credentials not fully configured (need BILL_DEV_KEY, BILL_USERNAME, BILL_PASSWORD, BILL_ORG_ID)');
  }

  let attempt = 0;
  // Login retries: capped at LOGIN_RETRY_MAX (1). Auth failures + BDC_1144 are
  // never retried; only BDC_1322 (concurrent burst) and 5xx get one retry.
  while (true) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), LOGIN_TIMEOUT_MS);

    let response, parsedBody, status;
    try {
      response = await safeFetch(`${baseUrl}/v3/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devKey, username, password, organizationId }),
        signal: ac.signal,
      });
      status = response.status;
      const text = await safeReadText(response);
      parsedBody = safeJsonParse(text);
    } catch (err) {
      clearTimeout(timeoutId);
      // Network or abort. Retry once if budget permits.
      const cls = classify({ networkError: true });
      if (attempt < LOGIN_RETRY_MAX && cls.retryable) {
        await sleep(LOGIN_RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      throw new BillError(`login: ${redactString(err?.message || String(err))}`);
    }
    clearTimeout(timeoutId);

    const cls = classify({ status, parsedBody });

    if (cls.category === 'ok') {
      const sessionId = parsedBody?.sessionId;
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new BillError('login: response 2xx but sessionId missing/empty', { status, response: JSON.stringify(parsedBody).slice(0, 500) });
      }
      return sessionId;
    }

    // Auth or hourly-rate: terminal, no retry.
    if (cls.category === 'auth') {
      throw new BillAuthError(`login: auth failed (codes: ${cls.codes.join(',')})`, { status, codes: cls.codes, response: JSON.stringify(parsedBody) });
    }
    if (cls.category === 'rate_limited_hourly') {
      throw new BillRateLimitError(`login: hourly quota exhausted (BDC_1144)`, { status, codes: cls.codes, response: JSON.stringify(parsedBody) });
    }

    // Concurrent or server: retry within budget.
    if ((cls.category === 'rate_limited_concurrent' || cls.category === 'server') && attempt < LOGIN_RETRY_MAX) {
      await sleep(LOGIN_RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt));
      attempt++;
      continue;
    }

    if (cls.category === 'rate_limited_concurrent') {
      throw new BillRateLimitError(`login: concurrent rate limit exhausted after ${LOGIN_RETRY_MAX} retries (BDC_1322)`, { status, codes: cls.codes, response: JSON.stringify(parsedBody) });
    }

    if (cls.category === 'server') {
      throw new BillServerError(`login: 5xx after retries (codes: ${cls.codes.join(',') || 'none'})`, { status, codes: cls.codes, response: JSON.stringify(parsedBody) });
    }

    // Anything else (validation, unknown_client)
    throw new BillError(`login: unexpected response (status ${status}, codes: ${cls.codes.join(',') || 'none'})`, { status, codes: cls.codes, response: JSON.stringify(parsedBody) });
  }
}

/**
 * Get or create the cached session id. Concurrent callers share one in-flight
 * login. The in-flight promise is cleared on BOTH resolution and rejection.
 */
export async function getOrCreateBillSession() {
  if (isFresh(cache.session)) return cache.session.sessionId;

  if (cache.inFlightPromise) {
    return cache.inFlightPromise;
  }

  cache.inFlightPromise = (async () => {
    const sessionId = await doLogin();
    cache.session = { sessionId, fetchedAt: nowMs() };
    return sessionId;
  })();

  try {
    return await cache.inFlightPromise;
  } finally {
    // Clear regardless of success/failure (Codex Q1.1).
    cache.inFlightPromise = null;
  }
}

/** Force a fresh login. Used after BDC_1109 to invalidate the cached session. */
export function invalidateSession() {
  cache.session = null;
}

/** Test-only: reset all module state. */
export function __resetSessionCacheForTests() {
  cache.session = null;
  cache.inFlightPromise = null;
}

// ─── helpers ───

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeReadText(response) {
  try { return await response.text(); } catch { return ''; }
}

function safeJsonParse(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
