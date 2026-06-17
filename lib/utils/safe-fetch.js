/**
 * Centralized fetch wrapper with host allowlisting (SSRF protection).
 *
 * All server-side outbound HTTP requests should use `safeFetch` instead of
 * the global `fetch`. This prevents SSRF attacks by restricting requests to
 * known, trusted hosts.
 *
 * Usage:
 *   import { safeFetch } from '../../lib/utils/safe-fetch';
 *   const res = await safeFetch('https://api.anthropic.com/v1/messages', { ... });
 *
 * To add a new allowed host, append a RegExp to ALLOWED_HOSTS below.
 */

import dns from 'node:dns/promises';

const ALLOWED_HOSTS = [
  // Microsoft services
  /^graph\.microsoft\.com$/,
  /^login\.microsoftonline\.com$/,
  /^wmkf\.crm\.dynamics\.com$/,
  // Microsoft SharePoint
  /^appriver3651007194\.sharepoint\.com$/,
  // Vercel Blob storage
  /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/,
  // Anthropic
  /^api\.anthropic\.com$/,
  // Research / literature APIs
  /^eutils\.ncbi\.nlm\.nih\.gov$/,
  /^pub\.orcid\.org$/,
  /^api\.openalex\.org$/,
  /^export\.arxiv\.org$/,
  /^api\.biorxiv\.org$/,
  /^api\.semanticscholar\.org$/,
  /^serpapi\.com$/,
  /^chemrxiv\.org$/,
  // Federal funding APIs
  /^api\.nsf\.gov$/,
  /^api\.reporter\.nih\.gov$/,
  // Vercel platform
  /^api\.vercel\.com$/,
  // Multi-LLM providers (Virtual Review Panel)
  /^api\.openai\.com$/,
  /^generativelanguage\.googleapis\.com$/,
  /^api\.perplexity\.ai$/,
  // BILL.com (reviewer-honorarium onboarding)
  /^gateway\.bill\.com$/,
  /^gateway\.stage\.bill\.com$/,
];

const MAX_REDIRECTS = 5;

/**
 * Fetch a URL after verifying the host is in the allowlist.
 *
 * Redirects are followed manually so that every hop is validated against
 * the allowlist. This prevents an allowlisted origin from redirecting to
 * an internal/malicious host.
 *
 * @param {string|URL} url - The URL to fetch (must be HTTPS)
 * @param {RequestInit} [options] - Standard fetch options
 * @returns {Promise<Response>}
 * @throws {Error} If the URL is not HTTPS or the host is not allowed
 */
export async function safeFetch(url, options = {}) {
  let currentUrl = String(url);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const parsed = new URL(currentUrl);

    if (parsed.protocol !== 'https:') {
      throw new Error(`safeFetch: HTTPS required, got ${parsed.protocol}`);
    }

    if (!ALLOWED_HOSTS.some(re => re.test(parsed.hostname))) {
      throw new Error(`safeFetch: host not allowed: ${parsed.hostname}`);
    }

    const response = await fetch(currentUrl, { ...options, redirect: 'manual' });

    // Not a redirect — return the response
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    // Handle redirect: validate the Location header before following
    const location = response.headers.get('location');
    if (!location) {
      return response; // Redirect with no Location — return as-is
    }

    // Resolve relative redirects against the current URL
    currentUrl = new URL(location, currentUrl).href;
  }

  throw new Error(`safeFetch: too many redirects (max ${MAX_REDIRECTS})`);
}

