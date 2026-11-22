# Session 695 Prompt: compare the two workflow reviews, then decide the reviewer-finding direction

Previous handoff (Session 694 prompt, written at the end of Session 693):
`git show 0c23e3f3a:SESSION_PROMPT.md`.

## Session 694 Summary — 2026-11-21 (Claude, worktree `.claude/worktrees/linked-riding-sunset`)

### What Was Completed

1. **June–August institution and identity work reviewed** (owner request). Findings
   are recorded in `docs/plans/APPLICANT_REVIEWER_IDENTITY_W2_PLAN_2026-11-21.md`
   ("Institution holds: June–August design review and local replay").
   - Owner rule (August): institution evidence counts only once identity is
     established without it. Stage 2 therefore changes card wording only.
   - HHMI/Broad is a conflict-of-interest exemption only. The planned automatic
     release for departments and schools was never built. Moves are handled only
     in card wording; the dated-currentness rule was never written.
   - `REVIEWER_INSTITUTION_PHASE2`, when on, adds holds and releases none.
   - The September audit already excludes W2 from "identity without
     institution", because W2 binds only at the claimed institution.
2. **The 26 held applicant reviewers.** A local replay plus an owner-approved,
   read-only Production query of stored hold reasons.
   - 25 of 26 were written July 21 – Aug 20 by older code; old-format rows re-run
     when that request's Find tab is opened.
   - With the OpenAlex key, today's code clears 3 of the 11 stored pairs; of the
     8 still held, 1 is a real move and 7 are the same institution or a school,
     institute, campus or affiliate of it.
   - The hold rule since 2026-08-08 discards an exact byline match unless the
     rest of the byline also resolves in OpenAlex; not a code regression.
3. **Two fixes shipped (PR #675, merge `552f93074`, Production deployment
   `3PyznosLUf17vko9nomctoRDm8pC` completed).** Codex native review: no
   actionable findings. Full Jest suite passed.
   - Stage 2 no longer crashes when a byline contains an email address
     (`lib/services/ror-affiliation-assertion-resolver.js`).
   - Applicant enrichment's institution lookup now propagates OpenAlex errors, so
     a failure is recorded as `comparison_error`, not a mismatch
     (`createEnrichmentInstitutionCheckers` in `enrich-recommended-service.js`).
     The reviewer is still held, and the held row is still cached.
4. **Owner reset the direction.** After a year of added "hold unless proven"
   rules, about 13% of applicant reviewers reach a one-click state. The owner set
   a target of fewer than 10% of suggested reviewers needing a human decision,
   and dispatched two independent models for a holistic workflow review.
   - Assignment and outputs live in a private, gitignored folder on the owner's
     machine (real names; not in git):
     `outputs/reviewer-finding-review-2026-11-21/` in the main checkout:
     `brief.md`, `case-packet-26-held.md`, `dispatch-prompt.md`, and on
     completion `report-<model>.md` and `work-<model>/`.
   - Each report has an executive summary, analysis and design, and a phased
     plan whose first phase is detailed enough to build. Each model may use up
     to 1,000 SerpAPI credits, data-provider keys, and its own web search and
     subagents; no LLM provider keys, no production data, no repo changes.

### Production Access This Session
All owner-approved. One read-only Postgres query of `reviewer_find_roster`
(stored hold reasons for the 26 held applicant rows; results kept in the session
scratchpad and the private review folder). No Production writes by Claude.
Local probes used public PubMed, OpenAlex and ROR. Keyless OpenAlex calls hit a
429 rate limit; the keyed account was unaffected (it returned 200).

