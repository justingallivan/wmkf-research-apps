# Session 314 Prompt: (open — pick from Next Items)

## Session 313 Summary

Docs/memory hygiene session. No feature or app code shipped. Restored MEMORY.md router
headroom (it was ~364 B from the hard cap and nagging every startup) and refocused the
stale ground-truth remediation doc. A worktree was opened for Codex to do the memory work,
but the `codex:codex-rescue` sandbox could not write the sibling worktree dir, so the edits
fell to Claude in-checkout (new durable fact captured).

### What Was Completed

1. **Memory-router hygiene** (`e4a53538`, merged `1093492d`). `.claude-memory/MEMORY.md`
   was 11,924 / 12,288 B — within ~364 B of the hard cap and tripping the per-session
   pressure warning. Consolidated same-target/same-domain router lines (Dataverse-dynamics
   2→1, security-auth 2→1, strategy-roadmap 2→1 folding in Virtual Review Panel;
   prompt-executor+governance and finance-honoraria+honorarium-landscape merged) and
   trimmed redundant parentheticals whose detail already lives in the pointed-to
   leaf/wiki/build-plan files. **Result: 11,255 B / 100 lines (was 11,924 / 105) — 669 B
   cut, under the 11,264 B early-warning band.** No slugs dropped; `check:memory-router`
   confirms all links resolve. Byte budget is a property of the router file ONLY — leaf→wiki
   moves don't help it, so the fix was purely shrinking MEMORY.md.
2. **New durable fact captured** in `reference-codex-rescue-plan-task-runs-readonly.md`:
   the `codex:codex-rescue` sandbox's writable root is the MAIN checkout, so it CANNOT
   write to a sibling git worktree dir (`../WMKF_Apps-codex` → "Operation not permitted").
   The `parallel-agent-worktree` pattern therefore does NOT work through the rescue agent —
   launch Codex natively in the worktree, or do the edits in-checkout.
3. **Refocused `docs/CLAUDE_REMEDIATION_PLAN.md`** (`fc3d3e9a`, pushed). The doc (created
   S136, 2026-05-07) still read as a mid-crisis plan to BUILD the Atlas + its CI gate +
   the CLAUDE.md rules — all shipped weeks ago — fronted by a large S136 re-litigation
   table. Rewrote (175→58 lines): enduring ground-truth operating rules up front
   (probe-before-plan + labels, no-"is-X"-without-checking, commit probe scripts, memory
   hygiene, adjacent-context survey, active doubt, stale-page re-probe), a "Build-out status
   (shipped)" table, and a condensed dated historical origin note (full log in git history).
   Verified first that CLAUDE.md Rule #1 still *defers* to this doc and most of its rules
   live ONLY here — so it was rewritten, not retired. File path + headings unchanged → the
   ~18 inbound references still resolve.

### Worktree state
- `../WMKF_Apps-codex` is **parked** on `codex/parked` at `1093492d` (kept with its
  `node_modules` + symlinks for reuse). `codex/memory-hygiene` branch deleted post-merge.

### Commits
- `e4a53538` — Memory hygiene: restore MEMORY.md router headroom (S313)
- `fc3d3e9a` — Refocus CLAUDE_REMEDIATION_PLAN on live rules; mark build-out shipped
- `1093492d` — Merge memory hygiene (no-ff)

## Next Items

### Verify Before Acting

1. **Confirm 1003125 now shows all 5 renamed applicant reviewers.** The roster cache was
   cleared in S312; the fix still needs a real check. Have Duncan **reload the Find tab** on
   1003125 (proposal must be loaded) — expect Kevin Turing / Kyle Worming / Shultzie Spore /
   Harry Ewing / William Harrison in the Applicant-suggested section (distinct names → no
   collapse). Evidence: S312 roster delete; `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
2. **Other D26 requests may have been missed by the triage backfill** (like 1003125 was).
   Offered but NOT run: a read-only sweep of D26 `akoya_requests` that are `triage=null` and
   not `Phase II Pending` (invisible on the dashboard). Evidence: `pages/api/workbench/dashboard.js:166`.

### Verified Open

1. **Applicant-suggested roster cache-staleness gap (product fix).** Editing/renaming an
   applicant reviewer after the first enrichment silently won't reflect — the durable roster
   cache blocks re-enrichment and there's no UI to force it. Real fix: invalidate/re-enrich
   applicant roster rows when the source person record changes, or expose a manual "re-enrich
   recommended" control. Evidence: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`
   (Operating Notes, S312); `reviewer-search-logic.js:123`.
2. **Reviewer-materials attach-and-verify build (option 2).** Design captured (`a84e5f8b`),
   not built: staff "attach reviewer materials" action backed by a Dataverse link entity +
   queryable "materials attached ✓" state; keep the folder-walk as a transition fallback.
   Evidence: `docs/agent-wiki/topics/external-reviewer-portal.md` (design-direction note).