/**
 * Check whether a URL would be allowed by safeFetch (without fetching).
 * Useful for pre-validation before building request payloads.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.some(re => re.test(parsed.hostname));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// safeFetchInstitutionPage — guarded fetch of a DYNAMICALLY-discovered faculty
// /profile page, bound per-call to an already-verified institution domain.
//
// The static ALLOWED_HOSTS above cannot enumerate every university host, so the
// resolved-page email tier (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md) needs a
// fetch whose host is constrained, per call, to the candidate's OpenAlex-verified
// institution domain. This is intentionally separate from `safeFetch` (which keeps
// its static allowlist untouched) and adds the protections a non-statically-trusted
// host requires: exact-or-subdomain host gating, private/reserved-IP rejection
// (resolved before each hop), per-hop redirect re-validation, and content-type /
// size / time caps.
// ---------------------------------------------------------------------------

const PAGE_MAX_REDIRECTS = 3;
const PAGE_USER_AGENT = 'WMKF-Reviewer-Finder/1.0 (+contact-discovery)';

/**
 * Fetch host authorization for the institution-page tier: EXACT match or a
 * SUBDOMAIN of the allowed domain only. Deliberately NOT the reverse relation
 * (`domain endsWith host`) and NOT the hyphen-stripping used for email-domain
 * VALIDATION — authorizing a fetch to a PARENT of the verified domain would be a
 * privilege escalation (verified `cs.stanford.edu` must not authorize fetching
 * `stanford.edu`). Both sides are lowercased; `new URL().hostname` is already
 * punycode/IDNA-normalized.
 */
export function hostWithinDomain(host, domain) {
  if (!host || !domain) return false;
  const h = String(host).toLowerCase();
  const d = String(domain).toLowerCase();
  if (!h || !d) return false;
  const malformed = (value) => value.startsWith('.') || value.endsWith('.') || value.includes('..') || value.split('.').some((label) => !label);
  if (malformed(h) || malformed(d)) return false;
  return h === d || h.endsWith(`.${d}`);
}

function ipv4IsPrivate(addr) {
  const parts = addr.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed → reject
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 (incl. unspecified)
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 reserved/TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4)
  return false;
}

/**
 * Reject any address that is loopback / private / link-local / unique-local /
 * CGNAT / unspecified / reserved, across IPv4 AND IPv6 (incl. IPv4-mapped v6).
 */
export function isPrivateAddress(address, family) {
  if (!address) return true;
  if (family === 4) return ipv4IsPrivate(address);
  const a = String(address).toLowerCase().replace(/%.*$/, ''); // strip zone id
  if (a === '::' || a === '::1') return true; // unspecified, loopback
  const mapped = a.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);
  const hexMapped = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return ipv4IsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  // fe80::/10 link-local (fe80–febf), fc00::/7 unique-local (fc/fd), ff00::/8 multicast
  if (/^fe[89ab]/.test(a)) return true;
  if (/^f[cd]/.test(a)) return true;
  if (/^ff/.test(a)) return true;
  return false;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const err = new Error('institution_page_aborted');
  err.code = 'institution_page_aborted';
  throw err;
}

function composePageSignal(signal, timeoutMs) {
  const timeoutController = new AbortController();
  const id = setTimeout(() => {
    const err = new Error('institution_page_timeout');
    err.code = 'institution_page_timeout';
    timeoutController.abort(err);
  }, timeoutMs);
  const clear = () => clearTimeout(id);
  if (!signal) return { signal: timeoutController.signal, cleanup: clear };
  if (signal.aborted) { clear(); return { signal, cleanup: () => {} }; }
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([signal, timeoutController.signal]), cleanup: clear };
  }
  const combined = new AbortController();
  const onAbort = (e) => combined.abort(e?.target?.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  timeoutController.signal.addEventListener('abort', onAbort, { once: true });
  return {
    signal: combined.signal,
    cleanup: () => { clear(); signal.removeEventListener('abort', onAbort); },
  };
}

