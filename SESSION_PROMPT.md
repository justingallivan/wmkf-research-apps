# Session 698 Prompt: wait for Codex's Find work, then decide the reviewer-finding direction

## Session 697 Summary — Claude: doc fixes, trial cleanup, comparison of the two reviews

Claude worked in a separate worktree, `WMKF_Apps-claude-2026-11-25` on branch
`claude/session-2026-11-25`, based on `origin/main`. Codex had the main checkout
on `codex/pre-j27-find-pdf-readiness`. All 41 `check:*` gates and their
self-tests were green at start.

### What Was Completed

1. **Stale reviewer docs fixed** (`5558ac1e1`).
   - **Send tier.** `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` §1
     was rewritten. Confirm-mode now ends with `verify_person_and_address`, which
     records `staff_verified` plus a trust bundle, and that makes the address
     `ready`. The S388 text moved under a historical heading. §2.1 and the status
     section were corrected too.
   - **Enrichment on load.** Applicant enrichment still runs automatically when
     Find loads (`useApplicantReviewerEnrichment.js:107-117`). The
     explicit-verify replacement (`d2ca41cf1`) was reverted in `9413a8e52`.
     Fixed in the Find roster Atlas page and the
     `reviewer-find-applicant-flow` and `reviewer-identity` wiki pages.
2. **Executive Summary trial batch-2 cleanup** (`eae3f12bc`, owner-authorized).
   - **Why the planned run failed.** The `expire` runner could not work:
     `/private/tmp/wmkf-summary-live-20261116` and the parked worktree were
     gone. They held the only copy of the Preview's deployment-scoped
     `CRON_SECRET`, which cannot be recovered.
   - **What was done instead.** The owner re-authenticated the Neon CLI
     (`! npx -y neonctl@2 auth`). Claude used it to reach the
     `pa-prompt-sandbox` branch (`br-icy-boat-af2c8cq6`), checked read-only
     first, then deleted 16 expired `prompt_job_content` rows in one
     transaction guarded on exact counts:
     - 4 from Summary job `ccd99f2b…`;
     - 6 each from Short Title jobs `7e68cdfe…` and `d1008831…`.
   - **Result.** The content table is now empty. The check also confirmed that
     batch 1 (Nov 17) had deleted its rows. Receipt:
     `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md`, "Batch 2". The
     connection-string file was deleted after use.
3. **Reviewer-finding reviews compared** (private, not in Git):
   `outputs/reviewer-finding-review-2026-11-21/comparison-2026-11-26.md`.
   - **Recommendation.** Adopt what both reports share, built inside Codex's
     replay harness:
     - investigate until the evidence supports an action;
     - keep the authorities to show evidence, to use an address on one
       request, and to write to CRM separate.

     Take the GPT report's exact-mailbox rule and its more conservative
     forecasts.
   - **Verified today.** On a first acceptance,
     `reviewer-acceptance-drain.js:1222` sends the proposal materials
     automatically. They are held only if preparation fails. Claude's report
     had understated this exposure.
   - **Owner's call.** Let Codex finish its Find work before deciding.

### Commits
- `5558ac1e1` — reconcile reviewer docs with the live send tier and Find enrichment behavior.
- `eae3f12bc` — record the batch-2 content cleanup.
- This handoff.

**Milestone determination:** no DEVELOPMENT_LOG entry. These were doc
corrections and Sandbox data cleanup, with no new capability or cutover.

## Next Items

### Owner Decision Needed (after Codex finishes)

1. **Reviewer-finding direction.** Evidence: the comparison file above.
   - Adopt the shared core inside Codex's replay harness, or choose otherwise.
   - Then set the policy inputs: wrong-action tolerance (the reports suggest 0
     in about 300), the coauthor window, affiliate and emeritus treatment, and
     the minimum panel size (3 proposed).

   Until then, the W2 combined pilot and the Find card follow-ups stay on hold.
2. **Automatic materials release on acceptance.** Should it require a bound
   identity and recipient? This exists today, independent of the redesign.
   Evidence: `lib/services/reviewer-acceptance-drain.js:668`, `:1222`.
3. **Codex branch `codex/pre-j27-find-pdf-readiness`:** merge it or continue.
   It holds contact ownership, the replay harness and the 20-proposal pilot,
   and none of it is on `main` as of `eae3f12bc`. Its Fable review
   (`docs/plans/evidence/J27_FIND_CONTACT_OWNERSHIP_FABLE_REVIEW.md`) asks for a
   holdout cohort before any automatic clearing.
