/**
 * Dataverse Web API client.
 *
 * Handles OAuth client-credentials token acquisition and a small fetch helper
 * that returns { ok, status, body, text } with consistent error-shape handling.
 *
 * Used by scripts/apply-dataverse-schema.js and any future script that talks
 * to the Dataverse metadata API.
 *
 * Telemetry seam (Workbench Observability Stage 1): getAccessToken and
 * call() each time their raw fetch and emit one `workbench.dependency` event
 * via emitDependencyEvent (lib/observability/request-correlation.js), mirroring
 * the fetchWithTimeout seam in lib/services/dynamics/http.js. The observability
 * module is loaded lazily (getObservability(), below) via the same
 * variable-path require pattern as loadEnvLocal — never a top-level require —
 * so this browser-import-safe module stays safe to bundle for the client even
 * though request-correlation.js itself is Node-only underneath.
 */

// fs/path are deferred inside loadEnvLocal so that this module can be
// required from a browser bundle (via the settings-service dispatch chain)
// without tripping Next's webpack. The function is only called from scripts
// and server code, never the client.

// Node 24 requires this ESM module synchronously (verified via
// `node -e "require('./lib/dataverse/client.js')"`); it is browser-import-safe
// by its own header contract, so a static top-level require is bundler-safe
// too (docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.5.2).
const { assertDataverseOperationAllowed } = require('./core/interlock.js');

function loadEnvLocal() {
  // NOTE: Turbopack statically resolves even this variable-path require
  // (verified in .next/server chunk output, 2026-08-15) — the deferral keeps
  // fs/path off the import-time path but does NOT hide them from the
  // bundler; browser safety rests on reachability (see getObservability
  // below). This module
  // is reachable from client-adjacent code via dispatchers but loadEnvLocal
  // is only ever called server-side.
  const fsName = 'fs';
  const pathName = 'path';
  const fs = require(fsName);
  const path = require(pathName);
  const envPath = path.join(__dirname, '..', '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [k, ...v] = t.split('=');
    if (!k || v.length === 0) return;
    let val = v.join('=').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = val;
  });
}

// Lazy, server-only telemetry loader. Never a top-level require (this module
// must stay bundler-safe for the browser per the header contract above) —
// the require argument is a variable, same pattern as loadEnvLocal's fs/path
// loads, so the load stays off this module's import-time path and degrades
// silently if unavailable. This does NOT defeat static import tracers:
// Turbopack statically resolves variable-path requires too, so browser
// safety rests on this module not being reachable from any client bundle
// (as the header contract above already ensures), not on the require being
// invisible. Cached module-locally after the first call; a load failure
// (e.g. this file required in a browser bundle where request-correlation.js's
// own guards still make it safe, or any unexpected error) is swallowed and
// observability is treated as absent.
let cachedObservability;
function getObservability() {
  if (cachedObservability !== undefined) return cachedObservability;
  try {
    const modPath = './../observability/request-correlation.js';
    cachedObservability = require(modPath);
  } catch {
    cachedObservability = null;
  }
  return cachedObservability;
}

function emitTelemetry(params) {
  const observability = getObservability();
  if (!observability) return;
  try {
    observability.emitDependencyEvent(params);
  } catch {
    // Telemetry must never break the caller — emitDependencyEvent itself
    // never throws, but stay defensive against a stubbed/mocked module.
  }
}