async function readBodyCapped(response, maxBytes, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error('safeFetchInstitutionPage: response body is not readable');
  }
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let total = 0;
  const read = async () => {
    if (!signal) return reader.read();
    throwIfAborted(signal);
    let abortListener;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          abortListener = () => reject(signal.reason instanceof Error ? signal.reason : new Error('institution_page_aborted'));
          signal.addEventListener('abort', abortListener, { once: true });
        }),
      ]);
    } finally {
      if (abortListener) signal.removeEventListener('abort', abortListener);
    }
  };
  while (true) {
    let chunk;
    try {
      chunk = await read();
    } catch (err) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw err;
    }
    const { done, value } = chunk;
    if (done) break;
    const nextTotal = total + value.byteLength;
    if (nextTotal > maxBytes) {
      const allowed = Math.max(0, maxBytes - total);
      if (allowed > 0) out += decoder.decode(value.slice(0, allowed), { stream: true });
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    total = nextTotal;
    out += decoder.decode(value, { stream: true });
    if (total >= maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  out += decoder.decode();
  return out;
}

async function cancelResponseBody(response) {
  try {
    const reader = response?.body?.getReader?.();
    if (reader) await reader.cancel();
  } catch {
    // ignore cancellation failures; the dispatcher close below still releases sockets
  }
}

/**
 * Fetch a faculty/profile page, bound to `allowedDomain`. HTTPS-only; host must be
 * exact-or-subdomain of `allowedDomain`; every redirect hop is re-validated; the
 * resolved IP(s) must be public; the body is read text/html|text/plain only and
 * capped at `maxBytes`. Returns `{ ok, status, text, finalUrl }`.
 *
 * @param {string|URL} url
 * @param {{ allowedDomain: string, signal?: AbortSignal, timeoutMs?: number, maxBytes?: number }} opts
 * @throws {Error} non-HTTPS, off-domain host, private-IP target, redirect to a
 *   disallowed/private host, non-HTML content-type, too many redirects, or a
 *   propagated abort.
 */
export async function safeFetchInstitutionPage(url, opts = {}) {
  const { allowedDomain, signal, timeoutMs = 8000, maxBytes = 512 * 1024 } = opts;
  if (!allowedDomain) throw new Error('safeFetchInstitutionPage: allowedDomain is required');

  let currentUrl = String(url);
  for (let hop = 0; hop <= PAGE_MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'https:') {
      throw new Error(`safeFetchInstitutionPage: HTTPS required, got ${parsed.protocol}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (!hostWithinDomain(host, allowedDomain)) {
      throw new Error(`safeFetchInstitutionPage: host '${host}' is not within '${allowedDomain}'`);
    }

    let addresses;
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch (err) {
      throw new Error(`safeFetchInstitutionPage: DNS lookup failed for '${host}': ${err.message}`);
    }
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address, a.family))) {
      throw new Error(`safeFetchInstitutionPage: '${host}' resolves to a private/reserved address`);
    }

    // IP-pinning: connect ONLY to the address we just validated, closing the
    // DNS-rebind TOCTOU window (the name re-resolving to an internal IP between
    // this check and the socket connect). The undici Agent's connect.lookup
    // returns the pinned address; TLS SNI/cert validation still uses `host`.
    const { Agent, fetch: undiciFetch } = await import('undici');
    const pinned = addresses[0];
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          if (options && options.all) return callback(null, [{ address: pinned.address, family: pinned.family }]);
          return callback(null, pinned.address, pinned.family);
        },
      },
    });

    const composed = composePageSignal(signal, timeoutMs);
    let response;
    try {
      response = await undiciFetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: composed.signal,
        dispatcher,
        headers: { Accept: 'text/html,text/plain;q=0.9', 'User-Agent': PAGE_USER_AGENT },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await cancelResponseBody(response);
        if (!location) return { ok: false, status: response.status, text: '', finalUrl: currentUrl };
        currentUrl = new URL(location, currentUrl).href; // re-validated at the top of the next hop
        continue;
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        await cancelResponseBody(response);
        throw new Error(`safeFetchInstitutionPage: non-HTML content-type '${contentType || 'none'}'`);
      }
      const text = await readBodyCapped(response, maxBytes, composed.signal);
      return { ok: response.ok, status: response.status, text, finalUrl: currentUrl };
    } finally {
      composed.cleanup();
      await dispatcher.close().catch(() => {});
    }
  }

  throw new Error(`safeFetchInstitutionPage: too many redirects (max ${PAGE_MAX_REDIRECTS})`);
}
