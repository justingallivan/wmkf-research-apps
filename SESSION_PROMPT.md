# Session 645 Prompt: Build the J27 decision calendar/matrix

**Branch:** this handoff lives on `claude/j27-ai-materials-names` (pushed
2026-10-26; **no PR opened**). Owner chose to keep the handoff on the feature branch.
`main` still carries the Session 643 prompt. Check out the feature branch to resume.

## Session 644 Summary (startup + coordination only, 2026-10-27)

No code or plan work. `/start` ran all 40 `check:*` gates plus self-tests
(70 runs), all green; branch 18 ahead / 0 behind `origin/main`.
`/agent-coordination` [VERIFIED via `~/.codex/sessions` rollout log]: a Codex
session (started 2026-10-26 15:42) shares **this checkout**
(`/Users/gallivan/Code/WMKF_Apps`, on this branch). It has only done read-only
work: Board writeup CSO-stage questions and the Beth daily-reminder reply. It
was told Claude was idle. Proposed split, **not yet confirmed by the owner**:
Claude keeps this checkout and branch for J27 docs. Codex does any edits in its
own worktree off `origin/main` and never checks out, switches, stashes or
resets in this directory. Before resuming, re-check for a live Codex session in
this checkout (`git worktree list`, newest `~/.codex/sessions` rollout `cwd`).
Everything below is the unchanged S643 handoff; its next items remain open.

## Session 643 Summary

[VERIFIED via commits on the branch and owner-run probe output, 2026-10-26.]
Justin relayed Connor's answers on J27 proposal files. The apps were changed
to accept the J27 file names. The alignment log was then worked through one
question at a time, and the full J27 timeline (Dec 7 submission → Jun 9–10
Board) was walked into a proposed proposal state model. Nothing was released to
production.

### What Was Completed

1. **J27 AI Materials names accepted (runtime, unreleased).** Governed readers
   (Initial Assessment, Field Primer, Pre-Site, review panel, cycle dossier)
   and the Workbench Proposal-tab AI slots accept either
   `ProposalNarrative_{n}.pdf` / `ProposalBibliography_{n}.pdf` (D26) or
   `Project-Narrative_{n}.pdf` / `Bibliography_{n}.pdf` (J27). Both present
   fails closed. New helpers `acceptedProposalNarrativeFilenames` /
   `acceptedProposalBibliographyFilenames` in
   `lib/utils/proposal-document-names.js`. Connor confirmed all J27 files are
   PDFs except the graphical abstract (an image). 17 suites / 557 tests passed.
   Types, lint, doc gates and a self-run `/contract-reconcile` found no defects.
   Remaining risks: both-present shows "not found" without a reason, and the
   Test Request factory refuses J27-named sources (`SOURCE_DOCUMENT_MISMATCH`).
2. **Read-only probes (owner-run):**
   - `scripts/probe-akoya-request-status-values.js` confirmed `akoya_requeststatus`
     is a String and listed the Phase I and Phase II picklist options.
   - `scripts/probe-d26-phase-statuses.js` covered the 23 D26 Advancing proposals:
     all Phase I `Invited` / `Phase II Pending`. Staff set Phase II `Recommended`
     on 15 and `Not Recommended` on 8 on 2026-10-26.
   - Owner semantics: the phase picklists hold staff recommendations; Request
     Status changes only at the Board decision. Recorded in the Atlas.
3. **Alignment log** (`docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`):
   - B1 answers: `Submission-Documents` folder, the J27 file list,
     `wmkf_phistaffversioncompleteflag` as the ready signal, generate once and
     regenerate by hand (proposed).
   - C1 answered. C2 partly answered (placeholder date; moves handled by a flow).
     C3 goes to the Oct 28 meeting. C5's owner is the CSO with Connor and Sarah.
   - New items: X2 (triage field vs Phase I Status), a **proposed J27 state model**
     (Submitted / Triaged / Under consideration / Recommend to Program Chairs;
     after the Chairs meeting the apps read AkoyaGO), reviewer search versus
     the invitation gate, reviewer materials at about the 50-proposal stage,
     offramp and oral-presentation signals, and an MR vs S&E section.
4. **Docs reconciled** for the J27 names: Power Automate contract, file model,
   reviewer materials folder spec, Atlas, register (Q5, Q23, J27-038, J27-082),
   service catalog, and memory `project-j27-doc-capture-evolution.md`.

