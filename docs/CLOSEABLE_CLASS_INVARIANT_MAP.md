---
title: Closeable-Class Invariant Map
domain: architecture
kind: plan
status: active
summary: "Security/correctness classes on the enforcement ladder, the tested move that lifts each, and a ranked queue. Headline: in plain JS, rung 1 is rarely reachable."
---

# Closeable-Class Invariant Map

> Produced 2026-07-06 (Session 340) by Fable orchestration per
> `docs/INVARIANT_MAP_ORCHESTRATION_BRIEF.md`. Method: an 18-surface census (brief §3 +
> `check:*` gate census + CLAUDE.md invariants), one Opus analyst per surface placing it on
> the ladder with `file:line` evidence, **two adversarial Opus skeptics per rung-1 claim**
> (bypass lens + lifecycle/drift lens), and a completeness critic. 34 agents, ~2M tokens.
> Every per-surface claim carries the analyst's `file:line`; the implementing session must
> re-verify against live source before editing (line numbers drift; `main` auto-deploys). All
> `file:line` references below are cited by the sub-agent that read them this session, not from
> memory — but re-confirm before acting.

## 0. The headline finding (read this first)

The brief's thesis — "most hardening sits at rungs 2–4, which is why work proceeds
bug-by-bug" — is **confirmed**. But the adversarial pass sharpened it into a more useful
strategic claim:

**Every rung-1 upgrade proposed by the analysts was refuted.** Not because the analysts were
weak (they cited real code), but because of one structural fact: **this is a plain-JavaScript
codebase, and rung 1 ("impossible by construction") almost always requires something JS
cannot provide** — either a nominal/branded type the compiler forces exhaustive, or
module-level access control (a symbol visible to one sibling module only). ESM has neither.
So in this repo:

> **"Rung 1" collapses to "rung 2 with a single fail-closed chokepoint."** The achievable win
> is not making the bug unexpressible — it is making every path to the protected effect pass
> through *one* runtime assert that fails closed, so a future edit that forgets the guard
> throws instead of silently violating.

That reframing matters because the skeptics found the **same meta-bug in the fix designs that
caused the original COI whack-a-mole**: every proposed chokepoint covered a *subset* of the
sinks and left siblings open. The COI fix wrapped 3 of ≥7 writes. The GUID fix covered the
URL key-predicate but not the `$filter` family, `disassociate`, or the changeset key. The DAL
fix covered `DynamicsService` but not the `lib/dataverse/client.js` transport that
admin-settings and app-access writes actually use. The `route-auth` fix left a second
hand-authored declaration (`guardNote`) able to drift.

**This is the single most important management insight in the map:** the failure mode isn't
"we don't know how to close classes" — it's "a locally-correct chokepoint that misses a
sibling sink reads as closed while the class stays open." Every entry below therefore states
its move as *"the chokepoint AND the complete sink set it must cover,"* because the sink
enumeration — not the chokepoint — is where the work and the risk live.

**Two consequent strategic decisions belong to the owner (see §4):** (1) whether to invest in
a **TypeScript migration of the auth/identity/Dataverse-selector core**, which is the *only*
thing that lifts the branded-type classes (identity provenance, GUID, actor) to true rung 1;
and (2) whether "single fail-closed chokepoint covering all sinks" is accepted as the
**project's definition of done** for a hardening class, since true rung 1 is off the table
without (1).

## 1. The map (18 classes + 3 newly-found)

Rung is *current* enforcement. "Reachable move" is the adversarially-survived target — where
a skeptic refuted the rung-1 claim, the move is the *corrected* version incorporating what the
skeptic said was missing. ✱ = a rung-1 claim was made and **refuted**; the corrected move is a
strong rung-2 chokepoint, not rung 1. Line numbers are the analysts' citations as read this
session — treat as pointers to re-verify, not settled fact.

