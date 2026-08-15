/**
 * Request correlation + dependency telemetry — Workbench Observability Stage 1.
 *
 * CONTRACT (frozen — other Stage 1 builders integrate against exactly this):
 *   withRequestCorrelation({ correlationId, routeName }, fn) — runs fn inside
 *     a correlation scope and returns fn's return value verbatim (sync value
 *     or promise, unwrapped either way).
 *   getRequestCorrelation() — reads the current scope's { correlationId?,
 *     routeName? }, or undefined outside any scope / when ALS is unavailable.
 *   mintCorrelationId() — fresh UUID for callers that need to originate one
 *     (e.g. an API route before it has a request header to reuse).
 *   emitDependencyEvent({ url, method, ms, response, error }) — logs one
 *     structured `workbench.dependency` JSON line. NEVER throws, NEVER
 *     returns anything meaningful, and NEVER reads a request/response body —
 *     it only classifies the URL/method/outcome shape.
 *   classifyDependency / classifyResourceClass / classifyOutcome — exported
 *     purely so tests can exercise the classifiers directly; not part of the
 *     emission call graph for any other module.
 *
 * Browser-import safety: this module is reachable from client bundles the
 * same way lib/dataverse/client.js is (transitively, via shared dispatch
 * chains). `node:async_hooks` is therefore never required at the top level —
 * only lazily, inside a try/catch, via a variable module-name path so
 * bundlers' static import tracers can't see it and fail the client build.
 * See lib/dataverse/client.js:22-29 for the same pattern applied to fs/path.
 * Deliberately NOT a `typeof window` guard: jest's default environment is
 * jsdom, and a window guard would silently disable ALS under test.
 *
 * Independence: this module owns a dedicated AsyncLocalStorage instance. It
 * does not import, read, or interact with the DAL restriction-context ALS in
 * lib/services/dynamics-context.js — the two are unrelated concerns that
 * happen to both use ALS, and nesting one inside the other must not leak
 * state either direction (see tests/unit/request-correlation.test.js).
 *
 * Emission-failure swallowing: emitDependencyEvent wraps its ENTIRE body in
 * try/catch. A classification bug, a hostile input, a broken console.log, or
 * a JSON.stringify failure must never surface as a thrown error to a caller
 * that is almost always in the middle of handling its own request/response —
 * telemetry must be strictly best-effort.
 *
 * Closed value sets: classifyDependency, classifyResourceClass, and
 * classifyOutcome all fail closed to 'unknown' (or omit optional fields)
 * rather than emit an unrecognized value. This keeps the event schema a
 * fixed, reviewable set of literals instead of an open string surface that
 * could leak identifiers (GUIDs, emails, filenames) embedded in a URL.
 */

function getAsyncHooks() {
  try {
    const modName = 'node:async_hooks';
    return require(modName);
  } catch {
    return null;
  }
}

const asyncHooks = getAsyncHooks();
const requestCorrelationStorage = asyncHooks
  ? new asyncHooks.AsyncLocalStorage()
  : null;

function getRandomUUID() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const cryptoModName = 'crypto';
  return require(cryptoModName).randomUUID();
}

/**
 * Runs `fn` inside a request-correlation scope. Only non-empty-string values
 * for correlationId/routeName are stored — anything else (number, object,
 * empty string, undefined) is omitted, fail-closed, rather than stored as a
 * misleading value.
 *
 * @template T
 * @param {{ correlationId?: unknown, routeName?: unknown }} ctx
 * @param {() => T} fn
 * @returns {T}
 */
function withRequestCorrelation(ctx, fn) {
  if (!requestCorrelationStorage) return fn();

  const store = {};
  if (typeof ctx?.correlationId === 'string' && ctx.correlationId.length > 0) {
    store.correlationId = ctx.correlationId;
  }
  if (typeof ctx?.routeName === 'string' && ctx.routeName.length > 0) {
    store.routeName = ctx.routeName;
  }

  return requestCorrelationStorage.run(store, fn);
}

/**
 * @returns {{ correlationId?: string, routeName?: string } | undefined}
 */
function getRequestCorrelation() {
  if (!requestCorrelationStorage) return undefined;
  return requestCorrelationStorage.getStore();
}

function mintCorrelationId() {
  return getRandomUUID();
}

const DATAVERSE_ENTITY_SETS = new Set([
  'wmkf_potentialreviewerses',
  'wmkf_appreviewersuggestions',
  'akoya_requests',
  'accounts',
  'systemusers',
  'wmkf_appuserappaccesses',
]);

