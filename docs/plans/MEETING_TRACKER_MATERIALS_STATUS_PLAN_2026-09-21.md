---
title: Meeting Tracker materials status and filters
domain: workbench
kind: plan
status: active
summary: Built feature-branch materials status pills and scoped filters; Opus adversarial review passed, root hardening verified, production promotion remains separate.
owner: product-engineering
related:
  - docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
  - docs/plans/MATERIALS_EMAIL_PERSONALIZATION_PLAN_2026-09-20.md
---

# Meeting Tracker materials status and filters

## Decision and scope

[PLANNED; owner request 2026-09-20 PT] Help a program coordinator scan approximately 25 requests and identify the next materials task. Preserve the incumbent restrained design: neutral request cards, compact labeled status pills, adjacent counts/dates, and clickable status counts above the request list. The owner authorized implementation with “Build it.” Work proceeds on an isolated feature branch; production promotion remains a separate owner decision.

Root orchestrates and adjudicates. Luna performs reconnaissance and builds. Sol reviews Luna's work and requests bounded corrections. Root reviews the resulting diff and may take over fixes. Claude Opus performs the final independent adversarial review through the existing Claude CLI subscription/OAuth session; root adjudicates every finding. This is an ordinary requested model review, not authorization for Ultrareview or another metered review product.

## Evidence and contract surface

[VERIFIED via source on 2026-09-20 PT]
- `shared/components/meeting-tracker/MeetingTrackerList.js`, `MeetingTrackerRequestRow`: cards currently show the materials text inside the Site visit section, only when a visit exists. The list already has program, cycle and My/All scope controls.
- `shared/utils/site-visit-materials-line.js`: distinguishes ready, closed, invitation not sent, received awaiting confirmation, overdue and waiting. Other staff surfaces consume this text helper; this change must not inadvertently restyle them.
- `lib/services/site-visit-materials/collection-service.js`, `projectCollection` and `summarizeCollection`: closed/expired takes precedence over ready; received and required counts exclude waived/nonrequired items; overdue applies to missing items. All received is distinct from staff-confirmed ready.
- `lib/services/site-visit-materials/summary-reader.js`, `getMaterialsSummaryByRequests`: readiness off and read failures return null summaries, indistinguishable from a successful read finding no collection. The dashboard also catches failures into an empty map. These are current limitations, not evidence that nothing was requested.

Trace to preserve: existing authenticated dashboard request → authorized scoped request set → collection and document reads → projected summary → dashboard response → a single pure display classifier → row pills and filter counts. No new persistence, schema, email sends, upload behavior, reminder rules, permissions or workflow-state transitions are planned. Filter state is navigation/UI state only.

## Display classification

[PLANNED] Use the same classifier for rendering, counts and filtering. Evaluate in this order:

| Condition | Pill / category | Supporting detail |
|---|---|---|
| Read unavailable or malformed/unknown summary | Status unavailable, neutral with warning icon | Retry guidance; never infer absence or completion |
| Summary state closed | Closed, neutral | Retain received count; expired link is not Waiting |
| Summary state ready | Ready, green + check | Files checked |
| Existing nonterminal collection, invitation not sent | Not requested, gray | Invitation not sent; preserve distinction from no collection |
| Summary state received | Check files, amber | All required items received; staff confirmation remains |
| Missing items, invitation sent, overdue | Late, red | 2/3 received · Due Sep 16 |
| Missing items, invitation sent, not overdue | Waiting, blue | 1/3 received · Due Sep 25 |
| Successful read, no collection, visit exists | Not requested, gray | Request materials |
| Successful read, no collection, no visit | No visit, neutral | Schedule visit first |

An existing collection is shown even when its visit is absent; lack of a visit must not hide known materials status. Preserve the server's overdue decision rather than independently recomputing deadline/timezone semantics in the browser. A zero-required checklist must not say “0/0 received”; use “No required items” and preserve the existing confirmation state. Counts describe required, unwaived items, not every uploaded attachment.

Five normal filters are Not requested, Waiting, Late, Check files and Ready. Add Closed, No visit and Status unavailable only when present, so every loaded request belongs to exactly one category. All includes every request in the current authorized program/cycle/My-or-All scope. Never present unavailable rows as zero work.

## Interaction

