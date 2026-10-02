/**
 * Cloudmersive advanced virus-scan client.
 *
 * Single entry point: `scanBytes(bytes, filename)` POSTs the file to
 * `https://api.cloudmersive.com/virus/scan/file/advanced` and returns a structured
 * result the rest of the intake pipeline understands:
 *
 *   { scan_result: 'clean' | 'infected' | 'error',
 *     foundViruses: [{ fileName, virusName }],   // [] when clean
 *     scannedAt: ISO-8601 string,                // always set
 *     scanner: 'cloudmersive',                   // provenance tag
 *     error?: string }                           // only when scan_result==='error'
 *
 * Retry policy (matches drain plan v7 / drain-error-classifier `scan_error` cap=3):
 *   - Transient HTTP errors (408, 429, 5xx) and network errors retry up to
 *     MAX_ATTEMPTS=3 with jittered backoff (500ms / 1s between attempts).
 *   - Auth/configuration errors (401/403 and missing key) are not retried.
 *     Errors remain structured so callers can distinguish scanner setup,
 *     throttle, timeout, and general availability failures.
 *
 * Optional per-call timeoutMs/maxAttempts overrides are bounded; callers that
 * omit them retain the 30-second / 3-attempt defaults.
 *
 * The drain's `lib/utils/drain-error-classifier.js` already maps
 * `serviceName==='cloudmersive' && status>=500` → `scan_error` (cap=3) and
 * `scanResult==='infected'` → `scan_infected` (terminal). Both shapes are
 * produced here.
 *
 * /advanced endpoint (S193 switch): the basic /virus/scan/file endpoint only
 * detects bare signatures and CANNOT see inside ZIP/DOCX containers or even
 * uncompressed PDF comments — S193 verified all three locally (DOCX-wrapped
 * EICAR and PDF-comment EICAR both returned 'clean' from /virus/scan/file
 * while bare EICAR bytes returned 'infected'). Since our reviewer + intake
 * surfaces only accept PDF/DOCX/DOC/XLSX (i.e., the formats that wrap
 * threats), the basic endpoint was functionally a no-op for this use case.
 * /advanced extracts container contents before scanning and adds the
 * Contains{Executable,Macros,Script,OleEmbeddedObject,...} flags. Defaults
 * here are conservative (allow*=false) except `allowHtml=true` to avoid
 * false positives on legitimate PDF/Office content that happens to embed
 * HTML strings; the magic-byte gate already restricts file type upstream.
 *
 * Bytes-not-strings contract: callers pass a Buffer / Uint8Array. We do not
 * accept a path — the attach endpoint downloads from private Blob and hands
 * bytes through.
 */
'use strict';

import crypto from 'node:crypto';
import { ReadableStream } from 'node:stream/web';

import { buildServiceError, buildNoResponseError } from '../utils/service-error.js';

const ENDPOINT = 'https://api.cloudmersive.com/virus/scan/file/advanced';
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_TIMEOUT_MS = 90_000;

// /advanced flag defaults. Sent as request headers per Cloudmersive's spec.
// String-typed because HTTP headers don't have a boolean type. allowHtml is
// the one permissive default — see file header for rationale.
const ADVANCED_FLAGS = {
  allowExecutables: 'false',
  allowInvalidFiles: 'false',
  allowScripts: 'false',
  allowPasswordProtectedFiles: 'false',
  allowMacros: 'false',
  allowXmlExternalEntities: 'false',
  allowInsecureDeserialization: 'false',
  allowHtml: 'true',
  allowUnsafeArchives: 'false',
  allowOleEmbeddedObject: 'false',
  allowUnwantedAction: 'false',
};

// Order matters: first match wins as the synthesized virusName label for
// the existing `foundViruses[0].virusName` consumer paths in review-upload
// + intake/attach. Order = most-decisive-threat first.
const CONTAINS_FLAG_LABELS = [
  ['ContainsExecutable',              'embedded executable'],
  ['ContainsMacros',                  'embedded macro'],
  ['ContainsScript',                  'embedded script'],
  ['ContainsOleEmbeddedObject',       'embedded OLE object'],
  ['ContainsXmlExternalEntities',     'XML external entity (XXE)'],
  ['ContainsInsecureDeserialization', 'insecure deserialization'],
  ['ContainsUnsafeArchive',           'unsafe archive'],
  ['ContainsUnwantedAction',          'auto-executing action'],
  ['ContainsPasswordProtectedFile',   'password-protected file'],
  ['ContainsInvalidFile',             'malformed file'],
  ['ContainsRestrictedFileFormat',    'restricted file format'],
  ['ContainsHtml',                    'embedded HTML'],
];
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

