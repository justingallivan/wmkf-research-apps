---
title: Reviewer acceptance defaults — implementation verification
domain: reviewers
kind: audit
status: active
summary: "Historical pre-release implementation/contract evidence; subsequently released PR534 at8b02e8467 on2026-10-26 after CI passed. Production verification is in the linked release receipt; retained limitations still apply."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_ACCEPTANCE_DEFAULTS_PLAN_2026-10-26.md
---

# Implementation evidence — 2026-10-26

[CURRENT RELEASE VERIFIED 2026-10-26.] PR #534 merged8b02e8467 after all CI
passed; Production READY. [Release verification](REVIEWER_ACCEPTANCE_DEFAULTS_RELEASE_2026-10-26.md).
The body below is historical pre-release evidence/contract; its not-released and
authorization labels describe that recorded stage. Current release proof and
verification limits are in the linked receipt.


Owner: Codex; branch codex/reviewer-acceptance-defaults, isolated existing worktree.
Implementation target `2ff4e861e42c5225e2def34ca85d38fc9c6e6060`, draft
[PR #534](https://github.com/justingallivan/wmkf-research-apps/pull/534).
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

[VERIFIED via root-run checks.] 18 focused suites / 421 mocked tests passed;
three real scratch-Postgres cases passed, including replacement-lease overlap
and finite-attempt exhaustion. Fifteen Chromium cases passed against a fresh
production build (nine acceptance, six existing thank-you). Desktop screenshot
inspected. All APIs/external traffic were intercepted in browser fixtures.
Final rerun on the committed target also passed all three scratch-Postgres and
15 Chromium cases with a fresh production build. Types passed; lint 0 errors / 195 warnings (three new hook warnings). Scoped
API/Atlas/DAL/context/route-service/lifecycle/GUID/status gates and their self-tests
passed sequentially; migration manifest passed read-only. API count is 317,
requireAppAccess count unchanged. Final doc/secret gates and self-tests passed before closeout.

Discriminating regression: actual prior sender source from a9e9b4de6 failed the
O2 lookup-refusal test; actual prior drain source failed the preclaim refusal/
repair test by completing rather than leaving recovery retryable. Both source
files were restored byte-for-byte in finally; both tests then passed. No
experimental code remains. No live database or transport was involved.

Ordinary OAuth Claude initial whole-flow code review PASS WITH NONBLOCKING NOTES
at 2ff4e861e; targeted follow-up PASS at
`0ac9ce254e859cb1f005395a66c264a59703896f`. Verbatim receipts linked below. Mocked tests are distinct from scratch
Postgres and fixture-only browser results. No live inbox/tenant acceptance claimed.

## Initial independent review and bounded corrections

Claude PASS WITH NONBLOCKING NOTES at 2ff4e861e, no blocking finding. Verbatim:
`docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_IMPLEMENTATION_CLAUDE_REVIEW_2026-10-26.md`.
Six additional tests close N1's planned test gaps; existing real-helper and unknown-
receipt tests now explicitly assert claim→transport→sent ordering/no uncertain
alert and the uncertain outcome respectively. N5's wrong family header corrected.
No runtime behavior change. Targeted rereview PASS, all N1 and N5 closed.

Retained nonblocking notes: body-preservation proof uses the public HTML output;
a terminal job can leave both preparation and terminal alerts open; a confirmed
context change during an uncertain write can prompt again until Reload, as the
existing thank-you behavior does. Placeholder cascading predates this slice.
The zero-claim external-cancellation test documents a scope limit rather than
proving automatic alert settlement (none is claimed).

## Final closeout

[VERIFIED via source, root-run tests/gates and independent Claude receipts.]
Final source/test target `0ac9ce254`; 421 tests / 18 suites and types passed.
Original runtime target 2ff4e861e passed all three real PG16 and fifteen Chromium
cases against a fresh production build; the only runtime delta is a header
comment (verified by git diff). No runtime/test change after final review.
The test-owned codex-acceptance-defaults-pg container/schema was removed; the
pre-existing database container remains untouched. No shared DB or tenant write.

Final independent report:
`docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_IMPLEMENTATION_CLAUDE_REREVIEW_2026-10-26.md`.
Code review does not replace final CI/release approval. Draft PR #534, not merged
or deployed to Production. Preview/CI status is available on the PR.

Contract-reconcile Mode B: caller/persistence/consumer, partial success and
post-await scope guards, helper preservation, durable doc surfaces, key/status
fan-out and complements are covered above and in the independent reviews.
Schema/manifest changes N/A; migrations were not applied outside the owned test
schema. Bounded sweep updated current route/Atlas/service/count/slice records;
historical plan and initial review receipts remain explicitly historical.
