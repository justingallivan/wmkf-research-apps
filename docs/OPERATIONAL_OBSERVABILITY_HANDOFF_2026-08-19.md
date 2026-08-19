---
title: Operational Observability Branch Handoff (2026-08-19)
domain: observability
kind: status
status: active
summary: Session handoff for branch codex/operational-observability — commits, verification record, activation preconditions, and unresolved risks.
canonical: false
cataloged: 2026-08-19
owner: product-engineering
related:
  - docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md
---

# Operational Observability Branch Handoff

Session date: 2026-08-19. Task brief: `.claude/worktrees/OPERATIONAL_OBSERVABILITY_TASK.md`.
This handoff is branch-scoped on purpose — main's `SESSION_PROMPT.md` belongs to
the concurrent Session-445 track and was deliberately left untouched.

## What was built (all on this branch, pushed to origin with upstream tracking)

Full architecture, contracts, and the verified activation runbook:
**`docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md`** (read that first).

1. **Schema** — `operational_events` table: migration
   `lib/db/migrations/030_operational_events.sql` (manifest regenerated) +
   fresh-install `v38Statements` parity in `scripts/setup-database.js`.
   Lifecycle statuses open/recovered/resolved/superseded/info; fold/reopen
   dedup (`dedupe_key` partial-unique); `recovery_key` for success signals;
   Atlas coverage in `docs/APPLICATION_STATE_ATLAS.md` +
   `docs/atlas/postgres-infra-tables.md`.
2. **Recorder** — `lib/services/operational-event-service.js`: best-effort
   (never throws, never re-alerts), redaction/size-cap boundary tested.
3. **Seams** — `NotificationService.notify()` auto-mirrors error/critical and
   accepts an `operationalEvent` opt-in (any severity);
   `AlertService.autoResolve` propagates recovery; the reviewer-acceptance
   drain enriches `honorarium_onboard_failed` (structured-error context, job
   id/attempts) and settles events recovered-on-completion /
   superseded-on-withdrawal — directly answering the "Honorarium onboarding
   failed… but it actually completed" incident.
4. **Drain ingestion** — `POST /api/webhooks/vercel-log-drain`
   (HMAC-SHA1 `x-vercel-signature`, fail-closed; 4MB/batch caps with loud
   dropped counts; `vercel:<id>` dedup; hard metadata allowlist; selection =
   error/fatal/5xx/crash/failed structured dependency events) +
   `lib/services/vercel-log-drain-ingest.js`. Proxy allowlisted, HMAC_GUARDS
   registered, 60s maxDuration, secret rotation-tracked
   (`vercel_log_drain_secret`; env `VERCEL_LOG_DRAIN_SECRET`).
5. **Admin surface** — `/api/admin/operational-events` (superuser GET/PATCH) +
   `OperationalEventsSection` on `/admin` (filters, search by request
   number/entity/correlation, occurrence counts, resolve/reopen).
6. **Retention** — `MaintenanceService.cleanupOperationalEvents` in the daily
   maintenance cron: settled rows at `retention:operational_events_days`
   (default 90, admin-tunable), open rows at 2x, 200k hard cap. No Vercel
   polling anywhere.

## Commits

- `ad9f1d7` Add durable operational_events store
- `b6430f9` Ingest Vercel Log Drain deliveries
- `3682ca5` Mirror alerts and drain seams into operational events
- `e263293` Add operational events admin surface
- `c0557b3` Document operational observability
- `f70a819` Update stale Atlas count fixture (pre-existing red on main:
  `reconcile-probe-entity-set-count` still asserted the 724 row snapshot the
  Atlas page moved to 793 on 2026-08-15)

## Verification record (2026-08-19, this worktree)

- Full unit suite: **624 suites / 8105 tests green** (`npx jest tests/unit`).
  New focused suites: operational-event-service, vercel-log-drain-ingest,
  webhook-vercel-log-drain, admin-operational-events,
  notification-service-operational-event,
  maintenance-cleanup-operational-events,
  reviewer-acceptance-drain-operational-events.
- All 57 `check:*` gates green, gate+self-test pairs run sequentially
  (including migrations-manifest, api-routes, atlas, fact-consistency after
  the 159→161 route-count update, secret-scan, types).
