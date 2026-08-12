# Session 421 Prompt: run the SharePoint permission audit with Connor

## Session 420 Summary

A short session. Produced the delegation artifact for the first agenda item and
repaired a host shell misconfiguration that had been silently breaking the
harness's Bash tool.

### What Was Completed

1. **Connor-ready SharePoint audit primer.** `outputs/sharepoint-permission-audit-primer-for-connor-2026-08-12.md`
   is a self-contained brief Connor can paste into his own Claude Code session to
   run the read-only permission, recycle-bin, and version-policy diagnosis on
   `/sites/akoyaGO` and `akoya_request`. It assumes no access to this repository
   and no prior conversation.

   It is derived from the S415 decision-ready brief (`f04d76a7:outputs/sharepoint-storage-policy-question-brief.md`)
   and deliberately front-loads the four interpretation traps that would otherwise
   reproduce the answer we already have: "limited control" is a modern-pane caption
   rather than a role; a level's name does not describe its flags, because built-in
   levels are editable in place; second-stage recycle-bin invisibility is the
   documented end-user experience rather than evidence of absence; and classic
   `_layouts/15/…` deep links have failed twice on this tenant, so a failure there
   is tooling noise, not a finding.

   Read-only by construction: `Get-*` cmdlets only, no destructive test on a
   governed artifact, no edit to Versioning settings (that page sets as well as
   shows), and an explicit instruction not to register an Entra app or grant
   consent to clear the PnP client-ID prerequisite. Carries a UI-only fallback and
   a structured report block that keeps Delete Items and Delete Versions as
   separate answers.

2. **Host shell PATH repaired (per-machine, not in the repo).** `~/.bashrc` line 9
   was `export PATH="/Users/gallivan"` — an unconditional overwrite that left the
   home directory as the only PATH entry, so `git`, `node`, `npm`, `rtk`, and even
   `sed` failed to resolve. It only ever fired for the harness, because Terminal
   opens *login* shells (which read `.bash_profile`) while the Bash tool opens
   *non-login* shells (which read `.bashrc`), and `.bash_profile` did not source
   `.bashrc`. The two files had drifted.

   Fixed by removing the clobber, collapsing duplicate PATH appends, and having
   `.bash_profile` source `.bashrc` so they cannot drift again. Verified from a
   clean environment (`env -i`) that fresh login and non-login shells now produce
   identical, correctly-ordered PATHs, and that re-sourcing is idempotent.
   Originals are backed up at `~/.bash_profile.bak-2026-08-12` and
   `~/.bashrc.bak-2026-08-12`.

### Commits

- `2d2a1054` - docs: read-only SharePoint permission audit primer for Connor

## Next Items

### Verified Open

1. **[VERIFIED OPEN] Run the read-only PnP.PowerShell audit with Connor.**
   Evidence: `outputs/sharepoint-permission-audit-primer-for-connor-2026-08-12.md`
   (this session); `f04d76a7:outputs/sharepoint-storage-policy-question-brief.md`
   §§1a, 6, 9, 10.

   The primer is written and ready to send. Two things still gate the actual run,
   neither of which this session could resolve:

   - **A tenant-consented Entra app client ID.** Interactive PnP sign-in requires
     one; PnP no longer ships a shared multi-tenant app. Unknown whether the
     tenant has a suitable registration. Do not use an app secret or certificate —
     delegated interactive sign-in is the point, because the question is what a
     *human* operator can see.
   - **Whether Connor is a Site Collection Administrator.** Q2 in the S415 brief
     is still `[OPEN]`. `Get-PnPRecycleBinItem -SecondStage` requires SCA rights on
     this specific site; a tenant SharePoint Administrator role is not sufficient.
     If he is not an SCA, the primer asks him to name who is — that name is the
     actual unblocking answer for Q1.

   Expect the second-stage recycle-bin step to come back "not runnable by this
   operator." That is a useful result, not a failure.

2. **SharePoint durability evidence after the Connor audit.** The library is
   already verified as 500 major versions, no age limit, checkout not required.
   Purview policy and hold questions belong with the M365 compliance administrator
   (likely DFT), not Connor; §11 of the S415 brief has that message ready to send
   and has no dependency on the Connor thread — the two can go in parallel.

