---
title: Reviewer acceptance defaults — implementation verification
domain: reviewers
kind: audit
status: active
summary: "Branch implementation under verification and independent code review; exact-owner defaults, combined discard warnings and recoverable preclaim preparation. Not released; no live database/email operation."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_ACCEPTANCE_DEFAULTS_PLAN_2026-10-26.md
---

# Implementation evidence — 2026-10-26

Owner: Codex; branch codex/reviewer-acceptance-defaults, isolated existing worktree.
User authorized the reviewed implementation/tests and ordinary independent Claude
code review; no release. Main's committed corpus/database/report changes were
merged unchanged. No other checkout or database touched. Existing schema and
lease SQL are unchanged; no migration, loader, env edit, live preference mutation,
real cron invocation or outbound email performed.

## Guardrail invariants

| Invariant | Files | Verification |
| --- | --- | --- |
| Exact authenticated owner, strict persistence/readback | Family route/service/config, generic privacy sets | Auth, route, validator, strict preference and alias tests |
| Unreadable/unsafe copy cannot consume claim | Sender preparation and drain | Refusal→repair, changed context and preclaim cancellation tests |
| Claimed confirmation never automatically resends | Existing job-store lease token, drain | Real scratch Postgres replacement-worker test and ambiguous/lost-receipt tests |
| Two editors retain one discard guard | Profile Settings, controllers, page guard | Actual page/unit tests and production-mode fixture browser tests |
| Owner policies O1/O2 preserved | Subject renderer and sender resolution | Subject-only substitution normalization and sender-lookup retry/fallback tests |

## Scope and residual limits

Fresh confirmation suggestion/request checks bind recipient/due date/request to
preparation and compare them immediately before claiming. Current PD/copy are a
bounded snapshot, not an atomic cross-system reassignment transaction. Existing
signature lookup independently re-reads request/PD and keeps its fallback policy.
Nonempty unreadable encrypted token refuses before claim; missing token retains
historical no-link behavior. Shared legacy token grammar remains compatible;
final rendered safety applies to both copy sources. Required shared configuration
remains a prerequisite even with own copy.

Preparation refusals use eight total job attempts (including consumed sibling
attempts), nominal ~42 minutes from first refusal under two-minute cron cadence,
longer with slow passes/backlog. No staff requeue tool is claimed. Terminal
unclaimed jobs alert staff to verify current acceptance/eligibility before manual
sending. Postclaim failures never generate a manual-send recommendation.

Preparation alert keys are per job, with explicit operational-event opt-in.
Cancellation observed by this drain marks events superseded before autoResolve;
external cancellation writers may leave stale preparation alerts. This is a
retained bounded limit. Claims settle preparation failure, independently of the
later send outcome. Other contact/honorarium/BILL behavior stays unchanged.

Save/Clear across tabs has no new transactional uniqueness; strict duplicate
reads pause sending until explicit repair. Scope epochs ignore old UI responses;
confirmed/uncertain writes retain explicit Reload barriers. One page-level guard
owns Back/route/unload; thank-you clean-read warning behavior is retained.

## Verification and review

[VERIFIED via root-run checks.] 18 focused suites / 415 mocked tests passed;
three real scratch-Postgres cases passed, including replacement-lease overlap
and finite-attempt exhaustion. Fifteen Chromium cases passed against a fresh
production build (nine acceptance, six existing thank-you). Desktop screenshot
inspected. All APIs/external traffic were intercepted in browser fixtures.
Types passed; lint 0 errors / 195 warnings (three new hook warnings). Scoped
API/Atlas/DAL/context/route-service/lifecycle/GUID/status gates and their self-tests
passed sequentially; migration manifest passed read-only. API count is 317,
requireAppAccess count unchanged. Final doc/secret checks run before closeout.

Discriminating regression: actual prior sender source from a9e9b4de6 failed the
O2 lookup-refusal test; actual prior drain source failed the preclaim refusal/
repair test by completing rather than leaving recovery retryable. Both source
files were restored byte-for-byte in finally; both tests then passed. No
experimental code remains. No live database or transport was involved.

Ordinary OAuth Claude independent source/test review pending; exact code target
and verbatim receipt will be recorded before completion. Mocked tests are distinct from scratch
Postgres and fixture-only browser results. No live inbox/tenant acceptance claimed.
