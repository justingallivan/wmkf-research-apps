# Session 313 Prompt: (open — pick from Next Items)

## Session 312 Summary

Reviewer-workbench debugging session (Duncan Spore / request **1003125**, D26) plus two
durable hazard notes and an email-prefs verification. Two prod data touch-ups were made
directly (both low-risk, reversible, explicitly authorized): a Dataverse triage flip and a
Postgres roster-row delete. No feature code shipped — this was diagnosis + docs.

### What Was Completed

1. **Per-user email bracket-token verification** (`903d2cbe`). Worry: colleagues' profiles
   might still hold legacy `[bracket]` email templates after the S311 mustache migration.
   Probed live prod Dataverse — **0 rows affected** across `reviewer_email_templates` (1 row,
   empty `{}`), `grantee_invite_body` (2 rows, already mustache), `reviewer_finder_email_template`
   (0 rows). Reviewer templates render mustache-only (`replacePlaceholders`, `email-generator.js:159`),
   so a bracket body WOULD render literally — but none exist. Promoted the probe to
   `scripts/probe-user-email-token-syntax.mjs` (reusable); deleted the stale S289
   `probe-rabinowitz-conflict.js`.
2. **Removed the resolved auto-deploy webhook next-item** (`fb25ff21`). The GitHub→Vercel
   webhook fired on its own; Justin is tracking reliability. Item dropped from Next Items.
3. **Reviewer-materials attach-and-verify design direction captured** (`a84e5f8b`). Decision:
   move reviewer-file selection off the invisible `Reviewer_Downloads/` folder-drop (Connor's
   PA flow) to an explicit staff attach-and-verify action backed by a Dataverse link entity;
   future — once the intake/submission portal owns the file, point the link entry at it and
   retire the folder dependency. NOT built. See `docs/agent-wiki/topics/external-reviewer-portal.md`.
4. **Fixed 1003125 not showing in the dashboard** (prod Dataverse write, no commit). Root
   cause: `wmkf_triagestatus` was `null` (created after the D26 triage backfill), and the
   dashboard shows `Phase II Pending` OR `triage=Advancing` (`dashboard.js:166`). Set
   `wmkf_triagestatus = Advancing (100000000)` on request `152ef6f0-f173-f111-ab0f-000d3a306da2`.
   (Aside corrected in-session: the `my-proposals.js` Phase-II-only filter is a DIFFERENT
   surface than the dashboard.)
5. **Diagnosed + fixed "only 2 of 5 applicant-suggested reviewers show"** (prod Postgres write,
   no commit). Three layered causes, all now documented: (a) enrichment requires the proposal
   LOADED (`enrich-recommended.js:150-155`); (b) digit-stripping name normalization collapses
   names differing only by a trailing digit (`tester2/3/4/5 testing` → `tester testing`);
   (c) the durable `reviewer_find_roster` cache short-circuits re-enrichment
   (`hasValidApplicantEnrichmentCache`, `reviewer-search-logic.js:123` →
   `ReviewerSearchSection.js:805-808`), so renaming the people in Dataverse didn't self-heal.
   Fix: deleted the 2 stale `source_kind='applicant_suggested'` roster rows for 1003125 to
   invalidate the cache (legit search rows left intact). Documented both hazards in the wiki
   (`9bd6e703`, `12f7935a`).

### Prod data changes (no code commit — recorded for continuity)
- **Dataverse** `akoya_requests(152ef6f0-f173-f111-ab0f-000d3a306da2)` (req 1003125):
  `wmkf_triagestatus` `null` → `100000000` (Advancing).
- **Postgres** `reviewer_find_roster`: deleted 2 rows where `request_id='152ef6f0-…'`
  AND `source_kind='applicant_suggested'`.

### Commits
- `903d2cbe` — Add read-only probe for legacy `[bracket]` tokens in per-user email prefs (+ remove rabinowitz probe)
- `fb25ff21` — Remove resolved GitHub→Vercel auto-deploy webhook next-item
- `a84e5f8b` — Record reviewer-materials attach-and-verify design direction (S312)
- `9bd6e703` — Document name-normalization dedup collapse as recurring hazard (S312)
- `12f7935a` — Extend dedup hazard note: applicant-enrichment roster cache staleness (S312)

