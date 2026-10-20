# Session 623 Prompt: Build the co-PI (Stage B) resolve for Institution at Award

## Session 622 Summary — Institution at Award column, PI backfill, co-PI evidence (Claude, 2026-10-20 PT)

All production reads and writes were owner-run or owner-authorized. Plan of record: `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`.

### What Was Completed

1. **New column.** [VERIFIED via sandbox metadata readback; production via owner-run `--execute` output] Connor agreed in writing to a lookup on the PI/co-PI junction. Schema wave 34 added `wmkf_apprequestperson.wmkf_InstitutionAtAward` (→ `account`, Delete: Restrict, Merge: Cascade) to sandbox and production. GoApply will fill it for new submissions.
2. **Stage A, PIs, applied.** [VERIFIED via owner-run `--verify` 270/270, then `--rollback` `{"cleared":1}`] Scope (owner): awarded (Approved/Active/Closed) Medical and Science & Engineering Research requests with meeting dates from 2017, special grants included. 231 PI rows set to the applicant account and 39 empty PI contact accounts linked. Test request 1002807 (W. M. Keck Foundation applicant) was then rolled back: 230 stand. The script went through three Codex adversarial reviews (findings fixed with tests: source re-validation, PATCH-response ETag for rollback, latest-award selection, retryable rollback, full program scope).
3. **Findings recorded.**
   - PI contacts without an account: 39 of 45 were created by the akoyaGO integration without one (35 after the migration), and 6 are duplicates whose other contact holds the applicant account. A note to Connor is drafted and held unsent (plan §7).
   - Special grants: 30 of the 238 awards are not `wmkf_type = Program`; 19 of the 24 with a PI are the UCLA Keck Court Biomedical Initiative. Atlas `dataverse-akoya-request.md` gotchas and memory `project-research-special-grants-in-cohorts`.
   - Trashed requests keep `akoya_requeststatus` (filter `statecode eq 0`); the test marker `wmkf_istestrequest` is unset on all awarded requests, so a Keck Foundation applicant is the better test signal. "NCE" = no-cost extension (post-award paperwork). Atlas gotchas.
4. **Co-PI list decided for 2017–2023 (136).** [OWNER DECISIONS, plan §3.2] The first extraction's "rule a" (faculty with a biosketch) was a guess. `scripts/verify-research-copi-roles.mjs` (paid, Haiku 5.5, about $1.00 across all runs) re-read the 78 rule-a grants including budgets, accepting only quotes found in the cited file that name the person. Approved: 110 rule-c co-PIs + 19 stated roles + 4 budgeted faculty on 992950 + Dill (991649), Ji (994865), Nelson (995161). 996163's people are collaborators (owner hand check). Everyone else stays in the CSVs, not written.
5. **2024-on co-PIs probed.** [VERIFIED via owner-run `scripts/probe-research-copi-accounts.mjs`] 52 co-PIs on 27 awards, none before 2024; 37 contacts lack an account; 25 share the PI's email domain; 1 is slot-only (needs a junction row).

### Commits

`cefd15420`..`1432a5946` on `main` (29 commits, all pushed). Key ones: `cefd15420` wave 34 spec; `78ff873d5`/`f873e9f49`/`bbf720d6a`/`361f63797`/`9de903b3b` Stage A script and Codex fixes; `96eba3ce3`..`72c6de1b9` co-PI role check; `e4fb9e8d7` special grants; `1432a5946` rollback record. This handoff commit follows.

## Next Items

### Verified Open

1. **Build the Stage B resolve (read-only) and approval workbook.**
   Evidence: plan §3.2; owner CSVs in `~/Downloads/Research Co-PI Searches/` (`research-copi-candidates.csv`, `research-copi-roles-v3.csv`, `research-copi-roles-recheck.csv`, `research-copi-accounts-probe.csv`; restricted PII, never in git).
   Inputs: the 136 approved 2017–2023 co-PIs and the 52 recorded 2024-on co-PIs. Rules agreed: exclude W. M. Keck Foundation applicants and `statecode ≠ 0`; contact match by any email (all three fields, all contacts), then name + email domain, else review; account from the contact's account if set, else the applicant when the email domain (incl. subdomains) matches the PI's, else a clear-winner domain→account map from contacts staff already linked, else review; never create accounts without per-row approval; create contacts/junction rows only with approval; check legacy `wmkf_copi1..5` slots and the junction alternate key. Created records need delete-based rollback with their own ledger kinds. Put rules in `scripts/lib/` with Jest tests; expect Codex review rounds. Approval in the ORCID-style workbook.
