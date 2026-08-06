# Session 404 Prompt: Fuzzy-matching reconciliation (now the gate for the card redesign)

> **S404 interim update (2026-08-06, mid-session).** Next Item 1 is **DONE**: the
> fuzzy-matching reconciliation reached a confirmed Claude×Codex consensus —
> `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md` (committed
> `205bba54` with the working draft). Two Codex rounds: round 1 "CONSENSUS: YES
> (amended shape)", round 2 "CONFIRMED" on the final document. All Codex
> amendments accepted (falsification suite never calibrates production
> thresholds; consolidation via characterization tests, not a blanket refactor;
> shared FS scoring primitives with decision-specific models + fail-closed
> vetoes; institution-first). **Six owner questions** now pend in §4 of that doc
> (precision floor, review capacity, ROR namespace, benchmark investment,
> affiliation representation, contact-attribution semantics); five nits in §5.
> Note: requested `--model sol-5.6` was rejected by the Codex account; both
> rounds ran on the Codex CLI default model — owner may want a re-run when that
> model is available. Downstream next steps: benchmark build (Next Item 2)
> awaits owner answers, then normalizer consolidation + scorer increments, then
> the card redesign. Session then pivoted to an owner-reported bug (in
> progress at handoff time; see /stop update below if present).

> **Handoff, 2026-08-06 (Session 403).** Production is healthy and carries three
> S403 UI fixes (`bc85ec8`, `ceb5ee1`, `e58d2d5`); the last deploy reached READY.
> The session began on the deferred fuzzy-matching reconciliation, was pulled
> away by an owner-reported Add-Reviewer bug, and ended in a design review that
> **re-sequenced the roadmap**: the candidate-card redesign and the
> containment-first comparison fix are now both downstream of the fuzzy-matching
> decision. That reconciliation is the next build-gating task. Run `/start` first.

## Session 403 Summary

All 57 `/start` gates were green at session start and at handoff. Full suite grew
6,849 → 6,860 [VERIFIED via full jest run at handoff].

### What Was Completed

1. **"Confirm existing person" was unusable (owner report) — FIXED
   (`bc85ec8`, `ceb5ee1`).** On the Find tab's Add-or-Refer form, an ambiguous
   identity lookup rendered candidate cards that looked like static info boxes
   (clicking one IS the confirm action), and an unresolved submit silently
   re-rendered the box with no message. Now: candidate cards carry a
   "Use this person" pill that turns the card **emerald** with "✓ Selected"
   (matching the "✓ Existing linked reviewer record" palette); the card footer
   offers **Confirm and Add** (type=submit, disabled until a selection) and
   **Disconfirm** (closes the card AND records `{mode:'create_new'}` so the next
   submit does not re-lookup into a loop); unresolved submits surface an inline
   instruction. `confident`/`conflict` outcomes keep their original buttons.
   Pins: `tests/unit/reviewer-find-panel-manual-add-confirm.test.js` (3 tests,
   2 stash-verified to fail pre-fix).
2. **Warning badges now link to their remedy (`e58d2d5`).** Owner: "Email needs
   confirmation should be clickable… the link below is hard to see." Six warnings
   route to the remedy the card already offered: the email-readiness chip and the
   address-verification pill → edit contact / conflict reviewer; "Verified email
   required" → edit contact; "Identity review required" and the "Dataverse
   identity needs review" banner → confirm identity; "Existing linked reviewer
   record needs repair" → repair request. Load-bearing: three derived handlers
   (`openAddressRemedy`, `openIdentityRemedy`, `openRepairRemedy`) are the SINGLE
   source for both badge and lower control (the controls were rewritten to call
   them — [VERIFIED: `ReviewerSearchSection.js:308-313` are the only direct
   handler invocations left]), each null when its control would not render, so a
   badge never offers a dead or gating-bypassing action. Pins:
   `tests/unit/reviewer-card-warning-badges-clickable.test.js` (8 tests, 3
   stash-verified; the fail-closed cases pass both ways by design).
