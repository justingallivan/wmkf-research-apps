/**
 * Dataverse target and write interlock — pure policy module (Stage 1,
 * docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md §3.1-§3.4).
 *
 * Answers a question orthogonal to `assertTrustedDalContext` /
 * `assertDataverseAccess` (lib/services/dynamics-context.js): those ask "is
 * this caller trusted (post-auth)?"; this asks "is this PROCESS allowed to
 * write THIS org from THIS deployment?" Both run; neither replaces the
 * other (plan §3.5).
 *
 * Stage 1 is design-complete but UNWIRED: nothing in the runtime calls
 * `assertDataverseOperationAllowed` yet (plan §3.5/§5, Stage 2). This module
 * has zero behavior effect on its own.
 *
 * Browser-import-safe: no Node-only imports (no `fs`/`path`/`async_hooks`).
 * `lib/dataverse/client.js` is reachable from client-adjacent bundle paths
 * per its own header comment, so anything it pulls in — including this
 * module in Stage 2 — must stay safe to bundle for the browser. All
 * `process.env` reads happen inside functions, never at module load, so a
 * bundler that tree-shakes `process` references at the top level is
 * unaffected either way.
 */

import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from './target-registry.js';
import { isGuid } from '../../utils/guid.js';

const INTERLOCK_FLAG = 'DATAVERSE_TARGET_INTERLOCK';
const INTERLOCK_MODES = new Set(['off', 'warn', 'on']);

/**
 * Classify the current deployment. Trusts the platform-set `VERCEL_ENV`;
 * this defends against mistakes (a preview/local process accidentally
 * pointed at prod Dataverse), not a local adversary who exports
 * `VERCEL_ENV=production` — that limitation is accepted, same as every
 * other env-keyed control in this repo (plan §3.1).
 *
 * @returns {'production'|'preview'|'local'|'test'}
 */
export function classifyDeployment() {
  if (process.env.VERCEL_ENV === 'production') return 'production';
  if (process.env.VERCEL_ENV === 'preview') return 'preview';
  if (process.env.NODE_ENV === 'test') return 'test';
  return 'local';
}

/**
 * Classify a Dataverse target by the ACTUAL request URL's hostname — never
 * by which env var supplied it. Exact match against the tracked registry
 * (`target-registry.js`); anything else — including an unlisted
 * `*.crm.dynamics.com` host — is `unknown` (fail closed, forces a reviewed
 * commit rather than a quiet env edit, plan §3.1).
 *
 * @param {string} url
 * @returns {'production'|'sandbox'|'unknown'}
 */
export function classifyTarget(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return 'unknown';
  }
  if (PRODUCTION_HOSTS.includes(hostname)) return 'production';
  if (SANDBOX_HOSTS.includes(hostname)) return 'sandbox';
  return 'unknown';
}

/**
 * Resolve the interlock's enforcement mode from `DATAVERSE_TARGET_INTERLOCK`.
 * Copies `resolveDalUniversalMode`'s shape exactly
 * (lib/services/dynamics-context.js:205): unset/empty → `off`; any other
 * invalid value → `on` with one console.warn. No NODE_ENV-keyed default —
 * turning this on is always a deliberate, per-environment act (plan §3.4).
 *
 * @returns {'off'|'warn'|'on'}
 */
export function resolveInterlockMode() {
  const raw = process.env[INTERLOCK_FLAG];
  if (raw === undefined || raw === '') return 'off';
  if (INTERLOCK_MODES.has(raw)) return raw;
  console.warn(
    `[dataverse-interlock] invalid ${INTERLOCK_FLAG}=${JSON.stringify(raw)} — falling back to 'on'`
  );
  return 'on';
}

/**
 * Return whether this URL should go through the Dataverse interlock. Exact
 * registry hosts and `*.crm.dynamics.com` always inspect; parseable
 * non-Dataverse hosts skip so shared HTTP hooks do not need their own guard.
 * The current `DYNAMICS_URL` / `DYNAMICS_SANDBOX_URL` hostnames are also
 * treated as in-scope, even if they are repointed outside `*.crm.dynamics.com`.
 * Unparseable URLs do NOT skip here — they flow into the existing
 * classify/deny path so the interlock stays fail-closed.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function shouldInspectDataverseUrl(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return true;
  }

  if (PRODUCTION_HOSTS.includes(hostname)) return true;
  if (SANDBOX_HOSTS.includes(hostname)) return true;
  if (hostname.endsWith('.crm.dynamics.com')) return true;

  for (const key of ['DYNAMICS_URL', 'DYNAMICS_SANDBOX_URL']) {
    const configuredUrl = process.env[key];
    if (!configuredUrl) continue;
    try {
      if (new URL(configuredUrl).hostname === hostname) return true;
    } catch {}
  }

  return false;
}

/** GET/HEAD are reads; everything else (POST/PATCH/DELETE/PUT) is a write. */
function classifyOperation(method) {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' ? 'read' : 'write';
}

