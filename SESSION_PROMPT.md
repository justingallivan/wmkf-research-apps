# Session 694 Prompt: read the June–August institution work, then replay the institution holds

Previous handoff (Session 693 prompt, written at the end of Session 692):
`git show dc6847a16:SESSION_PROMPT.md`.

> **Session 694 interim note (2026-11-21; the full handoff is written at `/stop`).**
> The owner dispatched two independent models to review the whole
> reviewer-finding workflow (goal: fewer than 10% of suggested reviewers need a
> human decision). Their assignment and outputs live in a private, gitignored
> local folder on the owner's machine (not in git; contains real reviewer names):
> `outputs/reviewer-finding-review-2026-11-21/` in the main checkout —
> `brief.md`, `case-packet-26-held.md`, `dispatch-prompt.md`, and on completion
> `report-<model>.md` plus `work-<model>/` for each model. Next step: compare the
> two reports with the owner and move the agreed conclusions, without names,
> into a tracked plan. PR #675 (stage 2 email crash; lookup failure no longer
> read as a mismatch) is merged and live; the institution-hold findings are in
> `docs/plans/APPLICANT_REVIEWER_IDENTITY_W2_PLAN_2026-11-21.md`. Items 1–2
> below were done this session; the 26 holds are mostly stale July–August
> verdicts, not current output.

## Session 693 Summary — 2026-11-20/21 (Claude, main checkout)

### What Was Completed

1. **Find-tab identity card rebuilt (live in Production).**
   - Impeccable critique and audit (12/40, 11/20), then a design brief and mock-up:
     `docs/plans/FIND_IDENTITY_CARD_REDESIGN_BRIEF_2026-11-20.md`,
     `.impeccable/mockups/find-identity-card.html`. Owner decisions 1–11 are in the
     brief (10: a checkbox-only confirmation keeps the send-time check; 11: an older
     AkoyaGO contact is shown, not one-click evidence).
   - The card now has one status chip, one plain match line, a Compare details
     disclosure and one action row. The status comes from `getCandidateCardStatus`
     in `shared/components/reviewers/reviewer-search-logic.js` (presentation only,
     built from the existing promotion and readiness helpers).
   - "Applicant listed" column: the applicant-reviewers response carries
     `applicantListed` (the suggestion row's `wmkf_revieweremail` /
     `wmkf_revieweraffiliation`, unengaged rows only), joined to cards by
     suggestion id. Display only.
   - Fixes after owner screenshots: the "Publications may belong to someone else"
     warning showed on every unresolved card (fixed); identical institution text is
     now compatible without a lookup and shows no note; unconfirmed cards say papers
     are hidden rather than "No publications found".
2. **Why applicant reviewers stay unconfirmed (diagnosed).** Plan:
   `docs/plans/APPLICANT_REVIEWER_IDENTITY_W2_PLAN_2026-11-21.md` (corrected after an
   independent Codex assessment).
   - The legacy identity check accepts only an ORCID found by name search, a Scholar
     profile, or an already-matched OpenAlex id. PubMed verification supplies none,
     so on biomedical proposals Track A reviewers (applicant and AI-suggested) without
     a findable ORCID stay unresolved. Example: Anna Pyle (Yale).
   - The built W2 works-first resolver (`REVIEWER_IDENTITY_RESOLVER_MODE`) fixes most
     of these. Historical replay of 153 applicant reviewers (81 with a usable
     institution): matches would rise from 17 to about 38 of 81. Owner spot check of
     the 35 new binds: all the right person; OpenAlex last-known institution was
     wrong-looking for 5 (doctoral institution, collaborator, campus, recent move).
3. **Shadow measurement live.** Applicant enrichment hands a hidden comparison input
   to `ReviewerIdentityRuntime.runEnrichmentShadowComparisons` via `keepAlive` after
   the roster save (15 s per reviewer including the log write, 90 s per run). Two
   Codex reviews: first needs-attention (inline budget use; fixed), second approve.
   The **owner set `REVIEWER_IDENTITY_RESOLVER_MODE=shadow` in Production on
   2026-11-21**; a rerun on 1003526 wrote 5 rows to `reviewer_identity_shadow_log`
   (2 works rescues, 2 review, 1 consensus).
4. **Institution holds (open question that ends this session).** 26 saved applicant
   rows are held by the legacy institution consistency check. The June stage-2
   assessment (`lib/services/institution-affiliation-stage2.js`, switch
   `NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION`, set about 2026-08-19) understands
   extra affiliations and same-system institutions but is copy-only by design
   (`enrich-recommended-service.js:955-965`). Only 3 of the 26 held rows carry a
   stage-2 verdict (most predate the switch); these counts are all saved non-test applicant rows, not only the 81 replay-usable ones.

