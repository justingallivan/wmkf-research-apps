---
title: bypassDynamicsRestrictions Strip Plan
domain: architecture
kind: plan
status: active
summary: "Converted 52 bypass scopes to withDalContext, byte-identical; bypass-shape law (Stage 3) built. Executed S333."
canonical: true
owner: product-engineering
related:
  - docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/CI_GATES_REFERENCE.md
  - docs/CLAUDE_REMEDIATION_PLAN.md
  - docs/agent-wiki/topics/dataverse-dynamics.md
---

# bypassDynamicsRestrictions Strip Plan

**Execution status: STAGES 0–3 COMPLETE AND REVIEW-CLOSED (S333, 2026-07-05).** Frontmatter
`status` moved to the live enum value `active` (the docs-catalog enum has no "completed" value,
mirroring the `CHUNK`/`GATE_SCRIPT`/`ODATA` precedent). All 52 functional bypass scopes converted
to `withDalContext` (Stages 1–2); the import-boundary law (Stage 3,
`scripts/check-dynamics-context-boundary.js`) built per owner decision (build now, AST gate shape).
Post-execution fresh-context review: Codex adversarial review (round 1) found one P1 (Stage 3
rule 2 evadable via an aliased/namespace-form `withDynamicsContext` call) — folded same-session
(Stage Log). Trust-model tightening beyond the mechanical strip (Stage 4) remains an **OWNER
DECISION**, deferred per the plan's own recommendation.

**Evidence provenance.** Every call site's enclosing function, upstream auth guard, fn body, and caller
graph in the Classification tables was gathered by four fresh-context census sweeps this session
(recorded in the Stage Log); the wrapper/enforcement/gate/label-consumer facts were read directly this
session with the `[VERIFIED via file:line]` citations shown. Per-site facts sourced from a census sweep
carry `[census sweep N]`; treat the per-site table as the census of record, to be re-derived per file at
execution (Self-checking method).

**Objective.** Trusted Dataverse context must be established **only** via `withDalContext(scopeLabel, fn)`
(`lib/dataverse/core/context.js:46`) at post-auth entry points, plus the sanctioned script-only variant
`enterDynamicsBypassForScript` (`lib/services/dynamics-context.js:176`). Today **50 literal direct
`bypassDynamicsRestrictions(...)` call sites** remain in `pages/`+`lib/` (32 pages / 18 lib), plus **2
aliased default-parameter scopes** in the alert services (review round 1 finding 1) — **52 functional
bypass scopes / 40 files** total. This plan
converts each to `withDalContext` **in place, byte-identical**, then installs an import-boundary law so
that after the strip **only `lib/dataverse/core/context.js` may import `bypassDynamicsRestrictions`** from
the ALS module (the `withDalContext` wrapper is the one sanctioned importer). `withDalContext` is a thin,
DAL-labeled wrapper — `withDalContext(scopeLabel, fn)` is literally `return bypassDynamicsRestrictions(scopeLabel, fn)`
`[VERIFIED via lib/dataverse/core/context.js:53]` — so every swap in this plan is a behavior-identity swap,
not a semantics change.

**This is an auth/security surface.** `DATAVERSE_DAL_ENFORCEMENT` is **on in ALL environments** (prod
flipped explicit `on` 2026-07-04/S330; unset defaults to on outside production)
`[VERIFIED via lib/services/dynamics-context.js:124-129 isDalEnforcementOn + docs/agent-wiki/topics/dataverse-dynamics.md:48-56]`.
A **mis-scoped context = production write failures**: entity writes and the email helpers
(`createRecord`/`updateRecord`/`deleteRecord`/`disassociate`/`executeChangeset`/`createEmailActivity`/
`addEmailAttachment`/`sendEmail`) call `assertTrustedDalContext` first and throw with no trusted context
`[VERIFIED via 8 assertTrustedDalContext call sites in lib/services/dynamics-service.js:788-1340]`. The
failure class is the **drain-submissions latent defect** (`docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`
Stage Log S331 `[VERIFIED via ROUTE_SERVICE_CONSOLIDATION_PLAN.md:606-615]`): a code path whose Dataverse
writes ran with **no** trusted context fail-closed under the S330 flip; drain suites were green only
because they mocked `dynamics-service` wholesale, and prod logs were clean only because idle ticks returned
200 regardless. **A wrong swap that narrows or strands a Dataverse call outside its trusted scope
reproduces exactly that class.** Every stage leaves the full suite + all relevant gates green, and
characterization proves the inner Dataverse op still sees `hasTrustedDalContext() === true`.

**Executor profile.** Written to be executed by a cheaper model (Sonnet-class) with no prior context,
following this document plus each stage's checklist. Every judgment is pre-made here; anything not
pre-made is marked **STOP-AND-ASK**. The only behavioral STOP-AND-ASK site is
`onboard-reviewer-service.js:435` (variable label — pre-ruled safe, must re-confirm); the deferred items
are the Stage 3 import-law shape and the trust-model tightening, both OWNER DECISIONS.

---

## Baseline (probed, not assumed)

Counts re-derived this session from the disconfirming grep, **comment lines, the `withDalContext` wrapper
at `core/context.js:53`, and the `bypassDynamicsRestrictions` export/definition excluded** — these
corrections matter because the orchestrator's traced input counted some comment/import lines.

