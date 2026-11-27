# Session 697 Prompt: choose the next priority

## Session 696 Summary — Claude: prompt Variables in Admin

[VERIFIED via GitHub checks, Vercel production status and a signed-in production
browser check] Connor asked to see the Dynamics **Variables** field
(`wmkf_ai_promptvariables`) in the Admin prompt editor. Both Admin forms now
show and edit it.

- **Edit & publish** (`shared/components/admin/PromptPublishForm.js`): a
  Variables box beside Output schema. It must be blank or a JSON object with a
  `variables` array. It is sent only when changed; untouched, the server
  carries the prior declaration forward. No server change was needed for edit.
- **Add prompt** (`shared/components/admin/AddPromptForm.js`): same box.
  `POST /api/admin/prompts` now passes `variables` to `createPrompt`. Before,
  create ignored variables and started from an empty list. A non-string value
  is rejected with `invalid_variables`; the stored declaration is kept as
  written and any placeholder it leaves out is still declared.
- Blank does not mean "no variables": placeholders still in the prompt return
  as plain required inputs, dropping execution mode and defaults. The help text
  says so; worth telling Connor.
- Production check, read-only, on `intake.personnel`: the Variables box matched
  AkoyaGo. Invalid JSON showed the error, Reset restored the value and disabled
  Publish, and the Add prompt box rendered. Nothing was published or created.

### Commits
- `58cf923fa` — PR #680, squash of the editor box, the stored-value test and
  the Add prompt change.
- `4eda6be04` — PR #681, Atlas, wiki and route-matrix markers set to production-live.
- This handoff: docs-only branch `claude/session-696-stop`.

**DONE:** build, review checks, merge, production deploy and browser check.
Milestone entry added: "Prompt Variables editable in Admin".

## Next Items

### Verified Open

1. **Tell Connor** the Variables field is now in Admin. Include the caution
   about clearing the box. Owner sends; Claude does not message on the
   owner's behalf.

### Verify Before Acting — carried from Session 695 (not reprobed this session)

The full Session 695 handoff is retrievable with
`git show 99f9e2443:SESSION_PROMPT.md`.

