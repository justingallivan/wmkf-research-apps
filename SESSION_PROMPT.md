# Session 661 Prompt: Shared prompt library — Admin authoring is live; owner smokes skipped

## Session 660 Summary — Claude, 2026-11-02 Pacific (concurrent with Codex J27 work)

Admin can now author the shared prompt library end to end without anyone
editing Dataverse: publish a Dataverse draft, create a new prompt, edit and
reorder groups, and retire a prompt. Each runtime change went through its own
PR with CI green and a Production deploy; docs landed on `main` as Tier 0.

### What Was Completed

1. **First publish of a draft-only prompt (PR #610, merge `6648f2a18`).**
   [OWNER DECISION: option A] Copies the latest draft row, with any Admin edits,
   into a new current row at max version + 1, stamped Published. The draft row
   is untouched. Two simultaneous first publishes surface afterwards as
   `partial` (accepted gap).
2. **Add prompt (PR #612, merge `2eb0058cc`).** Creates a new name as current
   v1 (`POST /api/admin/prompts`, `createPrompt`). Names are lowercase
   `team.task`, max 64 characters ([ASSUMED] column length unread). Any
   existing row → 409 `name_exists`.
   - [OWNER DECISION] `{{placeholders}}` are declared automatically as required
     `override` variables, on create **and on Edit & publish**. Existing
     declarations never change. Accepted risk: a new placeholder added to a
     prompt an app already uses fails that app's runs until the app supplies
     it.
   - The form explains that a response example belongs in the prompt text, not
     the Output schema box.
3. **Editable groups (PR #613 `acab577bc`; drag reorder PR #614 `f3afb5199`).**
   Setting `promptLibrary.groups` in `wmkf_appsystemsettings`; `PUT
   /api/admin/prompt-groups`.
   - [OWNER DECISIONS] No sections for new groups, no deletion, settings-row
     history only, Uncataloged/Legacy pinned last. Drag reordering uses the
     Proposal Ranking assessment pattern (`@hello-pangea/dnd`); "Place after"
     was removed.
   - No setting yet in Production → the code list is shown until the first
     save.
4. **Retire (PR #616, merge `e77e80aba`).** Clears the live row and stamps
   status Retired (682090002). [VERIFIED via owner-run `scripts/probe-picklist.js`:
   Draft=682090000, Published=682090001, Retired=682090002]
   - [OWNER DECISIONS] Retire, not delete; blocked for Application caller;
     retired prompts sit in a collapsed Retired section. Review & publish
     brings one back as a new version.
5. **`phase-i.checkin` findings.** [VERIFIED via owner-run read-only
   `wmkf_ai_runs` query] Task type Check-in has 303 runs, 2026-04-23 to
   2026-05-06, all logged by Power Automate, each linked to a request, outputs
   stored as JSON in `wmkf_ai_rawoutput` (`clerical_checks`, `keywords`,
   `priority_fit`, `summary`). No run links a prompt row. [OWNER REPORTED] The
   flow's prompt text lives in a free-text Dataverse field. Recorded in the
   scope doc. The draft can't be published from Admin as-is (its output schema
   is a response example and its placeholders are undeclared); the owner chose
   not to edit Connor's row. Two Admin publish attempts failed validation
   before any write.

### Commits
- PR #610 `6648f2a18`; PR #612 `2eb0058cc`; PR #613 `acab577bc`; PR #614
  `f3afb5199`; PR #616 `e77e80aba`.
- Docs on `main`: `b3c97002b`, `997a9ecf6`, `ef84612e2` (Add prompt plan),
  `b45150bf5`, `cc2ef967e` (groups plan), `b1139905c`, `fc0f8236c`,
  `4ad1af77a`, plus this handoff.

## Next Items

### Owner Decision Needed / Waiting

1. **Connor's reply on `phase-i.checkin`.** Justin emailed him. The scope doc
   carries `[ASSUMED pending Connor's reply]` that his flow does not read the
   prompt row. When he answers, update or remove that label in
   `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md`.

### Verified Open (optional)

1. **Production use of the new features is unobserved.** [OWNER DECISION
   2026-11-02] Smoke tests were skipped because they would leave permanent junk
   rows; none passed. The first real use (likely Connor's first prompt) is the
   first observation. Retire now gives a create-then-retire path if a smoke is
   ever wanted.
2. **Edit details owner smoke** (from Session 659) is still not done. Justin has
   not declined it explicitly; ask before proposing.
3. **Prompt name column length** is unread (`MAX_NAME_LEN = 64` in
   `lib/services/admin/prompts-publish-service.js`). A sandbox metadata read
   would settle it; low priority.

### Parked — requires a new owner request

- Shared prompts: retiring `ADMIN_PROMPT_CATALOG` as the fallback;
  `ExecutorBudgetEditor` still uses code titles; deleting groups (blocked by a
  documented dependency in `resolveAdminPromptDescription`); sections for new
  groups; editing variable sources in Admin.
- Integrity: ORCID/publication/coauthor identity matching; durable
  different-person dismissals.

### Do Not Reopen Without New Decision

- Shared prompts: no Dataverse plug-in, write guards or Windows registration;
  no hard delete of prompts (Retire instead); no draft step in Add prompt.
  Do not propose sandbox rehearsals or junk-producing Production smokes for
  these low-risk Admin features (`feedback-question-the-rehearsal-venue`,
  `project-test-residue-cleanup-is-for-data-mining`).
- Integrity (Codex Session 658): no paid PubPeer, undocumented endpoint or
  extension-key reuse; no automatic re-screen, staff disposition, history
  rewrite or new provider spend; no Integrity funding/progression gate.

## Concurrent Streams — preserve ownership, verify before acting

Codex's complete Session 658 handoff, covering Integrity accuracy, the managed
Retraction Watch refresh, monthly activation, manual-only PubPeer and its
worktree disposal, is at `git show 9db614417:SESSION_PROMPT.md`.

| Owner / stream | Current routing and preservation boundary |
| --- | --- |
| Codex / Integrity | Complete. First monthly refresh is scheduled for Dec 1, 2026 06:00 UTC and is unobserved; inspect its maintenance receipt rather than assuming it passed. The private backup at `/Users/gallivan/Code/WMKF_Apps/.integrity-backups/2026-11-02-pre-refresh/` must be preserved; no restore is authorized. Records: `docs/audits/integrity-*-2026-11-02.md`. |
| Claude / shared prompts | See above. Owning record: `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md`. Session 659's handoff: `git show fb8afa427:SESSION_PROMPT.md`. |
| Codex / J27 actionable reviewers and readiness | Ran concurrently this session (PR #611, PR #615 `b6976548e`, readiness evidence commits). Not audited by Claude; see Codex's own records and `docs/agent-wiki/topics/intake-portal.md` (J27). |
| Claude / reviewer outcomes and invitations | `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md`; `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`. Not re-audited this session. |
| Codex / terminology | `docs/audits/terminology-completion-audit-2026-11-01.md` keeps its acceptance limits. The local colleague brief is not Git-backed; leave it untouched. |
| Other streams | Preserve their worktrees, owning plans and queue decisions. |

## Key Files

| Path | Purpose |
| --- | --- |
| `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md` | Owning record: decisions, gaps, `phase-i.checkin` findings |
| `docs/plans/ADMIN_ADD_PROMPT_PLAN_2026-11-02.md` | Add prompt plan and owner answers |
| `docs/plans/ADMIN_PROMPT_GROUPS_PLAN_2026-11-02.md` | Editable groups plan and owner answers |
| `lib/services/admin/prompts-publish-service.js` | Publish, first publish, create, retire, placeholder auto-declare |
| `lib/services/admin/prompt-groups-service.js` | Group list read/save (`promptLibrary.groups`) |
| `shared/components/admin/PromptTemplatesSection.js` | Admin Prompts page, Retire, Retired section |
| `shared/components/admin/AddPromptForm.js`, `ManagePromptGroupsPanel.js` | New forms |
| `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` | Live read/write paths, statuses, audit kinds |

## Safety and Preservation

- Production approvals from this session (owner-run reads, picklist probe) are
  not standing authority. The Check-in probe script lived in a session
  scratchpad and was not kept; its findings are in the scope doc.
- The unknown main-checkout WIP is owned by Justin or other sessions:
  `.codex/hooks.json`, `.github/hooks/impeccable.json`,
  `.impeccable/critique/…` and `output/` (includes
  `connor-windows09-offline-checks/`, which must never enter Git).
- PR #553's branch `codex/shared-prompt-library-plan` and worktree
  `/private/tmp/wmkf-pr553` were left untouched; disposal is Justin's decision.
- Claude's worktree `/Users/gallivan/Code/WMKF_Apps-claude-2026-11-02` is on
  `claude/session-2026-11-02` at `origin/main`, clean after this handoff. The
  merged feature branches (`claude/prompt-first-publish`,
  `claude/admin-add-prompt`, `claude/admin-prompt-groups`,
  `claude/prompt-groups-drag`, `claude/prompt-retire`) remain on the remote.
- Milestone: a DEVELOPMENT_LOG entry was added for Admin prompt authoring.
