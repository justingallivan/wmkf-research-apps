/**
 * lib/bill — BILL.com API wrapper.
 *
 * Public surface:
 *   createBillVendor(vendor)              → { vendorId, networkStatus? }
 *   searchBillNetwork(q)                  → { pni, networkId, type, exactMatchCount, allResults }
 *   sendNetworkInvitation(vendorId, networkId) → void
 *   verifyBillWebhook(rawBody, signatureHeader, secret) → boolean
 *
 * Public error classes (re-exported):
 *   BillError, BillAuthError, BillRateLimitError, BillValidationError, BillServerError
 *
 * Design: docs/BILL_LIB_DESIGN.md (v3)
 */

import crypto from 'crypto';
import { safeFetch } from '../utils/safe-fetch.js';
import { getOrCreateBillSession, invalidateSession } from './session.js';
import { classify } from './classify.js';
import { redactString } from './redact.js';
import {
  BillError, BillAuthError, BillRateLimitError, BillValidationError, BillServerError, BillSessionError,
} from './errors.js';

export {
  BillError, BillAuthError, BillRateLimitError, BillValidationError, BillServerError,
};

const DEFAULT_TIMEOUT_MS = 30_000;
const GENERAL_RETRY_MAX = 3;
const RETRY_BACKOFF_BASE_MS = 2_000;

// ─────────────────────────── Public API ───────────────────────────

/**
 * Create a vendor record in BILL.
 * @param {Object} vendor
 * @param {string} vendor.name           Reviewer full name (1-100 chars)
 * @param {string} [vendor.email]
 * @param {string} [vendor.phone]
 * @param {Object} vendor.address        { line1, city, zipOrPostalCode, country (ISO2) }
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ vendorId: string, networkStatus?: string }>}
 */
export async function createBillVendor(vendor, opts = {}) {
  validateVendor(vendor);
  const body = {
    name: vendor.name,
    address: vendor.address,
    ...(vendor.email ? { email: vendor.email } : {}),
    ...(vendor.phone ? { phone: vendor.phone } : {}),
  };
  const { parsedBody } = await billRequest({
    method: 'POST',
    path: '/v3/vendors',
    body,
    signal: opts.signal,
  });
  const vendorId = parsedBody?.id;
  if (typeof vendorId !== 'string' || !vendorId.startsWith('009')) {
    throw new BillError(`createBillVendor: response missing/invalid id (expected '009...' prefix)`, {
      response: JSON.stringify(parsedBody),
    });
  }
  return { vendorId, networkStatus: parsedBody?.networkStatus };
}

/**
 * Search the BILL network by name (NOT email — API constraint).
 * @param {Object} q
 * @param {string} q.name                Full name, ≥3 chars (BILL requirement)
 * @param {string} [q.zipOrPostalCode]   Optional disambiguator
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ pni: string|null, networkId: string|null, type: string|null, exactMatchCount: number, allResults: Array }>}
 */
export async function searchBillNetwork(q, opts = {}) {
  if (!q || typeof q.name !== 'string' || q.name.trim().length < 3) {
    throw new BillValidationError('searchBillNetwork: name required (≥3 chars)');
  }
  const params = new URLSearchParams({ name: q.name.trim(), scope: 'BILL' });
  if (q.zipOrPostalCode) params.set('zipOrPostalCode', String(q.zipOrPostalCode));

  const { parsedBody } = await billRequest({
    method: 'GET',
    path: `/v3/network?${params.toString()}`,
    signal: opts.signal,
  });

  const results = Array.isArray(parsedBody?.results) ? parsedBody.results : [];
  const exactMatchCount = results.length;
  let pni = null, networkId = null, type = null;
  if (exactMatchCount === 1) {
    pni = results[0]?.id ?? null;
    networkId = results[0]?.id ?? null; // same field per BILL docs (PNI = networkId)
    type = results[0]?.type ?? null;
  }
  return { pni, networkId, type, exactMatchCount, allResults: results };
}

/**
 * Send a connection-request invitation to an existing BILL network member.
 * @param {string} vendorId      Our BILL vendor id (begins with `009`)
 * @param {string} networkId     Target member's PNI (from searchBillNetwork)
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 */
export async function sendNetworkInvitation(vendorId, networkId, opts = {}) {
  if (typeof vendorId !== 'string' || !vendorId.startsWith('009')) {
    throw new BillValidationError('sendNetworkInvitation: vendorId must start with "009"');
  }
  if (typeof networkId !== 'string' || networkId.length === 0) {
    throw new BillValidationError('sendNetworkInvitation: networkId required');
  }
  await billRequest({
    method: 'POST',
    path: `/v3/network/invitation/vendor/${encodeURIComponent(vendorId)}`,
    body: { networkId, networkType: 'BILL' },
    signal: opts.signal,
  });
}

/**
 * Verify a BILL webhook payload's HMAC-SHA256 signature (base64).
 * Constant-time comparison mirrors pages/api/irs/verify-ein.js.
 *
 * @param {string} rawBody         Raw request body (NOT parsed JSON)
 * @param {string} signatureHeader Value of `x-bill-sha-signature`
 * @param {string} secret          process.env.BILL_WEBHOOK_SECRET
 * @returns {boolean}
 */
export function verifyBillWebhook(rawBody, signatureHeader, secret) {
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) return false;
  if (typeof signatureHeader !== 'string' || signatureHeader.length === 0) return false;
  if (typeof secret !== 'string' || secret.length === 0) return false;
  let computed;
  try {
    computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  } catch {
    return false;
  }
  return constantTimeEqual(computed, signatureHeader);
}

