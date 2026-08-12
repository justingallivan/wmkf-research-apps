# Session 417 Prompt: per-reviewer due-date override; SharePoint policy input pending

## Session 416 Summary

### What Was Completed

1. **Reviewer-alert retraction hardening promoted.** The Codex work order was
   implemented, reviewed twice by Claude Opus, and fast-forwarded to `main`.
   Missing Dataverse suggestions now map to `suggestion_gone` only for the
   structured record-missing response; systemic 404s remain errors. Lifecycle
   ordering, excluded rows, open-alert gating, dry-run truthfulness, and probe
   request binding were hardened. Opus returned READY. Vercel Production deploy
   `dpl_ZyyAd6v77dDUq4kYscWsXMoikdq5` reached READY; no manual cron run followed.

2. **Reviewer due-date extension gap verified end to end.** Source tracing and a
   read-only production probe established that due dates live only on
   `akoya_request`; there is no per-reviewer override or suppression control.
   Request `1002926` has a September 9 due date. Mohammad Hafezi (live reviewer
   row: `Mohamed Hafezi`) has accepted and was granted September 14; both
   automatic reminder flags are unset/disabled,
   his token remains valid through November 4, and the submit endpoint does not
   enforce the displayed due date. No operational intervention is needed for
   this case, but the portal/calendar retain September 9.

3. **SharePoint storage-policy questions paused for owner input.** Connor's input
   is expected 2026-08-12. Do not infer policy decisions before it arrives.

### Commits
- `3872d97c` — Fix reviewer alert lifecycle retraction ordering
- `7c254d90` — Record Codex reviewer alert routing verdict
- `fa71755d` — Harden reviewer alert lifecycle reconciliation
- `a7fc1a0a` — Address Opus reviewer alert follow-up
- `5f7baf9a` — Clarify reviewer suggestion missing-record contract
- `c75a4a42` — Record reviewer alert production promotion

No runtime code changed during the due-date investigation. Full unit suite before
promotion: **575 suites / 7,283 tests**; focused review set: **153/153**.

## Next Items

### Active / Verified Open

1. **Per-reviewer review-due-date override — staged, not deployed (2026-08-11).**
   Feature branch `codex/reviewer-due-date-override` implements the new nullable
   suggestion-level DateOnly field, an accepted-row Track Reviewers extension
   modal, dedicated authenticated writer, effective-date projection, portal,
   acceptance-email/calendar, review-due reminder, and token
   issuance/regeneration fan-out. A save/restore first validates the email
   body, Dynamics impersonation setting, assigned sender, confirmed recipient,
   signature, and calendar; it then
   ETag-commits the date and automatically dispatches the fixed-subject message.
   Only an actual Dynamics dispatch failure can preserve the changed date
   without the notice. The open modal offers a server-fresh retry, and an
   existing extension always exposes Resend deadline email without another
   date write. Non-null dates must be strictly after the
   proposal's original deadline, with no maximum. Claude Opus's final
   adversarial verification returned **READY** after the preflight, retry-state,
   error-classification, and copy corrections. Latest verification is **610
   suites / 7,714 tests**, with **27/27** focused extension tests and a successful
   webpack production build. The earlier Opus adversarial follow-up is also
   addressed:
   past overrides now fail closed using the Foundation-Pacific calendar date,
   request due-date read failure falls back to the established 90-day mint
   window, and discriminating tests cover later-override reminder deferral.
   Owner decision: the accepted-reviewer token's due + 90d expiry is
   intentionally retained through the Board meeting; ordinary roughly two-week
   extensions do not rotate an issued link. `/contract-reconcile` and `/sweep`
   were run. [VERIFIED via production create, entity-scoped publish, typed
   metadata, and runtime `$select` on 2026-08-11 / 2026-08-12 UTC] the Wave 18
   field is live and EXACT. [VERIFIED via the non-clobbering setting seed, main
   `8647af33`, Vercel `dpl_AbTvWvMYb5inwPnYKTK2mkrkNXZz`, and live HTTP
   checks] the admin body and Tier-2 runtime are now production-live.
   Invitation response timing remains separate; the mutable
   override is not immutable communicated-deadline evidence for reviewer
   reliability. The prior pre-accept editor and generic `my-candidates` write
   seam are removed; the per-send composer can still diverge from stored state.

2. **Milestone snapshot producer** — carried from S413, still open.
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` "Board milestone freeze",
   DECIDED copy-the-bytes (owner, 2026-08-10). The three `wmkf_milestone*` fields
   are written nowhere today (`lib/dataverse/adapters/request-document.js:38-40`).

3. **Two non-destructive SharePoint checks** — carried from S413, still open.
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` H1/H2 block. (a) add
   "Checked Out To" to the `akoya_request` view; (b) read the Members permission
   level's Delete Items / Delete Versions. Connor's related storage-policy input
   is expected 2026-08-12; keep policy-dependent conclusions blocked until then.

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
| `.claude-memory/project-reviewer-reliability-data.md` | Current extension gap, production example, and boundary between mutable overrides and immutable deadline evidence |
| `lib/services/review-manager/campaign-config-service.js` | Current request-level due-date read/write contract |
| `lib/services/reviewer-reminder-sweep.js` | Automatic reminder eligibility and request-level due-date consumption |
| `lib/services/external-review/context-service.js` | Portal's displayed request-level submission deadline |
| `lib/services/reviewer-acceptance-email.js` | Acceptance copy and calendar attachment use the request-level deadline |
| `lib/external/reviewer-token-ttl.js` | Token-expiry policy that a per-reviewer effective date must reach |
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
npx jest tests/unit                                    # 7283/7283 before promotion to main
npm run check:types

npx jest tests/unit/reviewer-email-reconciler.test.js --runTestsByPath  # 35 tests

# Is a needs-merge alert still true? (read-only; per-invocation operator flag)
DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs \
  scripts/probe-reviewer-email-reconcile-alert.mjs --all

# Cron health is more reliable than `vercel logs` (which returns a narrow window):
#   SELECT job_name, status, COUNT(*) FROM maintenance_runs
#    WHERE started_at >= <redeploy time> GROUP BY 1,2;
```
