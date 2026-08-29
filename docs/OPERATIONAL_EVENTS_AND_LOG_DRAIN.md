---
title: Operational Events and Vercel Log Drain
domain: observability
kind: runbook
status: active
summary: Durable operational_events layer (app-recorded failures + Vercel Log Drain ingestion), its privacy/dedup/retention contracts, and the activation runbook.
canonical: true
cataloged: 2026-08-19
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-infra-tables.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - lib/services/operational-event-service.js
  - lib/services/vercel-log-drain-ingest.js
  - pages/api/webhooks/vercel-log-drain.js
  - lib/db/migrations/030_operational_events.sql
---

# Operational Events and Vercel Log Drain

**Status:** Merged to `main` via PR #123 and production-deployed 2026-08-19
(merge `9de8b348`). Migration 030 applied to production the same day
[VERIFIED via `apply-migrations` output + live probe: 23 columns, 8 indexes,
tracker 29/29]. The app-recorded event path is LIVE.
**Drain activation:** Production Log Drain ingestion is LIVE. A read-only
Postgres aggregate probe on 2026-08-21 found 61 unique
`source='vercel-drain'` failure rows from `2026-08-19T21:21:58.177Z` through
`2026-08-21T06:05:33.472Z`; all were resolved at closeout [VERIFIED via
`operational_events`]. Vercel's drain API/dashboard independently showed the
drain enabled for only this project, Production Functions/Edge Functions, and
100% sampling except the drain webhook itself. The first approximately 48
hours carried 577.7 MB for $0.29. Track A operational closeout completed
2026-08-21; see the staged plan for the cap-complete telemetry sample and the
explicit limits on retrospective daily-line/throttling claims.

## Why

Vercel runtime logs expire before incidents can be diagnosed. Two recent
incidents defined the requirement:

1. Grantee abstract/image submission failures (virus scan / SharePoint upload /
   Dataverse write) left no durable, sanitized diagnostics.
2. The "Honorarium onboarding failed after reviewer accept" alert
   (`dataverse no-response: This operation was aborted`) stayed open-looking
   even though the drain job later completed and the honorarium existed —
   operators could not distinguish a transient/recovered failure from an
   unresolved one.

## Architecture

One Postgres table, `operational_events` (migration
`lib/db/migrations/030_operational_events.sql`; fresh-install parity in the
`v38Statements` block of `scripts/setup-database.js`), fed by two paths:

1. **Application-recorded events** — `OperationalEventService.recordEvent`
   (`lib/services/operational-event-service.js`), strictly best-effort (never
   throws; a Postgres outage cannot alter a business outcome; failures are
   console-logged only, never re-alerted — no recursive loops).
   - `NotificationService.notify()` mirrors every **error/critical**
     notification automatically, and any severity when the caller passes the
     `operationalEvent` enrichment (stage, transient, entityRefs, recoveryKey…).
     `autoResolveKey` doubles as the event's `recovery_key` and (prefixed
     `alert:`) its fold/reopen `dedupe_key`.
   - The reviewer-acceptance drain passes that enrichment for
     `honorarium_onboard_failed` (structured-error projection: serviceName,
     status, causeKind, noResponse, isTransient, job id/attempts). Job
     completion marks the events **recovered**; withdrawal cancellation marks
     them **superseded** (`settleOperationalFollowupEvents` in
     `lib/services/reviewer-acceptance-drain.js`).
   - `AlertService.autoResolve(key)` also marks matching open events recovered,
     so every existing auto-resolve signal doubles as event recovery.
   - Grantee finalization failures use the same notification/event path with a
     closed-vocabulary diagnostics projection. Browser→private-Blob failures
     occur outside application code, so the authenticated `/upload-failure`
     routes accept only closed stage/category, bounded HTTP status, declared
     byte count, and image type. They write `portal_upload_client_failure`
     events labeled `clientReported:true`; no raw exception, pathname, URL,
     filename, token, text field, or bytes are accepted. These rows are useful
     diagnostics but are not authoritative proof of a server failure.