2. **Data fixes for staff in Dynamics.**
   Evidence: plan §3.1. Merge the 6 duplicate PI contacts (992966, 994465, 1001530, 1001618, 1002341, 1002353); check 1000954 (PI junction row names a different contact than the project leader); the 4 held-back ORCID duplicate cases.

### Owner Decision Needed

1. **Send the held note to Connor** (intake contact account linking and email dedupe). Evidence: plan §7. Owner is waiting on another thread with him first.
2. **Colleague vocabulary review.** Evidence: `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`. Await feedback and explicit scope.
3. **Meeting Tracker redesign direction.** Evidence: `.impeccable/critique/2026-10-19T22-21-01Z__nts-meeting-tracker-meetingtrackerlist-js-ef43d395.md`. No build authorized.

### Parked

1. **Earlier years (before 2017).** Evidence: plan §6. Re-open if the 2017-on analysis is useful; PIs extend cheaply, co-PIs need a new inventory and paid extraction.
2. **994464** (PI name spelled "Zhange"; other issues). Owner is handling it personally.
3. **1001976** is a trashed Keck Foundation test grant (Inactive/Trash); outside scope. Three duplicate "W. M. Keck Foundation" accounts exist.

### Verify Before Acting

1. Session 620 limits carried: audio PR #513 released (`413c5f048`); no fresh Production transcription or 4 GB rerun proved; Board real release/email/archive acceptance unproved. Evidence limits, not tasks.

### Do Not Reopen Without New Decision

1. PRs #506, #511, #512, #513 merged; printable briefing needs no rebuild.
2. Keep `codex/legacy-test-request-1002788` (`e563c5f3b`) unmerged.
3. Do not re-run Stage A writes; its resolve hash `7e5cdcf7` and logs are owner-held. Do not re-run the co-PI role check; decisions are recorded in plan §3.2.
4. Proposed naming does not imply route, database, API or identifier migration.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` | Plan, results, owner decisions, held Connor note (§7) |
| `scripts/backfill-research-pi-institution-at-award.mjs` | Stage A resolve/apply/verify/rollback (applied) |
| `scripts/lib/research-iaa-backfill.mjs` | Stage A decision rules (`tests/unit/research-iaa-backfill.test.js`) |
| `scripts/verify-research-copi-roles.mjs` | Paid evidence-only co-PI role check |
| `scripts/lib/research-copi-roles.mjs` | Role rules, quote verification, name matching (`tests/unit/research-copi-roles.test.js`) |
| `scripts/probe-research-copi-accounts.mjs` | Read-only probe of recorded co-PIs' accounts |
| `scripts/probe-research-pi-contacts-without-account.mjs` | Read-only duplicate/creator probe for PI contacts |
| `lib/dataverse/schema/wave34-copi-institution-at-award/` | Column spec (applied) |
| `docs/atlas/dataverse-wmkf-apprequestperson.md` | Junction Atlas incl. the new column and backfill state |
| `docs/atlas/dataverse-akoya-request.md` | Gotchas: special grants, NCE, trashed/test requests |

## Testing

```bash
npx jest tests/unit/research-iaa-backfill.test.js tests/unit/research-copi-roles.test.js
```

## Handoff notes

Milestone: DEVELOPMENT_LOG.md entry added, **Institution at Award column and Research PI backfill**. CLAUDE.md needs no change. Claim-evidence report: 1 advisory event (2 universal claims) on the plan; one row added to `docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md`. Sandbox runs need `DYNAMICS_SANDBOX_URL` passed on the command line, never in `.env.local`. Unrelated untracked files in the shared checkout (`output/`, `.impeccable/critique/2026-10-19T02-04-42Z__shared-components-board-writeups-boardwriteups-js.md`) belong to another session and were left alone.
