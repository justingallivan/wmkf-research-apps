# Session 656 Prompt: #561 ready to merge on owner go-ahead; #562 built, awaiting wording review and release steps

**Handoff destination:** `main`, docs and operator scripts only. Reviewer feature work lives on two
branches (below); nothing from this session was merged or deployed.

Session numbering is shared: Codex used 654 for the Board release work (#563/#564), so this Claude
session is **655**. Earlier handoffs, retrievable exactly: Codex Session 654 (Board CSO cc + hourly
release email, live and verified) `git show b091cf5cd:SESSION_PROMPT.md`; Claude Session 653
`git show 88992f3d6:SESSION_PROMPT.md`; Claude Session 652 with Codex 649 `git show
45814e64c:SESSION_PROMPT.md`.

## Session 655 Summary (Claude, 2026-10-30 Pacific)

Start: all 41 `check:*` gates and self-tests green on `main`.

### What Was Completed

1. **[PR #562 DRAFT, head `54a63a652`, build complete] Materials on acceptance (D46/D48/D49).**
   Branch `claude/reviewer-materials-on-accept`, worktree `../WMKF_Apps-materials`.
   - **Manual send claims the shared release row** (`send-emails-service.js` `claimManualMaterialsRelease`,
     staff profile from the route) just before its mint; an existing row refuses
     (`materials_already_sent` for sent/recorded, else new `materials_release_in_progress`); a claim
     that cannot be checked fails closed. A materials draft without the reviewer link and
     `markAsSent: false` for materials are now refused.
   - **Recovery (owner-approved after Codex):** `failed` releases retaken by any normal send;
     `uncertain`/abandoned resent only via the Release modal's **Send again**
     (`recoverMaterialsReleaseIds`); the acceptance drain's stuck loop records `sent` rows of any
     source from `sent_at` (never resends), closes them when the reviewer has since closed/withdrawn
     (`reviewer_closed_after_delivery`), and rotates its bounded batch; **Mark as delivered**
     (new `POST /api/review-manager/materials-release-delivered`, lead PD or superuser) closes the rest
     (`staff_marked_delivered`).
   - **D48 invitation PDF gate:** shared `review-manager/invitation-proposal-pdf.js` refuses an
     emailed invitation, and a `regenerate-token` *first* link for a never-invited reviewer, while the
     reviewer PDF is missing or its folder cannot be checked (`proposal_pdf_missing` /
     `proposal_pdf_unavailable`); only a speculative archive `graph_folder_not_found` is ignored
     (`listReviewerMaterialsWithAvailability` now returns `unavailableSources`).
   - **Accepted-screen copy** (draft, owner review in PR): link "usually within a few minutes",
     old link "may stop working", contact PD if nothing by the next business day.
   - CodeQL format-string alerts fixed. Codex: 2 rounds on the manual claim/recovery, 2 on the D48
     gate/copy, all findings fixed; final round **approved, no findings**. Full Jest 26,466 passed
     locally; `/contract-reconcile` Mode B on the manual claim and recovery.
2. **[PR #561 READY, head `646429d93`, CI green] Board setup from the calendar (D47).** Merged `main`
   (#563/#564) into the branch; one test conflict resolved (kept calendar dates arg + hourly helpers);
   full Jest 26,388 green. **All three Production checks now pass** (owner-run probe): D26 Board Mailing
   Date set by the owner to **2026-11-25** (typed setup said 11-02; display-only effect: notices and
   page show 11-25), Board Meeting Date 2026-12-10, no pending intent or unsent draft. **Merge awaits
   the owner's explicit go-ahead.**
3. **Production reads and one owner-authorized write (no other Production changes).**
   - Owner-run `scripts/probe-reviewer-build-premerge.cjs`: #562 pre-merge state is 091 not applied,
     template keys not seeded (both deploy-time steps), J27 Reviewer Finder cycle exists, the one PD
     materials override keeps `{{externalLink}}`.
   - D26 "open" invitations explained (`scripts/probe-d26-unswept-invitations.cjs`): **12** genuinely
     unanswered and matching the stale sweep's discovery filter (it closes them at the D26 Board date
     if each request's Grant Cycle link and Board date re-check holds [ASSUMED per row; not probed]); **2** on test requests
     1003222/1003125 with live links → **closed as No Response by Claude on the owner's explicit OK**
     (`scripts/close-out-d26-open-invitations.mjs --only …`, `DATAVERSE_PROD_WRITE_ACK` "D26
     test-request invitation close-out 2026-10-31", 2 written, 0 errors, no email); **29** are staff
     **Remove candidate** rows (`softDelete`: unselected, link revoked) — already closed, leave as-is.
     No real D26 reviewer holds a working link. Owner: D26 reviewer cycle is over; no D26 reviewer may
     be emailed about proposal availability. No J27 invitations have been sent.

### Commits

- #562: `8e249963d` manual claim, `f93017b9a`, `a1e77c57f` recovery, `a6f7ade8a`, `753e91023` Codex
  round 2, `236f85755` CodeQL, `a47404a75` PDF gate + copy, `e8dd078e9`, `54a63a652` Codex round.
- #561: `646429d93` merge of `main`.
- `main`: this handoff plus the three operator scripts above.

## Next Items

### Owner Decision Needed

1. **Merge #561** (Tier 2; `main` auto-deploys). Evidence: probe output this session; PR comment on
   the merge. After deploy, confirm the D26 Board page shows calendar dates (materials 2026-11-25).
2. **#562 release:** owner wording review in the PR (combined acceptance email; accepted screen), then
   in order: apply migration **091** (`node scripts/apply-migrations.js`), seed the two
   `email.reviewer_materials_acceptance.*` keys (`scripts/seed-email-defaults.mjs`, create-only),
   then merge. Each step is a live action needing explicit OK. D26 condition is satisfied (above).
3. **Remove-candidate history loss** (new finding, not in #562): `softDelete`
   (`lib/dataverse/adapters/reviewer-suggestion.js:2451`) clears `wmkf_responsetype`/accepted/declined;
   7 of the 29 D26 removed rows keep a withdrawn-sufficient timestamp without its response type
   [ASSUMED erased by removal; audit history would confirm]. Decide whether removal should preserve
   terminal response fields.
4. **`regenerate-token` first link skips D48's due-date write** (it now checks the PDF). Proposed:
   call `ensureRequestReviewDueDate` there and refuse `review_due_date_unavailable`. Owner asked for a
   review of the central calendar; this was the one gap found. Not built.

### Verified Open

1. **Follow-up PR (owner split, D49):** invitation wording, `{{proposalDelivery}}`, Reviewer Finder
   `proposalSendDate`/`commitDate` retirement. Plan §3.4–3.5. Not started.
2. Optional UX: Invite modal has no up-front PDF warning (Release modal has a preflight).

### Verify Before Acting

- **Codex Board constraints (live):** preserve all Board release/email receipts; do not re-release
  the nine D26 files or resend the five Sent activities; before reverting to pre-hourly code, pause
  dispatch. #561's merge preserved hourly grouping, Owner validation and CSO cc (tests green).
- #562 CI: last full check was green except Jest/CodeQL still running on `54a63a652`; recheck
  `gh pr checks 562` before leaving draft.
- `check:agent-invariants` / `check:agent-wiki` fail only inside fresh worktrees (per-machine links).
- Flaky `tests/unit/workbench-integrity-service.test.js` failed once in a full run, passed 3/3 alone.
- **Owner's main checkout WIP (leave it):** `.codex/hooks.json`, `.github/hooks/impeccable.json`,
  untracked `.impeccable/critique/…`, `output/`.
- Remote branches of #556–#560 still exist; delete only with the owner's OK. Worktrees
  `../WMKF_Apps-materials` and `../WMKF_Apps-board-calendar` stay until their PRs merge.

### Do Not Reopen Without New Decision

- D47, D48 (incl. PDF and date required to invite), D49 (one combined email; 15-minute fallback;
  wording split). Recovery design: retake failed, Send again, drain bookkeeping retry + reviewer-closed
  close, Mark as delivered (owner, Session 655). D26: leave the 29 removed rows as-is; no D26
  reviewer emails.
- Codex Board: one President email per cycle/hourly run with the approving CSO cc'd.

## Concurrent Workstreams

| Owner / workstream | Latest recorded resume boundary |
|---|---|
| Claude / reviewer build (J27) | #561 ready (owner go-ahead); #562 draft, build complete, owner wording + release steps; follow-up wording PR not started |
| Codex / Board release (#563/#564) | Live and verified; no open task (`git show b091cf5cd:SESSION_PROMPT.md`) |
| Codex / shared prompt library | PR #553, head `94a795bb4`, owner-gated |
| Codex / ranking, prior archival | Prior handoffs; not revalidated |
| Claude / research request corpus | Owner-gated; no new authorization |

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/reviewer-engagement/materials-release-store.js` (#562) | Release row: claim, retake, reclaim, staff close, stuck list + rotation |
| `lib/services/review-manager/send-emails-service.js` (#562) | Manual claim, recovery flag, D48 PDF gate |
| `lib/services/reviewer-engagement/mark-materials-delivered.js` (#562) | Mark as delivered command |
| `lib/services/review-manager/invitation-proposal-pdf.js` (#562) | Shared D48 PDF check |
| `lib/services/board-writeups/calendar.js` (#561) | Board dates from the cycle calendar |
| `scripts/probe-reviewer-build-premerge.cjs` | Owner-run read-only pre-merge checks for #561/#562 |
| `scripts/close-out-d26-open-invitations.mjs` | D26 close-out through the sweep's writer (dry run default) |
| `scripts/probe-d26-unswept-invitations.cjs` | Read-only: why invitations miss the stale sweep |
| `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md` | Build plan, decisions, build notes |

## Testing

```bash
cd ../WMKF_Apps-materials && npx jest send-emails reviewer-materials materials-release regenerate-token invitation-proposal-pdf
gh pr checks 561; gh pr checks 562
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-reviewer-build-premerge.cjs .env.local   # owner-run
```

## Verification and Closeout

- Milestone determination: no DEVELOPMENT_LOG entry — nothing merged or deployed by this session; the
  two test-invitation close-outs are a data correction, not a milestone.
- Claim-evidence pilot: report found no eligible plan/design edit for this session key; no row added.
- No CLAUDE.md or memory changes.
