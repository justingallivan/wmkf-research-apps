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

**Status:** Implemented on branch `codex/operational-observability` (2026-08-19).
**Not yet activated:** the production migration has NOT been applied and no
Vercel Log Drain has been created. Activation is a deliberate, owner-approved
step — see the runbook below.

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
   - The unmerged grantee-diagnostics branch (`c6c1f088`, `3554b91f`) composes
     without changes: its `notify(... severity 'error'/'warning' ...)` call
     auto-mirrors at error severity on merge, and its closed-vocabulary
     `diagnostics` object rides in `metadata`; adding an `operationalEvent`
     block later upgrades the warning-severity `infected` case.

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
expandable sanitized metadata, occurrence counts, transient badges, and
Resolve/Reopen actions.

### Retention

Daily maintenance cron (`MaintenanceService.cleanupOperationalEvents`):
settled rows deleted after `retention:operational_events_days` (default 90,
admin-tunable via Dataverse settings like every other retention key), open
rows after twice that window, hard 200k row cap. No cron polls Vercel for
logs; the drain pushes.

## Activation runbook (owner-approved steps — do NOT run from a feature branch)

1. **Merge** `codex/operational-observability` to `main` via the normal
   promotion path.
2. **Apply the migration** to the production database:
   `node scripts/apply-migrations.js` (applies `030_operational_events.sql`;
   existing-database path — never `setup-database.js`).
3. **Set the secret** (Vercel → Project → Settings → Environment Variables):
   `VERCEL_LOG_DRAIN_SECRET` in Production (and Preview if previews should
   ingest). Generate with `openssl rand -hex 32`, or create the drain first
   (step 4) and copy the auto-generated Signature Verification Secret. Values
   stay in Vercel — never committed. Redeploy so the function picks it up.
4. **Create the drain** (Vercel dashboard → **Team Settings → Drains → Add
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
     (step 3).
   - Create — Vercel tests the endpoint automatically; a signed test delivery
     returns 200.
5. **Smoke:** use the drain's **Test** button, then confirm rows appear in
   `/admin` → Operational Events (source `vercel-drain`) and that a repeated
   Test does not duplicate rows.
6. **Optional tuning:** set `retention:operational_events_days` in `/admin` →
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
