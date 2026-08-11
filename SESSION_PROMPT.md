# Session 416 Prompt: reviewer-alert retraction hardened after Opus review; routing UI parked

> **Codex follow-through, 2026-08-11.** The work order is decided: build no new
> reviewer-email alert-routing UI now. Production history contains exactly one
> alert of this type, its condition is already resolved, and eleven later
> successful nightly runs created no recurrence. The information-only idea would
> require a new request-scoped roster-contact path; direct alert-to-merge remains
> NO-SHIP. Re-open product work only after a fresh probe returns `STILL_BLOCKED`.
>
> The first review found why the sole row is still `active`: the S414 reconciler tested
> current contact authority before live suggestion lifecycle, and this deselected
> row is no longer vetted. Commit `3872d97c` fixes the ordering and adds both
> regression directions on branch `codex/reviewer-alert-retraction`. It is not
> production behavior until deliberately promoted. The Opus follow-up then found
> the remaining confirmed P1: a missing Dataverse suggestion throws 404 rather
> than returning null. The branch now maps only Dataverse's structured
> ObjectDoesNotExist response (`404`, `0x80040217`) to `suggestion_gone`; every
> other 404 remains an error. It handles excluded rows through a read-only
> lifecycle lookup, gates unvetted reads on standing alert keys, reports only
> known-open `wouldRetract` entries (with an explicit incomplete-preview flag),
> treats missing people as non-reconcilable, and aligns the probe's request
> binding. Focused suites pass 153/153; the current full unit suite passes 575
> suites / 7,283 tests.

> **Handoff, 2026-08-11 (Session 414).** Seven commits, all on `main`, all pushed.
> Fixed a five-week production misconfiguration that had been emitting a
> per-reviewer alert on every accept, made three fail-open-ish env flags
> auditable, shipped alert auto-retraction with mutation-verified tests, and
> took a design proposal to adversarial review — which killed it, correctly.
> A pre-existing authorization gap was found and spun out for an owner decision.

## Session 414 Summary

### What Was Completed

1. **BILL manual-onboarding alert fixed at its source** (`beae09a9`, `49ee5c76`).
   `BILL_ONBOARDING_DEFERRED` was *present* in Production and Preview since
   ~2026-06-10 but its value was not the literal `'true'` the strict `===`
   requires (`lib/bill/onboard-reviewer-service.js:90`). Inert until the
   2026-07-02 honorarium go-live opened the path; from that same day every
   reviewer accept fell through to the `BILL_ENABLED !== 'true'` branch.
   **61 alerts** accumulated (2026-07-02 17:48 → 2026-08-10 19:52 UTC). Flag
   overwritten to exactly `true` on both targets, stored **non-sensitive** so the
   value is readable, production redeployed. All 61 resolved. **No BILL API call
   ever fired** — verified three ways: `BILL_ENABLED` unset, zero alerts of the
   types reachable past that gate, and `bill_onboarding_state` holds 0 rows.

2. **Dataverse enforcement flags made auditable** (`157f0ff2`).
   `DATAVERSE_TARGET_INTERLOCK` (Prod + Preview) and `DATAVERSE_DAL_ENFORCEMENT`
   (Prod) were Sensitive/unreadable. Both now non-sensitive and explicitly `on`.
   **The two do NOT share a failure posture** and the docs implied they did:
   `resolveInterlockMode` fails CLOSED on an invalid value
   (`interlock.js:77-85`), while `isDalEnforcementOn` falls through to
   `NODE_ENV !== 'production'` = `false` — **fails OPEN in production**
   (`dynamics-context.js:124-129`). `DATAVERSE_DAL_ENFORCEMENT` had no
   `CREDENTIALS_RUNBOOK` row at all; added.

3. **Read-only probe for needs-merge alerts** (`c0562ded`).
   `scripts/probe-reviewer-email-reconcile-alert.mjs` replays the reconciler
   ladder against live Dataverse → STILL_BLOCKED / SELF_HEALING /
   ALREADY_RESOLVED / NOT_RECONCILABLE. All three refusal paths tested.

4. **Alert auto-retraction shipped** (`80b85408`) and is hardened on
   `codex/reviewer-alert-retraction`. `autoResolveKey` only
   *deduped*, so an alert outlived its condition forever and a silent night was
   indistinguishable from a resolved one. Now retracts on: email landed,
   suggestion gone, deselected, applicant-excluded, write, repoint. The branch
   follow-up maps only record-scoped ObjectDoesNotExist 404s to gone without
   weakening the fail-closed action lookup; systemic 404s remain row errors;
   open-alert key gating avoids lifecycle reads for unvetted rows with no
   standing signal; dry-run reports only confirmed-open `wouldRetract` entries
   and exposes incomplete previews; missing people remain non-reconcilable.
   Deliberately NOT on the ambiguous
   skips or a stale-roster request mismatch — retracting there would destroy the
   only standing signal. 35 focused reconciler tests; **4 mutations verified to fail the suite**.
   `/contract-reconcile` caught a real defect mid-build: the emission still built
   the alert key inline while retraction used a new helper — two definitions that
   drift silently and fail open.