| Fact | Value | Evidence |
|---|---|---|
| Sanctioned wrapper | `withDalContext(scopeLabel, fn)` = `bypassDynamicsRestrictions(scopeLabel, fn)` | `[VERIFIED via lib/dataverse/core/context.js:46-54]` |
| `withDalContext` throws on non-string / empty label | **YES** | `[VERIFIED via lib/dataverse/core/context.js:47-49]` — `bypassDynamicsRestrictions` accepts a bare fn, so the label form must be checked before swapping (Decision 3) |
| Direct `bypassDynamicsRestrictions(` **call sites** in `lib/` (real, non-comment, ex-wrapper/def) | **18 calls / 12 files** | `[VERIFIED via grep -rn "bypassDynamicsRestrictions(" lib --include=*.js \| grep -v _archived, comment/wrapper/def stripped, this session]` — **CORRECTION** vs traced input's "28 calls / 19 files" (that counted 7 doc-comment lines, the `core/context.js:53` wrapper, and the `dynamics-context.js:67` definition) |
| Direct `bypassDynamicsRestrictions(` **call sites** in `pages/` | **32 calls / 26 files** | `[VERIFIED via same grep on pages, 1 comment stripped, this session]` — **CORRECTION** vs traced input's "28 calls / 27 files" |
| Literal direct-call strip scope | **50 calls / 38 files** | 18 lib + 32 pages |
| Aliased bypass scopes (default-parameter dependency `withDynamicsBypass = bypassDynamicsRestrictions`) | **2 scopes / 2 files** | `lib/services/alert-reviewer-email-mismatch.js:44` (call `:55`) and `lib/services/alert-reviewer-affiliation-mismatch.js` (import `:12`, default param `withDynamicsBypass = bypassDynamicsRestrictions` at `:66`, call `:77`) — invisible to the call-site grep because the call goes through the injected alias (review round 1 finding 1, P0) |
| **Functional bypass scopes — the true strip scope** | **52 scopes / 40 files** | 50 literal + 2 aliased |
| Any THIRD alias (stored reference / default param / re-export) beyond the two alert services? | **NONE found** | `[VERIFIED via grep -rn "bypassDynamicsRestrictions" lib pages shared modules (ALL references, not just calls), comments stripped, this session]` — every remaining non-call reference is a plain import line in a file already in the 40-file census; the assignment-pattern grep (`= *bypassDynamicsRestrictions\|export.*bypassDynamicsRestrictions`) matches only the two alert default-params. Executors re-run this ALL-references sweep at every pre-stage re-probe |
| Existing `withDalContext(` non-core call sites (real, non-comment) | **~50** | `[VERIFIED via grep -rn "withDalContext(" lib pages \| grep -v "_archived\|core/context", comments stripped, this session ≈ 50]` — **CORRECTION** vs traced input's "28"; the Route→Service campaign adopted it heavily. Not load-bearing for this plan (proves the target shape is dominant) |
| Label is inert? | **NO** — feeds state-leak detection | `[VERIFIED via lib/services/dynamics-service.js:229-233]` `checkRestriction` reads `ctx.requestId` (= the label) and warns on interleave mismatch. Labels MUST be byte-preserved in every swap (Decision 2) |
| Import cycle risk from importing `withDalContext`? | **NONE** | `core/context.js` imports only `../../services/dynamics-context.js` `[VERIFIED via core/context.js:31]`; `dynamics-context.js` imports only `node:async_hooks` `[VERIFIED via dynamics-context.js:37]`. No convertible file is imported by that chain → importing `withDalContext` anywhere is cycle-free |
| Enforcement in the test suite | **ON** | `[VERIFIED via jest.setup.js:44 DATAVERSE_DAL_ENFORCEMENT='on' + :35 NODE_ENV='test']` — any test exercising a converted path with a stranded Dataverse write THROWS. This is the global safety net |
| `scripts/` `bypassDynamicsRestrictions(` call sites | **46** | `[VERIFIED via grep -rn on scripts --include=*.js --include=*.mjs, comments stripped]` |
| `scripts/` already using `enterDynamicsBypassForScript` | **59 call sites / 58 script files** (+4 static-import lines) | `[VERIFIED via grep -rn "enterDynamicsBypassForScript(" scripts, non-import lines = 59; grep -rl = 58 files, this session]` — **CORRECTION** of this plan's own drafting figure "4 import sites" (review round 1 finding 4): that grep matched only static `import` lines; the idiom is in fact the dominant script pattern. The only `lib/` mentions are comments (`core/context.js:59`, `dynamics-service.js:222`) `[VERIFIED via grep this session]` |
| Law scan scope | `pages`, `lib`, `shared`, `modules` (NOT `scripts`, NOT `tests`) | `[VERIFIED via scripts/check-dataverse-access-layer.js:63 SCAN_DIRS]` — scripts/ and tests/ are out of scope by construction |
| Test files referencing `bypassDynamicsRestrictions` | 92 files | `[VERIFIED via grep tests/ this session]` — category (d), out of scan scope, left |
| Explorer's `withDynamicsContext` (non-empty restrictions) importers | only `pages/api/dynamics-explorer/chat.js` | `[VERIFIED via grep this session]` — a separate export; NOT touched (exempt tool, Decision 6) |
| DAL gate | `npm run check:dataverse-access-layer` (+ `:self-test`) — LAW mode | `[VERIFIED via package.json:70-71 + check-dataverse-access-layer.js:14 "law is unconditional"]` |
| Route/service gate | `npm run check:route-service-boundary` (+ `:self-test`) — LAW mode | `[VERIFIED via package.json:76-77]` |
| Full suite | `npm test` (`jest`) | `[VERIFIED via package.json test script]` |

### Why 26 pages routes still call bypass directly after the Route→Service campaign converted 49 routes

The Route→Service campaign (`docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`, census 49→0) counted routes whose
**census gate flags a `lib/dataverse/adapters/*` or `lib/services/dynamics-service` import**
`[VERIFIED via check-route-service-boundary.js:8-12]` and converted their `bypassDynamicsRestrictions`
wrappers to `withDalContext` while shelling (Decision 4). The 26 pages files here survived because they
fall **outside that gate's trigger** in three ways, each classified honestly below:

1. **Never in the boundary census** (majority): the file's `bypassDynamicsRestrictions` wraps a call to a
   `lib/services/<domain>` service or a `lib/external`/`lib/services` helper — it does **not** import an
   adapter or `dynamics-service` directly, so the route/service gate never counted it. Its remaining
   bypass wraps route-level framing (a membership check, an identity bridge, a PI-identity resolve, a
   single service call). Examples: all intake routes, the reviewer-finder streaming routes, the workbench
   thin shells, the cron routes `[census sweeps 1-2]`.
2. **Auth/infra plumbing**: `pages/api/auth/[...nextauth].js` is the NextAuth `signIn` callback itself —
   not an app route with `requireAppAccess`, never in any route census `[VERIFIED via nextauth.js:100,162,185 this session]`.
3. **Owner-deferred by the campaign**: Route→Service Decision 4 states the full bypass strip and
   trust-model tightening "comes at the end of the strip — not part of this plan"
   `[VERIFIED via ROUTE_SERVICE_CONSOLIDATION_PLAN.md:101-103]`. **This plan is that end-of-strip work.**

---

## The sanctioned wrapper (pin before touching anything)

`withDalContext(scopeLabel, fn)` `[VERIFIED via lib/dataverse/core/context.js:46-54]`:

- Throws if `scopeLabel` is missing / non-string / empty (`:47-49`).
- Otherwise `return bypassDynamicsRestrictions(scopeLabel, fn)` (`:53`) — which runs `fn` inside
  `withDynamicsContext({ restrictions: [], requestId: scopeLabel }, fn)`
  `[VERIFIED via dynamics-context.js:67-76]`.

**The invariant every swap preserves:** the label string (→ `requestId`, consumed by state-leak
detection) and the `fn` body, byte-for-byte. The swap replaces only the **callee name** and the **import**
— never the arguments, never the scope, never the body. Nesting is safe: AsyncLocalStorage replaces the
store for the inner scope and restores the outer on return `[VERIFIED via dynamics-context.js:16-20]`, so
a converted call that runs inside an already-established context behaves exactly as it does today.

Explorer's restriction-bearing `withDynamicsContext({ restrictions, requestId }, fn)` is a **different
export** and is **out of scope** (Decision 6).

---

## Classification (every in-scope site, with evidence)

Per-site facts `[census sweeps 1-4 this session]`; wrapper/enforcement facts `[VERIFIED via file:line]` as
cited.

**Classification scheme.**
- **(a) MECHANICAL-RENAME** — wraps a **post-auth entry point** exactly as `withDalContext` would. Swap =
  `withDalContext('<same-label>', <same fn>)`, import swapped to `lib/dataverse/core/context`. Label is a
  string literal.
- **(b) SEMANTIC** — wraps a **non-post-auth boundary** (a `lib/` service/helper). Pre-ruled here:
  **convert-in-place to `withDalContext` is behavior-identical and doctrinally sound** because every traced
  caller reaches the site post-auth/post-token/post-cron-secret. The *nesting-removal / push-context-up*
  optimization is **deferred to the OWNER DECISION** trust-model tightening (Stage 4). One site is a true
  STOP-AND-ASK (variable label).
- **(c) SCRIPT** — `scripts/` sites; out of the law's scan scope.
- **(d) TEST/MOCK** — `tests/` references; out of scan scope, left.

No site passes **non-empty** restrictions — every `bypassDynamicsRestrictions` call uses `restrictions: []`
`[VERIFIED via dynamics-context.js:67-76]`; the only non-empty-restriction caller is Explorer via
`withDynamicsContext` (Decision 6). So no (b) site is semantic-by-restrictions; all (b) sites are
semantic-by-boundary.

### (a) MECHANICAL-RENAME — pages post-auth entry points (32 sites / 26 files)

Recipe at every site: swap the import to `import { withDalContext } from '<rel>/lib/dataverse/core/context';`
and rename `bypassDynamicsRestrictions(` → `withDalContext(` at the call, **label and fn byte-identical**.
Multi-line calls (label on its own line, e.g. `discover.js`/`enrich-contacts.js`) rename the callee only.