### Production Access This Session
All owner-approved; Postgres reads read-only (`BEGIN READ ONLY`); probes in the
session scratchpad only.
- Counts on `reviewer_find_roster` (applicant identity outcomes, email confound,
  stage-2 kinds) and `reviewer_identity_shadow_log`.
- Names and institutions of non-test applicant roster rows, for the local W2 replay
  (results in the scratchpad, not in the repo; the repo is public).
- Earlier in the session: D26 corroboration probes (Postgres and Dataverse,
  counts only), recorded in the card brief §7.
- Production writes: none by Claude. The owner changed the Vercel setting and ran
  "Update applicant suggestions" on 1003526 (which rewrote that request's roster rows).
- The stable Preview alias was moved to the card branch for owner viewing and
  restored to `dpl_8C5J3QpUy5uaPA1VLPAk12FprrRX` (verified).
- Paid enrichment ran locally twice for one name (a few cents).

### Commits
On `main`, `b84c7a992..84d896ce2`, all pushed (Production deploys verified Ready for
each runtime merge). Main runtime commits: `36a844459`, `93f460b4d`, `d292a5920`
(card); `0f9eb7b06` (applicant column); `03e5c76c9` (warning and identical-text
fixes); `ae79c1688` (wording); `e20650e7f`, `808576ca8` (shadow comparison). Plans and
decisions: `6a59a8b53`, `22fd70614`, `ace7ca954`, `84d896ce2`.

## Next Items

### Verified Open

1. **Deep dive into the June–August 2026 institution and identity work first (owner
   request, before any replay).** Read the docs Claude and Codex wrote then, and
   summarize what was decided, built, gated and left open, especially: how
   extra affiliations (HHMI, Broad), same-system institutions (Harvard and its
   hospitals) and moves were meant to avoid flags; why stage 2 has no identity
   authority; and the independent-identity "Phase 2" gate
   (`reviewerInstitutionPhase2Enabled`). Starting points (verify each; this list is
   from a filename scan, not a reading):
   - `docs/agent-wiki/topics/reviewer-identity.md` (route first)
   - `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`
   - `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`
   - `docs/REVIEWER_AFFILIATION_CONTACT_RECONCILIATION_PLAN.md` and
     `docs/audits/reviewer-affiliation-contact-reconciliation-adversarial-2026-07-21.md`
   - `docs/REVIEWER_IDENTITY_CONTACT_PLAN.md` (W0–W4; HHMI + Broad exemption is COI)
   - `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`,
     `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md`,
     `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md`
   - `docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md`,
     `docs/plans/ROR_MEASUREMENT_RUNS_REPORT_2026-09-14.md`
   - `benchmarks/institution-affiliation-compatibility`, `benchmarks/institution-pair-consistency`
   - Source: `lib/services/institution-affiliation-stage2.js`,
     `lib/services/institution-affiliation-assessment.js`,
     `enrich-recommended-service.js` (`institutionEvidenceConnectsIdentity`, ~900–1000)
   Deliverable: a short owner-readable summary, then a recommendation for the replay.
2. **Then: local replay of institution checks for the 26 held applicant reviewers.**
   Use the names/institutions already gathered (re-gather with owner OK if the
   scratchpad was cleared). Run free PubMed verification, then the legacy checks and
   stage 2, per person: "legacy says contradiction; stage 2 says same / additional /
   distinct". Public services only, no writes. Ask before any new Production read.
3. **Then: applicant-only W2 combined pilot** (plan, Options 3–4). Needs a per-path
   mode override, the profile-propagation fix (a different OpenAlex last-known
   institution must NOT count as a contradiction; see the owner spot check), cache
   refresh, tests, Codex review and owner approval. Target before February reviewer
   finding.
4. **Read the shadow log in a few weeks** (counts only, owner OK). Little traffic is
   expected before February.
5. **Card follow-ups (brief §8 build order):** move the applicant controls (Factory
   button, Update applicant suggestions, retries, empty state) to the top of Find,
   then remove the duplicate "Applicant-referred reviewers" box; closed reason
   codes; then the server-side evidence levels and **Confirm and add to Invite**
   (needs Branch 2 first).
6. **Branch 2: exclusion enforcement** (unchanged scope from Session 692; owner
   decisions recorded). Prerequisite for the combined Confirm and add to Invite.
7. **Stale docs to fix with `/sweep`:** `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md`
   §1 (send-time rule predates S391); `docs/atlas/postgres-reviewer-find-roster.md:344`
   says enrichment no longer runs on load, but `useApplicantReviewerEnrichment.js`
   still does. Data quality: 62 of 153 saved applicant rows have no institution and
   10 carry an email in the institution field.
8. **Carried from Session 692, still open:** Connor's step 3 go-live check before
   early December; Connor's promised builds; low-priority Connor questions; the
   `cycle-dossier.entry` cache-read probe (owner OK); the J27 list search hint for
   not-ready requests. Evidence: `git show dc6847a16:SESSION_PROMPT.md`.

### Owner Decision Needed

1. Whether stage 2 may release institution holds for "additional affiliation" and
   "same system" relationships once identity comes from papers (W2). Decide after
   items 1–2 above.
2. Carried: step-3 prompt limits vs the CSO workbook (12 differences); an optional
   Workbench control for `wmkf_readyforreview`.

### Parked

1. Live promotion test on 1003526 (owner parked 2026-11-20). Do not fill the
   identity-confirmation attestation on the owner's behalf.
2. Carried from Session 692: proposal lists; Connor's roster connection check; do not
   merge the Executor lineage branch; consultant-feedback finalize retry reuse.

### Verify Before Acting

1. **Executive Summary trial batch-2 cleanup, Monday Nov 23 after 18:31:58 UTC.**
   Destructive; steps in `git show dc6847a16:SESSION_PROMPT.md` and
   `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` ~95–128.
   `/private/tmp/wmkf-summary-live-20261116` still existed on 2026-11-21.
2. **Merged remote branches that could be deleted:** this session's
   `find-identity-card-layout`, `find-applicant-listed-column`,
   `find-card-status-fixes`, `find-unresolved-wording`,
   `reviewer-identity-shadow-enrichment`, plus Session 692's three. All merged;
   confirm before deleting.
3. **Production identity mode is now `shadow`** (owner-set). Do not set `combined`
   without an approved cutover; changing it back does not undo any writes.

### Do Not Reopen Without New Decision

1. Card decisions 1–11 in the brief (including: checkbox-only confirmations keep the
   send-time check; an older AkoyaGO contact is display-only).
2. Do not cut over W2 globally on the evidence so far; applicant-only pilot first.
3. Session 692's list (compliance screening, archived destinations, exclusion
   policy, deprecated `potentialreviewer1`–`5`, and the rest).

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| Find identity card | `docs/plans/FIND_IDENTITY_CARD_REDESIGN_BRIEF_2026-11-20.md` | Layout, column and fixes live; applicant-controls move and server evidence work next |
| Applicant reviewer identity (W2) | `docs/plans/APPLICANT_REVIEWER_IDENTITY_W2_PLAN_2026-11-21.md` | Shadow live; June–Aug doc review, then institution replay, then pilot |
| J27 applicant reviewers / exclusions | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` §9 | Branch 2 enforcement not started |
| PA intake flows (Connor) | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Waiting on step-3 go-live |
| Memory hygiene | `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 | Router about 7.6 KB |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Batch-2 cleanup Nov 23 |

