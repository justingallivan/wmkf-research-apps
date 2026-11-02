# Session 660 Prompt: Shared prompt library — first publish for new prompt names

## Session 659 Summary — Claude, 2026-11-02 Pacific (concurrent with Codex Session 658)

Justin and Connor rescoped the shared prompt library. Claude then shipped catalog
metadata end to end: columns, carry-forward, backfill and Admin editing. Runtime
work went through PRs #606 and #608. Docs landed on `main` directly as Tier 0.

### What Was Completed

1. **Scope change — no Dataverse plug-in.** [OWNER DECISION]
   - Access to the prompt tables is already tightly limited, so there are no
     write guards.
   - Connor drafts in Dataverse and publishes from Admin. He cannot run Node
     scripts and has superuser access.
   - PR #553's plug-in/Windows-registration track is superseded. The Windows09
     check was never run.
   - Record: `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md`. The
     former resume record `docs/plans/PR553_MONDAY_RESUME_2026-11-02.md` is now
     historical.
2. **Six catalog columns on `wmkf_ai_prompt`** (wave36; title, description,
   group, section, used by, usage category).
   - Created in Production under a same-day owner write ACK.
   - The sandbox already had them.
   - A metadata readback matched the spec in both environments. Spec:
     `lib/dataverse/schema/wave36-prompt-catalog/`.
3. **Carry-forward and display.** PR #606, merge `adb674d73`.
   - Admin publish and `prompt-seed.js --force` copy the columns to each new
     version.
   - Admin prefers stored values and falls back to `ADMIN_PROMPT_CATALOG`.
   - The preview was owner-checked through the stable alias with a
     branch-scoped read-only `DATAVERSE_ALLOW_PROD_READS`. Both were rolled
     back and verified afterwards.
4. **Production backfill, 40 of 40 verified.**
   - Read-only inventory first: 61 rows across 40 names, all in the code
     catalog. The only exception was `phase-i.checkin`, which has no current
     row; its v1 row was the target.
   - Then one `If-Match` PATCH per row, using code-catalog values, with
     readback.
   - Evidence: `docs/plans/evidence/prompt-catalog-inventory-prod-2026-11-02.json`
     and `docs/plans/evidence/prompt-catalog-backfill-prod-2026-11-02.json`.
5. **Admin "Edit details".** PR #608, merge `d108f21a1`, deployed as
   `dpl_8hJRjhFfKocTgjjHC4nMYebbLLpz`.
   - Route and service: `PATCH /api/admin/prompts/[name]` →
     `lib/services/admin/prompts-catalog-service.js`.
   - Edits in place, with no new version. Stale-row/value checks return 409.
   - Group, section and usage are allowlisted.
   - A pending audit is written before the `If-Match` write, and the edit is
     refused if that audit write fails.
   - Returns `catalog_superseded` when a publish lands mid-edit.
   - Migration 093 widened `prompt_publish_audit_status_check`. It was applied
     owner-run, before the merge, and the constraint was read back.
   - Writes run as the app principal; the audit row records the editor.

### Commits
- `4e52d2018`, `1e50379e5` — scope change and existing Admin publish facts.
- `6082a8116`, `2dac3ea90` — wave36 spec; columns live and backfill plan.
- PR #606 `adb674d73` — catalog carry-forward/display (`a4af85911`, `a706af7bb`).
- `997d395a4` — backfill receipt.
- PR #608 `d108f21a1` — Admin catalog editing plus migration 093 (`728a75e52`).
- `9db614417` — deployed markers and the next-session action item.

## Next Items

### Verified Open

1. **First publish for a brand-new prompt name in Admin.** [OWNER REQUEST
   2026-11-02]
   Evidence: `lib/services/admin/prompts-publish-service.js` returns
   `404 no_current_row` ("seed it before versioned publish") for a name with
   no current row. Connor's new prompts can't go live until this is fixed.
   - Extend the existing publish flow.
   - Keep `If-Match`, single-current verification, the pending/final audit and
     payload idempotency.
   - Owner decision needed first: create v1 from the draft row, or mark the
     draft row itself current.
