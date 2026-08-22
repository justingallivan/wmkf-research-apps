# Session 452 Prompt: Site Visit Handoff Smoke Completed

## Session 451 Summary

Session 451 completed and production-proved the reviewer email-conflict
self-service and existing-request context, shipped Dynamics Explorer Phases A
and B, closed the Track A Log Drain safety watch, and verified the rotated Log
Drain signature after the saved drain configuration resumed successful webhook
deliveries. The owner set one explicit next-session priority: run the controlled
Site Visit handoff smoke first.

### What Was Completed

1. **Routine reviewer email conflicts became Production-live staff self-service.**
   - Reader compatibility landed in `f59dcff`; runtime/UI/tests landed in
     `e8c90f5` on `codex/reviewer-email-conflict-self-service`.
   - An email-only conflict shows **Review email choice**. A combined identity
     and email conflict shows one primary **Review and confirm** action rather
     than separate email and identity controls. Both paths require an explicit
     **Keep stored** or **Replace with found** selection against a fresh
     server-read tuple, record
     `staff_address_choice` with a non-null ETag-guarded resolution, and makes
     that exact choice invite-ready without a second acknowledgement.
   - Duplicate-owner, inactive-person, and Contact-linkage states identify the
     AkoyaGO record and expose a working **Retry record check** action. Find no
     longer links staff to Admin.
   - Canonical success best-effort auto-resolves server-correlated legacy alerts
     using their persisted keys. A read-only Postgres probe found one active and
     three resolved rows, all with request/candidate correlation and stored
     keys, so compatibility readers were retained and no rows were mutated.
   - The card no longer renders the internal open-alert state as **Repair
     request pending**. A signed-in Production smoke on Neville Sanjana verified
     one explanation, **Review and confirm**, and **Not a fit**; the separate
     **Review email choice**, **Confirm identity**, and pending-repair controls
     were absent. The action was not clicked and no Dataverse write was made.
   - [VERIFIED via source, 1,778 reviewer tests, typecheck, Vercel Turbopack
     build, read-only Postgres probe, and signed-in Production UI smoke on
     2026-08-20. Production deployment `dpl_9yZ9xTHqfNgLcbZxJDekZkAjqpPS` is
     Ready; card simplification commit `5c9c399d`.]

2. **Reviewer repair alerts had previously become actionable from Admin.**
   - PR #128 (`e74d1124`) added a bounded, server-re-read repair context,
     current address/conflict evidence, an explicit closeout sequence, and
     deep links back to the exact Find or Invite surface.
   - PR #129 (`8b61be8d`) aligned that Admin guidance with the actions the
     destination card actually exposes.

3. **Open repair requests remain internal compatibility state.**
   - PR #132 (`be21c450`) historically established the Production baseline
     **Repair request pending · View in Admin**. The current feature branch
     retains the alert projection for deduplication but renders no pending-alert
     control on the card. It shows **Review email choice** for email-only cases,
     or one **Review and confirm** action for combined identity/email cases.
   - Identity-only cases retain **Confirm identity**. A resolved alert no longer
     suppresses a later request if the underlying block persists.
   - Alert-status lookup is fail-soft for roster availability but fail-closed
     for duplicate creation. Creation is transactionally deduplicated under a
     request/candidate-scoped advisory lock, including concurrent calls with
     different reason codes.
   - PR #132 passed all eight required CI/review/security/deployment checks and
     was production-deployed. The public Production auth boundary returned the
     expected sign-in redirect and successful sign-in page response.

4. **Dynamics Explorer behavior campaign docs landed from Claude's isolated worktree.**
   - PR #130 (`7805b27f`) added the campaign plan, read-only analysis/probe
     tooling, and durable SoCal field findings.
   - PR #131 (`8d29e8b1`) recorded Session 449 and created the prior Session
     450 prompt. The Claude worktree was stopped and removed before the
     reviewer branch was promoted.

5. **Production Log Drain activation was reconciled.**
   - [VERIFIED via read-only `operational_events` aggregate, 2026-08-20] The
     initial activation probe found 45 `vercel-drain` rows, first seen
     `2026-08-19T21:21:58.177Z` and last seen
     `2026-08-20T20:33:58.144Z`; all rows in the 72-hour aggregate were
     resolved. The canonical runbook was corrected from “not activated” to
     LIVE.
   - That probe established activation only. Item 8 records the later
     platform/cost/sample closeout rather than treating the 45-row failure
     subset as a whole-stream measurement.

