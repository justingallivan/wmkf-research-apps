# Session 403 Prompt: Fuzzy-matching research reconciliation + reviewer queue

> **Handoff, 2026-08-05 (Session 402).** Production is healthy and carries the
> S402 merge (`53366b95`): the unverified-suggestion rescue affordance plus its
> Codex-adversarial-review hardening (proposal-author boundary + phantom-
> exclusion rollback). Deployment reached READY. The owner then commissioned an
> INDEPENDENT fuzzy-matching research pass (five web sweeps + in-repo
> inventory) and explicitly deferred its reconciliation against the Codex
> research doc to THIS session. Run `/start` first.

## Session 402 Summary

All 57 `/start` gates were green at session start. Full suite grew
6,842 → 6,849 [VERIFIED via full jest run at handoff].

### What Was Completed

1. **Unverified-suggestion rescue affordance (S400 finding 3, request 1003046)
   SHIPPED (merge `53366b95`).** The Find tab's "Unverified suggestions"
   cards (ephemeral Claude suggestions the databases couldn't verify) gained
   the S285 confirm-identity + exclude affordances. Load-bearing mechanics:
   unverified rows are ephemeral (never on `reviewer_find_roster`, S224) while
   server `confirm_identity` only updates an existing ACTIVE row, so
   `confirmIdentityContact` records the row on the roster FIRST (upsert;
   retry-safe via `preserveStoredRosterAuthority`), then confirms, then moves
   it into `rosterActive`. Keys stamped with `withReviewerCandidateKey` at
   state time so record POST + confirm PATCH agree even after modal
   affiliation edits. Feature commit `f23d83d` (5 pinned tests,
   stash-verified to fail pre-fix).
2. **Codex adversarial review → both findings fixed (commit `9bef570`;
   Codex-authored via rescue, Claude-reviewed and committed).**
   (a) HIGH: proposal authors could be rescued past the exclusion boundary —
   `filterProposalAuthors` now also covers `discoveryResults.unverified` in
   discover.js, and `confirm_identity` re-checks submitted AND server-stored
   names against the server-resolved PI (`resolveProposalPI`) plus the
   canonical `wmkf_apprequestperson` Co-PI junction (`fetchCoPIs`), rejecting
   with 422 `proposal_author_candidate`. Codex closed a renamed-payload
   bypass and achieved full co-investigator coverage (no PI-only limit).
   (b) MEDIUM: failed unverified exclude left the name in `rosterNames`,
   phantom-suppressing later searches — rollback now restores prior
   membership; pinned test asserts the next search's `excludedNames` payload.
3. **Deployed to production, READY verified** (Vercel inspect polled to
   `● Ready`). Post-merge targeted suites green.
4. **Fuzzy-matching independent research (owner-commissioned).** Five
   parallel web-research agents (record-linkage frameworks, person-name
   matching, author disambiguation, institution resolution, LLM-era matching
   + decision design) plus a full in-repo matching inventory. Position paper:
   `outputs/fuzzy-matching-independent-research-fable-2026-08-05.md`
   (force-added; `outputs/` is gitignored by default). Headline findings:
   the repo has 14 name-normalizer definitions (8 distinct algorithms), 11
   institution normalizers (6 distinct), TWO independent nickname maps, ~25
   boolean predicates, no Jaro-Winkler/frequency/rare-token weighting
   anywhere; the field's answer is Fellegi–Sunter additive evidence scoring
   with three-band decisions (auto/review/reject), registry-first institution
   linking (ROR), and nickname dictionaries for Chris↔Christopher.
   Recommendation shape: benchmark-first (UC adversarial matrix + failure
   archive), consolidate normalizers, one shared scorer at our scale (borrow
   Splink's MODEL not its engine). Research-only; nothing authorized.
5. **Wiki updates:** reviewer-workbench-lifecycle (S402 rescue mechanics +
   author-boundary hardening), reviewer-identity (pointer).

### Commits (session, chronological)
- `f23d83d` feat: rescue affordance on unverified-suggestion cards
- `9bef570` fix: author-boundary + phantom-exclusion gaps (Codex-authored)
- `53366b95` MERGE fix/unverified-suggestion-rescue → production
- (this handoff commit) docs + research artifact

## Next Items

### Verified Open (owner-prioritized)

1. **Reconcile the two fuzzy-matching research docs.** Owner explicitly
   deferred this to next session (2026-08-05 conversation). Inputs:
   `outputs/fuzzy-matching-independent-research-fable-2026-08-05.md`
   (Claude, independent) vs
   `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`
   (Codex, 2026-08-04). Deliverable: agreements, disagreements, what each
   found the other missed, and a merged position for owner decision. The
   Claude doc ends with 4 owner questions (precision floor, review-queue
   capacity, ROR as canonical namespace, benchmark investment) — surface
   them in the reconciliation. Research/decision work; no build authorized.
2. **Comparison fix (containment-first) + structured verdict DTO** (carried
   from S400/S401). Evidence: directive §S399 addendum; acceptance tests
   pinned in `tests/unit/enrich-recommended-institution-evidence.test.js`.
   NOTE: overlaps conceptually with item 1's strategy — consider whether the
   reconciliation should shape this fix before building it piecemeal.
3. **Invite-panel split copy** (carried; small UX polish, optional).

### Verified Open (carried)

1. **S399 finding 4 — silent no-op invite button** (directive addendum:
   OPEN). Untouched by S401/S402 branches.
2. **Blob-cache hazard watch (passive).**
3. **Optional hardening from S402 review (non-blocking):** (a) narrow
   fail-open corner in the author check — PI contact read fails AND no
   co-PIs → empty author set skips the server check (discover filter remains
   primary; posture tolerates false negatives); (b) endpoint tests pin the
   PI-variant path but not the co-PI or stored-name paths (same code path).

### Owner Decision Needed (carried)

1. **postcss moderate advisory** (Dependabot 62) — likely needs a `next`
   upgrade; tier deliberately if approved.
2. **Increment E — ProfileProvider double-fetch**
   (`shared/context/ProfileContext.js:456-489`). [ASSUMED ~0.5–1s tail].
3. **Latency secondary candidates from D0** (only if owner wants more).
4. **Columbia enrichment contaminant** ("EKA University of Applied
   Sciences" in Konofagou's resolvedInstitutions — unexplained, S400).

### Parked (carried)

1. **Candidate B (exclusion-parse cache)** — largely obsoleted if structured
   intake ships.
2. **Excluded-reviewers intake Phases A/B** — awaiting Justin×Connor
   reconciliation (`docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md` §6).

### Verify Before Acting

1. **Behavioral validation on owner's next real usage — now THREE checks:**
   (a) post-send rows show Invited with no reload (S401); (b) a re-found
   engaged person collapses into "Already handled", a namesake stays
   selectable (S401); (c) an unverified-suggestion card shows "✓ This is the
   right person → edit & add" + "✕ Exclude", and confirming one lands it in
   the candidate list (S402). Report divergences immediately.
2. **Any comparison-fix work**: read the directive §S399 addendum status
   block + wiki workbench hazard first; fail-closed posture is deliberate
   (`project-reviewer-verify-fail-dangerous`).

### Do Not Reopen Without New Decision

1. Reverted warm-reconciliation range `5b6757df..7072d52a` — never
   merge/cherry-pick.
2. Reverted byline-core fallback (`e2342f92`, reverted `b5b5fe08`) — the
   containment-first follow-up supersedes it.
3. Request `1002903` mutation work — read-only absent new exact owner
   authorization.
4. S400-suspected onSent/SSE post-send race — disproven S401; do not
   re-chase.

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/fuzzy-matching-independent-research-fable-2026-08-05.md` | Claude independent fuzzy-matching position (S402) — reconcile next |
| `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` | Codex research doc (2026-08-04) — the other reconciliation input |
| `shared/components/reviewers/ReviewerSearchSection.js` | Rescue flow (`confirmIdentityContact`, `excludeUnverifiedCandidate`), unverified render site |
| `pages/api/workbench/reviewer-roster.js` | `confirm_identity` author boundary (`findProposalAuthorMatch`, 422 `proposal_author_candidate`) |
| `pages/api/reviewer-finder/discover.js` | Unverified list now crosses `filterProposalAuthors` |
| `tests/unit/reviewer-search-unverified-rescue.test.js` | S402 rescue + rollback contract (5 tests) |
| `tests/unit/reviewer-discover-unverified-author-filter.test.js` | Discover-level author-filter pin |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | S402 mechanics entry |

## Testing

```bash
npm run check:types
npx jest --testPathPatterns "reviewer-search|reviewer-roster|reviewer-discover"
npx jest                                # full suite, 6,849
```
