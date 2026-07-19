---
title: Reviewer Identity Shadow Logger — Handoff
domain: reviewer-identity
kind: runbook
status: active
summary: "Durable Postgres resolver-comparison logger integrated into the Codex W2/W4 branch; migration 026 deliberately not applied."
canonical: false
cataloged: 2026-07-19
owner: product-engineering
related:
  - docs/atlas/postgres-reviewer-identity-shadow-log.md
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
---

# Reviewer Identity Shadow Logger — Handoff

**Branch:** `claude/reviewer-identity-shadow-logger` (fresh from `origin/main`
at `7e8a8ced`). Built 2026-07-19 by Claude. Not merged, not deployed, not
pushed to `main`; migration **not applied** anywhere.

**Integration update:** commit `908c6f32` was cherry-picked into
`codex/w2-cutover-w4-evidence` and the runtime seam returned to Codex. Codex
then made normal inserts awaited (while preserving the non-throwing result
contract), added resolver-mode attribution, and integrated the explicit
owner-gated combined path. Migration 026 remains unapplied.

## What was built

The runtime seam's shadow observers previously reported W2-vs-legacy
comparisons only to `console.info`/`console.warn`, which Vercel discards
within minutes. The default observers now also persist each event to Postgres
(`reviewer_identity_shadow_log`) via a dedicated best-effort writer.

Files:

- `lib/db/migrations/026_reviewer_identity_shadow_log.sql` (+ manifest entry;
  fresh-install mirror in `scripts/setup-database.js` v36 block) — table,
  run/created indexes, and a partial index on
  `legacy_decision IS DISTINCT FROM works_decision` for delta-only reports.
- `lib/services/reviewer-identity-shadow-log.js` — sole writer. Whitelisted
  data-minimized scalars only; length-clamped; always resolves; circuit breaker
  (5 consecutive failures → 60s suspension); each awaited insert is capped at
  2 seconds.
- `lib/services/reviewer-identity-runtime.js` — integration seam only:
  Claude's logger commit connected the default
  `reportShadowComparison`/`reportShadowError` observers to the writer and
  minted one shared `crypto.randomUUID()` per batch. The later Codex integration
  preserved that observer contract while adding resolver-mode attribution and
  the explicit owner-gated combined path.
- `lib/services/maintenance-service.js` + `pages/api/cron/maintenance.js` —
  `cleanupReviewerIdentityShadowLog` (default 90-day retention via Dataverse
  setting `retention:reviewer_identity_shadow_log_days`, plus 200k hard row
  cap) wired into the daily cron; returns 0 on `42P01` so the unapplied
  migration produces no daily errors.
- Tests: `tests/unit/reviewer-identity-shadow-log.test.js` (writer contract,
  redaction whitelist, clamping, breaker, seam integration under storage
  outage) and additions to `tests/unit/reviewer-identity-runtime.test.js`
  (per-batch run-id sharing; a throwing durable logger cannot change the
  legacy result). The integrated focused suites pass 31/31.
- Docs: `docs/atlas/postgres-reviewer-identity-shadow-log.md`, Atlas registry
  row, service catalog entries.

## Invariants held (verify before extending)

- Logging is non-authoritative and best-effort; no application read path.
- Logger failure/timeout/storage outage never alters the reviewer decision.
  Normal inserts are awaited so a Vercel function cannot finish before the
  insert settles; the writer's 2-second deadline bounds that database latency
  in shadow or combined mode.
- No proposal content, names, email addresses, provider payloads, anchors, or
  secrets are stored — `candidate_key` is the runtime's existing 16-hex
  truncated SHA-256; error rows store `error_code` only, never messages. The
  candidate key is pseudonymous and dictionary-testable by anyone holding the
  roster; it is data-minimized personal data, not anonymous data.
- Bounded retention (90d default), row cap (200k), and value clamping (120
  chars) are all defined.

## Delta-only report

```sql
SELECT run_id, candidate_key, legacy_decision, works_decision,
       combined_decision, combined_reason, anchors_agree, created_at
FROM reviewer_identity_shadow_log
WHERE event_type = 'comparison'
  AND legacy_decision IS DISTINCT FROM works_decision
ORDER BY created_at DESC;
```

`candidate_key` is recomputable from a roster candidate
(SHA-256 of NFKC-lowercased `name|institution`, first 16 hex chars) to map
deltas back to candidates without storing raw names or institutions. The key
is pseudonymous, not anonymous.

## Deliberately not done

- Migration 026 is **not applied** to any database (`node
  scripts/apply-migrations.js` when the owner is ready).
- No environment variables were changed; unknown values still collapse to
  legacy. Code now recognizes explicit `combined`, but no deployed environment
  enables it.
- No W2 production cutover, migration apply, or production deploy.