**A1 — app-auth routes (`requireAppAccess`/`requireSuperuser`/applicant session) — 21 sites / 16 files** `[census sweep 1]`

| # | Site | Label | Upstream guard | Scope |
|---|---|---|---|---|
| 1 | `pages/api/admin/reconcile-identities.js:29` | `admin-reconcile-identities` | `requireSuperuser` `:23` | one service call |
| 2 | `pages/api/review-manager/upload-review.js:77` | `review-manager-upload` | `requireAppAccess('review-manager','reviewers')` `:38` | one service call |
| 3 | `pages/api/review-manager/send-review-reminder.js:59` | `review-manager-send-review-reminder` | `requireAppAccess` `:44` | one service call |
| 4 | `pages/api/intake/submit.js:136` | `intake-submit-bridge` | applicant session `:99-106` | identity bridge sub-section |
| 5 | `pages/api/intake/submit.js:187` | `intake-submit-membership` | applicant session `:99-106` | membership check sub-section |
| 6 | `pages/api/intake/draft.js:117` | `intake-draft-bridge` | applicant session `:79-85` | identity bridge |
| 7 | `pages/api/intake/draft.js:161` | `intake-draft-membership` | applicant session `:79-85` | membership check |
| 8 | `pages/api/intake/draft/attach.js:140` | `intake-attach-bridge` | applicant session `:86-92` | bridge (non-direct-owner branch `:135`) |
| 9 | `pages/api/intake/draft/attach.js:172` | `intake-attach-membership` | applicant session `:86-92` | membership (non-direct-owner) |
| 10 | `pages/api/intake/draft/upload-token.js:138` | `intake-upload-token-bridge` | applicant session `:74-80` | bridge (non-direct-owner branch `:134`) |
| 11 | `pages/api/intake/draft/upload-token.js:173` | `intake-upload-token-membership` | applicant session `:74-80` | membership (non-direct-owner) |
| 12 | `pages/api/reviewer-finder/enrich-contacts.js:135` | `reviewer-enrich-contacts-pi-identity` | `requireAppAccess` `:56` | PI-identity resolve sub-section |
| 13 | `pages/api/reviewer-finder/prompt-override.js:54` | `prompt-override-base` | `requireAppAccess` `:36` | one read; bypass sits in in-file helper `loadBase`, called post-auth |
| 14 | `pages/api/reviewer-finder/discover.js:182` | `reviewer-discover-pi-identity` | `requireAppAccess` `:81` | PI-identity resolve |
| 15 | `pages/api/reviewer-finder/discover.js:413` | `reviewer-discover-referred-seeds` | `requireAppAccess` `:81` | referred-seed identity lookup block |
| 16 | `pages/api/reviewer-finder/analyze.js:182` | `reviewer-finder-analyze-request-context` | `requireAppAccess` `:48` | request-context load |
| 17 | `pages/api/reviewer-finder/merge-candidates.js:40` | `merge-candidates` | `requireAppAccess` `:23` | whole handler body |
| 18 | `pages/api/workbench/reviewer-rollup.js:41` | `workbench-reviewer-rollup` | `requireAppAccess('reviewers')` `:31` | whole handler body |
| 19 | `pages/api/workbench/reviewer-lookup.js:56` | `workbench-reviewer-lookup` | `requireAppAccess` `:42` | whole handler body |
| 20 | `pages/api/workbench/grantee-deliverables/preview-invite.js:52` | `grantee-preview-invite` | `requireAppAccess('reviewers')` `:39` | whole handler body |
| 21 | `pages/api/workbench/grantee-deliverables/website-html.js:43` | `grantee-website-html` | `requireAppAccess('reviewers')` `:34` | whole handler body |

**A2 — external routes (post-token verification) — 4 sites / 4 files** `[census sweep 2]`. The token IS the
auth (matches the Route→Service "token boundaries byte-identical" precedent, Stage Log Batch 3).

| # | Site | Label | Upstream guard |
|---|---|---|---|
| 22 | `pages/api/external/review/[token]/proposal.js:56` | `external-validate-file` | `verifySuggestionToken` `:38` + op-claim `:50` |
| 23 | `pages/api/external/review/[token]/upload.js:95` | `external-upload` | `verifySuggestionToken` `:40` + op-claim `:52` |
| 24 | `pages/api/external/grantee/[token]/submit.js:67` | `grantee-submit` | `verifyGranteeToken` `:41` + status guard `:50` |
| 25 | `pages/api/external/grantee/[token]/context.js:62` | `grantee-portal-preview` | `verifyGranteeToken` `:88`; bypass in in-file helper `buildPreviewHtml`, called post-verify `:115` |

**A3 — cron routes (post-`verifyCronSecret`) — 5 sites / 5 files** `[census sweep 2]`. Matches sanctioned
siblings `cron/send-review-thankyous.js:45` and `cron/grantee-deliverable-reminders.js:29`, which already
use `withDalContext` immediately after `verifyCronSecret`.

| # | Site | Label | Upstream guard |
|---|---|---|---|
| 26 | `pages/api/cron/sweep-stale-invites.js:36` | `cron-sweep-stale-invites` | `verifyCronSecret` `:26` |
| 27 | `pages/api/cron/reconcile-identities.js:32` | `cron-reconcile-identities` | `verifyCronSecret` `:27` |
| 28 | `pages/api/cron/reviewer-email-reconcile.js:38` | `cron-reviewer-email-reconcile` | `verifyCronSecret` `:31` |
| 29 | `pages/api/cron/reviewer-reminders.js:43` | `cron-reviewer-reminders` | `verifyCronSecret` `:35` |
| 30 | `pages/api/cron/drain-reviewer-acceptances.js:34` | `cron-drain-reviewer-acceptances` | `verifyCronSecret` `:27` |

**A4 — auth-infra plumbing (special sub-class) — 2 sites / 1 file** `[VERIFIED via nextauth.js:100,162,185 this session]`

| # | Site | Label | Note |
|---|---|---|---|
| 31 | `pages/api/auth/[...nextauth].js:162` | `staff-signin-reconcile` | Inside the NextAuth `signIn` callback (`:100`), gated `account?.provider === 'azure-ad'`, runs **after** the OAuth provider authenticated the user. Fire-and-forget (`.catch(()=>{})`) `reconcileProfile(...)` (a Dynamics identity write). |
| 32 | `pages/api/auth/[...nextauth].js:185` | `staff-signin-reconcile` | Same, new-profile branch. |

**Ruling for A4 (pre-made):** MECHANICAL-RENAME. The `signIn` callback is post-authentication, and
`reconcileProfile`'s Dynamics write **requires** a trusted context under enforcement — so a labeled
`withDalContext` here is correct and behavior-identical. It is the **one non-route-guard entry** (an
identity-provisioning layer, not a `requireAppAccess` route). Flagged for OWNER awareness (Stage 4) but
**not** a STOP-AND-ASK — the swap changes nothing.

### (b) SEMANTIC — lib boundaries, pre-ruled convert-in-place (20 scopes / 14 files) `[census sweeps 3-4 + review round 1 finding 1]`

**Ruling (pre-made, do not relitigate for the mechanical strip):** each site converts in place to
`withDalContext('<same-label>', <same fn>)` with the import swapped to `lib/dataverse/core/context`.
Behavior is byte-identical (`withDalContext` === `bypassDynamicsRestrictions`), and every traced caller
reaches the site post-auth. The **CONTEXT column** below records whether the site is an entry-seam
(context load-bearing — the swap must keep it), nested-redundant (harmless once renamed; *removal* is the
deferred tightening), defensive-mixed, or MIXED. **No (b) site is removed in this plan.**

