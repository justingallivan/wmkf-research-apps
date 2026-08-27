# Session 465 Prompt: Quiet-Period Work Continues; Preference-Matrix Slice Now Owner-Settled

## Session 464 Summary

Session 464 (2026-08-27) was quiet-period work while the reviewer
cron-reminders slice stays parked:

1. **Preference-matrix slice planned and owner-settled** (no code).
   New section "Preference-matrix slice — plan" in
   `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md`: additive
   `{ reviewAll, perType? }` shape (effective posture =
   `perType[workflowType] ?? reviewAll`), type axis = ledger
   `workflow_type` CHECK values, shared `effectiveReviewAll` helper, no
   data migration. Owner decisions: **two-state per type; all three
   ledgered types in the UI at launch; label wording deferred to build
   time (ask the owner, do not invent)**. HARD ordering invariant written
   into the plan: the contract change ships only AFTER the parked
   cron-reminders branch merges and both `approval_required` sites adopt
   the helper (the branch's `override?.reviewAll === true` check would
   silently ignore `perType` — posture weakening).
2. **Phantom co-PI floor closed by full census** (owner-run read-only
   probe, new `scripts/probe-placeholder-copi-census.js`): 1,084 slot
   links + 1,073 junction rows, 1,049 distinct contacts, pagination
   verified complete. **The phantom contact's 14 links are GONE (0+0 vs
   recorded 7+7)** — remediated CRM-side outside this repo; by whom is
   unrecorded (owner did not say this session). Zero other
   punctuation-placeholder co-PI contacts. Residuals (all CRM-side) in
   the incident record's 2026-08-27 update. Queue entry rewritten.
3. **PII containment (owner-directed)**:
   `outputs/phantom-copi-incident-2026-08-12.md` untracked from the
   public tree (local file kept; tracked 08-12→08-27 history queued in
   `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md` pending scope);
   the one real personal email in
   `outputs/reviewer-workflow-stabilization-fable-assessment.md` redacted
   in place (file stays tracked; reference graph intact).
4. **Migration-drift alert noise fixed and DEPLOYED TO PRODUCTION**
   (Tier 1 branch, merged `dfbe6ef9`, deployment Ready): extra-only
   drift (tracker ahead of the running build — the normal
   apply-before-merge window) is now a `migration_drift_ahead` WARNING
   (system_alert row, no email) under its own autoResolveKey; missing
   entries stay an error email under `migration-drift`; each direction
   resolves the other's key. 5 new unit tests
   (`tests/unit/migration-drift.test.js`). Applying migration 038 ahead
   of the parked merge will now be silent.
5. **Dependabot nanoid alert (CVE-2026-67214) verified already fixed**
   (GitHub alert #65 fixed 2026-08-10; tree holds patched 3.3.18/5.1.16;
   0 open alerts repo-wide). No change needed.
6. **Housekeeping**: two over-broad wildcard Bash allow rules removed
   from `.claude/settings.local.json` (untracked, this machine);
   throwaway smoke-candidate cleanup handed to the owner (see Do Not
   Reopen 5).

### Commits

`118814b7`/`29ef05cb`/`5e3ef026`/`603f51da` (preference-matrix plan +
owner decisions), `4e31ac64` (smoke-candidate handoff), `7851e913`
(co-PI census + queue), `7301ff21`/`47d511be` (PII untrack + redaction),
`24180ccd`+merge `dfbe6ef9` (migration-drift severity split), plus this
handoff commit.

## Next Items

### Verified Open

1. **Queue item 2 — writeup-slice signed-in generation smoke** (top
   commitment in `docs/CURRENT_WORK_QUEUE.md` Current sequence).
   Evidence: queue row 2; deployment and prompt v4 verified there. Needs
   explicit owner approval + a browser session: one Ready-with-warning
   generation, one hard-failure case, then Dataverse
   envelope/run/item/pointer + no-duplicate-retry verification.
2. **PD onboarding / posture seeding — before the NEXT solicitation
   cycle, no current deadline.** Evidence:
   `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` rollout checklist;
   `approval_required` freezes once at row creation
   (`grantee-deliverable-reminders-service.js`). If the preference
   matrix ships first, one onboarding pass seeds both (plan §Rollout).
3. **Async PD approval for staff-triggered "sent as me" mail** — the
   remaining unplanned Broader-effort item (inventory #1/#7/#8/#11/#12
   consent axis). Evidence: plan doc Broader effort;
   `docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md` cross-cutting finding.
   Plannable; forward-compatible with the matrix (a ledgered type joins
   by gaining a `workflow_type`).

### Owner Decision Needed

(None. S465: the owner doesn't know who removed the phantom co-PI links;
attribution closed as unknown in the local incident record.)