- `npm run build` (production webpack) green.
- Vercel drain contract verified against official docs 2026-08-19
  (drains/reference/logs, using-drains, drains/security, REST create-drain):
  batched JSON/NDJSON, stable per-entry `id`, HMAC-SHA1 of raw body in
  `x-vercel-signature`, endpoint auto-test at creation, Pro-plan supported.
  No `x-vercel-verify` handshake in the current flow (legacy echo supported
  via optional `VERCEL_LOG_DRAIN_VERIFY`).
- Compatibility with unmerged grantee commits `c6c1f088`/`3554b91f`: zero
  file overlap (verified via `git show --stat`); their error-severity
  `notify()` auto-mirrors on merge; their `diagnostics` vocabulary rides in
  event metadata; not cherry-picked (no concrete need).

## NOT done from this branch (deliberate, per brief)

- No production migration applied, no Vercel drain created, no deploy, no
  merge to main. Owner activation steps: runbook section of
  `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md` (merge → `node
  scripts/apply-migrations.js` → set `VERCEL_LOG_DRAIN_SECRET` → create the
  NDJSON/no-compression Logs drain to
  `https://applications.wmkeck.org/api/webhooks/vercel-log-drain` → Test →
  confirm rows in /admin). Secret values stay in Vercel.

## Codex adversarial review (2026-08-19, post-push)

A Codex adversarial review of the branch diff returned NEEDS REWORK with two
findings; both were confirmed against source and fixed on this branch:

1. **[high, FIXED]** Warning-graded structured dependency failures (e.g. an
   info-level `workbench.dependency` timeout with HTTP 200) were persisted as
   `status 'info'` and hidden from the admin default open filter. Fix: the
   drain ingester now stores every kept row as `open` — the selection policy
   only keeps failures — with a discriminating guard test
   (`vercel-log-drain-ingest.test.js`, info-level timeout ⇒ `status 'open'`).
2. **[medium, FIXED]** The metadata sanitizer's denylist missed common IP keys
   (`ip`, `ipAddress`, `remoteAddress`, `x-forwarded-for`) and had no IP value
   rule. Fix: key fragments added plus value-level IPv4/IPv6 redaction in
   `sanitizeString` (applies to summaries and metadata), with counter-fixtures.

Post-fix: full unit suite 8107 green, types green. Review verdict otherwise
raised no auth, dedup, schema-parity, retention, or compatibility findings.

A second adversarial cycle (same day, against the fixed diff) returned NEEDS
REWORK with two new findings; both confirmed and fixed:

3. **[high, FIXED]** The retention hard-cap ranked "newest" by id, but
   folded/reopened app events keep their original low id while recurrence
   refreshes `last_occurred_at` — an actively recurring open incident could be
   deleted by the cap. Fix: the cap phase now ranks by
   `last_occurred_at DESC, id DESC` (OFFSET window); the append-only
   shadow-log sibling deliberately keeps its id-based cap (rows there are
   never updated in place).
4. **[medium, FIXED]** `notifyAcceptedContactFailure` (warning severity)
   recorded no durable event even though completion/withdrawal settle its
   `accepted-reviewer-contact-failed:<id>` recovery key. Fix: it now passes
   the `operationalEvent` enrichment (stage `accepted_contact_promotion`,
   structured-error projection, job id/attempts), so the settled row exists.

Post-cycle-2: full unit suite 8108 green, types green. Cycle 2 raised no
findings against the cycle-1 fixes' edge cases (drain-open noise, IP
over/under-redaction) or the other attacked surfaces.

## Unresolved risk / notes for the next session

1. Migration 030 SQL has not run against a live Postgres (no DB access from
   this branch per policy); it mirrors migration-028 conventions and the
   setup-database block byte-for-byte in shape, but the first
   `apply-migrations` run should be watched.
2. The public reviewer-withdrawal path (`lib/services/reviewer-withdrawal.js`)
   cancels acceptance jobs without settling events — a withdrawal that races
   ahead of the drain leaves the event `open` until the next drain tick or
   staff resolution. Accepted residual; wire `markSuperseded` there if it
   ever matters.
3. Grantee submit failures (until `3554b91f` merges) reach the event store
   only via error-severity `notify()` mirroring — today's branch has no
   grantee alert at that seam, so those stay Vercel-drain-only until merge.
4. `/api/cron/log-analysis` still polls the Vercel API on its own 6h cadence
   (pre-existing, untouched). Once the drain is live it is partly redundant;
   retiring/repointing it is an owner decision.
5. Drain volume is governed by selection + caps + retention, not sampling;
   if production error volume is ever pathological, add a sampling rule on
   the drain rather than widening the endpoint caps.