async function postOnce(bytes, filename, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Stream multipart framing and bounded Buffer views. FormData's Blob
    // conversion can retain another full-file copy of a large upload.
    const boundary = `----formdata-undici-${crypto.randomUUID()}`;
    const safeFilename = filename
      .replace(/"/g, '%22')
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A');
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="inputFile"; filename="${safeFilename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      'utf8',
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const contentLength = prefix.length + bytes.byteLength + suffix.length;
    let offset = -1;
    const body = new ReadableStream({
      pull(stream) {
        if (offset < 0) {
          offset = 0;
          stream.enqueue(prefix);
          return;
        }
        if (offset < bytes.byteLength) {
          const end = Math.min(offset + 10 * 1024 * 1024, bytes.byteLength);
          stream.enqueue(bytes.subarray(offset, end));
          offset = end;
          return;
        }
        if (offset === bytes.byteLength) {
          offset += 1;
          stream.enqueue(suffix);
          return;
        }
        stream.close();
      },
    });
    let resp;
    try {
      resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Apikey: apiKey,
          ...ADVANCED_FLAGS,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(contentLength),
        },
        body,
        duplex: 'half',
        signal: controller.signal,
      });
    } catch (err) {
      throw buildNoResponseError('cloudmersive', err);
    }
    if (!resp.ok) {
      // Keep the known HTTP status if reading its body is aborted or fails.
      const text = await resp.text().catch(() => '');
      throw buildServiceError('cloudmersive', resp, text);
    }
    try {
      return await resp.json();
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        throw buildNoResponseError('cloudmersive', err);
      }
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

function scanOptions(options) {
  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) {
    throw buildServiceError(
      'cloudmersive',
      { status: 500 },
      `Invalid scan options (timeoutMs must be 1–${MAX_TIMEOUT_MS}; maxAttempts must be 1–${MAX_ATTEMPTS})`,
      { isTransient: false },
    );
  }
  return { timeoutMs, maxAttempts };
}

/**
 * Scan a single file's bytes. Returns a structured `scan_result` envelope.
 * Throws structured `serviceName='cloudmersive'` errors for non-retryable
 * conditions (4xx) and for retries-exhausted 5xx/network.
 */
async function scanBytes(bytes, filename, options = {}) {
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
  const { timeoutMs, maxAttempts } = scanOptions(options);

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const body = await postOnce(bytes, filename, apiKey, timeoutMs);
      const clean = body?.CleanResult === true;
      let foundViruses = Array.isArray(body?.FoundViruses)
        ? body.FoundViruses.map((v) => ({
            fileName: typeof v?.FileName === 'string' ? v.FileName : null,
            virusName: typeof v?.VirusName === 'string' ? v.VirusName : null,
          }))
        : [];
      // /advanced rejects (CleanResult=false) can come from either a signature
      // match (FoundViruses populated) OR a content-class trip (Contains*
      // flag true with no signature). Synthesize a foundViruses entry from
      // the first matching Contains* flag so review-upload + intake/attach
      // alert paths — which read foundViruses[0].virusName — keep working
      // without bespoke per-flag branching.
      const detectedThreats = CONTAINS_FLAG_LABELS
        .filter(([key]) => body?.[key] === true)
        .map(([, label]) => label);
      if (!clean && foundViruses.length === 0 && detectedThreats.length > 0) {
        foundViruses = [{ fileName: filename, virusName: detectedThreats[0] }];
      }
      return {
        scan_result: clean ? 'clean' : 'infected',
        foundViruses,
        detectedThreats,
        verifiedFileFormat: typeof body?.VerifiedFileFormat === 'string' ? body.VerifiedFileFormat : null,
        scannedAt: new Date().toISOString(),
        scanner: 'cloudmersive',
      };
    } catch (err) {
      lastErr = err;
      // Retry transient classes including HTTP 429. Auth/configuration errors
      // and other non-transient 4xx responses throw immediately.
      if (err?.isTransient !== true) throw err;
      if (attempt === maxAttempts) break;
      await sleep(BACKOFF_BASE_MS[attempt - 1] + jitter());
    }
  }
  // All retries exhausted on a transient class. Re-throw the structured error;
  // the drain classifier maps no-response to network_no_response and 5xx to
  // scan_error (cap=3, terminal after retries) for the residual path.
  throw lastErr;
}

export { scanBytes, ENDPOINT, MAX_ATTEMPTS, TIMEOUT_MS, MAX_TIMEOUT_MS };
