# Session 467 Prompt: Staff Deliberations Workspace Live; UI/UX Follow-ups Queued

## Session 466 Summary

Session 466 (2026-08-27→28) rebuilt the Workbench's site-visit UI end to end
(six production releases), resolved the write-attribution question
empirically, and fixed a production generation timeout.

### What Was Completed

1. **Staff Deliberations workspace (owner-approved design → production).**
   The Pre Site Visit Writeup + Site Visit tabs are merged into one
   stage-aware tab (`shared/components/workbench/StaffDeliberationsTab.js`,
   rail Draft → Share → Wrap Up; legacy tab keys alias in). Design settled in
   the proposal artifact
   (https://claude.ai/code/artifact/23f6be12-6362-460a-9c05-ca48d333d10b):
   Share = existing guarded lock; Wrap Up = first accepted materials send
   (server-derived `currentSourceEverSent`, scoped per source document);
   "Move to Final Writeup" deliberately NOT built (open question 4b).
   Shipped increments: history language split (Sent/Superseded/Failed +
   "Send outcome unconfirmed" for ambiguous stale sends — Codex P2), GUID
   and SharePoint-filename Details/tooltip disclosures everywhere, "Site
   Visit materials" naming, logistics editor REMOVED (headless
   `useSiteVisitContext` keeps composer suggestions; ActivityParty read
   fallback covers Dynamics-scheduled visits — Codex P1), email history +
   post-send composer collapsed, calendar (.ics) UI removed (server contract
   intact), slim Wrap Up note, document display labels.
