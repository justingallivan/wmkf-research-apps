# Session 681 Prompt: Connor prompt delivery — after Beth's answers

## Session 680 summary — 2026-11-16 to 11-17

**Owner direction (unchanged):** deliver prompts in Dataverse that Connor's existing
Power Automate intake flows can run. Backend integration stays parked. Intake prompts
start from Beth's (CSO) J27 Review Workbook, weighed seriously but not canon.

### Completed

1. **Three intake prompts live, now v2.** `intake.executive-summary` →
   `wmkf_layabstract`, `intake.personnel` (input `team_roster`) → `wmkf_ai_teaminfo`,
   `intake.methodology` → `wmkf_ai_methodologysummary`. New `intake.*` names, not
   `proposal.*` versions, because Admin cannot replace the variables JSON. v2: max
   tokens 2048 → 8192 (Sonnet 5.5 thinks by default; v1 Methodology was cut off in a
   local trial) and "Do not add risks or limitations." in Executive Summary. Owner
   published through Admin; owner-run read-only comparison passed all checks.
   [VERIFIED 2026-11-17] Text and decisions:
   `docs/plans/INTAKE_PROMPT_ADMIN_ENTRIES_2026-11-17.md`,
   `docs/plans/INTAKE_PROMPT_DRAFTS_2026-11-16.md`.
2. **Local trial on test Request 1003517** (owner-approved model calls; no Dynamics
   writes). v2: Executive Summary 179 words, on target; Methodology 81 words but 5
   sentences (prompt says 2–4; watch on real proposals); Personnel untested because
   1003517 has no personnel rows. The clone has only narrative + bibliography.
   Estimated cost per application for the three prompts: about $0.27 uncached,
   $0.16 cached; about $0.51 / $0.27 for a full J27 application (estimate).
3. **Field map** `docs/plans/J27_WORKBOOK_FIELD_MAP_2026-11-16.md`: every workbook
   column mapped; applicant answer fields and instruction facts; Connor creates the
   missing fields. `wmkf_ai_teaminfo` repurposed ("Summary of key personnel and
   expertise", changed in Dynamics by Connor per Connor).
4. **Connor answers recorded** (drafts doc): flow attaches the documents, no
   placeholders in system prompts, `override` variables only, all three prompts run
   before `wmkf_readyforreview` and a failure stops intake, no Collaboration Letters,
   Production audit retention forever.
5. **Read-only probe** `scripts/probe-intake-prompt-outputs.cjs --request=<n>` for
   Connor's first real-proposal run (owner-run).
6. **Trial cleanup batch 1** ran Nov 17 (`succeeded`), via parked-branch `expire`
   mode `d86870146`.

### Commits
`2ee70d500` … `3fe41956a` on `main` (docs, memory, probe); `d86870146` on the parked
branch `codex/executive-summary-generation-2026-11-16`.

## Next Items

### Verified Open

1. **Note to Connor (owner to send):** prompts are v2 (8192 tokens), and the flow
   should skip `intake.personnel` or stop intake when there is no PI row; an empty
   roster produces a note that raw mode would save as the summary. Evidence: entries
   doc decision 4.
2. **Review Connor's first real-proposal run** with
   `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-intake-prompt-outputs.cjs --target=prod --request=<n>`
   (owner-run). Check Personnel quality and the Methodology sentence count.
3. **Trial cleanup batch 2** after 2026-11-23 18:31:58 UTC: refresh the Preview OIDC
   token, then run the parked runner's `expire` mode once; expect `disabled`. Exact
   commands: `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` (batch 2).
   Fixture removal is not approved; receipts stay.

### Owner Decision Needed (owner meeting Beth 2026-11-17)

1. Rationale versions: one field + audit history, four fields, or a table; and
   whether column Q is the staff-edited Intake Rationale. Field map decision 1.
2. Flags: JSON per run vs child table; is the flag list final. Field map decision 2.
3. Keyword controlled lists (Field, Methods), still placeholders.
4. Open questions: one running list added to by every prompt; page/section required.
   After answers: draft Rationale, Flags, Keywords and Open questions prompts; Connor
   creates their fields.

### Parked

1. Backend adoption/scheduling/rollout (parked branch). Re-open only on owner decision.

### Verify Before Acting

1. Current prompt versions/consumers before any new version. The local trial script
   (`try-intake-prompts.mjs`) and verifier lived in the session scratchpad and are not
   in Git; recreate if needed.

### Do Not Reopen Without New Decision

1. Replacing Connor's runner, requiring staff-edit flags, or merging the backend
   branch into main.

## Preservation and other streams

Prior handoffs: `git show b8b2cb7a1:SESSION_PROMPT.md` (Session 679) and
`git show 57eb7c40f:SESSION_PROMPT.md` (full multi-stream). Historical observations
are not fresh permission or live state.

| Stream | Owner / resume source | Boundary |
|---|---|---|
| J27 Workbench | Claude Session 678; prior handoff Stream A and `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Production line retained; intake checks, owner-led bibliography discussion and post-intake cleanup require current verification |
| Expertise roster | Codex; prior handoff Stream B and branch's own latest notes | Do not resume from the older November 9 handoff alone; Production release not authorized |
| J27 Factory / reports | Prior handoff Other streams | Preserve worktrees, fixtures, private exports and branches; no cleanup here |
| Prompt/backend historical trials | Parked Summary branch and its live-trial receipt | Retain code/receipts and exact cleanup scope; no scheduler or production enablement |

Never set `DATAVERSE_ALLOW_PROD_READS` yourself; hand Production reads to the owner.
Never touch main `.env.local`. The owner clicks publish for prompts. `/private/tmp`
paths are volatile; code travels via Git, credentials and evidence do not.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/INTAKE_PROMPT_ADMIN_ENTRIES_2026-11-17.md` | Published v2 prompt text, settings, decisions |
| `docs/plans/INTAKE_PROMPT_DRAFTS_2026-11-16.md` | Agreed content and Connor's answers |
| `docs/plans/J27_WORKBOOK_FIELD_MAP_2026-11-16.md` | Workbook → Dynamics fields, open decisions |
| `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Delivery handoff, cleanup batches |
| `scripts/probe-intake-prompt-outputs.cjs` | Read-only intake output probe |
