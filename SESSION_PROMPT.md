# Session 691 Prompt: Memory audits done; prompt-publish A7 guard live

Previous handoff (Session 690 prompt, written at the end of Session 689 and Codex
Session 688): `git show 643ff4298:SESSION_PROMPT.md`.

## Session 690 Summary — 2026-11-20 (Claude, main checkout)

### What Was Completed

1. **Memory router diet.** `MEMORY.md` went from 8,247 to 7,510 bytes (74→59 lines). Lines that
   pointed at the same place were merged, and three pointers moved to their wiki hubs. No leaf
   was deleted. The router is now under the 8,192-byte trigger. `b535d6cc2`, `9518775a2`.
2. **Routine memory audit (runbook §6).** All 21 health flags have a written disposition
   (21→18). Five weak-basis flags were honest uncertainty introduced by the 2026-10-22 rewrites.
   A five-leaf sample found three stale retirement-era claims; all were fixed. Report:
   `docs/audits/memory-routine-audit-2026-11-20.md`. `9518775a2`.
3. **Deep audit, retirement slice (runbook §7, sweep Mode B).**
   - Scope: 22 active leaves and 5 wiki/queue pages that mention surfaces retired on 2026-11-19.
   - Result: all 22 classified, 20 fixed, none demoted, and three protective notes added.
   - The queue no longer says Grant Reporting and Literature Analyzer "remain implemented".
   - The D60 Reviewer Finder combined-file loader replaces the two-file plan in the memory.
   - The A7 surface count is now 32.
   - The per-user prompt override is recorded as stored in Dataverse user preferences, not Postgres.
   - Report: `docs/audits/memory-retirement-slice-deep-audit-2026-11-20.md`. `8eae55d72`, `8d7de43ff`.
4. **Owner-approved read-only checks**, run in a signed-in browser tab, with two read-only
   production scripts, and with local `gh`/Colima (`c9ad724ca`, `3cca1527a`):
   - **Retired APIs:** all thirteen return 405 to GET and 410 `APP_RETIRED` to POST.
   - **Prompt rows:** all 19 retired-interface rows are current, Published, v1. There are no
     `writeup.*` rows.
   - **Workbench:** the Status tab is gone.
   - **Typo field:** `wmkf__ai_summary` has been removed.
   - **Caching:** one cross-document cache read on review synthesis is confirmed.
   - **Local and GitHub:** Colima is running and the ledger container is stopped. The repo is
     public and CodeQL is configured.
5. **A7 hardening, live in Production.**
   - Admin prompt publish now refuses an edit that weakens a variable declared
     `untrusted: true` (`assertUntrustedDeclarationsPreserved`).
   - Tests: six new tests; a mutation check confirms them.
   - Shipped: PR #663 merged as `a0baa4c94`, and Production deployed that commit successfully.
   - Recorded as fixed: `0a3c937fd`.

### Commits
`b535d6cc2`, `9518775a2`, `8eae55d72`, `8d7de43ff`, `c9ad724ca`, `3cca1527a`, `30ed4d79f` /
`a0baa4c94` (PR #663), `0a3c937fd`.

## Next Items

### Verified Open

1. **Reconcile the remaining two-file restatements of D60.** These still describe the replaced
   two-file plan: `.claude-memory/project-j27-doc-capture-evolution.md:52`,
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:197` and
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md:373-376`. Update the excerpts in register
   row J27-065 in the same pass. J27 log D59/D60 still says "not promoted"; `f43f2db77` is in
   Production.
2. **Other stale docs outside the slice** (listed in the deep-audit report, Unknowns section):
   - `DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md:97,108`
   - `PROMPT_CACHING_AUDIT.md:37,88-90,197-199`
   - `DYNAMICS_AI_FIELDS_SPEC_v3_cn.md:237,265`
   - `CLOSEABLE_CLASS_INVARIANT_MAP.md` (A7 count 27)
3. **Split `project-j27-cycle-page-redesign-pending.md`** (8.7 KB, routed, oversize) into a short
   active-rules leaf plus a closed history leaf, and rename it away from "pending".
4. **Still open, waiting on data:**
   - `cycle-dossier.entry` cache read: no runs since the fix. Re-run
     `scripts/probe-ai-run-cache-reads.js --prompt cycle-dossier.entry` after the next dossier
     batch. Production read; it needs the owner's OK.
   - `Narrative-Bibliography_` file: absent on all four J27 test requests. Check after real J27
     proposals arrive (after December 7).
5. **Virus-scan sender UX is partly verified.** The staff upload client's handling of the 422
   `infected` response was not traced.

### Owner Decision Needed

1. Compliance Screening priority (unbuilt; evidence in `project-new-ai-capabilities`).
2. Where the preserved Grant Reporting and Literature Analyzer capabilities live next.
3. From Session 689: limit `/proposal-lists` to the CSO? Change the 21 remaining Program-field
   readers? See `project-program-field-retired-use-grant-program`.
4. Whether the A7 guard should also cover seed scripts and direct Dataverse prompt edits. They are
   outside PR #663.

### Carried From Session 689 (unchanged; see the previous handoff)

- Proposal lists:
  - Check the real J27 Scored membership once proposals are scored.
  - Two-level sections and the staff-version PDF are blocked on Connor's keywords.
  - The owner's J27 test list is live; switching it off is harmless.
- Connor's roster connection read check (`docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md`).
- Parked:
  - Do not merge the Executor lineage branch.
  - Chairs stages and automatic Integrity Screen need separate approval.

### Verify Before Acting

- The Executive Summary trial batch-2 cleanup after November 23 needs a fresh expiry check and the
  owner's preflight.
- Worktree disposal: follow the runbook's preservation preflight.
- Dependency alert #144 is still open (GitHub printed it on every push today). Probe before acting.

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| Memory hygiene | `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 rows 2026-11-20 | Routine and retirement-slice deep audits done; follow-ups above |
| Prompt A7 publish guard | PR #663 | Live; seed/Dataverse coverage is an owner decision |
| Proposal lists | `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md` | Session 689 state |
| App-suite / Finder / pilot retirement | `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md` and siblings | Done; capabilities preserved |
| Chairs | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Separate approval per stage |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Parked lineage; no merge |

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/admin/prompts-publish-service.js` | Publish guard `assertUntrustedDeclarationsPreserved` |
| `tests/unit/prompts-publish-service.test.js` | A7 guard tests (describe "A7: untrusted declarations cannot be weakened") |
| `docs/audits/memory-routine-audit-2026-11-20.md` | Routine audit report |
| `docs/audits/memory-retirement-slice-deep-audit-2026-11-20.md` | Deep audit report, probes and follow-ups |

## Testing

```bash
npx jest --runInBand --silent tests/unit/prompts-publish-service.test.js tests/unit/admin-prompt
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:memory-health
```

## Closeout

Milestone determination: no DEVELOPMENT_LOG entry. The A7 guard is a contained hardening, not a
new capability or cutover, and the memory audits are maintenance. CLAUDE.md unchanged.
Claim-evidence report: no eligible plan/design edit recorded, so no observation row.
Production reads this session were owner-approved, in chat, for that run only.
