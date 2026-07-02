# Session 317 Prompt: Housekeeping + debugging (user-directed)

## Session 316 Summary

Shipped the reviewer honorarium **no-BILL go-live**: honorarium `akoya_request`
rows are now minted in Production when a non-opt-out reviewer accepts (payment still
offline). Also hardened the capture-only backfill, created the honorarium→proposal
self-lookup, resolved a Connor open item, and fixed a red CI gate. Justin flagged the
next session is **housekeeping + debugging** (specific targets TBD by Justin).

### What Was Completed

1. **No-BILL honorarium creation GO-LIVE (Production).**
   - Set the 3 discriminator GUIDs on Production; removed `HONORARIUM_ONBOARDING_DEFERRED`
     from Production (kept `true` on Preview → preview stays capture-only, also has no
     GUIDs); kept `BILL_ONBOARDING_DEFERRED=true`; redeployed prod
     (`dpl_CqnqfG6mp3U9FkLuvzWsuzmnUfc1`, aliased reviews/applications.wmkeck.org).
   - Verified live via matching deployment id. Rollback = re-add
     `HONORARIUM_ONBOARDING_DEFERRED=true` to Production + redeploy.

2. **`wmkf_reviewedproposal` self-lookup created + wired.**
   - Self-referential lookup on `akoya_request` created via the Dataverse Web API
     (Default Solution; cascade Delete=RemoveLink). Referencing nav property
     `wmkf_ReviewedProposal` (read back from metadata, `$expand`-confirmed).
   - Create body binds it so app-created honoraria populate the FK for Connor's AkoyaGO
     dashboard. Meeting date + fiscal year cue from the parent proposal.

3. **Capture-only backfill hardened (Codex-reviewed).**
   - Extracted the accept-path address contract (presence + validity) into
     `lib/external/required-address.js`, shared by `respond.js` and the backfill; added
     `akoya_title` to the reload. Codex P0: backfill had enforced presence only, not
     country-ISO2 validity. Verified the backfill run is **unneeded** (read-only sweep:
     4 window candidates, all test rows).

4. **Other:** resolved the Connor GoApply-linkage open item (no action needed); pinned
   United States to the top of the reviewer country picker; fixed the red
   `check:docs-catalog` gate (a `.json`→`.js` frontmatter typo).

### Commits
- `f340e776` — Record capture-only backfill is unneeded (verified only test rows)
- `1291b0fb` — Record no-BILL honorarium creation go-live (Production, 2026-07-02)
- `a3d83a8d` — Create wmkf_reviewedproposal self-lookup + wire honorarium→proposal bind
- `559e2aee` — Lock self-lookup name to wmkf_reviewedproposal
- `75cd7569` — Approve honorarium→proposal self-lookup; document, keep bind parked
- `2301b34c` — Resolve GoApply-linkage Connor open item (§7)
- `add00163` — Reviewer accept form: pin United States to top of country picker
- `46575e8c` — Backfill: enforce address VALIDITY too, not just presence (Codex P0)
- `76a721a1` — Harden honorarium capture-only backfill before go-live
- `c94c109e` — Fix docs-catalog gate: related path .json → .js typo

## Next Items

### User-Directed (Session 317 focus)

1. **Housekeeping + debugging — targets TBD by Justin.**
   Justin will bring the specific housekeeping/debugging items. Ask what to focus on
   before assuming; the items below are the standing backlog, not a directive.

### Verified Open

1. **Confirm active-cycle proposals have meeting dates (honorarium go-live follow-up).**
   Evidence: `lib/bill/honorarium-onboard-orchestrator.js:156-159` — a honorarium is
   REFUSED (`honorarium_no_meeting_date`) if the parent proposal has no
   `wmkf_meetingdate`; the accept still succeeds and an alert fires. Now that minting is
   live, a proposal missing its meeting date silently mints no honorarium for its
   reviewers. Offered but not run: a read-only check that active-cycle proposals all
   carry `wmkf_meetingdate`.

2. **Continue memory-hygiene cleanup queue.**
   Evidence: `docs/audits/memory-cleanup-queue-2026-07-02.md`. Pick the next bounded
   package (Dynamics/Power Tools first targets already done in S315 `d9d5f614`). This is
   housekeeping and fits the S317 focus.

### Owner Decision Needed

1. **Writeup-generator tab + reviewer-database browse.**
   Evidence: `.claude-memory/project-workbench-consolidation-rollout.md`. Needs product
   prioritization before implementation.

2. **Remit flag on review completion.**
   Evidence: `.claude-memory/project-honorarium-payment-landscape.md`;
   `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §3b. Decide whether review submit / PD
   completion should wire `wmkf_authorizationtoremitpaymentflag`; payment stays offline.

3. **`wmkf_reviewedproposal` solution placement (Connor).**
   Evidence: `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §8/§9. The field lives in the
   Default Solution; Connor may add the component to `wmkfResearchReviewAppSuite` if his
   ALM wants it bundled (non-destructive; no code impact).