| # | Site | Label | Enclosing fn / body | Context (traced) |
|---|---|---|---|---|
| 33 | `lib/services/notification-service.js:176` | `notification-email` | `sendAdminEmail` → `DynamicsService.createAndSendEmail` | **ENTRY-seam** — called fire-and-forget from auth callback (`nextauth.js:160/183`) with no ambient context; the email write is runtime-guarded by `assertTrustedDalContext` |
| 34 | `lib/services/maintenance-service.js:230` | `bill-onboarding-resume` | `sweepBillOnboarding` → `grantRequestAdapter.updateById` | **ENTRY-seam** — sole caller `cron/maintenance.js:109` establishes no context |
| 35 | `lib/services/maintenance-service.js:349` | `maintenance-blob-scan` | `cleanupBlobs` → 2 read adapters | **ENTRY-seam** — sole caller `cron/maintenance.js:146`, no ambient context |
| 36 | `lib/services/execute-prompt.js:77` | `execute-prompt` | `executePrompt` → whole executor pipeline (incl. `logAiRun` write) | **MIXED** — seam via `phase-i-dynamics/summarize-v2.js:71` (no upstream context); nested via 4 other routes that establish `withDalContext` |
| 37 | `prompt-resolver.js:108` (`lib/services/prompt-resolver.js`, read in full :1-151) | `prompt-resolver` | `_fetchFromDynamics` → `aiRunAdapter.getByIdWithSelect` | **DEFENSIVE / script-only** — per header `:8-9,:19-22` PromptResolver is used ONLY by maintenance scripts, NOT live API routes (live path is `execute-prompt.js`); intentional narrow system-data read "even when the caller is in a restricted context" `[VERIFIED via prompt-resolver.js:8-9,19-22,105-109 this session]`. Convert-in-place still behavior-identical and required for the import-law |
| 38 | `lib/services/reviewer-prompt-resolver.js:91` | `reviewer-prompt-resolve` | `resolveReviewerPrompt` → `fetchCurrentPrompt` | **DEFENSIVE-shared** — resolver owns the wrap for its read (header `:20-23`) |
| 39 | `lib/services/contact-enrichment-service.js:1540` | `contact-enrichment-save` | `saveToDatabase` → potential-reviewer upsert/update | **DEFENSIVE-mixed** — some callers (`save-candidates.js`) establish context, others don't (comment `:1534-1539`) |
| 40 | `lib/services/cron/drain-submissions-service.js:435` | `drain-recover-request-created` | `recoverRequestCreated` → `grantRequestAdapter.getById` | **NESTED-redundant** — called only at `:413` inside a state handler dispatched under `withDalContext('drain-submissions')` `[VERIFIED via drain-submissions-service.js:413,432-436,837 this session]` |
| 41 | `lib/bill/onboard-reviewer-service.js:184` | `bill-onboard-pre-read` | `onboardReviewer` → `contacts.getBillingFieldsById` | **MIXED** — HTTP entry (`bill/onboard-reviewer.js:80`, HMAC only, no context) / cron nested (drain-reviewer-acceptances) |
| 42 | `lib/bill/onboard-reviewer-service.js:398` | `bill-onboard-contact-patch` | `patchContactBillcomId` → `contacts.updateFields` | **MIXED** (same caller graph) |
| 43 | `lib/bill/onboard-reviewer-service.js:435` | **VARIABLE `context`** | `patchAkoyaRequestWithRetry` → `requests.updateById` | **MIXED + variable label — STOP-AND-ASK** `[VERIFIED via onboard-reviewer-service.js:415,422,432-437 this session]` |
| 44 | `lib/external/review-answer-snapshot.js:67` | `read-ratings-by-suggestion` | `readRatingsBySuggestion` → adapter read | **ENTRY-seam** — sole caller `external-review/context-service.js:124` runs as a *sibling* to (not inside) that file's `withDalContext` blocks; route `external/review/[token]/context.js:41` does not wrap `buildReviewContext` |
| 45 | `lib/external/verify-grantee-token.js:67` | `grantee-token-verify` | `verifyGranteeToken` → 2 reads during verification | **ENTRY-seam** — this IS the post-token verification; runs first in the grantee routes, before their own scopes |
| 46 | `lib/external/verify-suggestion-token.js:147` | `external-token-verify` | `verifySuggestionToken` → `getForExternalVerification` | **ENTRY-seam** — this IS the post-token verification for every external review route |
| 47 | `lib/external/token-lifecycle.js:55` | `external-token-mint` | `mintAndStore` → `setExternalToken` write | **NESTED-redundant** — all traced callers already inside a context |
| 48 | `lib/external/token-lifecycle.js:70` | `external-token-revoke` | `revoke` → `revokeExternalToken` write | **ENTRY-seam** — sole caller `review-manager/revoke-token.js:40` is `requireAppAccess`-only, establishes no Dataverse context |
| 49 | `lib/external/token-lifecycle.js:94` | `ensure-token-read` | `ensureToken` → `getForTokenStatus` | **NESTED-redundant** — sole caller `my-candidates-service.js:562` runs under `withDalContext('my-candidates')` |
| 50 | `lib/external/token-lifecycle.js:158` | `external-token-post-submission` | `extendForPostSubmissionWindow` → `extendExternalTokenExpiry` write | **NESTED-redundant** — sole caller `review-upload.js:270` (`writeReviewFiles`) always runs inside an established context |
| 51 | `lib/services/alert-reviewer-email-mismatch.js:44` (default param) + `:55` (call through alias `withDynamicsBypass`) | `external-reviewer-email-mismatch-contact-read` | `alertReviewerEmailMismatch` → `contactsAdapter.getById` read + notify | **ALIASED default-param scope** `[VERIFIED via Read in full this session: import :11, default `withDynamicsBypass = bypassDynamicsRestrictions` :44, call :55]`. Convert-in-place: the DEFAULT becomes `withDynamicsBypass = withDalContext`; the injected-deps path (tests, any caller passing `deps.withDynamicsBypass`) is untouched. Label byte-preserved |
| 52 | `lib/services/alert-reviewer-affiliation-mismatch.js:66` (default param) + `:77` (call through alias) | `external-reviewer-affiliation-mismatch-contact-read` | `alertReviewerAffiliationMismatch` → `contactsAdapter.getInstitutionById` read + notify | **ALIASED default-param scope** (read in full this session: import `:12`, default `:66`, call `:77` — see the Baseline alias row for the read-guard escape). Same convert-in-place ruling as site 51 |

**Ruling for sites 51-52 (pre-made, review round 1 finding 1 P0):** the swap edits the **default-parameter
initializer only** — `withDynamicsBypass = bypassDynamicsRestrictions` → `withDynamicsBypass = withDalContext`
— plus the import swap; call sites `:55`/`:77`, labels, and the `deps` injection contract are byte-identical.
Because their existing tests inject `withDynamicsBypass` (`tests/unit/alert-reviewer-email-mismatch.test.js:14`,
`tests/unit/alert-reviewer-affiliation-mismatch.test.js:18` `[VERIFIED via sed of both this session]`),
**today's suites never exercise the default path** — Stage 0 adds a DEFAULT-path characterization for each
(call with no `deps.withDynamicsBypass`, mock only the adapter, assert `hasTrustedDalContext() === true`
inside the adapter call) before the swap.

**STOP-AND-ASK — site 43 (`onboard-reviewer-service.js:435`).** The label is the variable `context`
(param of `patchAkoyaRequestWithRetry`), bound at its two call sites to the string literals
`'bill-onboard-request-patch-yes'` (`:415`) and `'bill-onboard-request-patch-no'` (`:422`)
`[VERIFIED via onboard-reviewer-service.js:415,422,432 this session]`. `withDalContext` throws on a
non-string label, so a static string-label precheck (the guard Route→Service Decision 4a used) **cannot
statically prove** `context` is a string. **Pre-ruling: safe** — both call sites pass literals, so
`withDalContext(context, fn)` passes the `:47` check at runtime. **Executor must re-confirm** the two
literal bindings before swapping and run the bill-onboard suite (which exercises both paths) under
enforcement-on. If a future call site ever passed a non-string, the swap would throw — hence STOP-AND-ASK
rather than a blind mechanical swap.

