# Session 369 Prompt: Add reviewer closeout payability disposition

## Session 368 Summary

Session 368 completed the evidence-based documentation reset, enforced the Dataverse target/write
interlock in production, and shipped a full structured staff review-entry rescue. The canonical
priority remains `docs/CURRENT_WORK_QUEUE.md`; do not revive parked work merely because an older
plan is still marked active.

### What Was Completed

1. **Documentation ground truth**
   - Reconciled the current architecture, security, prompt, reviewer, and work-priority documents
     against live source with agent-assisted semantic inspection.
   - Established `docs/CURRENT_WORK_QUEUE.md` as the priority authority and merged PR #72.

2. **Dataverse target/write interlock enforcement**
   - Added positive activation observability, verified warn-mode production traffic against the
     production Dataverse target, and observed no would-deny outcomes.
   - After explicit owner approval, set `DATAVERSE_TARGET_INTERLOCK=on` in local, Preview, and
     Production; the signed-in Workbench smoke logged
     `mode=on deployment=production target=production` without denials.
   - PRs #73 and #74 merged; `CLAUDE.md` and the interlock plan now state the enforced contract.

3. **Structured staff review rescue**
   - Added **Enter review manually** to accepted, outstanding reviewers on the Reviews tab.
   - The dedicated authenticated route/service reuses the live question set, rich-text sanitizer,
     full validator, canonical `buildReviewSubmission()` producer, and an ETag-guarded atomic
     parent/answer-row Dataverse changeset. The legacy partial/file paths were not changed.
   - PR #75 merged as `0226f7eb`; runtime deployment
     `dpl_BjkM3tjopMpRWPMwn3NRgtB4CHSU` reached Ready with all checks green. The non-mutating
     production smoke confirmed the auth boundary; no synthetic review was written.
   - PR #76 reconciled the durable production-status facts and merged as `164a0d0f`; final
     production deployment `dpl_85nP5BvahsReM9DWwvG2NKg8Zf3q` reached Ready.

### Commits

- `8818ede3` — merge PR #72, documentation/code reconciliation
- `2585f980` — merge PR #73, Dataverse interlock observability
- `a3ae8d31` — merge PR #74, interlock enforcement evidence and closeout
- `050fb397` — add structured staff review rescue
- `0226f7eb` — merge PR #75, structured staff review rescue
- `164a0d0f` — merge PR #76, production-state documentation closeout

## Next Items

### Verified Open

1. **Reviewer closeout payability disposition — next**
   - Evidence: `.claude-memory/project-reviewer-closeout-payability.md`,
     `lib/dataverse/adapters/reviewer-suggestion.js`, and
     `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` were rechecked 2026-07-22. Current
     closeout only writes `reviewStatus=complete` plus `wmkf_completedat`; repo-wide source search
     found no payability/not-payable/did-not-serve field or logic.
   - Build this as a post-accept financial annotation, not teardown. Use `/contract-reconcile`
     across schema-as-code → adapter/service → closeout UI → operations consumer. Never delete an
     honorarium request or review snapshot as a reset mechanism.

2. **Reviewer campaign evidence window — after the closeout feature**
   - Evidence: `docs/CURRENT_WORK_QUEUE.md`, `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`,
     and `docs/REVIEWER_IDENTITY_CONTACT_PLAN.md`.
   - Keep the legacy resolver authoritative. Record bounded W2 shadow disagreements,
     identity/email outcomes, staff corrections, invitations, and review completion; make no
     automatic cutover from partial-cycle evidence.

### Owner Decision Needed

1. **Closeout disposition contract and operations surface**
   - Choose the final durable values (the current examples are `completed_payable`,
     `completed_not_payable`, and `did_not_serve`) and identify where operations must see/filter
     the signal before provisioning a Dataverse column. Do not infer either choice from the memory
     example.

2. **Optional reviewer UX work**
   - After campaign evidence, choose individual improvements only when supported by observed staff
     friction. Current candidates are campaign-settings discoverability/defaults, review-output
     formatting, and global reviewer notes/flags or a Reviewer Pool.

### Parked

1. **Pre-accept “reset reviewer” action** — proposed but not greenlit; keep separate from the
   post-accept payability annotation.
2. **Applicant intake product build** — parked while WMKF evaluates GOApply re-engineering.
3. **Automated BILL onboarding** — tabled, possibly permanently; payment remains offline.
4. **Reviewer institution-to-CRM linking and destructive reviewer cleanup** — dependency/campaign
   gated; do not resurface without their named triggers.

### Verify Before Acting

1. **First real staff-rescue submission**
   - The production release had a non-mutating auth-boundary smoke, not a fabricated Dataverse
     review submission. Observe the first genuine use end to end; do not create a synthetic review
     solely to prove the write path.

2. **Any closeout schema change**
   - Read `docs/APPLICATION_STATE_ATLAS.md` and the reviewer-suggestion Atlas page, inspect current
     schema waves, and obtain the owner decision above before planning or executing provisioning.

### Do Not Reopen Without New Decision

1. Automatic W2 cutover, legacy reviewer-reader deletion, BILL automation, intake build, and the
   whack-a-mole remediation workstreams remain explicitly gated or parked.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical priority order |
| `.claude-memory/project-reviewer-closeout-payability.md` | Owner intent and closeout safety boundary |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Current reviewer lifecycle/closeout writer |
| `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` | Reviewer-suggestion fields, readers, and writers |
| `shared/components/workbench/ManualReviewEntryForm.js` | Shipped structured staff rescue UI |
| `lib/services/review-manager/manual-review-entry-service.js` | Shipped canonical rescue write path |
| `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` | Enforced interlock design and rollout evidence |

## Testing

Session 368 release verification passed full GitHub Jest/build, Playwright, Gitleaks, Semgrep,
Trivy, Vercel, and Claude-review checks. For the next cross-layer closeout feature, run the focused
UI/route/service/adapter tests plus the Atlas, Dataverse access-layer, documentation, and production
build gates required by `docs/CI_GATES_REFERENCE.md`.
