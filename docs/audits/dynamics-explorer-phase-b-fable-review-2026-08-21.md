---
title: "Dynamics Explorer Phase B Fable Review — 2026-08-21"
domain: dataverse
kind: audit
status: complete
summary: "P0/P1-only adversarial review of the Phase B request telemetry plan."
canonical: false
cataloged: 2026-08-21
owner: product-engineering
related:
  - docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md
---

# Dynamics Explorer Phase B — Claude Fable Adversarial Review

## Scope

Read-only, OAuth-authenticated Claude Fable review. The brief excluded prose,
naming, optional enhancements, extra dashboards, low-value tests, and designs
that were merely different. Only P0/P1 correctness, lifecycle, security,
schema, retention, and user-regression findings could affect the verdict.

## Evidence Fable independently checked

- Explorer retention is 365 days for query logs and 90 days for usage logs.
- `LLMClient.stream` accepts an external abort signal and normalizes stop reason
  and refusal, while the Explorer wrapper does not yet pass that signal.
- Feedback can outlive request telemetry, so `ON DELETE SET NULL` is
  load-bearing.
- Non-unique request/round indexes and the absence of query/usage foreign keys
  create no correctness problem; multi-tool rounds require non-uniqueness on
  the query log, while fail-soft logging and different retention windows make
  parent enforcement unsafe for both logs.

## Material findings

### P1 — Disconnect abort could be classified as model error

The disconnect handler would abort `LLMClient.stream` and try to finalize
`client_disconnected`. The resulting abort rejection would also reach the
route's outer exception path and try to finalize `error`. The compare-and-set
guaranteed only one winner, not the correct winner, so ordinary disconnects
could contaminate the request failure metric.

Required correction: set a disconnect flag before abort; make the catch path
consult it and finalize the same `client_disconnected` value or no-op. Test a
disconnect during an in-flight model call.

### P1 — Non-null session ID contradicted the accepted request contract

The draft table required `session_id`, but the current route treats it as
optional and logs `sessionId || null`. A legal authenticated request without a
session ID would therefore fail the start insert and disappear from request
telemetry.

Required correction: either make session ID part of body validation or keep
the column nullable and define null-case feedback handling. The plan chose the
non-breaking nullable option and requires feedback correlation to remain null
when either session value is missing.

## Disposition

Initial verdict: **CHANGES REQUIRED**. Both P1 findings were incorporated into
the plan. Fable raised no other P0/P1 concern; optional observations were not
opened as work.

The one delta-only confirmation then returned **READY**. It confirmed that
setting `disconnectObserved` before abort and making both competing paths use
the same terminal outcome closes the classification race, and that nullable
session storage plus both-non-null matching removes the accepted-request
contradiction without weakening feedback ownership. The confirmation was
limited to the two original P1s and did not open new review surface.

`[ADVERSARIAL-REVIEW-RECEIPT: docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md]`