### (c) SCRIPT — `scripts/` (46 sites) — OUT of the law's scan scope, recommend LEAVE

`scripts/` is not in `SCAN_DIRS` (`pages`/`lib`/`shared`/`modules`) `[VERIFIED via check-dataverse-access-layer.js:63]`,
so the Stage 3 import-law never sees these. **Recommendation: LEAVE as-is.** The sanctioned script idiom
is `enterDynamicsBypassForScript(label)` — a persistent `enterWith` "set once at top, run forever" context
that is UNSAFE in concurrent request handling but correct for single-process CLIs
`[VERIFIED via dynamics-context.js:154-178 SCRIPT-ONLY contract]`. Migrating 46 callback-scoped
`bypassDynamicsRestrictions(label, fn)` sites to the persistent variant is a **behavior change** (scoped →
process-wide) and a larger refactor with no law-driven need. Record as optional future work; a new script
should prefer `enterDynamicsBypassForScript`. (This mirrors how `CHUNK`/`GATE_SCRIPT` plans treated
`scripts/` as out of scope.)

### (d) TEST/MOCK — `tests/` (92 files) — OUT of scan scope, LEAVE

`tests/` is not in `SCAN_DIRS`. Test files legitimately import/mock `bypassDynamicsRestrictions`; they are
never touched and never trip the law.

---

## Architecture decisions (pre-made — executors do not relitigate)

1. **Behavior-identity swap.** Every (a) and (b) swap replaces only the **callee name** and the **import
   source**; the label string and the `fn` are byte-identical, the scope is unchanged. Do not reflow,
   re-indent, or move the wrapper's boundary. Widening or narrowing scope is a **different change** and is
   forbidden in this plan (that is the drain-defect failure class).
2. **Labels are byte-preserved.** The first argument is the `requestId` consumed by state-leak detection
   (`dynamics-service.js:229-233`). Copy it character-for-character. Site 43's variable label is copied as
   the variable `context`.
3. **String-label precheck before every swap.** `withDalContext` throws on a non-string/empty label
   (`core/context.js:47-49`). All 51 literal-label scopes (49 literal direct calls + sites 51-52, whose
   labels at `:55`/`:77` are literals) are safe by inspection. Site 43 (variable) is the
   STOP-AND-ASK: confirm both bindings are string literals before swapping.
4. **Import form matches the file.** ESM files (`import { withDalContext } from '<rel>/lib/dataverse/core/context';`);
   the CJS files use `const { withDalContext } = require('<rel>/dataverse/core/context');`. Importing
   `withDalContext` is cycle-free everywhere (Baseline). When a file no longer calls
   `bypassDynamicsRestrictions` after its swaps, **remove its `bypassDynamicsRestrictions` import** in the
   same commit (the law checks imports, not just calls).
5. **(b) sites convert in place; none are removed.** Entry-seam, nested-redundant, defensive, and MIXED
   (b) sites all become `withDalContext` in place. Nested-redundant sites stay nested (harmless — ALS
   restores the outer store). **Removing a redundant nested wrapper is the Stage 4 OWNER-DECISION
   tightening, NOT this strip** — removal risks stranding a Dataverse call for any direct/test caller that
   does not establish context (sites 40, 47, 49, 50 are exported and/or test-invoked).
6. **Explorer is exempt from the STRIP; empty-restrictions `withDynamicsContext` is NOT exempt from the
   LAW.** The Explorer's loaded-restrictions `withDynamicsContext({ restrictions, requestId }, fn)`
   (`chat.js:124`, restrictions from `getActiveRestrictions()`) is a different, sanctioned use and is never
   touched. But `withDynamicsContext({ restrictions: [] }, fn)` is functionally identical bypass
   (`dynamics-context.js:67-76` — `bypassDynamicsRestrictions` IS that call), so the Stage 3 law also
   covers the empty/unresolvable-restrictions shape (review round 1 finding 2).
7. **One commit per cluster, gates between.** Cluster by directory/domain; each cluster leaves the build
   green with `check:dataverse-access-layer` (+ self-test), `check:route-service-boundary` (+ self-test),
   and the targeted suite.

## Non-goals

Changing any label, scope, restriction set, or fn body; widening/narrowing any trusted-context boundary;
**removing** any nested-redundant wrapper (Stage 4 tightening); pushing lib-established context up to its
entry point (Stage 4); migrating `scripts/` to `enterDynamicsBypassForScript`; touching Explorer's
`withDynamicsContext`; touching `tests/`; converting any file's module system; adding a new restriction
concept or a second notion of trust.

---

## Self-checking method

**Pre-stage re-probe.** Before each stage, re-run the disconfirming census greps (Stage Log) — the lib and
pages `bypassDynamicsRestrictions(` call sweeps, the **ALL-references alias sweep** (every
`bypassDynamicsRestrictions` token in `lib`/`pages`/`shared`/`modules`, so a new default-param /
stored-reference / re-export alias like sites 51-52 cannot hide from a call-shaped grep — review round 1
finding 1), AND the growing `withDalContext(` sweep — and diff against this
plan's Classification. Drift → update the stage list BEFORE starting and log the delta. Never execute
against a stale list.

**Characterization = the drain-test pattern, per converted site cluster.** For each cluster, before
swapping, add or confirm a test that drives the real context machinery (NO `dynamics-context`/`core-context`
mocks) and asserts the inner Dataverse op sees `hasTrustedDalContext() === true` — the pattern of
`tests/unit/drain-submissions-dal-context.test.js` `[VERIFIED via Read this session]`. Because the swap is
a behavior-identity rename, the SAME test must stay green after the swap (proving the boundary is
unchanged). Prioritize sites whose scope is a sub-section (intake bridge/membership, PI-identity) or whose
context is entry-seam/MIXED (sites 33-36, 41-46, 48) and the aliased sites 51-52; whole-body wraps and
nested-redundant sites are lower-risk but still covered by the global safety net below.

**Negative controls are REQUIRED, not optional (review round 1 finding 3, P1).** A positive-only
`hasTrustedDalContext() === true` pin is decorative wherever a test mocks or injects the context machinery
— exactly how sites 51-52 are invisible today: their suites inject `withDynamicsBypass`
(`alert-reviewer-email-mismatch.test.js:14`, `alert-reviewer-affiliation-mismatch.test.js:18`) and never
run the default import. The generic failure pins already exist and are the baseline to cite:
`tests/unit/dal-enforcement.test.js:78` (`assertTrustedDalContext` throws outside any context with
enforcement on) and `:91-96` (`DynamicsService.createRecord` rejects BEFORE any network call)
`[VERIFIED via sed of tests/unit/dal-enforcement.test.js:70-100 this session]`. For the high-risk
clusters — the NextAuth fire-and-forget (A4), the entry-seam/MIXED lib services (33-36, 41-43, 44-46, 48),
the token-verification seams (45-46), and the two alert services (51-52) — Stage 0 must add, per cluster,
EITHER (i) a **negative control**: the same inner op invoked OUTSIDE any context still rejects with
"no trusted Dataverse context" (proving the positive pin actually exercises enforcement), OR (ii) a
**same-adapter enforcement probe**: drive the real adapter write/read path with no context and assert the
fail-closed rejection. A cluster whose positive pin cannot be paired with a working negative control is a
mocked-out pin — rewrite it before trusting it.

**The global safety net.** `jest.setup.js:44` runs the suite with `DATAVERSE_DAL_ENFORCEMENT='on'`, so any
test that exercises a converted path with a Dataverse call stranded outside a trusted scope **throws**.
This is the same net that would have caught the drain defect had drain not mocked `dynamics-service`
wholesale — so per-cluster, run the touched routes'/services' real-context tests, not just mocked ones.