5. **Merge-surfacing proposal killed on adversarial review** (`3abcdd14`,
   `25b53167`, `a3a39122`). See "Do Not Reopen" #1 and the work order.

### Live production behavior that changed today

- Reviewer accepts no longer emit `bill_manual_onboarding` alerts; `/admin` shows
  0 active (was 29).
- `BILL_ONBOARDING_DEFERRED`, `DATAVERSE_TARGET_INTERLOCK`,
  `DATAVERSE_DAL_ENFORCEMENT` are all readable in `vercel env ls` now.
- Production redeployed twice; **69 cron runs since the second redeploy, all
  `completed`, zero failed** `[VERIFIED via maintenance_runs, 15:51 UTC]`.

### Commits
- `beae09a9` — Fix the BILL manual-onboarding alert at its source and record the drift
- `49ee5c76` — Make the BILL deferred-flag value auditable in the credentials runbook
- `157f0ff2` — Make the Dataverse enforcement flags auditable and record their failure asymmetry
- `c0562ded` — Add a read-only probe for reviewer_email_reconcile_needs_merge alerts
- `80b85408` — Retract reviewer_email_reconcile_needs_merge alerts when the condition clears
- `3abcdd14` — Scope doc: surfacing the needs-merge alert in the Invite tab
- `25b53167` — Mark the merge-surfacing scope NO-SHIP after adversarial review
- `a3a39122` — Codex work order: reviewer email alert routing, Codex takes the lead

Unit suite on `main`: **7259/7259**. All 29 rubric gates green at session start and after.

## Next Items

### Verified Open

1. **Milestone snapshot producer** — carried from S413, still open.
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` "Board milestone freeze",
   DECIDED copy-the-bytes (owner, 2026-08-10). The three `wmkf_milestone*` fields
   are written nowhere today (`lib/dataverse/adapters/request-document.js:38-40`).

2. **Two non-destructive SharePoint checks** — carried from S413, still open.
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` H1/H2 block. (a) add
   "Checked Out To" to the `akoya_request` view; (b) read the Members permission
   level's Delete Items / Delete Versions.

### Owner Decision Needed

1. **`merge-candidates` authorization gap — PRE-EXISTING, live today.**
   Evidence: `.claude-memory/project-merge-candidates-authorization-gap.md`;
   `pages/api/reviewer-finder/merge-candidates.js:22-36` takes only
   `{keeperId, loserId}` with **no `requestId`**, behind app-level
   `requireAppAccess`; `computeCanManage` is documented "Cosmetic only … FAILS
   OPEN" (`shared/components/reviewers/reviewer-modes.js:86-96`). Any
   reviewer-finder user can POST two GUIDs and execute a globally destructive
   merge (deletes suggestions, deactivates a person). Disconfirming check run —
   `actingUserSystemId` is write *attribution*, not authorization.
   The documentation trail is now investigated: S289 deliberately reused
   app-level auth and treats the loser block predicate as the safety boundary;
   S207 predates the merge route and names less destructive reused reviewer
   operations. The predicate limits data eligibility, not caller authorization.
   Owner decision remains required on whether this later destructive primitive
   should stay org-open.

2. **`DEVELOPMENT_LOG.md` revive or formally retire** — carried, still unanswered.
   Evidence: file tail "Last Updated: May 14, 2026"; S409–S414 added no entries.
   **No entry added this session, deliberately** — writing one would preempt this.

3. Carried unchanged from S413: staff image substitution audit trace; what
   triggers `Closed No Response`; per-send deadline override divergence
   (`render-emails-service.js:271`, `send-emails-service.js:916`); residual
   Reviews-surface duplication; cycle measurement tool live evidence.

### Parked

1. **Invite-tab surfacing of needs-merge alerts.** Codex verdict: build nothing
   now. Re-open trigger: a new alert probes `STILL_BLOCKED`; evaluate a
   request-scoped information-only hint first. Direct alert-to-merge additionally
   requires owner decision #1, live semantic binding, safe orientation, and
   partial-failure recovery. Current state is one stale active row and zero
   actionable instances—not zero active rows.