6. **Dynamics Explorer Phase A is Production-live.**
   - Interactive Explorer calls now use a 16,000-token response ceiling and
     `outputConfig: { effort: 'low' }`; the shared `LLMClient` converts that to
     Anthropic `output_config` only for reviewed effort-capable models. The
     separate export batch remains at 4,096.
   - Completed unary and streaming calls pass normalized `stopReason` into the
     existing best-effort `api_usage_log` row. Fresh-install schema plus
     migration `032_api_usage_stop_reason.sql` add the nullable column.
   - Focused and expanded verification passed: 123 Explorer/LLM tests,
     typecheck, migration/Atlas/model/API-route/route-boundary gates and their
     applicable self-tests, docs/fact/wiki gates, and a Next.js webpack
     production build.
   - Migration 032 applied at `2026-08-21T16:43:26.023Z`; exact readback
     verified nullable `character varying(50)` `api_usage_log.stop_reason` and
     the migration tracker row.
   - Commit `9a54620d` deployed Ready as
     `dpl_4d2fQegMKrZAnf6sHu9GsJ5QeqU8` and owns the Production aliases. The
     public Explorer route/auth boundary passed in both available browser
     surfaces. After owner authentication, “What tables are available?”
     completed in two read-only rounds. Immediate Production Postgres readback
   found successful usage rows 5354/5355 with non-null `tool_use` and
   `end_turn` stop reasons, 27/545 output tokens, and 1.851s/4.970s latency.

7. **Dynamics Explorer Phase B request telemetry is Production-live.**
   - Migration 033 plus fresh-install parity define one
     `dynamics_explorer_requests` lifecycle row per authenticated, body-valid
     request and nullable request/round correlation on query and usage logs;
     feedback adds an optional `ON DELETE SET NULL` request link.
   - The chat route awaits fail-soft start/finalize writes, classifies completed,
     truncated, refused, max-round, error, and client-disconnected outcomes,
     and marks disconnect before abort so a rejection cannot race to `error`.
   - The browser returns the server request ID with successful assistant
     messages. Feedback persists it only after authenticated-profile ownership
     and exact non-null session verification; mismatch/outage remains a valid
     uncorrelated feedback row.
   - Daily maintenance retains lifecycle rows for 365 days; the aggregate-only
     analysis probe reports monthly outcomes, derived abandonment, rounds, and
     correlation completeness. Focused cross-layer tests and typecheck pass.
   - One OAuth-authenticated read-only Claude Fable implementation review traced
     caller→persistence→consumer and returned READY with no P0/P1 finding. Per
     owner direction, no minor-point review loop was opened.
   - Commit `ea125997` deployed Ready as
     `dpl_4gAA5BU626uGeDBTzF9fSTHYD7Z3`. Migration 033 applied transactionally
     at `2026-08-21T20:40:02.139Z`; tracker, lifecycle/correlation columns,
     indexes, and constraints matched the source contract on readback.
   - The signed-in read-only question “How many proposals are there?” returned
     16,305 after two rounds. Request
     `84aee86d-9c89-4434-9642-47ee6ccb4141` persisted `completed` / `end_turn`,
     one round-1 query row, two usage rows across rounds 1–2, and no feedback
     row. No Dataverse write was performed. The aggregate probe independently
     reported one completed August request, p90 rounds of 2, and complete
     observed query/usage correlation.

8. **Track A passive-safety observation is closed.**
   - [VERIFIED 2026-08-21 via Vercel Drains API/dashboard and Usage] The drain
     is enabled for only this project, Production Functions/Edge Functions,
     and 100% sampling except its own webhook. Its first approximately 48
     hours carried 577.7 MB for $0.29.
   - A cap-complete five-minute control contained 11 unique valid dependency
     events with no malformed/invalid event and no unexpected dependency or
     operation classification. A read-only Postgres probe found 61 unique
     selected failure rows, all resolved, with no critical rows or crashes.
   - Exact historical daily-line and platform-throttling counts are not
     claimed because this Pro account lacks Observability Plus aggregate
     metrics and the durable sink intentionally retains failures only. That
     limitation is closed rather than spawning a new sampler/table solely to
     satisfy the old measurement recipe.

9. **The controlled Production Site Visit handoff smoke passed.**
   - The owner explicitly approved Production Request `1002379` before the
     durable action. The signed-in Workbench promoted the exact current
     Pre-Site Word workspace from Draft to Review and displayed **Site Visit in
     progress** with handoff time `8/21/2026, 5:22:36 PM`.
   - The Site Visit and Pre-Site tabs retained the same exact filename and
     SharePoint Edit/Download URL. A fresh page load independently returned the
     Review state and timestamp; the Pre-Site tab removed regeneration and
     identified the document as the Site Visit workspace.
   - The transition service returns success only after its post-write reread
     matches the exact SharePoint publication version, governed content hash,
     and non-null milestone time. The browser did not print those opaque values,
     so this evidence relies on that enforced service readback plus the fresh
     authenticated GET, not a separate direct Production Dataverse probe.
   - The broader Site Visit dossier/logistics and Final copy transaction remain
     later slices. [VERIFIED via signed-in Production Workbench, same-item links,
     fresh authenticated GET, and source-enforced post-write readback on
     2026-08-21.]
   - The nonexistent former domain was also removed from every tracked
     source/doc/test reference and replaced with the established `wmkeck.org`
     domain where an example or live app URL was intended. Commit `ec8ed1f`;
     zero remaining literal matches, focused tests and documentation gates green.