**Green gates between stages.** Targeted `jest`, then `check:dataverse-access-layer` (+ `:self-test`),
`check:route-service-boundary` (+ `:self-test`), and `npm test` at close. A gate and its self-test run
**sequentially, never in parallel**. A red gate is a P0 stop.

**Post-execution fresh-context review.** After each stage, a FRESH-context agent (Codex preferred; else a
new-session agent that has read only this plan + the diff) verifies: every swapped site preserves label +
fn + scope byte-identically; no import of `bypassDynamicsRestrictions` remains in a swapped file; no (b)
site was removed; no Explorer/`withDynamicsContext` or script/test site was touched; the characterization
tests prove trusted context at the inner op. High findings block.

---

## Stages

### Stage 0 — Characterization harness (no production behavior change)

1. Re-run the disconfirming census greps: the lib + pages `bypassDynamicsRestrictions(` call sweeps AND
   the ALL-references alias sweep (Self-checking method); confirm the 52-scope / 40-file list (50 literal
   + sites 51-52) still matches, and that no NEW alias shape has appeared (log any drift).
2. For every cluster in Stages 1-2, ensure a real-context test exists that asserts
   `hasTrustedDalContext() === true` at the inner Dataverse op (drain-test pattern), **paired with the
   required negative control / enforcement probe for the high-risk clusters** (Self-checking method,
   finding 3). Add where missing,
   prioritizing sub-section-scoped and entry-seam/MIXED sites (33-36, 41-46, 48). For site 43, add a test
   that drives both `patchAkoyaRequestSuccess`/`patchAkoyaRequestNoMatch` paths under enforcement-on.
   For sites 51-52, add the DEFAULT-path characterization (no injected `withDynamicsBypass`) — the
   existing suites inject the dependency and never run the default import.
3. Confirm the full suite is green at the current baseline count with `DATAVERSE_DAL_ENFORCEMENT='on'`.
4. **Done means:** characterization tests exist and are green (proving trusted context at each cluster's
   inner op TODAY); full suite green; commit.

### Stage 1 — pages MECHANICAL-RENAME (32 sites / 26 files), clusters A1-A4

Per-cluster loop: swap the import → rename each call (label/fn/scope byte-identical) → remove the now-dead
`bypassDynamicsRestrictions` import → run the cluster's Stage 0 characterization + targeted suite (must
stay green) → `check:dataverse-access-layer` (+ self-test) and `check:route-service-boundary` (+ self-test)
→ commit.

- **Cluster A1 — app-auth routes** (sites 1-21, 16 files): admin, review-manager (2), intake (8),
  reviewer-finder (5), workbench (4).
- **Cluster A2 — external routes** (sites 22-25, 4 files).
- **Cluster A3 — cron routes** (sites 26-30, 5 files).
- **Cluster A4 — auth-infra** (sites 31-32, `nextauth.js`): both labels `staff-signin-reconcile`, byte-preserved.

**Done means:** all 32 pages sites call `withDalContext`; no `bypassDynamicsRestrictions` import remains in
any of the 26 files; Stage 0 characterization unchanged-green; full suite green.

**STOP-AND-ASK:** if any swap would change a characterization test's trusted-context assertion, STOP — the
site was misclassified or the scope changed.

### Stage 2 — lib SEMANTIC convert-in-place (20 scopes / 14 files), clusters B1-B3

Same per-cluster loop as Stage 1 (import swap + byte-identical rename + dead-import removal + gates).

- **Cluster B1 — lib/services** (sites 33-40 + 51-52): notification, maintenance (2), execute-prompt,
  prompt-resolver, reviewer-prompt-resolver, contact-enrichment, drain-submissions (`:435`), and the two
  ALIASED alert services (default-param initializer swap per the sites 51-52 ruling; run their new
  DEFAULT-path characterization from Stage 0). Run the drain
  DAL-context test (`drain-submissions-dal-context.test.js`) — it must stay green (site 40 stays nested).
- **Cluster B2 — lib/bill** (sites 41-43): onboard-reviewer-service. **Handle site 43 per the STOP-AND-ASK**
  (confirm the two literal bindings; run the bill-onboard suite under enforcement-on before committing).
- **Cluster B3 — lib/external** (sites 44-50): review-answer-snapshot, verify-grantee-token,
  verify-suggestion-token, token-lifecycle (4).

**Done means:** all 20 lib scopes route through `withDalContext` (18 direct calls renamed + 2 default-param
initializers retargeted); no `bypassDynamicsRestrictions` import remains in
the 14 files; every characterization test (positive pins + negative controls + the 51-52 default-path
tests) green; full suite green. After Stage 2, the **only**
`bypassDynamicsRestrictions` importer in `pages`/`lib`/`shared`/`modules` is
`lib/dataverse/core/context.js`.

**STOP-AND-ASK:** site 43 as specified; any (b) site whose characterization would change (means a caller
does NOT establish context where assumed → the site is a true seam that must keep its wrap, still fine as a
rename, but log it).

### Stage 3 — Import-boundary law (OWNER DECISION on shape; ratchet-then-law)

Install a gate so a NEW direct `bypassDynamicsRestrictions` import outside the sanctioned wrapper cannot
reappear. **Owner decides the shape**; recommendation follows.

- **Recommended: a sibling gate `scripts/check-dynamics-context-boundary.js`** (do NOT overload
  `check-dataverse-access-layer.js` — that gate is a DynamicsService *transport-call* census, a different
  concern from an *import-graph/bypass-shape* check). The gate scans `SCAN_DIRS` =
  `pages`/`lib`/`shared`/`modules` and fails on **any of three bypass shapes** outside the sanctioned
  importer `lib/dataverse/core/context.js`:
  1. any `import`/`require`/dynamic-import/re-export of `bypassDynamicsRestrictions` from the
     `dynamics-context` module;
  2. **any `withDynamicsContext` call whose `restrictions` is a literal/known-empty array** —
     `withDynamicsContext({ restrictions: [] }, fn)` is functionally identical bypass and would evade a
     bypass-import-only gate (review round 1 finding 2, P1). **Fail CLOSED on non-literal `restrictions`
     expressions** (a variable the gate cannot resolve is a potential empty-array bypass), EXCEPT the one
     sanctioned live path: the Explorer's loaded-restrictions call at
     `pages/api/dynamics-explorer/chat.js:124` (`{ restrictions, requestId }` where `restrictions` comes
     from `getActiveRestrictions()`; import at `:29`) `[VERIFIED via sed of chat.js:25-32,120-128 this
     session — the ONLY live withDynamicsContext caller outside dynamics-context.js per grep]`. Simplest
     carve-out: keep the DAL gate's existing `pages/api/dynamics-explorer/` exempt-dir precedent
     (`check-dataverse-access-layer.js:75-81`) for this rule only;
  3. **any `enterDynamicsBypassForScript` import/call appearing outside `scripts/`** (its SCRIPT-ONLY
     contract, `dynamics-context.js:154-178`; today's only `lib/` mentions are comments —
     `core/context.js:59`, `dynamics-service.js:222` `[VERIFIED via grep this session]`).

  It reuses `scripts/lib/ast-scan-core.js`
  import/require recognizers (the same helpers `check-dataverse-access-layer.js` and
  `check-route-service-boundary.js` use, so all indirection shapes — static import, ESM re-export, dynamic
  `import()`, inline `require()`, aliased bindings — are recognized and non-literal sources fail closed).
  `withDalContext` calls stay allowed anywhere. **Ratchet-then-law:** while any lib site still imports
  bypass (before Stage 2 completes), run in `--report` count mode; flip to fail-closed law (census 0, no
  allowlist, no ratchet) once Stage 2 lands, mirroring the DAL/route ratchet-then-law playbook.
