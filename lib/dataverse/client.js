/**
 * Dataverse Web API client.
 *
 * Handles OAuth client-credentials token acquisition and a small fetch helper
 * that returns { ok, status, body, text } with consistent error-shape handling.
 *
 * Used by scripts/apply-dataverse-schema.js and any future script that talks
 * to the Dataverse metadata API.
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
  // Variable-path require defeats Turbopack's static tracer; this module
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

async function getAccessToken(resourceUrl) {
  const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
  if (!DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
    throw new Error('Missing DYNAMICS_TENANT_ID / DYNAMICS_CLIENT_ID / DYNAMICS_CLIENT_SECRET');
  }
  const resp = await fetch(
    `https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`,
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

    const resp = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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
