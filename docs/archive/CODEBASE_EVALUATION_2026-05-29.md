---
fact_consistency: point-in-time
---
# Codebase Evaluation — 2026-05-29

**Read-only 10-front evaluation** (find → adversarial-verify → synthesize), run as a background
workflow (`wm6vs5836`): 36 `Explore` (read-only) agents, 102 findings, 25 critical/high
adversarially verified, 8 refuted, 94 retained. **Nothing was edited, committed, or mutated.**

**Codex-reviewed 2026-05-29** — its corrections are folded in below: three findings were
**overstated** and have been re-framed, the priority order was **re-ranked toward operational
impact**, and a "Likely under-covered" section was added. Codex's precise file:line citations are
preserved.

> ## ⚠️ Read this before acting on anything "production"
> The evaluating agents were **read-only and could NOT probe live prod** (no creds in the sandbox).
> Every "production is broken / missing" claim below — the P0 migrations, the env-var items — is
> derived from the **repo + the S186 audit dated 2026-05-25**, *not* a fresh prod check. **They may
> have been resolved in the four days since.** Confirm against live prod (a `vercel env ls`, a prod
> Postgres probe) **before** acting. (Codex confirmed this caveat is correctly applied — the report
> does not assert those claims as current.)

---

## Top priorities (re-ranked per Codex — operational impact over doc drift)

### IMMEDIATE — verify-live-first (prod claims, S186-aged, NOT freshly confirmed)
1. **Migrations 011 + 013 — almost certainly ALREADY APPLIED (verify-and-close, NOT re-apply).** `DEVELOPMENT_LOG.md` § Session 186 records *both* migrations applied to prod via Phase 0 (`LOCK TABLE` + tracker write) — the S186 *audit* found the problem; S186 *Phase 0* fixed it. The eval inherited the audit's problem statement without reading the fix. **Action:** probe prod for `submission_jobs.locked_until` + `intake_drafts.pending_attachments` to confirm present, then close; only re-apply (`node scripts/apply-migrations.js`) if a probe shows them *still* missing. (This is the falsification caveat paying off — the headline finding was stale.)
2. **`INTAKE_BLOB_RW_TOKEN` + `VRP_ALLOWED_PROVIDERS` may be unset in prod** → intake/VRP flows fail closed. S186 flagged these for verification and (unlike the migrations) the dev log does *not* record them as set. *Verify:* `vercel env ls production` (`VRP_ALLOWED_PROVIDERS` must include `claude`).

### HIGH — repo-verified, operational
3. **`/api/cron/drain-submissions` has no run telemetry** (CONFIRMED) — imports no `MaintenanceService`; the handler (`drain-submissions.js:48-68`, `:924-953`) never calls `startRun`/`completeRun`, unlike `maintenance.js:18-31`. **Codex bumped this UP:** a silent drain failure is *invisible* to the cron audit trail. Add `startRun`/`completeRun`.
4. **`proxy.js` has no direct test** (CONFIRMED) — the idle-timeout gate, CSP-nonce generation, and route-level cross-surface behavior (`proxy.js:34-133`) are untested; the **referer-fallback** path in `auth.js:40-71` is also untested. *(Note: this is narrower than the first draft said — see "Corrected" below; CSRF and executor failure modes DO have tests.)*
5. **App-access cache: 2-min stale-after-revoke window** (CONFIRMED) — `auth.js:210-212` (`APP_ACCESS_TTL_MS = 2*60*1000`), grants cached `:274-289`. **Codex addition:** `is_active` is cached on the *same* TTL, so a **deactivated account keeps access for up to 2 min**. (The file notes superuser is checked uncached for exactly this reason, `:298-301`.) Reduce TTL or add webhook invalidation.
6. **`README.md` carries stale Phase II framing** (CONFIRMED, re-framed) — `README.md:1-3` frames the repo around Phase II writeup; `SYSTEM_MODEL.md:98-105` is single Phase I submission + internal status flip. *Codex correction: it's stale framing, NOT an explicit "dual-submission" model claim.* Re-anchor the README opening + point it at `SYSTEM_MODEL.md`.
7. **Entry points don't reference `SYSTEM_MODEL.md` or define core terms** (CONFIRMED) — CLAUDE.md/README never surface the canonical model or its glossary (Executor, Mode 1/2, drain, slice-0). The legibility gap, quantified.

### MEDIUM
8. **`wmkf_honorariumrequest`: implementation-readiness gap, NOT a prod break** (re-framed) — documented-deployed; absent from schema-as-code and from `reviewer-suggestion.js` `FIELD_SELECT` (`:14-73`; has `wmkf_honorariumoptout:61`, not `…request`). Connor owns the external schema deployment. *Omitting it means the app doesn't surface the field — it doesn't error.* This is BILL chunk-4 work, not an emergency.
9. **Glossary: "drain" (47×) and "slice-0" (12×) undefined in entry points** — add to `SYSTEM_MODEL.md` § Glossary.
10. **`APPLICATION_STATE_ATLAS.md` line citations drifted** (CONFIRMED, **moved DOWN** per Codex — cosmetic, no runtime impact) — `:114` cites execute-prompt read/write at ~504/511, but those lines are schema-parsing; the real write logic is `execute-prompt.js:518-615` (updateRecord `:597-603`). The `:166` citation is also stale. Prefer function-symbol anchors; re-verify the ~80 citations.
11. **`pages/api/test-email.js`** uses `requireAppAccess('dynamics-explorer')` where the matrix implies admin-only — verify intent (MEDIUM).