/** Today's date as `YYYY-MM-DD`, UTC. */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>"`. Honored only
 * when `classifyDeployment() === 'local'` and the embedded date equals today
 * (UTC) — a stale ack in a forgotten `.env.local` line dies at midnight
 * (plan §3.3.1). Malformed or non-local → absent (fail closed).
 *
 * @param {'production'|'preview'|'local'|'test'} deployment
 * @returns {{ purpose: string } | null}
 */
function resolveProdWriteAck(deployment) {
  if (deployment !== 'local') return null;
  const raw = process.env.DATAVERSE_PROD_WRITE_ACK;
  if (!raw || typeof raw !== 'string') return null;

  const match = raw.match(/^(.*)\s+(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;

  const [, purpose, date] = match;
  if (date !== todayUtc()) return null;
  if (!purpose.trim()) return null;

  return { purpose: purpose.trim() };
}

/**
 * Parse and validate `DATAVERSE_REHEARSAL_GRANT` (JSON):
 * `{ purpose, ops: [...], entitySets: [...], recordIds: [...], expiresAt }`.
 * Malformed JSON, a missing/invalid shape, or an expired `expiresAt` → the
 * grant is treated as absent (fail closed, plan §3.3.2). `recordIds` is
 * parsed here without filtering — GUID-only enforcement happens at match
 * time in `grantCoversWrite`, which ignores any non-GUID entry.
 *
 * @returns {{ purpose: string, ops: string[], entitySets: string[], recordIds: string[] } | null}
 */
function resolveRehearsalGrant() {
  const raw = process.env.DATAVERSE_REHEARSAL_GRANT;
  if (!raw) return null;

  let grant;
  try {
    grant = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!grant || typeof grant !== 'object') return null;
  if (!Array.isArray(grant.ops) || !Array.isArray(grant.entitySets)) return null;

  const recordIds = Array.isArray(grant.recordIds) ? grant.recordIds : [];
  const purpose = typeof grant.purpose === 'string' ? grant.purpose : '';

  if (typeof grant.expiresAt !== 'string') return null;
  const expiresAt = Date.parse(grant.expiresAt);
  if (Number.isNaN(expiresAt)) return null;
  if (expiresAt <= Date.now()) return null;

  return { purpose, ops: grant.ops, entitySets: grant.entitySets, recordIds };
}

/**
 * Parse the FIRST `entitySet(key)` segment of a Dataverse OData path,
 * immediately after `/api/data/v<version>/`. This is deliberately the base
 * resource the URL is addressed against, not the terminal path segment:
 * bound actions (`emails(guid)/Microsoft.Dynamics.CRM.SendEmail`) and
 * navigation-property writes (`akoya_requests(guid)/<nav>/$ref`) are
 * record-addressed writes against that FIRST segment's entity set and id,
 * even though the path continues past it — `hasTrailingPath` is `true` for
 * both. A plain entity-set POST (`wmkf_things`, create) has no key segment
 * at all; `hasTrailingPath` distinguishes the two no-key shapes that share
 * "no recordId": an exact collection URL (`/api/data/v.../wmkf_things`,
 * `hasTrailingPath: false`) versus a collection-bound action
 * (`/api/data/v.../contacts/Microsoft.Dynamics.CRM.SomeAction`,
 * `hasTrailingPath: true`) — the latter is NOT a create; the grant shape
 * cannot express what the trailing segment does. The `recordId` returned
 * here is the raw key-predicate text verbatim — it may be a GUID, an
 * alternate key (`wmkf_questionkey='x'`), or a composite key
 * (`_nav_value=<guid>,wmkf_questionkey='x'`); callers that use it for grant
 * matching MUST validate it with `isGuid` first (grant matching is GUID-only,
 * see `grantCoversWrite`). A path with no recognizable
 * `/api/data/v.../<entitySet>` segment returns `null` (fail closed — grant
 * matching cannot proceed without an entity set).
 *
 * @param {string} url
 * @returns {{ entitySet: string, recordId: string | null, hasTrailingPath: boolean } | null}
 */
function parseODataBaseResource(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/\/api\/data\/v[\d.]+\/([^/(]+)(\(([^)]*)\))?/);
  if (!match) return null;
  const rest = pathname.slice(match.index + match[0].length);
  const hasTrailingPath = rest !== '' && rest !== '/';
  return { entitySet: match[1], recordId: match[3] ?? null, hasTrailingPath };
}

/** Extract the OData entity set name from a Dataverse request URL's path. */
function extractEntitySet(url) {
  return parseODataBaseResource(url)?.entitySet ?? null;
}

/** Extract a URL-addressed record GUID (`entitySet(guid)`), if present. */
function extractRecordId(url) {
  return parseODataBaseResource(url)?.recordId ?? null;
}

/**
 * Whether a rehearsal grant covers this specific write. `$batch` is never
 * grant-coverable in v1: any `/$batch` write is a hard deny regardless of
 * the grant's contents, including a grant whose `ops` happens to list
 * `"BATCH"` (plan §3.3.2, coarse-but-never-silently-wider — a changeset can
 * bundle arbitrary sub-requests that this policy layer never inspects, so
 * there is no v1 mechanism that could make batch coverage safe).
 *
 * Non-batch writes match the grant's `ops` and `entitySets`. Two further
 * v1 restrictions, both fail-closed:
 *
 * 1. Create fast-path is exact-collection-URL-only. A write with no
 *    URL-addressed key (`base.recordId` is `null`) is constrained by entity
 *    set alone ONLY when the OData path is EXACTLY
 *    `/api/data/v<ver>/<entitySet>` — nothing after it
 *    (`base.hasTrailingPath === false`). A collection-bound action
 *    (`/contacts/Microsoft.Dynamics.CRM.SomeAction`) also has no key segment
 *    but DOES have a trailing path, and is denied: the grant shape has no
 *    way to scope what that action does.
 * 2. recordIds is GUID-only. Any write with a URL-addressed key
 *    (`base.recordId` present — a plain `entitySet(guid)`, a bound action, or
 *    a `$ref` write) is allowed ONLY if that key is itself a GUID (`isGuid`)
 *    AND it matches (case-insensitively) a GUID entry in `grant.recordIds`.
 *    An alternate-key predicate (`wmkf_things(wmkf_questionkey='x')`) or a
 *    composite key (`_nav_value=<guid>,wmkf_questionkey='x'`) never matches,
 *    even if the literal predicate string appears in `grant.recordIds` —
 *    those are upsert channels (`scripts/seed-review-questions.mjs`,
 *    `lib/external/review-answer-snapshot.js` both PATCH alternate-key URLs
 *    that CREATE on first run) and are never grant-coverable in v1.
 *    Non-GUID entries in `grant.recordIds` are ignored, not matched against.
 */
function grantCoversWrite(grant, url, method) {
  const upperMethod = String(method || '').toUpperCase();

  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  if (/\/\$batch\/?$/.test(pathname)) return false;

  if (!grant.ops.includes(upperMethod)) return false;

  const base = parseODataBaseResource(url);
  if (!base || !grant.entitySets.includes(base.entitySet)) return false;

  if (!base.recordId) {
    // No URL-addressed key. Constrained by entity set only when the path is
    // an exact collection URL; a collection-bound action (trailing path,
    // still no key) is not a create and is denied.
    return !base.hasTrailingPath;
  }

  // URL-addressed key present. GUID-only: alternate-key/composite-key
  // predicates never match, regardless of grant.recordIds contents.
  if (!isGuid(base.recordId)) return false;
  const recordIdLower = base.recordId.toLowerCase();
  return grant.recordIds.some((id) => isGuid(id) && id.toLowerCase() === recordIdLower);
}

/**
 * Evaluate the deployment x target x operation policy matrix (plan §3.2)
 * and the two §3.3 exceptions. Returns a decision object; never throws or
 * logs — `assertDataverseOperationAllowed` (below) owns mode enforcement
 * and side effects, keeping this function a pure, easily-tested policy
 * evaluator. When a §3.3 exception is the reason a write was allowed, the
 * decision carries an `exception` field so the caller can audit-log it
 * (plan §3.3).
 *
 * @returns {{ allowed: boolean, reason: string, exception?: { type: 'prod-write-ack'|'rehearsal-grant', purpose: string } }}
 */
function evaluatePolicy({ deployment, target, operation, url, method }) {
  if (deployment === 'production') {
    if (target === 'production') return { allowed: true, reason: 'production app, production target' };
    return { allowed: false, reason: `production app must not reach a ${target} target` };
  }

  // preview / local / test
  if (target === 'sandbox') {
    return { allowed: true, reason: `${deployment} deployment, sandbox target` };
  }

  if (target === 'production') {
    if (operation === 'read') {
      if (process.env.DATAVERSE_ALLOW_PROD_READS === 'yes') {
        return { allowed: true, reason: 'DATAVERSE_ALLOW_PROD_READS=yes' };
      }
      return { allowed: false, reason: 'prod read denied — DATAVERSE_ALLOW_PROD_READS not set to yes' };
    }

    // write against production from a non-production deployment: deny
    // unless a §3.3 exception applies.
    const ack = resolveProdWriteAck(deployment);
    if (ack) {
      return {
        allowed: true,
        reason: `prod write ack: ${ack.purpose}`,
        exception: { type: 'prod-write-ack', purpose: ack.purpose },
      };
    }

    const grant = resolveRehearsalGrant();
    if (grant && grantCoversWrite(grant, url, method)) {
      return {
        allowed: true,
        reason: `rehearsal grant: ${grant.purpose}`,
        exception: { type: 'rehearsal-grant', purpose: grant.purpose },
      };
    }

    return { allowed: false, reason: `${deployment} deployment must not write production` };
  }

  // unknown target
  return { allowed: false, reason: 'unknown Dataverse target — not in the tracked registry' };
}

// Once-per-process ack log gate (plan §3.3.1). Module-level by design: the
// ack is meant to announce itself once per running process, not once per
// call. Reset only from tests.
let prodWriteAckLogged = false;

/**
 * Test-only: clear the once-per-process ack-logged gate between test cases.
 * Never call this from production code.
 */
export function _resetInterlockStateForTests() {
  prodWriteAckLogged = false;
}

/**
 * Audit-log a §3.3 exception that let a write through. Called only when
 * `evaluatePolicy` allowed the call via an exception and mode is `warn` or
 * `on` (plan §3.3): the prod-write ack announces itself once per process;
 * every rehearsal-grant-allowed write logs its own line naming the grant's
 * purpose, the method, and the URL's entity set/record id.
 */
function logAllowedException(exception, { url, method }) {
  if (exception.type === 'prod-write-ack') {
    if (prodWriteAckLogged) return;
    prodWriteAckLogged = true;
    console.warn(`[dataverse-interlock] PROD WRITE ACK active: ${exception.purpose}`);
    return;
  }

  // rehearsal-grant
  const entitySet = extractEntitySet(url) || 'unknown';
  const recordId = extractRecordId(url);
  const detail =
    `purpose="${exception.purpose}" method=${String(method || 'GET').toUpperCase()} ` +
    `entitySet=${entitySet}${recordId ? ` recordId=${recordId}` : ''}`;
  console.warn(`[dataverse-interlock] rehearsal grant write allowed: ${detail}`);
}

/**
 * The interlock's single entry point (Stage 2 hook sites call this). `off`
 * (default): strict no-op, no policy evaluation at all. `warn`: evaluates
 * the policy and logs one structured `[dataverse-interlock]` line per
 * would-be-denied call, but never throws. `on`: throws when denied, naming
 * the deployment class, target class, method, callerLabel, and the flag to
 * consult (plan §3.4). Parseable non-Dataverse URLs short-circuit as a
 * no-op so shared hook sites do not need their own skip guard; unparseable
 * URLs still flow through policy evaluation and deny fail-closed. In both
 * `warn` and `on`, a write allowed via a §3.3 exception is audit-logged
 * (plan §3.3): the prod-write ack once per process, every rehearsal-grant
 * write every time.
 *
 * @param {Object} params
 * @param {string} params.url - the actual Dataverse request URL.
 * @param {string} params.method - HTTP method (GET/POST/PATCH/DELETE/PUT/HEAD).
 * @param {string} params.callerLabel - identifies the call site in warn/error messages.
 * @throws {Error} only in `on` mode, when the policy denies the call.
 */
export function assertDataverseOperationAllowed({ url, method, callerLabel }) {
  const mode = resolveInterlockMode();
  if (mode === 'off') return;
  if (!shouldInspectDataverseUrl(url)) return;

  const deployment = classifyDeployment();
  const target = classifyTarget(url);
  const operation = classifyOperation(method);

  const { allowed, reason, exception } = evaluatePolicy({ deployment, target, operation, url, method });

  if (allowed) {
    if (exception) logAllowedException(exception, { url, method });
    return;
  }

  const detail =
    `deployment=${deployment} target=${target} method=${String(method || 'GET').toUpperCase()} ` +
    `caller=${callerLabel || 'unknown'} reason="${reason}" — see ${INTERLOCK_FLAG}`;

  if (mode === 'warn') {
    console.warn(`[dataverse-interlock] would deny: ${detail}`);
    return;
  }

  throw new Error(`[dataverse-interlock] denied: ${detail}`);
}