2. **Vercel Log Drain ingestion** — `POST /api/webhooks/vercel-log-drain`
   (`pages/api/webhooks/vercel-log-drain.js` + selection/mapping in
   `lib/services/vercel-log-drain-ingest.js`).
   - **Auth (fail closed):** `x-vercel-signature` = HMAC-SHA1 hex of the raw
     body with `VERCEL_LOG_DRAIN_SECRET` (constant-time compare; 500 when the
     secret is unset outside development; 403 on mismatch). Verified against
     https://vercel.com/docs/drains/security on 2026-08-19.
   - **Idempotent under at-least-once delivery:** each stored row uses
     `dedupe_key = vercel:<log id>` with `ON CONFLICT DO NOTHING`.
   - **Caps, loud:** 4 MB body (413), ≤1000 entries considered and ≤200 stored
     per delivery (chunked parallel inserts, 25 wide); dropped counts are
     returned in the response and logged.
   - **Storage failures are not acknowledged:** a failed Postgres insert
     returns 503 so Vercel redelivers (dedup makes the retry safe); true
     duplicates and malformed/skipped entries still return 200. A sustained
     Postgres outage therefore surfaces as an errored drain on the Vercel
     Drains page instead of silently dropping the outage's own evidence.
   - **Selection:** keep `level` error/fatal, `statusCode >= 500` or `-1`
     (crash), `proxy.statusCode >= 500`, and structured JSON log lines (the
     `workbench.dependency` convention) whose outcome is
     timeout/network_error/5xx. Everything else is skipped (counted).
   - **Formats:** JSON array, NDJSON, and the single-object drain-creation
     test delivery. Non-identity `content-encoding` is rejected (415);
     configure the drain with compression **none**.

### Privacy / redaction boundary

Never persisted: secrets, authorization headers, tokens, cookies, request
bodies, uploaded file contents, raw email addresses, client IPs, user agents,
referers, JA3/JA4 fingerprints. Enforcement:

- Summaries pass `lib/utils/log-redactor.js` (`redactLogText`) and are capped
  at 2000 chars.
- App metadata passes `sanitizeMetadata`: depth ≤3, ≤40 keys, arrays ≤20,
  strings redacted + capped at 500 chars, sensitive-key denylist
  (authorization/cookie/token/secret/password/apikey/bearer/signature/
  credential/clientip/useragent/email → `[REDACTED]`), 8 KB total JSON cap,
  Error objects projected to `{message, code}` only.
- Drain metadata is a hard **allowlist** (`buildMetadata` in
  `vercel-log-drain-ingest.js`); query strings are stripped from paths.

### Event lifecycle