10. **The post-handoff receipt is Production-deployed.**
   - Commit `b3bb0ef6` is on `main`; Vercel deployment
     `dpl_FkWu55fyBqSEo8q4DBcdcA3xvigi` is Ready with the Production aliases.
   - Pre-Site Edit, Download, filename, and Regenerate controls are Draft-only.
     Review is a read-only receipt with one Site Visit continuation action and
     visible warning checklist; later, unknown, and missing-link states fail
     closed with an explanation.
   - The focused component suite passed 23 tests, the Webpack production build
     passed, and two read-only Claude Opus reviews returned APPROVE with no
     actionable defects. The public Workbench route redirected successfully to
     the Production sign-in page. A signed-in post-release receipt smoke remains
     open and no durable business write was performed for release verification.

### Commits

- `997de04d` - feat(admin): guide reviewer repair alert resolution
- `e74d1124` - Merge PR #128
- `707a719b` - fix(admin): align reviewer repair guidance with card actions
- `8b61be8d` - Merge PR #129
- `1876b2fc` - Draft Dynamics Explorer behavior campaign plan
- `7805b27f` - Merge PR #130
- `558740d4` - Document Session 449 and create Session 450 prompt
- `8d29e8b1` - Merge PR #131
- `9fbc4e1e` - fix(reviewers): show pending repair requests
- `be21c450` - Merge PR #132
- `f59dcff` - feat(reviewers): read staff email choices safely
- `e8c90f5` - feat(reviewers): resolve email conflicts in workbench
- `1c3545f` - docs(reviewers): reconcile email self-service contract
- `0e9b25f` - chore(vercel): exclude local codegraph state
- `ba5a22f` - fix(reviewers): expose combined email choice
- `9a54620d` - feat(dynamics-explorer): tune interactive model posture
- `1b552cae` - docs(dynamics-explorer): plan request telemetry
- `ea125997` - feat(dynamics-explorer): add request telemetry
- `dfc3e2a4` - docs(dynamics-explorer): record Phase B production release
- `9016c3bf` - docs(reviewers): plan existing record request context
- `e15846c1` - feat(reviewers): show existing request context on find cards
- `8c2fa489` - fix(reviewers): bound prior request context correctly
- `561ec242` - docs(observability): close Track A safety watch
- `ec8ed1f` - docs(domains): remove nonexistent former-domain references
- `bd9dc06` - fix(workbench): harden site visit handoff receipt
- `b3bb0ef6` - fix(workbench): clarify read-only handoff states

## Next Items

### Verified Open

1. **Observe Explorer campaign Phase B over normal use.**
   Evidence: `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`. Deployment,
   migration, exact schema/tracker readback, and one joined signed-in smoke are
   complete. Next: let organic staff requests accumulate, then run the
   aggregate probe to inspect outcome/round distribution and correlation
   completeness. Do not manufacture feedback or request traffic.

2. **Observe Explorer campaign Phase A over normal use.**
   Evidence: `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` Phase A
   implementation report. Migration, deployment, and a signed-in two-round
   smoke are complete; usage rows proved both `tool_use` and `end_turn`
   persistence. The subsequent observation window should check stop-reason
   distribution, output-at-cap events, and round latency against the prior
   6.5-second Sonnet average.

