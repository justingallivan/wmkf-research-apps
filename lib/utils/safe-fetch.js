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