### Verify Before Acting

1. **"No new BILL alerts" is strong but not conclusive.** Evidence: census at
   15:50 UTC shows 61 total / 0 active / none created since 2026-08-11 02:52 UTC,
   and 45 `drain-reviewer-acceptances` runs completed post-redeploy. But **it is
   not confirmed that a real reviewer accept occurred in that window**, so the
   fix's "no new alerts" half stays `[ASSUMED]`. Re-run the census after a known
   accept: `scripts/` census in `outputs/`-style probe, or query `system_alerts`
   for `alert_type='bill_manual_onboarding'`.

2. **`drain-submissions` logs one `error` per cold start.** Evidence: the
   pre-change deployment shows the identical single cold-start `error` then
   `info` every 2 min; the body is a pg SSL deprecation warning on stderr, not a
   DAL throw. **Not a regression**, but `vercel logs` returns too narrow a window
   to watch continuously — use `maintenance_runs` instead, which showed zero
   failures.

3. **Carried from S413, unchanged:** do not resolve the SharePoint delete-rights
   question by deleting a governed artifact; the two 2026-08-10 delete attempts
   are NULL evidence; do NOT batch-resolve affiliation alerts by key prefix;
   request `1002788` still `Submitted` with a live package; the `Complete` gate
   sequencing trap; retired-table operational scripts.

4. **`system_alerts` timestamp trap.** `created_at` is `timestamp without time
   zone` holding UTC; the JS Postgres client re-reads it as local, shifting
   MIN/MAX by the local offset (+7h here). Compare and render with `to_char()`
   in SQL. Cost a mid-session correction this session.

### Do Not Reopen Without New Decision

1. **Launching a merge from a stored alert (`initialMerge`).** Killed by
   adversarial review 2026-08-11, four high findings, all independently verified.
   The existing entry attaches `conflictingRecordId` only after a *live*
   single-ACTIVE-owner re-derivation (`my-candidates-service.js:833-838`); the
   proposal would have replaced that proof with a day-old alert feeding a flow
   that deletes suggestions and deactivates a person. Also: only
   `keeper_has_suggestion` yields a mergeable pair — `ambiguous_owner` has none,
   `inactive_owner` carries no `keeperId`.
2. **`BILL_ONBOARDING_DEFERRED` set via `echo`** — trailing newline is the likely
   original cause. Use `vercel env add --value true`.
3. **Storing these three flags Sensitive again** — unreadability is what hid a
   wrong value for five weeks.
4. Carried from S413: milestone pointer-vs-copy (copy, decided); `$orderby` on
   Graph `/versions`; another adversarial round on version history; `Revision
   Requested`; re-consent on staff replacement; S411 shared-footer placement;
   ROR reset / institution checker / S408 diagnostic / S328 downloads.

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/reviewer-email-alert-routing-codex-work-order.md` | Codex verdict, evidence matrix, re-open trigger, and killed design record |
| `outputs/reviewer-email-merge-surfacing-scope.md` | The killed proposal, annotated NO-SHIP |
| `lib/services/reviewer-email-reconciler.js` | `retractNeedsMerge` + `alertKeyFor` — one key definition for both directions |
| `scripts/probe-reviewer-email-reconcile-alert.mjs` | Read-only: is a needs-merge alert still true? |
| `lib/bill/onboard-reviewer-service.js:90,94` | The two BILL gates; strict `===` on the deferred flag |
| `lib/services/dynamics-context.js:124-129` | DAL enforcement — **fails OPEN in production** |
| `lib/dataverse/core/interlock.js:77-85` | Interlock — fails CLOSED. Do not describe these two alike |
| `docs/CREDENTIALS_RUNBOOK.md` | Now carries all three flags with their failure posture |
| `docs/agent-wiki/topics/reviewer-identity.md` | Alert semantics, retraction contract, probe usage |
| `docs/agent-wiki/topics/finance-honoraria.md` | The BILL drift record + `system_alerts` timestamp trap |

## Testing

```bash
npx jest tests/unit                                    # 7283/7283 on codex/reviewer-alert-retraction
npm run check:types

npx jest tests/unit/reviewer-email-reconciler.test.js --runTestsByPath  # 35 tests

# Is a needs-merge alert still true? (read-only; per-invocation operator flag)
DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
  scripts/probe-reviewer-email-reconcile-alert.mjs --all

# Cron health is more reliable than `vercel logs` (which returns a narrow window):
#   SELECT job_name, status, COUNT(*) FROM maintenance_runs
#    WHERE started_at >= <redeploy time> GROUP BY 1,2;
```
