/**
 * Rate limiting for the applicant intake portal endpoints under
 * `/api/intake/*`. Pilot pre-readiness item from S186 audit (#4).
 *
 * Mirrors `lib/external/rate-limit.js` (A6) but tailored to intake's auth
 * model:
 *   - Intake uses Entra External ID OAuth sessions (`session.user.contactOid`),
 *     not bearer tokens. There is no token-string to bucket on, so per-request
 *     bucketing is keyed on the applicant's `contactOid` directly (no hashing —
 *     OID is already an opaque UUID and is materially easier to debug than a
 *     sha256 hex; same value is persisted in draft/submission rows).
 *   - There is no token-enumeration vector, so no `invalid_count` writes /
 *     spike alerts. The `invalid_count` column on the shared table is unused
 *     by intake rows.
 *
 * Three bucket scopes per request, ALL of which must pass:
 *   - per-applicant per-route: tight, blocks endpoint-specific abuse
 *   - per-applicant aggregate (`...:all`): catches even-distributed abuse
 *     across routes that no per-route bucket would see
 *   - per-IP: loose, DDoS / coordinated-multi-account shield (NAT-tolerant)
 *
 * `routeKey === 'draft'` is a special case (autosave fires often during
 * active editing): only the per-IP bucket applies, scoped to a dedicated
 * draft-specific IP key so autosave volume doesn't starve other endpoints
 * from the same IP. No per-applicant bucket — would break UX with no
 * security benefit since autosave only writes the applicant's own draft row.
 *
 * Backed by the existing `external_rate_limit` Postgres table — `bucket_key`
 * is prefix-discriminated (`tok:` and `ip:` for external, `intake:*` for
 * us). No migration needed. Fixed 60s windows; atomic
 * `INSERT ... ON CONFLICT DO UPDATE` counters (race-free, no SELECT-then-UPDATE).
 *
 * Fail-open by design: a Postgres error here must not lock legitimate
 * applicants out during the pilot. On any infra error the request is allowed —
 * but a sustained run of limiter DB failures raises a `system_alerts` entry so
 * the failing-open (rate-limiting silently disabled) state is not invisible.
 *
 * Usage in a handler (after the method check + session+contactOid extraction,
 * BEFORE any body validation, draft fetch, Blob mint, scan, or transaction):
 *
 *   const rl = await checkIntakeRateLimit(req, contactOid, 'upload-token');
 *   if (!rl.ok) {
 *     res.setHeader('Retry-After', String(rl.retryAfterSeconds));
 *     return res.status(429).json({ error: 'rate_limited', scope: rl.scope });
 *   }
 */

import { sql } from '@vercel/postgres';
import AlertService from '../services/alert-service';

const WINDOW_MS = 60 * 1000;
const PRUNE_PROBABILITY = 0.02;

// Per-route + aggregate + IP caps. Calibrated per Codex pre-impl review:
//   - upload-token / attach @ 20/min/applicant: a 10-attachment submission
//     consumes 10 mint + 10 attach calls, and one retry can hit 10/min exactly;
//     20 gives meaningful retry headroom.
//   - submit @ 5/min/applicant: resubmits should be rare.
//   - aggregate @ 100/min/applicant: 4× headroom above realistic 45/min.
//   - per-IP @ 120/min: NAT-tolerant, matches the external limiter.
//   - draft @ IP-only 120/min on a dedicated bucket so autosave can't starve
//     other endpoints from the same IP.
const LIMITS = Object.freeze({
  'upload-token': { perApplicant: 20, aggregate: 100, perIp: 120 },
  'attach':       { perApplicant: 20, aggregate: 100, perIp: 120 },
  'submit':       { perApplicant: 5,  aggregate: 100, perIp: 120 },
  'draft':        { perApplicant: null, aggregate: null, perIp: 120 }, // draft uses a dedicated per-IP bucket
});

// Degraded-limiter alerting. Same pattern as external — when Postgres is
// unreachable the limiter fails open (intake stays available) but we count
// consecutive failures and raise a deduplicated `system_alerts` once the
// threshold is crossed, so a sustained outage is visible.
const DB_FAILURE_ALERT_THRESHOLD = 5;
const DB_FAILURE_ALERT_KEY = 'intake-rate-limit-db-degraded';
let consecutiveDbFailures = 0;

/** Reset the degraded-limiter failure counter. Test-only seam. */
export function __resetLimiterHealthForTest() {
  consecutiveDbFailures = 0;
}

async function noteLimiterDbFailure(context, err) {
  consecutiveDbFailures += 1;
  console.error(`[intake rate-limit] ${context} error:`, err.message);
  if (consecutiveDbFailures < DB_FAILURE_ALERT_THRESHOLD) return;

  const failureCount = consecutiveDbFailures;
  consecutiveDbFailures = 0;
  try {
    console.error(JSON.stringify({
      level: 'error',
      event: 'intake_rate_limit.db_degraded',
      consecutiveFailures: failureCount,
      lastError: err.message,
    }));
    await AlertService.createAlert({
      type: 'security',
      severity: 'warning',
      title: 'Intake portal rate limiter degraded',
      message:
        `The intake portal rate limiter has failed ${failureCount}+ ` +
        `consecutive Postgres operations and is failing open — requests to ` +
        `/api/intake/* are currently NOT rate-limited.`,
      metadata: { consecutiveFailures: failureCount, lastError: err.message },
      source: 'intake-rate-limit',
      autoResolveKey: DB_FAILURE_ALERT_KEY,
    });
  } catch (alertErr) {
    console.error('[intake rate-limit] degraded-limiter alert raise failed:', alertErr.message);
  }
}

