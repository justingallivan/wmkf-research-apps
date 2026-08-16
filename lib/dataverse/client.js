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

function createClient({ resourceUrl, token, solutionUniqueName, dryRun = false }) {
  const baseUrl = `${resourceUrl}/api/data/v9.2`;

  async function call(method, pathOrUrl, body, extraHeaders = {}) {
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
      resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
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
    post: (p, b, h) => call('POST', p, b, h),
    patch: (p, b, h) => call('PATCH', p, b, h),
    delete_: (p, h) => call('DELETE', p, undefined, h),
    raw: call,
  };
}

module.exports = { loadEnvLocal, getAccessToken, createClient };