1. **Compare the two reviewer-finding workflow reviews** once both
   `report-<model>.md` files exist in
   `outputs/reviewer-finding-review-2026-11-21/` (owner's machine). Claude's
   report is done (`report-claude-opus-5-5.md`).
2. **Carried from Sessions 692–693:**
   - Connor's step 3 go-live check, due before early December.
   - Connor's promised builds.
   - The `cycle-dossier.entry` cache-read probe (owner OK).
   - The J27 list search hint for requests that aren't ready.
   Evidence: `git show dc6847a16:SESSION_PROMPT.md`.
3. **DONE 2026-11-26 (`5558ac1e1`): stale reviewer docs reconciled.** These were the
   lifecycle doc §1 send tier and the Find on-load enrichment claims.
4. **DONE 2026-11-26: Executive Summary trial batch-2 cleanup.** 16 expired
   `prompt_job_content` rows were deleted from Neon `pa-prompt-sandbox` (the Summary
   job plus two Short Title jobs, all owner-authorized). Receipt:
   `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md`, "Batch 2".
5. **Production identity mode is `shadow`** (owner-set). Do not set `combined`
   without an approved cutover.

### Owner Decision Needed

1. **Reviewer-finding direction**, after comparing the two reviews. Until then
   the W2 combined pilot and the Find card follow-ups stay on hold.
2. **Institution follow-ups** (owner said not to start yet, 2026-11-21).
3. **Step-3 prompt limits vs the CSO workbook** (12 differences), and an
   optional Workbench control for `wmkf_readyforreview`.
4. **External service tracker:** pick the next provider, or no further
   providers. Checks stay manual.

### Parked

1. Branch 2 exclusion enforcement; may be reshaped by the workflow review.
2. Live promotion test on 1003526 (owner parked 2026-11-20). Do not fill the
   identity-confirmation attestation on the owner's behalf.
3. From Session 692: proposal lists; Connor's roster connection check; do not
   merge the Executor lineage branch; consultant-feedback finalize retry reuse.

### Done After Closeout (2026-11-25, owner-authorized)

1. **Merged-branch cleanup.** Deleted 13 branches whose work is on `main`.
   Before each delete: tip is an ancestor of `origin/main`, or equals its
   merged PR's head, or `git cherry` shows the patch already upstream; no
   worktree had it checked out.
   - Remote and local: `find-identity-card-layout`,
     `find-applicant-listed-column`, `find-card-status-fixes`,
     `find-unresolved-wording`, `reviewer-identity-shadow-enrichment`,
     `claude/prompt-seed-untrusted-guard` (#664),
     `claude/consultant-feedback-scan-retry` (#665),
     `claude/j27-applicant-reviewers-from-rows` (#666),
     `claude/session-2026-11-25` (#680),
     `claude/prompt-variables-live-docs` (#681), `claude/session-696-stop` (#682).
   - Local only: `claude/session-694-stop` (#679),
     `claude/reviewer-finding-review-prompt` (patch already on `main`).
   - `worktree-linked-riding-sunset` no longer existed.
   Other agents' branches and worktrees were not reviewed or touched.

### Do Not Reopen Without New Decision

1. Card decisions 1–11 in `docs/plans/FIND_IDENTITY_CARD_REDESIGN_BRIEF_2026-11-20.md`.
2. Do not cut over W2 globally on the evidence so far.
3. Session 692's list (compliance screening, archived destinations, exclusion
   policy, deprecated `potentialreviewer1`–`5`, and the rest).

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| Admin prompt Variables (Claude, released) | PR #680; `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` | Live and verified; tell Connor |
| Find PDF readiness (Codex, active in main checkout) | branch `codex/pre-j27-find-pdf-readiness` | Codex owns; not touched this session |
| External service tracker (Codex, released) | `docs/audits/CLOUDMERSIVE_SERVICE_CHECKS_2026-11-21.md` | Next provider needs owner selection |
| Reviewer-finding workflow review | `outputs/reviewer-finding-review-2026-11-21/` (private) | Compare when the second report exists |
| Applicant reviewer identity (W2) | `docs/plans/APPLICANT_REVIEWER_IDENTITY_W2_PLAN_2026-11-21.md` | Shadow live; pilot on hold |
| PA intake flows (Connor) | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Waiting on step-3 go-live |
| Memory hygiene | `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 | Router about 7.6 KB; no change this session |

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/admin/PromptPublishForm.js` | Edit & publish form; `validateVariablesText` |
| `shared/components/admin/AddPromptForm.js` | Add prompt form |
| `lib/services/admin/prompts-publish-service.js` | `publishPrompt` / `createPrompt`; variables validation and untrusted guard |
| `pages/api/admin/prompts/index.js` | Create route (now passes `variables`) |

## Testing

```bash
npx jest tests/unit/prompt-templates-executor-budgets.test.js tests/unit/prompt-templates-descriptions.test.js tests/unit/prompts-publish-service.test.js tests/unit/prompts-create-service.test.js
```

## Closeout

Owner: Claude. Session docs branch: `claude/session-696-stop`, based on
`origin/main` `4eda6be04`; changes only SESSION_PROMPT.md and
DEVELOPMENT_LOG.md. No runtime edits remain. The Claude worktree
`WMKF_Apps-claude-2026-11-25` was removed at the owner's request; handoff
merged as PR #682 (`60278a86b`). Branch cleanup recorded above was a
follow-up on `claude/handoff-branch-cleanup`.
Codex's main checkout and other worktrees were not touched.
CLAUDE.md and memory are unchanged: existing pointers cover the feature.
Claim-evidence report: no eligible plan or design edit, so no observation row.
Next owner/action: Justin chooses the next priority; run `/start` when resuming.