### Verify Before Acting

1. **Confirm request 1003125 shows all 5 renamed applicant reviewers.**
   Evidence: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`. Preflight: have
   Duncan reload the Find tab or run a read-only live check before treating roster cache
   staleness as still present.

2. **D26 triage-null sweep.**
   Evidence: `pages/api/workbench/dashboard.js` (D26 dashboard filter). Offered but not
   run: a read-only sweep of D26 `akoya_requests` where triage is null and status is not
   Phase II Pending. Re-derive the query before running.

3. **Applicant-suggested roster cache-staleness product fix.**
   Evidence: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`;
   `reviewer-search-logic.js:123`. Re-read current roster/enrichment code before
   implementing; do not assume the S313 finding is still live.

4. **Optional: clean up 4 honorarium test suggestion rows.**
   Evidence: S316 read-only sweep (`Gallivan_test`, `Gallivantingaround`, two empty
   no-name/no-email rows in the capture-only window). Harmless (no meeting date/address →
   never mint), but could be deleted for tidiness. Confirm they are tests before any
   delete.

### Parked

1. **Reviewer-materials attach-and-verify build (option 2).** Evidence:
   `docs/agent-wiki/topics/external-reviewer-portal.md`; design commit `a84e5f8b`.
   Re-open: owner asks to build it.
2. **Email template bracket-alias cleanup.** Evidence:
   `docs/EMAIL_TOKEN_SYNTAX_UNIFICATION_PLAN.md` §5. Re-open: soak explicitly greenlit.
3. **Track Reviewers board-identity fields + Excel export.** Evidence:
   `docs/REVIEWER_STAGE2A_IDENTITY_CAPTURE_BUILD_PLAN.md` §C step 9. Re-open: owner
   prioritizes the read-only surface/export.
4. **Invite-modal campaign timeline collapse.** Evidence:
   `shared/components/reviewers/InviteEmailModal.js`. Re-open: owner greenlights.
5. **Reviewer nice-to-haves #4 and #5.** Evidence:
   `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md` §4/§5.
6. **Full BILL payment pipeline enablement.** Evidence:
   `lib/bill/honorarium-onboard-orchestrator.js`;
   `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §1. Re-open: leadership decides to enable
   person-payee/BILL onboarding. This cycle is request-creation only; payment offline.

### Do Not Reopen Without New Decision

1. **No-BILL honorarium creation is LIVE (2026-07-02).** Evidence: `1291b0fb`;
   `docs/CREDENTIALS_RUNBOOK.md`; `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §2. Do not
   re-flip without a rollback decision.
2. **Capture-only backfill is unneeded (only test rows).** Evidence: `f340e776`;
   `.claude-memory/project-honorarium-payment-landscape.md`. Do not carry the backfill
   run forward as an open task.
3. **GoApply-linkage Connor item resolved; self-lookup created.** Evidence: `2301b34c`,
   `a3d83a8d`; `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §7/§8/§9.
4. **Digit-stripping name normalization is load-bearing.** Evidence:
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
5. **`{{proposalTitle}}` and `{{proposalClause}}` are distinct; `[bracket]` aliases are
   intentional.** Evidence: `.claude-memory/project-email-template-token-syntax.md`.
6. **h-index is not staff-editable in reviewer edit modals.** Evidence:
   `CandidateEditModal.js`; commit `204086ec`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` | Honorarium plan — §2 live config, §6 backfill (unneeded), §8/§9 self-lookup. |
| `lib/bill/honorarium-onboard-orchestrator.js` | Honorarium create body; meeting date/fiscal year from parent; `wmkf_ReviewedProposal` bind. |
| `lib/external/required-address.js` | Shared payment-address presence + validity check (accept guard + backfill). |
| `docs/CREDENTIALS_RUNBOOK.md` | Honorarium env flags + the 2026-07-02 go-live record. |
| `scripts/backfill-honorarium-capture-only.mjs` | Capture-only backfill (verified unneeded this cycle). |
| `docs/audits/memory-cleanup-queue-2026-07-02.md` | Remaining memory-hygiene cleanup queue. |

## Testing

```bash
# Honorarium orchestrator + address contract
npx jest tests/unit/honorarium-onboard-orchestrator.test.js tests/unit/required-address.test.js tests/unit/respond-required-address.test.js tests/integration/external-review-routes.test.js --runInBand

# Durable docs / memory gates
npm run check:docs-catalog
npm run check:doc-symbol-refs
npm run check:build-claim-freshness
npm run check:fact-consistency
npm run check:memory-router
npm run check:agent-wiki
```
