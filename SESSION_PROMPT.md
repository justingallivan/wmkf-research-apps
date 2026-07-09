# Session 350 Prompt: Whack-a-mole meta-review + next-up fixes, or staff review-rescue tool

## Session 349 Summary

Shipped the reviewer decline-referral loop-closure (Fable P3.1) end-to-end, hardened it
across two Codex adversarial passes, captured the reviewer holistic-redesign as a PARKED
branch-build, and ran a three-agent whack-a-mole audit that produced a Fable meta-review
prompt + a tiered remediation to-do.

### What Was Completed

1. **Red gate fixed — `check:drain-table-mentions`** (`a320545`). `publications.js` code-module
   reference in the Fable holistic prompt flagged as a drained-table mention; added the standard
   `<!-- drain-table:ignore reason=code-module -->` marker.

2. **Reviewer holistic-redesign — branch-build direction captured** (`7ea2777`, `384e57c`).
   The Fable holistic review + `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` were run
   (owner) and committed. New memory `project-reviewer-holistic-redesign-parallel-build.md` +
   router entry + a plan "Execution model" note record the owner's direction: build the WHOLE
   plan on a **dedicated testing branch**, then compare the finished pipeline **head-to-head
   against main** — NOT incremental-to-main. Staging (P0→P4) stays; only *where phases land*
   changes. **PARKED pending owner go.**

3. **Decline-referral feature SHIPPED** (`e955a1d`, `701b15a`, `0ea8f80`, `f805b5f`). Staff-side
   reader for reviewer decline-referrals (the free-text "Anyone you'd suggest instead?" captured
   to `wmkf_declinereferral` — capture was ALREADY live) + a Track-Reviewers callout + one-click
   "Add as candidate" that reuses the manual-reviewer abstain-or-confirm flow. New `GET
   /api/workbench/decline-referrals` + service + test. **Two Codex adversarial passes** found
   stale-state races; root-fixed by keying `ReviewersTab` by requestId (matches `AwardeeTab`),
   plus per-loader guards + a regression test. Full suite green (5203).

4. **Whack-a-mole audit + Fable meta-review prompt** (`09feb2f`, `c97877d`). Three parallel
   agents swept plans/audits, memory, and wiki/dev-log. Synthesis + tiered remediation to-do:
   `docs/audits/whack-a-mole-audit-2026-07-08.md`. Fresh-eyes "prevent-the-class" prompt:
   `docs/WHACK_A_MOLE_META_REVIEW_FABLE_PROMPT.md` (output points at a TRACKED
   `docs/audits/` path so findings return via git).

### Commits (9, all on main, pushed)
- `c97877d` docs: point Fable meta-review output at a tracked path
- `09feb2f` docs(audit): whack-a-mole audit + Fable meta-review prompt + tiered to-do
- `f805b5f` fix(workbench): key ReviewersTab by requestId — root fix for stale-request races
- `0ea8f80` fix(workbench): extend stale-request guard to reviewer/candidate loaders + regression test
- `701b15a` fix(workbench): harden decline-referral prefill + stale-request guard (Codex review)
- `e955a1d` feat(workbench): surface reviewer decline-referrals to staff + one-click add
- `384e57c` docs(reviewer): clarify branch-build model — staging stays, comparison is end-product
- `7ea2777` docs(reviewer): capture holistic-redesign branch-build direction
- `a320545` fix(gate): annotate a code-module filename ref in Fable prompt (drain-table false positive)

## Next Items

### Verified Open

1. **Dispatch the whack-a-mole META-review (owner runs Fable) — do this FIRST.**
   Evidence: `docs/WHACK_A_MOLE_META_REVIEW_FABLE_PROMPT.md`; anchored on
   `docs/audits/whack-a-mole-audit-2026-07-08.md`. NEW `claude-fable-5` session, `git pull`,
   "Read and execute …", NO `/start` or `/stop`. Fable writes + commits
   `docs/audits/whack-a-mole-meta-review-fable-2026-07-08.md` (tracked). Scopes codebase-wide
   "prevent the class" changes; may reprioritize the next-up fixes.

2. **Whack-a-mole next-up fixes** (bounded; do after the meta-review, or the first two
   independently). Full tiered list in `docs/audits/whack-a-mole-audit-2026-07-08.md`
   §"Remediation to-do":
   - Carryover-freshness gate (recurring class with NO existing guard).
   - Finish the code-level nomenclature rename (route namespaces / authz keys still carry
     `reviewer-finder`/`review-manager`/"candidate").
   - Akoya cycle-code fail-loud (off-month meeting dates silently drop from Jxx/Dxx cohorting).
   Backlog (future): Dynamics Explorer auto-schema; idempotent Dataverse deploy; engagement-stamp
   state machine; dual reviewer-count consolidation; TS-adoption decision; DAL "site 33" tail.

3. **Build the staff "manual review rescue" tool.** (Carried from S347/S348, not started.)
   Evidence: `project-staff-review-rescue-tool.md`; `project-reviewer-upload-dormant-not-deleted.md`.
   Full structured-review entry surface (mirror `ReviewAuthoringForm`, route through
   `lib/external/build-review-submission.js`). Backends exist. **Blocked on placement decision (below).**