3. **Board milestone snapshot producer.** No immutable snapshot operation exists;
   the owner selected copy-the-bytes on 2026-08-10. Evidence:
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` and the `wmkf_milestone*` source
   fields. Explicitly not blocked by any SharePoint question above — that is its
   whole point.

4. **Reviewer drawer visual coverage.** The production smoke covered the drawer on
   one request, but no visible completed-receipt row was available for direct
   inspection. Focused tests cover it; a future natural example can close the gap.

5. **Reviewer history persistence limits.** Non-reset receipt inputs can survive a
   restored engagement, and accepted-then-withdrew overwrites the acceptance
   timestamp. Both gated on the evidence-versus-convenience decision below.

### Owner Decision Needed

Unchanged from Session 420 — no work advanced these, and they remain open.

1. **Is reviewer activity history operational convenience or evidence?** If it may
   feed reviewer-reliability or payment decisions, the remaining derived-field
   ambiguities require stronger persistence. Evidence:
   `outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md` and
   `outputs/reviewer-activity-history-opus-review-2026-08-11.md`.

2. **Should Phase 1's disputed receipt evidence be reduced?** Three non-reset
   fields can carry prior-engagement state, but removing them leaves no
   engagement-scoped evidence distinguishing a real submission from staff
   close-out. Decide only after answering item 1.

3. **Should `merge-candidates` remain organization-open?** The destructive route
   takes two GUIDs without a request binding; the UI management gate is cosmetic
   and fail-open. Evidence:
   `.claude-memory/project-merge-candidates-authorization-gap.md`.

### Parked

1. **Invite-tab surfacing of needs-merge alerts.** Re-open only if a new alert
   probes `STILL_BLOCKED`.
2. **Exact activity ledger and deferred-load API.** Re-open only after the
   activity history evidence decision.

### Verify Before Acting

1. **SharePoint policy branch disposition.**
   `[VERIFIED this session]` `origin/codex/sharepoint-storage-policy-questions` is
   genuinely unmerged: 4 commits ahead of `main`, `main` 48 ahead of it, tip
   `f04d76a7` (2026-08-11). It carries the full S415 brief and corrected durable
   docs. Review its diff against current `main` before deciding whether to merge;
   do not assume the whole branch is stale or merge-ready. Note that this
   session's primer cites `f04d76a7:` paths — if the branch is ever pruned, that
   citation goes dangling.

   **`[VERIFIED this session]` The branch strands a documented correction, and
   `main` currently contradicts itself on the version limit.** The S415 brief §12
   identified two stale present-tense claims and corrected them *in the same
   commit as the brief* — which is on the unmerged branch, so `main` never got
   them. On `main` today:

   - `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:616` records the answer:
     **Keep 500 major versions**, no age expiry.
   - `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md:147` agrees —
     "version policy now fully ANSWERED".
   - But the same file at `:209` still says "**Version limits — still open.**"
   - And `docs/CURRENT_WORK_QUEUE.md:37` still says "the configured limit
     unanswered".

   Verified corrected on the branch (zero occurrences of the stale phrasing
   there). No gate catches this — `check:fact-consistency` passes, because the
   limit is not a registered scalar. Deliberately **not** fixed on `main` this
   session: the branch already carries the fix, and patching `main` separately
   would collide with it. The decision is merge the branch, cherry-pick just the
   doc correction, or fix `main` directly and drop that part of the branch —
   owner's call. Only the *version-limit* phrasing is stale; second-stage
   recovery, Purview retention, and editor least privilege genuinely do remain
   open in all of those documents.

2. **`codex/initial-assessment-pilot` disposition.**
   `[VERIFIED this session]` Genuinely unmerged: exactly 2 commits not in `main`
   (`d5b5747a`, `8e9d9da6`), tip dated 2026-07-29, `main` 500 ahead. Sibling
   branches `initial-assessment-current-metadata`, `-pilot-recovery`, and
   `-runtime-fixes` *are* merged — do not let a substring match on the branch name
   fool a merge check into reporting this one as merged. Verify callers before
   retaining, rebasing, or retiring it.

### Do Not Reopen Without New Decision

1. Launching a merge from a stored alert (`initialMerge`); stored alerts are not
   live proof.
2. Changing the accepted-reviewer 90-day token policy for ordinary extensions.
3. Materializing a derived reviewer-history backfill.
4. Modifying load-bearing reviewer write paths merely to improve drawer labels.

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/sharepoint-permission-audit-primer-for-connor-2026-08-12.md` | Paste-in primer for Connor's Claude Code (this session) |
| `f04d76a7:outputs/sharepoint-storage-policy-question-brief.md` | Decision-ready SharePoint brief, PnP route, and the §10/§11 send-ready messages |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Current governed-file evidence and durability model |
| `outputs/reviewer-activity-history-phase1-status-brief-2026-08-12.md` | Activity-history review record and open findings |
| `.claude-memory/project-merge-candidates-authorization-gap.md` | Destructive merge-route authorization gap |

## Continuity Notes

- **`outputs/` is gitignored** (`.gitignore:55`) while its briefs are tracked. A
  new document there needs `git add -f` or it stays invisible and `git status`
  prints clean. See `.claude-memory/reference-codex-review-needs-a-committed-diff.md`.
- **The other Mac may carry the same `.bashrc` PATH clobber.** The fix above is
  per-machine and does not travel with git. If the harness reports
  `command not found` for `git`/`node`/`rtk` there, check `~/.bashrc` for an
  unconditional `export PATH=` before anything else.
- **`git push` was blocked by the auto-mode permission classifier** this session;
  the user pushed manually. Not a repo problem — either switch permission mode or
  add a Bash permission rule if it recurs.

## Testing

```bash
npm run check:docs-catalog
npm run check:doc-symbol-refs
npm run check:harness-framing
```
