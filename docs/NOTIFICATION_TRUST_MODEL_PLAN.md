---
title: NotificationService Trust-Model Push-Up Plan
domain: architecture
kind: plan
status: draft
summary: "Push withDalContext establishment for notify()'s email branch up to real entry points across its caller fan-out (site 33, deferred from Stage 4)."
canonical: true
owner: product-engineering
related:
  - docs/BYPASS_STRIP_PLAN.md
  - docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/CI_GATES_REFERENCE.md
---

# NotificationService Trust-Model Push-Up Plan

**Execution status: DRAFTED, NOT EXECUTED, NOT REVIEWED (2026-07-05).** This is the site-33 follow-on
the owner asked for after `docs/BYPASS_STRIP_PLAN.md` Stage 4 closed everything else. Stage 4's own
text explicitly deferred this site: its DAL-touching branch sits inside a shared utility (`notify()`),
most of whose callers never reach it, and safely auditing that full fan-out was out of scope for that
session. This plan is that audit.

## Objective

`lib/services/notification-service.js`'s `NotificationService.notify(...)` conditionally calls
`sendAdminEmail(...)` → `DynamicsService.createAndSendEmail(...)`, a Dataverse **write** gated by
`assertTrustedDalContext` under `DATAVERSE_DAL_ENFORCEMENT` (on in all environments). `notify()`'s own
`withDalContext('notification-email', ...)` wrap (installed and byte-preserved through
`BYPASS_STRIP_PLAN.md` Stages 1-3) currently makes this safe from *any* caller, in *any* context state.
The Stage 4 doctrine ("services assume a trusted DAL context already exists; establishment stays at
the route" — Route→Service Decision 3) says this wrap belongs at each real entry point instead. This
plan traces every real entry point that can reach the email branch and, where safe, relocates the
wrap — following the exact same acceptance bar Stage 4 used: **every real caller traced (not assumed),
byte-preserved label, characterization proving trusted context, fresh-context review, gates green.**

**This fan-out is qualitatively larger than any Stage 4a/4b site.** Stage 4's site-46
(`verifySuggestionToken`) was the previous largest, with all real callers direct route entry points.
`notify()`'s caller set (counted in the Baseline table below) is larger still, and most callers can
never reach the email branch (the branch requires `severity: 'error'|'critical'` or
`emailAdmins: true`). Several REACHES-classified callers are themselves **shared utilities with their
own further fan-out that this session did not trace** (see #10, #11 in the Classification table). A
push-up here is not a single relocation; it is, in the worst case, a **multi-hop trace** from
`notify()` up through one or more intermediate shared utilities to the real route/cron entry point.
**Recommendation embedded in this plan: push up only the single-hop REACHES sites; leave multi-hop
sites (#10, #11) as a separately-scoped follow-on, not bundled into this plan's Stage 1.** See
Decision 3.

---

## Baseline (probed this session, not assumed)

| Fact | Value | Evidence |
|---|---|---|
| Real callers of `NotificationService.notify(` / `.notifyNewUser(` (non-comment, excluding `notification-service.js` itself) | 21 files | `[VERIFIED via grep -rln "NotificationService\.notify(\|NotificationService\.notifyNewUser(\|notifications\.notify(" lib pages --include=*.js, excluding notification-service.js, this session]` |
| `sendAdminEmail` trigger condition | `shouldEmail = alert && (emailAdmins || severity === 'error' || severity === 'critical')` | `[VERIFIED via lib/services/notification-service.js:75-76]` |
| `notify()`'s own wrap | `withDalContext('notification-email', () => DynamicsService.createAndSendEmail(...))` inside `sendAdminEmail` | `[VERIFIED via lib/services/notification-service.js:176-183]` |
| Gate scope | `DynamicsService.createAndSendEmail` is a WRITE gated by `assertTrustedDalContext` | `[VERIFIED via lib/services/dynamics-service.js:1232 assertTrustedDalContext('DynamicsService.createEmailActivity') and sibling gates on the email-transport methods — createAndSendEmail/addEmailAttachment/createEmailActivity/sendEmail all gated, per BYPASS_STRIP_PLAN.md Objective]` |

Note on scope of the counts in this section: the 21-caller figure and the NEVER-REACHES/REACHES split
below are a direct-caller classification, closed and counted this session. The separate, open-ended
fan-out behind rows #10 and #11 (indirect callers of `onboardReviewer()` and `readRequiredEmailDefaults()`
respectively) is a distinct, NOT-fully-counted quantity — flagged explicitly in those rows and in
Decision 2 — and does not add to or subtract from the 21/8/13 figures above, which describe only
`notify()`'s own direct callers.

### Classification: does each caller's `notify()` call ever reach the email branch?

**NEVER-REACHES (severity never `error`/`critical`, `emailAdmins` never `true`) — 8 files, #1-8** —
no Stage 4b action needed; `notification-email`'s wrap already
covers these harmlessly if they ever DO reach it, and they currently do not:

| # | File | Severity used | `emailAdmins` |
|---|---|---|---|
| 1 | `lib/bill/honorarium-onboard-orchestrator.js` | `warning` (both call sites) | not set (defaults false) `[VERIFIED via :264-266,324-326]` |
| 2 | `lib/services/alert-reviewer-affiliation-mismatch.js` | `warning` | not set `[VERIFIED via :90-92]` |
| 3 | `lib/services/alert-reviewer-email-mismatch.js` | `warning` | not set `[VERIFIED via :66-68]` |
| 4 | `lib/services/llm-client.js` | `warning` | not set `[VERIFIED via :645-647]` |
| 5 | `lib/services/reviewer-email-reconciler.js` | `warning` | not set `[VERIFIED via :36-38]` |
| 6 | `lib/services/reviewer-finder/save-candidates-service.js` | `warning` | not set `[VERIFIED via :413-415]` |
| 7 | `lib/services/reviewer-quota.js` | `info` | not set (no `emailAdmins` anywhere in file) `[VERIFIED via grep -n emailAdmins lib/services/reviewer-quota.js — 0 hits]` |
| 8 | `pages/api/cron/pricing-canary.js` | `warning` (both call sites) | not set (no `emailAdmins` anywhere in file) `[VERIFIED via grep -n emailAdmins pages/api/cron/pricing-canary.js — 0 hits]` |

**REACHES (confirmed path to `sendAdminEmail`) — 13 files, #9-21** — Stage 1 candidates below:

| # | File | Trigger | Caller graph (traced this session) | Hop depth |
|---|---|---|---|---|
| 9 | `pages/api/auth/[...nextauth].js` → `NotificationService.notifyNewUser(...)` (fire-and-forget, `.catch(()=>{})`) | `notifyNewUser` hardcodes `emailAdmins: true` `[VERIFIED via notification-service.js:198-209]` | Entry point itself (NextAuth `signIn` callback) — **the original motivating case for site 33** | 1 (direct) |
| 10 | `lib/bill/onboard-reviewer-service.js` → `unhandled()` (severity `error`) and `notifyAlertOnly()` (`emailAdmins: true`) | `[VERIFIED via :511-529 (unhandled), :531-548 (notifyAlertOnly)]` | Callers of `onboardReviewer()`: `pages/api/bill/onboard-reviewer.js` (route) — **also independently REACHES, see #14** — and `lib/bill/honorarium-onboard-orchestrator.js` (already NEVER-REACHES itself, but calls `onboardReviewer` which can) | 2 (via `onboardReviewer`) |
| 11 | `lib/services/email-defaults.js` → `notifyMisconfiguredDefault()` | severity `error` + `emailAdmins: true` `[VERIFIED via :4-20]` | Callers of `readRequiredEmailDefaults`, found via `grep -rln email-defaults lib pages --include=*.js` this session — file list only, **individual caller bodies NOT read this session**: [NOT-READ: lib/seed/email-defaults/reviewer-templates.js, lib/services/reviewer-manual-reminder.js, lib/services/reviewer-thankyou-sweep.js, lib/services/reviewer-release-config.js, lib/services/reviewer-reminder-sweep.js, lib/services/reviewer-acceptance-email.js, lib/services/review-manager/withdraw-sufficient-service.js, lib/services/cron/grantee-deliverable-reminders-service.js, pages/profile-settings.js, pages/api/email-defaults/grantee-invite.js, pages/api/email-defaults/reviewer-templates.js, pages/api/cron/grantee-deliverable-reminders.js — full per-caller context-posture trace is explicitly Stage 2 work (Decision 2), not resolved by this plan. The count of callers reaching THIS row's branch is not established in this plan; deferred to Stage 2 (Decision 2). | multi-hop (NOT traced further this session — flagged for separate scoping, Decision 3) |
| 12 | `lib/services/review-upload.js` (severity `error`, virus-detection alert) | `[VERIFIED via :476-478]` | Callers of `writeReviewFiles`: `pages/api/review-manager/upload-review.js`, `pages/api/external/review/[token]/upload.js` (both already establish `withDalContext` around the WHOLE `writeReviewFiles` call as of `BYPASS_STRIP_PLAN.md` Stage 1/4a — **this notify call is likely ALREADY covered**, needs confirmation the notify call site is lexically inside that wrap, not after it) | 1 (direct, likely already safe) |
| 13 | `lib/services/reviewer-acceptance-drain.js` (`emailAdmins: true` at one call site) | `[VERIFIED via :181-184]` | Callers: `pages/api/cron/drain-reviewer-acceptances.js` (already establishes `withDalContext('cron-drain-reviewer-acceptances')` per Stage 1 cluster A3 site 30 — **likely already covered**, needs confirmation of scope) | 1 (direct, likely already safe) |
| 14 | `pages/api/bill/onboard-reviewer.js` (route itself, severity `error` on its own 500 path) | `[VERIFIED via :90-92]` | Entry point itself — route currently has NO `withDalContext` of its own `[VERIFIED via grep -n withDalContext pages/api/bill/onboard-reviewer.js — 0 hits]` | 1 (direct) |
| 15 | `lib/utils/auth-bypass-monitor.js` (`emailAdmins: true`) | `[VERIFIED via :60-71]` | Callers: `pages/api/cron/auth-bypass-check.js` [NOT-READ: found via grep -rln only, body not opened this session], `lib/utils/migration-drift.js` (itself unresolved — see #16) `[VERIFIED via grep -rln auth-bypass-monitor pages lib]` | 1-2 |
| 16 | `lib/utils/migration-drift.js` (severity `error`, both call sites) | `[VERIFIED via :53-55,87-89]` | **No caller found** — `detectMigrationDrift()` is not exported and no `pages/` route or cron references `migration-drift` at all `[VERIFIED via grep -rn migration-drift pages --include=*.js — 0 hits; grep -n "^export" lib/utils/migration-drift.js shows no export]`. **Flag: possible dead code, or invoked via a mechanism this grep didn't match (e.g. a script, or dynamic require) — needs a dedicated liveness check before ANY action, per CLAUDE.md's destructive-carryover verification rule.** | no live caller found this session — **STOP-AND-ASK before Stage 1** |
| 17 | `pages/api/cron/health-check.js` (severity escalates to `error` when `consecutiveUnhealthy >= 2`) | `[VERIFIED via :85-95]` | Entry point itself — needs a check for existing `withDalContext` | 1 (direct) |
| 18 | `pages/api/cron/log-analysis.js` (severity `error` when `errors.length >= 50`) | `[VERIFIED via :142-144]` | Entry point itself — needs a check for existing `withDalContext` | 1 (direct) |
| 19 | `pages/api/cron/maintenance.js` (severity `error` conditionally, 2 call sites) | `[VERIFIED via :231-233,258-260]` | Entry point itself — **this route now establishes `withDalContext` for sites 34/35 (Stage 4b) but NOT around its own summary/failure `notify()` calls at :231/:258** — needs confirmation those calls are outside the 34/35 wraps (they are, per the file's per-step try/catch structure `[VERIFIED via pages/api/cron/maintenance.js, read in full this session for the Stage 4b push-up]`) | 1 (direct, needs its own wrap or confirmation it's already covered) |
| 20 | `pages/api/cron/secret-check.js` (`emailAdmins: true`) | `[VERIFIED via :81-96]` | Entry point itself — needs a check for existing `withDalContext` | 1 (direct) |
| 21 | `pages/api/intake/draft/attach.js` (severity `error`, virus-detection alert) | `[VERIFIED via :485-487]` | Entry point itself — **this route already establishes 2 narrow scopes (`intake-attach-bridge` :140, `intake-attach-membership` :172, per Stage 1) but the notify call at :485 is lexically OUTSIDE both** — confirmed unwrapped, needs its own scope (matching site 44's "sixth narrow scope" pattern from Stage 4b) | 1 (direct, confirmed NOT currently covered by neighbors) |

The NEVER-REACHES table above lists 8 files (#1-8) and the REACHES table lists 13 (#9-21); together
they account for the 21 direct callers named in the Baseline row above. This closed count is unaffected
by the separately-flagged, not-yet-counted indirect fan-out under #11 (see the Note above the
Classification heading).

---

## Decisions (draft — for review, not yet owner-approved)

1. **Only single-hop REACHES sites are in this plan's Stage 1 scope.** That is #9, #14, #17, #18, #19,
   #20, #21 (7 sites) plus #12 and #13 pending confirmation they're already covered (if confirmed
   covered, they need NO action — just a characterization test proving it, not a code change).
2. **#10 (`onboard-reviewer-service.js`) and #11 (`email-defaults.js`) are multi-hop and OUT of this
   plan's Stage 1** — each needs its own caller-graph trace (of `onboardReviewer`'s callers, and
   `readRequiredEmailDefaults`'s callers respectively — those files are named above but their bodies
   are NOT read this session; see the [NOT-READ] marker) before any push-up decision can be made
   safely. Recommend a Stage 2, scoped and reviewed separately, only after Stage 1 closes.
3. **#16 (`migration-drift.js`) is a STOP-AND-ASK, not a push-up candidate.** Before this plan's
   execution touches it, confirm whether `detectMigrationDrift()` has a live caller this session's
   greps missed (script, cron registry, dynamic import) or whether it is dead code — a decision
   distinct from and prior to any Stage 4b-style trust-model work.
4. **Byte-identical labels, as in Stage 4a/4b.** The relocated wrap keeps the label
   `'notification-email'` exactly; only the callee boundary moves.
5. **No scope widening beyond what Stage 4b already established as safe** (broadening a wrap to cover
   more code than before is acceptable per the `cleanupBlobs` precedent; narrowing or stranding a call
   is not).

## Non-goals

Touching #10/#11's deeper fan-out in this plan; resolving #16's liveness question by assumption; any
change to `notify()`'s email-vs-no-email branching logic; any change to `sendAdminEmail`'s recipient
resolution.

---

## Self-checking method

Same as `BYPASS_STRIP_PLAN.md`: **pre-stage re-probe** (re-run the caller-count and severity/emailAdmins
greps before executing, since this doc's census could drift) — **characterization** per site (drive
real `DynamicsService`/`hasTrustedDalContext()`, not a mocked-out `NotificationService`, matching the
`token-lifecycle-nested-context.test.js` pattern from Stage 4a) — **negative control** where the site is
genuinely gated (email-branch writes are; confirm a no-context call throws) — **green gates** after each
site (`npm test`, `check:dataverse-access-layer`, `check:route-service-boundary`,
`check:dynamics-context-boundary`, all + self-tests) — **fresh-context review** before calling this
closed, exactly as Stage 3/4 both required.

---

## Stages

### Stage 0 — Pre-execution verification (before touching any code)

1. Resolve #16 (`migration-drift.js`) liveness — STOP-AND-ASK per Decision 3.
2. Confirm #12 (`review-upload.js`) and #13 (`reviewer-acceptance-drain.js`) are ALREADY covered by
   their callers' existing wraps (read the exact lexical scope; if covered, no code change, just add a
   characterization test proving it; if NOT covered, promote to Stage 1).
3. Re-run the disconfirming census greps (caller count, severity/emailAdmins per file) — confirm no
   drift from this plan's Baseline.

### Stage 1 — Single-hop push-ups (7 sites: #9, #14, #17, #18, #19, #20, #21)

Same per-site loop as `BYPASS_STRIP_PLAN.md` Stage 1: add `withDalContext('notification-email', ...)`
at each real entry point around its `notify()` call (or the smallest enclosing block that reaches it),
add/confirm a characterization test (real `DynamicsService`, negative control + positive pin), run
targeted suite + gates, commit per site or small cluster.

**#9 (`nextauth.js`) needs care**: it is fire-and-forget (`.catch(()=>{})`), so the wrap must go around
the `notifyNewUser(...)` call itself, not awaited-and-swallowed in a way that changes the fire-and-forget
semantics.

Once Stage 1 closes, `notify()`'s own `'notification-email'` wrap is removed ONLY IF every REACHES site
(including #12/#13 once confirmed, and excluding the explicitly-deferred #10/#11 multi-hop sites) is
covered by its own caller — otherwise the wrap must stay (a partial push-up that removes the shared
safety net is the drain-defect failure class this plan exists to avoid).

### Stage 2 (separately scoped, NOT part of this plan's execution) — Multi-hop sites #10, #11

Deferred. Requires its own caller-graph trace of `onboardReviewer`'s callers and
`readRequiredEmailDefaults`'s callers before any decision.

### Stage 3 — Fresh-context review

Codex adversarial review of the full diff, same acceptance bar as `BYPASS_STRIP_PLAN.md` Stage
0-4 review rounds.

---

## Stage Log

*(append-only)*

- 2026-07-05: **Plan drafted (`status: draft`). NOT executed, NOT reviewed.** Census: 21 real direct
  callers of `NotificationService.notify`/`.notifyNewUser`; 8 NEVER-REACHES (severity never
  error/critical, emailAdmins never true), 13 REACHES. Of the REACHES set: 7 are single-hop direct
  entry points (Stage 1 scope), 2 (#12/#13) are likely-already-covered pending lexical confirmation, 2
  (#10/#11) are multi-hop shared utilities with their own further, not-yet-counted fan-out (deferred to
  a separate Stage 2, with #11's callers named from a grep result only, bodies not read this session),
  and 1 (#16, `migration-drift.js`) has no traceable live caller and is a STOP-AND-ASK before any
  action. Drafted in response to an explicit owner request to close the site-33 gap left open by
  `BYPASS_STRIP_PLAN.md` Stage 4.

<!-- end of plan -->