3. **Observe Stage II Production outcomes through 2026-09-02.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` exact-on
   Production state and organic-observation window. Do not manufacture shared
   roster rows.

### Blocked on External Input

1. **Explorer campaign Phases C-D (eval seeds and vernacular rubric).**
   Evidence: campaign plan Section 4. Blocked on 10-20 real SoCal questions
   and answers about population-served and `_socal` program-area usage. Phase B
   telemetry is not blocked and is most valuable before behavior changes.

### Owner Decision Needed

1. **After 2026-09-02, retain or remove the Stage II rollout flag.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Re-probe
   live environment and replacement deployment state before changing it.

### Parked

1. `NEXTAUTH_SECRET` rotation and Vercel Sensitive conversion — reopen only
   with a coordinated session-invalidation window.
2. Reviewer multipart direct-upload conversion — complete consumer discovery
   and obtain an owner decision first.
3. Stage III institution identity authority — blocked until the
   execution-point contract exists.
4. Site Visit dossier/logistics and Final copy transaction.

### Verify Before Acting

1. Production Dataverse reads are owner-run. Never set
   `DATAVERSE_ALLOW_PROD_READS` yourself.
2. `dynamics_query_log.record_count` rows before 2026-08-08 have broken
   semantics; never trend across that boundary.
3. `compactMessages` clearing earlier `tool_use.input` while thinking blocks
   remain is [ASSUMED] safe and untested with a thinking model; pin it in the
   Phase C harness before relying on it.
4. Active/acknowledged repair alerts suppress duplicate creation; resolved
   alerts do not. Re-read live state before changing an alert status.
5. Track A is closed with bounded platform, cost, sample, and durable-failure
   evidence. Do not reinterpret its selected `vercel-drain` rows as a complete
   dependency-event export or claim an exact historical daily line count.

### Do Not Reopen Without New Decision

1. Asker-profile-based program biasing in the Explorer — the owner chose a
   program-neutral rubric on 2026-08-20.
2. Round-exhaustion changes such as raising `MAX_TOOL_ROUNDS` without new
   post-telemetry evidence.
3. Multipart fallback, Stage III activation on the 25-case benchmark, a
   separate Site Visit memo, Vercel CLI reminders, direct-upload smoke, and
   Phase II display smoke.

## Key Files Reference

| File | Purpose |
|---|---|
| `shared/components/workbench/SiteVisitTab.js` | Signed-in handoff action, confirmation, and same-item Site Visit workspace UI |
| `pages/api/workbench/pre-site-visit/start-site-visit.js` | Authenticated exact-body route for the guarded handoff |
| `lib/services/pre-site-visit/site-visit-transition-service.js` | Draft→Review transition, stable SharePoint evidence, ETag fence, and milestone persistence |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Handoff contract and controlled-smoke acceptance evidence |
| `shared/components/reviewers/ReviewerSearchSection.js` | One primary card action, direct email choice, structural retry, and internal pending-alert compatibility |
| `shared/components/reviewers/CandidateEditModal.js` | Explicit Keep stored / Replace with found dialog |
| `pages/api/workbench/reviewer-roster.js` | Roster projection of open repair alerts |
| `lib/services/reviewer-address-trust-service.js` | Fresh pair validation, ETag resolution, structural retry, and alert closeout |
| `lib/services/alert-service.js` | Transactional open-alert deduplication |
| `docs/REVIEWER_EMAIL_CONFLICT_SELF_SERVICE_PLAN.md` | Implemented source contract and sweep evidence |
| `docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md` | Reviewer address trust and retained alert compatibility |
| `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md` | Live drain/runbook and durable-event selection contract |
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | Track A criteria |
| `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` | Explorer campaign; Phase A Production-live and signed-in-smoked, longer observation pending |
| `.claude-memory/project-dynamics-explorer-socal-campaign.md` | Owner decisions and field-probe findings |

## Testing

The merged reviewer implementation passes 128 reviewer suites / 1,779 tests,
typecheck, and a Vercel Turbopack production build. Deployment
`dpl_9yZ9xTHqfNgLcbZxJDekZkAjqpPS` is Ready and owns the Production aliases.
The signed-in Production smoke verified Neville's simplified card without
clicking its action; it did not select an address, mutate Dataverse, or prove
the live write path. The earlier deployment's dialog smoke through neutral
Cancel remains the evidence for the rendered exact-choice modal.

The post-deploy smoke observed two Dataverse no-response timeouts at the shared
30-second boundary (`/api/workbench/dashboard` and `resolve-request`) while the
owner was also having trouble in AkoyaGO. A direct read-only Dataverse request
then succeeded in 766 ms and the same Production dashboard recovered without a
browser error. Treat this as a transient upstream availability incident, not a
clean-error-window claim or evidence of a UI regression.

The Session 450 claim-evidence pilot report was unavailable because its local
observation state could not be read. No observation row was added.

Explorer Phase A separately passed 123 focused/expanded tests, typecheck, the
relevant migration/data/model/route/docs gates and self-tests, and a Next.js
webpack production build. Migration 032 is applied and read back in Production;
commit `9a54620d` is Ready on the Production aliases, and the public auth
boundary passed. A signed-in two-round Explorer smoke succeeded and exact
Production usage rows proved `tool_use`/`end_turn` persistence. Only the longer
production observation window remains unverified.

Explorer Phase B passed 121 focused cross-layer tests, typecheck, the relevant
migration/data/model/route/docs gates and self-tests, a Next.js webpack build,
and one P0/P1-only Claude Fable implementation review with verdict READY.
Commit `ea125997` is Ready in Production as
`dpl_4gAA5BU626uGeDBTzF9fSTHYD7Z3`; migration 033 and its exact schema contract
were read back, and the signed-in two-round request
`84aee86d-9c89-4434-9642-47ee6ccb4141` proved lifecycle/query/usage
correlation. Organic observation is the remaining Phase B evidence item.