### Owner Decision Needed

1. **Green-light the reviewer holistic redesign branch build?** Evidence:
   `project-reviewer-holistic-redesign-parallel-build.md`; `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`.
   PARKED pending explicit go. The `confirmed`-sentinel downgrade (was a standalone owner
   question) is now P0/P1 of this plan — decide it there unless pulling it forward as an
   isolated safety fix.
2. **Staff rescue tool placement.** Admin/superuser page vs. Reviews tab — decide before Verified Open #3.
3. **Reviewer closeout-payability design.** Evidence: `project-reviewer-closeout-payability.md` (S343).
4. **How far to push the TS `check:types` gate.** Evidence: `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`.
   (Likely informed by the whack-a-mole meta-review — coverage-tool item #7.)

### Owner Action (off-machine)

1. **Recover the `codex/spec-audit` design docs.** Evidence: `project-spec-audit-docs-recovery-parked.md`.
   Commit `370f3867` (holds `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md` + `REVIEWER_QUOTA_PD_EMAIL_PLAN.md`)
   is unpushed on the **work computer**; the *feature* already shipped (`a3103b3c`). On the work
   computer: `git push origin 370f3867:refs/heads/codex/spec-audit`, then fetch + `git merge --no-ff` here.

### Parked

1. Reviewer holistic redesign branch build (owner go pending — see Owner Decision #1).
2. "No longer needed" stand-down flow for ACCEPTED reviewers (S347; `withdraw-sufficient` only targets invited-pending).
3. Product/UX asks: review-output formatting (`project-review-output-formatting.md`), campaign-settings UX (`project-campaign-settings-ux-revisit.md`).
4. Project-wide prompt-cache-hit audit (`project-cache-hit-rate-review.md`).
5. Dependabot #53 merge once real tests green (`gh pr checks 53`).

### Verify Before Acting

1. **Whack-a-mole next-up fixes are audit *recommendations*, not confirmed worklists.** Before
   building each: nomenclature rename → grep live route/authz usage to scope the blast radius;
   carryover gate → confirm no existing guard already covers it; cycle-code → read
   `akoya-temporal-axis-encodings.md` for the exact silent-drop shape. The whack-a-mole meta-review
   may reprioritize or reframe these — running it first is the intended order.

### Do Not Reopen Without New Decision

1. **Decline-referral feature is SHIPPED (S349).** Evidence: `e955a1d`+3 fixes;
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` §"Decline-referral surface". The
   CAPTURE (`wmkf_declinereferral` write) was already live pre-S349 — do NOT rebuild it. The
   `ReviewersTab` requestId key (`f805b5f`) is the root fix for stale-request races — do NOT revert.
2. **Reviewer holistic redesign ships on a BRANCH, head-to-head vs main — NOT incrementally to
   main.** Evidence: `project-reviewer-holistic-redesign-parallel-build.md`. Don't follow the
   plan's "one phase per PR to main" prose; that's superseded by the branch-build model.
3. **Intake portal build is PARKED (owner S348).** Evidence: `project-intake-portal-parked.md`.
   Design memories retained-for-revival, NOT stale.
4. **S348 memory triage is code-grounded — don't re-litigate.** `project-reviewer-institution-match`
   correctly stale; `project-system-model` counts point to CANONICAL_COUNTS by design.
5. **`ReviewFormFields.js` deleted (S347); "Remove entirely" via Remove ▾ (S347); local dev auth
   correct (S346); DynamicsService decomposition (S345) / peer-review Executor migration (S344) /
   4 PDF-app sunset (S344) all COMPLETE.** Don't revert or re-inline.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/audits/whack-a-mole-audit-2026-07-08.md` | Whack-a-mole audit + tiered remediation to-do (Verified Open #2) |
| `docs/WHACK_A_MOLE_META_REVIEW_FABLE_PROMPT.md` | Fresh-eyes "prevent-the-class" Fable prompt (Verified Open #1) |
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | PARKED reviewer redesign (branch build; Owner Decision #1) |
| `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md` | Branch-build execution model + intent |
| `pages/api/workbench/decline-referrals.js` | Shipped decline-referral reader route (S349) |
| `lib/services/workbench/decline-referrals-service.js` | Decline-referral service (declined rows with a referral) |
| `shared/components/reviewers/ReviewersTab.js` | Keyed by requestId (root stale-request fix); fetches declineReferrals |
| `shared/components/external/ReviewAuthoringForm.js` | Model for the staff review-rescue tool (Verified Open #3) |
| `lib/external/build-review-submission.js` | Canonical structured-review producer; reuse for rescue tool |

## Testing

```bash
npm run lint && npm run check:types
npm test                              # full suite (5203 at S349); green means FULL suite
npm run check:memory-health           # advisory worklist (never fails)
# Fable meta-review: NEW claude-fable-5 session, "Read and execute docs/WHACK_A_MOLE_META_REVIEW_FABLE_PROMPT.md"
#   (do NOT run /start or /stop in the Fable session; it commits its findings doc)
```
