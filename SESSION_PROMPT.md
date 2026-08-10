# Session 413 Prompt: Close-out pane shipped, staff replace path merged (S413), reviewer auto-linking live

> **S413 update, 2026-08-10.** The staff replace path is **merged and in
> production** (`221ac40a`). The Session 412 summary below is retained as the
> historical handoff and still describes it as unmerged — that was true at the
> time of writing; "Next Items" item 1 carries the current state.

> **Handoff, 2026-08-10 (Session 412).** Two production deploys, both verified
> Ready. Shipped the Awardee Close-out pane, settled both open close-out owner
> questions, then built and adversarially reviewed a staff image/caption replace
> path (on a branch, **not merged**). Took ownership of a Codex worktree whose
> work had diverged from its brief, reviewed it, merged it, and retired the
> worktree. Resolved 9 of 34 reviewer affiliation alerts — deliberately not all 34.

## Session 412 Summary

### What Was Completed

1. **Awardee Close-out pane** (`54dd8e70`, `fdfd2c47`, merged `693ca670`,
   deployed `dpl_3QG8gRV2u66epwSnpFF7DQ1V6eJU`). `Deliverable outputs` moved out
   of the shared footer into a third pane, so the tab follows the deliverable's
   arc: Invitation → Submission → Close-out. This **supersedes** the S411
   decision that the outputs stay outside both panes; the original paragraph is
   retained and marked superseded rather than rewritten, and its test was
   rewritten to assert the new placement. The pane also names the two outputs'
   differing scopes — deliberately avoiding "every award in the cycle", since the
   export also requires Awarded status, a project leader, and a research program
   `[VERIFIED via cycle-export-service.js:57-61]`.

2. **Both close-out owner questions answered** (`357b5dd8`, `5529b8c3`).
   - **`Complete`** = the grantee's responsibility is done and downstream is
     *eligible* to proceed. Intended as a **precedent for other task types not yet
     built** — implement the semantic, not a grantee special case.
   - **`Revision Requested`** = NOT built as a transition; revisions are handled
     case-by-case over email. The transition design is retained but marked
     deferred.

3. **Staff replace path built** (branch `staff-submission-replace`, 3 commits,
   pushed, **NOT merged**). The email-based revision decision surfaced the real
   gap: staff could not write the image or caption at all. `writeGranteeDeliverables`
   has exactly one caller and cannot take a second — it requires an acknowledged
   waiver version and re-stamps status. New narrower writer + multipart route +
   Submission-pane control gated on a server-computed `canReplace`.

4. **Adversarial review found three defects; all fixed** (`79e64317`). A
   folder-wide prune that could delete a concurrent winner, a caption-only
   response-drop reported as failure, and a route trust boundary with zero direct
   coverage. Each fix mutation-checked.

5. **Codex worktree taken over, reviewed, merged, retired** (merge `42abd72a`,
   deployed `dpl_DmKM3MX9JUsywP6ivnhRwNmZsSYG`). Eight commits: reviewer names and
   affiliations in Current Reviews and exported reports, Contact→Account reporting
   tools, and guarded acceptance-drain auto-linking. **The work diverged from the
   brief I wrote** (which asked for Dataverse search + admin alert triage) — worth
   knowing when reading the branch name.

6. **9 of 34 reviewer affiliation alerts resolved** (`b2ce907e`). Scope was an
   allowlist, not a prefix sweep — see "Verify Before Acting" below.

### Live production behavior that changed today

The reviewer acceptance drain now fills an **empty** Contact parent when the
accepted affiliation is an exact normalized match to exactly one active Account
(name / AKA / legal name / DC AKA), and auto-resolves the matching mismatch alert.
Existing parents are never overwritten, Account creation is structurally
impossible (the adapter exposes only `queryAllAccounts`/`getById`), and a capped
Account scan abstains. **This path is live from `dpl_DmKM3MX9JUsywP6ivnhRwNmZsSYG`
forward — the next reviewer acceptance exercises it for real.** Nine Contacts were
linked in a pre-merge authorized production pass and independently re-verified.

### Commits (all pushed; both production deploys verified Ready)