### Commits
- `552f93074` (PR #675) — stage 2 email fix, lookup failure as incomplete
  comparison, and four W2-plan updates.
- `c80069df8` (PR #677) — interim handoff note pointing to the review folder.
- This commit — Session 694 handoff and W2-plan deployment status.

## Next Items

### Verified Open

1. **Compare the two workflow reviews with the owner** once both
   `report-<model>.md` files exist in the private folder. Produce an
   owner-readable comparison (agreements, disagreements, proposed first phase),
   then move the agreed conclusions, without names, into a tracked plan.
   Evidence: `outputs/reviewer-finding-review-2026-11-21/` (owner's machine).
2. **Carried from Session 692–693, still open:** Connor's step 3 go-live check
   before early December; Connor's promised builds; low-priority Connor questions;
   the `cycle-dossier.entry` cache-read probe (owner OK); the J27 list search hint
   for not-ready requests. Evidence: `git show dc6847a16:SESSION_PROMPT.md`.
3. **Stale docs to fix with `/sweep`:**
   `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` §1 (send-time rule
   predates S391); `docs/atlas/postgres-reviewer-find-roster.md:344` says
   enrichment no longer runs on load, but `useApplicantReviewerEnrichment.js`
   still does.

### Owner Decision Needed

1. **Reviewer-finding direction**, after comparing the two reviews. Until then,
   these Session 693 items are on hold because the reviews may supersede them:
   the applicant-only W2 combined pilot; card follow-ups (applicant controls to
   the top, server evidence levels, Confirm and add to Invite); reading the
   shadow log.
2. **Institution follow-ups** (owner said not to start yet, 2026-11-21): treating
   a trailing city, zip code or address as decoration in the hold rule; whether a
   failed comparison re-runs automatically on next open (paid enrichment); whether
   to re-open last cycle's requests so stale holds recompute. The same
   lookup-failure weakness remains in `alert-reviewer-affiliation-mismatch.js:100`
   and `reviewer-identity-evidence.js:517`; the W2 path still rejects an email in
   the listed institution (`ror-institution-identity-resolver.js`).
3. Carried: step-3 prompt limits vs the CSO workbook (12 differences); an optional
   Workbench control for `wmkf_readyforreview`.

### Parked

1. Branch 2 exclusion enforcement (scope unchanged from Session 692). It may be
   reshaped by the workflow review.
2. Live promotion test on 1003526 (owner parked 2026-11-20). Do not fill the
   identity-confirmation attestation on the owner's behalf.
3. Carried from Session 692: proposal lists; Connor's roster connection check; do
   not merge the Executor lineage branch; consultant-feedback finalize retry reuse.

### Verify Before Acting

1. **Executive Summary trial batch-2 cleanup, Monday Nov 23 after 18:31:58 UTC.**
   Destructive; steps in `git show dc6847a16:SESSION_PROMPT.md` and
   `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` ~95–128.
2. **Merged branches that could be deleted** (confirm first): remote
   `find-identity-card-layout`, `find-applicant-listed-column`,
   `find-card-status-fixes`, `find-unresolved-wording`,
   `reviewer-identity-shadow-enrichment`, plus Session 692's three; local
   `worktree-linked-riding-sunset`, `claude/reviewer-finding-review-prompt`,
   `claude/session-694-stop` (all squash-merged or empty).
3. **Production identity mode is `shadow`** (owner-set). Do not set `combined`
   without an approved cutover.
4. **The counts in the W2 plan's re-check** before the keyed rerun may include
   rate-limited lookups; the keyed 3-of-11 result supersedes them.

### Do Not Reopen Without New Decision

1. Card decisions 1–11 in `docs/plans/FIND_IDENTITY_CARD_REDESIGN_BRIEF_2026-11-20.md`.
2. Do not cut over W2 globally on the evidence so far.
3. Session 692's list (compliance screening, archived destinations, exclusion
   policy, deprecated `potentialreviewer1`–`5`, and the rest).

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| Reviewer-finding workflow review | `outputs/reviewer-finding-review-2026-11-21/` (private) | Two model reviews dispatched; compare when both reports exist |
| Applicant reviewer identity (W2) | `docs/plans/APPLICANT_REVIEWER_IDENTITY_W2_PLAN_2026-11-21.md` | Shadow live; institution findings recorded; pilot on hold pending the review |
| Find identity card | `docs/plans/FIND_IDENTITY_CARD_REDESIGN_BRIEF_2026-11-20.md` | Layout and fixes live; follow-ups on hold pending the review |
| J27 applicant reviewers / exclusions | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` §9 | Branch 2 not started |
| PA intake flows (Connor) | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Waiting on step-3 go-live |
| Memory hygiene | `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 | Router about 7.6 KB |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Batch-2 cleanup Nov 23 |

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/workbench/enrich-recommended-service.js` | Applicant enrichment, institution hold, `createEnrichmentInstitutionCheckers` |
| `lib/services/institution-affiliation-consistency.js` | Boolean institution comparison and the trailing-text rule |
| `lib/services/institution-identity-resolver.js` | OpenAlex institution lookup (`propagateProviderErrors`) |
| `lib/services/ror-affiliation-assertion-resolver.js` | Stage 2 byline segmentation; email removal |
| `lib/services/institution-affiliation-stage2.js` | Stage 2 card/notification assessment |
| `lib/services/reviewer-works-first.js` | W2 works-first resolver |

## Testing

```bash
npx jest --silent tests/unit/enrich-recommended-institution-evidence.test.js tests/unit/ror-affiliation-assertion-resolver.test.js tests/unit/institution-checker-consumer-scope.test.js tests/unit/institution-affiliation-stage2.test.js tests/unit/workbench-enrich-recommended-service.test.js
```

## Closeout

**Milestone determination:** no DEVELOPMENT_LOG entry. The two fixes correct
defects in existing behavior; the workflow review is dispatched, not decided.

**Other closeout checks:** CLAUDE.md unchanged. Claim-evidence report: 0
advisory events recorded for this session key, so no observation row.