[PLANNED]
- Give Materials a consistent visible position in every card; preserve scheduling, share state and meeting information. No full-card status tint or automatic reordering.
- Keep pill text short, counts and dates adjacent, and adequate contrast. Pair color with text and a small meaningful icon; use existing tokens and control conventions.
- Count filters use real buttons with selected state, keyboard focus and accessible names including counts. Pills are informational, not disguised buttons. Preserve current card links to the request's visit/materials controls; opening a status must never send an email or mutate readiness.
- Compute counts from the full loaded scope before applying the materials filter. Changing filters does not change totals. Keep the existing request order within each result.
- Reset materials filter to All when program, cycle or My/All scope changes. A filter that becomes empty after refresh shows a truthful empty result with an All action; never silently switch filters or show unrelated rows.
- Initial/load-transition state must not flash false zero counts or stale actionable cards. Reuse and verify existing stale-response guards.
- At narrow widths wrap filter controls and place progress text below the pill. No horizontal overflow or reliance on hover-only explanations.

## Implementation sequence and ownership

1. **Luna reconnaissance, Sol plan review, root adjudication.** Trace actual readers and summary consumers, current tests, scope changes and unavailable states. Resolve prerequisites before coding; record any material gaps.
2. **Luna build on `codex/meeting-tracker-materials-status` in an isolated checkout.** First add the narrowest backward-compatible summary-availability contract needed by this dashboard. Preserve the existing map-returning API for other consumers, preferably via a compatibility wrapper over one underlying read. No duplicate per-row fetches. Then add the pure display classifier, status component and client-side count filters.
3. **Luna focused verification, Sol review/iteration.** Test real producer-to-consumer behavior as well as classifier cases. Sol reviews correctness, accessibility, failure handling and scope. Luna fixes concrete findings and reruns affected tests. Sol gives an explicit verdict with evidence.
4. **Root final review.** Independently examine classifications, failure propagation, counts, stale-state behavior and visual evidence. Correct material issues directly if needed. Do not accept green tests whose fixtures bypass the changed producer.
5. **Claude Opus adversarial review.** Review the exact candidate commit/diff, plan invariants and verification evidence read-only. Focus on hidden states, unavailable-vs-absent data, incorrect totals, permissions, async races and regressions in sibling consumers. Use host-executed Claude CLI with verified OAuth; if unavailable, report the blocker without substituting a paid product or API key.
6. **Root adjudication and delivery.** Record accepted/refuted/deferred findings with reasons. Fix accepted blockers and recheck affected behavior; request a targeted second review only when a substantive change warrants it. Produce a no-send preview for owner inspection. Merge/deploy only on owner authorization, then verify exact production deployment and reconcile docs.

## Bounded reviews and escalation

One editor owns each file. Reviewers are read-only unless root explicitly hands over a fix. Sol returns severity, evidence and an actionable correction; preference-only polish is nonblocking unless it violates agreed design/accessibility requirements. Allow at most two Luna/Sol correction rounds before root takes over adjudication or implementation. Escalate sooner if the same finding repeats, requirements conflict, or an agent spends roughly 15 minutes without new evidence or a concrete change. This limits loops, not correctness: material defects remain blockers.

For visual verification use one desktop/mobile pass, one batched fix pass, and at most one confirmation pass. No broad redesign or unrelated cleanup. Root supplies concise progress updates and monitors agent status; do not leave a waiting reviewer or stalled build unattended.

## Acceptance and verification

[PLANNED]
- Table-driven tests cover every classification and precedence conflict: closed+ready, ready+old due date, received+past due, unsent+past due, absent collection, no visit, existing collection without visit, waived/zero-required items, unknown states and unavailable reads.
- Summary/dashboard integration tests distinguish successful absence from readiness-off, Postgres error, registry error and thrown dependency; legacy map consumers retain their existing contract. No contacts or contributor links added to summary payloads.
- UI tests use a mixed 25-request fixture: category counts sum to All, counts are independent of active materials filter, existing scope controls still constrain the source list, category changes do not reorder requests, empty filters remain truthful, and scope changes reset the filter without stale results.
- Keyboard/mobile/contrast and desktop visual check of mixed statuses. Test filtering and links with fake data; no actual invitations, reminders or production mutations.
- Run relevant existing materials summary, dashboard, tracker and sibling-consumer tests; lint/type/build checks and applicable API/Atlas/docs gates if those surfaces change. Gate/self-test pairs run sequentially. Finish with repository CI before release.
- Persist final source evidence, review findings/adjudication, tests and preview/release status without presenting planned work as shipped.