- `54dd8e70` — Move Deliverable outputs into a third Close-out pane
- `fdfd2c47` — Drop the wider-scope note when cycle export is unavailable
- `357b5dd8` — Record the close-out lifecycle-actions design (not built)
- `5529b8c3` — Record the resolved close-out owner decisions
- `42abd72a` — Merge: reviewer affiliation rosters and Contact→Account auto-linking
  (preserving `ad32e28c`, `3b3e4c4c`, `ec276423`, `8d078159`, `dd667a23`,
  `6e323a4c`, `8bb5a0b0`, `99268074`)
- `b2ce907e` — Resolve the 9 genuinely-fixed reviewer affiliation alerts

On the unmerged branch: `eae535db`, `f3f2d42a`, `79e64317`.

Unit suite on `main`: **7161/7161**. On `staff-submission-replace`: **7172/7172**.

## Next Items

### Verified Open

1. ~~**Merge `staff-submission-replace`.**~~ **DONE (S413, 2026-08-10.)** Merged to
   `main` as `221ac40a` (no conflicts; the branch and the 10 main-only commits
   touched disjoint files) and deployed to production. Post-merge evidence:
   7206/7206 unit, all gates green, production build green. **Rehearsal caveat
   still stands:** request `1002788`'s image is the fixture that proved the
   inline-image path; replacing it prunes the original to SharePoint's recycle
   bin. Any live smoke of the replace control goes on a different request.

2. ~~**25 reviewer affiliation-mismatch alerts remain open.**~~ **CLOSED by the
   owner, 2026-08-10 (S413)** — Justin resolved them outside the app. Evidence:
   `node scripts/probe-reviewer-affiliation-alerts.mjs` (read-only) now reports
   **0 open, 75 resolved**; the total held at 75 (was 25 active + 50 resolved),
   so the 25 were resolved in place, not deleted. No capped-scan alerts. Whether
   each underlying affiliation was actually corrected in Dataverse was **not
   verified by this probe** — it reports alert status only.

3. ~~**August 10 references beyond the work queue.**~~ **DONE (S413, 2026-08-10.)**
   The owner's "internal buffer, not an external commitment" classification —
   which previously lived only in `docs/CURRENT_WORK_QUEUE.md` row 1 — is now
   propagated to the Calendar gate section of
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` (a status banner
   governing the document's later mentions), `docs/STRATEGY.md` items 1 and 3,
   and `docs/agent-wiki/topics/strategy-roadmap.md` (both sites). Remaining
   "August 10" strings are records of owner decisions made at the time and are
   explicitly covered by the banner; they were left historical rather than
   rewritten. Original evidence:
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` (5 mentions),
   `docs/STRATEGY.md:164`. `docs/CURRENT_WORK_QUEUE.md:37` was corrected this
   session with the owner's clarification; the rest still read as a live deadline.
   `/sweep`-shaped, not a one-line edit.

4. **Workbench version history, administrator restore, milestone snapshots.**
   Evidence: `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` evidence
   matrix — PLANNED, no producer. Administrator *restore* depends on Connor's
   answers; **milestone snapshots and history display do not** and could move now.

5. **Optional cleanup:** `origin/codex/alert-triage-dataverse-probe` still exists
   at `99268074`. Fully contained in `main`; kept as a free backup. Delete when
   you want.

### Blocked — Waiting On External Response

1. **Initial Assessment pilot: administrative evidence.** Evidence:
   `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` §"Required follow-up"
   item 5; brief emailed to Connor 2026-08-09. Four read-only checks (version
   limits, second-stage recovery, Purview retention, editor least privilege).
   **No response as of 2026-08-10.** Do not treat silence as a pass.

### Owner Decision Needed

1. **Should a staff image substitution leave an audit trace?** Evidence:
   `docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md` "As built" section. The writer deletes
   the prior image on replacement, so the grantee's original leaves the folder and
   survives only in SharePoint's recycle bin, with no in-app record that a
   substitution happened. Consent is settled (original waiver stands); this is a
   "what does the record say we published" question. Cheap now, awkward to retrofit.
2. **What triggers `Closed No Response`?** Manual, or automatic after an overdue
   threshold? Blocks the last undesigned transition.
3. **Per-send deadline override divergence.** Evidence:
   `render-emails-service.js:271`, `send-emails-service.js:916`. Unchanged.
4. **Whether `DEVELOPMENT_LOG.md` is revived or formally retired.** Evidence: file
   tail "Last Updated: May 14, 2026"; S409–S412 added no entries. **No entry was
   added this session deliberately** — writing one would preempt this decision.
