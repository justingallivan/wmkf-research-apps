# Session 696 Prompt: choose the next priority

## Session 695 Summary — Codex external-service tracking closeout

[VERIFIED via migration runner, GitHub checks and signed-in production Admin]
Cloudmersive public pricing and limit checks shipped in PR #678, merge
`12b0733f1`. Migration 112 applied before deployment at 2026-11-22T03:52:15Z;
constraint readback passed. Both public checks saved first baselines at
2026-11-21 20:03:40 Pacific, and reloading preserved timestamp and evidence.
Account usage and remaining quota explicitly require manual verification.
No scans, account API requests or human review saves were made.

- Ordinary Claude Opus OAuth review and follow-up completed; findings addressed.
- 99 focused tests, build and relevant gates passed; all PR checks passed.
- `929848f89` records the release in the Atlas and audit. Its production deployment
  `dpl_GF9B2VeP8oyUqYqYQYx1Hc2yMQqR` reached Ready with production aliases.
- Runtime entry: `lib/services/external-services/cloudmersive-sources.js`;
  persistence constraint: `lib/db/migrations/112_cloudmersive_service_checks.sql`.
- Evidence: `docs/audits/CLOUDMERSIVE_SERVICE_CHECKS_2026-11-21.md` and
  `docs/atlas/postgres-external-services.md`.

**DONE:** Cloudmersive build, migration, release and hosted verification.
**Owner decision needed:** choose another provider or another task. No additional
service implementation or scheduled checks are authorized by this handoff.
Keep checks manual. Microsoft, GitHub and Zoom costs are corporate-managed;
OpenAI billing integration was deferred by the owner. Cloudmersive account usage
remains a manual portal check, not inferred from public plan capacities.

## Concurrent Claude handoff preservation

Full Session 694 summary and Session 695 prompt remain retrievable with
`git show 69a5070cf:SESSION_PROMPT.md`. The worklist below preserves Claude's
owner decisions and safety constraints; unrelated open claims were not reprobed
by this Codex closeout. Verify their current status before acting.

## Next Items

### Verify Before Acting — concurrent Claude carryover

1. **Compare the two workflow reviews with the owner** once both
   `report-<model>.md` files exist in the private folder. Produce an
   owner-readable comparison (agreements, disagreements, proposed first phase),
   then move the agreed conclusions, without names, into a tracked plan.
   Evidence: `outputs/reviewer-finding-review-2026-11-21/` (owner's machine).
   Status 2026-11-23: Claude's report is done
   (`report-claude-opus-5-5.md`; no Production reads, 44 SerpAPI credits). Its
   recommendation: one shared resolver bound to the listed institution and the
   proposal topic, with Phase 1 built in shadow mode. Cutover needs a replay of real
   rows (one owner-approved read-only query, report §2.8) and 200+ generated decoys.
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
| External service tracker (Codex, released) | `docs/audits/CLOUDMERSIVE_SERVICE_CHECKS_2026-11-21.md` | Cloudmersive deployed and verified; next provider requires owner selection |
| Reviewer-finding workflow review | `outputs/reviewer-finding-review-2026-11-21/` (private) | Claude report done 2026-11-23; compare when the other report exists |
| Applicant reviewer identity (W2) | `docs/plans/APPLICANT_REVIEWER_IDENTITY_W2_PLAN_2026-11-21.md` | Shadow live; institution findings recorded; pilot on hold pending the review |
| Find identity card | `docs/plans/FIND_IDENTITY_CARD_REDESIGN_BRIEF_2026-11-20.md` | Layout and fixes live; follow-ups on hold pending the review |
| J27 applicant reviewers / exclusions | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` §9 | Branch 2 not started |
| PA intake flows (Connor) | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Waiting on step-3 go-live |
| Memory hygiene | `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 | Router about 7.6 KB |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Batch-2 cleanup Nov 23 |

## Closeout

Owner: Codex. Branch: `codex/cloudmersive-release-receipt`; runtime already merged
in PR #678. Session documentation lands separately on a docs-only stop branch.
Changed surfaces: Cloudmersive collectors, existing tracker/UI integration,
constraint migration, tests, Atlas and release audit; this closeout changes only
SESSION_PROMPT.md and DEVELOPMENT_LOG.md. No runtime edits remain.
Worktree was clean before closeout; retain it and existing branches, do not delete
or reset another agent's checkout. Codex releases ownership of the service tracker.
Next owner/action: Justin chooses the next priority; run `/start` when resuming.

Milestone entry added: “Cloudmersive public service checks in Admin”.
CLAUDE.md and memory unchanged: existing source-of-truth pointers cover the feature.
Claim-evidence report unavailable (local state could not be read); no observation
row fabricated. No memory-router growth occurred in this closeout.
