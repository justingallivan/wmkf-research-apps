# Session 650 Prompt: Shared prompt library — review the plan and agree the publication contract

**Handoff destination:** `main`, docs-only, owner-confirmed 2026-10-29.
**Feature/planning branch retained:** `codex/shared-prompt-library-plan`, PR #553
open; do not merge it without the owner's authorization for that PR.

Prior complete handoff (Claude's J27/cycle workstream), retrievable exactly:
`git show 006b87565:SESSION_PROMPT.md`. This compact handoff preserves that
workstream by reference; it does not replace its owner decisions or turn old
carryover into a newly verified worklist.

## Session 649 Summary (Codex, 2026-10-29)

### What Was Completed

1. **[MERGED; verified via GitHub] Admin prompt-page improvements.** PR #545
   added descriptive titles, explanations, Used by and caller-classification
   labels with technical keys retained. PR #546 added search and collapsed
   legacy references; PR #548 added counted workflow sections using **Pre-flight**.
   PR #549 moved execution budgets beneath prompts, initially collapsed, with
   Pre-flight / Reviews and evaluations / Meetings and briefings headings and
   catalog-backed titles. Existing budget payloads, draft retention, validation,
   versioning and conflict recovery were preserved. Latest merge: `ebf010f8f`.
   All PR #549 checks passed before its owner-authorized merge. The user had
   previously reported seeing the prompt descriptions in Production; no fresh
   authenticated Production rendering/deployment check was performed at closeout.
2. **[OWNER DIRECTION] Shared Dataverse library.** Justin and successors should
   create/edit prompts in Admin; Connor continues LLM-assisted backend authoring
   and uses Admin for small edits. Both need shared discovery and grouping
   without code/deployment for each new prompt. Today's titles/groups still live
   in the source catalog; no runtime migration has been implemented.
3. **[VERIFIED via owner-authorized read-only Production probe] Live schema.**
   40 names / 59 rows / 39 current; no descriptive/grouping columns and no
   alternate key on prompt versions. One name, `phase-i.checkin`, has no current
   row and null status: do not assume it is a valid Draft. The existing settings
   table supports a uniquely keyed group configuration; `prompt-library.groups`
   was absent. Snapshot observed 2026-10-29T23:22:42Z. No prompt bodies,
   credentials, variable values, or output-schema content are in the evidence.
4. **[PROPOSED; BRANCH ONLY] PR #553 contains implementation plan, shareable
   publication contract for Connor, schema evidence, and reproducible probe.**
   Commit `e35918ba2`. Six optional native metadata columns plus settings-backed
   group labels/order; complete paging; Needs organization fallback; catalog-only
   edits; Admin creation/drafts/first publication; shared audited publisher.
   Independent contract review corrected out-of-order reserved drafts, stale
   metadata baselines, and pending/final audit representation. Final source check
   reuses the existing atomic Dataverse changeset seam for the lifecycle flip;
   Postgres audit/response uncertainty still needs readback recovery. No schema,
   data, runtime library, Power Automate integration or model execution changed.

### Commits / PRs

- `88136c3b7` — merge PR #545, descriptive prompt catalog/cards.
- `1da6d5673` — merge PR #546, search and collapsed stored references.
- `b84d343ce` — merge PR #548, workflow grouping.
- `e04470c65` — budget organization feature commit; PR #549 merged as `ebf010f8f`.
- `e35918ba2` — shared-library plan/probe/evidence, pushed; PR #553 open.
- This docs-only closeout commit is separate from the retained planning branch.

## Next Items

### Verified Open

1. **Review PR #553's shared-library proposal before implementation.**
   Evidence: https://github.com/justingallivan/wmkf-research-apps/pull/553
   The implementation and publication-contract documents are on that branch,
   not yet on main. Next build needs explicit owner direction, additive schema
   provisioning, sandbox write/attribution/concurrency rehearsal and deliberate
   Production promotion. Do not treat the read-only planning permission as
   authorization for schema/data writes or paid model tests.

### Owner Decision Needed

1. **Agree publication coordination with Connor.** Proposed default: backend
   draft authoring remains possible, but publication uses the shared publisher.
   A server lock cannot coordinate arbitrary direct published Dataverse writes.
   If direct publication must remain a normal route, revise the coordination
   design before build. No agreement or message to Connor has been recorded.

### Parked / Not Included

- Power Automate execution adapter, trigger/flow creation, unattended publishing
  authentication, new general-purpose direct field-write authoring, and model
  Test actions are separate scope. Sharing the library does not imply any of
  them exists. Current flow definitions were not probed in this planning task.

### Verify Before Acting

- The 2026-10-29 snapshot establishes prompt/settings metadata only. Verify
  sandbox parity, numeric limits, actual write roles, actor attribution and new
  columns before implementation. Dataverse `queryRecords` clamps inventory
  queries to 100 rows; complete paging is a build requirement, not shipped here.
- Preserve all unknown WIP. Untracked Impeccable critique in the prompt worktree
  was intentionally left alone, per the previous handoff. No memory or root
  instruction changes were needed.

## Concurrent Workstreams

| Owner / workstream | Latest recorded resume boundary |
|---|---|
| Codex / shared prompt library | PR #553, `codex/shared-prompt-library-plan`, `e35918ba2`; proposed only |
| Codex / prompt UI organization | PRs #545/#546/#548/#549 merged; no further UI work requested |
| Claude / J27 alignment and cycle dates | Owning plans and decisions remain in `docs/CURRENT_WORK_QUEUE.md` and `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`; exact prior handoff at `006b87565`; main has newer review-filing work in PR #551, so reread current source/plans before resuming |
| Codex / Ranking | Prior handoff records PRs #536/#537 done; not reopened |
| Codex / Board archival | Prior handoff records readiness done and rehearsal runtime on `codex/board-archive-rehearsal`; not revalidated here |
| Claude / Research request corpus | Prior handoff records owner-gated; no new authorization |

## Constraints

- Merge authorization is per PR. #553 remains open and unmerged.
- Production read permissions from this chat were task/session scoped; the next
  session must follow the owner's current access instructions. Production writes
  need separate explicit authorization and the normal interlocks.
- Never treat a new prompt, declared caller, or run-source label as proof of an
  active Power Automate flow. No automatic execution is part of catalog editing.
- Preserve the previous handoff's parked/destructive-work constraints. Review
  current queue/owning plans and live callers before any retirement or deletion.
- Leave the user's main checkout untouched. The stop handoff used an isolated
  docs-only checkout; the prompt planning branch is preserved.

## Verification and Closeout

- Budget layout: 75 focused tests across six suites passed, types passed, lint
  had zero errors and one existing loading-effect warning. Actual-component
  static previews inspected on desktop and at 390px; no horizontal overflow.
  Client interactions were unit-tested, not exercised in authenticated Production.
- Plan/probe: Production metadata GETs succeeded; probe syntax/lint passed.
  Doc currency, symbol refs, canonical pointers and fact-consistency gates and
  sequential self-tests passed; docs catalog and diff checks passed. Independent
  review confirmed corrections; this is not implementation verification.
- Milestone determination: no new DEVELOPMENT_LOG entry required for this
  closeout. Prompt UI organization is an incremental admin refinement; the shared
  library architecture is proposed, not shipped. Existing calendar/landing-cycle
  milestones remain in that log.
- Claim-evidence pilot report was attempted with `--current` but local session
  state was unavailable. No session key or zero-advisory observation was invented.