### Commits (branch `claude/j27-ai-materials-names`)
- `62d7af5b6` resolver accepts J27 names · `facedc948`, `7773dfe55`, `b5bc02ae3` doc reconciliation and extension confirmation
- `6e889a1d9`, `6b4602de0`, `d9c4a7024`, `5b28dc4dd` probes
- `6b598ae8b`, `b48574a47` Atlas status option sets and semantics
- `140a31c8b` … `5fe5af17f` alignment-log state model, reviewers, offramp, Apr–Jun stages, MR vs S&E

## Next Items

### Verified Open

1. **Decision calendar/matrix for unresolved J27 items (owner's action item).**
   Evidence: the alignment log's open rows and the 2026-10-26 sections.
   Build a who/what/when matrix covering every unresolved item. The owner also
   suggested possibly appending a flowchart that names who sets which AkoyaGO
   field and value to the J27/D27 timeline workbook. Owners named so far:
   - Connor: B1 Q6 reviewer copy contents, order and trigger; magic links; C4 arrival status; C2 placeholder value
   - Connor and Sarah: post-Chairs and offramp AkoyaGO values (tentative: Phase II `Pending Committee Review` for oral-presentation invitees)
   - CSO with Connor and Sarah: MR vs S&E (C5)
   - Wed 2026-10-28 team meeting: calendar ownership (A1, A3, A5, C3)
   - Justin, Sarah, Duncan: X2
   - Duncan: scheduling and oral-presentation invites
2. **PR for the branch.** Evidence: pushed, no PR. This is Tier 1 runtime work
   (governed AI input), so it needs an independent review and deliberate
   promotion. Optionally split the docs-only commits so they can land on `main` first.

### Owner Decision Needed

1. The J27 state-model values in AkoyaGO. Evidence: the alignment log's "J27
   proposal state model" section. Justin will discuss with Connor and Sarah.
2. Prior S643 items remain: the Duncan scheduling walkthrough, the remaining
   Connor/J27 answers, and the next substantive project.
   Evidence: `git show 80b1cd737:SESSION_PROMPT.md`.

### Parked

1. Research request file corpus next steps (step 4 extraction, model pass,
   admin browsing page) need owner approval. Database operations are owner-run.
   Evidence: `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`.
2. The reviewer-save recovery follow-up is unconfirmed ("small ball"). Don't auto-resume it.

### Verify Before Acting

1. Build items implied by the state model are **proposed, not authorized**:
   - J27 list states stored on the request in Dataverse
   - invitation send guard keyed on AkoyaGO approval
   - Reviewer Finder opening at Recommend to Program Chairs
   - 1-page writeup and Diligent Book export (the owner called this the critical build)
   - inline AI pass on the ready flag

   Confirm scope with the owner before building any of them.

### Do Not Reopen Without New Decision

1. Accept-both naming (apps change, not Connor), owner 2026-10-26.
2. C1: GOApply opportunity 001024 is the Research form, and no app concern.

## Constraints

- Production Dataverse and Postgres reads are owner-run with `!`.
- Do not reset, stash or clean untracked `output/` or `.impeccable/critique/`
  files, or the `backup/local-main-slice2-plan-drafts-2026-10-25` branch.
- Older context: `git show 80b1cd737:SESSION_PROMPT.md` (S643 prompt, which
  includes the Codex S642 release summary and the corpus workstream).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Decisions, open items, proposed J27 state model |
| `lib/utils/proposal-document-names.js` | Accepted AI Materials names |
| `lib/services/workbench-proposal-documents.js` | Governed reader and Proposal-tab listing |
| `docs/POWER_AUTOMATE_PROPOSAL_FILE_CONTRACT.md` | File spec for Connor, with J27 names |
| `docs/atlas/dataverse-akoya-request.md` | Status field types, option sets, semantics |
| `scripts/probe-akoya-request-status-values.js`, `scripts/probe-d26-phase-statuses.js` | Owner-run read-only probes |

## Concurrent Workstreams

| Workstream | Resume boundary |
|---|---|
| J27 alignment | This branch; alignment log; decision matrix next |
| Personal email defaults / reviewer recovery | Released S642 (Codex); see `git show 80b1cd737:SESSION_PROMPT.md` |
| Research request file corpus | Claude-owned; loaded 2026-10-26; next steps need owner approval |

## Testing

```bash
npx jest tests/unit/workbench-proposal-text.test.js tests/unit/workbench-proposal-document-listing.test.js
npm run check:types
```

## Verification and Closeout

Milestone determination: no DEVELOPMENT_LOG entry. Nothing shipped to
production; the runtime change is on an unmerged branch. No CLAUDE.md change.
The claim-evidence report recorded no eligible plan/design edit, so no
observation row was added.
