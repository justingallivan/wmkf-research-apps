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

**Execution status: STAGE 1 EXECUTED, REVIEWED, AND COMMITTED (`23cff83`, 2026-07-05).** Census
re-closed at 23 (three-way verified, `02d3cd9`); Stage 0 passed; all 9 single-hop push-ups landed with
characterization coverage; `notify()`'s shared internal wrapper intentionally retained. **Remaining:
Stage 2 (multi-hop #10/#11) not started, and the shared-wrapper removal is a separate later human
decision once every REACHES site is covered — neither is done.** This is the site-33 follow-on
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
| Real callers of `NotificationService.notify(` / `.notifyNewUser(` (non-comment, excluding `notification-service.js` itself) | 23 files (21 literal call-site matches + 1 indirect caller #22 via a `notify.call(...)` local alias + 1 binary-suppressed caller #23, `pricing-refresh.js`, that a plain content-grep silently drops because the file carries a non-UTF8 byte and grep treats it as binary) | `[VERIFIED three ways this session: (1) force-text union grep -rlaE "NotificationService\.(notify\|notifyNewUser)\(\|notifications\.notify\(" ∪ "\bnotify\.call\(" over lib pages, excluding notification-service.js → 23 files; (2) a broad whole-repo force-text sweep of the same patterns → same 23; (3) CodeGraph caller query on notify/notifyNewUser, which independently resolves the two forms grep structurally cannot follow — the maintenance-service.js `.call` alias (#22) and the migration-drift.js dynamic `import()` from instrumentation.js (#16) — and surfaces no caller outside the 23. #23 pricing-refresh found by a Codex Stage 0 re-probe of this plan and independently confirmed at pages/api/cron/pricing-refresh.js:245-247. Methodology lesson: the plan's original literal content-grep census had THREE blind spots — non-UTF8/binary-flagged files (needs -a), local-variable/`.call` aliasing, and dynamic `import()`; close the census with a CodeGraph call-graph cross-check, not grep alone]` |
| `sendAdminEmail` trigger condition | `shouldEmail = alert && (emailAdmins || severity === 'error' || severity === 'critical')` | `[VERIFIED via lib/services/notification-service.js:75-76]` |
| `notify()`'s own wrap | `withDalContext('notification-email', () => DynamicsService.createAndSendEmail(...))` inside `sendAdminEmail` | `[VERIFIED via lib/services/notification-service.js:176-183]` |
| Gate scope | `DynamicsService.createAndSendEmail` is a WRITE gated by `assertTrustedDalContext` | `[VERIFIED via lib/services/dynamics-service.js:1232 assertTrustedDalContext('DynamicsService.createEmailActivity') and sibling gates on the email-transport methods — createAndSendEmail/addEmailAttachment/createEmailActivity/sendEmail all gated, per BYPASS_STRIP_PLAN.md Objective]` |

Note on scope of the counts in this section: the 23-caller figure and the NEVER-REACHES/REACHES split
below are a direct-caller classification, closed and counted this session (23 = 21 literal grep matches
+ 1 indirect `.call`-alias caller #22 + 1 binary-suppressed caller #23), cross-checked against a
CodeGraph caller query that surfaced no caller outside this set.
The separate, open-ended fan-out behind rows #10 and #11 (indirect callers of `onboardReviewer()` and
`readRequiredEmailDefaults()` respectively) is a distinct, not-fully-counted quantity — flagged
explicitly in those rows and in Decision 2 — and does not add to or subtract from the 23/9/14 figures
above, which describe only `notify()`'s own direct callers.

### Classification: does each caller's `notify()` call ever reach the email branch?

**NEVER-REACHES (severity never `error`/`critical`, `emailAdmins` never `true`) — 9 files, #1-8 and #23** —
no Stage 4b action needed; `notification-email`'s wrap already
covers these harmlessly if they ever DO reach it, and they currently do not (numbering is
non-contiguous: #23 was found after the REACHES rows #9-22 were already numbered):

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
| 23 | `pages/api/cron/pricing-refresh.js` | `warning` (single call site) | not set `[VERIFIED via pages/api/cron/pricing-refresh.js:245-247 — the file's only notify call, `severity: 'warning'`, no `emailAdmins`; binary-suppressed from the original grep census, see Baseline evidence note]` |

**REACHES (confirmed path to `sendAdminEmail`) — 14 files, #9-22** — Stage 1 candidates below:

| # | File | Trigger | Caller graph (traced this session) | Hop depth |
|---|---|---|---|---|
| 9 | `pages/api/auth/[...nextauth].js` → `NotificationService.notifyNewUser(...)` (fire-and-forget, `.catch(()=>{})`) | `notifyNewUser` hardcodes `emailAdmins: true` `[VERIFIED via notification-service.js:198-209]` | Entry point itself (NextAuth `signIn` callback) — **the original motivating case for site 33** | 1 (direct) |
| 10 | `lib/bill/onboard-reviewer-service.js` — reaches the email branch via FOUR distinct call sites: the invalid-input guard (severity `error`) at line ~108, `billFailure()` (severity `error`/`critical` depending on error type) at ~481-503 (called from ~209, ~248, ~259), `unhandled()` (severity `error`) at ~511-529, and `notifyAlertOnly()` (`emailAdmins: true`) at ~531-548 | `[VERIFIED via :105-118 (invalid-input guard), :481-503 (billFailure), :511-529 (unhandled), :531-548 (notifyAlertOnly); :209,:248,:259 (billFailure call sites)]` | Callers of `onboardReviewer()`: `pages/api/bill/onboard-reviewer.js` (route) — **also independently REACHES, see #14** — and `lib/bill/honorarium-onboard-orchestrator.js` (already NEVER-REACHES itself, but calls `onboardReviewer` which can) | 2 (via `onboardReviewer`) |
| 11 | `lib/services/email-defaults.js` → `notifyMisconfiguredDefault()` | severity `error` + `emailAdmins: true` `[VERIFIED via :4-20]` | The list below is an unverified `grep -rln "email-defaults"` HIT LIST, not a confirmed caller graph: it may include files that reference `email-defaults.js` for a reason other than calling `readRequiredEmailDefaults()`, or that call it but never reach `notifyMisconfiguredDefault()`'s branch. It is named here only so Stage 2 has a starting point, not as a verified census: [NOT-READ, hit-list only, NOT a caller graph: lib/seed/email-defaults/reviewer-templates.js, lib/services/reviewer-manual-reminder.js, lib/services/reviewer-thankyou-sweep.js, lib/services/reviewer-release-config.js, lib/services/reviewer-reminder-sweep.js, lib/services/reviewer-acceptance-email.js, lib/services/review-manager/withdraw-sufficient-service.js, lib/services/cron/grantee-deliverable-reminders-service.js, pages/profile-settings.js, pages/api/email-defaults/grantee-invite.js, pages/api/email-defaults/reviewer-templates.js, pages/api/cron/grantee-deliverable-reminders.js]. Stage 2 must re-derive the exact caller set via symbol-level tracing of `readRequiredEmailDefaults()` and `notifyMisconfiguredDefault()` specifically, not reuse this grep hit list as ground truth. The count of callers reaching THIS row's branch is not established in this plan; deferred to Stage 2 (Decision 2). | multi-hop (NOT traced further this session — flagged for separate scoping, Decision 3) |
| 12 | `lib/services/review-upload.js` (severity `error`, virus-detection alert) | `[VERIFIED via :476-478]` | Callers of `writeReviewFiles`: `pages/api/review-manager/upload-review.js`, `pages/api/external/review/[token]/upload.js` (both already establish `withDalContext` around the WHOLE `writeReviewFiles` call as of `BYPASS_STRIP_PLAN.md` Stage 1/4a — **this notify call is likely ALREADY covered**, needs confirmation the notify call site is lexically inside that wrap, not after it) | 1 (direct, likely already safe) |
| 13 | `lib/services/reviewer-acceptance-drain.js` (`emailAdmins: true` at one call site) | `[VERIFIED via :181-184]` | Callers: `pages/api/cron/drain-reviewer-acceptances.js` (already establishes `withDalContext('cron-drain-reviewer-acceptances')` per Stage 1 cluster A3 site 30 — **likely already covered**, needs confirmation of scope) | 1 (direct, likely already safe) |
| 14 | `pages/api/bill/onboard-reviewer.js` (route itself, severity `error` on its own 500 path) | `[VERIFIED via :90-92]` | Entry point itself — route currently has NO `withDalContext` of its own `[VERIFIED via grep -n withDalContext pages/api/bill/onboard-reviewer.js — 0 hits]` | 1 (direct) |
| 15 | `lib/utils/auth-bypass-monitor.js`'s `checkEmergencyAuthBypass()` (severity `critical` at one call site, `emailAdmins: true` at another) | `[VERIFIED via :60-71]` | The two real callers are: `pages/api/cron/auth-bypass-check.js`, a static import `[VERIFIED via pages/api/cron/auth-bypass-check.js:20]`, currently unwrapped `[VERIFIED via grep -n withDalContext pages/api/cron/auth-bypass-check.js — 0 hits]`; and `instrumentation.js`'s `register()` cold-start hook, a dynamic `import()` at line ~19-22, also currently unwrapped — see #16, same hook | 1 (direct, two independent callers, both currently uncovered) |
| 16 | `lib/utils/migration-drift.js`'s `detectMigrationDrift()` (severity `error`, both call sites) | `[VERIFIED via :53-55,87-89]` | `detectMigrationDrift` is exported (`module.exports`) `[VERIFIED via lib/utils/migration-drift.js:105]` and is called on every server cold start by `instrumentation.js`'s `register()` via a dynamic `import()` at line ~30-31 `[VERIFIED via instrumentation.js:27-34]`. This is the same cold-start hook that calls `auth-bypass-monitor.js` (#15) — `register()`'s two try/catch blocks are the entry point for both rows. No `withDalContext` wraps this path anywhere `[VERIFIED via grep -n withDalContext instrumentation.js lib/utils/migration-drift.js lib/utils/auth-bypass-monitor.js — 0 hits across all three files]`; both alert paths currently depend entirely on `notify()`'s own internal wrap, and `instrumentation.js`'s outer try/catch only logs and swallows a failure here, so a premature wrapper removal would silently break cold-start alerting in production | 1 (direct, currently uncovered) |
| 22 | `lib/services/maintenance-service.js`'s `_safeBillAlert()` (severity `error` at ~196-203 and ~240-247, `emailAdmins: true` at both) | `[VERIFIED via :270-272 (notify.call indirection), :196-203 and :240-247 (severity/emailAdmins), :258-262 (_safeBillAlert definition)]` | This caller assigns `NotificationService.notify` to a local `notify` and invokes it via `notify.call(...)`, not a literal `NotificationService.notify(` token. Sole real caller of `_safeBillAlert` is `sweepBillOnboarding()`, whose sole real caller is `pages/api/cron/maintenance.js`, which already establishes `withDalContext('bill-onboarding-resume', ...)` around the WHOLE `sweepBillOnboarding()` call `[VERIFIED via pages/api/cron/maintenance.js:114-116]` — **confirmed already covered**, matching the #12/#13 pattern | 1 (direct, confirmed already covered) |
| 17 | `pages/api/cron/health-check.js` (severity escalates to `error` when `consecutiveUnhealthy >= 2`) | `[VERIFIED via :85-95]` | Entry point itself — needs a check for existing `withDalContext` | 1 (direct) |
| 18 | `pages/api/cron/log-analysis.js` (severity `error` when `errors.length >= 50`) | `[VERIFIED via :142-144]` | Entry point itself — needs a check for existing `withDalContext` | 1 (direct) |
| 19 | `pages/api/cron/maintenance.js` (severity `error` conditionally, 2 call sites) | `[VERIFIED via :231-233,258-260]` | Entry point itself — **this route now establishes `withDalContext` for sites 34/35 (Stage 4b) but NOT around its own summary/failure `notify()` calls at :231/:258** — needs confirmation those calls are outside the 34/35 wraps (they are, per the file's per-step try/catch structure `[VERIFIED via pages/api/cron/maintenance.js, read in full this session for the Stage 4b push-up]`) | 1 (direct, needs its own wrap or confirmation it's already covered) |
| 20 | `pages/api/cron/secret-check.js` (`emailAdmins: true`) | `[VERIFIED via :81-96]` | Entry point itself — needs a check for existing `withDalContext` | 1 (direct) |
| 21 | `pages/api/intake/draft/attach.js` (severity `error`, virus-detection alert) | `[VERIFIED via :485-487]` | Entry point itself — **this route already establishes 2 narrow scopes (`intake-attach-bridge` :140, `intake-attach-membership` :172, per Stage 1) but the notify call at :485 is lexically OUTSIDE both** — confirmed unwrapped, needs its own scope (matching site 44's "sixth narrow scope" pattern from Stage 4b) | 1 (direct, confirmed NOT currently covered by neighbors) |

The NEVER-REACHES table above lists 9 files (#1-8 and #23) and the REACHES table lists 14 (#9-22);
together they account for the 23 direct callers named in the Baseline row above. This closed count is
unaffected by the separately-flagged, not-fully-counted indirect fan-out under #11 (see the Note above
the Classification heading).

---

## Decisions (draft — for review, not yet owner-approved)

1. **Only single-hop REACHES sites are in this plan's Stage 1 scope.** That is #9, #14, #17, #18, #19,
   #20, #21 (7 sites) plus #12, #13, and #22, all three already confirmed covered by their callers'
   existing wraps (no code change needed for those three — just a characterization test proving it).
2. **#15 (`auth-bypass-monitor.js`) and #16 (`migration-drift.js`) are ALSO in this plan's Stage 1 scope.**
   Both are single-hop direct callers, not
   multi-hop, so they belong in Stage 1 rather than deferred to Stage 2: `pages/api/cron/auth-bypass-check.js`
   needs its own new `withDalContext` wrap (#15's route caller), and `instrumentation.js`'s `register()`
   cold-start hook needs its own new wrap covering BOTH #15's and #16's alert calls (its two try/catch
   blocks are a single, simple two-call entry point — this plan's judgment call is that it is safe and
   appropriate to wrap now rather than defer, since it is not itself a further shared utility with
   its own untraced callers; it IS the real entry point).
3. **#10 (`onboard-reviewer-service.js`) and #11 (`email-defaults.js`) are multi-hop and OUT of this
   plan's Stage 1** — each needs its own caller-graph trace (of `onboardReviewer`'s callers, and
   `readRequiredEmailDefaults`'s callers respectively — those files are named above but their bodies
   are NOT read this session; see the [NOT-READ] marker) before any push-up decision can be made
   safely. Recommend a Stage 2, scoped and reviewed separately, only after Stage 1 closes.
4. **Byte-identical labels, as in Stage 4a/4b.** The relocated wrap keeps the label
   `'notification-email'` exactly; only the callee boundary moves. The two NEW wraps this plan adds
   (`instrumentation.js`'s cold-start hook, `auth-bypass-check.js`'s route) are new establishment points,
   not relocations, so they may use their own descriptive labels (e.g. `'cold-start-alerts'`,
   `'cron-auth-bypass-check'`) rather than reusing `'notification-email'`, since there is no existing
   label to preserve at those two sites.
5. **No scope widening beyond what Stage 4b already established as safe** (broadening a wrap to cover
   more code than before is acceptable per the `cleanupBlobs` precedent; narrowing or stranding a call
   is not).

## Non-goals

Touching #10/#11's deeper fan-out in this plan; any change to `notify()`'s email-vs-no-email branching
logic; any change to `sendAdminEmail`'s recipient resolution; changing `instrumentation.js`'s
fire-and-forget/best-effort cold-start semantics (the new wrap must not turn a caught, logged failure
into an uncaught one).

---

## Self-checking method

Same as `BYPASS_STRIP_PLAN.md`: **pre-stage re-probe** (re-run the caller-count and severity/emailAdmins
census before executing, since this doc's census could drift — and re-probe with `grep -a` AND a
CodeGraph caller cross-check, never a plain content-grep alone: the original census missed three real
callers to three distinct grep blind spots — a binary-flagged file (#23), a `.call` local alias (#22),
and a dynamic `import()` (#16)) — **characterization** per site (drive
real `DynamicsService`/`hasTrustedDalContext()`, not a mocked-out `NotificationService`, matching the
`token-lifecycle-nested-context.test.js` pattern from Stage 4a) — **negative control** where the site is
genuinely gated (email-branch writes are; confirm a no-context call throws) — **green gates** after each
site (`npm test`, `check:dataverse-access-layer`, `check:route-service-boundary`,
`check:dynamics-context-boundary`, all + self-tests) — **fresh-context review** before calling this
closed, exactly as Stage 3/4 both required.

---

## Stages

### Stage 0 — Pre-execution verification (before touching any code)

1. Confirm #12 (`review-upload.js`), #13 (`reviewer-acceptance-drain.js`), and #22
   (`maintenance-service.js`) are ALREADY covered by their callers' existing wraps (read the exact
   lexical scope; each is believed covered per the Classification table above — if NOT covered on
   re-read, promote to an active Stage 1 code change instead of a characterization-only site).
2. Re-run the disconfirming census (caller count, severity/emailAdmins per file) with `grep -a` plus a
   CodeGraph caller cross-check — confirm no drift from this plan's Baseline of 23 callers, including the
   #22 `.call`-alias, the #16 dynamic-`import()`, and the #23 binary-suppressed shapes a literal-callsite
   grep alone will not surface (see the Baseline evidence note). The census is closed at 23 as of
   2026-07-05, verified three ways (force-text union grep, whole-repo sweep, CodeGraph).

### Stage 1 — Single-hop push-ups (9 sites: #9, #14, #15, #16, #17, #18, #19, #20, #21)

Same per-site loop as `BYPASS_STRIP_PLAN.md` Stage 1: add `withDalContext(...)`
at each real entry point around its `notify()` call (or the smallest enclosing block that reaches it),
add/confirm a characterization test (real `DynamicsService`, negative control + positive pin), run
targeted suite + gates, commit per site or small cluster.

**#9 (`nextauth.js`) needs care**: it is fire-and-forget (`.catch(()=>{})`), so the wrap must go around
the `notifyNewUser(...)` call itself, not awaited-and-swallowed in a way that changes the fire-and-forget
semantics.

**#15/#16 (`instrumentation.js`'s cold-start hook) need the same care**: `register()`'s two try/catch
blocks are individually caught and logged, not propagated — the new wrap must preserve that, wrapping
each call (or both, in one `withDalContext` spanning the function body) without turning a caught failure
into an uncaught one that could break server cold start. `pages/api/cron/auth-bypass-check.js` (#15's
other caller) is a plain route wrap, same shape as #17/#18/#20.

Once Stage 1 AND Stage 2 close, `notify()`'s own `'notification-email'` wrap still stays in place until
a human follow-up review explicitly removes it. That follow-up is allowed only if every REACHES site —
#9 through #22 (all fourteen: #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #21, #22) — is
covered by its own entry point. Stage 2 (below) closes the last two (#10/#11), so after it lands this
precondition is met. A partial push-up must not remove the shared safety net.

### Stage 2 — Multi-hop sites #10, #11 (TRACED; scope is 1 new wrap + 7 characterization sites)

Both fan-outs were traced 2026-07-05 (CodeGraph caller query + `grep -a` + lexical-scope reads of each
entry point). Result — far smaller than the "open-ended fan-out" the draft feared:

**#10 `onboardReviewer` — 2 terminal entry points:**
- `pages/api/bill/onboard-reviewer.js:81` — `await onboardReviewer(body)` sits in the route's `try`
  block (line 80), OUTSIDE the `'notification-email'` wrap that only covers the route's own notify in
  the `catch` (line 91) `[VERIFIED via pages/api/bill/onboard-reviewer.js:80-83,91]`. **UNCOVERED — needs
  ONE new wrap** around the `onboardReviewer(body)` call.
- `pages/api/cron/drain-reviewer-acceptances.js` — reaches `onboardReviewer` via
  `drainReviewerAcceptanceJobs → processReviewerAcceptanceJob → ensureHonorariumOnboarding → onboardReviewer`,
  all synchronously awaited inside `withDalContext('cron-drain-reviewer-acceptances', ...)` at `:34`
  `[VERIFIED via pages/api/cron/drain-reviewer-acceptances.js:33-36]`. **COVERED — characterization only.**
  (Note: `honorarium-onboard-orchestrator.js` establishes NO context of its own; the cron is the sole
  establisher, so a future caller of `ensureHonorariumOnboarding` outside a context would regress #10b.)

**#11 `readRequiredEmailDefaults` → `notifyMisconfiguredDefault` — 6 terminal entry points, ALL COVERED**
(characterization only), each already inside its entry point's existing wrap
`[VERIFIED via lexical-scope reads this session]`:
- `pages/api/review-manager/send-review-reminder.js` → `withDalContext('review-manager-send-review-reminder')` :59
- `pages/api/cron/send-review-thankyous.js` → `withDalContext('cron-review-thankyous')` :45
- `pages/api/cron/reviewer-reminders.js` (both respond + reviewDue sweeps) → `withDalContext('cron-reviewer-reminders')` :43
- `pages/api/review-manager/withdraw-sufficient.js` → `withDalContext('review-manager-withdraw-sufficient')` :51
- `pages/api/cron/drain-reviewer-acceptances.js` (`sendAcceptanceConfirmationEmail`) → `withDalContext('cron-drain-reviewer-acceptances')` :34
- `pages/api/cron/grantee-deliverable-reminders.js` → `withDalContext('grantee-deliverable-reminders-cron')` :29

**Stage 2 execution scope:** ONE new production wrap (`onboard-reviewer.js:81`, wrapping
`onboardReviewer(body)` — a scope-widen that also nests onboardReviewer's own inner wraps, safe per ALS
re-entrancy; label e.g. `'bill-onboard-reviewer'`), plus characterization tests for the 8 already-covered
paths (#10b drain + the 6 #11 entry points; the reminder cron covers two sweeps). No change to #10/#11
service internals. After Stage 2 lands, EVERY REACHES entry point establishes context — the precondition
for removing the shared internal wrapper (Stage 3 below).

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

- 2026-07-05: **Plan revised after a fresh-context Codex adversarial review returned NEEDS REWORK on
  the draft above.** The reviewing agent traced the caller graph independently from source and found
  the first draft's census was structurally too narrow: its literal-callsite grep could not see an
  indirect caller that assigns `notify` to a local and invokes it via `.call(...)` (now #22,
  `maintenance-service.js`), or callers reached only through a dynamic `import()` (`instrumentation.js`'s
  cold-start hook, which reaches both #15 and #16). Two rows were materially wrong, not just
  incomplete: #16 (`migration-drift.js`) was called dead code with no caller — it is live, exported,
  and invoked on every cold start; #15 (`auth-bypass-monitor.js`) named the wrong second caller
  (`migration-drift.js`, a comment-only reference, instead of `instrumentation.js`, the real one). Row
  #10 was under-described (two of its four email-reaching call sites were omitted). Row #11's
  `[NOT-READ]` file list was reframed as an unverified hit list rather than a caller graph. All seven
  Codex findings were independently re-verified against source (file:line citations added throughout)
  before this revision, per this file's own `[VERIFIED via ...]` convention — see the Baseline evidence
  note and rows #10, #15, #16, #22 above. Updated counts: 22 real direct callers (was 21), 8
  NEVER-REACHES (unchanged), 14 REACHES (was 13). Stage 1 scope grew from 7 to 9 sites (#15 and #16
  added, both single-hop and no longer a liveness question); #22 joined #12/#13 as confirmed-covered,
  no-code-change sites. The shared `'notification-email'` wrapper's removal condition was tightened to
  require ALL twelve REACHES sites covered, not the original seven-site subset. Still `status: draft`;
  not yet re-reviewed after this revision, not executed.

- 2026-07-05: **Execution pass stopped during Stage 0 after doc cleanup.** The plan body was cleaned
  up to move repeated review-provenance narrative out of classification cells while preserving the
  frontmatter `status: draft` and existing `[VERIFIED via ...]` evidence citations. Stage 0 lexical
  checks confirmed #12, #13, and #22 are still covered by their existing caller scopes. The required
  caller-count re-probe contradicted the Baseline: the literal caller grep now returns 22 files before
  adding #22's indirect `notify.call(...)` path, because `pages/api/cron/pricing-refresh.js` is a real
  direct caller not present in the Classification tables. That path calls `NotificationService.notify`
  with `severity: 'warning'` and no `emailAdmins` field `[VERIFIED via pages/api/cron/pricing-refresh.js:245-247]`,
  so it appears to be NEVER-REACHES, but it still changes the closed 22-caller census. Stage 1 code
  was not applied, characterization tests were not added, and Step 3 gates were not run because the
  handoff required stopping on any Stage 0 Baseline contradiction.

- 2026-07-05: **Census re-closed at 23 (three-way verified); Stage 0 passed; Stage 1 cleared to
  execute.** Claude independently confirmed the Codex Stage 0 finding: `pricing-refresh.js:245` calls
  `NotificationService.notify` once with `severity: 'warning'`, no `emailAdmins` → genuinely
  NEVER-REACHES, so it adds NO Stage 1 code site and does NOT change the shared-wrapper removal
  condition (which counts REACHES sites only). The deeper issue was the census METHOD, not the one
  file: a plain content-grep silently drops binary-flagged files, `.call` local aliases (#22), and
  dynamic `import()` edges (#16). The caller set was therefore re-derived three independent ways —
  force-text (`grep -a`) union grep, a whole-repo force-text sweep, and a CodeGraph caller query that
  resolves the alias/dynamic hops grep cannot — all converging on exactly 23 files with no caller
  outside the set (a spurious CodeGraph `handler → notify` edge into `drain-submissions-service.js` was
  checked and refuted: that file has no `notify` call). Corrected counts: 23 direct callers (was 22),
  9 NEVER-REACHES (#1-8 plus #23; was 8), 14 REACHES (#9-22, unchanged). **Stage 1's 9 code sites are
  unchanged.** Doc cleaned of repeated review-provenance narrative (all `[VERIFIED via ...]` citations
  preserved). Owner signed off on execution: Stage 1 to be applied by Codex, then reviewed by Claude on
  the uncommitted diff before any commit; the shared `'notification-email'` wrapper stays in place this
  pass regardless (its removal is a later, separate human decision once all REACHES sites are covered).

- 2026-07-05: **Stage 1 executed, reviewed, and committed (`23cff83`).** Codex applied `withDalContext`
  wraps at all 9 single-hop sites (#9, #14, #15, #16, #17, #18, #19, #20, #21) and added a 14-test
  characterization suite (`tests/unit/notification-trust-model-pushup.test.js`) covering #9 and the
  already-covered #12/#13/#22 with real `NotificationService`/`DynamicsService`, a no-context negative
  control, and positive trusted-context pins. Labels: byte-identical `'notification-email'` for the
  relocations; new establishment points use `'cron-auth-bypass-check'` (auth-bypass-check route) and
  `'cold-start-alerts'` (`instrumentation.js` `register()`, covering both #15's and #16's cold-start
  alert calls). Claude reviewed the uncommitted diff at source before commit: confirmed the shared
  internal `notify()` wrapper and #10/#11 are untouched; each new wrap encloses the reaching `notify()`
  call. Two sites are a deliberate scope-widen rather than a notify-only wrap (sanctioned by Decision 5):
  the auth-bypass-check route (#15) and `instrumentation.js`'s `register()` (#15/#16) wrap the WHOLE
  `checkEmergencyAuthBypass()` / `detectMigrationDrift()` monitor call, so those monitors' own Dataverse
  reads also run under the trusted `restrictions: []` context, not just their notify path. Fire-and-forget
  (#9/#21) and cold-start catch/log/swallow (#15/#16) semantics preserved; nested same-label
  `withDalContext` is safe (ALS re-entrancy, covered by `token-lifecycle-nested-context.test.js`); no
  double-wrap in `maintenance.js` (`:231/:258` are top-level, outside the
  `bill-onboarding-resume`/`maintenance-blob-scan` scopes). The characterization suite genuinely
  DISCRIMINATES the entry-point wrap (it stubs `notify` and asserts `hasTrustedDalContext()` at the
  callsite BEFORE the retained internal wrap runs, so it is not riding that wrap) — proven by a mutation
  check: reverting the #17 wrap flips its test to red at `expect(hit.trusted).toBe(true)`. This is what
  the internal wrapper's eventual removal will rely on. Green independently:
  full suite 428 suites / 4758 tests, `check:dynamics-context-boundary` / `dataverse-access-layer` /
  `route-service-boundary` / `api-routes` (+ self-tests), and `npm run build`. Stage 2 (#10/#11) and the
  shared-wrapper removal remain open.

- 2026-07-05: **Stage 2 traced — scope is far smaller than the draft feared: 1 new wrap + 8
  characterization sites.** Traced both multi-hop fan-outs with a CodeGraph caller query + `grep -a` +
  independent lexical-scope reads of every terminal entry point (see the rewritten Stage 2 section for
  the per-entry-point matrix with file:line evidence). #10 `onboardReviewer` has exactly 2 entry points:
  the HTTP route `onboard-reviewer.js:81` is UNCOVERED (its `onboardReviewer(body)` call is in the `try`,
  outside the `catch`-block `'notification-email'` wrap) and needs ONE new wrap; the drain cron is
  already covered by `withDalContext('cron-drain-reviewer-acceptances')`. #11
  `readRequiredEmailDefaults`'s 6 terminal entry points (7 call sites; the reminder cron covers two
  sweeps) are ALL already covered by their existing route/cron wraps — each `withDalContext` open line
  personally read this session. So CodeGraph's "15 callers" was a transitive count; the direct call set
  is 7 sites in 6 functions. Stage 2 execution = one production wrap (`onboard-reviewer.js:81`) plus
  characterization tests for the 8 already-covered paths; no service-internal changes. Not yet executed.

<!-- end of plan -->