- **Alternative:** an ESLint `no-restricted-imports` rule on the `bypassDynamicsRestrictions` named import
  with a `lib/dataverse/core/context.js` override. Weaker (misses dynamic import / require indirection,
  cannot see the empty-restrictions `withDynamicsContext` shape at all, couples to lint config) —
  recommend the AST gate.

Register the chosen gate in `package.json` (`check:dynamics-context-boundary` + `:self-test`),
`docs/CI_GATES_REFERENCE.md`, the `/start` gate list, and `.github/workflows/test.yml`. Ship a self-test
proving the REQUIRED fixture list (expanded per review round 1 finding 2): (i) a new violating static
import; (ii) an aliased named import (`import { bypassDynamicsRestrictions as x }`); (iii) namespace /
member access (`ctx.bypassDynamicsRestrictions`); (iv) dynamic `import()`; (v) inline `require()`;
(vi) a re-export; (vii) a non-literal require/import source → fail closed; (viii) a literal
empty-restrictions `withDynamicsContext({ restrictions: [] }, fn)` → RED; (ix) a non-literal-restrictions
`withDynamicsContext` outside the Explorer carve-out → RED (fail closed); (x) `enterDynamicsBypassForScript`
appearing outside `scripts/`/`tests/` → RED; plus GREEN fixtures for `withDalContext` usage, the sanctioned
`core/context.js` importer, the Explorer's loaded-restrictions path, and `scripts/`/`tests/` files.

**STOP-AND-ASK** on whether to build it now vs. defer, and on grep/AST-gate vs. ESLint. **Done means:** if
built — gate + self-test green at census 0, registered everywhere the sibling gates are; if declined —
record the decision here and skip (the strip still stands; only the anti-regression ratchet is absent).

### Stage 4 — Trust-model tightening beyond the mechanical strip (OPTIONAL — OWNER DECISION)

Beyond the behavior-identity strip, the doctrinal ideal is that context is established **only at the
thinnest post-auth boundary**, with **no redundant nesting**. That means:
- **Removing** the nested-redundant wrappers (sites 40, 47, 49, 50) so the read/write relies on the
  upstream `withDalContext` — but only after proving **every** call path (including exported/test callers)
  is in-context; otherwise the removal strands a Dataverse call and fail-closes in prod (the drain-defect
  class).
- **Pushing entry-seam context up** for the thin-caller seams (e.g. establish `withDalContext` in
  `cron/maintenance.js`, `bill/onboard-reviewer.js`, `review-manager/revoke-token.js` and drop the lib
  wrapper) so lib services stop establishing context — matching the Route→Service Decision 3 doctrine
  ("services assume a trusted DAL context already exists; establishment stays at the route").

Each of these is a per-caller-fanout exercise with the drain-defect risk and is explicitly **out of the
mechanical strip** (Route→Service Decision 4: "trust-model tightening comes at the end of the strip").
**Owner decides** whether to pursue it, per-site, with the same acceptance bar (characterization proving
trusted context at the inner op, fresh-context review, gates green). **Recommendation:** defer — the
mechanical strip + Stage 3 law already delivers the objective's enforcement (only `core/context.js` imports
bypass); nesting removal is a cosmetic/doctrinal cleanup that trades real drain-class risk for marginal
benefit.

---

## Stage Log

*(append-only; every entry records: date/session, commits, sites touched, test totals, review verdict)*

- 2026-07-05: **Plan drafted (`status: draft`). NOT executed, NOT reviewed.** Census probed this session
  via four fresh-context sweeps + direct Reads:
  - **Denominators (disconfirming greps, comments/wrapper/definition stripped):** lib
    `bypassDynamicsRestrictions(` = **18 calls / 12 files**; pages = **32 calls / 26 files**; total
    **50 / 38**. `scripts/` = 46; `tests/` references = 92 files. `withDalContext(` non-core ≈ 50.
    **Corrections vs the orchestrator's traced input:** input said lib 28/19 and pages 28/27; the lib "28"
    counted 7 doc-comment lines + the `core/context.js:53` wrapper + the `dynamics-context.js:67`
    definition (real calls = 18/12); the pages "28" undercounted the real 32/26 (1 comment in
    `send-emails.js:18`, already a converted `withDalContext` route). Input's "28 withDalContext" is now
    ≈50 (Route→Service adopted it heavily). Per-site table is the census of record.
  - **Label-consumer finding:** the label is NOT inert — `DynamicsService.checkRestriction` reads
    `ctx.requestId` (= the label) as `activeRequestId` and warns on request-interleave mismatch
    `[VERIFIED via dynamics-service.js:229-233]`. Labels are byte-preserved in every swap (Decision 2);
    `withDalContext(scopeLabel, fn)` threads `scopeLabel` → `requestId` unchanged.
  - **Classification:** **(a) MECHANICAL-RENAME = 32** pages post-auth entry points (21 app-auth + 4
    external post-token + 5 cron post-verifyCronSecret + 2 nextauth auth-infra). **(b) SEMANTIC = 18** lib
    boundaries, pre-ruled convert-in-place to `withDalContext` (behavior-identical; every traced caller
    reaches the site post-auth). Within (b): entry-seam (33-36, 44-46, 48), nested-redundant (40, 47, 49,
    50), defensive/script-only (37-39; 37 is script-only), MIXED (41-43). **(c) SCRIPT = 46** — out of law
    scan scope, LEAVE. **(d) TEST/MOCK = 92 files** — out of scan scope, LEAVE.
  - **Routes-vs-campaign tension (one line):** the Route→Service gate only counted routes importing
    adapters/`dynamics-service`; the 26 surviving pages files wrap a *service/helper* call (never in that
    census), are auth-infra (`nextauth`), or were explicitly owner-deferred by the campaign as
    "end-of-strip" work `[VERIFIED via ROUTE_SERVICE_CONSOLIDATION_PLAN.md:101-103]` — this plan IS that
    end-of-strip work.
  - **Safety framing:** enforcement on in ALL envs (S330); wrong-scope swap = prod write failure, the
    drain-submissions defect class (`ROUTE_SERVICE_CONSOLIDATION_PLAN.md` Stage Log S331). Mechanical strip
    is a pure rename (zero stranding risk); characterization = drain-test pattern + enforcement-on suite
    (`jest.setup.js:44`). Nesting removal / context-push-up is deferred (Stage 4 OWNER DECISION).
  - **Behavioral STOP-AND-ASK:** site 43 (`onboard-reviewer-service.js:435`) — variable label `context`
    (bound to two string literals at `:415`/`:422`); pre-ruled safe, executor re-confirms + runs the
    bill-onboard suite before swapping. Deferred: Stage 3 import-law shape; Stage 4 tightening — both OWNER
    DECISIONS.
