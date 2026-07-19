---
title: Reviewer Identity Shadow Logger — Handoff
domain: reviewer-identity
kind: runbook
status: active
summary: "Durable Postgres resolver-comparison logger deployed with migration 026 applied; combined-mode cutover remains disabled."
canonical: false
cataloged: 2026-07-19
owner: product-engineering
related:
  - docs/atlas/postgres-reviewer-identity-shadow-log.md
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
---

# Reviewer Identity Shadow Logger — Handoff

**Origin:** `claude/reviewer-identity-shadow-logger` (fresh from `origin/main`
at `7e8a8ced`), built 2026-07-19 by Claude and subsequently integrated and
hardened on `codex/w2-cutover-w4-evidence`.

**Production state `[VERIFIED 2026-07-19]`:** main merge `8e8a0cfa` landed
the runtime and reporting code on `main`. The canonical migration runner applied
`026_reviewer_identity_shadow_log.sql` as the only pending migration; the
tracker row, 12 columns, and four indexes were verified live. The initial row
count and one-day canonical report were both zero. No environment setting was
changed, so combined-mode cutover remains disabled.

**Integration history:** commit `908c6f32` was cherry-picked into
`codex/w2-cutover-w4-evidence` and the runtime seam returned to Codex. Codex
then made normal inserts awaited (while preserving the non-throwing result
contract), added resolver-mode attribution, and integrated the explicit
owner-gated combined path.

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
  the explicit owner-gated combined path. Comparison and error rows now both
  carry the pseudonymous candidate key, so a failed candidate remains
  attributable within a shared batch run.
- `lib/services/maintenance-service.js` + `pages/api/cron/maintenance.js` —
  `cleanupReviewerIdentityShadowLog` (default 90-day retention via Dataverse
  setting `retention:reviewer_identity_shadow_log_days`, plus 200k hard row
  cap) wired into the daily cron; returns 0 on `42P01` so a newly provisioned
  environment does not produce daily errors before its migrations run.
- Tests: `tests/unit/reviewer-identity-shadow-log.test.js` (writer contract,
  redaction whitelist, clamping, breaker, seam integration under storage
  outage) and additions to `tests/unit/reviewer-identity-runtime.test.js`
  (per-batch run-id sharing; a throwing durable logger cannot change the
  legacy result), plus direct retention/row-cap and report-contract coverage.
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

## Canonical report

```bash
node scripts/report-reviewer-identity-shadow-log.js
node scripts/report-reviewer-identity-shadow-log.js --run <run-id>
node scripts/report-reviewer-identity-shadow-log.js --mode combined --days 7
node scripts/report-reviewer-identity-shadow-log.js --all --json
```

The default report separates legacy-vs-works arm disagreements, authoritative
combined-mode outcomes, and errors. It includes every combined-mode row plus
shadow disagreements/errors; `--all` also includes shadow agreements.
`--run` scopes both the summary and transcript to that run. Every detail row
shows `resolver_mode` and candidate key, including errors.

`candidate_key` is recomputable from a roster candidate
(SHA-256 of NFKC-lowercased `name|institution`, first 16 hex chars) to map
deltas back to candidates without storing raw names or institutions. The key
is pseudonymous, not anonymous.

## Remaining production gate

- No environment variables were changed; unknown values still collapse to
  legacy. Code now recognizes explicit `combined`, but no deployed environment
  enables it.
- No W2 production cutover. Gather shadow observations before any separate
  owner-approved `REVIEWER_IDENTITY_RESOLVER_MODE=combined` change.