---

## Corrected by Codex (was overstated in the first draft)

- **README "dual submission"** → REFUTED. README has *stale Phase II framing*; it does not describe two applicant submission paths. The inconsistency is real; the characterization was wrong.
- **"Critical auth/LLM paths have zero/partial tests"** → OVERSTATED. CSRF has tests (`auth.test.js:65-122, 280-294`); executor failure modes have tests (`execute-prompt-multi-output.test.js:205-250, 305-307`); `auth-policy.test.js:45-76` pins fail-closed. The **real** gap is narrow: no direct `proxy.js` test + untested referer fallback (now #4).
- **`wmkf_honorariumrequest` "critical/repo-critical"** → OVERSTATED. Not a current production break — it's chunk-4 implementation readiness (now #8, MEDIUM).

---

## Likely under-covered (Codex) — where an excerpt-based eval misses depth

These are the load-bearing surfaces a read-excerpts evaluation tends to mischaracterize by shape. Worth a *focused* deep pass (not a broad fan-out):

- **External reviewer state machine** (`external/review/[token]/respond.js:64-160`) — token verification × rate limiting × materials-sent lock × policy-ack sequencing × optimistic `_etag` locking. The most failure-prone reviewer surface; the interaction between these is invisible to excerpt reads.
- **Drain-submissions depth** (`drain-submissions.js`) — the risk is in nested helpers: SharePoint/blob movement, budget-line idempotency, lease semantics, parked-state recoverability. The route was characterized by its small entry point, not its state-machine depth.
- **BILL honoraria partial-failure handling** (`lib/bill/onboard-reviewer-service.js:7-27, 256-280`) — per-phase partial failure + cross-system `akoya_request` patching with HMAC body auth; rollback gaps. Money-adjacent.
- **SharePoint/Dataverse file-contract compatibility** (`review-upload.js:149-174`, `graph-service.js:22-44`) — canonical folder-path derivation, host/library allowlists, orphan-file risk on rollback.
- **`proxy.js` cross-surface behavior** (`:34-133`) — external-token bypasses, idle-timeout logout, applicant/staff separation, CSP — none covered by testing only the API auth helpers.
- **`is_active` cached on the app-access TTL** — folded into #5 above; called out separately because it's a distinct authz-risk surface, not just a freshness nuisance.

---

## By front (94 retained; full per-finding detail in the task output `wm6vs5836`)

- **Prod-vs-repo** — migrations + tracker (verify-live, #1); drain telemetry (#3); 13 undocumented env vars (BILL_*, BILLCOM_*, DRAIN_*); secret-expiration tracks only 5 of 16; virus-scan + impersonation off in prod (documented deferrals — decide before intake).
- **Adversarial auth** — *no smoking gun* (3 findings): the 2-min cache window (#5) + `test-email` route (#11).
- **LLM call-sites** — 1 route on the Dataverse Executor (`summarize-v2`); 3 Mode-2 routes correctly outside the contract; A7 hardening must be re-declared (dataClass/maxChars) as prompts migrate (HIGH, CONFIRMED); `prompt-resolver.js` confirmed script-only.
- **Atlas** — `wmkf_honorariumrequest` (#8); line-citation drift (#10); a missing `setContactLink` write path; `wmkf_completedat` has no in-repo write path (external Workbench — expected).
- **Dead/orphaned code** — `phase-ii-research-2026-06` is **still wired live** (`form-schema.js`), so not deletable yet (matches our "shelved, revisit at next-form redesign" call); `prompt-resolver.js` + several one-off scripts are delete-candidates after callers retire.
- **Memory health** — healthy: all 103 entries indexed, no orphans; 1 stale path (`project-intake-portal-pilot-decisions-2026-05-13:32` → `schema/intake/` should be `wave4/`).
- **Comment/inline drift** — minor stale line-pointers + a referenced-but-missing `scripts/_tmp-probe-picklists.mjs` comment; dropped PG tables correctly guarded.
- **Test-risk** — see #4; plus untested intake three-call concurrency race + executor impersonation end-to-end.
- **Cross-system contract** — mostly clean (nav-prop PascalCase correct, contract steps implemented, schema-as-code in sync); PA-side correctly flagged unverifiable-from-repo.
- **Legibility** — README + glossary + entry-point gaps (#6, #7, #9).

---

## Provenance
Workflow `wm6vs5836` (run `wf_7c477090-b96`), 36 `Explore` agents. Codex independent review
2026-05-29 (verification + false-positive + misses + priority pass). Full per-finding evidence in
the task output file. **Nothing in this evaluation has been applied or committed** — it's for review.
