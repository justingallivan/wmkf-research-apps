---
title: Reviewer Lifecycle — Remaining Work Readiness and Next Build
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Remaining reviewer lifecycle work

Assessment baseline: main `d614de5cf60baeaec8cf21ca8e4dd3c2489d2f7a`.
The owner selected **Stage 6B as the next build**, starting with **6B1**.
**Status update, 2026-09-05 (later sessions):** 6B1 (`9258115a`/`06725d6c`),
6B2 (`b08c16f6`/`d3ec406a`/`039d5d8e`) and 6B3 (`a6a27ce8`/`b163172a`, amended by 6B3a `3a4bcbbe`/`0a4eafd6` and 6B3b `9a790c64`/`529ee426` 6B3c `2622dfc7`, 6B3d `be76760f` and 6B3e `5b57991d`) are complete on
branch `codex/reviewer-lifecycle-stage6b` with independent PASS verdicts, not merged; see
the [Stage 6B1](REVIEWER_LIFECYCLE_STAGE6B1_RECEIPT_2026-09-05.md),
[Stage 6B2](REVIEWER_LIFECYCLE_STAGE6B2_RECEIPT_2026-09-05.md) and
[Stage 6B3](REVIEWER_LIFECYCLE_STAGE6B3_RECEIPT_2026-09-05.md) receipts. Stage 6B is
complete on the branch. Routing below that says the next agent starts a 6B slice is
historical; the next decision is promotion of the branch, and Stage 6C remains queued
behind that decision.
Use [the Stage 6B build plan](../REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md)
for the exact implementation contract, verification and review checkpoints.
Complete and freshly review each slice before starting the next dependent slice.
This document records readiness; it does not authorize the alternative structural
stages, Stage 6C extraction, live lifecycle writes, email, schema work or deployment.

## Established baseline and assessment limits

[VERIFIED via source and the recorded release receipt] Stages **0, 1A–1E and 6A
are shipped** through PR 149 / `c19a16d8`. Stage 1C confirmed receipt behavior
already present; it did not introduce another receipt implementation. The later
`d614de5c` handoff is documentation only. See the
[release scope and verification limits](REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md)
and [approved decisions](REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md).
This assessment did not repeat the release's GitHub, Vercel or browser probes.

The read-only assessment used CodeGraph, direct source/caller/test reads and the
bounded probes below. **Application tests, full build, gates and live APIs were
not rerun.** Existing test source demonstrates available regression machinery,
not a fresh passing receipt. Implementation must recheck HEAD and run its preflight.
No effort percentage is inferred from stage counts: Stage 3 alone contains many
different operations, and optional abstractions need not be implemented at all.

## Readiness matrix

“Ready first slice” means the behavior and execution prerequisites are concrete
enough to begin after ordinary preflight and authorization. It does not certify
the whole numbered stage or waive its tests, review, build or release requirements.