2. **Owner smoke of Edit details (not yet done).** Justin edits one prompt's
   details in Production, then restores the value. After that, read the two
   `prompt_publish_audit` rows (`outcome_json.kind = 'catalog'`) to confirm the
   profile and the before/after values.

### Done after closeout

1. **PR #553 closed** (owner request, 2026-11-02), with a comment explaining
   the supersession and the Pre-Site schema hazard. Its branch
   `codex/shared-prompt-library-plan` and worktree `/private/tmp/wmkf-pr553`
   (15 local-only commits) were left untouched. The signing key, Windows
   bundles and `output/connor-windows09-offline-checks/` remain local-only and
   must never enter Git; disposal is Justin's decision.

### Parked — requires a new owner request

- Integrity: ORCID/publication/coauthor identity matching; durable
  different-person dismissals (the standalone UI is a placeholder).
- Shared prompts: retiring `ADMIN_PROMPT_CATALOG` as the fallback;
  `ExecutorBudgetEditor` still uses code titles.

### Do Not Reopen Without New Decision

- Shared prompts: no Dataverse plug-in, write guards or Windows registration.
  Do not propose sandbox rehearsals for low-risk Production writes
  (`feedback-question-the-rehearsal-venue`).
- Integrity (Codex Session 658):
  - No paid PubPeer, undocumented endpoint or extension-key reuse.
  - No automatic re-screen, staff disposition, history rewrite or new provider
    spend.
  - No Integrity funding/progression gate.

## Concurrent Streams — preserve ownership, verify before acting

Codex's complete Session 658 handoff, covering Integrity accuracy, the managed
Retraction Watch refresh, monthly activation, manual-only PubPeer and its
worktree disposal, is at `git show 9db614417:SESSION_PROMPT.md`.

| Owner / stream | Current routing and preservation boundary |
| --- | --- |
| Codex / Integrity | Complete. First monthly refresh is scheduled for Dec 1, 2026 06:00 UTC and is unobserved; inspect its maintenance receipt rather than assuming it passed. The private backup at `/Users/gallivan/Code/WMKF_Apps/.integrity-backups/2026-11-02-pre-refresh/` must be preserved; no restore is authorized. Records: `docs/audits/integrity-*-2026-11-02.md`. |
| Claude / shared prompts | See above. Owning record: `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md`. |
| Claude / reviewer outcomes and invitations | `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md`; `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`. Not re-audited this session. |
| Codex / terminology | `docs/audits/terminology-completion-audit-2026-11-01.md` keeps its acceptance limits. The local colleague brief is not Git-backed; leave it untouched. |
| Other streams | Preserve their worktrees, owning plans and queue decisions. |

## Key Files

| Path | Purpose |
| --- | --- |
| `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md` | Decision, catalog columns, backfill record, remaining work |
| `lib/services/admin/prompts-catalog-service.js` | Catalog-details edit protocol |
| `lib/services/admin/prompt-catalog-fields.js` | Column map and carry-forward helpers |
| `shared/config/adminPromptCatalog.js` | Code catalog fallback, allowlists, `resolveAdminPromptDescription` |
| `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` | Live read/write paths and audit statuses |

## Safety and Preservation

- Production approvals from this session (prod reads, write ACKs) are not
  standing authority.
- The unknown main-checkout WIP is owned by Justin or other sessions:
  `.codex/hooks.json`, `.github/hooks/impeccable.json`,
  `.impeccable/critique/…` and `output/`.
- Claude's worktree `/Users/gallivan/Code/WMKF_Apps-claude-2026-11-02`
  (branch `claude/session-2026-11-02`) is clean, and its commits are pushed to `main`. It holds
  symlinked `node_modules` and a copied `.env.local`.
- Milestone: a DEVELOPMENT_LOG entry was added for the shared prompt library
  catalog in Admin.