const OPERATION_ALLOWLIST = new Set([
  'GET',
  'POST',
  'PATCH',
  'PUT',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

/**
 * Fixed hostname allowlist, fail-closed to 'unknown'. Mirrors the interlock's
 * host recognition (lib/dataverse/core/interlock.js:109-111) for Dataverse.
 *
 * @param {string} url
 * @returns {'dataverse'|'azuread'|'graph'|'unknown'}
 */
function classifyDependency(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }

  if (hostname === 'login.microsoftonline.com') return 'azuread';
  if (hostname === 'graph.microsoft.com') return 'graph';
  if (hostname.endsWith('.crm.dynamics.com')) return 'dataverse';

  for (const key of ['DYNAMICS_URL', 'DYNAMICS_SANDBOX_URL']) {
    const configuredUrl = process.env[key];
    if (!configuredUrl) continue;
    try {
      if (new URL(configuredUrl).hostname.toLowerCase() === hostname) return 'dataverse';
    } catch {
      // ignore unparseable configured URL
    }
  }

  return 'unknown';
}

const DATAVERSE_PATH_PREFIX = '/api/data/v9.2/';

function classifyDataverseResourceClass(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'unknown';
  }
  const idx = pathname.indexOf(DATAVERSE_PATH_PREFIX);
  if (idx === -1) return 'unknown';
  const rest = pathname.slice(idx + DATAVERSE_PATH_PREFIX.length);
  const match = /^[^(/?]+/.exec(rest);
  const segment = match ? match[0] : '';
  return DATAVERSE_ENTITY_SETS.has(segment) ? segment : 'unknown';
}

function classifyGraphResourceClass(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'unknown';
  }
  if (pathname.includes('/search/query')) return 'search';
  if (
    pathname.includes('/items/')
    || pathname.includes('/items(')
    || pathname.includes('/root:')
  ) {
    return 'drive-item';
  }
  if (pathname.includes('/drives') || pathname.includes('/drive')) return 'drive';
  if (pathname.includes('/sites')) return 'site';
  return 'unknown';
}

/**
 * Closed per-dependency resource-class sets, fail-closed to 'unknown'.
 *
 * @param {'dataverse'|'azuread'|'graph'|'unknown'} dependency
 * @param {string} url
 * @returns {string}
 */
function classifyResourceClass(dependency, url) {
  if (dependency === 'azuread') return 'token';
  if (dependency === 'dataverse') return classifyDataverseResourceClass(url);
  if (dependency === 'graph') return classifyGraphResourceClass(url);
  return 'unknown';
}

/**
 * @param {{ response?: { ok?: boolean, status?: number }, error?: { causeKind?: string } }} params
 * @returns {{ outcome: string, statusClass?: string }}
 */
function classifyOutcome({ response, error }) {
  if (response) {
    if (response.ok) return { outcome: 'success', statusClass: '2xx' };
    const status = response.status;
    if (typeof status === 'number') {
      const bucket = Math.floor(status / 100);
      if (bucket === 3) return { outcome: 'http_error', statusClass: '3xx' };
      if (bucket === 4) return { outcome: 'http_error', statusClass: '4xx' };
      if (bucket === 5) return { outcome: 'http_error', statusClass: '5xx' };
    }
    // Defensive: non-standard status (e.g. 999) — undici can surface these.
    // Named deviation: outcome is still http_error, but statusClass is
    // omitted rather than guessed.
    return { outcome: 'http_error' };
  }
  if (error) {
    if (error.causeKind === 'abort' || error.causeKind === 'timeout') {
      return { outcome: 'timeout' };
    }
    return { outcome: 'network_error' };
  }
  return { outcome: 'network_error' };
}

/**
 * Emits one `workbench.dependency` JSON line via console.log. Never throws;
 * never returns anything meaningful; never reads a request/response body.
 *
 * @param {{ url: string, method?: string, ms: number, response?: object, error?: object }} params
 */
function emitDependencyEvent({ url, method, ms, response, error } = {}) {
  try {
    const dependency = classifyDependency(url);
    const resourceClass = classifyResourceClass(dependency, url);
    const { outcome, statusClass } = classifyOutcome({ response, error });

    const upperMethod = String(method || 'GET').toUpperCase();
    const operation = OPERATION_ALLOWLIST.has(upperMethod) ? upperMethod : 'unknown';

    const correlation = getRequestCorrelation();

    const eventObject = { event: 'workbench.dependency', v: 1, eventId: getRandomUUID() };
    if (correlation?.correlationId) eventObject.correlationId = correlation.correlationId;
    if (correlation?.routeName) eventObject.routeName = correlation.routeName;
    eventObject.dependency = dependency;
    eventObject.resourceClass = resourceClass;
    eventObject.operation = operation;
    eventObject.ms = ms;
    eventObject.outcome = outcome;
    if (statusClass) eventObject.statusClass = statusClass;

    console.log(JSON.stringify(eventObject));
  } catch {
    // Telemetry must never break the caller's request/response handling.
  }
}

module.exports = {
  withRequestCorrelation,
  getRequestCorrelation,
  mintCorrelationId,
  emitDependencyEvent,
  classifyDependency,
  classifyResourceClass,
  classifyOutcome,
};
