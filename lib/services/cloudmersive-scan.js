/**
 * Cloudmersive virus-scan client.
 *
 * Single entry point: `scanBytes(bytes, filename)` POSTs the file to
 * `https://api.cloudmersive.com/virus/scan/file` and returns a structured
 * result the rest of the intake pipeline understands:
 *
 *   { scan_result: 'clean' | 'infected' | 'error',
 *     foundViruses: [{ fileName, virusName }],   // [] when clean
 *     scannedAt: ISO-8601 string,                // always set
 *     scanner: 'cloudmersive',                   // provenance tag
 *     error?: string }                           // only when scan_result==='error'
 *
 * Retry policy (matches drain plan v7 / drain-error-classifier `scan_error` cap=3):
 *   - 5xx + network-error/timeout retried up to MAX_ATTEMPTS=3 with exponential
 *     backoff (500ms / 1s / 2s, jittered).
 *   - 4xx are NOT retried. 401/403 (bad/missing Apikey) and 429 (rate limit) are
 *     thrown as structured `serviceName='cloudmersive'` errors so the calling
 *     endpoint can decide whether to translate to 503 (transient throttle) or
 *     500 (auth/config bug). We don't swallow them into `scan_result='error'`
 *     because those are operations-visible — they need to surface to alerts,
 *     not silently mark the file as un-scannable.
 *
 * The drain's `lib/utils/drain-error-classifier.js` already maps
 * `serviceName==='cloudmersive' && status>=500` → `scan_error` (cap=3) and
 * `scanResult==='infected'` → `scan_infected` (terminal). Both shapes are
 * produced here.
 *
 * Why basic /virus/scan/file rather than /advanced: the basic endpoint returns
 * CleanResult + FoundViruses, which is all the intake pipeline acts on today.
 * /advanced adds executable/macro/script flags that the design doc punts on
 * for pilot (allowed file types are pre-restricted to PDF/DOCX/XLSX/txt).
 *
 * Bytes-not-strings contract: callers pass a Buffer / Uint8Array. We do not
 * accept a path — the attach endpoint downloads from private Blob and hands
 * bytes through.
 */
'use strict';

import { buildServiceError, buildNoResponseError } from '../utils/service-error.js';

const ENDPOINT = 'https://api.cloudmersive.com/virus/scan/file';
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
// Backoff base + jitter (added to base, not multiplied) so two simultaneous
// retries don't dogpile the same retry-window. Caps at ~2s on the last try.
const BACKOFF_BASE_MS = [500, 1_000, 2_000];

function jitter() {
  return Math.floor(Math.random() * 250);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireApiKey() {
  const key = process.env.CLOUDMERSIVE_API_KEY;
  if (!key) {
    // Force non-transient: missing config is a deploy bug, not a thing the
    // drain should retry 10× before alerting an operator.
    throw buildServiceError(
      'cloudmersive',
      { status: 500 },
      'CLOUDMERSIVE_API_KEY is not set',
      { isTransient: false },
    );
  }
  return key;
}

async function postOnce(bytes, filename, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Node 18+ FormData / Blob are global. Cloudmersive expects the file under
  // `inputFile`; passing a Blob lets undici set the multipart filename header.
  const form = new FormData();
  form.append('inputFile', new Blob([bytes]), filename);
  let resp;
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Apikey: apiKey },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    throw buildNoResponseError('cloudmersive', err);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw buildServiceError('cloudmersive', resp, text);
  }
  return resp.json();
}

/**
 * Scan a single file's bytes. Returns a structured `scan_result` envelope.
 * Throws structured `serviceName='cloudmersive'` errors for non-retryable
 * conditions (4xx) and for retries-exhausted 5xx/network.
 */
async function scanBytes(bytes, filename) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw buildServiceError(
      'cloudmersive',
      { status: 500 },
      'scanBytes requires Buffer or Uint8Array',
      { isTransient: false },
    );
  }
  if (typeof filename !== 'string' || filename.length === 0) {
    throw buildServiceError(
      'cloudmersive',
      { status: 500 },
      'scanBytes requires non-empty filename',
      { isTransient: false },
    );
  }
  const apiKey = requireApiKey();

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const body = await postOnce(bytes, filename, apiKey);
      const clean = body?.CleanResult === true;
      const foundViruses = Array.isArray(body?.FoundViruses)
        ? body.FoundViruses.map((v) => ({
            fileName: typeof v?.FileName === 'string' ? v.FileName : null,
            virusName: typeof v?.VirusName === 'string' ? v.VirusName : null,
          }))
        : [];
      return {
        scan_result: clean ? 'clean' : 'infected',
        foundViruses,
        scannedAt: new Date().toISOString(),
        scanner: 'cloudmersive',
      };
    } catch (err) {
      lastErr = err;
      // Only retry transient classes — 4xx (auth, validation, rate limit) and
      // config bugs throw immediately.
      if (err?.isTransient !== true) throw err;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(BACKOFF_BASE_MS[attempt - 1] + jitter());
    }
  }
  // All retries exhausted on a transient class. Re-throw the structured error;
  // the drain classifier sees serviceName='cloudmersive' + status>=500 (or
  // noResponse) and maps to `scan_error` (cap=3, terminal after retries) for
  // the residual path. Endpoint-side callers translate to 503.
  throw lastErr;
}

export { scanBytes, ENDPOINT, MAX_ATTEMPTS, TIMEOUT_MS };