## Next Items

### Verify Before Acting

1. **Confirm 1003125 now shows all 5 renamed applicant reviewers.** The roster cache was
   cleared this session; the fix needs a real check. Have Duncan **reload the Find tab** on
   1003125 (proposal must be loaded) — expect Kevin Turing / Kyle Worming / Shultzie Spore /
   Harry Ewing / William Harrison in the Applicant-suggested section (distinct names → no
   collapse). Evidence: this session's roster delete; `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
2. **Other D26 requests may have been missed by the triage backfill** (like 1003125 was).
   Offered but NOT run: a read-only sweep of D26 `akoya_requests` that are `triage=null` and
   not `Phase II Pending` (invisible on the dashboard). Evidence: `pages/api/workbench/dashboard.js:166`.

### Verified Open

1. **Run the Codex memory + wiki hygiene review.** MEMORY.md is ~11,924 / 12,288 B — within
   ~364 B of the hard cap. Codex should PLAN (not blind-edit): consolidate/dedup router lines,
   push leaked detail into `docs/agent-wiki/topics/` pages, retire closed items to Archive,
   verify leaf memories against source (mark stale, don't rewrite), check wiki staleness —
   restore headroom. Deliverable: a proposed plan to review before applying. (Justin planned to
   run this at home.) Evidence: `.claude-memory/MEMORY.md` size; `.claude-memory/project-memory-router-trap-prevention.md`.
2. **Applicant-suggested roster cache-staleness gap (product fix).** Editing/renaming an
   applicant reviewer after the first enrichment silently won't reflect — the durable roster
   cache blocks re-enrichment and there's no UI to force it. Real fix: invalidate/re-enrich
   applicant roster rows when the source person record changes, or expose a manual "re-enrich
   recommended" control. Evidence: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`
   (Operating Notes, S312); `reviewer-search-logic.js:123`.
3. **Reviewer-materials attach-and-verify build (option 2).** Design captured (`a84e5f8b`),
   not built: staff "attach reviewer materials" action backed by a Dataverse link entity +
   queryable "materials attached ✓" state; keep the folder-walk as a transition fallback.
   Evidence: `docs/agent-wiki/topics/external-reviewer-portal.md` (design-direction note).
4. **Bracket-alias cleanup PR (email templates).** S311 left the System-B resolvers
   DUAL-SYNTAX (accept `[x]` and `{{x}}`) for a soak. After confidence, drop the legacy
   `[bracket]` aliases. Do NOT remove before greenlit — intentional, not dead code. Verified
   this session: 0 per-user prefs still carry brackets (`scripts/probe-user-email-token-syntax.mjs`).
   Evidence: `docs/EMAIL_TOKEN_SYNTAX_UNIFICATION_PLAN.md` §5; `[[project-email-template-token-syntax]]`.
5. **Surface the 3 board-identity fields on Track Reviewers (read-only) + Excel export.**
   Carried S308→S312, still NOT built. `my-candidates` DTO emits
   `academicRank`/`primaryDepartment`/`mainInstitution` (`my-candidates.js:214-216`) and
   `CandidateEditModal` edits them, but Track Reviewers cards + the workbook don't show them.
   Evidence: `docs/REVIEWER_STAGE2A_IDENTITY_CAPTURE_BUILD_PLAN.md` §C step 9.
6. **Optional invite-modal follow-up: collapse the campaign-timeline block** into a
   `<details>` for more message-body room. Offered S310, not greenlit. Low effort.
   Evidence: `shared/components/reviewers/InviteEmailModal.js` (timeline block ~L294-319).
7. **Reviewer nice-to-haves #4 & #5 unbuilt.** #4 reviewer-memory flag + searchable notes;
   #5 controlled expertise-tag taxonomy / editable tags (free-text export shipped S308).
   Evidence: `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md` §4, §5.
8. **Optional `wmkf_firstname` trailing-whitespace second pass.** Low-priority hygiene; the
   `wmkf_name` cleanup did NOT cover it. Note: the 1003125 test reviewers have leading/trailing
   spaces in `wmkf_name` (e.g. `" Kevin Turing "`) — cosmetic (normalization trims). Evidence:
   `docs/agent-wiki/topics/dataverse-dynamics.md`.

### Owner Decision Needed

1. **Writeup-generator tab + reviewer-database browse.** On the docket (S308); board-identity
   fields feed them. Needs scope/prioritization. Evidence: `.claude-memory/project-workbench-consolidation-rollout.md`.
2. **Remit-flag on review-completion** — wire `wmkf_authorizationtoremitpaymentflag` on submit?
   Carried S304/S305. Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.

### Parked

1. **Honorarium payment pipeline enablement.** Capture-only in prod (S309):
   `HONORARIUM_ONBOARDING_DEFERRED` + 3 discriminator GUIDs absent force `isCaptureOnly()`.
   Re-open trigger: leadership decision. Evidence: `lib/bill/honorarium-onboard-orchestrator.js:47-56`.
2. Longer carried list (BILL API access, PNI self-report, workbench access boundaries,
   applicant-exclusion, Dataverse settings audit, nomenclature/app-sunset sweep).
   Re-open trigger: owner prioritization. Evidence: `.claude-memory/MEMORY.md` router.

### Do Not Reopen Without New Decision

1. **The digit-stripping name normalization is load-bearing (S312).** `normalizeReviewerName`
   / `normalizeName` strip non-alpha incl. digits by design (stable keying for the roster
   unique index, the person `normalizedName` column, excluded-name matching). Don't "fix" the
   regex; a real same-name-collision fix means keying dedup on name + an identity anchor.
   Evidence: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` (Operating Notes).
2. **thankyou email has NO secure-link button (S311).** No fallback label → button suppressed
   (a body with a review link renders a plain link). Intentional. Evidence:
   `pages/api/review-manager/send-emails.js` `DEFAULT_REVIEW_BUTTON_LABELS`; `3817944e`.
3. **`{{proposalTitle}}` vs `{{proposalClause}}` are distinct (S311).** Bare title vs full
   null-safe clause. Don't "consolidate." Evidence: `[[project-email-template-token-syntax]]`.
4. **Email template dual-syntax `[bracket]` aliases are intentional (S311), not dead code.**
   Don't remove until the cleanup PR (Verified Open #4) is greenlit.
5. **h-index is NOT staff-editable in edit modals (S310).** Server route still accepts `hIndex`
   from other callers — intentional. Evidence: `CandidateEditModal.js`; `204086ec`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `pages/api/workbench/dashboard.js` | PD dashboard feed; visibility = `Phase II Pending` OR `triage=Advancing` (`:166`). |
| `pages/api/reviewer-finder/my-proposals.js` | Reviewer-finder proposal picker; DIFFERENT gate (`Phase II Pending` only). |
| `shared/config/triageStatus.js` | `wmkf_triagestatus` values (Advancing=100000000, Set aside=100000001). |
| `pages/api/workbench/applicant-reviewers.js` | Ingests the 5 `wmkf_potentialreviewer1..5` slots → recommended junction rows. |
| `pages/api/workbench/enrich-recommended.js` | Enriches recommended reviewers; REQUIRES proposal loaded for COI. |
| `shared/components/reviewers/ReviewerSearchSection.js` | Find-tab UI; auto-enrich gate + `dedupeByName` (`:100,:805-808`). |
| `shared/components/reviewers/reviewer-search-logic.js` | `hasValidApplicantEnrichmentCache` (`:123`); `normalizeReviewerName` re-export. |
| `lib/services/reviewer-roster-store.js` | Durable `reviewer_find_roster` (Postgres), keyed `(request_id, normalized_name)`. |
| `lib/utils/reviewer-name-match.js` | `normalizeReviewerName` (`:33`, strips digits). |
| `scripts/probe-user-email-token-syntax.mjs` | Read-only probe: legacy `[bracket]` tokens in per-user email prefs. |

## Testing

```bash
npm test   # full suite (283 suites / 3571 tests green as of S311; only prep/data changes since)
node scripts/probe-user-email-token-syntax.mjs   # expect 0 rows with legacy [bracket] tokens
```