## Key Files Reference

| File | Purpose |
|---|---|
| `shared/components/reviewers/search/CandidateCard.js` | Find card (status, match line, Compare details, actions) |
| `shared/components/reviewers/reviewer-search-logic.js` | `getCandidateCardStatus` |
| `lib/services/workbench/applicant-reviewers-service.js` | `applicantListedFromSuggestionRow` |
| `lib/services/reviewer-identity-runtime.js` | Resolver modes; `runEnrichmentShadowComparisons` |
| `lib/services/contact-enrichment/tiers.js` | Identity step in enrichment; hidden shadow input |
| `lib/services/workbench/enrich-recommended-service.js` | Applicant enrichment, institution hold, shadow hand-off |
| `lib/services/institution-affiliation-stage2.js` | Stage-2 assessment; identical-text short-circuit |

## Testing

```bash
npx jest --silent tests/unit/reviewer-candidate-card-status.test.js tests/unit/reviewer-identity-runtime.test.js tests/unit/contact-enrichment-tiers.test.js tests/unit/workbench-enrich-recommended-service.test.js tests/unit/workbench-applicant-reviewers-service.test.js tests/unit/institution-affiliation-stage2.test.js
```

## Closeout

**Milestone determination:** no DEVELOPMENT_LOG entry. The card redesign and the
shadow measurement are improvements to existing capabilities; no cutover (Production
identity decisions are unchanged; shadow mode only logs).

**Other closeout checks:** CLAUDE.md unchanged. Claim-evidence report: 0 advisory
events recorded for this session key, so no observation row.