/**
 * Extract the client IP. On Vercel the edge appends the real client as the
 * left-most `x-forwarded-for` entry. Falls back to `x-real-ip` then the raw
 * socket address; a constant sentinel keeps the bucket functional if none
 * resolve (better a coarse bucket than no rate limiting).
 */
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || 'unknown';
}

function currentWindowStartMs() {
  return Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
}

async function maybePrune(cutoffIso) {
  if (Math.random() >= PRUNE_PROBABILITY) return;
  try {
    await sql`DELETE FROM external_rate_limit WHERE window_start < ${cutoffIso}`;
  } catch {
    /* opportunistic — ignore */
  }
}

/**
 * Bucket-key shapes (kept narrow so the prefix scan stays inexpensive):
 *   intake:oid:<contactOid>:<route>     per-applicant per-route
 *   intake:oid:<contactOid>:all         per-applicant aggregate (sum of routes)
 *   intake:ip:<addr>                    per-IP shared across non-draft routes
 *   intake:ip:<addr>:draft              per-IP dedicated to draft autosave
 */
function buildKeys(contactOid, ip, routeKey) {
  if (routeKey === 'draft') {
    return { ipKey: `intake:ip:${ip}:draft`, perApplicantKey: null, aggregateKey: null };
  }
  return {
    perApplicantKey: `intake:oid:${contactOid}:${routeKey}`,
    aggregateKey: `intake:oid:${contactOid}:all`,
    ipKey: `intake:ip:${ip}`,
  };
}

/**
 * Increments the relevant counters for this request and reports whether any
 * applicable bucket is now over its limit. Single round-trip upsert across all
 * applicable buckets (race-free; no partial-enforcement windows under
 * concurrency).
 *
 * @param {object} req
 * @param {string} contactOid  — pulled from session.user.contactOid (REQUIRED for non-draft routes)
 * @param {'upload-token'|'attach'|'submit'|'draft'} routeKey
 * @returns {Promise<{ok:true} | {ok:false, retryAfterSeconds:number, scope:'route'|'aggregate'|'ip'}>}
 */
export async function checkIntakeRateLimit(req, contactOid, routeKey) {
  const limits = LIMITS[routeKey];
  if (!limits) {
    // Misuse — caller passed an unknown routeKey. Fail-open + structured log;
    // never refuse legitimate traffic on a programmer error.
    console.error(`[intake rate-limit] unknown routeKey=${routeKey} — passing through`);
    return { ok: true };
  }
  if (routeKey !== 'draft' && (typeof contactOid !== 'string' || !contactOid)) {
    console.error(`[intake rate-limit] non-draft route requires contactOid — passing through (routeKey=${routeKey})`);
    return { ok: true };
  }

  const windowStartMs = currentWindowStartMs();
  const windowStartIso = new Date(windowStartMs).toISOString();
  const ip = clientIp(req);
  const { perApplicantKey, aggregateKey, ipKey } = buildKeys(contactOid, ip, routeKey);

  // Build the multi-row VALUES set + the matching count slot list. Slots are
  // populated by the RETURNING scan below.
  const keys = [perApplicantKey, aggregateKey, ipKey].filter(Boolean);

  try {
    let rows;
    // @vercel/postgres `sql` is a tagged-template; we vary the VALUES arity
    // depending on whether draft (1 key) or non-draft (3 keys) is in play.
    // Two branches keep the template literal static (no dynamic interpolation
    // that would defeat parameterization).
    if (keys.length === 3) {
      ({ rows } = await sql`
        INSERT INTO external_rate_limit (bucket_key, window_start, hit_count)
        VALUES (${keys[0]}, ${windowStartIso}, 1),
               (${keys[1]}, ${windowStartIso}, 1),
               (${keys[2]}, ${windowStartIso}, 1)
        ON CONFLICT (bucket_key, window_start)
        DO UPDATE SET hit_count = external_rate_limit.hit_count + 1
        RETURNING bucket_key, hit_count
      `);
    } else {
      ({ rows } = await sql`
        INSERT INTO external_rate_limit (bucket_key, window_start, hit_count)
        VALUES (${keys[0]}, ${windowStartIso}, 1)
        ON CONFLICT (bucket_key, window_start)
        DO UPDATE SET hit_count = external_rate_limit.hit_count + 1
        RETURNING bucket_key, hit_count
      `);
    }

    let perApplicantHits = 0;
    let aggregateHits = 0;
    let ipHits = 0;
    for (const r of rows) {
      if (r.bucket_key === perApplicantKey) perApplicantHits = r.hit_count;
      else if (r.bucket_key === aggregateKey) aggregateHits = r.hit_count;
      else if (r.bucket_key === ipKey) ipHits = r.hit_count;
    }

    consecutiveDbFailures = 0; // a successful round trip clears the degraded state

    await maybePrune(new Date(windowStartMs - 2 * WINDOW_MS).toISOString());

    // Evaluate buckets in priority order so the most-specific scope wins the
    // 429 message (route > aggregate > ip). A request can be over multiple
    // buckets at once; surface whichever is tightest for the client.
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStartMs + WINDOW_MS - Date.now()) / 1000),
    );
    if (limits.perApplicant != null && perApplicantHits > limits.perApplicant) {
      return { ok: false, retryAfterSeconds, scope: 'route' };
    }
    if (limits.aggregate != null && aggregateHits > limits.aggregate) {
      return { ok: false, retryAfterSeconds, scope: 'aggregate' };
    }
    if (limits.perIp != null && ipHits > limits.perIp) {
      return { ok: false, retryAfterSeconds, scope: 'ip' };
    }
    return { ok: true };
  } catch (err) {
    await noteLimiterDbFailure('checkIntakeRateLimit', err);
    return { ok: true };
  }
}