2. **Write attribution resolved empirically.** Prod
   `DYNAMICS_IMPERSONATION_ENABLED=true` since ~S271 (docs said deferred —
   reconciled); owner-run census probe showed impersonation works
   (`wmkf_ai_run` 22 staff-attributed) but ALL `wmkf_requestdocument` rows
   fall back to the service principal — privilege-intersection signature on
   the post-audit table. Fix = CRM role grant; brief for Connor prepared
   (https://claude.ai/code/artifact/f8877f90-8559-482f-8fbc-ce00e239f947).
   Access census: 8 staff hold `reviewers` (can trigger writes); superuser =
   Justin + Connor only; all real staff have linked systemusers.
3. **Executor timeout budget.** Production run `88f7c877` (Request 1002788)
   hit the 120s LLM default; `executePrompt` gained server-owned
   `timeoutMsOverride` (EXECUTOR_CONTRACT.md updated) and the pre-site
   writeup caller uses 240s. Retry succeeded same day.
4. **Record-keeping:** S465 optional-probe item closed (owner: don't
   pursue); pilot observation row added for this session.

### Commits

Main line (each feature branch Codex-reviewed where noted):
- `5eb3a58c` skip optional Dataverse probe (owner decision)
- `65e11975`/`ff84ff12` impersonation-state reconciliation + census probe
- `bba3c015` access & identity census probe
- `a9e3206b` Connor brief filed as waiting item
- `a6b7746b` distribution language fixes S2/S3/S5 + Codex P2 guard
- `6a26b560` Staff Deliberations merge (Phase 1) + Codex fixes
- `1e477d54` declutter (logistics removed, history collapsed, party fallback)
- `30cb5d90` composer trim (calendar UI out, material labels)
- `7b66e9a8` Wrap Up composer collapse · `23138eb2` slim Wrap Up note
- `db7be718` pre-site 240s LLM budget · `d5b5342f` document display labels

## Next Items

### Verified Open

1. **UI/UX follow-ups on Staff Deliberations — owner says more to do
   (S466 close).** Known queued items from the proposal artifact:
   (a) limited add-addressees control for the composer (owner: "not every
   board member"; shape to discuss — open question 5), (b) test-send
   tagging in email history (Q2), (c) Phase 2 history grouping/day headers.
   Owner will bring more; start by asking what they saw.
2. **WAITING on Connor (out until ~2026-09-10): `wmkf_requestdocument`
   staff-role privilege grant.** Brief ready to share (artifact link above);
   after the grant, owner re-runs
   `scripts/probe-write-attribution-census.js` to confirm staff attribution.
   Context: `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` §Status.
3. **PD onboarding / posture seeding — before the NEXT solicitation cycle.**
   Evidence: `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` rollout checklist.
4. **Async PD approval for staff-triggered "sent as me" mail.** Evidence:
   plan doc Broader effort; `docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md`.

### Owner Decision Needed

1. **Wrap Up → Final Writeup hand-off mechanics (proposal Q4b).** The
   "Move to Final Writeup" action needs its receiving end defined (state/
   milestone + how the Final Writeup tab consumes the doc) before it ships.
2. **Share→Wrap Up no-send fallback (proposal Q4a):** manual "Move to
   wrap-up" for visits whose materials go out off-app, or rail stays Share.

### Parked

1. **Reviewer cron-reminders ledger slice — BUILT, HELD on
   `feature/reviewer-cron-reminders-ledger` until the review cycle ends.**
   Migration 038 UNAPPLIED everywhere. Promotion sequence in
   `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 7–10 (branch copy);
   apply→merge drift alerts are warning-only (S464).
2. **Preference-matrix slice BUILD** — after Parked 1 merges; both consumers
   adopt `effectiveReviewAll` together; ask owner for UI label wording.
3. **PD tutorial refresh + distribution** — re-open at Parked 1 step (e).
4. **Post-cycle invitation-link strictness (tighten vs ratify).** Trigger:
   cycle end. `project-invitation-link-strictness-open-decision.md`.
5. **Public git history rewrite** — owner-gated destructive step
   (`docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`).
6. **Tier 2 send-path reorder** (recorded in `94012253` commit message):
   reconcile prior transport outcome before the stale asserts in
   `sendPreSiteDistribution` — fixes the ambiguity server-side that the
   "Send outcome unconfirmed" UI now flags.

### Verify Before Acting

1. **Phantom co-PI residuals (CRM-side cleanups)**: `ab@ab.com` contact on
   `1001931`, corrupted-email duplicate pair, 1002788 test-byline trio,
   18/8 cross-store drift rows. Evidence: local
   `outputs/phantom-copi-incident-2026-08-12.md` §Update 2026-08-27. Prod
   Dataverse writes — owner confirmation + preflight re-probe first.
2. **Logistics PATCH route has no in-app UI caller since S466** (editor
   removed; `[VERIFIED via grep]`, Atlas wmkf_sitevisit page). If a future
   session wants to retire the write route, re-grep callers first — the
   service + validation are intentionally kept live.

### Do Not Reopen Without New Decision

1. **Blanket per-PD review of all automated mail.** Plan doc decision 10.
2. **Reviewer flags keyed on contact.** S389 + Atlas; deliberate.
3. **Write-permission asymmetry between flag stores.** Owner 2026-08-26.
4. **Merging the parked reminders slice mid-cycle.** Owner S463.
5. **Throwaway smoke-candidate cleanup on `1002788`** (Test Homer, Francesco
   Cisco, Justin Test2) — owner removes personally.
6. **Third "always auto" preference level.** Owner S464: two-state.
7. **Re-running the 1002852 hard-failure smoke.** Owner S465.
8. **Optional Dataverse probe for S465 smoke soft spots.** Owner S466:
   don't pursue; reopen only if v5 attribution ever matters.
9. **Separate Pre Site Visit / Site Visit tabs.** Owner-approved merge
   shipped S466; legacy keys alias. Don't split back without a new decision.
10. **Calendar (.ics) attachment UI.** Owner S466: unused, removed;
    server contract intact if wanted again.
11. **In-app Site Visit logistics editor.** Owner S466: scheduling is
    handled by others in Dynamics; Workbench reads headlessly
    (`useSiteVisitContext` + ActivityParty fallback).

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/workbench/StaffDeliberationsTab.js` | Merged workspace: stage rail, generation, share modal, admin/reopen |
| `shared/components/workbench/PreSiteDistributionPanel.js` | Materials composer + collapsed history; `collapsed` + `onHistory` props |
| `shared/components/workbench/useSiteVisitContext.js` | Headless wmkf_sitevisit read feeding composer suggestions |
| `lib/services/pre-site-visit/distribution-service.js` | `currentSourceEverSent` flag; `lastErrorCode` projection |
| `lib/services/site-visit/logistics-service.js` | `refsFromParties` read fallback for Dynamics-scheduled visits |
| `lib/services/execute-prompt.js` | `timeoutMsOverride` (EXECUTOR_CONTRACT.md table) |
| `scripts/probe-write-attribution-census.js` | Owner-run createdby census (re-run after Connor's grant) |
| `scripts/probe-access-and-identity-census.js` | Owner-run app-access + linked-identity census |
| `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` | §Status: impersonation live; requestdocument grant remaining |

## Testing

```bash
npx jest tests/unit/staff-deliberations-tab.test.js \
  tests/unit/pre-site-distribution-panel.test.js \
  tests/unit/pre-site-distribution-service.test.js \
  tests/unit/use-site-visit-context.test.js \
  tests/unit/site-visit-logistics-service.test.js \
  tests/unit/execute-prompt-payload-boundary.test.js
npm run lint   # the merged-suite mock is lint-sensitive (react-hooks)
```
