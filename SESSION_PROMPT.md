# Session 474 Prompt: Final Writeup Persona Access Proof and Rollout

## Session 473 Summary

Session 473 (2026-09-02) completed, reviewed, promoted, and Production-verified
the Workbench Reviewer Follow-up consolidation. The canonical queue now returns
to Final Writeup persona rollout.

### What Was Completed

1. **Reviewer Follow-up is Production-live**
   - The shared lifecycle navigation is live in this order: **Request list →
     Initial assessments → Reviewer follow-up → Final writeups → Awardees**.
   - `/workbench/reviewer-follow-up` provides the consolidated cycle-level
     follow-up surface while preserving the existing per-request reviewer
     workflow and explicit action semantics.
   - The cycle picker is organization-wide for authorized `reviewers` app users.
     **My requests** remains the personal default; **All requests** exposes every
     eligible request in the selected cycle, including set-aside rows only when
     explicitly requested.

2. **Request-bound writes are enforced at the server boundary**
   - Authorized staff may read the organization-wide projection.
   - Reviewer Follow-up mutations independently resolve the target request and
     allow only its lead PD or a superuser. Foreign requests are therefore
     read-only for ordinary non-lead users even if a client attempts a direct
     API call.
   - This narrow exception does not change the settled organization-open
     reviewer-person merge or staff-wide document-read decisions.

3. **Review and release evidence is complete**
   - Two independent Claude code-review passes returned **APPROVE** after the
     requested corrections.
   - The merged candidate passed 17 focused suites / 241 tests, relevant CI
     gates, lint with zero errors, type checking, and the production build.
   - Runtime merge commit `acf40fb85a36ab2d481869c706a069abea52c087`
     reached Ready Production deployment
     `dpl_7ToPKYtpXhyW3WmPmn1WiY9wz2iv`.
   - Current `main` commit `8e23aa95c5ef48c0724ccd06018d1a484015e5cc`
     is Ready in Production deployment
     `dpl_FyiMz13BupWcGtTSaMNLxPd5FntP`.
   - Authenticated Production proof: D26 changed from **My 10** to **All 44**;
     its picker reports **44 active + 184 set aside**. J26 changed from **My 0**
     to **All 5**. No write control was exercised.
   - Rollback target: deployment
     `dpl_3SJebjL3tPTdv89o5dVzR1dBS3Y2`, commit `39413e3d`.

## Next Item

### Final Writeup Persona Access Proof and Deliberate Rollout

The canonical next item is `docs/CURRENT_WORK_QUEUE.md` order 2. The v2 Final
Writeup audience configuration is already Production-live and exact, but persona
lenses remain hard-disabled in `shared/config/finalWriteupPersonas.js`.

Proceed in this order:

1. Identify one representative Program Coordinator and one representative
   Leadership user, plus an exact existing canonical Final Writeup Word item
   appropriate for access testing.
2. Prove each representative can open that exact Word item under their normal
   identity. App visibility and SharePoint file permission are separate controls;
   both must pass.
3. If both access checks pass, deliberately enable the tracked persona flag and
   run the focused tests, relevant gates, build, Preview smoke, and controlled
   Production promotion.
4. Smoke the PD, PC, Leadership, overlap, unassigned/ineligible, and superuser
   cases. Preserve the responsible-PD no-self-review rule and the neutral
   Reviewed / Updated since review semantics.

Do not infer personas from names, titles, email addresses, or program labels.
Do not add an elevated team privilege or require an outside Dataverse
administrator. Do not enable the flag before the two representative Word-access
checks pass.

## Parked — Retain for Future Work

1. Automatic reviewer-reminder scheduling and its campaign-setting prerequisites
   remain held under `docs/REVIEWER_ENGAGEMENT_SPEC.md`.
2. Public/onboarding reviewer-token documentation cleanup remains owner-deferred;
   update source generators before republishing derived artifacts.
3. Mobile-specific Workbench redesign is lower priority because mobile use is
   expected to be rare; preserve responsive correctness without treating mobile
   polish as the current work item.
4. Pre-J27 Initial Assessment Production write proof remains owner-deferred.
5. Post-cycle invitation-link strictness and reviewer-cron ledger promotion remain
   parked until the current reviewer cycle ends.

## Key Files

| File | Purpose |
|---|---|
| `docs/CURRENT_WORK_QUEUE.md` | Canonical priority and next gate |
| `docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md` | Persona configuration and rollout contract |
| `shared/config/finalWriteupPersonas.js` | Tracked rollout flag; currently `false` |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Canonical Final artifact and access model |
| `docs/REVIEWER_FOLLOW_UP_ORG_CYCLE_VISIBILITY_PLAN.md` | Historical, completed Reviewer Follow-up release record |
| `docs/REVIEWER_ENGAGEMENT_SPEC.md` | Reminder/token policy and cron hold |

## First Action

Re-read the canonical queue and persona plan, then coordinate the two named
representative access checks against one exact existing Final Writeup Word item.
No configuration or runtime write is authorized merely by beginning that proof.