3. **Diagnosed the William Shih / request 1003046 repair request** (owner
   question). `⚑ Create repair request` files a dashboard alert ONLY — no
   Dataverse write, severity `warning` so **no email is sent**, deduped on
   (request, candidate, code), and **nothing auto-resolves it** (no
   `AlertService.autoResolve` caller uses a `reviewer-address-repair` key). The
   card's actual remedy is "✓ This is the right person → edit & add", which
   confirms identity AND submits the address attestation in one pass
   (`confirmIdentityContact` ends in `verifyAddressContact`). See "Verify Before
   Acting" for the still-open item.
4. **Design review → whole-card simplification memo.** Full inventory of
   `CandidateCard`: up to 15 stacked banners, 10 pills, 5 contact chips, a
   7-control action row, 6 border states, 4 independent severity encodings.
   Memo (inventory, diagnosis, proposed structure, decisions, sequence):
   `https://claude.ai/code/artifact/e535ed0d-6724-40ad-9d1d-ff95b0ae85a1`.
   Owner decisions recorded in `project-reviewer-card-simplification-direction`.
5. **Wiki + memory:** two `reviewer-workbench-lifecycle` entries (S403 confirm
   card, S403 clickable badges); new memories
   `project-reviewer-card-simplification-direction`,
   `feedback-affordance-consistency-beats-deduplication`; MEMORY.md router line.

### Commits (session, chronological)
- `bc85ec8` fix(reviewers): make 'Confirm existing person' affordance explicit
- `ceb5ee1` feat(reviewers): green selected state + Confirm and Add / Disconfirm
- `e58d2d5` feat(reviewers): warning badges link to their remedy
- (this handoff commit) docs + memory

## Next Items

### Verified Open (owner-prioritized)

1. **Reconcile the two fuzzy-matching research docs — now the gate for
   everything downstream.** Inputs:
   `outputs/fuzzy-matching-independent-research-fable-2026-08-05.md` (Claude,
   independent) vs `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`
   (Codex, 2026-08-04). Deliverable: agreements, disagreements, what each missed,
   and a merged position; surface the Claude doc's 4 owner questions (precision
   floor, review-queue capacity, ROR as canonical namespace, benchmark
   investment). Evidence for the new priority: `project-reviewer-card-simplification-direction`
   — the research's three-band decision model (auto/review/reject) maps directly
   onto the proposed card status band, so building the card (or patching one
   comparison) first would bake in the wrong abstraction. **Decision work; no
   build authorized.**
2. **Benchmark: adversarial matrix + failure archive** (from the research
   recommendation). Shih's Dana-Farber/Harvard-Medical-School vs "Harvard
   University" case is row one. Evidence: memo sequence table. Follows item 1.
3. **Containment-first comparison fix + structured verdict DTO — RESEQUENCED,
   not dropped.** Evidence: directive §S399 addendum; acceptance tests pinned in
   `tests/unit/enrich-recommended-institution-evidence.test.js`. Now expected to
   be absorbed as a property of the shared scorer rather than shipped as a
   standalone patch — UNLESS the benchmark shows the case is common and urgent,
   in which case shipping it as a stopgap is explicitly fine.
4. **Invite-panel split copy** (carried; small UX polish, optional).

### Verified Open (carried)

1. **S399 finding 4 — silent no-op invite button.** [VERIFIED still OPEN via
   `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md:404`.] Same family as the
   S403 manual-add silent no-op fixed in `bc85ec8` — that fix is a worked
   example of the remedy (inline instruction instead of a bare `return`).
2. **Blob-cache hazard watch (passive).**
3. **Optional hardening from S402 review (non-blocking):** (a) narrow fail-open
   corner in the author check; (b) endpoint tests pin the PI-variant path but not
   the co-PI or stored-name paths.
4. **Repair-request reason code is ambiguous.** `conflictRecordUnavailable`
   files under `address_conflict_pending` because the client label is a fallback
   for any `blocked` readiness [VERIFIED: `ReviewerSearchSection.js:1892-1898`
   against `reviewer-search-logic.js:181,195`]. Small fix; offered and not taken
   up. Distinguish from the card: "Review address conflict" = true conflict,
   "↻ Retry conflict check" = record-unavailable.

### Owner Decision Needed (carried)

1. **postcss moderate advisory** (Dependabot 62) — likely needs a `next` upgrade.
2. **Increment E — ProfileProvider double-fetch**
   (`shared/context/ProfileContext.js:456-489`). [ASSUMED ~0.5–1s tail].