| # | Class | Rung | Reachable move | Effort | Blast |
|---|---|---|---|---|---|
| 1 | **DAL entity-write outside trusted context** ✱ | 2 | Hoist `assertTrustedDalContext` into `DynamicsService._writeFetch` **AND** add the same fail-closed assert to `lib/dataverse/client.js` write methods (`post/patch/delete_`) — the tail admin-settings & app-access writes actually use; key the census backstop on the write *effect* (any POST/PATCH/DELETE to the data API), not the `fetchWithTimeout` identifier | small | all CRM writes (~137 callers) |
| 2 | **Client-supplied id → Dataverse selector (IDOR/injection)** ✱ | 2 | Push `isGuid` fail-closed into `getRecord/updateRecord/deleteRecord` **AND** `disassociate` **AND** `changeset.buildOperationUrl` **AND** the `queryRecords` `$filter` builder path; expand `check:trust-boundary-guid` SINKS to match | small–med | 3 selectors + `$filter` family, ~90+ sites, a dozen sink-bearing route files |
| 3 | **Save-time reviewer/institution COI** ✱ | 2 | Move **all ≥7 writes** (`upsertByEmail`, `upsertByPotentialReviewer`, `suggestion.upsert`, `setContactLink`, `writeIdentityDecision`, `clearIdentityFields`, `stampSuggestionAnchor`) into one `persistScreenedCandidate` behind a **candidate-bound** witness (branded against the screened candidate's identity, not a shared constant); inject raw adapters only into that function so the loop body cannot call them | medium | 1 route, authoritative COI barrier |
| 4 | **Prompt-injection / A7 tagging** ✱ | 3 | (a) rung-2 lift, **cheap & high-value**: add `check:prompt-injection-tagging` + self-test to `.github/workflows/test.yml` — today it only runs advisory at session Stop, **not in CI**; (b) auto-inject the preamble at both send chokepoints (`llm-client._buildBody` + `multi-llm-service.js:276`) iff the payload contains the sentinel, making wrap→preamble pairing total | small (a) / med (b) | 27 registered + ≥1 unregistered surface, both providers |
| 5 | **Model-override warming race** ✱ | 2 | `await loadModelOverrides()` inside `llm-client` + `multi-llm-service` before resolve (closes the 404 + override-correctness at the send point regardless of route code); keep `check:model-override-warming` — do **not** retire it (skeptics: ESM cannot hide the sync getter, so the gate is the only enforcement) | large | 68 resolver sites, ~15 routes |
| 6 | **Route auth-contract drift** ✱ | 2 | Derive `guardAppKeys` from source via `deriveNamespaceGuard(routePath)` **and** generate `guardNote`'s per-file enumeration from the same producer (don't leave it hand-authored — that's the surviving second declaration) | small | 4 namespaces, 51 files |
| 7 | **API-route authorization coverage** ✱ | 3 | `defineApiRoute({access})` wrapper with a **per-method** access map (not a scalar) + record-ownership scoping captured in the declaration + AST gate asserting the inline refinement matches; generated matrix projection with `git diff --exit-code` | large | 145 routes (~141 outside current AST coverage) |
| 8 | **Migrations-manifest drift** ✱ | 2 | Gitignore the generated manifest + generate at build — **but** keep `check:migrations-manifest` validating the generated shape (skeptic: deleting the gate opens a silent generator-regression path to the same missed-alert consequence) | small | 1 runtime consumer (drift alerts only) |
| 9 | Dynamics restriction-context boundary | 2 | Leave defended; only rung-2 hardening available: delete the `if (!isDalEnforcementOn()) return` env escape hatch at `dynamics-context.js:142` so writes fail closed unconditionally (prod already `=on`) | small (hardening) | all DynamicsService access, 604 files scanned |
| 10 | Identity-provenance spoof | 4 | Leave defended (0 live violations found). Rung-2 ceiling: runtime-branded `ActorRef` minted only in the auth resolvers; true rung 1 needs TypeScript (see §4) | med | ~93 route sites |
| 11 | Unreviewed model id in config | 3 | Leave defended (open-world input: live `/v1/models` + env overrides). Partial rung-1 available for the capability↔pricing *parity* sub-invariant only | med | every Claude request |
| 12 | Hand-rolled OData escape | 2 | Leave defended — a ban on a source-text pattern is inherently a scanner. The deeper invariant ("user string in `$filter` is escaped") is *already* rung 1 via the `odata.eq/startsWith/...` builders | small | 20 importers, 47 call sites |
| 13 | Route→service Dataverse bypass | 2 | Leave defended (import-topology invariant; wrong shape for rung 1). Security keystone is independently at rung 2 via #1's runtime asserts | small | 145 routes |
| 14 | Secret literal in tracked file | 2 | Leave defended (a secret is opaque high-entropy text; no total function classifies it). Rung-2 improvement: move the gate to a pre-push hook so it fires before history | med | all tracked files |
| 15 | Status/enum producer↔consumer parity | 2 | Leave defended as a class; closeable **per-site** to rung 1 via a single-source `STAGES` object both label maps derive from | med | 3 workbench UI pairs |
| 16 | Doc/memory drift vs live code | 2 | Leave defended (free-text prose is not a total function of code). Only crisp scalar/path sub-slices are liftable | small | hundreds of prose files |
| 17 | Partial-batch / durable-state consistency | 4 | Leave defended as a class (heterogeneous atomicity floors; no distributed txn for BILL+Dataverse+PG). One slice liftable: compose COI save's intra-record writes as one `runChangeset` | large | every multi-step writer |
| 18 | Intake Blob token-store isolation † | 2 | Bind intake Blob ops to `INTAKE_BLOB_RW_TOKEN` by construction: a wrapper module that is the only caller of `@vercel/blob` for intake paths + a gate forbidding the default token in intake dirs | small–med | applicant PII attachments |
| 19 | **Outbound-fetch SSRF boundary** † (critic) | 4 | No CI gate today. Add a fail-closed gate forbidding raw global `fetch(` outside `safeFetch` for server code; route all outbound through `safeFetch`'s allowlist | small–med | every server outbound request |
| 20 | **Persisted-HTML stored XSS** † (critic) | 4 | Sanitize-on-write enforced per-site by hand; render-side Semgrep rule is advisory-only. Make one sanitizer the sole write path for reviewer/grantee HTML + flip the render-side rule to blocking | med | external-reviewer answer HTML, grantee captions |

† = surface the completeness critic found that the census missed (SSRF, stored-XSS were entirely
absent; intake-blob was in the census but its analyst failed structured output — the critic
recovered it). **Their appearance is itself a finding:** the `check:*` gate census is a good
map of *what the project already decided to defend*, and three real classes with prod exposure
had **no gate at all** — meaning "is there a gate?" is not a safe proxy for "is this class
covered?"

## 2. Why every rung-1 claim was refuted (the evidence pattern)

Five surfaces got a rung-1 proposal; all five were refuted on ≥1 lens. The refutations cluster
into four reusable lessons — these are the traps the *implementing* session must avoid:

1. **Subset-of-sinks (the COI trap, recurring).** #1 (DynamicsService but not `client.js`),
   #2 (key-predicate but not `$filter`/`disassociate`/changeset), #3 (3 of 7 writes). Cited
   live bypasses: `lib/services/dataverse-settings-service.js:120` and
   `dataverse-app-access-service.js:122` write CRM through `client.js` with no trusted-context
   assert (`app-access` grant/revoke run on NextAuth sign-in and the admin route); the COI
   `contact_linked_elsewhere` branch reaches `setContactLink`/`writeIdentityDecision` with no
   witness. **Lesson:** enumerate the complete sink set before implementing; the chokepoint is
   easy, the enumeration is the deliverable.
2. **ESM has no friend-export (#5, #9).** You cannot expose `getModelForApp` to the loader
   alone; it stays importable by all callers, so "resolve before warm" stays expressible. The
   proposal even *retired the only gate* — a net regression. **Lesson:** never delete a rung-2
   gate as part of a rung-1 claim in JS; the gate is load-bearing.
3. **Plain JS has no branded types (#7, #10, #2).** `access:'App'` can't express
   `App ∧ superuser-on-POST` or `owns-this-record`; `req.body.profileId` is always in scope.
   The runtime-branded-symbol workaround is rung 2, not rung 1. **Lesson:** true rung 1 for
   these is a TypeScript decision (§4), not a refactor.
4. **A second hand-authored declaration survives (#6, #8).** Deleting `guardAppKeys` leaves
   `guardNote` prose asserting the same facts, uninspected; gitignoring the manifest leaves a
   generator whose regression silently disables drift alerts. **Lesson:** "one source of
   truth" means *zero* other restatements — grep for the sibling declaration.

## 3. Ranked upgrade queue (blast radius × achievability)

Ranked for a future implementing session. Each is a branch; `main` auto-deploys, so merges are
the owner's deploy decision.

**Tier A — small effort, high blast radius, real prod exposure. Do first.**

1. **#1 DAL write chokepoint incl. the `client.js` tail.** The skeptics found *live* CRM
   writes (admin settings, app-access grant/revoke) that reach Dataverse outside any
   trusted-context assert because they use `client.js`, not `DynamicsService`. The brief named
   this ("client.js tail-coverage") and it's still open post-Q9. Small change, closes the
   actual gap the DAL program exists to close. **Recommended first target — sketch in §5.**
2. **#4a prompt-injection gate → CI.** One-line-ish `test.yml` addition. The A7 registry gate
   exists and passes but **only runs at session Stop, not in CI** — a new unwrapped LLM call
   site (exactly the reviewer-finder top-up bug from S339) is not blocked on push. Highest
   leverage-per-effort in the map.
3. **#2 GUID chokepoint (complete sink set).** IDOR/`$filter`-injection surface; small–medium
   once the full sink list (selectors + `$filter` + `disassociate` + changeset) is enforced.
4. **#9 delete the DAL env escape hatch** and **#8 manifest** as low-risk rung-2 hardenings.

**Tier B — medium effort, contained or single-surface.**

5. **#3 COI persist chokepoint** (all 7 writes, candidate-bound witness) — extends the closed
   S339 architecture; do **not** re-litigate the design, complete the sink coverage.
6. **#18/#19/#20 the three un-gated classes** (intake-blob token, SSRF, stored-XSS) — each is
   a rung-4→rung-2 lift adding a genuinely-missing gate.
7. **#6 route-auth derivation** incl. generating `guardNote`.

**Tier C — large; needs an owner decision first.**

8. **#7 per-method `defineApiRoute`** and **#10 branded `ActorRef`** — gated on the TypeScript
   decision (§4). Without TS these are rung-2 ceilings; with TS they're the rung-1 payoff.
9. **#5 model-warming at the send point** (keep the gate).
10. **#17 partial-batch** — leave as a class; take only the COI-save `runChangeset` slice.

## 4. The two decisions that are the owner's, not a later session's

1. **TypeScript for the security core?** Classes #7, #10, #2 (and the branded-actor half of
   the identity work) have a rung-2 ceiling in JS and a rung-1 payoff *only* under TypeScript
   with `strict`/nominal branding. A scoped migration of just
   `lib/utils/auth.js` + the Dataverse selector layer + the route-definition wrapper would
   convert the four largest-blast-radius review-only classes into compiler-enforced ones. This
   is a real, multi-session investment with real payoff — but it's a project-direction call.
2. **Adopt "single fail-closed chokepoint covering all sinks" as the definition of done for a
   hardening class?** True rung 1 is mostly unreachable here. If the answer to (1) is "not
   now," then the honest bar is the Tier-A/B chokepoint pattern, and the map's value is the
   ranked queue above. Naming this bar explicitly stops future sessions from either
   over-investing chasing an unreachable rung 1 or under-investing with another subset fix.

## 5. Recommended first target — implementation sketch (#1, DAL write chokepoint tail)

Standalone enough for a future session to execute:

1. **Verify the gap (falsify first).** Grep `client.js` for `post|patch|delete_`; confirm
   `lib/services/dataverse-settings-service.js` and `lib/services/dataverse-app-access-service.js`
   call them with no `assertTrustedDalContext` (skeptic cited `dataverse-settings-service.js:120/126/144`,
   `dataverse-app-access-service.js:122/145`). Confirm the routes that reach them
   (`pages/api/admin/honorarium-amount.js`, `/admin/models`, `app-access` grant on sign-in)
   establish no DAL context.
2. **Hoist the DynamicsService assert.** Make `assertTrustedDalContext` the first statement of
   `DynamicsService._writeFetch` (deriving the label from `init.method`+url); delete the 8
   per-method asserts. Verify every POST/PATCH/DELETE method routes through `_writeFetch`
   (skeptic enumerated: they do; `searchRecords`/`getEntityKey` are the only direct reads).
3. **Close the tail.** Add the same fail-closed assert to `client.js` `post/patch/delete_`
   (the transport the admin/app-access writes use). This is the load-bearing step — without it
   the "DAL entity-write" class stays open regardless of the DynamicsService hoist.
4. **Fix the census backstop's blind spot.** `check:dataverse-access-layer` tracks only
   `DynamicsService`; extend it to flag any `client.js`/global-`fetch` write (POST/PATCH/DELETE
   to the data API) not going through an asserting path — key on the write *effect*, not the
   `fetchWithTimeout` identifier (skeptic showed a `global fetch` write evades the identifier-keyed grep).
5. **Verify:** `npm test`; `check:dataverse-access-layer` + self-test; `/contract-reconcile`
   (caller→persistence→consumer) since this is auth-adjacent shared state; drive one admin
   settings write and one sign-in in a preview deploy to confirm no fail-closed regression.

## 6. Adjacent confirmed finding (from the S339 prod-safety review, same session)

Not a map class but relevant to #1's surface: `lib/services/dataverse-app-access-service.js`
— `listAppKeysForUser` swallowed a transient Dataverse error and returned `[]`, which
`requireAppAccess` cached for 2 minutes, locking a legitimate non-superuser out of all apps
for up to 2 min per warm instance. **LOW, pre-existing** (dates to the May Wave-1 Dataverse
flip, not a S339 regression), double-verified.

**Fixed on S340 branch `fix/app-access-cache-fail-open`, commit `f9ce047`:** threading an
opt-in `throwOnError` through the app-access service so the auth hot path distinguishes "no
grants" from "lookup failed"; on failure `requireAppAccess` now returns a retryable 503 without
caching (mirrors the `is_active`/roles fail-closed path). The display-only caller
(`pages/api/app-access.js`) keeps the graceful `[]`-on-error default; regression test in
`tests/unit/require-app-access-dal-context.test.js`. Not yet merged to `main` at time of
writing — the finding above still describes live `main` until this branch lands.

<!--
[RECHECKED after lib/services/dataverse-app-access-service.js change: throwOnError added at dataverse-app-access-service.js catch, listAppKeysForUser]
[RECHECKED after lib/services/app-access-service.js change: options passthrough at app-access-service.js listAppKeysForUser]
[RECHECKED after lib/utils/auth.js change: fail-closed 503 + no-cache in requireAppAccess grant-load block]
-->
This §6 finding is the only place these paths carry a state claim tied to the fix; the §1/§2
mentions are structural (guard locations), unaffected by the fix.
