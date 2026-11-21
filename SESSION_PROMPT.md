# Session 693 Prompt: fix the identity-review card; then exclusion enforcement

Previous handoff (Session 692 prompt, written at the end of Session 691):
`git show 992ae0eeb:SESSION_PROMPT.md`.

## Session 692 Summary — 2026-11-20 (Claude, main checkout)

### What Was Completed

1. **J27 applicant reviewers now appear on the Find tab (PR #666, merged `bde015d40`,
   live in Production).**
   - **Gap:** Connor's step 1 writes the applicant's five suggested reviewers as
     `wmkf_appreviewersuggestion` rows (disposition Recommended) and leaves the
     deprecated `akoya_request.wmkf_potentialreviewer1`–`5` empty. The Find tab built its
     list only from those lookups. Confirmed by owner-approved reads of test request
     1003526.
   - **Fix:** `applicant-reviewers-service` lists existing Recommended rows read-only
     after legacy slot materialization. A failed row read or a row with no linked person
     shows a retry warning, not the "did not list any" empty state.
   - **Promotion:** reads the request cycle before any write and stamps an empty
     `wmkf_grantcyclecode` inside `selectIfUnengaged`'s ETag PATCH.
   - **Exclusions:** `wmkf-excludedreviewers/1` JSON is parsed without the LLM, for
     display and the search soft-block only.
   - **Review:** two Codex plan reviews (findings folded in) and a diff review
     (approve). The full Jest suite passed (28,356), as did the gates and CI.
   - **Verified live 2026-11-20 on 1003526:** five applicant reviewers listed;
     verification ran and routed all five to identity review (test data); the exclusion
     box showed the three JSON names with no warning. Promotion was not tested (parked
     below).
2. **Connor's answers and decisions, recorded** in `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md`
   (section 10, items 5–9), the Atlas pages and the excluded-reviewers plan:
   - The `potentialreviewer1`–`5` lookups are deprecated, and that is final.
   - Step 1 sets Recommended; a rerun updates the five rows in place.
   - Suggested reviewers are required on the form; excluded reviewers are optional.
   - `wmkf_excludedreviewers` is now JSON
     (`{"schema":"wmkf-excludedreviewers/1","source":"applicant","reviewers":[{firstName,lastName,info,reason}]}`,
     with `info` optional free text). It is empty JSON when nobody is excluded.
     Staff need no readable copy.
   - The compliance summary is written only for non-compliant submissions.
3. **Owner decisions for exclusion enforcement (Branch 2, not built):**
   - Hard block on an exact normalized-name match.
   - Server-side, JSON exclusions only (no selection after a cycle ends).
   - Recorded in `d0825a2ce`.
4. **Executive Summary batch-2 cleanup:** the owner chose to wait for the Nov 23
   expiry. Readiness facts are recorded below.

### Production Access This Session
All of these were owner-approved and read-only, through the interlocked client with
`DATAVERSE_ALLOW_PROD_READS=yes`. The probes are in the scratchpad only.
- **Request 1003526, reviewer data:** its reviewer lookups, suggestion rows (sources,
  disposition, selected) and `wmkf_excludedreviewers`. Read twice: before and after
  Connor's rerun.
- **Request 1003526, status fields:** readiness and status.
- **`akoya_request` metadata:** an attribute-name search for ingest/stage.

The owner approved the browser check on Production 1003526. Its enrichment wrote that
request's Find roster rows. No identity confirmation or promotion was made.

### Commits
On `main`, `141824821..bde015d40`, all pushed. The work includes PR #666: `2001620a9`
and `f1650d2c3`.

## Next Items

### Verified Open