3. **Latency secondary candidates from D0** (only if owner wants more).
4. **Columbia enrichment contaminant** ("EKA University of Applied Sciences" in
   Konofagou's resolvedInstitutions — unexplained, S400).

### Parked

1. **Candidate B (exclusion-parse cache)** — largely obsoleted if structured
   intake ships.
2. **Excluded-reviewers intake Phases A/B** — awaiting Justin×Connor
   reconciliation (`docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md` §6).
3. **Card redesign build (status band / Details disclosure / footer split;
   coauthor verdict; institution-COI sort + override)** — shape and decisions
   settled S403, deliberately sequenced AFTER the matching work. Re-open trigger:
   items 1–3 above complete. See `project-reviewer-card-simplification-direction`.

### Verify Before Acting

1. **Request 1003046 / William Shih is still blocked and its admin alert is
   still open.** The address conflict (`william_shih@dfci.harvard.edu` stored vs
   `william.shih@wyss.harvard.edu` found) was diagnosed, not resolved. The
   remedy is "✓ This is the right person → edit & add" on his card. The
   `reviewer_address_repair_requested` alert will NOT auto-resolve even after the
   address is fixed — someone must close it in `/admin#system-alerts`. Do not
   read a lingering alert as "still broken".
2. **Behavioral validation on owner's next real usage — still THREE unreported
   checks:** (a) post-send rows show Invited with no reload (S401); (b) a
   re-found engaged person collapses into "Already handled", a namesake stays
   selectable (S401); (c) an unverified-suggestion card shows the confirm/exclude
   affordances (S402). The owner was mid-pass when the Add-Reviewer bug
   interrupted; none was reported back.
3. **Any comparison-fix work**: read the directive §S399 addendum status block +
   wiki workbench hazard first; fail-closed posture is deliberate
   (`project-reviewer-verify-fail-dangerous`).
4. **Any matching/normalizer consolidation**: read
   `feedback-latency-plan-scope-accretion-postmortem` FIRST. This work is the
   exact shape of the S395 debacle; every increment must be independently
   shippable and no pass may unify all ~25 predicates at once.

### Do Not Reopen Without New Decision

1. Reverted warm-reconciliation range `5b6757df..7072d52a` — never
   merge/cherry-pick.
2. Reverted byline-core fallback (`e2342f92`, reverted `b5b5fe08`).
3. Request `1002903` mutation work — read-only absent new exact authorization.
4. S400-suspected onSent/SSE post-send race — disproven S401.
5. **Making warning affordances selectively clickable.** Owner rejected reverting
   two of six badges to inert: an affordance that is sometimes live and sometimes
   not is worse than one occasionally redundant
   (`feedback-affordance-consistency-beats-deduplication`).
6. **Institution COI as a client-side verdict.** It is recomputed and rejected
   server-side at save; any override must be an audited server path.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/ReviewerFindPanel.js` | Add-or-Refer manual add; `confirm existing person` card (S403) |
| `shared/components/reviewers/ReviewerSearchSection.js` | `CandidateCard`; the three remedy handlers at `:308-313`; all warning badges |
| `tests/unit/reviewer-find-panel-manual-add-confirm.test.js` | S403 confirm-card contract (3 tests) |
| `tests/unit/reviewer-card-warning-badges-clickable.test.js` | S403 badge→remedy + fail-closed parity (8 tests) |
| `lib/services/reviewer-address-trust-service.js` | `createAddressRepairRequest` — alert only, no Dataverse write |
| `lib/services/reviewer-finder/save-candidates-service.js` | Authoritative institution-COI reject (`:1110-1170`) |
| `lib/services/discovery/coauthor-coi.js` | `gradeCoauthorCOI` threshold the coauthor verdict would replace |
| `outputs/fuzzy-matching-independent-research-fable-2026-08-05.md` | Claude research — reconciliation input A |
| `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` | Codex research — reconciliation input B |

## Testing

```bash
npm run check:types
npx jest --testPathPatterns "reviewer-find-panel|reviewer-card|reviewer-search"
npx jest                                # full suite, 6,860
```