## Current status

[VERIFIED via committed source and local checks] Candidate `02b754ac` is built on `codex/meeting-tracker-materials-status`, not merged or deployed. Luna built the first pass and one correction batch. Sol cleared the final runtime after root fixed immediate scope invalidation and excessive pill live regions, removed the ambiguous legacy dashboard dependency adapter, and added independent producer-to-consumer and 25-request UI tests. Root also corrected the narrow-screen card header after desktop/mobile inspection. No live configuration, email or production data changed.

Verification: 100 focused tests; full local CI test command passed 1,053 suites / 15,542 tests. Webpack production build, scoped ESLint, types, API-route, route/service boundary, Dataverse DAL, Atlas, fact-consistency, documentation currency and catalog checks passed; applicable self-tests ran sequentially after gates. The existing three external-materials guard-recognition warnings remain unchanged. Browser inspection verified desktop filtering/order/counts and a 390px mobile viewport without horizontal overflow; the viewport override was reset afterward.

Reproduce the synthetic no-send browser preview with `node scripts/rehearse-meeting-materials-status.js` (default local port 3131). It bundles the actual tracker UI with synthetic networking and navigation, excluding the authenticated shell; it does not prove live authentication or external-service availability.

## Opus review and root adjudication — 2026-09-21

[VERIFIED via Claude CLI review result] The owner explicitly approved potential subscription usage/credits after the initial automatic approval rejection. The requested host-executed OAuth/subscription Claude Opus review then ran successfully. Review session `dbd378dc-551b-4bd4-9af4-d99ec8c1ca95` examined candidate `dd4c4d438` against `41f44da41` and returned **PASS**, with no blocking findings. It independently reran 71 focused tests; it did not rerun the earlier full suite. No API key or substitute metered review product was used.

Root accepted five low-severity suggestions and one informational navigation edge case in a single bounded correction batch:

| Finding | Adjudication and evidence |
|---|---|
| Missing availability defaulted to available | Accepted: classifier now defaults unavailable; row fixtures explicitly carry available. New classifier and rendered-list tests verify omitted availability cannot mean Not requested or Waiting. |
| Recovery copy suggested an absent retry control | Accepted: copy now says “Reload this page to refresh materials.” |
| No-collection-with-visit lacked next-step detail | Accepted: Not requested now has “Request materials.” supporting text. |
| Cycle discovery briefly rendered a false empty state | Accepted: keep loading while awaiting default-cycle navigation, and let the next scoped load settle it. A deferred-navigation test proves no false empty state and cancellation recovery. |
| Date assertion depended on machine timezone | Accepted: test derives its expected local date using the same locale/date contract. |
| One malformed row degrades the whole batch | No change: conservative complete-batch availability preserves the legacy reader contract. The partial-row failure integration test verifies it. |
| Scope navigation rejection could leave loading stuck | Accepted: catch rejection/cancellation, show recoverable error, and guard state changes by the current request generation. Tests cover both false-return and rejection cases. |
| Empty optional filter may disappear while selected | No change: preserve the explicitly selected filter and show a truthful empty result with Show all requests. Do not silently switch filters or misrepresent counts. |

After the hardening batch, 106 focused tests across eight suites passed, including the actual reader→dashboard→classifier contract and rendered filter behavior. Scoped ESLint/types and diff checks passed. These results supplement, rather than replace, the earlier full-suite/build evidence above. The local no-send rehearsal remains the owner review surface; authentication and live external services were not exercised by that synthetic harness. Production promotion remains a separate owner decision.

Sol independently re-reviewed the post-Opus hardening and returned READY. Root accepted that verdict. One nonblocking residual is retained deliberately: after a failed scope navigation, the controls retain the attempted scope while the URL retains the old scope; Try again loads the attempted scope directly. The page shows a recovery error, no previous-scope requests or false counts, and late navigation failures cannot overwrite a newer load. Further navigation/history refinement is outside this bounded change.