| Remaining unit | Design readiness | Source evidence, dependency and preserve-differences |
|---|---|---|
| **2 — narrow shared policy** | **Ready first slice; alternative, not next work.** Scope the remaining duplicates before claiming all of Stage 2. | Raw correction source/closed sets at `lib/services/reviewer-finder/my-candidates-service.js:51` and `lib/dataverse/adapters/reviewer-suggestion.js:77`; exact guards at service `:697` and adapter `:1890` passed the 30-case comparison below. Preserve raw/DTO separation, missing versus explicit null, completion markers and each caller's error contract. |
| **3 — closeout command pilot** | **Ready first slice; alternative, not next work.** | Auth/request binding already reaches `close-review-service.js:101` from `pages/api/review-manager/close-review.js:49`. Composed version/repeat/correction/invalid-input tests exist at `tests/integration/reviewer-engagement-contract.test.js:226`. The historical report sequences Stage 2 first, but this move has no hard technical dependency on a new policy module. Preserve original exports/error identity and prove both import paths reach the moved implementation. |
| **3 — command expansion** | **Defined, queued after pilot review and operation-specific proofs.** | Withdrawal/delete and release differ (`lib/services/review-manager/terminal-transition-service.js:95`); correction retains write → nonfatal token follow-up → person edits (`my-candidates-service.js:708`, `:729`, `:743`). Fixed expiry and post-send bookkeeping exist (`lib/services/reviewer-suggestion-sweep.js:124`; `lib/services/review-manager/send-emails-service.js:127`). Add the caller-boundary census before command two. |
| **3 — later writer details** | **One explicit compatibility decision before tightening; per-operation preflight otherwise.** | Legacy declined deselection supplies `suggestion._etag || undefined` (`lib/services/external-review/respond-service.js:256`); a selection-only update can remain unconditional (`reviewer-suggestion.js:1948`). Preserve that behavior during extraction or separately approve a missing-version policy. Reminder token/marker claims precede send (`lib/services/reviewer-reminder-sweep.js:399`); deadline persistence precedes notification (`lib/services/reviewer-due-extension.js:311`); pending-invite withdrawal differs from accepted withdrawal (`lib/services/review-manager/withdraw-sufficient-service.js:257`). |
| **4 — adapter decomposition** | **Optional; benefit not established.** | The historical plan requires demonstrated clarity/testability benefit, not a smaller facade. Existing source-parity tests parse the live reset definition (`tests/unit/reviewer-activity-history.test.js:308`). Preserve facade exports, nested gate coverage, payloads/projections, actor/version transport and leaf dependency direction. Skipping Stage 4 does not block Stage 5 or final boundary closure. |
| **5 — narrow document-pointer and thank-you operations** | **Ready first slice; alternative, not next work.** | Pointer conditional write/readback/retry is defined (`lib/services/review-documents/individual-file-service.js:652`); thank-you builds then claims then sends (`lib/services/reviewer-thankyou-sweep.js:58`). The real-adapter completed-review test covers both plus second-receipt rejection (`reviewer-engagement-contract.test.js:351`). These operations must remain legal after receipt/Complete. No dependency on the optional adapter split or receipt helper. |
| **5 — shared receipt-persistence helper** | **Optional; narrow input design required if selected.** | External legacy setVersion remains optional (`lib/services/external-review/submit-service.js:134`), staff version mandatory (`lib/services/review-manager/manual-review-entry-service.js:141`), no-file data partial/empty (`lib/services/review-manager/mark-received-no-file-service.js:81`), upload outcomes file-specific (`lib/services/review-upload.js:263`). Define receipt kind, allowed fields/snapshots, authorized version and error ownership; retain `lib/services/review-receipt-guard.js:32`. |
| **6B — asynchronous action safety in place** | **Ready first slice and chosen next build: 6B1.** Later slices follow fresh review. | Token regenerate/clipboard, revoke and remove at `ReviewerManagePanel.js:1743`, plus terminal action `:1960`, lack the status action's full context protection. Existing status operation ownership at `:1648` is a working local reference. The build plan orders 6B1 panel actions, 6B2 reminder/closeout, then 6B3 materials-release modal. |
| **6C — UI extraction** | **Defined, queued after 6B and frozen state ownership.** | `TokenActionsMenu` remains in `ReviewerManagePanel.js:229`; materials preview queue/session logic remains at `:528`. Preserve the original named export, keyboard/focus behavior, serialized queue, abort/timeout/SSE behavior and parent refresh ownership. No extraction is included in 6B. |
| **7 — close arbitrary bypasses** | **Queued after assigned Stage 3/5 writers migrate.** | Generic aliases are still live at `reviewer-suggestion.js:1370`; the census below is a lower bound. Narrow only after caller/descriptor/script coverage is complete. Keep legitimate specialized persistence operations and live compatibility wrappers. Stage 4 may be skipped. |

## Concrete Stage 6B routing

[PLANNED] **6B1** changes only the existing panel action ownership and feedback
needed for regenerate/clipboard, revoke, remove and terminal transitions, plus
their focused tests. Follow the build plan's exact same-reviewer pending contract.
Keep confirmed writes distinct from refresh or clipboard failures; never replay
server mutations to recover UI feedback. Preserve the shipped status handler.

[PLANNED] **6B2** follows a fresh 6B1 review: reminder action and closeout modal.
`ReviewReminderAction` has mount/send-generation checks but no full prop-context
binding (`ReviewerManagePanel.js:126`); closeout initializes fields once and only
invalidates generation at unmount (`ReviewerCloseoutModal.js:41`). Cover changed
reviewer/request/permissions while mounted, close/reopen and every post-await path.

