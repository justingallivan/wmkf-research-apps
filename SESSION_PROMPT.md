# Session 344 Prompt: Act on prompt-legacy audit + closeout-payability; resume send-side validation & Dynamics decomposition

## Session 343 Summary

Owner-driven reviewer-workbench session. Diagnosed two production puzzles the boss surfaced
(email "limbo" + a "vanishing" test reviewer), shipped the fix for the second, then designed and
**shipped a new "Remove entirely" reviewer-removal feature** through a full Claude-review → Codex-review
→ rescue-fix → Claude-verify → merge cycle. Cleaned up the Find-Reviewers admin prompt and ran a
Fable audit of legacy admin prompts (parked as a next-session action item).

### What Was Completed

1. **Diagnosed reviewer email "limbo" (NOT an app bug).** Staff with limited Dynamics access
   triggered reviewer emails that AkoyaGo showed as sent/tracked but that did not dispatch until IT
   restored mailbox access. Root cause: Dynamics server-side `SendEmail` (`IssueSend:true`) is gated
   on the sender's mailbox "allow others to send on your behalf" setting — the app correctly recorded
   the send; Dynamics deferred delivery. No code change.
2. **Fixed the "vanishing reviewer" (re-add = fresh start).** A soft-deleted candidate that was
   re-added kept stale invite/lifecycle stamps → zombie-invited state that hid it. Fix: reset the full
   engagement stamp set on re-add, ETag-guarded (412 → refetch/recompute), unconditional on `restore`.
   Commits `341e19ad`, `c64e30ab`. Passed a Codex adversarial review.
3. **Explained contact promotion.** Confirmed a PD-added reviewer IS promoted to a Dataverse contact
   at *invite* time (a write that succeeded even while email dispatch was blocked) — that's why "testing
   testing" became a contact + honorarium request (see req 1003172, a fake dog reviewer).
4. **Shipped "Remove entirely" — permanent PD-self-service reviewer removal (S343).** Merged to main
   as `486a0a22`. Required Dataverse changeset (answer rows → suggestion → honorarium via
   `atomicParentWithChildren`); isolated best-effort contact-delete / SharePoint / Postgres cleanup that
   **never rolls back** the removal; opt-in contact deletion behind a warning modal; no blocks
   (high-trust, PD discretion). Verified: 5176/5176 tests, build ✓, surface gates green
   (trust-boundary-guid confirms the client `suggestionId` is GUID-validated). Codex rescue authored the
   3 atomicity/cleanup fixes (`934725e`); Claude committed (rescue ran read-only) + independently verified.
5. **Made the Find-Reviewers admin prompt honest.** The live `reviewer-finder.analyze` prompt had a
   legacy PART-1 admin-metadata block now sourced from Dataverse at runtime (`slimAnalyzeBodyForTrustedMetadata`).
   Owner pasted the lean body into the admin panel; documented in `docs/PROMPT_LEGACY_AUDIT.md`.
6. **Fable prompt-legacy audit** (`efc64175`). Evaluated admin-panel prompts for over-doing (inferring
   what Dataverse now provides) and promise-gaps. Confirmed the owner's thesis but narrowed it —
   redundancy only bites requestId-bound runs. Follow-up parked as an action item (`7929001b`).
7. **Captured closeout-payability owner ask** (`eff3ba74`, `9a245831`).

### Commits (all pushed to main)
- `486a0a22` Merge: "Remove entirely" — permanent reviewer removal (S343)
- `934725ee` fix: isolate contact delete + SharePoint/PG cleanup from required removal changeset
- `e2cfec5d` feat(reviewers): "Remove entirely" · `e513bf51` build plan
- `7929001b` docs(memory): park prompt-legacy-audit follow-up · `efc64175` docs(audit): Fable prompt-legacy audit
- `c64e30ab` / `341e19ad` fix(reviewers): re-add = fresh start (engagement-stamp reset + ETag guard)
- `eff3ba74` / `9a245831` docs(memory): closeout-payability owner ask + reviewer-limbo framing

## Next Items

### Verified Open