- 2026-07-05: **Adversarial plan review round 1 (Codex, fresh-context): NOT SATISFIED — 1 P0, 2 P1, 1 P2;
  all four verified against source this session and folded in.** Reviewer VERIFIED GOOD (verbatim relay):
  the literal census (50/38 = 32 pages + 18 lib), the withDalContext drop-in equivalence (sole disclosed
  delta: non-empty-string label + function validation at `context.js:46`), the nextauth mechanical ruling,
  all five cron CRON_SECRET-before-bypass orderings, site 43's literal-labels pre-ruling, and the
  `ctx.requestId` label-consumer finding. Findings and fold-ins:
  (1) *P0 — two live functional bypass scopes missing*: `alert-reviewer-email-mismatch.js` (default param
  `:44`, call `:55`) and `alert-reviewer-affiliation-mismatch.js` (default param `:66`, call `:77`) call
  bypass through an injected `withDynamicsBypass` DEFAULT-PARAMETER alias, invisible to the call-site grep
  `[re-VERIFIED via Read of both files in full this session]`. Folded: Baseline now distinguishes
  **50 literal direct calls / 38 files** from **52 functional bypass scopes / 40 files**; sites 51-52 added
  to Classification (b) (20 scopes / 14 files) with a default-initializer convert-in-place ruling; Stage 2
  Cluster B1 extended; Stage 0 adds their DEFAULT-path characterization (their suites inject
  `withDynamicsBypass` at `alert-reviewer-email-mismatch.test.js:14` /
  `alert-reviewer-affiliation-mismatch.test.js:18` and never run the default import). **Third-alias sweep
  run this session: NONE found** — the ALL-references grep over `lib`/`pages`/`shared`/`modules` shows
  every remaining non-call reference is a plain import line in an already-censused file; the
  assignment/re-export-pattern grep matches only the two alert default-params. The ALL-references alias
  sweep is now a mandatory pre-stage re-probe.
  (2) *P1 — Stage 3 law evasion hole*: `withDynamicsContext({ restrictions: [] }, fn)` is functionally
  identical bypass (`dynamics-context.js:67-76`) and would evade a bypass-import-only gate. Live code has
  only the Explorer's loaded-restrictions call (`chat.js:29` import, `:124` call — the ONLY live caller
  outside dynamics-context.js `[re-VERIFIED via grep + sed this session]`). Folded: the Stage 3 gate now
  fails on literal/known-empty-restrictions `withDynamicsContext` outside the sanctioned wrapper, fails
  CLOSED on non-literal restrictions expressions, carves out the Explorer path (exempt-dir precedent), and
  additionally reds `enterDynamicsBypassForScript` outside `scripts/`; the self-test fixture list expanded
  to: alias import, namespace/member access, dynamic `import()`, inline `require()`, re-export, non-literal
  fail-closed, empty-restrictions `withDynamicsContext`, and out-of-scripts `enterDynamicsBypassForScript`.
  Decision 6 reworded (Explorer exempt from the STRIP; empty-restrictions shape NOT exempt from the LAW).
  (3) *P1 — characterization too positive-only*: a `hasTrustedDalContext()===true` pin is decorative where
  tests mock/inject the context machinery (exactly the sites-51/52 blind spot). Folded: Self-checking
  method now REQUIRES, for the high-risk clusters (NextAuth fire-and-forget, entry-seam/MIXED lib services,
  token verification, the two alert services), a per-cluster negative control (same op OUTSIDE context
  still rejects) or a same-adapter enforcement probe, citing the existing generic failure pins
  `tests/unit/dal-enforcement.test.js:78` (throws outside any context) and `:91-96` (raw write rejects
  before any network call) `[VERIFIED via sed this session]` as the baseline.
  (4) *P2 — stale count*: the drafting Baseline said `enterDynamicsBypassForScript` had "4 import sites";
  re-derived live census is **59 call sites / 58 script files** (the "4" had counted only static `import`
  lines) `[VERIFIED via grep this session]`; Baseline row corrected, with the two `lib/` comment-only
  mentions noted. Frontmatter summary and Objective updated to the 52-functional-scope census. Plan remains
  `status: draft`, not executed; catalog regeneration deferred to the orchestrator per session constraints.
- 2026-07-05 (S333): **Stages 0-3 executed.** Stage 0: pre-stage re-probe confirmed the 52-scope/
  40-file census unchanged, no new alias shape; added real-context (no dynamics-context mock)
  positive+negative-control characterization tests for every high-risk cluster (33-36, 41-46, 48,
  A4 nextauth 31-32, the two aliased alert-service default-param sites 51-52), including a live
  re-confirmation of site 43's two literal-label bindings (the plan's one behavioral STOP-AND-ASK,
  pre-ruled safe — reconfirmed true). Suite 418→426 suites / 4714→4736 tests (`42a497f0`). Stage 1:
  all 32 pages sites (26 files, clusters A1-A4) mechanically renamed to `withDalContext`,
  byte-identical label/fn/scope; two stale source-shape regression assertions in
  `tests/unit/intake-routes-dynamics-context.test.js` (nextauth, tied to the renamed identifier)
  updated to track the new name (`3f9ac4ea`). Stage 2: all 20 lib scopes (14 files, clusters
  B1-B3, incl. the two default-param initializer retargets) converted in place; three stale
  doc-comment mentions of the retired identifier fixed (`lib/dataverse/adapters/ai-prompt.js`,
  `lib/dataverse/adapters/review-answer.js`, `lib/services/prompt-store.js`); two more stale
  source-shape assertions (notification-email, drain-recover-request-created) updated (`5bd193fd`).
  Post-Stage-2 ALL-references sweep: only `lib/dataverse/core/context.js` (the sanctioned
  importer) and `lib/services/dynamics-context.js` (the definition) reference
  `bypassDynamicsRestrictions` anywhere in `pages`/`lib`/`shared`/`modules` — the strip is
  complete. Owner decision on Stage 3 (asked mid-session): **build now, AST gate shape**
  (recommended option, per the plan's own recommendation). Stage 3:
  `scripts/check-dynamics-context-boundary.js` + self-test built, reusing
  `scripts/lib/ast-scan-core.js`'s shared scanner primitives; landed directly as fail-closed LAW
  (no ratchet — Stage 2 had already reduced the live census to 0); registered in `package.json`,
  `.github/workflows/test.yml`, `docs/CI_GATES_REFERENCE.md`, and the `/start` gate list
  (`2a0a1507`). Full suite 426/4736 green throughout; `check:dataverse-access-layer`,
  `check:route-service-boundary` (+ self-tests), `check:agent-invariants`, `check:doc-currency`,
  `check:agent-wiki`, `check:docs-catalog` all green at each stage boundary.
  **Post-execution fresh-context review (Codex adversarial, round 1): NOT SATISFIED — 1 P1,
  folded same-session.** Reviewer VERIFIED GOOD (verbatim relay): every swapped call site is
  rename-only (label/fn/scope byte-identical) across pages/lib/services/lib/bill/lib/external
  incl. the two aliased default-param sites; no leftover `bypassDynamicsRestrictions` import
  outside the sanctioned wrapper/definition; no (b)-classified site was removed; Explorer/scripts/
  tests untouched (only the two tracked source-shape-assertion updates + new characterization test
  additions); the new `*-dal-context.test.js` tests drive the real `hasTrustedDalContext()`
  machinery, not a mock. Finding: **P1 — Stage 3 rule 2 (`auditWithDynamicsContextRestrictions`)
  originally matched only a bare `Identifier` callee named `withDynamicsContext`**, so an aliased
  named import (`import { withDynamicsContext as raw }`) or a namespace/member-form call
  (`dc.withDynamicsContext(...)`) with empty/unresolvable restrictions would silently evade the
  restrictions audit — defeating the rule's anti-regression purpose. **Folded:** rule 2 now
  collects every local binding that could reach `withDynamicsContext` (bare name, any aliased
  named import/destructure regardless of source, and any namespace-style whole-module binding),
  and checks calls via a tracked alias identifier OR `<namespace>.withDynamicsContext(...)` /
  inline `require(...)/import(...).withDynamicsContext(...)`, mirroring rule 1's
  name-keyed-not-source-keyed posture. Self-test expanded from 10 to 12 required RED fixtures
  (added: aliased-import and namespace/member-form `withDynamicsContext` calls, both with empty
  restrictions) plus the 5 GREEN fixtures, all passing; live repo re-verified clean (572 files,
  0 violations) after the fix. `npm test`/self-test execution failed in the Codex reviewer's
  read-only sandbox (EPERM writing Jest cache / fixture tmpdirs) — re-run directly in this
  session's writable environment and confirmed green (see above); not a code defect.

<!-- end of plan -->