[PLANNED] **6B3** follows a fresh 6B2 review: materials-release modal context.
[PLANNED, owner-queued 2026-09-05] **6D** server-side draft fingerprint (render returns, send verifies; refuses stale drafts) — closes the co-investigator and unrefetched-edit gaps the client key cannot; contract change, separately planned. See the build plan status section.
Its session currently changes on `isOpen` (`ReviewerManagePanel.js:531`), while
proposal loading separately reacts to request changes (`:669`). Preserve queue
serialization, abort/timeout and SSE completion while binding preview/send and
template/upload results to the relevant context. Do not replace existing guards
with a less specific universal action abstraction.

The Workbench keys the reviewer subtree by request id
(`pages/workbench/[requestId].js:181`). This is a real disconfirming boundary:
ordinary request navigation remounts children, so source-supported mounted-prop
races are not a claim that every navigation currently leaks stale feedback.
Tests must deliberately retain a mounted component while its relevant props change.

## Bounded evidence and disconfirming checks

**Pure-policy comparison — VERIFIED via read-only source evaluation.** A Node
`vm` probe read the actual correction sets and closed/source condition expressions
from the candidate service and adapter, resolving their current canonical maps.
Both sets were equal and all **30 comparisons** agreed. Inputs were missing,
explicit null, all seven numeric review statuses, unknown numeric status, raw
string status, DTO-only status, mixed raw/DTO fields, each with/without a raw
completion marker. Missing/unknown/DTO-only status remained unavailable; explicit
raw null remained open. Raw null plus DTO Complete remained raw-open. This proves
only the narrow raw-state classification; it does not equate error classes,
request authorization, ETags, receipt eligibility or the display projection.
`shared/utils/reviewer-engagement.js:6` deliberately merges aliases for display
and must not silently replace raw-row authorization.

**Imported generic-call census — VERIFIED via bounded inventory output.** The
parallel read-only assessment called
`require('./scripts/inventory-reviewer-lifecycle-writers.js').inventory()`.
It scanned **1,282 tracked source files** and reported **19 imported generic
calls: 13 updateLifecycle, 2 patchFields, 4 patchReviewReceipt**, with no reported
parse errors or unresolved recognized bindings. This is not “19 total writers.”
The script explicitly excludes a complete account of raw descriptors, internal
adapter calls, forwarded callbacks and REST writers; it is file-local and not
scope-sensitive (`scripts/inventory-reviewer-lifecycle-writers.js:5`). Internal
bulk metadata still calls updateLifecycle (`reviewer-suggestion.js:2294`), and
the administrative backfill remains a caller (`scripts/backfill-postgres-to-dataverse.js:243`).
Stage 7 needs the broader alias/descriptor/raw-field/script census and a gate
whose positive fixtures would actually write if its rejection rule were removed.

**Existing composed regression source.** The six receipt variants at
`tests/integration/reviewer-engagement-contract.test.js:133` traverse real
services/adapter/HTTP serialization → DTO → closeout and seed a linked honorarium
that must remain unchanged (`:148`). The completed-review pointer/thank-you
case at `:351` checks exact narrow payloads, unchanged answers and refusal of
another receipt. These are available prerequisites, not newly executed tests.

## Historical-plan corrections and durable scope

The [original investigation](REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md)
remains a frozen historical baseline. Its Stage 3 instruction to preserve batch
behavior until Stage 6 must now preserve the **shipped 6A** result arrays,
`ReviewerStatusMutationError` and sequential stop-on-first-failure semantics
(`lib/services/review-manager/reviewers-service.js:469`, `:499`). Do not restore
the earlier count/error-only contract or reopen the resolved receipt/correction
product decisions. No historical backfill or new schema is part of these moves.

Contract-reconcile Mode A covered relevant caller/persistence/consumer, partial
success, stale state, extraction and field-consumer boundaries. New persistence
audit: N/A. Sweep Mode A covers the changed **next-build routing fact**; the
parent handoff owns the build plan, live routing restatements and documentation
gates. This bounded audit alone does not certify whole-repository reconciliation.
Source-backed alternatives remain buildable, but **the next agent starts 6B1**.