`status`: `open` (unresolved failure) → `recovered` (a later success signal
matched `recovery_key`) / `resolved` (staff, via admin PATCH with profile
attribution) / `superseded` (no longer applicable, e.g. job cancelled);
`info` rows are non-failures needing no resolution. A recurrence of a
deduped app event **reopens** a settled row and increments
`occurrence_count`, so "recovered" can never mask a repeating failure.
Paths with no automatic recovery signal (e.g. today's grantee submit flow)
stay `open` until staff resolve them — that absence is explicit, not implied.

### Admin surface

`/admin` → **Operational Events** (superuser-only API
`/api/admin/operational-events`): status/severity/source filters, free-text
search over request number / entity refs / correlation id / summary,
expandable sanitized metadata, occurrence counts, transient badges,
Resolve/Reopen actions, and **Resolve all N shown** (S468): one PATCH with
`events[]` (≤500, the list cap) where every row carries its own
`expectedStatus`/`expectedLastOccurredAt` precondition — rows that changed
since the list rendered are skipped and counted as `stale`, never
blind-closed; the response reports `updated/stale/notFound/invalid` and the
card refetches. Rows sharing a signature (source, environment, event type,
subsystem, summary with ids/numbers/hex normalized —
`shared/utils/operational-event-grouping.js`) are **folded in the view** as
"message × N" with a per-group Resolve; storage is untouched, so the
`vercel:<log id>` idempotency contract above is unchanged (a stored fold
would over-count on redelivery).

### Retention

Daily maintenance cron (`MaintenanceService.cleanupOperationalEvents`):
settled rows deleted after `retention:operational_events_days` (default 90,
admin-tunable via Dataverse settings like every other retention key), open
rows after twice that window, hard 200k row cap. No cron polls Vercel for
logs; the drain pushes.

## Drain configuration / recovery runbook (owner-approved external steps)

Production is configured and ingesting. Use these steps to recreate the drain,
rotate its secret, or reverify it after an external configuration change:

1. **Set the secret** (Vercel → Project → Settings → Environment Variables):
   `VERCEL_LOG_DRAIN_SECRET` in Production (and Preview if previews should
   ingest). Generate with `openssl rand -hex 32`, or create the drain first
   (step 2) and copy the auto-generated Signature Verification Secret. Values
   stay in Vercel — never committed. Redeploy so the function picks it up.
2. **Create the drain** (Vercel dashboard → **Team Settings → Drains → Add
   Drain**; Pro plan supports this):
   - Data type: **Logs**.
   - Projects: this project only.
   - Sources: **lambda** and **edge** (build/static/external/firewall/redirect
     add noise the selection policy would discard anyway).
   - Environments: **production** (add preview later if wanted).
   - Sampling: none (100%) — server-side selection + caps handle volume.
   - Destination: **Custom Endpoint** →
     `https://applications.wmkeck.org/api/webhooks/vercel-log-drain`.
   - Format: **NDJSON**. Compression: **none**.
   - Signature Verification Secret: must equal `VERCEL_LOG_DRAIN_SECRET`
     (step 1).
   - Create — Vercel tests the endpoint automatically; a signed test delivery
     returns 200.
3. **Smoke:** use the drain's **Test** button, then confirm rows appear in
   `/admin` → Operational Events (source `vercel-drain`) and that a repeated
   Test does not duplicate rows.
4. **Optional tuning:** set `retention:operational_events_days` in `/admin` →
   settings if 90 days is wrong; pause/delete the drain any time from the
   Drains page (ingestion simply stops; the endpoint stays fail-closed).

## Verification (2026-08-19, this branch)

Focused Jest suites: `operational-event-service`, `vercel-log-drain-ingest`,
`webhook-vercel-log-drain`, `admin-operational-events`,
`notification-service-operational-event`,
`maintenance-cleanup-operational-events`,
`reviewer-acceptance-drain-operational-events`, plus the pre-existing drain /
notification / maintenance suites. Gates: migrations-manifest, api-routes(+
self-test), atlas(+self-test), types, production build — see the session
handoff for the exact run record.

### Operational closeout (2026-08-21)

- Vercel Drains API and dashboard: `enabled`; this project only; Production
  Functions/Edge Functions; NDJSON; 100% sampling with a 0% self-path rule.
- Vercel Usage: 577.7 MB / $0.29 from drain creation
  (`2026-08-19T21:07:30Z`) through the approximately 48-hour closeout.
- Cap-complete five-minute runtime-log control: 15 request records below the
  500-record cap; 11 unique v1 dependency events; zero malformed/invalid,
  unknown dependency, or unknown operation events. Five expected uncorrelated
  Dataverse events used the deliberately closed `unknown` resource class.
- Production Postgres: 61 unique selected failure rows, zero open, zero
  critical, zero crashes; 11 dependency failures, 7 runtime 5xx, and 43 error
  logs. Four free-text summaries reached the documented application cap; no
  structured telemetry event was truncated.
- The Pro account rejected aggregate metrics queries without Observability
  Plus. Exact historical daily telemetry-line and platform-throttling counts
  are therefore not claimed. This limitation is closed as a measurement
  constraint, not converted into a new table or background collector.