### Parked

1. **Reviewer cron-reminders ledger slice — BUILT, HELD on
   `feature/reviewer-cron-reminders-ledger` until the review cycle
   ends.** Commits `7c29fac7`..`059e51f9`; migration 038 UNAPPLIED
   everywhere. Promotion sequence: (a) owner applies 038, (b) seed PD
   posture (review-all on for all PDs is the safe default), (c)
   capture-mode local smoke, (d) merge, (e) PD onboarding + tutorial.
   Mid-cycle merge without (a) = reminder OUTAGE; without (b) = backlog
   freezes `approval_required=false`. NOTE (S464): the apply→merge
   window no longer emails drift alerts (warning-only), so don't rely on
   the alert as a promotion reminder. Details: SESSION_PROMPT history +
   `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 7–10 (branch copy).
2. **Preference-matrix slice BUILD — owner-settled design, blocked by
   ordering invariant.** Evidence: plan doc "Preference-matrix slice"
   section (owner decisions 2026-08-27). Build only after Parked 1
   merges; both consumers must adopt `effectiveReviewAll` in the same
   change. Ask the owner for UI label wording at build time.
3. **PD tutorial refresh + distribution** — wait until the reminder
   slice is finished/promoted (owner decision S463). Re-open trigger:
   promotion step (e) of Parked 1. Artifact: "Email Autopilot for PDs"
   (https://claude.ai/code/artifact/11586fac-9e0f-4784-833c-58bb4d0e118f).
4. **Post-cycle invitation-link strictness (tighten vs ratify).**
   Evidence: `docs/CURRENT_WORK_QUEUE.md` Audit follow-ups;
   `project-invitation-link-strictness-open-decision.md`. Re-open
   trigger: cycle end. Do not tighten or ratify silently.
5. **Public git history rewrite** — owner-gated destructive step
   (`docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`); the phantom
   incident record's 08-12→08-27 revisions and the stabilization
   assessment's pre-redaction revisions were added to its pending scope
   S464. Content remains visible in public history until executed.

### Verify Before Acting

1. **Phantom co-PI residuals (CRM-side cleanups)**: the `ab@ab.com`
   test contact on request `1001931`, the corrupted-email duplicate
   contact pair, the 1002788 test-byline trio across five requests,
   and 18/8 cross-store drift rows. Evidence: local
   `outputs/phantom-copi-incident-2026-08-12.md` §Update 2026-08-27.
   All are prod Dataverse writes — owner confirmation + preflight
   re-probe first; Connor's importer fix remains the only recurrence
   prevention.

### Do Not Reopen Without New Decision

1. **Blanket per-PD review of all automated mail.** Plan doc owner
   decision 10.
2. **Reviewer flags keyed on contact.** S389 + Atlas; person-keying is
   deliberate.
3. **Write-permission asymmetry between flag stores.** Owner decision
   2026-08-26 (route header + plan doc).
4. **Merging the parked slice mid-cycle.** Owner decision S463; hazards
   in Parked 1.
5. **Throwaway smoke-candidate cleanup (Test Homer, Francesco Cisco,
   Justin Test2 on Request `1002788`)** — owner-held S464: the owner
   removes them personally via the app's "Remove entirely" flow. Do not
   track or resurface.
6. **A third "always auto, even for VIPs" preference level.** Owner
   decision S464 (plan doc): two-state per type.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` | Canonical plan; now includes the owner-settled preference-matrix slice section |
| `lib/utils/migration-drift.js` | Cold-start drift check; S464 direction split (missing=error email, ahead=warning) |
| `tests/unit/migration-drift.test.js` | 5 tests pinning the severity/key split |
| `scripts/probe-placeholder-copi-census.js` | Read-only co-PI census (both stores, paginated, classified) |
| `outputs/phantom-copi-incident-2026-08-12.md` | LOCAL-ONLY (untracked S464) incident record + census update |
| `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md` | History rewrite plan; pending scope grew S464 |
| `lib/services/reviewer-reminder-workflows.js` | (parked branch) reviewer delivery strategies |
| `lib/db/migrations/038_reviewer_reminder_ledger_workflows.sql` | (parked branch) UNAPPLIED — apply before merge |

## Testing

```bash
# Migration-drift severity split:
npx jest tests/unit/migration-drift.test.js
# Parked-slice suites (run on the branch):
npx jest tests/unit/reviewer-reminder-workflows.test.js \
  tests/unit/reviewer-reminder-sweep.test.js \
  tests/unit/reviewer-manual-reminder.test.js \
  tests/unit/scheduled-email-service.test.js \
  tests/unit/scheduled-email-schema-parity.test.js
# Co-PI census (read-only; owner runs it):
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-placeholder-copi-census.js
```