async function getAccessToken(resourceUrl) {
  const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
  if (!DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
    throw new Error('Missing DYNAMICS_TENANT_ID / DYNAMICS_CLIENT_ID / DYNAMICS_CLIENT_SECRET');
  }
  const tokenUrl = `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;
  const startedAt = Date.now();
  let resp;
  try {
    resp = await fetch(
      tokenUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: DYNAMICS_CLIENT_ID,
          client_secret: DYNAMICS_CLIENT_SECRET,
          scope: `${resourceUrl}/.default`,
        }),
      },
    );
  } catch (err) {
    emitTelemetry({ url: tokenUrl, method: 'POST', ms: Date.now() - startedAt, error: err });
    throw err;
  }
  emitTelemetry({ url: tokenUrl, method: 'POST', ms: Date.now() - startedAt, response: resp });
  if (!resp.ok) {
    throw new Error(`Token request failed (${resp.status}): ${(await resp.text()).slice(0, 500)}`);
  }
  const { access_token } = await resp.json();
  return access_token;
}

// Parity copy of lib/services/test-requests/isolation.js MARKER_FIELD_NAMES
// (this module is CommonJS and must not require an ES module). These fields
// exist on akoya_request (test-request marker/run id) or wmkf_potentialreviewerses
// (synthetic-reviewer marker, slice 6c-i D-R1); no deployed caller may write
// them except this same opted-out raw client (allowTestRequestMarkerWrites),
// and only within the narrow shape isSanctionedMarkerWrite checks below.
const TEST_REQUEST_MARKER_FIELDS = new Set(['wmkf_istestrequest', 'wmkf_testcreationrunid', 'wmkf_issyntheticreviewer']);

function bodyNamesTestRequestMarker(value, depth = 0) {
  if (!value || typeof value !== 'object') return false;
  if (depth > 32) return true;
  return Object.entries(value).some(([key, inner]) => (
    TEST_REQUEST_MARKER_FIELDS.has(key.split('@')[0].toLowerCase())
    || bodyNamesTestRequestMarker(inner, depth + 1)
  ));
}

// Codex adversarial round 1 (2026-09-25): `allowTestRequestMarkerWrites`
// previously bypassed EVERY marker check for EVERY non-GET method and every
// target once set on client creation. The only sanctioned marker write is
// the Test Request Factory CLI's own create (akoya_requests) and, once
// 6c-ii's seeder lands, the synthetic-reviewer person create
// (wmkf_potentialreviewerses) -- both a single flat POST body. The opt-out
// is scoped to exactly that shape; everything else stays refused even with
// the flag set.
const SANCTIONED_MARKER_ENTITY_SETS = new Set(['akoya_requests', 'wmkf_potentialreviewerses']);
// GUID shape only (not version/variant-locked): matches run-ledger.js's own
// GUID grammar for run ids, which are crypto.randomUUID() values.
const RUN_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The entity set an OData path or absolute URL targets, e.g. "akoya_requests" from "/akoya_requests" or ".../akoya_requests(guid)". */
function targetEntitySet(pathOrUrl) {
  const withoutQuery = String(pathOrUrl).split('?')[0];
  const withoutOrigin = withoutQuery.replace(/^https?:\/\/[^/]+\/api\/data\/v9\.2\//i, '');
  const firstSegment = withoutOrigin.split('/').filter(Boolean)[0] || '';
  return firstSegment.split('(')[0].toLowerCase();
}

/** Every marker field name found in `value`, each tagged with the depth (0 = value's own top level) it was found at and its raw value. Mutates `occurrences`. */
// OData decodes percent-encoded path segments before resolving the property,
// so `%77mkf_istestrequest` IS `wmkf_istestrequest` on the server (Codex 6c-i
// round 3). Compare the decoded segment; a malformed encoding cannot be
// classified, so it is treated as naming a marker and refused.
function decodeSegmentOrRefuse(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return [...TEST_REQUEST_MARKER_FIELDS][0];
  }
}

// The WHATWG URL parser normalizes `\` to `/` before transmission (Codex 6c-i
// round 4), and a decoded segment may itself contain an encoded separator
// (`%2F`, `%5C`). Split on BOTH separators, decode, then split the decoded
// text again, so every path-resolved segment is inspected exactly as the
// server will resolve it.
const PATH_SEPARATORS = /[\/\\]/;
function pathSegmentsForMarkerCheck(pathOrUrl) {
  return String(pathOrUrl).split('?')[0].split(PATH_SEPARATORS)
    .flatMap((raw) => decodeSegmentOrRefuse(raw).split(PATH_SEPARATORS));
}

function collectMarkerOccurrences(value, depth, occurrences) {
  if (!value || typeof value !== 'object') return;
  if (depth > 32) {
    occurrences.push({ key: null, depth, tooDeep: true });
    return;
  }
  if (Array.isArray(value)) {
    // A collection navigation property in a deep insert: every element is
    // nested one level below the array's owner, so any marker inside it is
    // collected at depth + 1 and refused by the top-level-only rule (Codex
    // round 2: skipping arrays left `occurrences` empty and `every` vacuous).
    for (const inner of value) collectMarkerOccurrences(inner, depth + 1, occurrences);
    return;
  }
  for (const [key, inner] of Object.entries(value)) {
    const bare = key.split('@')[0].toLowerCase();
    if (TEST_REQUEST_MARKER_FIELDS.has(bare)) occurrences.push({ key: bare, depth, value: inner });
    collectMarkerOccurrences(inner, depth + 1, occurrences);
  }
}

/**
 * Whether a marker-naming `body` is the ONE sanctioned shape
 * `allowTestRequestMarkerWrites` may admit: POST, to an allowlisted entity
 * set, every marker present strictly at the body's own top level (never
 * nested/deep-insert), each with an allowed value -- `true` for the Boolean
 * markers (wmkf_istestrequest, wmkf_issyntheticreviewer) and a GUID-shaped
 * run id string for wmkf_testcreationrunid. A marker named in the URL path
 * is refused unconditionally by the caller before this is even reached.
 */
function isSanctionedMarkerWrite(method, pathOrUrl, body) {
  if (method !== 'POST') return false;
  if (!SANCTIONED_MARKER_ENTITY_SETS.has(targetEntitySet(pathOrUrl))) return false;
  const occurrences = [];
  collectMarkerOccurrences(body, 0, occurrences);
  // The caller only reaches here because the body names a marker somewhere;
  // an empty collection therefore means the marker sits where the collector
  // could not classify it, and an empty `every` must not approve it.
  if (occurrences.length === 0) return false;
  return occurrences.every((occurrence) => {
    if (occurrence.tooDeep || occurrence.depth !== 0) return false;
    if (occurrence.key === 'wmkf_testcreationrunid') return typeof occurrence.value === 'string' && RUN_ID_SHAPE.test(occurrence.value);
    return occurrence.value === true;
  });
}

/**
 * @param {object} options
 * @param {boolean} [options.allowTestRequestMarkerWrites=false] set only by the
 *   Test Request Factory's local operator CLI, the one sanctioned marker writer.
 */
function createClient({ resourceUrl, token, solutionUniqueName, dryRun = false, allowTestRequestMarkerWrites = false }) {
  const baseUrl = `${resourceUrl}/api/data/v9.2`;

  async function call(method, pathOrUrl, body, extraHeaders = {}, requestOptions = {}) {
    // GET is exempt entirely (a $select or property-level read of a marker
    // field is an ordinary read, never a write); every other method is
    // checked below. A marker named in the URL path (a property-level
    // PUT/DELETE, e.g. .../akoya_requests(id)/wmkf_istestrequest) is refused
    // unconditionally: the opt-out below only ever scopes a POST create
    // BODY, never a URL.
    if (method !== 'GET') {
      const urlNamesMarker = pathSegmentsForMarkerCheck(pathOrUrl)
        .some((segment) => TEST_REQUEST_MARKER_FIELDS.has(segment.split('(')[0].toLowerCase()));
      const bodyTouchesMarker = bodyNamesTestRequestMarker(body);
      if (urlNamesMarker || bodyTouchesMarker) {
        const sanctioned = !urlNamesMarker && allowTestRequestMarkerWrites
          && isSanctionedMarkerWrite(method, pathOrUrl, body);
        if (!sanctioned) {
          throw Object.assign(new Error('Test Request marker fields cannot be written by this client.'), {
            code: 'test_request_marker_immutable',
          });
        }
      }
    }
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (solutionUniqueName && (method === 'POST' || method === 'PATCH')) {
      // Binds newly created or modified artifacts to the solution.
      headers['MSCRM.SolutionUniqueName'] = solutionUniqueName;
    }
    // extraHeaders override auto-added headers (e.g., empty string to suppress
    // MSCRM.SolutionUniqueName when creating the solution itself).
    Object.assign(headers, extraHeaders);
    // Drop headers explicitly set to empty string — used as a suppression signal.
    for (const k of Object.keys(headers)) {
      if (headers[k] === '') delete headers[k];
    }

    if (dryRun && method !== 'GET') {
      console.log(`  [dry-run] ${method} ${url}`);
      if (body) console.log(`  [dry-run] body: ${JSON.stringify(body).slice(0, 300)}${JSON.stringify(body).length > 300 ? '…' : ''}`);
      return { ok: true, status: 0, text: '', body: null, dryRun: true };
    }

    // Interlock (docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.5.2), after
    // the dryRun early-return (dryRun makes no network request and must not
    // be denied) and before the real fetch. Self-scopes on non-Dataverse URLs
    // and when the flag is off.
    assertDataverseOperationAllowed({ url, method, callerLabel: 'dataverse/client.call' });

    const startedAt = Date.now();
    let resp;
    try {
      const fetchOptions = {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      };
      if (requestOptions.signal || requestOptions.timeoutMs !== undefined) {
        const signals = [];
        if (requestOptions.signal) signals.push(requestOptions.signal);
        if (requestOptions.timeoutMs !== undefined) {
          if (!Number.isFinite(requestOptions.timeoutMs) || requestOptions.timeoutMs < 1) {
            throw new Error('Dataverse request timeoutMs must be a positive finite number.');
          }
          signals.push(AbortSignal.timeout(requestOptions.timeoutMs));
        }
        fetchOptions.signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
      }
      resp = await fetch(url, fetchOptions);
    } catch (err) {
      emitTelemetry({ url, method, ms: Date.now() - startedAt, error: err });
      throw err;
    }
    emitTelemetry({ url, method, ms: Date.now() - startedAt, response: resp });
    const text = await resp.text();
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch (_) { /* non-JSON response */ }
    }
    return { ok: resp.ok, status: resp.status, text, body: parsed };
  }

  return {
    baseUrl,
    get: (p, h) => call('GET', p, undefined, h),
    getWithOptions: (p, h, options) => call('GET', p, undefined, h, options),
    post: (p, b, h) => call('POST', p, b, h),
    postWithOptions: (p, b, h, options) => call('POST', p, b, h, options),
    patch: (p, b, h) => call('PATCH', p, b, h),
    patchWithOptions: (p, b, h, options) => call('PATCH', p, b, h, options),
    delete_: (p, h) => call('DELETE', p, undefined, h),
    raw: call,
  };
}

module.exports = { loadEnvLocal, getAccessToken, createClient, TEST_REQUEST_MARKER_FIELDS };