1. **Act on the prompt-legacy audit** (this session's designated next-session action item). Evidence:
   `project-prompt-legacy-audit-followup.md` + `docs/PROMPT_LEGACY_AUDIT.md`. Priority order in the memo:
   (a) dormant-but-editable admin prompts — `phase-ii.*` / `peer-review-summarizer.*` `wmkf_ai_prompt`
   rows are editable in `/admin` but the live routes still run CODE generators, so editing them is theater;
   decide wire-to-Executor vs hide/label; (b) `phase-ii.extract-structured` re-scope (gated on a requestId
   entry-path — a feature, not a trim); (c) dead-generator cleanup. Read the memo first.
2. **Resume reviewer-invite send-side validation** (carried from S341/S342 — still only the read-only
   half is done; this session did NOT touch the send path). Evidence: `git log e2cfec5d..HEAD` has no
   send-path commits; `reviewer-invite-capture-mode-not-full-sandbox.md`. Unexercised: capture-send +
   "possibly sent — verify" retry state, and abstract-edit save + 409 compare-and-set. Requires a
   THROWAWAY reviewer suggestion + proposal (capture mode blocks email only — still mints Dataverse
   tokens + stamps lifecycle).
3. **Continue the Dynamics decomposition — Checkpoint C (`write-core.js`, Stage 6).** Evidence:
   `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` (A+B EXECUTED; C–F pending). C = DAL entity-write core,
   DEDICATED review (4 `assertTrustedDalContext` sites, impersonation fallback, 412/ETag, `updateIfEmpty`
   read-modify-write). Highest-risk cluster is D (`changeset.js`).

### Owner Decision Needed

1. **Reviewer closeout-payability design.** Evidence: `project-reviewer-closeout-payability.md` (owner ask
   S343). Two parts owner liked: (a) a closeout **payable/not-payable flag** so a PD can mark a
   post-accept reviewer as having done their duty or not, and (b) a **potential/invited reset button**
   ("back to square one"). Needs a build-shape decision before implementation.
2. **How far to push the TS `check:types` gate beyond the trust boundary.** Evidence:
   `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`. The 2-route untrusted surface is compile-time closed; extending
   `@ts-check` further is optional ratcheting, not a need. (Carried from S342, unchanged.)

### Parked

1. Spec-audit design-docs recovery (work computer). Evidence: `project-spec-audit-docs-recovery-parked.md`.
2. Product/UX owner asks: review-output formatting (`project-review-output-formatting.md`),
   campaign-settings UX revisit (`project-campaign-settings-ux-revisit.md`).
3. Project-wide prompt-cache-hit audit. Evidence: `project-cache-hit-rate-review.md` (S339 flagged).
4. Dependabot #53 merge once real tests green (housekeeping). Evidence: `gh pr checks 53`.

### Do Not Reopen Without New Decision

1. **"Remove entirely" is SHIPPED to main** (`486a0a22`). Evidence:
   `lib/services/reviewer-finder/remove-candidate-service.js`, `docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md`.
   No-blocks / high-trust / audit-centric / opt-in contact delete was the owner's explicit design; do not
   re-add a test/sandbox gate or a BILL precondition without a new owner decision.
2. **Re-add = fresh start is SHIPPED** (`341e19ad`, `c64e30ab`). Re-adding a removed candidate clears the
   full engagement stamp set by design; don't "preserve" invite state on re-add.
3. **Email limbo was a mailbox-permission issue, not an app bug** (diagnosed S343). Don't hunt for an
   app-side send bug; the fix was restoring the sender's Dynamics "send on behalf" access.

### Verify Before Acting

1. **The Fable audit labeled some paths `[ASSUMED]`.** Evidence: `docs/PROMPT_LEGACY_AUDIT.md` flags a
   confirming follow-up — a full extraction-consumer write-path audit to be sure no other LLM free-text
   reaches a length-capped controlled `akoya_request` field. Trace before claiming the redundancy is
   fully contained.
2. **Optional (owner, not a task): reset the personal reviewer-finder prompt override** so it inherits
   lean v2. A per-user override still carries the old fat body; harmless but stale.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/reviewer-finder/remove-candidate-service.js` | Remove-entirely: `describeRemoval` preflight + `removeCandidateEntirely` (required changeset + isolated best-effort cleanup) |
| `pages/api/reviewer-finder/my-candidates.js` | `mode=hard` delete + `mode=removal-preflight`; server-derived `actingUserSystemId`; GUID-validated client `suggestionId` |
| `shared/components/reviewers/RemoveEntirelyModal.js` | Warning modal (opt-in contact delete) |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `ENGAGEMENT_STAMP_RESET*` + `patchStaffManualReselect` (ETag-guarded re-add fresh start) |
| `docs/PROMPT_LEGACY_AUDIT.md` | Fable per-prompt audit (redundant-extraction + promise-gap) — read before prompt-cleanup work |
| `docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md` | Remove-entirely design (no-block, audit-centric) |

## Testing

```bash
npm test                                                  # full suite (5176 green as of S343)
npm run build
npm run check:trust-boundary-guid                         # confirms client id → selector routes are GUID-validated
# Remove-entirely affected tests:
npx jest tests/unit/remove-candidate-service.test.js tests/integration/my-candidates-route.test.js tests/unit/remove-entirely-modal.test.js
# Reviewer-invite send-side (still to do; use a THROWAWAY record):
#   REVIEWER_EMAIL_DELIVERY_MODE=capture npm run dev   # capture blocks email, NOT Dataverse writes
```