4. **Carried forward:**
   - institution follow-ups (owner said not to start, 2026-11-21);
   - step-3 prompt limits vs the CSO workbook (12 differences) and an optional
     `wmkf_readyforreview` control;
   - the next external-service provider, or none.

### Verify Before Acting

1. **Carried from Sessions 692–693, not re-checked:**
   - Connor's step 3 go-live check (due before early December);
   - Connor's promised builds;
   - the `cycle-dossier.entry` cache-read probe (owner OK);
   - the J27 list search hint for requests that aren't ready. Coordinate with
     Codex's J27 work first.

   Evidence: `git show dc6847a16:SESSION_PROMPT.md`.
2. **J27 staff "Verify contact only" step** (#684, #685). Merged to `main`;
   deployment and browser not checked by Claude. The owner tries it before PDs
   start (`docs/plans/J27_STAFF_CONTACT_ROLLOUT.md`).
3. **Production identity mode is `shadow`** (owner-set). Do not set `combined`
   without an approved cutover.

### Parked

1. Branch 2 exclusion enforcement; the reviewer-finding direction may reshape it.
2. Live promotion test on 1003526 (owner parked 2026-11-20). Do not fill the
   identity-confirmation attestation on the owner's behalf.
3. From Session 692: proposal lists; Connor's roster connection check; do not
   merge the Executor lineage branch; consultant-feedback finalize retry reuse.
4. **Leftover Executive Summary trial artifacts** stay until the owner decides:
   - in `pa-prompt-sandbox`: the job, task, attempt and publication rows;
   - the test PI link on Sandbox 1000389;
   - the TEST-folder PDF.

### Do Not Reopen Without New Decision

1. Card decisions 1–11 in `docs/plans/FIND_IDENTITY_CARD_REDESIGN_BRIEF_2026-11-20.md`.
2. Do not cut over W2 globally on the evidence so far.
3. Session 692's list (compliance screening, archived destinations, exclusion
   policy, deprecated `potentialreviewer1`–`5`, and the rest).
4. Admin prompt Variables: live and verified, and Connor has been told
   (owner, 2026-11-25).

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| Find contact ownership / J27 pilot (Codex, active in main checkout) | branch `codex/pre-j27-find-pdf-readiness`; `docs/plans/J27_FIND_CONTACT_OWNERSHIP_PLAN.md` | Codex finishing; owner waits for it |
| J27 staff-confirmed contacts (Codex, merged) | `docs/plans/J27_STAFF_CONTACT_ROLLOUT.md` | Owner trial before PDs |
| Reviewer-finding direction | `outputs/reviewer-finding-review-2026-11-21/comparison-2026-11-26.md` (private) | Owner decision after Codex |
| Applicant reviewer identity (W2) | `docs/plans/APPLICANT_REVIEWER_IDENTITY_W2_PLAN_2026-11-21.md` | Shadow live; pilot on hold |
| External service tracker (Codex, released) | `docs/audits/CLOUDMERSIVE_SERVICE_CHECKS_2026-11-21.md` | Next provider needs owner selection |
| PA intake flows (Connor) | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Waiting on step-3 go-live |
| Memory hygiene | `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 | Router about 7.6 KB; unchanged |

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` | §1 current send-tier contract (rewritten this session) |
| `shared/components/reviewers/search/useApplicantReviewerEnrichment.js` | Find on-load applicant enrichment effect (live) |
| `lib/services/reviewer-acceptance-drain.js` | Automatic materials release on acceptance |
| `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Executive Summary trial cleanup receipts |

## Testing

```bash
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:agent-wiki && npm run check:agent-wiki:self-test
```

## Closeout

Owner: Claude. Docs commits went straight to `main` as fast-forwards from the
docs-only branch `claude/session-2026-11-25`, as agreed this session. No runtime
code was changed. The worktree `WMKF_Apps-claude-2026-11-25` is clean and can
be removed. Codex's main checkout and branches were read, not modified. CLAUDE.md
and memory are unchanged. Claim-evidence report: no eligible plan or design edit,
so no observation row.
Next owner/action: Codex finishes its Find work. Justin then picks the
reviewer-finding direction. Run `/start` when resuming.