5. **Residual Reviews-surface duplication.** Owner said "looks good for now"; drop
   only on explicit request.
6. **Cycle measurement tool live evidence re-discovery.** Justin said he would test
   further.

### Verify Before Acting

1. **Do NOT batch-resolve affiliation alerts by key prefix.** The specific 25 rows
   this warned about are gone (owner-resolved, S413) — but the rule stands for
   every future alert. Evidence:
   `.claude-memory/feedback-list-and-confirm-before-bulk-deletes.md` (S412
   extension). An alert describes a mismatch; resolving one that was never fixed
   destroys the only signal that reviewer needs attention.
   `scripts/resolve-fixed-reviewer-affiliation-alerts.mjs` re-derives each row's
   justification at run time and refuses anything it cannot reproduce — reuse that
   pattern rather than a sweep.

2. **Request `1002788` is still `Submitted` with a live package** — approved
   abstract, caption "Homer in a blimp", and an image in `Grantee_Uploads`. It has
   **no in-app path forward**: the post-`Submitted` transitions still have no
   writer, and the staff replace path (now merged) does not move status. Re-cleaning
   is manual: delete the `wmkf_granteedeliverable` row, clear
   `wmkf_abstractapproved`, remove the SharePoint file.

3. **The `Complete` gate has a sequencing trap.** Nothing writes `COMPLETE` today,
   and no consumer reads deliverable status — the cycle export query has no such
   term `[VERIFIED via cycle-export-service.js:57-61]`. Applying an eligibility
   filter before the writer exists and rows are backfilled would **empty the cycle
   export**. Order: writer → backfill → gate, and warn rather than exclude first.

4. **Retired-table operational scripts** (25 non-archive scripts referencing
   dropped `reviewer_suggestions`; count corroborated by
   `docs/CURRENT_WORK_QUEUE.md`). Still needs caller review + owner-approved scope.

### Do Not Reopen Without New Decision

1. **`Revision Requested` as a built transition** — deferred by owner 2026-08-10
   in favour of case-by-case email.
2. **Re-consent on staff replacement** — owner decided the original waiver stands;
   the concern was raised and knowingly accepted.
3. **The S411 shared-footer placement of `Deliverable outputs`** — superseded.
4. **ROR strategic reset**, **institution checker / enrichment seam iteration**,
   **S408 15-row promotion diagnostic**, **S328 post-submit downloads** — all
   closed by prior owner decisions.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/workbench/AwardeeTab.js` | Three panes; Close-out holds the outputs; Submission holds the staff replace control |
| `lib/services/workbench/grantee-deliverables/replace-submission-service.js` | Staff image/caption writer (live on `main` since `221ac40a`). Rollback confirms on image ref ALONE — never add a status term |
| `shared/config/granteeDeliverableStatus.js` | `STAFF_REPLACEABLE_STATUSES` / `isStaffReplaceableStatus` — one definition, server-computed into `canReplace` |
| `lib/services/auto-link-reviewer-contact-account.js` | Live acceptance-time Contact→Account auto-link; exact-match only, fill-only, no Account creation |
| `lib/utils/reviewer-institution-account-match.js` | Exact normalized matcher; ambiguity abstains |
| `scripts/probe-reviewer-affiliation-alerts.mjs` | Read-only alert enumeration |
| `scripts/resolve-fixed-reviewer-affiliation-alerts.mjs` | Allowlist resolve; re-derives justification at run time |
| `docs/GRANTEE_SUBMIT_VISIBILITY_SPEC.md` | Close-out design, resolved owner decisions, staff replace "As built" |
| `.claude-memory/feedback-mutation-test-with-the-discriminating-fixture.md` | This session's durable lesson |

## Testing

```bash
npx jest tests/unit                       # 7206/7206 on main after 221ac40a
npm run check:types

# Staff replace path (now on main)
npx jest tests/unit/grantee-replace-submission-service.test.js \
  tests/unit/grantee-deliverables-replace-submission-route.test.js \
  tests/unit/awardee-tab.test.js --runTestsByPath

# Reviewer auto-link / alert lifecycle
npx jest tests/unit/auto-link-reviewer-contact-account.test.js \
  tests/unit/alert-reviewer-affiliation-mismatch.test.js \
  tests/unit/reviewer-acceptance-drain.test.js --runTestsByPath

node scripts/probe-reviewer-affiliation-alerts.mjs   # read-only, no writes
```