1. **Fix the Find-tab identity-review card (top priority; the owner called it an
   embarrassing mess).** The example is Yifan Cheng on 1003526 (Peer Review → Find).
   - **Problems:**
     - Confirm identity / Not a fit appear twice.
     - Three overlapping "needs confirmation" blocks.
     - "Why this reviewer was suggested" shows internal gate text ("explanatory
       institution assessment… existing verification gate").
     - "Contact readiness is shown under Identity below" points nowhere.
     - The real reason (applicant recommended) is a small tag.
     - Promotion takes five steps: the Confirm form (affiliation, email, "I checked the
       evidence" box and evidence link), then select, then Add selected to Invite.
   - **Target:**
     - One plain question per card ("Is this the right person?").
     - The match result as one line (✓ publications match UCSF / ⚠ point to Cornell).
     - One pair of buttons, with evidence folded away.
     - A single **Confirm and add to Invite** action when the evidence is clean.
     - The email-evidence attestation only for uncertain addresses (role or lab
       mailbox, domain mismatch, none found).
   - **Plan with the owner first:**
     - Enumerate every card state and propose wording for each.
     - Show a mock-up before building.
     - The owner decides when the email-evidence safeguard can be skipped.
   - The card is shared by all identity-review candidates, not only applicant ones.
   - Evidence: `feedback-ordered-workflows-as-one-action`; the card lives under
     `shared/components/reviewers/search/` (locate the component first).
2. **Branch 2: exclusion enforcement.**
   - **Scope:**
     - A deterministic JSON exclusion reader with distinct none / valid / legacy /
       invalid outcomes. Do not reuse the display parser's contract.
     - The check runs before any person, researcher, roster or suggestion write, on
       manual add, save-candidates, applicant promotion and restore
       (`reviewer-suggestion.js` `restore`, called from `my-candidates-service.js`).
     - Compare both the submitted name and the resolved canonical person's name.
     - Refuse each time, and do not persist a terminal block (`markPromotionBlocked`).
     - Update the client's `applicant_excluded` classification in
       `useReviewerPromotion.js`.
     - Audit the merge and invite entry points.
   - **Evidence:** Codex plan review findings (Session 692); the owner decisions in
     `docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md`; map section 9, item 6.
   - **Process:** `/contract-reconcile` and a Codex plan review before building.
3. **Watch for Connor's step 3 going live before early December.**
   - **Then confirm** on one J27 request (owner-approved read) that `akoya_programid`,
     `wmkf_programareaserved` and `wmkf_ai_keywords` are populated, and that the
     staff version and `AI Materials/Narrative-Bibliography_` appear after step 5.
   - Evidence: map section 0.
4. **Connor builds promised but not yet confirmed:** the keyword-change flow and the
   reviewer-copy flow (Recommended trigger). Evidence: map section 10, items 1 and 4.
5. **Low-priority questions for Connor:**
   - Does `wmkf_ai_methodologies` come from `intake.keywords` or another prompt?
   - Is `akoya_submissionaccepted` always set manually?

   Evidence: map section 10, items 6–7.
6. **`cycle-dossier.entry` cache read:** re-run
   `scripts/probe-ai-run-cache-reads.js --prompt cycle-dossier.entry` after the next
   dossier batch. This is a Production read and needs the owner's OK.
7. **Minor usability gap:** the J27 Workbench list search says "No requests match"
   for a request that exists but is filtered out. 1003526 has
   `wmkf_readyforreview` = false, which the J27 discovery filter excludes
   (`shared/config/workbenchVisibility.js:74`). A hint ("not yet ready for review", or
   hidden as closed) would help. Fold this into item 1's design pass if the owner wants.

### Owner Decision Needed

1. **Step-3 prompt limits vs the CSO workbook handoffs:** 12 differences are not
   reconciled. Evidence: `docs/audits/power-automate-intake-sweep-2026-11-20.md`,
   section "Step-3 output vs prompt handoffs".
2. **Optional:** a Workbench control for setting `wmkf_readyforreview`. Nobody has
   asked for it.

### Parked

1. **Live promotion test on 1003526 (owner parked 2026-11-20).**
   - **Steps:** set Ready for review = Yes in Dynamics (or open the request via "Find
     and open a request"). Confirm identity on Yifan Cheng, then Add selected to Invite.
     Then read his row: expect `wmkf_selected` true and `wmkf_grantcyclecode` = J27.
   - **Re-open trigger:** after item 1's redesign, or the first real PD promotion of an
     applicant reviewer.
   - **Do not** fill the identity-confirmation attestation on the owner's behalf.
2. **Proposal lists:**
   - Two-level sections and the staff-version PDF wait on step-3 keywords.
   - Check real J27 Scored membership once proposals are scored.
   - The owner's test list is still on.
3. **Connor's roster connection read check:**
   `docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md`.
4. **Do not merge the Executor lineage branch.** The Chairs stages and the automatic
   Integrity Screen each need separate approval.
5. **Minor:** other permanent consultant-feedback finalize rejections (e.g.
   `image_too_large`) still reuse the dead staging id on retry (PR #665).

### Verify Before Acting

1. **Executive Summary trial batch-2 cleanup, Monday Nov 23 after 18:31:58 UTC
   (10:32 Pacific).** Destructive; the owner chose to wait for expiry, not delete
   directly.
   - **Checked 2026-11-20:** `/private/tmp/wmkf-summary-live-20261116` (with
     `development.env` and `http-state.json`) and the parked worktree
     `/private/tmp/wmkf-summary-generation-20261116` at `d86870146` exist.
   - **No automatic expiry:** rows are deleted only when a prompt-job worker runs, and
     nothing schedules one (parked-branch `vercel.json`, `store.js` `expireContent`).
   - **Database:** the Preview deployment's Postgres host differs from `.env.local`'s.
     Whether it is the Production database is not confirmed [ASSUMED unknown].
   - **Steps:**
     1. Refresh the token (`vercel env pull … development.env` from the main checkout).
     2. Confirm the Preview deployment and its pilot setting exist.
     3. Run `node scripts/run-summary-sandbox-http.cjs expire` once (6 of 8 ticks
        used).
     4. Do a read-only row count for the job; it also settles whether batch 1 deleted
        anything.
   - Source: `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md`, around lines
     95–128.
2. **Merged remote branches that could be deleted:** `claude/prompt-seed-untrusted-guard`,
   `claude/consultant-feedback-scan-retry` and `claude/j27-applicant-reviewers-from-rows`.
   All are merged into `origin/main`; confirm before deleting.
3. **Worktree disposal:** follow the runbook's preservation preflight.

### Do Not Reopen Without New Decision

1. **Compliance screening as an app feature:** no (owner, 2026-11-20).
2. **Destinations for Grant Reporting / Literature Analyzer:** archived.
3. **Narrowing `/proposal-lists` to the CSO:** no (decision 19).
4. **Guarding direct Dataverse prompt edits and non-helper seed scripts:** trusted
   channels.
5. **The `potentialreviewer1`–`5` lookups for J27:** deprecated, final (Connor).
   - The app reads Recommended rows. Do not ask Connor to refill the lookups.
6. **Exclusion enforcement policy:** a hard block on exact name match; JSON only
   server-side (owner, 2026-11-20).
7. **Flow reruns overwriting PD state:** out of scope.
   - The flows run once at intake, about 6 weeks before reviewer selection (owner,
     2026-11-20).
8. **Server-created reviewer records for excluded reviewers:** not created (Connor's
   design, owner agreed).
   - There is no email, and match-only blocking does not need one.

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| J27 applicant reviewers | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` §9 items 6–7 | Branch 1 live (#666); identity-card redesign next, then Branch 2 enforcement |
| PA intake flows (Connor) | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Waiting on step-3 go-live and Connor's builds |
| Memory hygiene | `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 | Router is 7,492 B |
| Proposal lists | `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md` | Sections wait on keywords |
| Chairs | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Separate approval per stage |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Parked lineage; batch-2 cleanup Nov 23 |

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/workbench/applicant-reviewers-service.js` | Find-tab applicant list: legacy slots plus read-only Recommended rows |
| `shared/components/reviewers/search/ApplicantReviewerStatus.js` | Applicant panel empty, retry and lookup-failure states |
| `lib/services/workbench/promote-applicant-reviewer-service.js` | Promotion; pre-write cycle read |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `selectIfUnengaged` cycle stamp; `restore` (Branch 2 bypass) |
| `lib/services/reviewer-exclusion-parser.js` | `parseStructuredExclusions` (JSON, display only) and the Haiku legacy path |
| `docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md` | Exclusion decisions; the old Phase C superseded |
| `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Connor's flow map, app implications, question log |

## Testing

```bash
npx jest --silent tests/unit/workbench-applicant-reviewers-service.test.js tests/unit/applicant-reviewer-status-empty-states.test.js tests/unit/reviewer-exclusion-structured.test.js tests/unit/workbench-promote-applicant-reviewer-service.test.js tests/unit/reviewer-suggestion-disposition.test.js
npm run check:doc-currency && npm run check:doc-currency:self-test
```

## Closeout

**Milestone determination:** no DEVELOPMENT_LOG entry.
- PR #666 is a contained fix that lets an existing capability (the Find tab's applicant
  reviewers) read the new J27 intake shape.
- It is not a new capability, a cutover or an architecture change.

**Other closeout checks:**
- CLAUDE.md is unchanged.
- Claim-evidence report: no eligible plan or design edit was recorded, so there is no
  observation row.