// ─────────────────────────── Internals ───────────────────────────

/**
 * Issue a BILL request with session caching, retry, and classification.
 * Handles the BDC_1109 reauth+retry transparently.
 */
async function billRequest({ method, path, body, signal }) {
  const baseUrl = process.env.BILL_BASE_URL;
  if (!baseUrl) throw new BillError('BILL_BASE_URL not configured');
  const url = `${baseUrl}${path}`;

  let attempt = 0;
  let sessionRetryUsed = false; // Codex Q2.2: reauth retry is "free" but capped at 1

  while (true) {
    const sessionId = await getOrCreateBillSession();
    const ac = composeAbort(signal);

    let response, parsedBody, status;
    try {
      response = await safeFetch(url, {
        method,
        headers: buildHeaders(sessionId),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: ac.signal,
      });
      status = response.status;
      const text = await safeReadText(response);
      parsedBody = safeJsonParse(text);
    } catch (err) {
      ac.cleanup();
      const cls = classify({ networkError: true });
      if (cls.retryable && attempt < GENERAL_RETRY_MAX) {
        await sleep(RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      throw new BillError(`${method} ${path}: ${redactString(err?.message || String(err))}`);
    }
    ac.cleanup();

    const cls = classify({ status, parsedBody });

    if (cls.category === 'ok') {
      return { parsedBody, status };
    }

    if (cls.category === 'session_expired') {
      if (sessionRetryUsed) {
        // Already reauth'd once and still BDC_1109 — escalate as session error
        // (caller never sees BillSessionError; we convert below). But this means
        // something is wrong (credentials revoked, account locked); throw auth.
        throw new BillAuthError(`${method} ${path}: session expired even after reauth`, {
          status, codes: cls.codes, response: JSON.stringify(parsedBody),
        });
      }
      invalidateSession();
      sessionRetryUsed = true;
      // Doesn't consume the general retry budget — go around once more.
      continue;
    }

    if (cls.category === 'auth') {
      throw new BillAuthError(`${method} ${path}: auth failed (codes: ${cls.codes.join(',')})`, {
        status, codes: cls.codes, response: JSON.stringify(parsedBody),
      });
    }

    if (cls.category === 'rate_limited_hourly') {
      throw new BillRateLimitError(`${method} ${path}: hourly quota exhausted (BDC_1144)`, {
        status, codes: cls.codes, response: JSON.stringify(parsedBody),
      });
    }

    if ((cls.category === 'rate_limited_concurrent' || cls.category === 'server') && attempt < GENERAL_RETRY_MAX) {
      await sleep(RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt));
      attempt++;
      continue;
    }

    if (cls.category === 'rate_limited_concurrent') {
      throw new BillRateLimitError(`${method} ${path}: concurrent rate limit exhausted after ${GENERAL_RETRY_MAX} retries (BDC_1322)`, {
        status, codes: cls.codes, response: JSON.stringify(parsedBody),
      });
    }

    if (cls.category === 'server') {
      throw new BillServerError(`${method} ${path}: 5xx after retries (codes: ${cls.codes.join(',') || 'none'})`, {
        status, codes: cls.codes, response: JSON.stringify(parsedBody),
      });
    }

    if (cls.category === 'validation' || cls.category === 'unknown_client') {
      throw new BillValidationError(`${method} ${path}: ${status} (codes: ${cls.codes.join(',') || 'none'})`, {
        status, codes: cls.codes, response: JSON.stringify(parsedBody),
      });
    }

    // Catch-all
    throw new BillError(`${method} ${path}: unexpected (status ${status})`, {
      status, codes: cls.codes, response: JSON.stringify(parsedBody),
    });
  }
}

function buildHeaders(sessionId) {
  return {
    'Content-Type': 'application/json',
    sessionId,
    devKey: process.env.BILL_DEV_KEY,
  };
}

/**
 * Compose an AbortController that fires when EITHER the external signal aborts
 * OR our internal timeout fires. Returns { signal, cleanup } so the caller can
 * clean up listeners regardless of outcome.
 */
function composeAbort(externalSignal) {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
  let listenerAttached = false;
  const onExternalAbort = () => ac.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort();
    else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      listenerAttached = true;
    }
  }
  return {
    signal: ac.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (listenerAttached) externalSignal.removeEventListener('abort', onExternalAbort);
    },
  };
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // Pad to longest so timingSafeEqual doesn't throw on length mismatch; check
  // original lengths after, so length isn't leaked via timing.
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return crypto.timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

function validateVendor(vendor) {
  if (!vendor || typeof vendor !== 'object') throw new BillValidationError('createBillVendor: vendor required');
  if (typeof vendor.name !== 'string' || vendor.name.length < 1 || vendor.name.length > 100) {
    throw new BillValidationError('createBillVendor: name required (1-100 chars)');
  }
  const a = vendor.address;
  if (!a || typeof a !== 'object') throw new BillValidationError('createBillVendor: address required');
  if (typeof a.line1 !== 'string' || a.line1.length === 0) throw new BillValidationError('createBillVendor: address.line1 required');
  if (typeof a.city !== 'string' || a.city.length === 0) throw new BillValidationError('createBillVendor: address.city required');
  if (typeof a.zipOrPostalCode !== 'string' || a.zipOrPostalCode.length === 0) throw new BillValidationError('createBillVendor: address.zipOrPostalCode required');
  if (typeof a.country !== 'string' || a.country.length !== 2) throw new BillValidationError('createBillVendor: address.country must be ISO2');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function safeReadText(response) {
  try { return await response.text(); } catch { return ''; }
}

function safeJsonParse(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