3. **Bracket-alias cleanup PR (email templates).** S311 left the System-B resolvers
   DUAL-SYNTAX (accept `[x]` and `{{x}}`) for a soak. After confidence, drop the legacy
   `[bracket]` aliases. Do NOT remove before greenlit — intentional, not dead code. Verified
   S312: 0 per-user prefs still carry brackets (`scripts/probe-user-email-token-syntax.mjs`).
   Evidence: `docs/EMAIL_TOKEN_SYNTAX_UNIFICATION_PLAN.md` §5; `[[project-email-template-token-syntax]]`.
4. **Surface the 3 board-identity fields on Track Reviewers (read-only) + Excel export.**
   Carried S308→S313, still NOT built. `my-candidates` DTO emits
   `academicRank`/`primaryDepartment`/`mainInstitution` (`my-candidates.js:214-216`) and
   `CandidateEditModal` edits them, but Track Reviewers cards + the workbook don't show them.
   Evidence: `docs/REVIEWER_STAGE2A_IDENTITY_CAPTURE_BUILD_PLAN.md` §C step 9.
5. **Optional invite-modal follow-up: collapse the campaign-timeline block** into a
   `<details>` for more message-body room. Offered S310, not greenlit. Low effort.
   Evidence: `shared/components/reviewers/InviteEmailModal.js` (timeline block ~L294-319).
6. **Reviewer nice-to-haves #4 & #5 unbuilt.** #4 reviewer-memory flag + searchable notes;
   #5 controlled expertise-tag taxonomy / editable tags (free-text export shipped S308).
   Evidence: `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md` §4, §5.
7. **Optional `wmkf_firstname` trailing-whitespace second pass.** Low-priority hygiene; the
   `wmkf_name` cleanup did NOT cover it. Note: the 1003125 test reviewers have leading/trailing
   spaces in `wmkf_name` (e.g. `" Kevin Turing "`) — cosmetic (normalization trims). Evidence:
   `docs/agent-wiki/topics/dataverse-dynamics.md`.

### Owner Decision Needed

1. **Writeup-generator tab + reviewer-database browse.** On the docket (S308); board-identity
   fields feed them. Needs scope/prioritization. Evidence: `.claude-memory/project-workbench-consolidation-rollout.md`.
2. **Remit-flag on review-completion** — wire `wmkf_authorizationtoremitpaymentflag` on submit?
   Carried S304/S305. Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.

### Parked

1. **Honorarium payment pipeline enablement.** Capture-only in prod (S309):
   `HONORARIUM_ONBOARDING_DEFERRED` + 3 discriminator GUIDs absent force `isCaptureOnly()`.
   Re-open trigger: leadership decision. Evidence: `lib/bill/honorarium-onboard-orchestrator.js:47-56`.
2. Longer carried list (BILL API access, PNI self-report, workbench access boundaries,
   applicant-exclusion, Dataverse settings audit, nomenclature/app-sunset sweep).
   Re-open trigger: owner prioritization. Evidence: `.claude-memory/MEMORY.md` router.

### Do Not Reopen Without New Decision

1. **The digit-stripping name normalization is load-bearing (S312).** `normalizeReviewerName`
   / `normalizeName` strip non-alpha incl. digits by design (stable keying for the roster
   unique index, the person `normalizedName` column, excluded-name matching). Don't "fix" the
   regex; a real same-name-collision fix means keying dedup on name + an identity anchor.
   Evidence: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` (Operating Notes).
2. **thankyou email has NO secure-link button (S311).** No fallback label → button suppressed
   (a body with a review link renders a plain link). Intentional. Evidence:
   `pages/api/review-manager/send-emails.js` `DEFAULT_REVIEW_BUTTON_LABELS`; `3817944e`.
3. **`{{proposalTitle}}` vs `{{proposalClause}}` are distinct (S311).** Bare title vs full
   null-safe clause. Don't "consolidate." Evidence: `[[project-email-template-token-syntax]]`.
4. **Email template dual-syntax `[bracket]` aliases are intentional (S311), not dead code.**
   Don't remove until the cleanup PR (Verified Open #3) is greenlit.
5. **h-index is NOT staff-editable in edit modals (S310).** Server route still accepts `hIndex`
   from other callers — intentional. Evidence: `CandidateEditModal.js`; `204086ec`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `.claude-memory/MEMORY.md` | Router; 11,255 B, ~1KB headroom. Byte budget is the router file only — route new domain detail to `docs/agent-wiki/topics/`, not new router lines. |
| `docs/CLAUDE_REMEDIATION_PLAN.md` | Ground-truth operating rules (rewritten S313); CLAUDE.md Rule #1 defers here. |
| `.claude-memory/reference-codex-rescue-plan-task-runs-readonly.md` | codex:codex-rescue sandbox limits — read-only-at-launch + can't write sibling worktree dirs. |
| `pages/api/workbench/dashboard.js` | PD dashboard feed; visibility = `Phase II Pending` OR `triage=Advancing` (`:166`). |
| `shared/components/reviewers/reviewer-search-logic.js` | `hasValidApplicantEnrichmentCache` (`:123`); `normalizeReviewerName` re-export. |
| `lib/services/reviewer-roster-store.js` | Durable `reviewer_find_roster` (Postgres), keyed `(request_id, normalized_name)`. |

## Testing

```bash
npm test   # full suite (283 suites / 3571 tests green as of S311; only docs/memory changes since)
```
